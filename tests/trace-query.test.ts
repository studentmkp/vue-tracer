import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  traceCollector,
  queryTraceView,
  type MutationEvent
} from '@vue-reactive-trace/runtime'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

function openOverlay() {
  initDevTools()
  const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
  if (!devtools.querySelector('.vrt-panel')) {
    const toggle = devtools.querySelector('#vrt-toggle') as HTMLElement
    toggle.click()
  }
  return document.getElementById('__vue_reactive_trace_devtools__')!
}

describe('Trace query view-model', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  it('puts component-trigger on its own track and keeps mutation aggregation', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'query-test' })!
    for (let i = 0; i < 5; i++) {
      traceCollector.recordMutation({
        name: 'items',
        operation: 'push',
        before: [i - 1],
        after: [i],
        source: { file: 'items.ts', line: 10, column: 2 }
      })
    }
    traceCollector.recordComponentTrigger('CartBadge', 'CartBadge.vue')
    traceCollector.recordComponentRender('CartBadge', 10, 12, 'CartBadge.vue')

    const view = queryTraceView(trace)

    expect(view.filteredEventCount).toBe(trace.events.length)
    expect(view.tracks.mutations).toHaveLength(1)
    expect(view.tracks.mutations[0].type).toBe('aggregated-mutation')
    expect(view.tracks.triggers).toHaveLength(1)
    expect(view.tracks.triggers[0].componentName).toBe('CartBadge')
    expect(view.tracks.renders).toHaveLength(1)
  })

  it('type filter mutation still yields aggregated mutation groups', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'filter-agg' })!
    for (let i = 0; i < 4; i++) {
      traceCollector.recordMutation({
        name: 'n',
        operation: 'set',
        before: i,
        after: i + 1,
        source: { file: 'n.ts', line: 1, column: 0 }
      })
    }
    traceCollector.recordComponentTrigger('App', 'App.vue')

    const view = queryTraceView(trace, { types: ['mutation'] })
    expect(view.tracks.mutations).toHaveLength(1)
    expect(view.tracks.mutations[0].type).toBe('aggregated-mutation')
    expect(view.tracks.triggers).toHaveLength(0)
    expect(view.filteredEventCount).toBe(4)
  })

  it('type filter component-trigger hides mutations', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'filter-trigger' })!
    traceCollector.recordMutation({
      name: 'n',
      operation: 'set',
      before: 0,
      after: 1,
      source: { file: 'n.ts', line: 1, column: 0 }
    })
    traceCollector.recordComponentTrigger('App', 'src/App.vue')

    const view = queryTraceView(trace, { types: ['component-trigger'] })
    expect(view.tracks.triggers).toHaveLength(1)
    expect(view.tracks.mutations).toHaveLength(0)
  })

  it('query matches component-trigger by component name and file', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'query-name' })!
    traceCollector.recordComponentTrigger('CartBadge', 'src/CartBadge.vue')
    traceCollector.recordComponentTrigger('ThemeToggle', 'src/ThemeToggle.vue')

    const byName = queryTraceView(trace, { query: 'cart' })
    expect(byName.tracks.triggers.map((t) => t.componentName)).toEqual(['CartBadge'])

    const byFile = queryTraceView(trace, { query: 'ThemeToggle.vue' })
    expect(byFile.tracks.triggers.map((t) => t.componentName)).toEqual(['ThemeToggle'])
  })

  it('appCodeOnly hides component-trigger from node_modules files', () => {
    const trace = traceCollector.startTrace({ type: 'manual', event: 'app-only' })!
    traceCollector.recordComponentTrigger('App', 'src/App.vue')
    traceCollector.recordComponentTrigger('LibWidget', 'node_modules/lib/Widget.vue')

    const view = queryTraceView(trace, { appCodeOnly: true })
    expect(view.tracks.triggers.map((t) => t.componentName)).toEqual(['App'])
  })
})

describe('Overlay consumes one trace query including component-trigger', () => {
  beforeEach(() => {
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    const reset = document.querySelector('#vrt-filter-reset') as HTMLElement | null
    reset?.click()
    const timeline = document.querySelector('#vrt-tab-timeline') as HTMLElement | null
    timeline?.click()
  })

  it('renders component-trigger on timeline and in flow with location chip', () => {
    traceCollector.startTrace({ type: 'manual', event: 'overlay-trigger' })
    const mutation = traceCollector.recordMutation({
      name: 'count',
      operation: 'set',
      before: 0,
      after: 1,
      source: { file: 'src/App.vue', line: 8, column: 2 }
    }) as MutationEvent
    traceCollector.setActiveMutation(mutation)
    traceCollector.recordComponentTrigger('App', 'src/App.vue')
    traceCollector.setActiveMutation(null)
    traceCollector.recordComponentRender('App', 1, 3, 'src/App.vue')

    const devtools = openOverlay()

    expect(devtools.querySelector('[data-track="component-trigger"]')).not.toBeNull()
    const triggerBar = devtools.querySelector('.vrt-event-bar.trigger') as HTMLElement
    expect(triggerBar).not.toBeNull()
    expect(triggerBar.getAttribute('data-event-type')).toBe('component-trigger')
    expect(triggerBar.textContent).toContain('App')

    triggerBar.click()
    expect(devtools.innerHTML).toContain('COMPONENT TRIGGER')
    expect(devtools.innerHTML).toContain(`#${mutation.id}`)

    const loc = devtools.querySelector('.vrt-detail-panel .vrt-loc.clickable') as HTMLElement
    expect(loc).not.toBeNull()
    expect(loc.getAttribute('data-file')).toBe('src/App.vue')

    const flowTab = devtools.querySelector('#vrt-tab-flow') as HTMLElement
    flowTab.click()
    expect(devtools.querySelector('.vrt-step.trigger')).not.toBeNull()
    expect(devtools.querySelector('.vrt-flow')?.textContent).toContain('App')
    expect(devtools.querySelectorAll('.vrt-loc.clickable').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps timeline and flow in sync when the type filter changes', () => {
    traceCollector.startTrace({ type: 'manual', event: 'filter-sync' })
    traceCollector.recordMutation({
      name: 'count',
      operation: 'set',
      before: 0,
      after: 1,
      source: { file: 'src/count.ts', line: 1, column: 0 }
    })
    traceCollector.recordComponentTrigger('App', 'src/App.vue')

    const devtools = openOverlay()

    expect(devtools.querySelector('.vrt-event-bar.mutation')).not.toBeNull()
    expect(devtools.querySelector('.vrt-event-bar.trigger')).not.toBeNull()

    const typeSelect = devtools.querySelector('#vrt-filter-type') as HTMLSelectElement
    typeSelect.value = 'component-trigger'
    typeSelect.dispatchEvent(new Event('change'))

    expect(devtools.querySelector('.vrt-event-bar.trigger')).not.toBeNull()
    expect(devtools.querySelector('.vrt-event-bar.mutation')).toBeNull()

    ;(devtools.querySelector('#vrt-tab-flow') as HTMLElement).click()
    expect(devtools.querySelector('.vrt-step.trigger')).not.toBeNull()
    expect(devtools.querySelector('.vrt-step.mutation')).toBeNull()
  })
})
