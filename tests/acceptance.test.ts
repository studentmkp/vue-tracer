import { resolve } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, ref, reactive, computed, watch, watchEffect, nextTick, defineComponent, h } from 'vue'
import { createPinia, defineStore } from 'pinia'
import {
  traceCollector,
  aggregateTraceEvents,
  filterTraceEvents,
  installInteractionCapture,
  uninstallInteractionCapture,
  registerExternalReactive,
  installAsyncTracking,
  uninstallAsyncTracking,
  __trace_register,
  __trace_register_computed,
  __trace_set,
  __trace_update,
  __trace_call,
  __trace_delete,
  __trace_watch_cb,
  type MutationEvent,
  type ComputedEvent,
  type ComponentRenderEvent,
  type InteractionEvent,
  type WatchEvent,
  type AsyncTaskEvent,
  type AggregatedMutationGroup,
  type TraceExportData
} from '@vue-reactive-trace/runtime'
import { reactiveTraceVueAdapter, reactiveTracePiniaPlugin } from '@vue-reactive-trace/vue-adapter'
import { transformCode, openInEditor, handleOpenSourceEndpoint } from '@vue-reactive-trace/vite'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

describe('MVP 0 Acceptance Tests', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  describe('AST Transformation', () => {
    it('instruments ref, reactive, update expressions, and assignments with exact source locations', () => {
      const source = `
const count = ref(0)
function add() {
  count.value++
}
`
      const result = transformCode(source, '/src/App.vue?vue&type=script&lang.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      // Check declaration registration
      expect(code).toContain('__trace_register(ref(0)')
      expect(code).not.toContain('__trace_register_external')
      expect(code).toContain("name: 'count'")
      expect(code).toContain("type: 'ref'")
      expect(code).toContain("file: 'App.vue'")
      expect(code).toContain('line: 2')

      // Check UpdateExpression instrumentation
      expect(code).toContain('__trace_update(count, \'value\', \'++\', false')
      expect(code).toContain("file: 'App.vue'")
      expect(code).toContain('line: 4')
    })

    it('instruments nested reactive assignments', () => {
      const source = `
const state = reactive({ profile: { name: 'A' } })
state.profile.name = 'B'
`
      const result = transformCode(source, '/src/user.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain('__trace_register(reactive({ profile: { name: \'A\' } })')
      expect(code).toContain("__trace_set(state.profile, 'name', () => (state.profile.name = 'B')")
      expect(code).toContain("file: 'user.ts'")
      expect(code).toContain('line: 3')
    })

    it('identifies module-level global reactives', () => {
      const source = `export const user = ref(null)`
      const result = transformCode(source, '/src/global.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("scope: 'module'")
      expect(code).toContain("name: 'user'")
    })

    it('rejects .vue ids with non-script query', () => {
      expect(transformCode('x', '/src/A.vue?vue&type=style&lang.css', { root: '/src' })).toBeNull()
    })

    it('accepts type=script query', () => {
      expect(
        transformCode('const a = ref(0)', '/src/A.vue?vue&type=script&lang.ts', { root: '/src' })
      ).not.toBeNull()
    })

    it('rejects files outside root', () => {
      expect(transformCode('const a = ref(0)', '/other/x.ts', { root: '/src' })).toBeNull()
    })

    it('rejects tracer package sources regardless of checkout path', () => {
      const repoRoot = resolve(import.meta.dirname, '..')
      const pkgFile = resolve(repoRoot, 'packages/runtime/src/trace-helpers.ts')
      expect(transformCode('const a = ref(0)', pkgFile, { root: repoRoot })).toBeNull()
    })
  })

  describe('Section 50 — Test 1: Full Causality Trace', () => {
    it('satisfies all Acceptance Test 1 requirements', async () => {
      // 1. Setup Vue App with Adapter
      const rootEl = document.createElement('div')
      document.body.appendChild(rootEl)

      // Instrumented component matching Section 50 Test 1:
      // const count = ref(0)
      // function add() { count.value++ }
      const CounterComponent = defineComponent({
        name: 'App',
        setup() {
          const count = __trace_register(ref(0), {
            name: 'count',
            type: 'ref',
            source: { file: 'App.vue', line: 1, column: 6 }
          })

          function add() {
            __trace_update(count, 'value', '++', false, {
              file: 'App.vue',
              line: 4,
              column: 2
            })
          }

          return { count, add }
        },
        render() {
          return h('button', { id: 'test-btn', onClick: this.add }, `Count: ${this.count}`)
        }
      })

      const app = createApp(CounterComponent)
      app.use(reactiveTraceVueAdapter)
      app.mount(rootEl)
      await nextTick()

      // 2. Clear any mount traces
      traceCollector.clearTraces()

      // 3. Action: click
      const btn = rootEl.querySelector('#test-btn') as HTMLButtonElement
      expect(btn).not.toBeNull()
      expect(btn.textContent).toBe('Count: 0')

      // Trigger click event
      btn.click()
      await nextTick()

      // Wait a tick for scheduler/render flush
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 4. Verify Requirements:
      const traces = traceCollector.getTraces()
      expect(traces.length).toBeGreaterThanOrEqual(1)
      const trace = traces[traces.length - 1]

      // ✓ interaction detected
      expect(trace.trigger.type).toBe('interaction')
      expect(trace.trigger.event).toBe('click')
      expect(trace.trigger.targetTag).toBe('button')
      const interactionEvt = trace.events.find((e) => e.type === 'interaction') as InteractionEvent
      expect(interactionEvt).toBeDefined()
      expect(interactionEvt.event).toBe('click')

      // ✓ count mutation detected
      const mutationEvt = trace.events.find((e) => e.type === 'mutation') as MutationEvent
      expect(mutationEvt).toBeDefined()
      expect(mutationEvt.name).toBe('count')
      expect(mutationEvt.operation).toBe('increment')

      // ✓ before = 0
      expect(mutationEvt.before).toBe(0)

      // ✓ after = 1
      expect(mutationEvt.after).toBe(1)

      // ✓ exact source line
      expect(mutationEvt.source).toEqual({
        file: 'App.vue',
        line: 4,
        column: 2
      })

      // ✓ component render detected
      const renderEvt = trace.events.find((e) => e.type === 'component-render') as ComponentRenderEvent
      expect(renderEvt).toBeDefined()
      expect(renderEvt.componentName).toBe('App')
      expect(renderEvt.duration).toBeGreaterThanOrEqual(0)
      expect(btn.textContent).toBe('Count: 1')

      // ✓ mutation → render correlation
      expect(mutationEvt.affectedComponents).toContain('App')

      app.unmount()
      rootEl.remove()
    })
  })

  describe('Section 50 — Test 2: Nested Reactive Mutation', () => {
    it('satisfies Acceptance Test 2 requirements', () => {
      const state = __trace_register(
        reactive({
          profile: {
            name: 'A'
          }
        }),
        {
          name: 'state',
          type: 'reactive',
          source: { file: 'user.ts', line: 1, column: 6 }
        }
      )

      traceCollector.startTrace({ type: 'manual', event: 'test-2' })

      // Mutation: state.profile.name = 'B'
      __trace_set(state.profile, 'name', 'B', {
        file: 'src/user.ts',
        line: 6,
        column: 0
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.before).toBe('A')
      expect(mutation.after).toBe('B')
      expect(mutation.source).toEqual({
        file: 'src/user.ts',
        line: 6,
        column: 0
      })
      expect(state.profile.name).toBe('B')
    })
  })

  describe('Section 50 — Test 3: Module-Global Reactive', () => {
    it('satisfies Acceptance Test 3 requirements', () => {
      // global.ts: export const user = ref(null)
      const user = __trace_register(ref(null), {
        name: 'user',
        type: 'ref',
        scope: 'module',
        source: { file: 'src/global.ts', line: 1, column: 13 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'login' })

      // login.ts: user.value = { id: 1, name: 'Alice' }
      __trace_set(user, 'value', { id: 1, name: 'Alice' }, {
        file: 'src/login.ts',
        line: 5,
        column: 2
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.name).toBe('user')
      expect(mutation.before).toBe(null)
      expect(mutation.after).toEqual({ id: 1, name: 'Alice' })
      expect(mutation.source).toEqual({
        file: 'src/login.ts',
        line: 5,
        column: 2
      })
    })
  })
})

describe('MVP 1 Acceptance Tests', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  describe('AST Transformation (MVP 1)', () => {
    it('instruments computed declarations', () => {
      const source = `
const total = computed(() => count.value * 2)
`
      const result = transformCode(source, '/src/store.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain('__trace_register_computed(computed(() => count.value * 2)')
      expect(code).toContain("name: 'total'")
      expect(code).toContain("type: 'computed'")
      expect(code).toContain("file: 'store.ts'")
    })

    it('instruments array mutating method calls with exact source and member chain', () => {
      const source = `
function addItem(item) {
  cart.items.push(item)
}
`
      const result = transformCode(source, '/src/cart.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("__trace_call(cart.items, 'push', [item]")
      expect(code).toContain("file: 'cart.ts'")
      expect(code).toContain("rootName: 'cart'")
      expect(code).toContain('path: ["items"]')
    })

    it('instruments nested member assignment with complete property path', () => {
      const source = `state.profile.name = 'John'`
      const result = transformCode(source, '/src/user.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("__trace_set(state.profile, 'name', () => (state.profile.name = 'John')")
      expect(code).toContain("rootName: 'state'")
      expect(code).toContain('path: ["profile","name"]')
    })

    it('instruments compound assignment as a thunk and does not import __trace_assign_op', () => {
      const source = `state.count %= 4`
      const result = transformCode(source, '/src/math.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("__trace_set(state, 'count', () => (state.count %= 4)")
      expect(code).not.toContain('__trace_assign_op')
    })

    it('does not thunk compound assignment when the object expression has side effects', () => {
      const source = `getObj().n %= 4`
      const result = transformCode(source, '/src/unsafe.ts', { root: '/src' })
      expect(result).toBeNull()
    })
  })

  describe('Section 50 — Test 4: Array Mutation & Affected Components', () => {
    it('satisfies Acceptance Test 4 requirements', async () => {
      const rootEl = document.createElement('div')
      document.body.appendChild(rootEl)

      // Reactive cart object with items array
      const cart = __trace_register(
        reactive({
          items: ['item1', 'item2']
        }),
        {
          name: 'cart',
          type: 'reactive',
          source: { file: 'src/stores/cart.ts', line: 1, column: 0 }
        }
      )

      // Component 1: CartBadge (displays count)
      const CartBadge = defineComponent({
        name: 'CartBadge',
        setup() {
          return () => h('span', { id: 'cart-badge' }, `Items: ${cart.items.length}`)
        }
      })

      // Component 2: CartList (displays items list)
      const CartList = defineComponent({
        name: 'CartList',
        setup() {
          return () =>
            h(
              'ul',
              { id: 'cart-list' },
              cart.items.map((it) => h('li', it))
            )
        }
      })

      // Root App Component
      const App = defineComponent({
        name: 'App',
        setup() {
          function addItem() {
            __trace_call(
              cart.items,
              'push',
              ['item3'],
              { file: 'src/stores/cart.ts', line: 32, column: 5 },
              { rootName: 'cart', path: ['items'] }
            )
          }
          return { addItem }
        },
        render() {
          return h('div', [
            h(CartBadge),
            h(CartList),
            h('button', { id: 'add-btn', onClick: this.addItem }, 'Add')
          ])
        }
      })

      const app = createApp(App)
      app.use(reactiveTraceVueAdapter)
      app.mount(rootEl)
      await nextTick()

      // Clear mount traces
      traceCollector.clearTraces()

      // Action: click Add button
      const btn = rootEl.querySelector('#add-btn') as HTMLButtonElement
      btn.click()
      await nextTick()

      // Wait for Vue flush
      await new Promise((resolve) => setTimeout(resolve, 50))

      const traces = traceCollector.getTraces()
      expect(traces.length).toBeGreaterThanOrEqual(1)
      const trace = traces[traces.length - 1]

      // Find mutation event
      const mutationEvt = trace.events.find((e) => e.type === 'mutation') as MutationEvent
      expect(mutationEvt).toBeDefined()

      // ✓ Operation: push
      expect(mutationEvt.operation).toBe('push')

      // ✓ Reactive: cart.items
      expect(mutationEvt.name).toBe('cart.items')

      // ✓ Source: exact line
      expect(mutationEvt.source).toEqual({
        file: 'src/stores/cart.ts',
        line: 32,
        column: 5
      })

      // ✓ Before: ['item1', 'item2']
      expect(mutationEvt.before).toEqual(['item1', 'item2'])

      // ✓ After: ['item1', 'item2', 'item3']
      expect(mutationEvt.after).toEqual(['item1', 'item2', 'item3'])

      // ✓ Affected Components: complete list
      expect(mutationEvt.affectedComponents).toContain('CartBadge')
      expect(mutationEvt.affectedComponents).toContain('CartList')

      app.unmount()
      rootEl.remove()
    })
  })

  describe('Computed Invalidation', () => {
    it('tracks computed invalidation when dependency mutates', async () => {
      const items = __trace_register(ref([10, 20]), {
        name: 'items',
        type: 'ref',
        source: { file: 'cart.ts', line: 1, column: 0 }
      })

      const total = __trace_register_computed(
        computed(() => items.value.reduce((a, b) => a + b, 0)),
        {
          name: 'total',
          source: { file: 'cart.ts', line: 5, column: 0 }
        }
      )

      // Active observer (simulating template/component subscription)
      const stop = watchEffect(() => {
        const _ = total.value
      })

      expect(total.value).toBe(30)

      traceCollector.startTrace({ type: 'manual', event: 'add-item' })

      // Mutate items: items.value.push(30)
      __trace_call(
        items.value,
        'push',
        [30],
        { file: 'cart.ts', line: 12, column: 2 },
        { rootName: 'items', path: ['value'] }
      )

      const trace = traceCollector.getCurrentTrace()!
      const computedEvt = trace.events.find((e) => e.type === 'computed') as ComputedEvent

      expect(computedEvt).toBeDefined()
      expect(computedEvt.name).toBe('total')
      expect(computedEvt.status).toBe('invalidated')
      expect(computedEvt.triggeredByMutationId).toBeDefined()

      expect(total.value).toBe(60)
      stop()
    })
  })

  describe('Pinia Store Integration', () => {
    it('registers store state mutations as Pinia type and tracks them', async () => {
      const pinia = createPinia()
      pinia.use(reactiveTracePiniaPlugin)

      const useCartStore = defineStore('cart', {
        state: () => ({
          items: ['Apple']
        }),
        actions: {
          addItem(item: string) {
            __trace_call(
              this.items,
              'push',
              [item],
              { file: 'cartStore.ts', line: 10, column: 4 },
              { rootName: 'cart', path: ['items'] }
            )
          }
        }
      })

      const rootEl = document.createElement('div')
      const app = createApp({
        render: () => h('div')
      })
      app.use(pinia)
      app.use(reactiveTraceVueAdapter)
      app.mount(rootEl)

      traceCollector.clearTraces()
      traceCollector.startTrace({ type: 'manual', event: 'pinia-action' })

      const cartStore = useCartStore()
      cartStore.addItem('Banana')

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.name).toBe('cart.items')
      expect(mutation.operation).toBe('push')
      expect(mutation.before).toEqual(['Apple'])
      expect(mutation.after).toEqual(['Apple', 'Banana'])

      app.unmount()
      rootEl.remove()
    })
  })

  describe('Interaction Capture (input & change)', () => {
    beforeEach(() => installInteractionCapture())
    afterEach(() => uninstallInteractionCapture())

    it('captures input and change events in capture phase', () => {
      traceCollector.clearTraces()

      const input = document.createElement('input')
      input.type = 'text'
      input.value = 'hello world'
      document.body.appendChild(input)

      input.dispatchEvent(new Event('input', { bubbles: true }))

      const traces = traceCollector.getTraces()
      expect(traces.length).toBeGreaterThanOrEqual(1)
      const trace = traces[traces.length - 1]

      expect(trace.trigger.type).toBe('interaction')
      expect(trace.trigger.event).toBe('input')
      expect(trace.trigger.targetTag).toBe('input')
      expect(trace.trigger.targetText).toContain('hello world')

      input.remove()
    })
  })

  describe('DevTools UI (MVP 1 Timeline & Details)', () => {
    it('mounts DevTools container and renders Performance-style timeline tracks', () => {
      // Create a sample trace with mutation
      traceCollector.startTrace({ type: 'manual', event: 'test-trace' })
      traceCollector.recordMutation({
        name: 'testVar',
        operation: 'set',
        before: 1,
        after: 2,
        source: { file: 'test.ts', line: 10, column: 2 }
      })

      initDevTools()
      const devtools = document.getElementById('__vue_reactive_trace_devtools__')
      expect(devtools).not.toBeNull()

      // Toggle open
      const toggle = devtools!.querySelector('#vrt-toggle') as HTMLElement
      expect(toggle).not.toBeNull()
      toggle.click()

      // Verify panel and timeline elements
      expect(devtools!.querySelector('.vrt-panel')).not.toBeNull()
      expect(devtools!.querySelector('#vrt-tab-timeline')).not.toBeNull()
      expect(devtools!.querySelector('#vrt-tab-flow')).not.toBeNull()
      expect(devtools!.querySelector('.vrt-timeline-container')).not.toBeNull()
      expect(devtools!.querySelector('.vrt-ruler')).not.toBeNull()
      expect(devtools!.querySelector('.vrt-detail-panel')).not.toBeNull()
    })
  })
})

describe('MVP 2 Acceptance Tests', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  describe('AST Transformation (MVP 2)', () => {
    it('instruments watch and watchEffect callbacks with exact source locations', () => {
      const source = `
watch(userId, (newVal) => {
  loadUser(newVal)
})
watchEffect(() => {
  console.log(count.value)
})
`
      const result = transformCode(source, '/src/watchers.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      // Watch callback instrumentation
      expect(code).toContain('__trace_watch_cb(')
      expect(code).toContain("name: 'watchCallback'")
      expect(code).toContain("file: 'watchers.ts'")
      expect(code).toContain('line: 2')

      // WatchEffect callback instrumentation
      expect(code).toContain("name: 'watchEffect'")
      expect(code).toContain('line: 5')
    })

    it('instruments delete expressions on member targets', () => {
      const source = `delete state.profile.age`
      const result = transformCode(source, '/src/user.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain('__trace_delete(state.profile, \'age\'')
      expect(code).toContain("rootName: 'state'")
      expect(code).toContain('path: ["profile","age"]')
      expect(code).toContain("file: 'user.ts'")
    })

    it('instruments Map and Set mutating methods (set, add, delete, clear)', () => {
      const source = `
map.set('theme', 'dark')
map.delete('oldKey')
map.clear()
set.add('guest')
`
      const result = transformCode(source, '/src/collections.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("__trace_call(map, 'set', ['theme', 'dark']")
      expect(code).toContain("__trace_call(map, 'delete', ['oldKey']")
      expect(code).toContain("__trace_call(map, 'clear', []")
      expect(code).toContain("__trace_call(set, 'add', ['guest']")
    })
  })

  describe('Async Context & Causality (async / await & Promise)', () => {
    beforeEach(() => installAsyncTracking())
    afterEach(() => uninstallAsyncTracking())

    it('maintains trace causality across async / await steps in login flow', async () => {
      const loading = __trace_register(ref(false), {
        name: 'loading',
        type: 'ref',
        source: { file: 'src/stores/auth.ts', line: 2, column: 6 }
      })

      const user = __trace_register(ref<any>(null), {
        name: 'user',
        type: 'ref',
        source: { file: 'src/stores/auth.ts', line: 3, column: 6 }
      })

      traceCollector.startTrace({
        type: 'interaction',
        event: 'click',
        targetTag: 'button',
        targetText: 'Login'
      })

      // Section 27 Async Trace login simulation
      async function login() {
        __trace_set(loading, 'value', true, { file: 'src/stores/auth.ts', line: 6, column: 2 })
        await new Promise((resolve) => setTimeout(resolve, 30))
        __trace_set(user, 'value', { name: 'Alice' }, { file: 'src/stores/auth.ts', line: 8, column: 2 })
        __trace_set(loading, 'value', false, { file: 'src/stores/auth.ts', line: 10, column: 2 })
      }

      await login()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const traces = traceCollector.getTraces()
      expect(traces.length).toBeGreaterThanOrEqual(1)
      const trace = traces[traces.length - 1]

      // Verify all mutations belong to the exact same trace
      const mutations = trace.events.filter((e): e is MutationEvent => e.type === 'mutation')
      expect(mutations.length).toBe(3)

      expect(mutations[0].name).toBe('loading')
      expect(mutations[0].before).toBe(false)
      expect(mutations[0].after).toBe(true)

      expect(mutations[1].name).toBe('user')
      expect(mutations[1].before).toBe(null)
      expect(mutations[1].after).toEqual({ name: 'Alice' })

      expect(mutations[2].name).toBe('loading')
      expect(mutations[2].before).toBe(true)
      expect(mutations[2].after).toBe(false)

      // Async task events recorded
      const asyncEvents = trace.events.filter((e): e is AsyncTaskEvent => e.type === 'async')
      expect(asyncEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Async Context (queueMicrotask, requestAnimationFrame, setTimeout)', () => {
    beforeEach(() => installAsyncTracking())
    afterEach(() => uninstallAsyncTracking())

    it('propagates active trace into queueMicrotask continuation', async () => {
      const state = __trace_register(reactive({ count: 0 }), {
        name: 'state',
        type: 'reactive',
        source: { file: 'task.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })

      queueMicrotask(() => {
        __trace_set(state, 'count', 42, { file: 'task.ts', line: 5, column: 4 })
      })

      await new Promise((resolve) => setTimeout(resolve, 30))

      const trace = traceCollector.getCurrentTrace() || traceCollector.getTraces()[traceCollector.getTraces().length - 1]
      expect(trace).toBeDefined()

      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent
      expect(mutation).toBeDefined()
      expect(mutation.after).toBe(42)

      const microtaskEvent = trace.events.find((e) => e.type === 'async' && (e as AsyncTaskEvent).taskType === 'microtask')
      expect(microtaskEvent).toBeDefined()
    })

    it('propagates active trace into setTimeout macro-task', async () => {
      const status = __trace_register(ref('idle'), {
        name: 'status',
        type: 'ref',
        source: { file: 'timer.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })

      setTimeout(() => {
        __trace_set(status, 'value', 'ready', { file: 'timer.ts', line: 5, column: 2 })
      }, 15)

      await new Promise((resolve) => setTimeout(resolve, 40))

      const trace = traceCollector.getTraces()[traceCollector.getTraces().length - 1]
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent
      expect(mutation).toBeDefined()
      expect(mutation.after).toBe('ready')

      const timeoutEvent = trace.events.find((e) => e.type === 'async' && (e as AsyncTaskEvent).taskType === 'timeout')
      expect(timeoutEvent).toBeDefined()
    })
  })

  describe('Watch & WatchEffect Tracking', () => {
    it('records watch callback execution correlated with triggering mutation', async () => {
      const userId = __trace_register(ref(1), {
        name: 'userId',
        type: 'ref',
        source: { file: 'user.ts', line: 1, column: 0 }
      })

      const userProfile = __trace_register(ref('none'), {
        name: 'userProfile',
        type: 'ref',
        source: { file: 'user.ts', line: 2, column: 0 }
      })

      // Section 22: watch(userId, loadUser)
      const stop = watch(
        userId,
        __trace_watch_cb(
          (newId) => {
            __trace_set(userProfile, 'value', 'Profile_' + newId, {
              file: 'user.ts',
              line: 10,
              column: 4
            })
          },
          { name: 'loadUser', source: { file: 'user.ts', line: 8, column: 2 } }
        )
      )

      traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })

      // Trigger mutation: userId.value = 2
      __trace_set(userId, 'value', 2, { file: 'user.ts', line: 5, column: 2 })
      await nextTick()

      const trace = traceCollector.getCurrentTrace()!
      expect(trace).toBeDefined()

      // 1. Initial mutation
      const firstMutation = trace.events.find((e) => e.type === 'mutation' && (e as MutationEvent).name === 'userId') as MutationEvent
      expect(firstMutation).toBeDefined()
      expect(firstMutation.after).toBe(2)

      // 2. Watch event
      const watchEvent = trace.events.find((e) => e.type === 'watch') as WatchEvent
      expect(watchEvent).toBeDefined()
      expect(watchEvent.name).toBe('loadUser')
      expect(watchEvent.source).toEqual({ file: 'user.ts', line: 8, column: 2 })

      // 3. Mutation performed inside watch callback belongs to the same trace
      const secondMutation = trace.events.find((e) => e.type === 'mutation' && (e as MutationEvent).name === 'userProfile') as MutationEvent
      expect(secondMutation).toBeDefined()
      expect(secondMutation.after).toBe('Profile_2')

      stop()
    })
  })

  describe('Reactive Map & Set Mutations', () => {
    it('tracks Map set, delete, and clear operations with before/after state snapshots', () => {
      const map = __trace_register(reactive(new Map<string, any>()), {
        name: 'appConfig',
        type: 'reactive',
        source: { file: 'config.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'map-test' })

      // 1. set
      __trace_call(map, 'set', ['theme', 'dark'], { file: 'config.ts', line: 3, column: 2 })
      // 2. delete
      __trace_call(map, 'delete', ['theme'], { file: 'config.ts', line: 4, column: 2 })
      // 3. clear
      __trace_call(map, 'clear', [], { file: 'config.ts', line: 5, column: 2 })

      const trace = traceCollector.getCurrentTrace()!
      const mutations = trace.events.filter((e): e is MutationEvent => e.type === 'mutation')
      expect(mutations.length).toBe(3)

      expect(mutations[0].operation).toBe('map-set')
      expect(mutations[0].before).toEqual({ $type: 'Map', size: 0, entries: [] })
      expect(mutations[0].after).toEqual({ $type: 'Map', size: 1, entries: [['theme', 'dark']] })

      expect(mutations[1].operation).toBe('delete')
      expect(mutations[1].after).toEqual({ $type: 'Map', size: 0, entries: [] })

      expect(mutations[2].operation).toBe('clear')
    })

    it('tracks Set add, delete, and clear operations', () => {
      const tags = __trace_register(reactive(new Set<string>()), {
        name: 'tags',
        type: 'reactive',
        source: { file: 'tags.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'set-test' })

      __trace_call(tags, 'add', ['featured'], { file: 'tags.ts', line: 3, column: 2 })
      __trace_call(tags, 'delete', ['featured'], { file: 'tags.ts', line: 4, column: 2 })

      const trace = traceCollector.getCurrentTrace()!
      const mutations = trace.events.filter((e): e is MutationEvent => e.type === 'mutation')
      expect(mutations.length).toBe(2)

      expect(mutations[0].operation).toBe('set-add')
      expect(mutations[0].before).toEqual({ $type: 'Set', size: 0, values: [] })
      expect(mutations[0].after).toEqual({ $type: 'Set', size: 1, values: ['featured'] })

      expect(mutations[1].operation).toBe('delete')
      expect(mutations[1].after).toEqual({ $type: 'Set', size: 0, values: [] })
    })

    it('tracks delete operator on reactive objects with exact source location', () => {
      const state = __trace_register(reactive<{ user?: string }>({ user: 'David' }), {
        name: 'session',
        type: 'reactive',
        source: { file: 'session.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'delete-test' })

      __trace_delete(state, 'user', { file: 'session.ts', line: 4, column: 2 })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.operation).toBe('delete')
      expect(mutation.before).toBe('David')
      expect(mutation.after).toBeUndefined()
      expect(state.user).toBeUndefined()
    })
  })

  describe('Event Aggregation (Section 40)', () => {
    it('aggregates high-frequency repetitive mutations into a single group', () => {
      const list = __trace_register(ref<number[]>([]), {
        name: 'list',
        type: 'ref',
        source: { file: 'loop.ts', line: 1, column: 0 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'loop-test' })

      // Loop: 50 mutations
      for (let i = 0; i < 50; i++) {
        __trace_call(
          list.value,
          'push',
          [i],
          { file: 'loop.ts', line: 5, column: 4 },
          { rootName: 'list', path: ['value'] }
        )
      }

      const trace = traceCollector.getCurrentTrace()!
      expect(trace.events.length).toBe(50)

      // Aggregate with threshold = 3
      const aggregated = aggregateTraceEvents(trace.events, 3)
      expect(aggregated.length).toBe(1)

      const group = aggregated[0] as AggregatedMutationGroup
      expect(group.type).toBe('aggregated-mutation')
      expect(group.name).toBe('list.value')
      expect(group.count).toBe(50)
      expect(group.operation).toBe('push')
      expect(group.duration).toBeGreaterThanOrEqual(0)
      expect(group.before).toEqual([])
      expect(group.after.length).toBe(50)
      expect(group.events.length).toBe(50)
    })
  })

  describe('DevTools UI (MVP 2 Timeline Tracks & Details)', () => {
    it('renders Async Tasks, Watch, and Aggregated Mutation tracks in Timeline and Details', () => {
      traceCollector.clearTraces()
      const trace = traceCollector.startTrace({ type: 'manual', event: 'mvp2-ui-test' })

      // 1. Async task
      traceCollector.recordAsyncTask('promise')

      // 2. Repetitive mutations for aggregation
      for (let i = 0; i < 5; i++) {
        traceCollector.recordMutation({
          name: 'items',
          operation: 'push',
          before: [i - 1],
          after: [i],
          source: { file: 'items.ts', line: 10, column: 2 }
        })
      }

      // 3. Watch event
      traceCollector.recordWatchExecuted({
        name: 'onItemsChange',
        source: { file: 'watcher.ts', line: 15, column: 4 }
      })

      initDevTools()
      const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
      expect(devtools).not.toBeNull()

      // Header title verification
      expect(devtools.innerHTML).toContain('MVP 2')

      // Verify Async task bar rendered
      expect(devtools.querySelectorAll('.vrt-event-bar.async').length).toBeGreaterThanOrEqual(1)

      // Verify Aggregated mutation bar rendered
      expect(devtools.querySelectorAll('.vrt-event-bar.aggregated').length).toBeGreaterThanOrEqual(1)

      // Verify Watch bar rendered
      expect(devtools.querySelectorAll('.vrt-event-bar.watch').length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('MVP 3 Acceptance Tests', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  describe('Custom Composable Tracing (Section 25)', () => {
    it('detects composable name and sets scope to composable during AST transformation', () => {
      const source = `
function useCounter() {
  const count = ref(0)
  function inc() { count.value++ }
  return { count, inc }
}
`
      const result = transformCode(source, '/src/composables/useCounter.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("name: 'count'")
      expect(code).toContain("type: 'ref'")
      expect(code).toContain("scope: 'composable'")
      expect(code).toContain("composable: 'useCounter'")
      expect(code).toContain("file: 'composables/useCounter.ts'")
    })

    it('detects arrow function composables in AST transformation', () => {
      const source = `
export const useCart = () => {
  const items = reactive([])
  return { items }
}
`
      const result = transformCode(source, '/src/composables/useCart.ts', { root: '/src' })
      expect(result).not.toBeNull()
      const code = result!.code

      expect(code).toContain("name: 'items'")
      expect(code).toContain("type: 'reactive'")
      expect(code).toContain("scope: 'composable'")
      expect(code).toContain("composable: 'useCart'")
    })

    it('records composable name on mutation events during execution', () => {
      // Simulate composable instantiation
      function useCounter() {
        const count = __trace_register(ref(10), {
          name: 'count',
          type: 'ref',
          scope: 'composable',
          composable: 'useCounter',
          source: { file: 'src/composables/useCounter.ts', line: 2, column: 8 }
        })
        return { count }
      }

      const { count } = useCounter()

      traceCollector.startTrace({ type: 'manual', event: 'composable-test' })

      __trace_set(count, 'value', 11, {
        file: 'src/composables/useCounter.ts',
        line: 3,
        column: 19
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.name).toBe('count')
      expect(mutation.composable).toBe('useCounter')
      expect(mutation.confidence).toBe('exact')
      expect(mutation.traceLevel).toBe('full')
      expect(mutation.isExternal).toBe(false)
      expect(mutation.before).toBe(10)
      expect(mutation.after).toBe(11)
    })
  })

  describe('External Reactive Labeling (Section 24, 26, 43)', () => {
    it('labels third-party/external composable state with partial trace level and inferred confidence', () => {
      // Section 24: const { x, y } = useMouse() -> external reactive from @vueuse/core
      const x = registerExternalReactive(ref(100), {
        name: 'x',
        origin: '@vueuse/core'
      })

      traceCollector.startTrace({ type: 'manual', event: 'external-test' })

      __trace_set(x, 'value', 120, {
        file: 'node_modules/@vueuse/core/index.mjs',
        line: 42,
        column: 4
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.isExternal).toBe(true)
      expect(mutation.origin).toBe('@vueuse/core')
      expect(mutation.traceLevel).toBe('partial')
      expect(mutation.confidence).toBe('inferred')
    })

    it('automatically labels unregistered runtime reactives as external with inferred confidence', () => {
      // An unregistered reactive object (e.g. from an uninstrumented external library)
      const externalState = reactive({ theme: 'dark' })

      traceCollector.startTrace({ type: 'manual', event: 'auto-external-test' })

      __trace_set(externalState, 'theme', 'light', {
        file: 'external-lib.js',
        line: 10,
        column: 2
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.isExternal).toBe(true)
      expect(mutation.origin).toBe('external')
      expect(mutation.traceLevel).toBe('partial')
      expect(mutation.confidence).toBe('inferred')
    })

    it('labels internal AST-instrumented code as full trace level with exact confidence', () => {
      const localCount = __trace_register(ref(0), {
        name: 'localCount',
        type: 'ref',
        source: { file: 'src/App.vue', line: 10, column: 2 }
      })

      traceCollector.startTrace({ type: 'manual', event: 'internal-test' })

      __trace_set(localCount, 'value', 1, {
        file: 'src/App.vue',
        line: 12,
        column: 2
      })

      const trace = traceCollector.getCurrentTrace()!
      const mutation = trace.events.find((e) => e.type === 'mutation') as MutationEvent

      expect(mutation).toBeDefined()
      expect(mutation.isExternal).toBe(false)
      expect(mutation.traceLevel).toBe('full')
      expect(mutation.confidence).toBe('exact')
    })
  })

  describe('Open in Editor (Section 34)', () => {
    it('formats editor command correctly and resolves file paths', () => {
      const result = openInEditor('src/stores/cart.ts', 32, 5, '/workspace', 'code')
      expect(result.success).toBe(true)
      expect(result.targetPath).toBe('/workspace/src/stores/cart.ts')
      expect(result.command).toContain('code -g /workspace/src/stores/cart.ts:32:5')
    })

    it('handles /__reactive-trace/open-source endpoint request', () => {
      let statusCode = 0
      let responseBody = ''
      const req = {
        url: '/__reactive-trace/open-source?file=src/cart.ts&line=42&column=7'
      }
      const res = {
        statusCode: 200,
        setHeader: () => {},
        end: (body: string) => {
          responseBody = body
        }
      }

      const handled = handleOpenSourceEndpoint(req, res, '/project', 'cursor')
      expect(handled).toBe(true)
      expect(res.statusCode).toBe(200)

      const parsed = JSON.parse(responseBody)
      expect(parsed.success).toBe(true)
      expect(parsed.targetPath).toBe('/project/src/cart.ts')
      expect(parsed.command).toContain('cursor -g /project/src/cart.ts:42:7')
    })

    it('returns 400 Bad Request when file parameter is missing', () => {
      let statusCode = 0
      let responseBody = ''
      const req = {
        url: '/__reactive-trace/open-source?line=42'
      }
      const res = {
        statusCode: 200,
        setHeader: () => {},
        end: (body: string) => {
          responseBody = body
        }
      }

      handleOpenSourceEndpoint(req, res, '/project')
      expect(res.statusCode).toBe(400)
      const parsed = JSON.parse(responseBody)
      expect(parsed.error).toContain('Missing file parameter')
    })
  })

  describe('Trace Export & Import (Section 49)', () => {
    it('exports single trace session as structured export data', () => {
      const trace = traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })
      traceCollector.recordMutation({
        name: 'user',
        operation: 'set',
        before: 'A',
        after: 'B',
        source: { file: 'user.ts', line: 1, column: 0 }
      })
      traceCollector.recordComponentRender('UserProfile', 10, 15, 'UserProfile.vue')

      const exported = traceCollector.exportTrace(trace.id)
      expect(exported.version).toBe('0.2')
      expect(exported.summary.tracesCount).toBe(1)
      expect(exported.summary.mutationsCount).toBe(1)
      expect(exported.summary.rendersCount).toBe(1)
      expect(exported.traces.length).toBe(1)
      expect(exported.traces[0].id).toBe(trace.id)
    })

    it('exports traces as valid JSON string and supports importing them', () => {
      const trace = traceCollector.startTrace({ type: 'manual', event: 'export-import-test' })
      traceCollector.recordMutation({
        name: 'testVar',
        operation: 'set',
        before: 1,
        after: 2,
        source: { file: 'test.ts', line: 5, column: 0 }
      })

      const json = traceCollector.exportTracesAsJSON()
      expect(typeof json).toBe('string')
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe('0.2')
      expect(parsed.traces.length).toBeGreaterThanOrEqual(1)

      // Clear traces and re-import
      traceCollector.clearTraces()
      expect(traceCollector.getTraces().length).toBe(0)

      traceCollector.importTraces(json)
      expect(traceCollector.getTraces().length).toBe(parsed.traces.length)
      expect(traceCollector.getTraces()[0].id).toBe(trace.id)
    })
  })

  describe('Advanced Filtering & Noise Reduction (Section 41, 42)', () => {
    it('filters events by type', () => {
      const trace = traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })
      traceCollector.recordMutation({
        name: 'items',
        operation: 'push',
        before: [],
        after: [1],
        source: { file: 'cart.ts', line: 10, column: 0 }
      })
      traceCollector.recordComputedInvalidated({
        name: 'cartTotal',
        source: { file: 'cart.ts', line: 20, column: 0 }
      })
      traceCollector.recordComponentRender('CartBadge', 10, 12, 'CartBadge.vue')

      // Filter only mutations
      const filteredMutations = filterTraceEvents(trace.events, { types: ['mutation'] })
      expect(filteredMutations.length).toBe(1)
      expect(filteredMutations[0].type).toBe('mutation')

      // Filter only renders
      const filteredRenders = filterTraceEvents(trace.events, { types: ['component-render'] })
      expect(filteredRenders.length).toBe(1)
      expect(filteredRenders[0].type).toBe('component-render')
    })

    it('filters events by text query matching variable, component, and file names', () => {
      const trace = traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })
      traceCollector.recordMutation({
        name: 'cartItems',
        operation: 'push',
        before: [],
        after: [1],
        source: { file: 'src/stores/cart.ts', line: 10, column: 0 }
      })
      traceCollector.recordMutation({
        name: 'userTheme',
        operation: 'set',
        before: 'light',
        after: 'dark',
        source: { file: 'src/stores/theme.ts', line: 5, column: 0 }
      })

      // Search by variable name
      const cartResults = filterTraceEvents(trace.events, { query: 'cart' })
      expect(cartResults.length).toBe(1)
      expect((cartResults[0] as MutationEvent).name).toBe('cartItems')

      // Search by file name
      const themeResults = filterTraceEvents(trace.events, { query: 'theme' })
      expect(themeResults.length).toBe(1)
      expect((themeResults[0] as MutationEvent).name).toBe('userTheme')
    })

    it('implements Section 42 Noise Reduction with appCodeOnly filter', () => {
      const trace = traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })

      // App code mutation
      traceCollector.recordMutation({
        name: 'appState',
        operation: 'set',
        before: 0,
        after: 1,
        source: { file: 'src/components/App.vue', line: 15, column: 2 }
      })

      // External library / node_modules mutation
      traceCollector.recordMutation({
        name: 'externalLibState',
        operation: 'set',
        before: 0,
        after: 1,
        isExternal: true,
        source: { file: 'node_modules/vue-library/index.js', line: 50, column: 2 }
      })

      expect(trace.events.filter((e) => e.type === 'mutation').length).toBe(2)

      // Filter with appCodeOnly: true
      const appOnly = filterTraceEvents(trace.events, { appCodeOnly: true })
      const mutationEvents = appOnly.filter((e) => e.type === 'mutation') as MutationEvent[]

      expect(mutationEvents.length).toBe(1)
      expect(mutationEvents[0].name).toBe('appState')
      expect(mutationEvents[0].isExternal).toBe(false)
    })

    it('filters events by minDuration and affected component', () => {
      const trace = traceCollector.startTrace({ type: 'manual', event: 'duration-test' })
      traceCollector.recordComponentRender('FastComponent', 10, 10.5, 'Fast.vue') // duration: 0.5ms
      traceCollector.recordComponentRender('SlowComponent', 10, 25, 'Slow.vue') // duration: 15ms

      const slowRenders = filterTraceEvents(trace.events, { minDuration: 5 })
      expect(slowRenders.length).toBe(1)
      expect((slowRenders[0] as ComponentRenderEvent).componentName).toBe('SlowComponent')

      const fastRenders = filterTraceEvents(trace.events, { component: 'fast' })
      expect(fastRenders.length).toBe(1)
      expect((fastRenders[0] as ComponentRenderEvent).componentName).toBe('FastComponent')
    })
  })

  describe('DevTools UI (MVP 3 Controls, Badges & Links)', () => {
    it('renders Filter Bar, Export JSON button, clickable source locations, and MVP 3 labels', () => {
      traceCollector.clearTraces()
      const trace = traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })

      // 1. Composable mutation
      traceCollector.recordMutation({
        name: 'cartCount',
        composable: 'useCart',
        operation: 'set',
        before: 0,
        after: 1,
        source: { file: 'src/composables/useCart.ts', line: 12, column: 4 }
      })

      // 2. External reactive mutation
      traceCollector.recordMutation({
        name: 'mousePos',
        isExternal: true,
        origin: '@vueuse/core',
        operation: 'set',
        before: { x: 0 },
        after: { x: 50 },
        source: { file: 'node_modules/@vueuse/core/index.mjs', line: 88, column: 2 }
      })

      initDevTools()
      const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
      expect(devtools).not.toBeNull()

      // Header verification: MVP 3 present
      expect(devtools.innerHTML).toContain('MVP 3')

      // Section 49: Export JSON button rendered
      const exportBtn = devtools.querySelector('#vrt-export-json')
      expect(exportBtn).not.toBeNull()
      expect(exportBtn?.textContent).toContain('Export JSON')

      // Section 41 & 42: Filter Bar inputs rendered
      expect(devtools.querySelector('#vrt-filter-query')).not.toBeNull()
      expect(devtools.querySelector('#vrt-filter-type')).not.toBeNull()
      expect(devtools.querySelector('#vrt-filter-app-code')).not.toBeNull()

      // Section 34: Clickable source location link rendered
      const clickableLocs = devtools.querySelectorAll('.vrt-loc.clickable')
      expect(clickableLocs.length).toBeGreaterThanOrEqual(1)
      expect(devtools.innerHTML).toContain('↗')

      // Composable label rendered
      expect(devtools.innerHTML).toContain('useCart')

      // Click external event bar to inspect its details
      const extBar = devtools.querySelector('.vrt-event-bar[title*="mousePos"]') as HTMLElement
      expect(extBar).not.toBeNull()
      extBar.click()

      // External reactive label rendered in details
      expect(devtools.innerHTML).toContain('EXTERNAL REACTIVE')
      expect(devtools.innerHTML).toContain('@vueuse/core')
      expect(devtools.innerHTML).toContain('INFERRED')
    })
  })

  describe('§7 — JS semantics preservation', () => {
    const loc = { file: 'x', line: 1, column: 0 }
    const COMPOUND = ['%=', '**=', '|=', '&=', '^=', '<<=', '>>=', '||=', '&&=', '??='] as const

    it.each(COMPOUND)('preserves value and return value for %s (recording path)', (op) => {
      const start = 7
      const operand = 3
      const native: any = { v: start }
      const traced = reactive({ v: start })
      __trace_register(traced, { name: 'r', type: 'reactive' })

      const nativeRet = eval(`(native.v ${op} operand)`)
      const tracedRet = __trace_set(traced, 'v', () => eval(`(traced.v ${op} operand)`), loc, {})

      expect(traced.v).toBe(native.v)
      expect(tracedRet).toBe(nativeRet)
    })

    it.each(COMPOUND)('preserves value and return value for %s (fast path)', (op) => {
      const start = 7
      const operand = 3
      const native: any = { v: start }
      const unregistered: any = { v: start }

      const nativeRet = eval(`(native.v ${op} operand)`)
      const tracedRet = __trace_set(unregistered, 'v', () => eval(`(unregistered.v ${op} operand)`), loc, {})

      expect(unregistered.v).toBe(native.v)
      expect(tracedRet).toBe(nativeRet)
    })

    it('reads the target before evaluating RHS (compound, recording path)', () => {
      const order: string[] = []
      const t: any = {}
      let v = 5
      Object.defineProperty(t, 'n', {
        configurable: true,
        get() {
          order.push('get')
          return v
        },
        set(nv) {
          order.push('set')
          v = nv
        }
      })
      __trace_register(t, { name: 'accessor', type: 'unknown' })
      __trace_set(t, 'n', () => (t.n += (order.push('rhs'), 3)), loc, {})
      // Recording reads before and after; native += is get → rhs → set (not reversed)
      expect(order).toEqual(['get', 'get', 'rhs', 'set', 'get'])
      expect(order.indexOf('rhs')).toBeGreaterThan(order.indexOf('get'))
      expect(order.indexOf('set')).toBeGreaterThan(order.indexOf('rhs'))
    })

    it('evaluates get before RHS on the fast path (compound)', () => {
      const order: string[] = []
      const t: any = {}
      let v = 5
      Object.defineProperty(t, 'n', {
        configurable: true,
        get() {
          order.push('get')
          return v
        },
        set(nv) {
          order.push('set')
          v = nv
        }
      })
      __trace_set(t, 'n', () => (t.n += (order.push('rhs'), 3)), loc, {})
      expect(order).toEqual(['get', 'rhs', 'set'])
    })

    const UPDATE_CASES = [
      { label: 'number', start: 5 as number | string | bigint },
      { label: 'numeric string', start: '5' as number | string | bigint },
      { label: 'bigint', start: 10n as number | string | bigint }
    ] as const

    it.each(UPDATE_CASES)('applies ToNumeric for ++/-- on $label (recording path)', ({ start }) => {
      const native: any = { v: start }
      const traced: any = reactive({ v: start })
      __trace_register(traced, { name: 's', type: 'reactive' })

      const nativePostInc = native.v++
      const tracedPostInc = __trace_update(traced, 'v', '++', false, loc, {})
      expect(traced.v).toBe(native.v)
      expect(tracedPostInc).toBe(nativePostInc)
      expect(typeof tracedPostInc).toBe(typeof nativePostInc)

      native.v = start
      traced.v = start
      const nativePreInc = ++native.v
      const tracedPreInc = __trace_update(traced, 'v', '++', true, loc, {})
      expect(traced.v).toBe(native.v)
      expect(tracedPreInc).toBe(nativePreInc)

      native.v = start
      traced.v = start
      const nativePostDec = native.v--
      const tracedPostDec = __trace_update(traced, 'v', '--', false, loc, {})
      expect(traced.v).toBe(native.v)
      expect(tracedPostDec).toBe(nativePostDec)
      expect(typeof tracedPostDec).toBe(typeof nativePostDec)

      native.v = start
      traced.v = start
      const nativePreDec = --native.v
      const tracedPreDec = __trace_update(traced, 'v', '--', true, loc, {})
      expect(traced.v).toBe(native.v)
      expect(tracedPreDec).toBe(nativePreDec)
    })

    it.each(UPDATE_CASES)('applies ToNumeric for ++/-- on $label (fast path)', ({ start }) => {
      const native: any = { v: start }
      const unregistered: any = { v: start }

      const nativePostInc = native.v++
      const tracedPostInc = __trace_update(unregistered, 'v', '++', false, loc, {})
      expect(unregistered.v).toBe(native.v)
      expect(tracedPostInc).toBe(nativePostInc)
      expect(typeof tracedPostInc).toBe(typeof nativePostInc)
    })

    it('executes transformed %= with the same result as native JS', () => {
      const source = `traced.v %= 4`
      const result = transformCode(source, '/src/mod.ts', { root: '/src' })
      expect(result).not.toBeNull()
      expect(result!.code).toContain("__trace_set(traced, 'v', () => (traced.v %= 4)")

      const traced = reactive({ v: 7 })
      __trace_register(traced, { name: 'mod', type: 'reactive' })
      const locArg = loc
      const fn = new Function(
        '__trace_set',
        'traced',
        'loc',
        result!.code.replace(/^import[\s\S]*?;\n/, '') + '\nreturn traced.v'
      )
      const value = fn(__trace_set, traced, locArg)
      expect(value).toBe(3)
      expect(traced.v).toBe(3)
    })
  })
})

describe('§23 — scope classification', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  it('classifies <script setup> top-level decls as local', () => {
    const sfc = `<script setup>\nconst count = ref(0)\n</script>`
    const out = transformCode(sfc, '/src/App.vue', { root: '/src' })!.code
    expect(out).toContain("name: 'count'")
    expect(out).toContain("scope: 'local'")
    expect(out).not.toContain("scope: 'module'")
  })

  it('classifies plain <script> top-level decls as module', () => {
    const sfc = `<script>\nconst n = ref(1)\nexport default {}\n</script>`
    const out = transformCode(sfc, '/src/P.vue', { root: '/src' })!.code
    expect(out).toContain("scope: 'module'")
  })

  it('still classifies .ts module scope as module', () => {
    const out = transformCode(`export const user = ref(null)`, '/src/state.ts', { root: '/src' })!.code
    expect(out).toContain("scope: 'module'")
  })

  it('classifies <script setup> query modules as local', () => {
    const out = transformCode(
      `const count = ref(0)`,
      '/src/App.vue?vue&type=script&setup=true&lang.ts',
      { root: '/src' }
    )!.code
    expect(out).toContain("scope: 'local'")
    expect(out).not.toContain("scope: 'module'")
  })

  it('propagates scope and declaredAt onto mutation events', () => {
    const user = __trace_register(ref(null), {
      name: 'user',
      type: 'ref',
      scope: 'module',
      source: { file: 'src/state/auth.ts', line: 3, column: 0 }
    })

    traceCollector.startTrace({ type: 'manual', event: 'scope-meta' })
    __trace_set(user, 'value', { id: 1 }, { file: 'src/api/login.ts', line: 72, column: 0 })

    const mutation = traceCollector.getCurrentTrace()!.events.find((e) => e.type === 'mutation') as MutationEvent
    expect(mutation.scope).toBe('module')
    expect(mutation.declaredAt).toEqual({ file: 'src/state/auth.ts', line: 3, column: 0 })
    expect(mutation.source).toEqual({ file: 'src/api/login.ts', line: 72, column: 0 })
  })

  it('shows GLOBAL REACTIVE badge and Declared/Modified for module scope, not for local', () => {
    const globalUser = __trace_register(ref(null), {
      name: 'user',
      type: 'ref',
      scope: 'module',
      source: { file: 'src/state/auth.ts', line: 3, column: 0 }
    })
    traceCollector.startTrace({ type: 'manual', event: 'global-ui' })
    __trace_set(globalUser, 'value', { id: 1 }, { file: 'src/api/login.ts', line: 72, column: 0 })

    initDevTools()
    const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
    if (!devtools.querySelector('.vrt-panel')) {
      ;(devtools.querySelector('#vrt-toggle') as HTMLElement).click()
    }

    expect(devtools.innerHTML).toContain('GLOBAL REACTIVE')
    expect(devtools.innerHTML).toContain('Declared')
    expect(devtools.innerHTML).toContain('src/state/auth.ts:3')
    expect(devtools.innerHTML).toContain('Modified')
    expect(devtools.innerHTML).toContain('src/api/login.ts:72')

    traceCollector.clearTraces()
    const localCount = __trace_register(ref(0), {
      name: 'count',
      type: 'ref',
      scope: 'local',
      source: { file: 'src/App.vue', line: 10, column: 0 }
    })
    traceCollector.startTrace({ type: 'manual', event: 'local-ui' })
    __trace_set(localCount, 'value', 1, { file: 'src/App.vue', line: 20, column: 0 })
    ;(devtools.querySelector('#vrt-toggle') as HTMLElement).click()
    ;(devtools.querySelector('#vrt-toggle') as HTMLElement).click()

    expect(devtools.innerHTML).not.toContain('GLOBAL REACTIVE')
    expect(devtools.innerHTML).toContain('Declared')
    expect(devtools.innerHTML).toContain('src/App.vue:10')
    expect(devtools.innerHTML).toContain('Modified')
    expect(devtools.innerHTML).toContain('src/App.vue:20')
  })
})


