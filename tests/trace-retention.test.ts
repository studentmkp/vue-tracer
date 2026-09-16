import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import {
  IDLE_COMPLETION_MS,
  __trace_register,
  __trace_set,
  installAsyncTracking,
  traceCollector,
  traceSession,
  uninstallTracing,
  type MutationEvent,
  type Trace,
  type TraceExportData
} from '@vue-reactive-trace/runtime'
import { buildConfigureCall, transformCode } from '@vue-reactive-trace/vite'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const source = { file: 'src/retention.ts', line: 1, column: 0 }
const MIB = 1024 * 1024

/** Export-safe compact JSON size of a Trace, mirroring the documented policy. */
function compactTraceBytes(trace: Trace): number {
  return new TextEncoder().encode(JSON.stringify(trace)).length
}

/** Fresh policy, empty retained set, recording on. */
function resetCollector(): void {
  traceCollector.configureRecording()
  traceCollector.clearTraces()
  traceCollector.setEnabled(true)
}

/** One completed Trace whose mutation payload dominates its retained size. */
function recordCompletedTrace(label: string, payload: string): Trace {
  const trace = traceCollector.startTrace({ type: 'manual', event: label })
  expect(trace).not.toBeNull()
  traceCollector.recordMutation({
    name: label,
    operation: 'set',
    before: payload,
    after: `${payload}!`,
    source
  })
  vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)
  expect(trace!.status).toBe('completed')
  return trace!
}

/**
 * Starts an empty Trace, sizes a budget that fits it but not one 200-char event,
 * then records that event so the current Trace alone overflows (auto-pause).
 */
function overflowCurrentTrace(label: string): Trace {
  const trace = traceCollector.startTrace({ type: 'manual', event: label })
  expect(trace).not.toBeNull()
  traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(trace!) * 2) / MIB })
  expect(traceCollector.isEnabled()).toBe(true)

  traceCollector.recordMutation({
    name: `${label}-write`,
    operation: 'set',
    before: 'x'.repeat(200),
    after: 'y'.repeat(200),
    source
  })

  expect(traceCollector.isEnabled()).toBe(false)
  return trace!
}

/** A hand-built completed Trace for import fixtures. */
function mutationTrace(id: number, startedAt: number, payload: string): Trace {
  return {
    id,
    trigger: { type: 'manual', event: `imported-${id}` },
    startedAt,
    completedAt: startedAt + 1,
    events: [
      {
        id: id * 10,
        traceId: id,
        type: 'mutation',
        name: `mutation-${id}`,
        operation: 'set',
        before: payload,
        after: `${payload}!`,
        source,
        timestamp: startedAt,
        affectedComponents: []
      }
    ],
    status: 'completed'
  }
}

function exportBundle(...traces: Trace[]): TraceExportData {
  return {
    version: '0.2',
    exportedAt: 0,
    summary: {
      tracesCount: traces.length,
      totalEventsCount: traces.reduce((count, trace) => count + trace.events.length, 0),
      mutationsCount: traces.length,
      rendersCount: 0
    },
    traces
  }
}

function retainedIds(): number[] {
  return traceCollector.getTraces().map((trace) => trace.id)
}

