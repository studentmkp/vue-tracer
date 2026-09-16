import type {
  Trace,
  TraceEvent,
  MutationEvent,
  ComputedEvent,
  WatchEvent,
  AsyncTaskEvent,
  AsyncTaskType,
  AggregatedMutationGroup,
  ComponentTriggerEvent,
  ComponentRenderEvent,
  InteractionEvent,
  SourceLocation,
  TraceFilterOptions,
  TraceExportData,
  TraceConfidence,
  TraceLevel,
  ComponentEventOptions,
  TraceEventType
} from './types'
import { TraceSession, traceSession } from './session-lifecycle'

let eventIdCounter = 1

export function filterTraceEvents(
  events: (TraceEvent | AggregatedMutationGroup)[],
  options: TraceFilterOptions = {}
): (TraceEvent | AggregatedMutationGroup)[] {
  return events.filter((event) => {
    // 1. Type filter
    if (options.types && options.types.length > 0) {
      const typeAliases =
        event.type === 'aggregated-mutation' ? ['aggregated-mutation', 'mutation'] : [event.type]
      if (!options.types.some((t) => typeAliases.includes(t))) {
        return false
      }
    }

    // 2. Query search (matches name, event, componentName, path, or file)
    if (options.query && options.query.trim()) {
      const q = options.query.toLowerCase().trim()
      let matches = false

      if ('name' in event && event.name && event.name.toLowerCase().includes(q)) matches = true
      if ('event' in event && (event as any).event && (event as any).event.toLowerCase().includes(q)) matches = true
      if ('componentName' in event && (event as any).componentName && (event as any).componentName.toLowerCase().includes(q)) matches = true
      if ('path' in event && (event as any).path && (event as any).path.join('.').toLowerCase().includes(q)) matches = true
      if ('source' in event && (event as any).source?.file && (event as any).source.file.toLowerCase().includes(q)) matches = true
      if ('file' in event && (event as any).file && (event as any).file.toLowerCase().includes(q)) matches = true
      if ('composable' in event && (event as any).composable && (event as any).composable.toLowerCase().includes(q)) matches = true
      if ('origin' in event && (event as any).origin && (event as any).origin.toLowerCase().includes(q)) matches = true

      if (!matches) return false
    }

    // 3. File filter
    if (options.file) {
      const fileTarget = options.file.toLowerCase()
      const eventFile = ('source' in event ? (event as any).source?.file : '') || ('file' in event ? (event as any).file : '') || ''
      if (!eventFile.toLowerCase().includes(fileTarget)) return false
    }

    // 4. Component filter
    if (options.component) {
      const cTarget = options.component.toLowerCase()
      let matches = false
      if ('componentName' in event && (event as any).componentName?.toLowerCase().includes(cTarget)) matches = true
      if ('affectedComponents' in event && (event as any).affectedComponents?.some((c: string) => c.toLowerCase().includes(cTarget))) matches = true
      if (!matches) return false
    }

    // 5. Min duration
    if (options.minDuration !== undefined && options.minDuration > 0) {
      let dur = 0
      if ('duration' in event && typeof (event as any).duration === 'number') {
        dur = (event as any).duration
      }
      if (dur < options.minDuration) return false
    }

    // 6. App Code Only (Noise Reduction, Section 42)
    if (options.appCodeOnly) {
      if ('isExternal' in event && (event as any).isExternal) return false
      if ('source' in event && (event as any).source?.file) {
        const f = (event as any).source.file
        if (f.includes('node_modules') || f.includes('@vite') || f.includes('@vue')) return false
      }
      if ('file' in event && (event as any).file) {
        const f = (event as any).file
        if (f.includes('node_modules') || f.includes('@vite') || f.includes('@vue')) return false
      }
    }

    // 7. Confidence filter
    if (options.confidence) {
      if ('confidence' in event && (event as any).confidence !== options.confidence) {
        return false
      }
    }

    // 8. isExternal filter
    if (options.isExternal !== undefined) {
      const isExt = ('isExternal' in event ? Boolean((event as any).isExternal) : false)
      if (isExt !== options.isExternal) return false
    }

    return true
  })
}

