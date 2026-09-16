import type { Trace } from './types'

/** An idle Trace — no continuation in flight — is done after this long. */
export const IDLE_COMPLETION_MS = 150

/** While continuations are in flight the session re-checks after this long. */
export const PENDING_COMPLETION_MS = 500

/** Live lifecycle state for one Trace: continuations adopted but not settled. */
interface PendingState {
  pendingTasks: number
}

export type TraceSessionListener = (trace: Trace | null) => void

let traceIdCounter = 1

/**
 * Owns when a Trace is done.
 *
 * Interaction capture begins traces here, async adoption calls `adopt`/`settle`,
 * every recorded event re-arms the completion timer, and the overlay reads live
 * pending counts through `getPendingTasks`. Nothing outside this module writes
 * `Trace.status`, `Trace.completedAt`, or the pending count.
 */
export class TraceSession {
  private _currentTrace: Trace | null = null
  private pending = new WeakMap<Trace, PendingState>()
  private completionTimer: ReturnType<typeof setTimeout> | null = null
  private _isInternalAsync = false
  private listeners = new Set<TraceSessionListener>()

  get current(): Trace | null {
    return this._currentTrace
  }

  /** Marks an existing trace as current (imported traces, tests). */
  setCurrent(trace: Trace | null): void {
    this._currentTrace = trace
  }

  subscribe(listener: TraceSessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runs `fn` with `trace` as the current trace, restoring the previous one. */
  runWithTrace<T>(trace: Trace, fn: () => T): T {
    const previous = this._currentTrace
    this._currentTrace = trace
    try {
      return fn()
    } finally {
      // If `fn` began a newer trace, leave that one current instead of the old trace.
      if (this._currentTrace === trace) this._currentTrace = previous
    }
  }

  /** Completes the active trace, if any, and starts a new one. */
  begin(trigger: Trace['trigger']): Trace {
    const previous = this._currentTrace
    if (previous && previous.status === 'active') this.finish(previous)

    const trace: Trace = {
      id: traceIdCounter++,
      trigger,
      startedAt: performance.now(),
      events: [],
      status: 'active'
    }

    this._currentTrace = trace
    this.arm(trace)
    return trace
  }

  /** Declares the trace done. Completion is a session decision, not a field write. */
  complete(trace: Trace): void {
    if (trace.status === 'completed') return
    this.finish(trace)
    this.notify()
  }

  private finish(trace: Trace): void {
    trace.status = 'completed'
    trace.completedAt = performance.now()
    this.pending.delete(trace)

    if (this._currentTrace === trace) {
      if (this.completionTimer) clearTimeout(this.completionTimer)
      this.completionTimer = null
    }
  }

  /** Marks a continuation as in flight. Pair every `adopt` with a `settle`. */
  adopt(trace: Trace): number {
    const state = this.pending.get(trace) ?? { pendingTasks: 0 }
    state.pendingTasks += 1
    this.pending.set(trace, state)
    this.notify()
    return state.pendingTasks
  }

  /** Marks a continuation settled and re-arms completion so the trace can finish. */
  settle(trace: Trace): number {
    const state = this.pending.get(trace)
    if (state) state.pendingTasks = Math.max(0, state.pendingTasks - 1)
    this.arm(trace)
    this.notify()
    return state?.pendingTasks ?? 0
  }

  /** Live pending-continuation count for a trace; typed session state for the UI. */
  getPendingTasks(trace: Trace): number {
    return this.pending.get(trace)?.pendingTasks ?? 0
  }

  /** True while the session schedules its own timer, so tracing must not adopt it. */
  isInternalAsync(): boolean {
    return this._isInternalAsync
  }

  /** (Re)arms the completion timer for the current trace. */
  arm(trace: Trace): void {
    if (this._currentTrace !== trace || trace.status !== 'active') return

    if (this.completionTimer) clearTimeout(this.completionTimer)

    const timeoutMs = this.getPendingTasks(trace) > 0 ? PENDING_COMPLETION_MS : IDLE_COMPLETION_MS

    // The completion timer is tracer plumbing, not a continuation of the trace;
    // the guard keeps the async patch from adopting it as pending work.
    this._isInternalAsync = true
    try {
      this.completionTimer = setTimeout(() => {
        this.completionTimer = null
        if (this._currentTrace !== trace || trace.status !== 'active') return

        if (this.getPendingTasks(trace) > 0) {
          // Work is still in flight: retry instead of declaring the trace done.
          this.arm(trace)
          return
        }

        this.complete(trace)
      }, timeoutMs)
    } finally {
      this._isInternalAsync = false
    }
  }

  /** Drops the current trace, pending counts, and any armed completion timer. */
  clear(): void {
    if (this.completionTimer) clearTimeout(this.completionTimer)
    this.completionTimer = null
    this._currentTrace = null
    this.pending = new WeakMap()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this._currentTrace)
      } catch (e) {
        console.error('[vue-tracer] Session listener error', e)
      }
    }
  }
}

/** Session used by the runtime's collector; exported for the overlay and tests. */
export const traceSession = new TraceSession()