describe('bounded trace retention — budget and eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    uninstallTracing()
    resetCollector()
  })

  afterEach(() => {
    resetCollector()
    uninstallTracing()
    vi.useRealTimers()
  })

  it('retains every Trace when no budget is configured', () => {
    const ids = [
      recordCompletedTrace('unbounded-1', 'x'.repeat(500)).id,
      recordCompletedTrace('unbounded-2', 'x'.repeat(500)).id,
      recordCompletedTrace('unbounded-3', 'x'.repeat(500)).id,
      recordCompletedTrace('unbounded-4', 'x'.repeat(500)).id
    ]

    expect(retainedIds()).toEqual(ids)
    expect(traceCollector.exportTraces().traces.map((trace) => trace.id)).toEqual(ids)
  })

  it('enforces fractional MiB budgets with fixed-size ASCII payloads', () => {
    const ascii = 'x'.repeat(400)
    const first = recordCompletedTrace('ascii-probe', ascii)
    const perTrace = compactTraceBytes(first)

    // Fits the completed Trace on its own, not two of them.
    traceCollector.configureRecording({ maxMemoryMB: (perTrace * 1.5) / MIB })

    const second = recordCompletedTrace('ascii-second', ascii)

    expect(retainedIds()).toEqual([second.id])
  })

  it('sizes retained payloads by UTF-8 bytes, not UTF-16 code units', () => {
    const emoji = '😀'.repeat(200)
    const first = recordCompletedTrace('utf8-probe', emoji)

    const utf8Bytes = compactTraceBytes(first)
    const codeUnits = JSON.stringify(first).length
    expect(codeUnits).toBeLessThan(utf8Bytes)

    // Between "two traces as UTF-8" (over) and "two traces as code units" (under).
    traceCollector.configureRecording({ maxMemoryMB: (utf8Bytes * 1.5) / MIB })

    const second = recordCompletedTrace('utf8-second', emoji)

    expect(retainedIds()).toEqual([second.id])
  })

  it('evicts completed Traces oldest-first and never the active current Trace', () => {
    const payload = 'x'.repeat(4000)
    const first = recordCompletedTrace('oldest', payload)
    const perTrace = compactTraceBytes(first)

    // Room for roughly two payload Traces.
    traceCollector.configureRecording({ maxMemoryMB: (perTrace * 2.5) / MIB })

    const second = recordCompletedTrace('middle', payload)
    const third = recordCompletedTrace('newer', payload)
    expect(retainedIds()).toEqual([second.id, third.id])

    const active = traceCollector.startTrace({ type: 'manual', event: 'active' })
    expect(active).not.toBeNull()
    const activePayload = 'y'.repeat(4000)
    traceCollector.recordMutation({
      name: 'active-write',
      operation: 'set',
      before: activePayload,
      after: `${activePayload}!`,
      source
    })

    // The active Trace forced the oldest completed Trace out; it stays complete.
    expect(retainedIds()).toEqual([third.id, active!.id])
    const mutation = active!.events.find((e): e is MutationEvent => e.type === 'mutation')!
    expect(mutation.before).toBe(activePayload)
    expect(mutation.after).toBe(`${activePayload}!`)
    expect(active!.status).toBe('active')
  })

  it('keeps an oversized current Trace whole and auto-pauses recording', () => {
    const trace = overflowCurrentTrace('oversize')
    const payload = 'x'.repeat(200)
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')!

    expect(mutation).toBeDefined()
    expect(retainedIds()).toEqual([trace.id])
    expect(trace.events).toHaveLength(1)
    expect(mutation.before).toBe(payload)
    expect(mutation.after).toBe('y'.repeat(200))
    expect(traceCollector.isEnabled()).toBe(false)

    // The application write still lands; nothing new is retained.
    const state = __trace_register(reactive({ n: 0 }), { name: 'state', type: 'reactive' })
    __trace_set(state, 'n', 1, source)
    expect(state.n).toBe(1)
    expect(trace.events).toHaveLength(1)
    expect(
      traceCollector.recordMutation({ name: 'blocked', operation: 'set', before: 0, after: 1, source })
    ).toBeNull()

    // No new async adoption after the auto-pause.
    expect(traceCollector.adoptAsyncTask(trace, 'promise')).toBeNull()
    expect(traceSession.getPendingTasks(trace)).toBe(0)
    expect(traceCollector.recordAsyncTask('promise')).toBeNull()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid maxMemoryMB (%s) with RangeError',
    (invalid) => {
      expect(() => traceCollector.configureRecording({ maxMemoryMB: invalid })).toThrow(RangeError)
    }
  )

  it('rejects non-number maxMemoryMB values without changing the active policy', () => {
    traceCollector.configureRecording({ maxMemoryMB: 0.00005 })
    expect(() =>
      traceCollector.configureRecording({ maxMemoryMB: '50' as unknown as number })
    ).toThrow(RangeError)
    expect(() =>
      traceCollector.configureRecording({ maxMemoryMB: null as unknown as number })
    ).toThrow(RangeError)

    // The earlier budget is still in force.
    const trace = traceCollector.startTrace({ type: 'manual', event: 'still-bounded' })
    traceCollector.recordMutation({
      name: 'big',
      operation: 'set',
      before: 'x'.repeat(200),
      after: 'x'.repeat(200),
      source
    })
    expect(traceCollector.isEnabled()).toBe(false)
    expect(retainedIds()).toEqual([trace!.id])
  })

  it('finalizes the complete event when the instrumented write itself causes the overflow', () => {
    const state = __trace_register(reactive({ big: '' }), { name: 'state', type: 'reactive' })
    const trace = traceCollector.startTrace({ type: 'manual', event: 'write-overflow' })!
    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(trace) * 2) / MIB })
    expect(traceCollector.isEnabled()).toBe(true)

    __trace_set(state, 'big', 'x'.repeat(200), source)

    // The application write still lands, and the mutation keeps its `after`
    // snapshot even though recording auto-paused while finalizing it.
    expect(state.big).toBe('x'.repeat(200))
    expect(traceCollector.isEnabled()).toBe(false)
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')!
    expect(mutation).toBeDefined()
    expect(mutation.before).toBe('')
    expect(mutation.after).toBe('x'.repeat(200))
  })

  it('releases live mutation target references on completion', () => {
    const liveTarget = reactive({ n: 1 })
    const trace = traceCollector.startTrace({ type: 'manual', event: 'live-ref' })
    traceCollector.recordMutation({
      name: 'live',
      operation: 'set',
      before: 1,
      after: 2,
      source,
      target: liveTarget
    })
    const mutation = trace!.events.find((e): e is MutationEvent => e.type === 'mutation')!
    expect(mutation.target).toBe(liveTarget)

    vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)

    expect(trace!.status).toBe('completed')
    expect(mutation.target).toBeUndefined()
  })

  it('drops causality that pointed into an evicted Trace', () => {
    const first = recordCompletedTrace('cause-first', 'x'.repeat(300))
    const evictedMutation = first.events.find((e): e is MutationEvent => e.type === 'mutation')!
    const second = recordCompletedTrace('cause-second', 'x'.repeat(300))
    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(second) * 1.2) / MIB })
    expect(retainedIds()).toEqual([second.id])

    const trigger = traceCollector.recordComponentTrigger('Counter', 'Counter.vue', {
      triggeredByMutationId: evictedMutation.id
    })

    expect(trigger).not.toBeNull()
    expect(trigger!.triggeredByMutationId).toBeUndefined()
  })
})

