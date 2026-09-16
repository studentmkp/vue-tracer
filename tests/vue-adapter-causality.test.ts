import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, toRaw } from 'vue'
import { createPinia, defineStore } from 'pinia'
import {
  traceCollector,
  getReactiveMeta,
  queryTraceView,
  uninstallTracing,
  __trace_register,
  __trace_set,
  type ComponentRenderEvent,
  type ComponentTriggerEvent,
  type MutationEvent,
  type Trace
} from '@vue-reactive-trace/runtime'
import {
  createComponentCausalityMixin,
  reactiveTraceVueAdapter,
  type ComponentCausalityRecorder
} from '@vue-reactive-trace/vue-adapter'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const loc = { file: 'src/CartView.vue', line: 3, column: 2 }

function mutationEvent(
  overrides: Partial<MutationEvent> & { id: number; target: unknown }
): MutationEvent {
  return {
    traceId: 1,
    type: 'mutation',
    operation: 'set',
    before: undefined,
    after: undefined,
    source: loc,
    timestamp: 0,
    affectedComponents: [],
    ...overrides
  } as MutationEvent
}

function traceWith(...mutations: MutationEvent[]): Trace {
  return {
    id: 1,
    trigger: { type: 'manual', event: 'test' },
    startedAt: 0,
    events: mutations,
    status: 'active'
  }
}

function createMockRecorder(trace: Trace | null) {
  const triggers: any[] = []
  const renders: any[] = []
  let enabled = true

  const recorder: ComponentCausalityRecorder = {
    isEnabled: () => enabled,
    getCurrentTrace: () => trace,
    recordComponentTrigger: (componentName, file, options) => {
      triggers.push({ componentName, file, ...options })
      return null
    },
    recordComponentRender: (componentName, start, end, file, options) => {
      renders.push({ componentName, start, end, file, ...options })
      return null
    }
  }

  return { recorder, triggers, renders, setEnabled: (value: boolean) => (enabled = value) }
}

function createVm() {
  return { $: { type: { __name: 'CartView', __file: 'src/CartView.vue' } } } as any
}

function mountPiniaApp(options: { adapterFirst?: boolean; storeBeforeAdapter?: boolean } = {}) {
  const rootEl = document.createElement('div')
  document.body.appendChild(rootEl)

  const pinia = createPinia()
  const useCart = defineStore('cart', {
    state: () => ({ count: 0 })
  })

  const CartView = defineComponent({
    name: 'CartView',
    setup() {
      const cart = useCart()
      return () => h('div', { id: 'cart-view' }, `count: ${cart.count}`)
    }
  })

  const app = createApp(CartView)
  let earlyStore: any
  if (options.storeBeforeAdapter) earlyStore = useCart(pinia)

  if (options.adapterFirst) {
    app.use(reactiveTraceVueAdapter)
    app.use(pinia)
  } else {
    app.use(pinia)
    app.use(reactiveTraceVueAdapter)
  }
  app.mount(rootEl)

  return { app, rootEl, pinia, useCart, earlyStore }
}

describe('Vue adapter owns component causality', () => {
  beforeEach(() => {
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    uninstallTracing()
  })

  it('correlates renderTriggered and render duration to the mutation Vue reports', () => {
    const state = reactive({ count: 0 })
    const mutation = mutationEvent({ id: 7, target: state, path: ['count'] })
    const mock = createMockRecorder(traceWith(mutation))
    const mixin = createComponentCausalityMixin(mock.recorder)
    const vm = createVm()

    mixin.renderTriggered.call(vm, { target: toRaw(state), key: 'count' })
    mixin.beforeUpdate.call(vm)
    mixin.updated.call(vm)

    expect(mock.triggers).toEqual([
      { componentName: 'CartView', file: 'src/CartView.vue', triggeredByMutationId: 7 }
    ])
    expect(mock.renders).toHaveLength(1)
    expect(mock.renders[0].componentName).toBe('CartView')
    expect(mock.renders[0].triggeredByMutationId).toBe(7)
    expect(mock.renders[0].start).toBeTypeOf('number')
    expect(mock.renders[0].end).toBeGreaterThanOrEqual(mock.renders[0].start)
  })

  it('attributes collection mutators by target when the path does not name the triggered key', () => {
    const items = reactive([1])
    const mutation = mutationEvent({
      id: 3,
      target: items,
      path: ['cart', 'items'],
      pathMode: 'collection',
      operation: 'push'
    })
    const mock = createMockRecorder(traceWith(mutation))
    const mixin = createComponentCausalityMixin(mock.recorder)

    mixin.renderTriggered.call(createVm(), { target: toRaw(items), key: 'length' })

    expect(mock.triggers[0].triggeredByMutationId).toBe(3)
  })

  it('records no cause when no recorded mutation wrote the triggered dependency', () => {
    const state = reactive({ a: 1, b: 2 })
    const mutation = mutationEvent({ id: 9, target: state, path: ['a'] })
    const mock = createMockRecorder(traceWith(mutation))
    const mixin = createComponentCausalityMixin(mock.recorder)
    const vm = createVm()

    mixin.renderTriggered.call(vm, { target: toRaw(state), key: 'b' })
    mixin.beforeUpdate.call(vm)
    mixin.updated.call(vm)

    expect(mock.triggers[0].triggeredByMutationId).toBeUndefined()
    expect(mock.renders[0].triggeredByMutationId).toBeUndefined()
  })

  it('records nothing while the recorder is disabled', () => {
    const mock = createMockRecorder(traceWith())
    mock.setEnabled(false)
    const mixin = createComponentCausalityMixin(mock.recorder)
    const vm = createVm()

    mixin.renderTriggered.call(vm, { target: {}, key: 'count' })
    mixin.beforeUpdate.call(vm)
    mixin.updated.call(vm)

    expect(mock.triggers).toHaveLength(0)
    expect(mock.renders).toHaveLength(0)
  })

  it('correlates a real component render after the active-mutation window has closed', async () => {
    const rootEl = document.createElement('div')
    document.body.appendChild(rootEl)

    const Counter = defineComponent({
      name: 'Counter',
      setup() {
        const count = __trace_register(reactive({ value: 0 }), {
          name: 'count',
          type: 'reactive',
          scope: 'local'
        })
        return { count }
      },
      render() {
        return h('button', { id: 'counter' }, `Count: ${this.count.value}`)
      }
    })

    const app = createApp(Counter)
    app.use(reactiveTraceVueAdapter)
    app.mount(rootEl)
    await nextTick()

    const count = (app._instance as any).setupState.count as { value: number }
    traceCollector.clearTraces()
    traceCollector.startTrace({ type: 'manual', event: 'adapter-mixin' })
    __trace_set(count, 'value', 1, loc)
    await nextTick()

    // The correlation does not come from the write window being open…
    expect(traceCollector.getActiveMutation()).toBeNull()

    // …yet trigger and render both point at the mutation that caused them.
    const trace = traceCollector.getCurrentTrace()!
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')!
    const trigger = trace.events.find(
      (e): e is ComponentTriggerEvent => e.type === 'component-trigger'
    )!
    const render = trace.events.find((e): e is ComponentRenderEvent => e.type === 'component-render')!
    expect(trigger).toBeDefined()
    expect(render).toBeDefined()
    expect(trigger.triggeredByMutationId).toBe(mutation.id)
    expect(render.triggeredByMutationId).toBe(mutation.id)

    app.unmount()
    rootEl.remove()
  })
})

