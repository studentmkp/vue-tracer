import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import {
  IDLE_COMPLETION_MS,
  __trace_register,
  __trace_set,
  queryTraceView,
  traceCollector,
  traceSession,
  uninstallTracing,
  type Trace,
  type TraceEvent,
  type TraceEventType
} from '@vue-reactive-trace/runtime'
import { buildConfigureCall, transformCode } from '@vue-reactive-trace/vite'

const source = { file: 'src/App.vue', line: 8, column: 2 }

function recordMutation() {
  const mutation = traceCollector.recordMutation({
    name: 'count',
    operation: 'set',
    before: 0,
    after: 1,
    source
  })
  expect(mutation).not.toBeNull()
  return mutation!
}

function expectCausalIdsToResolve(trace: Trace): void {
  const mutationIds = new Set(
    trace.events.filter((event) => event.type === 'mutation').map((event) => event.id)
  )

  for (const event of trace.events) {
    if ('triggeredByMutationId' in event && event.triggeredByMutationId !== undefined) {
      expect(event.traceId).toBe(trace.id)
      expect(mutationIds.has(event.triggeredByMutationId)).toBe(true)
    }
  }
}

function eventTypes(trace: Trace): TraceEventType[] {
  return trace.events.map((event) => event.type)
}

describe('collector recording event allow-list', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    uninstallTracing()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
    traceCollector.configureRecording()
  })

  afterEach(() => {
    traceCollector.configureRecording()
    traceCollector.clearTraces()
    uninstallTracing()
    vi.useRealTimers()
  })

  it('retains every recorded event type when events is unset', () => {
    const target = document.createElement('button')
    target.textContent = 'Save'
    const trace = traceCollector.startInteractionTrace('click', target, source)!
    const mutation = recordMutation()

    traceCollector.setActiveMutation(mutation)
    traceCollector.recordComputedInvalidated({ name: 'doubleCount', source })
    traceCollector.recordWatchExecuted({ name: 'persistCount', source })
    traceCollector.recordComponentTrigger('Counter', 'src/Counter.vue')
    traceCollector.recordComponentRender('Counter', 10, 12, 'src/Counter.vue')
    traceCollector.setActiveMutation(null)
    traceCollector.recordAsyncTask('promise', 'save-request')

    expect(new Set(eventTypes(trace))).toEqual(
      new Set<TraceEventType>([
        'interaction',
        'mutation',
        'computed',
        'watch',
        'component-trigger',
        'component-render',
        'async'
      ])
    )
    expect(queryTraceView(trace).totalEventCount).toBe(trace.events.length)
  })

  it('stores only event types in the configured allow-list', () => {
    traceCollector.configureRecording({ events: ['mutation', 'component-render'] })
    const trace = traceCollector.startInteractionTrace('click', document.createElement('button'))!
    const mutation = recordMutation()

    traceCollector.setActiveMutation(mutation)
    traceCollector.recordComputedInvalidated({ name: 'doubleCount' })
    traceCollector.recordWatchExecuted({ name: 'persistCount' })
    traceCollector.recordComponentTrigger('Counter', 'src/Counter.vue')
    traceCollector.recordComponentRender('Counter', 10, 12, 'src/Counter.vue')
    traceCollector.setActiveMutation(null)
    traceCollector.recordAsyncTask('promise')

    expect(eventTypes(trace)).toEqual(['mutation', 'component-render'])
  })

  it('treats an empty allow-list as no event storage while keeping the Trace', () => {
    traceCollector.configureRecording({ events: [] })
    const target = document.createElement('button')
    target.textContent = 'Do it'
    const trace = traceCollector.startInteractionTrace('click', target, source)!

    const mutation = traceCollector.recordMutation({
      name: 'count',
      operation: 'set',
      before: 0,
      after: 1,
      source
    })

    expect(mutation).toBeNull()
    expect(trace.events).toEqual([])
    expect(trace.trigger).toMatchObject({
      type: 'interaction',
      event: 'click',
      targetTag: 'button',
      targetText: 'Do it'
    })
    expect(trace.startedAt).toBeTypeOf('number')
    expect(trace.status).toBe('active')
  })

  it('does not suppress the actual reactive write when mutation storage is disabled', () => {
    traceCollector.configureRecording({ events: [] })
    const state = __trace_register(reactive({ count: 0 }), {
      name: 'state',
      type: 'reactive'
    })
    traceCollector.startTrace({ type: 'manual', event: 'dropped-write' })

    __trace_set(state, 'count', 2, source)

    expect(state.count).toBe(2)
    expect(traceCollector.getCurrentTrace()!.events).toEqual([])
  })

  it('preserves interaction and automatically-created manual triggers', () => {
    traceCollector.configureRecording({ events: [] })
    const interaction = traceCollector.startInteractionTrace('input', document.createElement('input'))!
    expect(interaction.trigger.type).toBe('interaction')
    expect(interaction.events).toEqual([])

    traceCollector.clearTraces()
    const mutation = traceCollector.recordMutation({
      name: 'count',
      operation: 'set',
      before: 0,
      after: 1,
      source
    })
    const manual = traceCollector.getTraces()[0]

    expect(mutation).toBeNull()
    expect(manual.trigger).toMatchObject({ type: 'manual', event: 'mutation' })
    expect(manual.events).toEqual([])
  })

  it('keeps causal ids when both mutation and dependent events are retained', () => {
    traceCollector.configureRecording({
      events: ['mutation', 'computed', 'watch', 'component-trigger', 'component-render']
    })
    const trace = traceCollector.startTrace({ type: 'manual', event: 'causality' })!
    const mutation = recordMutation()

    traceCollector.setActiveMutation(mutation)
    traceCollector.recordComputedInvalidated({ name: 'doubleCount' })
    traceCollector.recordWatchExecuted({ name: 'persistCount' })
    traceCollector.recordComponentTrigger('Counter', 'src/Counter.vue', {
      triggeredByMutationId: mutation.id
    })
    traceCollector.setActiveMutation(null)
    traceCollector.recordComponentRender('Counter', 10, 12, 'src/Counter.vue', {
      triggeredByMutationId: mutation.id
    })

    expect(
      trace.events
        .filter(
          (event): event is Extract<TraceEvent, { triggeredByMutationId?: number }> =>
            'triggeredByMutationId' in event
        )
        .map((event) => event.triggeredByMutationId)
    ).toEqual([mutation.id, mutation.id, mutation.id, mutation.id])
    expectCausalIdsToResolve(trace)
  })

  it('de-links dependent events when their mutation was dropped', () => {
    traceCollector.configureRecording({
      events: ['computed', 'watch', 'component-trigger', 'component-render']
    })
    const trace = traceCollector.startTrace({ type: 'manual', event: 'dropped-cause' })!
    const dropped = traceCollector.recordMutation({
      name: 'count',
      operation: 'set',
      before: 0,
      after: 1,
      source
    })
    traceCollector.setActiveMutation(null)

    traceCollector.recordComputedInvalidated({ name: 'doubleCount' })
    traceCollector.recordWatchExecuted({ name: 'persistCount' })
    traceCollector.recordComponentTrigger('Counter', 'src/Counter.vue')
    traceCollector.recordComponentRender('Counter', 10, 12, 'src/Counter.vue')

    expect(dropped).toBeNull()
    expect(trace.events.some((event) => event.type === 'mutation')).toBe(false)
    expect(trace.events).toHaveLength(4)
    for (const event of trace.events) {
      if ('triggeredByMutationId' in event) expect(event.triggeredByMutationId).toBeUndefined()
    }
    expectCausalIdsToResolve(trace)
  })

  it('keeps adopted continuation lifecycle independent of async event retention', () => {
    traceCollector.configureRecording({ events: ['mutation'] })
    const trace = traceCollector.startInteractionTrace('click')!

    const asyncEvent = traceCollector.adoptAsyncTask(trace, 'promise', 'save-request')
    expect(asyncEvent).toBeNull()
    expect(traceSession.getPendingTasks(trace)).toBe(1)

    const mutation = recordMutation()
    expect(mutation.traceId).toBe(trace.id)
    expect(eventTypes(trace)).toEqual(['mutation'])

    traceCollector.settleAsyncTask(trace)
    expect(traceSession.getPendingTasks(trace)).toBe(0)
    vi.advanceTimersByTime(IDLE_COMPLETION_MS)
    expect(trace.status).toBe('completed')
  })

  it('exports exactly the retained Trace.events without a second config filter', () => {
    traceCollector.configureRecording({ events: ['mutation', 'component-render'] })
    const trace = traceCollector.startInteractionTrace('click')!
    const mutation = recordMutation()
    traceCollector.recordComponentRender('Counter', 10, 12, 'src/Counter.vue', {
      triggeredByMutationId: mutation.id
    })

    const exported = traceCollector.exportTrace(trace.id)
    const json = JSON.parse(traceCollector.exportTracesAsJSON(trace.id))
    const expectedTypes = eventTypes(trace)

    expect(exported.traces[0].events.map((event) => event.type)).toEqual(expectedTypes)
    expect(json.traces[0].events.map((event: TraceEvent) => event.type)).toEqual(expectedTypes)
    expect(exported.summary).toMatchObject({
      tracesCount: 1,
      totalEventsCount: trace.events.length,
      mutationsCount: 1,
      rendersCount: 1
    })
    expect(queryTraceView(trace).totalEventCount).toBe(trace.events.length)
  })
})

describe('Vite events option injection', () => {
  it('injects collector recording config separately from redaction config', () => {
    const call = buildConfigureCall({
      events: ['mutation', 'component-render'],
      redact: ['**.token']
    })
    expect(call).toContain(
      '__trace_configure({ redact: ["**.token"], events: ["mutation","component-render"] });'
    )
    expect(call).not.toContain('traceCollector')
  })

  it('imports and calls the runtime helper when a transformed module sets events', () => {
    const result = transformCode('const count = ref(0)\n', '/src/App.ts', {
      root: '/src',
      events: ['mutation']
    })

    expect(result).not.toBeNull()
    expect(result!.code).toContain('__trace_configure({ events: ["mutation"] })')
    expect(result!.code).not.toContain('traceCollector')
  })
})