describe('bounded trace retention — lifecycle operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    uninstallTracing()
    resetCollector()
  })

  afterEach(() => {
    resetCollector()
    uninstallTracing()
    vi.useRealTimers()
  })

  it('setEnabled(false) stops recording without touching retained data', () => {
    const first = recordCompletedTrace('keep-1', 'x'.repeat(50))
    const second = recordCompletedTrace('keep-2', 'x'.repeat(50))
    const exportedBefore = traceCollector.exportTraces().traces.map((trace) => trace.id)

    traceCollector.setEnabled(false)

    expect(retainedIds()).toEqual([first.id, second.id])
    expect(traceCollector.exportTraces().traces.map((trace) => trace.id)).toEqual(exportedBefore)

    expect(traceCollector.startTrace({ type: 'manual', event: 'blocked' })).toBeNull()
    expect(
      traceCollector.recordMutation({ name: 'blocked', operation: 'set', before: 0, after: 1, source })
    ).toBeNull()
    expect(traceCollector.recordComputedInvalidated({ name: 'blocked' })).toBeNull()
    expect(traceCollector.recordWatchExecuted({ name: 'blocked' })).toBeNull()
    expect(traceCollector.recordComponentTrigger('Blocked')).toBeNull()
    expect(traceCollector.recordComponentRender('Blocked', 1, 2)).toBeNull()
    expect(traceCollector.recordAsyncTask('promise')).toBeNull()

    expect(retainedIds()).toEqual([first.id, second.id])
  })

  it('notifies subscribers on clear even when no current Trace remains', () => {
    const seen: Array<number | null> = []
    const unsubscribe = traceCollector.subscribe((trace) => seen.push(trace ? trace.id : null))

    recordCompletedTrace('notify-probe', 'x'.repeat(20))
    traceCollector.clearTraces()
    unsubscribe()

    expect(seen).toContain(null)
  })

  it('lets work adopted before a manual pause settle and complete', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'adopted' })!
    traceCollector.adoptAsyncTask(trace, 'promise')
    expect(traceSession.getPendingTasks(trace)).toBe(1)

    traceCollector.setEnabled(false)
    traceCollector.settleAsyncTask(trace)
    expect(traceSession.getPendingTasks(trace)).toBe(0)

    vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)
    expect(trace.status).toBe('completed')
  })

  it('does not adopt async work scheduled while recording is disabled', async () => {
    installAsyncTracking()
    const trace = traceCollector.startTrace({ type: 'manual', event: 'disabled-async' })!
    traceCollector.setEnabled(false)

    await Promise.resolve().then(() => undefined)

    expect(traceSession.getPendingTasks(trace)).toBe(0)
    expect(trace.events.some((event) => event.type === 'async')).toBe(false)
  })

  it('resumes by evicting a completed oversized current Trace', () => {
    const trace = overflowCurrentTrace('oversized')

    vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)
    expect(trace.status).toBe('completed')

    traceCollector.setEnabled(true)

    expect(traceCollector.isEnabled()).toBe(true)
    expect(retainedIds()).toEqual([])
    expect(traceCollector.getCurrentTrace()).toBeNull()
  })

  it('stays paused while an active current Trace alone exceeds the budget', () => {
    const trace = overflowCurrentTrace('active-oversized')

    traceCollector.setEnabled(true)

    expect(traceCollector.isEnabled()).toBe(false)
    expect(retainedIds()).toEqual([trace.id])
    expect(trace.events).toHaveLength(1)
  })

  it('clearTraces empties retained state but keeps the budget and the pause flag', () => {
    overflowCurrentTrace('clear-me')

    traceCollector.clearTraces()

    expect(traceCollector.getTraces()).toEqual([])
    expect(traceCollector.getCurrentTrace()).toBeNull()
    expect(traceCollector.isEnabled()).toBe(false)
    expect(traceCollector.exportTraces().traces).toEqual([])

    traceCollector.setEnabled(true)
    const next = traceCollector.startTrace({ type: 'manual', event: 'after-clear' })!
    traceCollector.recordMutation({
      name: 'big-again',
      operation: 'set',
      before: 'x'.repeat(200),
      after: 'y'.repeat(200),
      source
    })

    expect(traceCollector.isEnabled()).toBe(false)
    expect(retainedIds()).toEqual([next.id])
    expect(next.events).toHaveLength(1)
  })

  it('clearTraces keeps the event allow-list', () => {
    traceCollector.configureRecording({ events: ['mutation'] })
    traceCollector.clearTraces()

    const trace = traceCollector.startTrace({ type: 'manual', event: 'after-clear' })!
    traceCollector.recordComputedInvalidated({ name: 'dropped' })
    traceCollector.recordMutation({ name: 'kept', operation: 'set', before: 0, after: 1, source })

    expect(trace.events.map((event) => event.type)).toEqual(['mutation'])
  })

  it('imports deduplicate by id and normalize active Traces to completed snapshots', () => {
    const imported: TraceExportData = {
      version: '0.2',
      exportedAt: 0,
      summary: { tracesCount: 2, totalEventsCount: 0, mutationsCount: 0, rendersCount: 0 },
      traces: [
        {
          id: 9001,
          trigger: { type: 'manual', event: 'imported-active' },
          startedAt: 1,
          events: [],
          status: 'active'
        },
        {
          id: 9002,
          trigger: { type: 'manual', event: 'imported-completed' },
          startedAt: 2,
          completedAt: 3,
          events: [],
          status: 'completed'
        }
      ]
    }

    traceCollector.importTraces(JSON.stringify(imported))

    expect(retainedIds()).toEqual([9001, 9002])
    expect(traceCollector.getTraces()[0].status).toBe('completed')
    expect(traceCollector.getCurrentTrace()?.id).toBe(9002)

    // Re-importing the same bundle inserts nothing.
    traceCollector.importTraces(JSON.stringify(imported))
    expect(retainedIds()).toEqual([9001, 9002])
  })

  it('enforces the budget on import, evicting completed Traces oldest-first', () => {
    const payload = 'x'.repeat(400)
    const first = mutationTrace(9101, 1, payload)
    const second = mutationTrace(9102, 2, payload)
    const third = mutationTrace(9103, 3, payload)

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(first) * 1.5) / MIB })
    traceCollector.importTraces(exportBundle(first, second, third))

    expect(retainedIds()).toEqual([third.id])
    expect(traceCollector.getCurrentTrace()?.id).toBe(third.id)
    expect(traceCollector.isEnabled()).toBe(true)
  })

  it('auto-pauses when the protected imported selection alone exceeds the budget', () => {
    const payload = 'x'.repeat(400)
    const first = mutationTrace(9201, 1, payload)
    const second = mutationTrace(9202, 2, payload)

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(first) / 2) / MIB })
    traceCollector.importTraces(exportBundle(first, second))

    expect(retainedIds()).toEqual([second.id])
    expect(traceCollector.isEnabled()).toBe(false)
  })

  it('does not replace or evict a local active Trace when importing', () => {
    const local = traceCollector.startTrace({ type: 'manual', event: 'local-active' })!
    traceCollector.recordMutation({ name: 'local', operation: 'set', before: 0, after: 1, source })

    const payload = 'x'.repeat(400)
    const first = mutationTrace(9301, 1, payload)
    const second = mutationTrace(9302, 2, payload)

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(first) * 3) / MIB })
    traceCollector.importTraces(exportBundle(first, second))

    expect(traceCollector.getCurrentTrace()?.id).toBe(local.id)
    expect(retainedIds()).toContain(local.id)
    expect(retainedIds()).toEqual([local.id, first.id, second.id])
  })

  it('accepts an import while recording is disabled', () => {
    traceCollector.setEnabled(false)
    const imported = mutationTrace(9401, 1, 'x'.repeat(20))

    traceCollector.importTraces(exportBundle(imported))

    expect(retainedIds()).toEqual([imported.id])
    expect(traceCollector.isEnabled()).toBe(false)
  })
})

