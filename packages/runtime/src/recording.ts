import type {
  ComponentEventOptions,
  MutationEvent,
  Trace,
  TraceEvent,
  TraceEventType
} from './types'

/**
 * Owns event admission, append, and mutation causality for Trace recording.
 * Retained Trace lifetime and memory policy deliberately live elsewhere.
 */
export class TraceRecording {
  /** `null` means record every top-level event type; an empty set records none. */
  private eventTypes: Set<TraceEventType> | null = null
  private mutationIndex = new Map<number, MutationEvent>()
  private activeMutation: MutationEvent | null = null

  configure(eventTypes?: readonly TraceEventType[]): void {
    this.eventTypes = eventTypes === undefined ? null : new Set(eventTypes)
  }

  append<T extends TraceEvent>(trace: Trace, event: T): T | null {
    if (this.eventTypes && !this.eventTypes.has(event.type)) return null

    trace.events.push(event)
    if (event.type === 'mutation') this.mutationIndex.set(event.id, event)
    return event
  }

  indexTrace(trace: Trace): void {
    for (const event of trace.events) {
      if (event.type === 'mutation') this.mutationIndex.set(event.id, event)
    }
  }

  completeTrace(trace: Trace): void {
    for (const event of trace.events) {
      if (event.type === 'mutation') event.target = undefined
    }
  }

  forgetTrace(trace: Trace): void {
    for (const event of trace.events) {
      if (event.type !== 'mutation') continue
      if (this.mutationIndex.get(event.id) === event) this.mutationIndex.delete(event.id)
      event.target = undefined
    }

    if (this.activeMutation?.traceId === trace.id) this.activeMutation = null
  }

  clear(): void {
    this.activeMutation = null
    this.mutationIndex.clear()
  }

  getActiveMutation(): MutationEvent | null {
    return this.activeMutation
  }

  setActiveMutation(mutation: MutationEvent | null): void {
    this.activeMutation = mutation
  }

  /** Resolve a cause only when it belongs to the Trace receiving the dependent event. */
  resolveCause(trace: Trace, options?: ComponentEventOptions): MutationEvent | null {
    let cause: MutationEvent | null
    if (options && 'triggeredByMutationId' in options) {
      const id = options.triggeredByMutationId
      cause = id == null ? null : this.mutationIndex.get(id) ?? null
    } else {
      cause = this.activeMutation
    }

    return cause?.traceId === trace.id ? cause : null
  }
}
