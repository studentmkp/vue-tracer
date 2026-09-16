import { describe, it, expect, beforeEach } from 'vitest'
import { reactive } from 'vue'
import {
  traceCollector,
  recordInstrumentedMutation,
  __trace_register,
  __trace_set,
  __trace_update,
  __trace_call,
  __trace_delete,
  type MutationEvent
} from '@vue-reactive-trace/runtime'

const loc = { file: 'external-lib.js', line: 10, column: 2 }

describe('mutation recording seam', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  it('auto-labels unregistered Vue reactives as external when recording', () => {
    const externalState = reactive({ theme: 'dark' })
    traceCollector.startTrace({ type: 'manual', event: 'auto-external-recording' })

    recordInstrumentedMutation({
      target: externalState,
      source: loc,
      prop: 'theme',
      pathMode: 'property',
      nameMode: 'root',
      operation: 'set',
      untraced: () => {
        externalState.theme = 'light'
      },
      traced: () => ({
        before: externalState.theme,
        after: () => externalState.theme,
        run: () => {
          externalState.theme = 'light'
        }
      })
    })

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
    recordInstrumentedMutation({
      target: state,
      source: loc,
      prop: 'n',
      pathMode: 'property',
      nameMode: 'root',
      operation: 'set',
      untraced: () => {
        state.n = 1
      },
      traced: () => ({
        before: 0,
        after: 1,
        run: () => {
          windowId = traceCollector.getActiveMutation()?.id
          state.n = 1
        }
      })
    })

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
    expect(mutations[0].before).toBe(1)
    expect(mutations[0].after).toBe(2)
    expect(mutations[1].path).toEqual(['n'])
    expect(mutations[1].before).toBe(2)
    expect(mutations[1].after).toBe(3)
    expect(mutations[2].path).toEqual(['tags'])
    expect(mutations[3].path).toEqual(['extra'])
    expect(mutations[3].after).toBeUndefined()
  })
})