describe('bounded trace retention — overlay and export consistency', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    uninstallTracing()
    resetCollector()
  })

  afterEach(() => {
    resetCollector()
    uninstallTracing()
    vi.useRealTimers()
  })

  function mountOverlay(): HTMLElement {
    initDevTools()
    const devtools = document.getElementById('__vue_reactive_trace_devtools__')
    expect(devtools).not.toBeNull()
    if (!devtools!.querySelector('.vrt-panel')) {
      ;(devtools!.querySelector('#vrt-toggle') as HTMLElement).click()
    }
    return devtools!
  }

  it('reports the same ids from getTraces and exportTraces after eviction', () => {
    const first = recordCompletedTrace('sync-first', 'x'.repeat(300))
    const second = recordCompletedTrace('sync-second', 'x'.repeat(300))

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(second) * 1.2) / MIB })

    expect(retainedIds()).toEqual([second.id])
    expect(traceCollector.exportTraces().traces.map((trace) => trace.id)).toEqual(retainedIds())
    expect(traceCollector.getTraces().some((trace) => trace.id === first.id)).toBe(false)
  })

  it('does not resurrect an evicted Trace through exportTrace(id)', () => {
    const first = recordCompletedTrace('gone-first', 'x'.repeat(300))
    const second = recordCompletedTrace('gone-second', 'x'.repeat(300))

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(second) * 1.2) / MIB })

    expect(traceCollector.exportTrace(first.id).traces).toEqual([])
    expect(traceCollector.exportTrace(second.id).traces.map((trace) => trace.id)).toEqual([second.id])
  })

  it('falls back to the latest retained Trace when the selected Trace is evicted', () => {
    const devtools = mountOverlay()
    const first = recordCompletedTrace('ui-first', 'x'.repeat(200))
    const second = recordCompletedTrace('ui-second', 'x'.repeat(200))

    const firstItem = devtools.querySelector(
      `.vrt-sidebar-item[data-id="${first.id}"]`
    ) as HTMLElement
    expect(firstItem).not.toBeNull()
    firstItem.click()
    expect(devtools.querySelector('.vrt-sidebar-item.active')?.getAttribute('data-id')).toBe(
      String(first.id)
    )

    traceCollector.configureRecording({ maxMemoryMB: (compactTraceBytes(second) * 1.2) / MIB })

    expect(retainedIds()).toEqual([second.id])
    expect(devtools.querySelector(`.vrt-sidebar-item[data-id="${first.id}"]`)).toBeNull()
    expect(devtools.querySelector('.vrt-sidebar-item.active')?.getAttribute('data-id')).toBe(
      String(second.id)
    )
    expect(devtools.querySelector('#vrt-toggle')!.textContent).toContain('(1)')
  })

  it('shows the disabled recording state immediately after an overflow auto-pause', () => {
    const devtools = mountOverlay()

    const trace = overflowCurrentTrace('ui-oversize')

    expect(traceCollector.isEnabled()).toBe(false)
    expect(trace.status).toBe('active')
    expect(trace.events).toHaveLength(1)
    expect((devtools.querySelector('#vrt-toggle-rec') as HTMLElement).textContent).toBe('Record')
    expect(devtools.querySelector('#vrt-toggle')!.innerHTML).toContain('#f43f5e')
  })
})

