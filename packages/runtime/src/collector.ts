import type {
  Trace,
  TraceEvent,
  MutationEvent,
  ComputedEvent,
  WatchEvent,
  AsyncTaskEvent,
  AsyncTaskType,
  ComponentTriggerEvent,
  ComponentRenderEvent,
  InteractionEvent,
  SourceLocation,
  TraceExportData,
  TraceConfidence,
  TraceLevel,
  ComponentEventOptions,
  TraceEventType
} from './types'
import { TraceSession, traceSession } from './session-lifecycle'
import { TraceRecording } from './recording'
import { TraceRetention, type RetentionPass } from './retention'

let eventIdCounter = 1


class TraceCollector {
  private enabled: boolean = true
  private listeners: Set<(trace: Trace | null, allTraces: Trace[]) => void> = new Set()
  private readonly recording = new TraceRecording()
  private readonly retention = new TraceRetention()
  private readonly session: TraceSession

  constructor(session: TraceSession = traceSession) {
    this.session = session
    // Lifecycle changes (pending work, completion) are news the UI needs too.
    this.session.subscribe((trace) => this.handleSessionChange(trace))
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  /**
   * `false` stops new traces, events, and async adoption without touching retained
   * data. `true` is an explicit resume: it enforces the budget first (a completed
   * current Trace becomes an eviction candidate) and only enables recording when
   * the retained set fits.
   */
  public setEnabled(val: boolean): void {
    if (!val) {
      if (!this.enabled) return
      this.enabled = false
      this.notify()
      return
    }

    const pass = this.retention.enforce(null)
    this.handleRetentionPass(pass)
    if (pass.overBudget) {
      if (this.enabled) {
        this.enabled = false
        this.notify()
      }
      return
    }

    const changed = !this.enabled
    this.enabled = true
    if (changed || pass.evicted.length > 0) this.notify()
  }

  /**
   * Configures the recording policy at the collector seam.
   *
   * The call replaces the whole policy: `events` unset retains all recorded event
   * types, `maxMemoryMB` unset removes the retention budget. The event list is
   * copied so later mutations by a plugin caller cannot change the active policy.
   * A set `maxMemoryMB` is a retention budget in MiB (fractions allowed) that is
   * enforced immediately; an invalid value throws before any state changes.
   */
  public configureRecording(options: {
    events?: readonly TraceEventType[]
    maxMemoryMB?: number
  } = {}): void {
    const pass = this.retention.configure(options.maxMemoryMB, this.session.current)
    this.recording.configure(options.events)
    this.handleRetentionPass(pass)
    if (pass.overBudget) this.enabled = false
    this.notify()
  }

  /** Session completion/pending changes: release live refs, re-account, enforce. */
  private handleSessionChange(trace: Trace | null): void {
    if (trace && trace.status === 'completed') this.recording.completeTrace(trace)

    const pass = trace
      ? this.retention.contentChanged(trace, this.session.current)
      : this.retention.enforce(this.session.current)
    this.handleRetentionPass(pass)
    if (pass.overBudget) this.enabled = false
    this.notify()
  }

  private applyRetention(trace: Trace): void {
    const pass = this.retention.contentChanged(trace, this.session.current)
    this.handleRetentionPass(pass)
    if (pass.overBudget) this.enabled = false
  }

  private handleRetentionPass(pass: RetentionPass): void {
    for (const trace of pass.evicted) {
      this.recording.forgetTrace(trace)
      if (this.session.current === trace) this.session.setCurrent(null)
    }
  }

  public isInternalAsync(): boolean {
    return this.session.isInternalAsync()
  }

  public getCurrentTrace(): Trace | null {
    return this.session.current
  }

  public setCurrentTrace(trace: Trace | null) {
    this.session.setCurrent(trace)
  }

  public runWithTrace<T>(trace: Trace, fn: () => T): T {
    return this.session.runWithTrace(trace, fn)
  }

  public getActiveMutation(): MutationEvent | null {
    return this.recording.getActiveMutation()
  }

  public setActiveMutation(mutation: MutationEvent | null) {
    this.recording.setActiveMutation(mutation)
  }

  /**
   * The mutation a component event should attach to. An explicit id from the
   * caller (the Vue adapter resolves its own causes) wins; the active-mutation
   * window is only the fallback for callers that do not resolve causality.
   */
  private resolveCause(options?: ComponentEventOptions): MutationEvent | null {
    const trace = this.session.current
    if (!trace) return null

    return this.recording.resolveCause(trace, options)
  }

  /**
   * The facade's append path. Callers still perform their normal lifecycle work
   * when recording rejects an event; retained content alone reaches retention.
   */
  private retainEvent<T extends TraceEvent>(trace: Trace, event: T): T | null {
    const retained = this.recording.append(trace, event)
    if (retained) this.applyRetention(trace)
    return retained
  }

  public getTraces(): Trace[] {
    return this.retention.getTraces()
  }

  /**
   * Clears retained Traces, indexes, size accounting, and session state. The
   * recording policy (`events`, `maxMemoryMB`) and the enabled/disabled flag stay
   * as configured: after an overflow auto-pause, resuming still takes an explicit
   * `setEnabled(true)`.
   */
  public clearTraces(): void {
    this.retention.clear()
    this.recording.clear()
    this.session.clear()
    this.notify()
  }

  public subscribe(listener: (trace: Trace | null, allTraces: Trace[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.session.current, this.retention.getTraces())
      } catch (e) {
        console.error('[vue-tracer] Listener error', e)
      }
    }
  }

