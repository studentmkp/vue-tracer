import {
  projectTraceView,
  traceCollector,
  traceSession,
  type Trace,
  type TraceFilterOptions,
  type TraceViewModel
} from '@vue-reactive-trace/runtime'
import { attachFlowListeners, renderFlowView } from './flow'
import { injectOverlayStyles } from './styles'
import { renderTimelineView, TimelineInteractionManager } from './timeline'
import type { OverlayControllerOptions, SourceLocation, TimelineState } from './types'

export class OverlayController {
  private container: HTMLElement
  private isOpen = false
  private selectedTraceId: number | null = null
  private selectedEventId: number | null = null
  private activeTab: 'timeline' | 'flow' = 'timeline'

  // Filter state matches TraceFilterOptions exactly (no parallel ad-hoc variables)
  private filterOptions: TraceFilterOptions = {}

  // Notifications (toast system)
  private toastMessage = ''
  private toastTimer: any = null

  // Timeline interaction (zoom/pan stay in timeline module)
  private timelineManager: TimelineInteractionManager
  private cleanupTimelineListeners: (() => void) | null = null

  // Subscription cleanup
  private unsubscribeCollector: (() => void) | null = null

  constructor(options?: OverlayControllerOptions) {
    if (typeof document !== 'undefined') {
      injectOverlayStyles(document)
    }

    if (options?.container) {
      this.container = options.container
    } else if (typeof document !== 'undefined') {
      let existing = document.getElementById('__vue_reactive_trace_devtools__')
      if (!existing) {
        existing = document.createElement('div')
        existing.id = '__vue_reactive_trace_devtools__'
        document.body.appendChild(existing)
      }
      this.container = existing
    } else {
      // Non-DOM environment fallback
      this.container = {} as HTMLElement
    }

    if (options?.initialFilter) {
      this.filterOptions = { ...options.initialFilter }
    }
    if (options?.initialTab) {
      this.activeTab = options.initialTab
    }

    this.timelineManager = new TimelineInteractionManager(
      { zoomLevel: 1.0, panOffset: 0 },
      {
        onSelectEvent: (id) => this.selectEvent(id),
        onOpenLocation: (loc) => this.openLocation(loc),
        onZoomChange: () => this.render(),
        onPanChange: () => this.render()
      }
    )

    this.unsubscribeCollector = traceCollector.subscribe(() => {
      this.render()
    })

    if (options?.autoMount !== false) {
      this.render()
    }
  }

  // Chrome ownership
  getContainer(): HTMLElement {
    return this.container
  }

  isOverlayOpen(): boolean {
    return this.isOpen
  }

  open(): void {
    if (!this.isOpen) {
      this.isOpen = true
      this.render()
    }
  }

  close(): void {
    if (this.isOpen) {
      this.isOpen = false
      this.render()
    }
  }

  toggle(): void {
    this.isOpen = !this.isOpen
    this.render()
  }

  getActiveTab(): 'timeline' | 'flow' {
    return this.activeTab
  }

  setTab(tab: 'timeline' | 'flow'): void {
    if (this.activeTab !== tab) {
      this.activeTab = tab
      this.render()
    }
  }

  getSelectedTraceId(): number | null {
    return this.selectedTraceId
  }

  selectTrace(id: number | null): void {
    this.selectedTraceId = id
    this.selectedEventId = null
    this.render()
  }

  getSelectedEventId(): number | null {
    return this.selectedEventId
  }

  selectEvent(id: number | null): void {
    this.selectedEventId = id
    this.render()
  }

  // Filter state ownership (matches TraceFilterOptions shape directly)
  getFilterOptions(): Readonly<TraceFilterOptions> {
    return { ...this.filterOptions }
  }

  setFilter(options: Partial<TraceFilterOptions>): void {
    this.filterOptions = { ...this.filterOptions, ...options }
    this.render()
  }

  clearFilter(): void {
    this.filterOptions = {}
    this.render()
  }

