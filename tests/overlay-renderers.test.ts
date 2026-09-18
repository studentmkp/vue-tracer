import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  renderTimelineView,
  renderFlowView,
  renderDetailView,
  TimelineInteractionManager,
  attachFlowListeners,
  attachDetailListeners,
  OverlayController,
  createOverlayController,
  safeJsonStringify,
  renderScopeBadge,
  renderLoc
} from '@vue-reactive-trace/devtools-ui'
import {
  traceCollector,
  type TraceViewModel,
  type MutationEvent,
  type AggregatedMutationGroup,
  type ComputedEvent,
  type WatchEvent,
  type ComponentTriggerEvent,
  type ComponentRenderEvent,
  type InteractionEvent,
  type AsyncTaskEvent
} from '@vue-reactive-trace/runtime'

describe('Overlay Renderers & Controller (Issue #16)', () => {
  function createMockTraceViewModel(): TraceViewModel {
    const interaction: InteractionEvent = {
      id: 1,
      traceId: 1,
      type: 'interaction',
      event: 'click',
      targetTag: 'button',
      targetText: 'Submit',
      timestamp: 100
    }

    const asyncTask: AsyncTaskEvent = {
      id: 2,
      traceId: 1,
      type: 'async',
      taskType: 'promise',
      name: 'fetchUserData',
      timestamp: 110
    }

    const mutation: MutationEvent = {
      id: 3,
      traceId: 1,
      type: 'mutation',
      operation: 'set',
      path: ['count'],
      before: 1,
      after: 2,
      timestamp: 120,
      scope: 'composable',
      composable: 'useCounter',
      source: { file: 'src/useCounter.ts', line: 15, column: 5 },
      declaredAt: { file: 'src/useCounter.ts', line: 5, column: 3 },
      affectedComponents: ['Counter']
    }

    const aggregated: AggregatedMutationGroup = {
      id: 4,
      traceId: 1,
      type: 'aggregated-mutation',
      name: 'items',
      operation: 'push',
      count: 5,
      start: 130,
      end: 140,
      duration: 10,
      events: [],
      before: [1],
      after: [1, 2, 3, 4, 5, 6],
      scope: 'module',
      source: { file: 'src/store.ts', line: 20, column: 2 },
      declaredAt: { file: 'src/store.ts', line: 10, column: 2 },
      affectedComponents: ['List']
    }

    const computed: ComputedEvent = {
      id: 5,
      traceId: 1,
      type: 'computed',
      name: 'doubleCount',
      status: 'invalidated',
      timestamp: 145,
      source: { file: 'src/useCounter.ts', line: 8, column: 3 },
      triggeredByMutationId: 3
    }

    const watch: WatchEvent = {
      id: 6,
      traceId: 1,
      type: 'watch',
      name: 'onCountChange',
      timestamp: 150,
      source: { file: 'src/useCounter.ts', line: 12, column: 3 },
      triggeredByMutationId: 3
    }

    const trigger: ComponentTriggerEvent = {
      id: 7,
      traceId: 1,
      type: 'component-trigger',
      componentName: 'Counter',
      file: 'src/Counter.vue',
      timestamp: 155,
      triggeredByMutationId: 3
    }

    const render: ComponentRenderEvent = {
      id: 8,
      traceId: 1,
      type: 'component-render',
      componentName: 'Counter',
      file: 'src/Counter.vue',
      start: 160,
      end: 175,
      duration: 15,
      triggeredByMutationId: 3
    }

    return {
      totalEventCount: 8,
      filteredEventCount: 8,
      visibleEventCount: 8,
      events: [interaction, asyncTask, mutation, aggregated, computed, watch, trigger, render],
      filteredEvents: [interaction, asyncTask, mutation, computed, watch, trigger, render],
      aggregates: [aggregated],
      tracks: {
        interactions: [interaction],
        asyncTasks: [asyncTask],
        mutations: [mutation, aggregated],
        computeds: [computed],
        watches: [watch],
        triggers: [trigger],
        renders: [render]
      }
    }
  }

  describe('Formatters & Utilities', () => {
    it('safeJsonStringify serializes BigInt without throwing', () => {
      const obj = { normal: 42, big: BigInt(9007199254740991) }
      const str = safeJsonStringify(obj)
      expect(str).toContain('"big": "9007199254740991n"')
    })

    it('renderScopeBadge formats global and composable badges correctly', () => {
      expect(renderScopeBadge('module')).toContain('GLOBAL REACTIVE')
      expect(renderScopeBadge('composable')).toContain('COMPOSABLE')
      expect(renderScopeBadge(undefined)).toBe('')
    })

    it('renderLoc formats location clickable spans', () => {
      const loc = renderLoc({ file: 'src/test.ts', line: 42, column: 7 })
      expect(loc).toContain('src/test.ts:42:7')
      expect(loc).toContain('data-file="src/test.ts"')
      expect(loc).toContain('data-line="42"')
      expect(loc).toContain('data-column="7"')
    })
  })

  describe('Timeline Renderer & Interaction Module', () => {
    it('renders timeline directly from a TraceViewModel', () => {
      const vm = createMockTraceViewModel()
      const html = renderTimelineView(vm, {}, { zoomLevel: 1.5, panOffset: 20 })

      expect(html).toContain('vrt-timeline-container')
      expect(html).toContain('vrt-ruler')
      expect(html).toContain('150%')
      // Track assertions
      expect(html).toContain('Interaction')
      expect(html).toContain('Async Tasks')
      expect(html).toContain('Mutations')
      expect(html).toContain('Computed')
      expect(html).toContain('Watch')
      expect(html).toContain('Vue Triggers')
      expect(html).toContain('Vue Updates')
      // Event bars
      expect(html).toContain('data-event-id="1"')
      expect(html).toContain('data-event-id="2"')
      expect(html).toContain('data-event-id="3"')
      expect(html).toContain('data-event-id="4"')
      expect(html).toContain('data-event-id="5"')
      expect(html).toContain('data-event-id="6"')
      expect(html).toContain('data-event-id="7"')
      expect(html).toContain('data-event-id="8"')
      // Aggregated mutation styling
      expect(html).toContain('vrt-event-bar mutation aggregated')
    })

    it('TimelineInteractionManager keeps zoom/pan isolated and dispatches callbacks', () => {
      const onZoomChange = vi.fn()
      const onPanChange = vi.fn()
      const onSelectEvent = vi.fn()
      const onOpenLocation = vi.fn()

      const manager = new TimelineInteractionManager(
        { zoomLevel: 1.0, panOffset: 0 },
        { onZoomChange, onPanChange, onSelectEvent, onOpenLocation }
      )

      expect(manager.getState()).toEqual({ zoomLevel: 1.0, panOffset: 0 })

      manager.zoomIn()
      expect(manager.getState().zoomLevel).toBeCloseTo(1.3)
      expect(onZoomChange).toHaveBeenCalledWith(manager.getState().zoomLevel)

      manager.zoomOut()
      expect(manager.getState().zoomLevel).toBeCloseTo(1.0)

      manager.setPan(50)
      expect(manager.getState().panOffset).toBe(50)
      expect(onPanChange).toHaveBeenCalledWith(50)

      manager.resetZoom()
      expect(manager.getState()).toEqual({ zoomLevel: 1.0, panOffset: 0 })

      // Mount into DOM container and test listeners
      const container = document.createElement('div')
      const vm = createMockTraceViewModel()
      container.innerHTML = renderTimelineView(vm, {}, { zoomLevel: 1.0, panOffset: 0 })
      const cleanup = manager.attachListeners(container)

      // Test event selection click
      const eventBar = container.querySelector('.vrt-event-bar[data-event-id="3"]') as HTMLElement
      expect(eventBar).not.toBeNull()
      eventBar.click()
      expect(onSelectEvent).toHaveBeenCalledWith(3)

      // Test location link click
      const locEl = container.querySelector('.vrt-loc.clickable') as HTMLElement
      expect(locEl).not.toBeNull()
      locEl.click()
      expect(onOpenLocation).toHaveBeenCalledWith(
        expect.objectContaining({ file: expect.any(String), line: expect.any(Number) })
      )

      cleanup()
    })
  })

  describe('Flow Renderer Module', () => {
    it('renders causality flow steps directly from a TraceViewModel', () => {
      const vm = createMockTraceViewModel()
      const html = renderFlowView(vm)

      expect(html).toContain('vrt-flow')
      expect(html).toContain('1. User Interaction')
      expect(html).toContain('2. Async Context')
      expect(html).toContain('3. Reactive Mutation')
      expect(html).toContain('3. Aggregated Mutation')
      expect(html).toContain('4. Watch Triggered')
      expect(html).toContain('5. Computed Invalidated')
      expect(html).toContain('Component Trigger')
      expect(html).toContain('6. Component Update')
      expect(html).toContain('Counter.vue Rendered')
    })

    it('attachFlowListeners handles location clicks and event selection', () => {
      const onOpenLocation = vi.fn()
      const onSelectEvent = vi.fn()
      const vm = createMockTraceViewModel()

      const container = document.createElement('div')
      container.innerHTML = renderFlowView(vm)
      attachFlowListeners(container, { onOpenLocation, onSelectEvent })

      const loc = container.querySelector('.vrt-loc.clickable') as HTMLElement
      expect(loc).not.toBeNull()
      loc.click()
      expect(onOpenLocation).toHaveBeenCalledWith(
        expect.objectContaining({ file: expect.any(String), line: expect.any(Number) })
      )

      const step = container.querySelector('.vrt-step[data-event-id="3"]') as HTMLElement
      expect(step).not.toBeNull()
      step.click()
      expect(onSelectEvent).toHaveBeenCalledWith(3)
    })
  })

  describe('Detail Renderer Module', () => {
    it('renders detail view for each event type and handles BigInt', () => {
      const vm = createMockTraceViewModel()

      // Mutation with BigInt
      const mutationWithBigInt: MutationEvent = {
        id: 99,
        traceId: 1,
        type: 'mutation',
        operation: 'set',
        path: ['bigVal'],
        before: BigInt(100),
        after: BigInt(200),
        timestamp: 100,
        source: { file: 'src/big.ts', line: 1, column: 1 },
        scope: 'module',
        affectedComponents: []
      }

      const mutHtml = renderDetailView(mutationWithBigInt)
      expect(mutHtml).toContain('MUTATION')
      expect(mutHtml).toContain('100n')
      expect(mutHtml).toContain('200n')

      // Aggregated mutation
      const agg = vm.tracks.mutations[1] as AggregatedMutationGroup
      const aggHtml = renderDetailView(agg)
      expect(aggHtml).toContain('AGGREGATED MUTATION')
      expect(aggHtml).toContain('5 batched')

      // Computed
      const compHtml = renderDetailView(vm.tracks.computeds[0])
      expect(compHtml).toContain('COMPUTED')
      expect(compHtml).toContain('doubleCount')

      // Watch
      const watchHtml = renderDetailView(vm.tracks.watches[0])
      expect(watchHtml).toContain('WATCH')
      expect(watchHtml).toContain('onCountChange')

      // Component trigger
      const trigHtml = renderDetailView(vm.tracks.triggers[0])
      expect(trigHtml).toContain('COMPONENT TRIGGER')
      expect(trigHtml).toContain('Counter')

      // Component render
      const rendHtml = renderDetailView(vm.tracks.renders[0])
      expect(rendHtml).toContain('COMPONENT RENDER')
      expect(rendHtml).toContain('Counter.vue')

      // Empty / undefined
      const emptyHtml = renderDetailView(undefined)
      expect(emptyHtml).toContain('Select an event on the timeline to inspect details')
    })

    it('attachDetailListeners routes location clicks', () => {
      const onOpenLocation = vi.fn()
      const container = document.createElement('div')
      container.innerHTML = `<span class="vrt-loc clickable" data-file="App.vue" data-line="10" data-column="2">App.vue:10</span>`
      attachDetailListeners(container, { onOpenLocation })

      ;(container.querySelector('.vrt-loc.clickable') as HTMLElement).click()
      expect(onOpenLocation).toHaveBeenCalledWith({ file: 'App.vue', line: 10, column: 2 })
    })
  })

  describe('OverlayController', () => {
    let controller: OverlayController
    let container: HTMLElement

    beforeEach(() => {
      traceCollector.clearTraces()
      container = document.createElement('div')
      document.body.appendChild(container)
      controller = createOverlayController({ container, autoMount: false })
    })

    afterEach(() => {
      controller.destroy()
      if (container.parentElement) {
        container.parentElement.removeChild(container)
      }
    })

    it('owns chrome (open, close, toggle, activeTab, selectTrace, selectEvent)', () => {
      expect(controller.isOverlayOpen()).toBe(false)

      controller.open()
      expect(controller.isOverlayOpen()).toBe(true)

      controller.close()
      expect(controller.isOverlayOpen()).toBe(false)

      controller.toggle()
      expect(controller.isOverlayOpen()).toBe(true)

      expect(controller.getActiveTab()).toBe('timeline')
      controller.setTab('flow')
      expect(controller.getActiveTab()).toBe('flow')

      traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })
      const trace = traceCollector.getCurrentTrace()!

      controller.selectTrace(trace.id)
      expect(controller.getSelectedTraceId()).toBe(trace.id)

      controller.selectEvent(10)
      expect(controller.getSelectedEventId()).toBe(10)
    })

    it('owns session (recording toggle, clear traces, JSON export)', () => {
      const initialRecording = controller.isRecordingEnabled()
      controller.toggleRecording()
      expect(controller.isRecordingEnabled()).toBe(!initialRecording)
      controller.toggleRecording()
      expect(controller.isRecordingEnabled()).toBe(initialRecording)

      controller.clearTraces()
      expect(traceCollector.getTraces().length).toBe(0)
    })

    it('owns notifications (showNotification toast with timeout)', () => {
      vi.useFakeTimers()
      controller.open()

      controller.showNotification('Test Notification')
      const toast = container.querySelector('#vrt-toast') as HTMLElement
      expect(toast).not.toBeNull()
      expect(toast.textContent).toBe('Test Notification')
      expect(toast.style.opacity).toBe('1')

      vi.advanceTimersByTime(2600)
      expect(toast.style.opacity).toBe('0')
      vi.useRealTimers()
    })

    it('filter state shape strictly matches TraceFilterOptions without ad-hoc parallel state', () => {
      expect(controller.getFilterOptions()).toEqual({})

      controller.setFilter({
        query: 'searchKeyword',
        types: ['mutation'],
        appCodeOnly: true
      })

      expect(controller.getFilterOptions()).toEqual({
        query: 'searchKeyword',
        types: ['mutation'],
        appCodeOnly: true
      })

      controller.open()
      const queryInput = container.querySelector('#vrt-filter-query') as HTMLInputElement
      const typeSelect = container.querySelector('#vrt-filter-type') as HTMLSelectElement
      const appCodeCheckbox = container.querySelector('#vrt-filter-app-code') as HTMLInputElement

      expect(queryInput.value).toBe('searchKeyword')
      expect(typeSelect.value).toBe('mutation')
      expect(appCodeCheckbox.checked).toBe(true)

      controller.clearFilter()
      expect(controller.getFilterOptions()).toEqual({})
      expect((container.querySelector('#vrt-filter-query') as HTMLInputElement).value).toBe('')
      expect((container.querySelector('#vrt-filter-type') as HTMLSelectElement).value).toBe('all')
      expect((container.querySelector('#vrt-filter-app-code') as HTMLInputElement).checked).toBe(false)
    })

    it('obtains Trace view from projection seam and does not call collector filter/aggregate', () => {
      traceCollector.startTrace({ type: 'interaction', event: 'click', targetTag: 'button' })
      const trace = traceCollector.getCurrentTrace()!

      controller.setFilter({ query: 'myQuery' })
      const view = controller.getProjectedView(trace)

      expect(view).toBeDefined()
      expect(view.filteredEvents).toBeDefined()
      expect(view.tracks).toBeDefined()

      // TraceCollector should not have filter or aggregate methods
      expect((traceCollector as any).getFilteredEvents).toBeUndefined()
      expect((traceCollector as any).getAggregatedEvents).toBeUndefined()
      expect((traceCollector as any).filterTraceEvents).toBeUndefined()
      expect((traceCollector as any).aggregateTraceEvents).toBeUndefined()
    })
  })
})
