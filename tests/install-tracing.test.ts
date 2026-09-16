import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import {
  traceCollector,
  __trace_register,
  __trace_set,
  installTracing,
  uninstallTracing,
  installAsyncTracking,
  uninstallAsyncTracking,
  isAsyncTrackingInstalled,
  isInteractionCaptureInstalled,
  type MutationEvent
} from '@vue-reactive-trace/runtime'
import { reactiveTraceVueAdapter } from '@vue-reactive-trace/vue-adapter'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const loc = { file: 'auth.ts', line: 4, column: 2 }

function snapshotGlobals() {
  return {
    then: Promise.prototype.then,
    setTimeout: globalThis.setTimeout,
    queueMicrotask: globalThis.queueMicrotask,
    raf: globalThis.requestAnimationFrame
  }
}

function restoreGlobals(snap: ReturnType<typeof snapshotGlobals>) {
  Promise.prototype.then = snap.then
  globalThis.setTimeout = snap.setTimeout
  globalThis.queueMicrotask = snap.queueMicrotask
  globalThis.requestAnimationFrame = snap.raf
}

describe('§3 — importing the runtime installs nothing', () => {
  let pristine: ReturnType<typeof snapshotGlobals>

  beforeEach(() => {
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
    pristine = snapshotGlobals()
  })

  afterEach(() => {
    uninstallTracing()
    restoreGlobals(pristine)
  })

  it('leaves Promise/timers patched and document listeners attached by nobody', () => {
    expect(isAsyncTrackingInstalled()).toBe(false)
    expect(isInteractionCaptureInstalled()).toBe(false)
  })

  it('a fresh import touches no globals and captures no interaction', async () => {
    vi.resetModules()
    const fresh: typeof import('@vue-reactive-trace/runtime') =
      await import('@vue-reactive-trace/runtime')

    // A fresh module import must not patch the host.
    expect(Promise.prototype.then).toBe(pristine.then)
    expect(globalThis.setTimeout).toBe(pristine.setTimeout)
    expect(globalThis.queueMicrotask).toBe(pristine.queueMicrotask)
    expect(globalThis.requestAnimationFrame).toBe(pristine.raf)
    expect(fresh.isAsyncTrackingInstalled()).toBe(false)
    expect(fresh.isInteractionCaptureInstalled()).toBe(false)

    // Behaviourally: a click on a fresh import starts no Trace.
    const btn = document.createElement('button')
    btn.textContent = 'fresh'
    document.body.appendChild(btn)
    btn.click()
    expect(fresh.traceCollector.getTraces()).toHaveLength(0)
    btn.remove()
  })

  it('a fresh import does not adopt timer continuations into a Trace', async () => {
    vi.resetModules()
    const fresh: typeof import('@vue-reactive-trace/runtime') =
      await import('@vue-reactive-trace/runtime')
    const { ref } = await import('vue')

    const count = fresh.__trace_register(ref(0), { name: 'count', type: 'ref' })
    const trace = fresh.traceCollector.startTrace({ type: 'manual', event: 'unpatched' })

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        fresh.__trace_set(count, 'value', 1, loc)
        resolve()
      }, 5)
    })

    // Unpatched timers are invisible to tracing: no async task, no pending work.
    expect(trace.events.some((e) => e.type === 'async')).toBe(false)
    expect(trace.pendingTasks ?? 0).toBe(0)
    restoreGlobals(pristine)
  })

  it('tests that do not need DOM tracing run without patches', () => {
    // A plain collection session works with no install at all.
    const state = __trace_register({ n: 0 }, { name: 'state', type: 'reactive' })
    traceCollector.startTrace({ type: 'manual', event: 'no-install' })
    __trace_set(state, 'n', 1, loc)

    const mutation = traceCollector
      .getCurrentTrace()!
      .events.find((e): e is MutationEvent => e.type === 'mutation')
    expect(mutation).toBeDefined()
    expect(mutation!.after).toBe(1)
    expect(isAsyncTrackingInstalled()).toBe(false)
  })
})