  /** Starts a Trace. While recording is disabled no Trace is created. */
  public startTrace(trigger: Trace['trigger']): Trace | null {
    if (!this.enabled) return null

    const previous = this.session.current
    const trace = this.session.begin(trigger)
    if (previous && previous !== trace && previous.status === 'completed') {
      this.recording.completeTrace(previous)
    }

    const pass = this.retention.retain(trace, this.session.current)
    this.handleRetentionPass(pass)
    if (pass.overBudget) this.enabled = false
    this.notify()
    return trace
  }

  public startInteractionTrace(
    eventType: string,
    target?: HTMLElement | Element | null,
    source?: SourceLocation
  ): Trace | null {
    if (!this.enabled) return null

    const targetTag = target ? target.tagName.toLowerCase() : 'unknown'
    let targetText: string | undefined
    if (target) {
      if ('value' in target && typeof (target as any).value === 'string' && (target as any).value) {
        targetText = `value="${(target as any).value.slice(0, 30)}"`
      } else {
        targetText = target.textContent?.trim().slice(0, 30) || undefined
      }
    }

    const trace = this.startTrace({
      type: 'interaction',
      event: eventType,
      targetTag,
      targetText,
      source
    })
    if (!trace) return null

    const interactionEvent: InteractionEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'interaction',
      event: eventType,
      targetTag,
      targetText,
      source,
      timestamp: performance.now()
    }