export function aggregateTraceEvents(
  events: TraceEvent[],
  threshold: number = 3
): (TraceEvent | AggregatedMutationGroup)[] {
  const result: (TraceEvent | AggregatedMutationGroup)[] = []
  let i = 0

  while (i < events.length) {
    const event = events[i]

    if (event.type !== 'mutation') {
      result.push(event)
      i++
      continue
    }

    let j = i + 1
    while (
      j < events.length &&
      events[j].type === 'mutation' &&
      (events[j] as MutationEvent).name === (event as MutationEvent).name &&
      (events[j] as MutationEvent).operation === (event as MutationEvent).operation
    ) {
      j++
    }

    const count = j - i
    if (count >= threshold) {
      const batched = events.slice(i, j) as MutationEvent[]
      const first = batched[0]
      const last = batched[batched.length - 1]
      const affected = Array.from(new Set(batched.flatMap((m) => m.affectedComponents)))

      const agg: AggregatedMutationGroup = {
        id: first.id,
        traceId: first.traceId,
        type: 'aggregated-mutation',
        name: first.name || 'mutation',
        count,
        operation: first.operation,
        start: first.timestamp,
        end: last.timestamp,
        duration: Math.max(last.timestamp - first.timestamp, 0.01),
        events: batched,
        before: first.before,
        after: last.after,
        source: first.source,
        affectedComponents: affected,
        pathMode: first.pathMode,
        composable: first.composable,
        isExternal: first.isExternal,
        origin: first.origin,
        traceLevel: first.traceLevel,
        confidence: first.confidence,
        scope: first.scope,
        declaredAt: first.declaredAt
      }
      result.push(agg)
      i = j
    } else {
      result.push(event)
      i++
    }
  }

  return result
}

class TraceCollector {
  private traces: Trace[] = []
  private _activeMutation: MutationEvent | null = null
  private enabled: boolean = true
  private listeners: Set<(trace: Trace, allTraces: Trace[]) => void> = new Set()
  private mutationIndex = new Map<number, MutationEvent>()
  /** `null` means retain every top-level event type; an empty set retains none. */
  private recordingEventTypes: Set<TraceEventType> | null = null
  private readonly session: TraceSession

  constructor(session: TraceSession = traceSession) {
    this.session = session
    // Lifecycle changes (pending work, completion) are news the UI needs too.
    this.session.subscribe(() => this.notify())
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public setEnabled(val: boolean) {
    this.enabled = val
  }

  /**
   * Configures the recording allow-list at the collector seam.
   *
   * `undefined` means retain all recorded event types, while an empty array
   * intentionally retains none. The input is copied so later mutations by a
   * plugin caller cannot change an active recording policy.
   */
  public configureRecording(options: { events?: readonly TraceEventType[] } = {}): void {
    this.recordingEventTypes =
      options.events === undefined ? null : new Set<TraceEventType>(options.events)
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
    return this._activeMutation
  }

  public setActiveMutation(mutation: MutationEvent | null) {
    this._activeMutation = mutation
  }

  /**
   * The mutation a component event should attach to. An explicit id from the
   * caller (the Vue adapter resolves its own causes) wins; the active-mutation
   * window is only the fallback for callers that do not resolve causality.
   */
  private resolveCause(options?: ComponentEventOptions): MutationEvent | null {
    const trace = this.session.current
    if (!trace) return null

    let cause: MutationEvent | null
    if (options && 'triggeredByMutationId' in options) {
      const id = options.triggeredByMutationId
      cause = id == null ? null : this.mutationIndex.get(id) ?? null
    } else {
      cause = this._activeMutation
    }

    // A dropped mutation is deliberately absent from the index. Dependent events
    // may still be retained, but they are de-linked rather than pointing at a
    // missing mutation. The index is shared by all traces, so never carry a cause
    // across traces: every retained causal id must resolve inside its own Trace.
    return cause && cause.traceId === trace.id ? cause : null
  }

  /**
   * The sole retention seam for Trace events. Callers still perform their
   * normal lifecycle/bookkeeping work when this returns null; only storage is
   * governed by the allow-list.
   */
  private retainEvent<T extends TraceEvent>(trace: Trace, event: T): T | null {
    if (this.recordingEventTypes && !this.recordingEventTypes.has(event.type)) {
      return null
    }

    trace.events.push(event)
    return event
  }

  public getTraces(): Trace[] {
    return this.traces
  }

  public clearTraces() {
    this.traces = []
    this._activeMutation = null
    this.mutationIndex.clear()
    this.session.clear()
    this.notify()
  }

  public subscribe(listener: (trace: Trace, allTraces: Trace[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const trace = this.session.current
    if (trace) {
      for (const listener of this.listeners) {
        try {
          listener(trace, this.traces)
        } catch (e) {
          console.error('[vue-tracer] Listener error', e)
        }
      }
    }
  }

  public startTrace(trigger: Trace['trigger']): Trace {
    const trace = this.session.begin(trigger)
    this.traces.push(trace)
    this.notify()
    return trace
  }

  public startInteractionTrace(
    eventType: string,
    target?: HTMLElement | Element | null,
    source?: SourceLocation
  ): Trace {
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
    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'mutation'
      })
    }

    const trace = this.session.current!
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
    if (retained) {
      this.mutationIndex.set(retained.id, retained)
    }
    this.session.arm(trace)
    this.notify()
    return retained
  }