describe('Vue adapter registers Pinia stores regardless of install order', () => {
  beforeEach(() => {
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    uninstallTracing()
  })

  it('registers stores when pinia installs before the adapter', async () => {
    const { app, rootEl, useCart, earlyStore } = mountPiniaApp({
      adapterFirst: false,
      storeBeforeAdapter: true
    })
    const cart = useCart()

    expect(getReactiveMeta(cart.$state)?.type).toBe('pinia')
    expect(getReactiveMeta(cart.$state)?.name).toBe('cart')
    expect(getReactiveMeta(cart)?.type).toBe('pinia')
    // The store existed before the adapter attached its plugin: retrofit still labels it.
    expect(getReactiveMeta(earlyStore!.$state)?.type).toBe('pinia')

    traceCollector.startTrace({ type: 'manual', event: 'pinia-before' })
    __trace_set(cart.$state, 'count', 1, loc)
    await nextTick()

    const mutation = traceCollector
      .getCurrentTrace()!
      .events.find((e): e is MutationEvent => e.type === 'mutation')!
    expect(mutation.name).toBe('cart')
    expect(mutation.scope).toBe('module')
    expect(mutation.confidence).toBe('exact')
    expect(mutation.isExternal).toBeFalsy()

    app.unmount()
    rootEl.remove()
  })

  it('registers stores when pinia installs after the adapter', async () => {
    const { app, rootEl, useCart, earlyStore } = mountPiniaApp({
      adapterFirst: true,
      storeBeforeAdapter: true
    })
    const cart = useCart()

    expect(getReactiveMeta(cart.$state)?.type).toBe('pinia')
    expect(getReactiveMeta(cart)?.type).toBe('pinia')
    expect(getReactiveMeta(earlyStore!.$state)?.type).toBe('pinia')

    traceCollector.startTrace({ type: 'manual', event: 'late-pinia' })
    __trace_set(cart.$state, 'count', 1, loc)
    await nextTick()

    const trace = traceCollector.getCurrentTrace()!
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')!
    const trigger = trace.events.find(
      (e): e is ComponentTriggerEvent => e.type === 'component-trigger'
    )!
    const render = trace.events.find((e): e is ComponentRenderEvent => e.type === 'component-render')!
    expect(trigger.triggeredByMutationId).toBe(mutation.id)
    expect(render.triggeredByMutationId).toBe(mutation.id)

    app.unmount()
    rootEl.remove()
  })

  it('overlay shows the component-trigger and component-render for a Pinia-backed mutation', async () => {
    const { app, rootEl, useCart } = mountPiniaApp({ adapterFirst: false })
    const cart = useCart()

    traceCollector.clearTraces()
    traceCollector.startTrace({ type: 'manual', event: 'pinia-overlay' })
    __trace_set(cart.$state, 'count', 1, loc)
    await nextTick()

    const trace = traceCollector.getTraces().at(-1)!
    const mutation = trace.events.find((e): e is MutationEvent => e.type === 'mutation')!
    const trigger = trace.events.find(
      (e): e is ComponentTriggerEvent => e.type === 'component-trigger'
    )!
    const render = trace.events.find((e): e is ComponentRenderEvent => e.type === 'component-render')!
    expect(mutation.affectedComponents).toContain('CartView')
    expect(trigger.triggeredByMutationId).toBe(mutation.id)
    expect(render.triggeredByMutationId).toBe(mutation.id)

    const view = queryTraceView(trace)
    expect(view.tracks.mutations).toHaveLength(1)
    expect(view.tracks.triggers).toHaveLength(1)
    expect(view.tracks.renders).toHaveLength(1)

    initDevTools()
    const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
    if (!devtools.querySelector('.vrt-panel')) {
      ;(devtools.querySelector('#vrt-toggle') as HTMLElement).click()
    }
    expect(devtools.querySelector('[data-track="component-trigger"]')).not.toBeNull()
    expect(devtools.querySelectorAll('.vrt-event-bar.render').length).toBeGreaterThanOrEqual(1)

    app.unmount()
    rootEl.remove()
  })
})