    this.retainEvent(trace, interactionEvent)
    this.notify()
    return trace
  }

  public recordMutation(data: {
    reactiveId?: string | number
    name?: string
    path?: string[]
    pathMode?: MutationEvent['pathMode']
    operation: MutationEvent['operation']
    before: any
    after: any
    source: SourceLocation
    target?: any
    composable?: string
    isExternal?: boolean
    origin?: string
    traceLevel?: TraceLevel
    confidence?: TraceConfidence
    scope?: MutationEvent['scope']
    declaredAt?: SourceLocation
  }): MutationEvent | null {
    if (!this.enabled) return null

    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'mutation'
      })
    }

    const trace = this.session.current
    if (!trace) return null
    const isExternal = data.isExternal ?? false
    const confidence = data.confidence || (isExternal ? 'inferred' : 'exact')
    const traceLevel = data.traceLevel || (isExternal ? 'partial' : 'full')

    const mutationEvent: MutationEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'mutation',
      reactiveId: data.reactiveId,
      name: data.name,
      path: data.path,
      pathMode: data.pathMode,
      operation: data.operation,
      before: data.before,
      after: data.after,
      source: data.source,
      timestamp: performance.now(),
      target: data.target,
      affectedComponents: [],
      composable: data.composable,
      isExternal,
      origin: data.origin,
      traceLevel,
      confidence,
      scope: data.scope,
      declaredAt: data.declaredAt
    }

    const retained = this.retainEvent(trace, mutationEvent)
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public recordComponentTrigger(
    componentName: string,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentTriggerEvent | null {
    if (!this.enabled) return null

    const trace = this.session.current
    if (!trace) return null

    const cause = this.resolveCause(options)

    // Associate component with the mutation that caused it
    const causeUpdated = cause !== null && !cause.affectedComponents.includes(componentName)
    if (causeUpdated) cause.affectedComponents.push(componentName)

    const triggerEvent: ComponentTriggerEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'component-trigger',
      componentName,
      file,
      triggeredByMutationId: cause?.id,
      timestamp: performance.now(),
      confidence: 'runtime'
    }

    const retained = this.retainEvent(trace, triggerEvent)
    // A filtered-out trigger event still changed the cause's `affectedComponents`.
    if (causeUpdated && retained === null) this.applyRetention(trace)
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public recordComponentRender(
    componentName: string,
    start: number,
    end: number,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentRenderEvent | null {
    if (!this.enabled) return null

    const trace = this.session.current
    if (!trace) return null

    const renderEvent: ComponentRenderEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'component-render',
      componentName,
      file,
      start,
      end,
      duration: end - start,
      triggeredByMutationId: this.resolveCause(options)?.id,
      confidence: 'runtime'
    }

    const retained = this.retainEvent(trace, renderEvent)
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public recordComputedInvalidated(data: {
    name: string
    source?: SourceLocation
    target?: any
  }): ComputedEvent | null {
    if (!this.enabled) return null

    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'computed'
      })
    }

    const trace = this.session.current
    if (!trace) return null
    const triggeredByMutationId = this.resolveCause()?.id

    const computedEvent: ComputedEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'computed',
      name: data.name,
      source: data.source,
      status: 'invalidated',
      triggeredByMutationId,
      timestamp: performance.now()
    }

    const retained = this.retainEvent(trace, computedEvent)
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public recordAsyncTask(taskType: AsyncTaskType, name?: string): AsyncTaskEvent | null {
    if (!this.enabled) return null

    const trace = this.session.current
    if (!trace) return null
    const asyncEvent = this.recordAsyncEventOn(trace, taskType, name)
    this.notify()
    return asyncEvent
  }

  /**
   * Adopts an in-flight continuation into `trace`: records its async event and marks
   * it pending with the session. `settleAsyncTask` closes it out.
   */
  public adoptAsyncTask(
    trace: Trace,
    taskType: AsyncTaskType,
    name?: string
  ): AsyncTaskEvent | null {
    if (!this.enabled) return null

    const asyncEvent = this.recordAsyncEventOn(trace, taskType, name)
    // Adoption is lifecycle bookkeeping, not event storage. It must still
    // happen when `async` is excluded so later work stays on this Trace.
    if (trace.status === 'active') this.session.adopt(trace)
    return asyncEvent
  }

  /** Settles a continuation adopted by `adoptAsyncTask`, re-arming completion. */
  public settleAsyncTask(trace: Trace): void {
    this.session.settle(trace)
  }

  /**
   * Completes a mutation that was already retained: the `after` snapshot is only
   * known behind the application write, so the recorder hands it back here for
   * size accounting and retention. The write itself is never gated by this call.
   */
  public finalizeMutation(mutation: MutationEvent | null, after: unknown): void {
    if (!mutation) return
    mutation.after = after

    const trace = this.retention.find(mutation.traceId)
    if (!trace) return

    this.applyRetention(trace)
    this.notify()
  }

  private recordAsyncEventOn(
    trace: Trace,
    taskType: AsyncTaskType,
    name?: string
  ): AsyncTaskEvent | null {
    if (trace.status !== 'active') return null

    const asyncEvent: AsyncTaskEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'async',
      taskType,
      name,
      timestamp: performance.now()
    }

    return this.retainEvent(trace, asyncEvent)
  }

  public recordWatchExecuted(data: {
    name?: string
    source?: SourceLocation
  }): WatchEvent | null {
    if (!this.enabled) return null

    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'watch'
      })
    }

    const trace = this.session.current
    if (!trace) return null
    const triggeredByMutationId = this.resolveCause()?.id

    const watchEvent: WatchEvent = {
      id: eventIdCounter++,
      traceId: trace.id,
      type: 'watch',
      name: data.name,
      source: data.source,
      triggeredByMutationId,
      timestamp: performance.now()
    }

    const retained = this.retainEvent(trace, watchEvent)
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public exportTrace(traceId?: number): TraceExportData {
    const targetTrace = traceId
      ? this.retention.find(traceId)
      : this.session.current || this.retention.getTraces()[this.retention.getTraces().length - 1]
    const list = targetTrace ? [targetTrace] : []
    return this.createExportData(list)
  }

  public exportTraces(): TraceExportData {
    return this.createExportData(this.retention.getTraces())
  }

  public exportTracesAsJSON(traceId?: number): string {
    const data = traceId ? this.exportTrace(traceId) : this.exportTraces()
    return JSON.stringify(data, null, 2)
  }

  /**
   * Merges an exported snapshot into the retained set. Import is a data load, not
   * runtime recording, so it works while disabled — but the same budget applies:
   * imported `active` Traces become completed snapshots, a local active current
   * Trace is never replaced, and an oversized import can evict completed Traces
   * (or auto-pause when the selected Trace alone cannot fit).
   */
  public importTraces(data: string | TraceExportData): void {
    const parsed: TraceExportData = typeof data === 'string' ? JSON.parse(data) : data
    if (!parsed || !Array.isArray(parsed.traces)) return

    const inserted: Trace[] = []
    for (const t of parsed.traces) {
      if (!t || this.retention.has(t.id)) continue

      const trace: Trace = t.status === 'completed' ? t : { ...t, status: 'completed' }
      this.retention.retainSnapshot(trace)
      inserted.push(trace)
      this.recording.indexTrace(trace)
    }

    const current = this.session.current
    if (inserted.length > 0 && (!current || current.status !== 'active')) {
      this.session.setCurrent(inserted[inserted.length - 1])
    }

    const pass = this.retention.enforce(this.session.current)
    this.handleRetentionPass(pass)
    if (pass.overBudget) this.enabled = false
    this.notify()
  }

  private createExportData(traceList: Trace[]): TraceExportData {
    let mutationsCount = 0
    let rendersCount = 0
    let totalEvents = 0
    for (const t of traceList) {
      totalEvents += t.events.length
      for (const e of t.events) {
        if (e.type === 'mutation') mutationsCount++
        if (e.type === 'component-render') rendersCount++
      }
    }
    return {
      version: '0.2',
      exportedAt: Date.now(),
      summary: {
        tracesCount: traceList.length,
        totalEventsCount: totalEvents,
        mutationsCount,
        rendersCount
      },
      traces: traceList.map((t) => ({
        ...t,
        events: t.events.map((e) => {
          if (e.type !== 'mutation') return e
          const { target: _liveTarget, ...rest } = e as MutationEvent
          return rest as MutationEvent
        })
      }))
    }
  }
}

export const traceCollector = new TraceCollector()
