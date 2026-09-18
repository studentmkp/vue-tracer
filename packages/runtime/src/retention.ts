import type { MutationEvent, Trace } from './types'

const BYTES_PER_MIB = 1024 * 1024
const utf8Encoder: TextEncoder | null =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function utf8ByteLength(text: string): number {
  if (utf8Encoder) return utf8Encoder.encode(text).length

  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

function exportSafeTrace(trace: Trace): Trace {
  return {
    ...trace,
    events: trace.events.map((event) => {
      if (event.type !== 'mutation') return event
      const { target: _liveTarget, ...rest } = event as MutationEvent
      return rest as MutationEvent
    })
  }
}

function estimateTraceBytes(trace: Trace): number {
  return utf8ByteLength(
    JSON.stringify(exportSafeTrace(trace), (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  )
}

export interface RetentionPass {
  evicted: Trace[]
  overBudget: boolean
}

/** Owns the retained Trace set, its memory budget, and oldest-first eviction. */
export class TraceRetention {
  private traces: Trace[] = []
  /** `null` means retained Traces grow without limit. */
  private maxMemoryBytes: number | null = null
  private traceSizeCache = new WeakMap<Trace, number>()

  getTraces(): Trace[] {
    return this.traces
  }

  find(traceId: number): Trace | undefined {
    return this.traces.find((trace) => trace.id === traceId)
  }

  has(traceId: number): boolean {
    return this.traces.some((trace) => trace.id === traceId)
  }

  retain(trace: Trace, protectedTrace: Trace | null): RetentionPass {
    this.retainSnapshot(trace)
    return this.contentChanged(trace, protectedTrace)
  }

  /** Adds an imported snapshot; callers enforce once after selecting protection. */
  retainSnapshot(trace: Trace): void {
    this.traces.push(trace)
  }

  configure(maxMemoryMB: number | undefined, protectedTrace: Trace | null): RetentionPass {
    let maxMemoryBytes: number | null = null
    if (maxMemoryMB !== undefined) {
      if (
        typeof maxMemoryMB !== 'number' ||
        !Number.isFinite(maxMemoryMB) ||
        maxMemoryMB <= 0
      ) {
        throw new RangeError(
          `[vue-tracer] maxMemoryMB must be a finite number greater than 0; received ${String(
            maxMemoryMB
          )}`
        )
      }
      maxMemoryBytes = maxMemoryMB * BYTES_PER_MIB
    }

    this.maxMemoryBytes = maxMemoryBytes
    return this.enforce(protectedTrace)
  }

  contentChanged(trace: Trace, protectedTrace: Trace | null): RetentionPass {
    if (this.maxMemoryBytes === null) return { evicted: [], overBudget: false }
    this.updateTraceSize(trace)
    return this.enforce(protectedTrace)
  }

  enforce(protectedTrace: Trace | null): RetentionPass {
    const limit = this.maxMemoryBytes
    if (limit === null) return { evicted: [], overBudget: false }

    const evicted: Trace[] = []
    for (const trace of this.evictionCandidates(protectedTrace)) {
      if (this.retainedBytes() <= limit) break
      this.evict(trace)
      evicted.push(trace)
    }

    return { evicted, overBudget: this.retainedBytes() > limit }
  }

  clear(): void {
    this.traces = []
    this.traceSizeCache = new WeakMap()
  }

  private updateTraceSize(trace: Trace): number {
    const bytes = estimateTraceBytes(trace)
    this.traceSizeCache.set(trace, bytes)
    return bytes
  }

  private traceBytes(trace: Trace): number {
    const cached = this.traceSizeCache.get(trace)
    return cached === undefined ? this.updateTraceSize(trace) : cached
  }

  private retainedBytes(): number {
    let total = 0
    for (const trace of this.traces) total += this.traceBytes(trace)
    return total
  }

  private evictionCandidates(protectedTrace: Trace | null): Trace[] {
    return this.traces
      .map((trace, retainedOrder) => ({ trace, retainedOrder }))
      .filter(({ trace }) => trace.status === 'completed' && trace !== protectedTrace)
      .sort(
        (a, b) => a.trace.startedAt - b.trace.startedAt || a.retainedOrder - b.retainedOrder
      )
      .map(({ trace }) => trace)
  }

  private evict(trace: Trace): void {
    const index = this.traces.indexOf(trace)
    if (index !== -1) this.traces.splice(index, 1)
    this.traceSizeCache.delete(trace)
  }
}
