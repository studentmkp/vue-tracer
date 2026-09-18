import { describe, it, expect, beforeEach } from 'vitest'
import { reactive, ref } from 'vue'
import {
  traceCollector,
  __trace_register,
  __trace_set,
  __trace_update,
  __trace_call,
  __trace_delete,
  getReactiveMeta,
  isRegisteredReactive,
  isVueReactive,
  isRecordableReactive,
  shouldRecordMutation,
  registerReactive,
  registerExternalReactive,
  type MutationEvent
} from '@vue-reactive-trace/runtime'

const loc = { file: 'external-lib.js', line: 10, column: 2 }

describe('instrumentation runtime', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  it('auto-labels unregistered Vue reactives as external when recording', () => {
    const externalState = reactive({ theme: 'dark' })
    traceCollector.startTrace({ type: 'manual', event: 'auto-external-recording' })

    __trace_set(externalState, 'theme', 'light', loc)

    const mutation = traceCollector.getCurrentTrace()!.events.find((e) => e.type === 'mutation') as MutationEvent
    expect(mutation).toBeDefined()
    expect(mutation.isExternal).toBe(true)
    expect(mutation.origin).toBe('external')
    expect(mutation.traceLevel).toBe('partial')
    expect(mutation.confidence).toBe('inferred')
    expect(mutation.scope).toBe('local')
    expect(mutation.path).toEqual(['theme'])
    expect(mutation.source).toEqual(loc)
  })

  it('holds the active-mutation window for the duration of the write', () => {
    const state = __trace_register(reactive({ n: 0 }), { name: 'state', type: 'reactive' })
    traceCollector.startTrace({ type: 'manual', event: 'window' })

    let windowId: number | undefined
    __trace_set(
      state,
      'n',
      () => {
        windowId = traceCollector.getActiveMutation()?.id
        state.n = 1
      },
      loc
    )

    expect(windowId).toBeDefined()
    expect(traceCollector.getActiveMutation()).toBeNull()
    const mutation = traceCollector.getCurrentTrace()!.events.find((e) => e.type === 'mutation') as MutationEvent
    expect(windowId).toBe(mutation.id)
  })

  it('records set / update / mutating call / delete through one implementation with shared identity fields', () => {
    const meta = {
      name: 'state',
      type: 'reactive' as const,
      scope: 'module' as const,
      source: { file: 'state.ts', line: 1, column: 0 }
    }
    const state = __trace_register(reactive({ n: 1, extra: 1 }), meta)
    const tags = __trace_register(reactive(['a']), meta)
    const locApp = { file: 'app.ts', line: 4, column: 2 }

    traceCollector.startTrace({ type: 'manual', event: 'ops' })
    __trace_set(state, 'n', 2, locApp)
    __trace_update(state, 'n', '++', false, locApp)
    __trace_call(tags, 'push', ['b'], locApp, { rootName: 'state', path: ['tags'] })
    __trace_delete(state, 'extra', locApp)

    const mutations = traceCollector
      .getCurrentTrace()!
      .events.filter((e): e is MutationEvent => e.type === 'mutation')

    expect(mutations.map((m) => m.operation)).toEqual(['set', 'increment', 'push', 'delete'])
    for (const m of mutations) {
      expect(m.confidence).toBe('exact')
      expect(m.traceLevel).toBe('full')
      expect(m.isExternal).toBe(false)
      expect(m.scope).toBe('module')
      expect(m.declaredAt).toEqual({ file: 'state.ts', line: 1, column: 0 })
      expect(m.source).toEqual(locApp)
    }
    expect(mutations[0].path).toEqual(['n'])
    expect(mutations[0].pathMode).toBe('property')
    expect(mutations[0].before).toBe(1)
    expect(mutations[0].after).toBe(2)
    expect(mutations[1].path).toEqual(['n'])
    expect(mutations[1].before).toBe(2)
    expect(mutations[1].after).toBe(3)
    expect(mutations[2].path).toEqual(['tags'])
    expect(mutations[2].pathMode).toBe('collection')
    expect(mutations[3].path).toEqual(['extra'])
    expect(mutations[3].after).toBeUndefined()
  })

  describe('Registry lookup vs Mutation policy (Issue #14)', () => {
    it('getReactiveMeta does not mutate registry (no auto-register on get)', () => {
      const plainRef = ref(42)
      const plainReactive = reactive({ foo: 'bar' })

      // Initially not registered
      expect(isRegisteredReactive(plainRef)).toBe(false)
      expect(isRegisteredReactive(plainReactive)).toBe(false)

      // Querying getReactiveMeta returns undefined
      expect(getReactiveMeta(plainRef)).toBeUndefined()
      expect(getReactiveMeta(plainReactive)).toBeUndefined()

      // Registry lookup must not mutate: still not registered
      expect(isRegisteredReactive(plainRef)).toBe(false)
      expect(isRegisteredReactive(plainReactive)).toBe(false)
    })

    it('isRegisteredReactive is not true for any Vue reactive, allowing callers to tell instrumented vs unregistered without recording a write', () => {
      const unregisteredRef = ref(1)
      const unregisteredObj = reactive({ count: 1 })
      const registeredRef = registerReactive(ref(2), { name: 'regRef' })
      const externalRef = registerExternalReactive(ref(3), { name: 'extRef', origin: 'pinia' })
      const plainObj = { count: 1 }

      expect(isRegisteredReactive(unregisteredRef)).toBe(false)
      expect(isRegisteredReactive(unregisteredObj)).toBe(false)
      expect(isRegisteredReactive(plainObj)).toBe(false)

      expect(isRegisteredReactive(registeredRef)).toBe(true)
      expect(isRegisteredReactive(externalRef)).toBe(true)
      expect(getReactiveMeta(registeredRef)?.name).toBe('regRef')
      expect(getReactiveMeta(externalRef)?.origin).toBe('pinia')
    })

    it('answers “Will this write record?” without auto-registering or mutating the registry', () => {
      const unregisteredState = reactive({ a: 1 })
      const plainObj = { a: 1 }
      const instrumentedState = __trace_register(reactive({ a: 1 }), { name: 'myState' })

      expect(isRecordableReactive(unregisteredState)).toBe(true)
      expect(isRecordableReactive(instrumentedState)).toBe(true)
      expect(isRecordableReactive(plainObj)).toBe(false)

      expect(shouldRecordMutation(unregisteredState)).toBe(true)
      expect(shouldRecordMutation(instrumentedState)).toBe(true)
      expect(shouldRecordMutation(plainObj)).toBe(false)

      // When collector is disabled
      traceCollector.setEnabled(false)
      expect(shouldRecordMutation(unregisteredState)).toBe(false)
      expect(shouldRecordMutation(instrumentedState)).toBe(false)
      traceCollector.setEnabled(true)

      // Calling shouldRecordMutation or isRecordableReactive does NOT register unregisteredState
      expect(isRegisteredReactive(unregisteredState)).toBe(false)
      expect(getReactiveMeta(unregisteredState)).toBeUndefined()
    })

    it('mutation recording preserves unregistered status in registry while recording external labels and keeping consistent reactiveId', () => {
      const externalState = reactive({ count: 0 })
      traceCollector.startTrace({ type: 'manual', event: 'policy-test' })

      expect(isRegisteredReactive(externalState)).toBe(false)

      __trace_set(externalState, 'count', 1, loc)
      __trace_update(externalState, 'count', '++', false, loc)

      const trace = traceCollector.getCurrentTrace()!
      const mutations = trace.events.filter((e): e is MutationEvent => e.type === 'mutation')
      expect(mutations).toHaveLength(2)

      // Registration is explicit: recording a write does NOT auto-register in the registry
      expect(isRegisteredReactive(externalState)).toBe(false)
      expect(getReactiveMeta(externalState)).toBeUndefined()

      // Mutation recording owns the external policy
      for (const m of mutations) {
        expect(m.isExternal).toBe(true)
        expect(m.origin).toBe('external')
        expect(m.traceLevel).toBe('partial')
        expect(m.confidence).toBe('inferred')
        expect(m.scope).toBe('local')
      }

      // Both writes share the same synthetic reactiveId
      expect(mutations[0].reactiveId).toBeDefined()
      expect(mutations[0].reactiveId).toBe(mutations[1].reactiveId)
      expect(mutations[0].before).toBe(0)
      expect(mutations[0].after).toBe(1)
      expect(mutations[1].before).toBe(1)
      expect(mutations[1].after).toBe(2)
    })
  })
})