  public recordComponentTrigger(
    componentName: string,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentTriggerEvent | null {
    const trace = this.session.current
    if (!trace) return null

    const cause = this.resolveCause(options)

    // Associate component with the mutation that caused it
    if (cause && !cause.affectedComponents.includes(componentName)) {
      cause.affectedComponents.push(componentName)
    }

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
    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'computed'
      })
    }

    const trace = this.session.current!
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
    const trace = this.session.current
    if (!trace) return null
    return this.recordAsyncEventOn(trace, taskType, name)
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
    if (!this.session.current || this.session.current.status !== 'active') {
      this.startTrace({
        type: 'manual',
        event: 'watch'
      })
    }

    const trace = this.session.current!
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

  public getAggregatedEvents(trace: Trace, threshold: number = 3): (TraceEvent | AggregatedMutationGroup)[] {
    return aggregateTraceEvents(trace.events, threshold)
  }

  public getFilteredEvents(
    trace: Trace,
    options: TraceFilterOptions = {},
    threshold: number = 3
  ): (TraceEvent | AggregatedMutationGroup)[] {
    return aggregateTraceEvents(filterTraceEvents(trace.events, options), threshold)
  }

  public exportTrace(traceId?: number): TraceExportData {
    const targetTrace = traceId
      ? this.traces.find((t) => t.id === traceId)
      : this.session.current || this.traces[this.traces.length - 1]
    const list = targetTrace ? [targetTrace] : []
    return this.createExportData(list)
  }

  public exportTraces(): TraceExportData {
    return this.createExportData(this.traces)
  }

  public exportTracesAsJSON(traceId?: number): string {
    const data = traceId ? this.exportTrace(traceId) : this.exportTraces()
    return JSON.stringify(data, null, 2)
  }

  public importTraces(data: string | TraceExportData): void {
    const parsed: TraceExportData = typeof data === 'string' ? JSON.parse(data) : data
    if (parsed && Array.isArray(parsed.traces)) {
      for (const t of parsed.traces) {
        if (!this.traces.some((existing) => existing.id === t.id)) {
          this.traces.push(t)
          for (const event of t.events) {
            if (event.type === 'mutation') this.mutationIndex.set(event.id, event)
          }
        }
      }
      if (parsed.traces.length > 0) {
        this.session.setCurrent(this.traces[this.traces.length - 1])
      }
      this.notify()
    }
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