describe('§3 — explicit install / uninstall', () => {
  beforeEach(() => {
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    uninstallTracing()
  })

  it('installTracing patches globals and attach listeners; uninstall restores them', () => {
    const before = snapshotGlobals()

    installTracing()
    expect(isAsyncTrackingInstalled()).toBe(true)
    expect(isInteractionCaptureInstalled()).toBe(true)
    expect(Promise.prototype.then).not.toBe(before.then)
    expect(globalThis.setTimeout).not.toBe(before.setTimeout)

    uninstallTracing()
    expect(isAsyncTrackingInstalled()).toBe(false)
    expect(isInteractionCaptureInstalled()).toBe(false)
    expect(Promise.prototype.then).toBe(before.then)
    expect(globalThis.setTimeout).toBe(before.setTimeout)
  })

  it('installs selectively: interactions off leaves the DOM alone', () => {
    installTracing({ interactions: false })
    expect(isInteractionCaptureInstalled()).toBe(false)
    expect(isAsyncTrackingInstalled()).toBe(true)

    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.click()
    expect(traceCollector.getTraces()).toHaveLength(0)
    btn.remove()
  })

  it('installs selectively: async off leaves Promise/timers alone', () => {
    const before = snapshotGlobals()
    installTracing({ async: false })

    expect(isAsyncTrackingInstalled()).toBe(false)
    expect(Promise.prototype.then).toBe(before.then)
    expect(globalThis.setTimeout).toBe(before.setTimeout)
    expect(isInteractionCaptureInstalled()).toBe(true)
  })

  it('is idempotent', () => {
    installTracing()
    const once = snapshotGlobals().then
    installTracing()
    expect(snapshotGlobals().then).toBe(once)

    uninstallTracing()
    expect(Promise.prototype.then).not.toBe(once)
  })

  it('captures interaction Traces once installed and drops them once uninstalled', () => {
    installTracing({ async: false })

    const btn = document.createElement('button')
    btn.textContent = 'Add'
    document.body.appendChild(btn)
    btn.click()

    const traces = traceCollector.getTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0].trigger.type).toBe('interaction')
    expect(traces[0].trigger.event).toBe('click')
    expect(traces[0].trigger.targetTag).toBe('button')

    uninstallTracing({ async: false })
    traceCollector.clearTraces()
    btn.click()
    expect(traceCollector.getTraces()).toHaveLength(0)
    btn.remove()
  })

  it('propagates a trace across a timer only after async install', async () => {
    const state = __trace_register({ n: 0 }, { name: 'state', type: 'reactive' })

    installAsyncTracking()
    const trace = traceCollector.startTrace({ type: 'manual', event: 'timer' })

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        __trace_set(state, 'n', 7, loc)
        resolve()
      }, 5)
    })

    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')
    expect(mutation).toBeDefined()
    expect(mutation!.after).toBe(7)
    expect(trace.events.some((e) => e.type === 'async' && e.taskType === 'timeout')).toBe(true)

    uninstallAsyncTracking()
  })
})

describe('§3 — the Vue adapter is one install path', () => {
  beforeEach(() => {
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    uninstallTracing()
  })

  it('app.use(reactiveTraceVueAdapter) installs tracing', () => {
    expect(isAsyncTrackingInstalled()).toBe(false)
    expect(isInteractionCaptureInstalled()).toBe(false)

    const app = createApp({ render: () => h('div') })
    app.use(reactiveTraceVueAdapter)

    expect(isAsyncTrackingInstalled()).toBe(true)
    expect(isInteractionCaptureInstalled()).toBe(true)
  })

  it('playground wiring (adapter + overlay init) still records click and propagates async context', async () => {
    // Mirrors playground/src/main.ts
    const rootEl = document.createElement('div')
    document.body.appendChild(rootEl)

    const btnId = 'trace-action-btn'
    const Counter = defineComponent({
      name: 'App',
      setup() {
        const count = __trace_register({ value: 0 }, { name: 'count', type: 'ref' })
        function add() {
          // An interaction that continues past a timer, like a real async action.
          setTimeout(() => __trace_set(count, 'value', count.value + 1, loc), 5)
        }
        return () => h('button', { id: btnId, onClick: add }, 'Add')
      }
    })

    const app = createApp(Counter)
    app.use(reactiveTraceVueAdapter)
    app.mount(rootEl)
    await nextTick()
    initDevTools()

    traceCollector.clearTraces()

    const btn = rootEl.querySelector(`#${btnId}`) as HTMLButtonElement
    btn.click()
    await new Promise((resolve) => setTimeout(resolve, 40))

    const traces = traceCollector.getTraces()
    expect(traces.length).toBeGreaterThanOrEqual(1)
    const trace = traces[traces.length - 1]

    // Interaction started the trace…
    expect(trace.trigger.type).toBe('interaction')
    expect(trace.trigger.event).toBe('click')
    // …and the timer continuation landed on that same trace.
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')
    expect(mutation).toBeDefined()
    expect(mutation!.after).toBe(1)

    app.unmount()
    rootEl.remove()
  })
})
