import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  IDLE_COMPLETION_MS,
  PENDING_COMPLETION_MS,
  TraceSession,
  installTracing,
  uninstallTracing,
  traceCollector,
  traceSession,
  __trace_register,
  __trace_set,
  type MutationEvent
} from '@vue-reactive-trace/runtime'

const loc = { file: 'session.ts', line: 3, column: 2 }

describe('TraceSession — completion policy', () => {
  let session: TraceSession

  beforeEach(() => {
    vi.useFakeTimers()
    session = new TraceSession()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('completes once adopted continuations settle', () => {
    const trace = session.begin({ type: 'interaction', event: 'click' })

    session.adopt(trace)
    expect(session.getPendingTasks(trace)).toBe(1)

    vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)
    expect(trace.status).toBe('active')

    session.settle(trace)
    expect(session.getPendingTasks(trace)).toBe(0)
    expect(trace.status).toBe('active')

    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(trace.status).toBe('completed')
    expect(trace.completedAt).toBeTypeOf('number')
  })

  it('retries completion while work is still pending', () => {
    const trace = session.begin({ type: 'manual', event: 'slow-action' })
    session.adopt(trace)

    // The first completion check runs with work in flight: it re-checks, not completes.
    vi.advanceTimersByTime(IDLE_COMPLETION_MS + 1)
    vi.advanceTimersByTime(PENDING_COMPLETION_MS + 1)
    expect(trace.status).toBe('active')

    session.settle(trace)
    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(trace.status).toBe('completed')
  })

  it('stays active until the last of several continuations settles', () => {
    const trace = session.begin({ type: 'interaction', event: 'input' })
    session.adopt(trace)
    session.adopt(trace)
    expect(session.getPendingTasks(trace)).toBe(2)

    session.settle(trace)
    expect(session.getPendingTasks(trace)).toBe(1)
    vi.advanceTimersByTime(PENDING_COMPLETION_MS + 1)
    expect(trace.status).toBe('active')

    session.settle(trace)
    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(trace.status).toBe('completed')
  })

  it('completes an idle trace with no continuations', () => {
    const trace = session.begin({ type: 'manual', event: 'sync' })

    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(trace.status).toBe('completed')
    expect(session.getPendingTasks(trace)).toBe(0)
  })

  it('beginning a new trace completes the previous one', () => {
    const first = session.begin({ type: 'manual', event: 'first' })
    const second = session.begin({ type: 'manual', event: 'second' })

    expect(first.status).toBe('completed')
    expect(second.status).toBe('active')

    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(second.status).toBe('completed')
  })
})

describe('TraceSession — one trace across continuations', () => {
  let state: { n: number }

  beforeEach(() => {
    vi.useFakeTimers()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
    state = __trace_register({ n: 0 }, { name: 'sessionState', type: 'reactive' })
  })

  afterEach(() => {
    uninstallTracing()
    vi.useRealTimers()
  })

  it.each(['promise', 'microtask', 'raf', 'timeout'] as const)(
    'keeps a %s continuation on the interaction trace until it drains',
    (taskType) => {
      const trace = traceCollector.startInteractionTrace('click')

      // A mock continuation: what async-context does for each patched global,
      // without patching Promise.prototype in the test itself.
      traceCollector.adoptAsyncTask(trace, taskType)
      expect(traceSession.getPendingTasks(trace)).toBe(1)

      // Continuation body: the write still lands on the same trace.
      __trace_set(state, 'n', 1, loc)

      traceCollector.settleAsyncTask(trace)

      const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')
      expect(mutation).toBeDefined()
      expect(mutation!.after).toBe(1)
      expect(mutation!.traceId).toBe(trace.id)
      expect(trace.events.some((e) => e.type === 'async' && e.taskType === taskType)).toBe(true)
      expect(traceSession.getPendingTasks(trace)).toBe(0)

      vi.advanceTimersByTime(IDLE_COMPLETION_MS)
      expect(trace.status).toBe('completed')
    }
  )
})

describe('TraceSession — installed runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    uninstallTracing()
    vi.useRealTimers()
  })

  it('does not adopt its own completion timer as pending async work', () => {
    installTracing({ interactions: false })

    const trace = traceCollector.startTrace({ type: 'manual', event: 'sync-work' })
    expect(trace.events.filter((e) => e.type === 'async')).toHaveLength(0)
    expect(traceSession.getPendingTasks(trace)).toBe(0)

    vi.advanceTimersByTime(IDLE_COMPLETION_MS)

    expect(trace.status).toBe('completed')
    expect(trace.events.filter((e) => e.type === 'async')).toHaveLength(0)
    expect(traceSession.getPendingTasks(trace)).toBe(0)
  })

  it.each(['click', 'input'] as const)(
    'keeps a %s → short-timeout continuation → mutation on one trace and completes after it drains',
    (eventName) => {
      installTracing()

      const count = __trace_register({ value: 0 }, { name: 'count', type: 'reactive' })
      const el = document.createElement(eventName === 'click' ? 'button' : 'input')
      el.textContent = 'Add'
      document.body.appendChild(el)
      el.addEventListener(eventName, () => {
        setTimeout(() => __trace_set(count, 'value', 1, loc), 5)
      })

      if (eventName === 'click') {
        el.click()
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }

      const traces = traceCollector.getTraces()
      const trace = traces[traces.length - 1]
      expect(trace.trigger.type).toBe('interaction')
      expect(trace.trigger.event).toBe(eventName)
      expect(traceSession.getPendingTasks(trace)).toBe(1)

      vi.advanceTimersByTime(5)

      const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')
      expect(mutation).toBeDefined()
      expect(mutation!.after).toBe(1)
      expect(traceSession.getPendingTasks(trace)).toBe(0)

      vi.advanceTimersByTime(IDLE_COMPLETION_MS)
      expect(trace.status).toBe('completed')

      el.remove()
    }
  )
})
