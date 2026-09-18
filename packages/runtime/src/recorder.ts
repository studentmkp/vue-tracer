import { traceCollector } from './collector'
import type {
  AsyncTaskEvent,
  AsyncTaskType,
  ComponentEventOptions,
  ComponentRenderEvent,
  ComponentTriggerEvent,
  InteractionEvent,
  MutationEvent,
  SourceLocation,
  Trace
} from './types'

/**
 * The recording seam used by host integrations.
 *
 * It deliberately contains only the operations needed by async adoption,
 * interaction capture, and component causality. Retention, projection, export,
 * and recording configuration remain concerns of the collector facade.
 */
export interface TraceRecorder {
  isEnabled(): boolean
  isInternalAsync(): boolean
  getCurrentTrace(): Trace | null
  runWithTrace<T>(trace: Trace, fn: () => T): T
  startInteractionTrace(
    eventType: string,
    target?: HTMLElement | Element | null,
    source?: SourceLocation
  ): Trace | null
  adoptAsyncTask(trace: Trace, taskType: AsyncTaskType, name?: string): AsyncTaskEvent | null
  settleAsyncTask(trace: Trace): void
  recordComponentTrigger(
    componentName: string,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentTriggerEvent | null
  recordComponentRender(
    componentName: string,
    start: number,
    end: number,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentRenderEvent | null
}

/** Production adapter: the narrow recording view of the collector singleton. */
export const collectorRecorder: TraceRecorder = {
  isEnabled: () => traceCollector.isEnabled(),
  isInternalAsync: () => traceCollector.isInternalAsync(),
  getCurrentTrace: () => traceCollector.getCurrentTrace(),
  runWithTrace: (trace, fn) => traceCollector.runWithTrace(trace, fn),
  startInteractionTrace: (eventType, target, source) =>
    traceCollector.startInteractionTrace(eventType, target, source),
  adoptAsyncTask: (trace, taskType, name) =>
    traceCollector.adoptAsyncTask(trace, taskType, name),
  settleAsyncTask: (trace) => traceCollector.settleAsyncTask(trace),
  recordComponentTrigger: (componentName, file, options) =>
    traceCollector.recordComponentTrigger(componentName, file, options),
  recordComponentRender: (componentName, start, end, file, options) =>
    traceCollector.recordComponentRender(componentName, start, end, file, options)
}

export interface InMemoryTraceRecorderOptions {
  enabled?: boolean
  currentTrace?: Trace | null
}

/**
 * Isolated recorder adapter for integration tests. It has no retention policy,
 * timers, subscriptions, or dependency on the collector singleton.
 */
export class InMemoryTraceRecorder implements TraceRecorder {
  private enabled: boolean
  private currentTrace: Trace | null
  private nextTraceId = 1
  private nextEventId = 1
  private pending = new WeakMap<Trace, number>()
  readonly traces: Trace[] = []

  constructor(options: InMemoryTraceRecorderOptions = {}) {
    this.enabled = options.enabled ?? true
    this.currentTrace = options.currentTrace ?? null
    if (this.currentTrace) {
      this.traces.push(this.currentTrace)
      this.nextTraceId = this.currentTrace.id + 1
      this.nextEventId =
        this.currentTrace.events.reduce((max, event) => Math.max(max, event.id), 0) + 1
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isInternalAsync(): boolean {
    return false
  }

  getCurrentTrace(): Trace | null {
    return this.currentTrace
  }

  setCurrentTrace(trace: Trace | null): void {
    this.currentTrace = trace
    if (trace && !this.traces.includes(trace)) this.traces.push(trace)
  }

  runWithTrace<T>(trace: Trace, fn: () => T): T {
    const previous = this.currentTrace
    this.currentTrace = trace
    try {
      return fn()
    } finally {
      if (this.currentTrace === trace) this.currentTrace = previous
    }
  }

  startInteractionTrace(
    eventType: string,
    target?: HTMLElement | Element | null,
    source?: SourceLocation
  ): Trace | null {
    if (!this.enabled) return null

    const targetTag = target ? target.tagName.toLowerCase() : 'unknown'
    let targetText: string | undefined
    if (target) {
      if (
        'value' in target &&
        typeof (target as HTMLInputElement).value === 'string' &&
        (target as HTMLInputElement).value
      ) {
        const value = (target as HTMLInputElement).value
        targetText = `value="${value.slice(0, 30)}"`
      } else {
        targetText = target.textContent?.trim().slice(0, 30) || undefined
      }
    }

    if (this.currentTrace?.status === 'active') {
      this.currentTrace.status = 'completed'
      this.currentTrace.completedAt = performance.now()
    }

    const trace: Trace = {
      id: this.nextTraceId++,
      trigger: { type: 'interaction', event: eventType, targetTag, targetText, source },
      startedAt: performance.now(),
      events: [],
      status: 'active'
    }
    const interaction: InteractionEvent = {
      id: this.nextEventId++,
      traceId: trace.id,
      type: 'interaction',
      event: eventType,
      targetTag,
      targetText,
      source,
      timestamp: performance.now()
    }
    trace.events.push(interaction)
    this.traces.push(trace)
    this.currentTrace = trace
    return trace
  }

  adoptAsyncTask(
    trace: Trace,
    taskType: AsyncTaskType,
    name?: string
  ): AsyncTaskEvent | null {
    if (!this.enabled || trace.status !== 'active') return null

    const event: AsyncTaskEvent = {
      id: this.nextEventId++,
      traceId: trace.id,
      type: 'async',
      taskType,
      name,
      timestamp: performance.now()
    }
    trace.events.push(event)
    this.pending.set(trace, (this.pending.get(trace) ?? 0) + 1)
    return event
  }

  settleAsyncTask(trace: Trace): void {
    this.pending.set(trace, Math.max(0, (this.pending.get(trace) ?? 0) - 1))
  }

  getPendingTasks(trace: Trace): number {
    return this.pending.get(trace) ?? 0
  }

  recordComponentTrigger(
    componentName: string,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentTriggerEvent | null {
    if (!this.enabled || !this.currentTrace) return null
    const cause = this.findCause(options)
    if (cause && !cause.affectedComponents.includes(componentName)) {
      cause.affectedComponents.push(componentName)
    }

    const event: ComponentTriggerEvent = {
      id: this.nextEventId++,
      traceId: this.currentTrace.id,
      type: 'component-trigger',
      componentName,
      file,
      triggeredByMutationId: cause?.id,
      timestamp: performance.now(),
      confidence: 'runtime'
    }
    this.currentTrace.events.push(event)
    return event
  }

  recordComponentRender(
    componentName: string,
    start: number,
    end: number,
    file?: string,
    options?: ComponentEventOptions
  ): ComponentRenderEvent | null {
    if (!this.enabled || !this.currentTrace) return null
    const event: ComponentRenderEvent = {
      id: this.nextEventId++,
      traceId: this.currentTrace.id,
      type: 'component-render',
      componentName,
      file,
      start,
      end,
      duration: end - start,
      triggeredByMutationId: this.findCause(options)?.id,
      confidence: 'runtime'
    }
    this.currentTrace.events.push(event)
    return event
  }

  private findCause(options?: ComponentEventOptions): MutationEvent | null {
    if (!this.currentTrace) return null
    if (options && 'triggeredByMutationId' in options) {
      return (
        this.currentTrace.events.find(
          (event): event is MutationEvent =>
            event.type === 'mutation' && event.id === options.triggeredByMutationId
        ) ?? null
      )
    }
    return null
  }
}