  // Notification ownership
  showNotification(message: string): void {
    this.toastMessage = message
    if (this.toastTimer) clearTimeout(this.toastTimer)
    if (!this.container || !this.container.querySelector) return

    const toastEl = this.container.querySelector('#vrt-toast') as HTMLElement | null
    if (toastEl) {
      toastEl.textContent = message
      toastEl.style.opacity = '1'
      this.toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.opacity = '0'
      }, 2500)
    }
  }

  // Session ownership
  isRecordingEnabled(): boolean {
    return traceCollector.isEnabled()
  }

  toggleRecording(): void {
    traceCollector.setEnabled(!traceCollector.isEnabled())
    this.render()
  }

  clearTraces(): void {
    traceCollector.clearTraces()
    this.selectedTraceId = null
    this.selectedEventId = null
    this.render()
  }

  exportCurrentTrace(): void {
    const activeTrace = this.getActiveTrace()
    if (!activeTrace) return
    const json = traceCollector.exportTracesAsJSON(activeTrace.id)
    if (typeof Blob !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vue-trace-${activeTrace.id}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    this.showNotification(`Trace #${activeTrace.id} exported as JSON`)
  }

  getActiveTrace(): Trace | undefined {
    const traces = traceCollector.getTraces()
    let active =
      this.selectedTraceId === null ? undefined : traces.find((t) => t.id === this.selectedTraceId)
    if (!active) {
      active = traces[traces.length - 1]
      this.selectedTraceId = active ? active.id : null
      if (!active) this.selectedEventId = null
    }
    return active
  }

  openLocation(loc: SourceLocation): void {
    const file = loc.file
    const line = loc.line ?? 1
    const column = loc.column ?? 1
    if (typeof fetch === 'function') {
      fetch(
        `/__reactive-trace/open-source?file=${encodeURIComponent(file)}&line=${line}&column=${column}`
      )
        .then((r) => r.json())
        .then(() => {
          this.showNotification(`Opened ${file}:${line}`)
        })
        .catch(() => {
          this.showNotification(`Opening ${file}:${line}...`)
        })
    }
  }

  // Seam projection: obtains TraceViewModel from projection seam without collector filter/aggregate
  getProjectedView(trace: Trace): TraceViewModel {
    return projectTraceView(trace, this.filterOptions)
  }

  render(): void {
    if (!this.container || typeof this.container.innerHTML !== 'string') return

    if (this.cleanupTimelineListeners) {
      this.cleanupTimelineListeners()
      this.cleanupTimelineListeners = null
    }

    const traces = traceCollector.getTraces()
    const activeTrace = this.getActiveTrace()
    const view = activeTrace ? this.getProjectedView(activeTrace) : null

    const query = this.filterOptions.query ?? ''
    const currentType = this.filterOptions.types?.[0] ?? 'all'
    const appCodeOnly = Boolean(this.filterOptions.appCodeOnly)
    const hasFilter = Boolean(query || currentType !== 'all' || appCodeOnly)

    const pendingTasks = activeTrace ? traceSession.getPendingTasks(activeTrace) : 0
    const timelineState = this.timelineManager.getState()

    this.container.innerHTML = `
      <div class="vrt-badge" id="vrt-toggle">
        <span class="vrt-pulse" style="background: ${traceCollector.isEnabled() ? '#10b981' : '#f43f5e'}"></span>
        <span>Vue Trace</span>
        <span style="opacity: 0.6">(${traces.length})</span>
      </div>

      ${
        this.isOpen
          ? `
        <div class="vrt-panel">
          <div id="vrt-toast" class="vrt-toast">${this.toastMessage}</div>
          <div class="vrt-header">
            <div class="vrt-title">
              <span>⚡</span> Vue Reactive Trace <span style="font-size: 10px; opacity: 0.6; font-weight: normal;">MVP 2 / MVP 3</span>
            </div>
            <div class="vrt-tabs">
              <button class="vrt-tab ${this.activeTab === 'timeline' ? 'active' : ''}" id="vrt-tab-timeline">Timeline</button>
              <button class="vrt-tab ${this.activeTab === 'flow' ? 'active' : ''}" id="vrt-tab-flow">Causality Flow</button>
            </div>
            <div class="vrt-actions">
              <button class="vrt-btn export" id="vrt-export-json" title="Export trace data as JSON">⬇ Export JSON</button>
              <button class="vrt-btn" id="vrt-toggle-rec">${traceCollector.isEnabled() ? 'Pause' : 'Record'}</button>
              <button class="vrt-btn" id="vrt-clear">Clear</button>
              <button class="vrt-btn" id="vrt-close">✕</button>
            </div>
          </div>

          <!-- Section 41 & 42: Advanced Filtering & Noise Reduction -->
          <div class="vrt-filter-bar">
            <input
              type="text"
              id="vrt-filter-query"
              class="vrt-filter-input"
              placeholder="Filter by variable, composable, component, or file..."
              value="${query}"
            />
            <select id="vrt-filter-type" class="vrt-filter-select">
              <option value="all" ${currentType === 'all' ? 'selected' : ''}>All Events</option>
              <option value="mutation" ${currentType === 'mutation' ? 'selected' : ''}>Mutations</option>
              <option value="computed" ${currentType === 'computed' ? 'selected' : ''}>Computed</option>
              <option value="watch" ${currentType === 'watch' ? 'selected' : ''}>Watch</option>
              <option value="component-render" ${currentType === 'component-render' ? 'selected' : ''}>Renders</option>
              <option value="component-trigger" ${currentType === 'component-trigger' ? 'selected' : ''}>Triggers</option>
              <option value="async" ${currentType === 'async' ? 'selected' : ''}>Async</option>
            </select>
            <label class="vrt-filter-label" title="Section 42 Noise Reduction: Hide library internals and external events">
              <input type="checkbox" id="vrt-filter-app-code" ${appCodeOnly ? 'checked' : ''} />
              <span>App Code Only</span>
            </label>
            ${
              hasFilter
                ? '<button class="vrt-btn" id="vrt-filter-reset">Reset Filter</button>'
                : ''
            }
          </div>

          <div class="vrt-body">
            <div class="vrt-sidebar">
              ${
                traces.length === 0
                  ? '<div class="vrt-empty">No traces yet</div>'
                  : traces
                      .map(
                        (t) => `
                    <div class="vrt-sidebar-item ${t.id === activeTrace?.id ? 'active' : ''}" data-id="${t.id}">
                      <div style="font-weight: 600; color: #38bdf8;">
                        ${t.trigger.event.toUpperCase()} #${t.id}
                      </div>
                      <div style="color: #64748b; font-size: 10px; margin-top: 2px;">
                        ${t.trigger.targetTag ? `&lt;${t.trigger.targetTag}&gt;` : ''} ${t.trigger.targetText || ''}
                      </div>
                    </div>
                  `
                      )
                      .reverse()
                      .join('')
              }
            </div>
            <div class="vrt-main-view">
              ${
                !activeTrace || !view
                  ? '<div class="vrt-empty">Interact with the page to start a reactive trace</div>'
                  : this.activeTab === 'timeline'
                  ? renderTimelineView(
                      view,
                      {
                        onSelectEvent: (id) => this.selectEvent(id),
                        onOpenLocation: (loc) => this.openLocation(loc)
                      },
                      {
                        trace: activeTrace,
                        selectedEventId: this.selectedEventId,
                        zoomLevel: timelineState.zoomLevel,
                        panOffset: timelineState.panOffset,
                        pendingTasks
                      }
                    )
                  : renderFlowView(view, {
                      onOpenLocation: (loc) => this.openLocation(loc),
                      onSelectEvent: (id) => this.selectEvent(id)
                    }, { trace: activeTrace, selectedEventId: this.selectedEventId })
              }
            </div>
          </div>
        </div>
      `
          : ''
      }
    `

    this.attachChromeListeners()
  }

  private attachChromeListeners(): void {
    const toggleBtn = this.container.querySelector('#vrt-toggle')
    toggleBtn?.addEventListener('click', () => this.toggle())

    if (!this.isOpen) return

    const closeBtn = this.container.querySelector('#vrt-close')
    closeBtn?.addEventListener('click', () => this.close())

    const clearBtn = this.container.querySelector('#vrt-clear')
    clearBtn?.addEventListener('click', () => this.clearTraces())

    const recBtn = this.container.querySelector('#vrt-toggle-rec')
    recBtn?.addEventListener('click', () => this.toggleRecording())

    const exportBtn = this.container.querySelector('#vrt-export-json')
    exportBtn?.addEventListener('click', () => this.exportCurrentTrace())

    // Tabs
    const tabTimeline = this.container.querySelector('#vrt-tab-timeline')
    tabTimeline?.addEventListener('click', () => this.setTab('timeline'))

    const tabFlow = this.container.querySelector('#vrt-tab-flow')
    tabFlow?.addEventListener('click', () => this.setTab('flow'))

    // Filter controls
    const queryInput = this.container.querySelector('#vrt-filter-query') as HTMLInputElement | null
    queryInput?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value
      this.setFilter({ query: val || undefined })
    })

    const typeSelect = this.container.querySelector('#vrt-filter-type') as HTMLSelectElement | null
    typeSelect?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value
      this.setFilter({ types: val === 'all' ? undefined : [val] })
    })

    const appCodeCheckbox = this.container.querySelector('#vrt-filter-app-code') as HTMLInputElement | null
    appCodeCheckbox?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked
      this.setFilter({ appCodeOnly: checked || undefined })
    })

    const filterResetBtn = this.container.querySelector('#vrt-filter-reset')
    filterResetBtn?.addEventListener('click', () => this.clearFilter())

    // Sidebar items
    const sidebarItems = this.container.querySelectorAll('.vrt-sidebar-item')
    sidebarItems.forEach((el) => {
      el.addEventListener('click', () => {
        const id = Number(el.getAttribute('data-id'))
        if (!Number.isNaN(id)) {
          this.selectTrace(id)
        }
      })
    })

    // Delegate active tab module listeners
    if (this.activeTab === 'timeline') {
      this.cleanupTimelineListeners = this.timelineManager.attachListeners(this.container)
    } else {
      attachFlowListeners(this.container, {
        onOpenLocation: (loc) => this.openLocation(loc),
        onSelectEvent: (id) => this.selectEvent(id)
      })
    }
  }

  destroy(): void {
    if (this.unsubscribeCollector) {
      this.unsubscribeCollector()
      this.unsubscribeCollector = null
    }
    if (this.cleanupTimelineListeners) {
      this.cleanupTimelineListeners()
      this.cleanupTimelineListeners = null
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    if (this.container && typeof this.container.remove === 'function') {
      this.container.remove()
    }
  }
}

export function createOverlayController(options?: OverlayControllerOptions): OverlayController {
  return new OverlayController(options)
}