describe('bounded trace retention — plugin config injection', () => {
  it('emits one configureRecording call carrying events and maxMemoryMB, with redaction separate', () => {
    const call = buildConfigureCall({
      events: ['mutation'],
      maxMemoryMB: 25,
      redact: ['**.token']
    })

    expect(call.match(/configureRecording\(/g)).toHaveLength(1)
    expect(call).toContain('traceCollector.configureRecording({ events: ["mutation"], maxMemoryMB: 25 });')
    expect(call).toContain('__trace_configure({ redact: ["**.token"] });')
  })

  it('emits the collector call when only maxMemoryMB is set', () => {
    const call = buildConfigureCall({ maxMemoryMB: 10 })

    expect(call).toContain('traceCollector.configureRecording({ maxMemoryMB: 10 });')
    expect(call).not.toContain('__trace_configure')
  })

  it('injects collector config into transformed modules that only set maxMemoryMB', () => {
    const result = transformCode('const count = ref(0)\n', '/src/App.ts', {
      root: '/src',
      maxMemoryMB: 10
    })

    expect(result).not.toBeNull()
    expect(result!.code).toContain('traceCollector')
    expect(result!.code).toContain('configureRecording({ maxMemoryMB: 10 })')
    expect(result!.code).not.toContain('__trace_configure')
  })

  it('re-applying the same recording config is idempotent', () => {
    vi.useFakeTimers()
    uninstallTracing()
    resetCollector()

    try {
      const first = recordCompletedTrace('idempotent-1', 'x'.repeat(100))
      const second = recordCompletedTrace('idempotent-2', 'x'.repeat(100))
      const before = retainedIds()

      traceCollector.configureRecording({ events: ['mutation'], maxMemoryMB: 25 })
      traceCollector.configureRecording({ events: ['mutation'], maxMemoryMB: 25 })

      expect(retainedIds()).toEqual(before)
      expect(before).toEqual([first.id, second.id])
      expect(traceCollector.isEnabled()).toBe(true)
    } finally {
      resetCollector()
      uninstallTracing()
      vi.useRealTimers()
    }
  })
})
