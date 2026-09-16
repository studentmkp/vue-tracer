import {
  traceCollector,
  queryTraceView,
  findTraceViewItem,
  firstTraceViewItem,
  type Trace,
  type TraceEvent,
  type MutationEvent,
  type ComputedEvent,
  type ComponentRenderEvent,
  type ComponentTriggerEvent,
  type InteractionEvent,
  type AsyncTaskEvent,
  type WatchEvent,
  type AggregatedMutationGroup,
  type TraceFilterOptions,
  type TraceViewModel
} from '@vue-reactive-trace/runtime'

function renderScopeBadge(scope?: MutationEvent['scope']): string {
  if (scope === 'module') return `<span class="vrt-pill amber">GLOBAL REACTIVE</span>`
  if (scope === 'composable') return `<span class="vrt-pill cyan">COMPOSABLE</span>`
  return ''
}

function renderLoc(loc?: { file: string; line: number; column?: number }, empty = '—'): string {
  if (!loc) return empty
  const column = loc.column ?? 0
  return `<span class="vrt-loc clickable" data-file="${loc.file}" data-line="${loc.line}" data-column="${column}" title="Click to open in editor">${loc.file}:${loc.line}${column ? `:${column}` : ''} ↗</span>`
}

export function initDevTools() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  if (document.getElementById('__vue_reactive_trace_devtools__')) return

  const container = document.createElement('div')
  container.id = '__vue_reactive_trace_devtools__'
  document.body.appendChild(container)

  let isOpen = false
  let selectedTraceId: number | null = null
  let selectedEventId: number | null = null
  let activeTab: 'timeline' | 'flow' = 'timeline'
  let zoomLevel = 1.0
  let panOffset = 0
  let isDragging = false
  let dragStartX = 0
  let dragStartPan = 0

  // MVP 3 Filter State
  let filterQuery = ''
  let filterType = 'all'
  let filterAppCodeOnly = false
  let toastMessage = ''
  let toastTimer: any = null

  function showToast(msg: string) {
    toastMessage = msg
    if (toastTimer) clearTimeout(toastTimer)
    const toastEl = container.querySelector('#vrt-toast') as HTMLElement | null
    if (toastEl) {
      toastEl.textContent = msg
      toastEl.style.opacity = '1'
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.opacity = '0'
      }, 2500)
    }
  }

  const style = document.createElement('style')
  style.textContent = `
    #__vue_reactive_trace_devtools__ {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Pro", monospace;
      color: #e2e8f0;
      font-size: 12px;
      line-height: 1.4;
    }
    .vrt-badge {
      background: #0f172a;
      border: 1px solid #334155;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      padding: 7px 16px;
      border-radius: 9999px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 9px;
      font-weight: 600;
      transition: all 0.2s ease;
      user-select: none;
    }
    .vrt-badge:hover {
      border-color: #38bdf8;
      background: #1e293b;
    }
    .vrt-pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    .vrt-panel {
      position: fixed;
      bottom: 60px;
      right: 16px;
      width: 920px;
      max-width: calc(100vw - 32px);
      height: 590px;
      max-height: calc(100vh - 80px);
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .vrt-header {
      padding: 8px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .vrt-title {
      font-weight: 700;
      font-size: 13px;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vrt-tabs {
      display: flex;
      gap: 4px;
      background: #1e293b;
      padding: 2px;
      border-radius: 6px;
    }
    .vrt-tab {
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      border: none;
      background: transparent;
      transition: all 0.15s ease;
    }
    .vrt-tab.active {
      background: #0284c7;
      color: #ffffff;
    }
    .vrt-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .vrt-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .vrt-btn:hover {
      background: #334155;
      color: #fff;
    }
    .vrt-btn.export {
      background: rgba(16, 185, 129, 0.15);
      border-color: #059669;
      color: #34d399;
    }
    .vrt-btn.export:hover {
      background: #059669;
      color: #fff;
    }
    .vrt-filter-bar {
      padding: 6px 12px;
      background: #0b111e;
      border-bottom: 1px solid #1e293b;
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 11px;
    }
    .vrt-filter-input {
      flex: 1;
      background: #04070d;
      border: 1px solid #1e293b;
      border-radius: 4px;
      padding: 3px 8px;
      color: #f1f5f9;
      font-size: 11px;
      outline: none;
    }
    .vrt-filter-input:focus {
      border-color: #38bdf8;
    }
    .vrt-filter-select {
      background: #04070d;
      border: 1px solid #1e293b;
      border-radius: 4px;
      padding: 3px 6px;
      color: #94a3b8;
      font-size: 11px;
      outline: none;
    }
    .vrt-filter-label {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      color: #94a3b8;
      user-select: none;
    }
    .vrt-filter-label input {
      margin: 0;
      cursor: pointer;
    }
    .vrt-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .vrt-sidebar {
      width: 190px;
      border-right: 1px solid #1e293b;
      overflow-y: auto;
      background: #06090e;
    }
    .vrt-sidebar-item {
      padding: 8px 10px;
      border-bottom: 1px solid #141b2d;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .vrt-sidebar-item:hover {
      background: #0f172a;
    }
    .vrt-sidebar-item.active {
      background: #0f172a;
      border-left: 3px solid #38bdf8;
    }
    .vrt-main-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #090d16;
    }
    .vrt-timeline-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .vrt-timeline-toolbar {
      padding: 6px 12px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }
    .vrt-timeline-viewport {
      flex: 1;
      overflow: hidden;
      position: relative;
      cursor: grab;
      user-select: none;
      background: #070a10;
    }
    .vrt-timeline-viewport:active {
      cursor: grabbing;
    }
    .vrt-ruler {
      height: 22px;
      background: #0c111d;
      border-bottom: 1px solid #1e293b;
      position: relative;
      font-size: 10px;
      color: #64748b;
    }
    .vrt-ruler-tick {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px solid #1e293b;
      padding-left: 4px;
      line-height: 22px;
    }
    .vrt-tracks {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: #141b2d;
      position: relative;
    }
    .vrt-track {
      min-height: 38px;
      background: #090d16;
      display: flex;
      position: relative;
      border-bottom: 1px solid #141b2d;
    }
    .vrt-track-header {
      width: 140px;
      min-width: 140px;
      padding: 8px 10px;
      background: #0c111d;
      border-right: 1px solid #1e293b;
      font-weight: 600;
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 2;
    }
    .vrt-track-lane {
      flex: 1;
      position: relative;
      overflow: hidden;
      height: 100%;
    }
    .vrt-event-bar {
      position: absolute;
      top: 7px;
      height: 24px;
      border-radius: 4px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.1s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      z-index: 3;
    }
    .vrt-event-bar:hover {
      filter: brightness(1.25);
      transform: scaleY(1.08);
      z-index: 10;
    }
    .vrt-event-bar.selected {
      outline: 2px solid #ffffff;
      z-index: 11;
    }
    .vrt-event-bar.interaction {
      background: #0284c7;
      color: #ffffff;
    }
    .vrt-event-bar.mutation {
      background: #7c3aed;
      color: #ffffff;
    }
    .vrt-event-bar.computed {
      background: #d97706;
      color: #ffffff;
    }
    .vrt-event-bar.async {
      background: #0891b2;
      color: #ffffff;
    }
    .vrt-event-bar.watch {
      background: #eab308;
      color: #0f172a;
      font-weight: 700;
    }
    .vrt-event-bar.aggregated {
      background: #6d28d9;
      color: #ffffff;
      border: 1px dashed #c084fc;
    }
    .vrt-event-bar.render {
      background: #059669;
      color: #ffffff;
    }
    .vrt-event-bar.trigger {
      background: #0d9488;
      color: #ffffff;
    }
    .vrt-detail-panel {
      height: 195px;
      border-top: 1px solid #1e293b;
      background: #0c111d;
      padding: 12px 16px;
      overflow-y: auto;
    }
    .vrt-detail-title {
      font-size: 12px;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .vrt-detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px 16px;
      font-size: 11px;
    }
    .vrt-detail-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .vrt-detail-label {
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.5px;
    }
    .vrt-detail-val {
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .vrt-pill {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .vrt-pill.blue { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
    .vrt-pill.purple { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
    .vrt-pill.amber { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .vrt-pill.emerald { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .vrt-pill.cyan { background: rgba(8, 145, 178, 0.2); color: #22d3ee; }
    .vrt-pill.yellow { background: rgba(234, 179, 8, 0.2); color: #facc15; }
    .vrt-pill.red { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
    .vrt-pill.teal { background: rgba(20, 184, 166, 0.2); color: #2dd4bf; }
    .vrt-pill.gray { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
    .vrt-empty {
      color: #64748b;
      text-align: center;
      padding: 40px 10px;
    }
    .vrt-flow {
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .vrt-step {
      background: #0f172a;
      border-radius: 8px;
      padding: 10px 14px;
      border-left: 4px solid #64748b;
    }
    .vrt-step.interaction { border-left-color: #38bdf8; }
    .vrt-step.async { border-left-color: #06b6d4; }
    .vrt-step.mutation { border-left-color: #a855f7; }
    .vrt-step.computed { border-left-color: #f59e0b; }
    .vrt-step.watch { border-left-color: #eab308; }
    .vrt-step.render { border-left-color: #10b981; }
    .vrt-step.trigger { border-left-color: #14b8a6; }
    .vrt-step-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .vrt-step.interaction .vrt-step-badge { color: #38bdf8; }
    .vrt-step.async .vrt-step-badge { color: #22d3ee; }
    .vrt-step.mutation .vrt-step-badge { color: #c084fc; }
    .vrt-step.computed .vrt-step-badge { color: #fbbf24; }
    .vrt-step.watch .vrt-step-badge { color: #facc15; }
    .vrt-step.render .vrt-step-badge { color: #34d399; }
    .vrt-step.trigger .vrt-step-badge { color: #2dd4bf; }
    .vrt-step-title {
      font-weight: 600;
      font-size: 12px;
      color: #f1f5f9;
    }
    .vrt-step-detail {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .vrt-arrow {
      text-align: center;
      color: #475569;
      font-size: 14px;
      line-height: 1;
    }
    .vrt-loc {
      color: #e2e8f0;
      background: #1e293b;
      padding: 2px 5px;
      border-radius: 4px;
      display: inline-block;
      font-family: ui-monospace, monospace;
    }
    .vrt-loc.clickable {
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid #334155;
    }
    .vrt-loc.clickable:hover {
      background: #0284c7;
      color: #ffffff;
      border-color: #38bdf8;
    }
    .vrt-toast {
      position: absolute;
      top: 48px;
      right: 16px;
      background: #10b981;
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 99999;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
  `
  document.head.appendChild(style)

  function render() {
    const traces = traceCollector.getTraces()
    const activeTrace = traces.find((t) => t.id === selectedTraceId) || traces[traces.length - 1]

    if (activeTrace && selectedTraceId === null) {
      selectedTraceId = activeTrace.id
    }

    const view = activeTrace ? queryTraceView(activeTrace, getActiveFilterOptions()) : null

    container.innerHTML = `
      <div class="vrt-badge" id="vrt-toggle">
        <span class="vrt-pulse" style="background: ${traceCollector.isEnabled() ? '#10b981' : '#f43f5e'}"></span>
        <span>Vue Trace</span>
        <span style="opacity: 0.6">(${traces.length})</span>
      </div>

      ${
        isOpen
          ? `
        <div class="vrt-panel">
          <div id="vrt-toast" class="vrt-toast">${toastMessage}</div>
          <div class="vrt-header">
            <div class="vrt-title">
              <span>⚡</span> Vue Reactive Trace <span style="font-size: 10px; opacity: 0.6; font-weight: normal;">MVP 2 / MVP 3</span>
            </div>
            <div class="vrt-tabs">
              <button class="vrt-tab ${activeTab === 'timeline' ? 'active' : ''}" id="vrt-tab-timeline">Timeline</button>
              <button class="vrt-tab ${activeTab === 'flow' ? 'active' : ''}" id="vrt-tab-flow">Causality Flow</button>
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
              value="${filterQuery}"
            />
            <select id="vrt-filter-type" class="vrt-filter-select">
              <option value="all" ${filterType === 'all' ? 'selected' : ''}>All Events</option>
              <option value="mutation" ${filterType === 'mutation' ? 'selected' : ''}>Mutations</option>
              <option value="computed" ${filterType === 'computed' ? 'selected' : ''}>Computed</option>
              <option value="watch" ${filterType === 'watch' ? 'selected' : ''}>Watch</option>
              <option value="component-render" ${filterType === 'component-render' ? 'selected' : ''}>Renders</option>
              <option value="component-trigger" ${filterType === 'component-trigger' ? 'selected' : ''}>Triggers</option>
              <option value="async" ${filterType === 'async' ? 'selected' : ''}>Async</option>
            </select>
            <label class="vrt-filter-label" title="Section 42 Noise Reduction: Hide library internals and external events">
              <input type="checkbox" id="vrt-filter-app-code" ${filterAppCodeOnly ? 'checked' : ''} />
              <span>App Code Only</span>
            </label>
            ${
              filterQuery || filterType !== 'all' || filterAppCodeOnly
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
                  : activeTab === 'timeline'
                  ? renderTimelineView(activeTrace, view)
                  : renderFlowView(activeTrace, view)
              }
            </div>
          </div>
        </div>
      `
          : ''
      }
    `

    attachEventListeners(container, traces, activeTrace)
  }

  function getActiveFilterOptions(): TraceFilterOptions {
    return {
      types: filterType === 'all' ? undefined : [filterType],
      query: filterQuery,
      appCodeOnly: filterAppCodeOnly
    }
  }

  function renderTimelineView(trace: Trace, view: TraceViewModel): string {
    const traceStart = trace.startedAt
    const traceEnd = trace.completedAt || trace.startedAt + 50
    const totalDuration = Math.max(traceEnd - traceStart, 20)

    const {
      interactions,
      asyncTasks,
      mutations: mutationItems,
      computeds,
      watches,
      triggers,
      renders
    } = view.tracks

    let selectedEvent: TraceEvent | AggregatedMutationGroup | undefined
    if (selectedEventId) {
      selectedEvent = findTraceViewItem(view, selectedEventId)
    }
    if (!selectedEvent) {
      selectedEvent = firstTraceViewItem(view)
      if (selectedEvent) selectedEventId = selectedEvent.id
    }

    const laneWidthPx = 700 * zoomLevel

    function getLeftPx(timestamp: number): number {
      const ratio = Math.max(0, (timestamp - traceStart) / totalDuration)
      return panOffset + ratio * laneWidthPx
    }

    function getWidthPx(durationMs: number): number {
      const ratio = durationMs / totalDuration
      return Math.max(ratio * laneWidthPx, 24)
    }

    return `
      <div class="vrt-timeline-container">
        <div class="vrt-timeline-toolbar">
          <div style="display: flex; gap: 8px; align-items: center;">
            <span style="color: #64748b;">Duration:</span>
            <strong style="color: #f1f5f9;">${totalDuration.toFixed(2)} ms</strong>
            <span style="color: #64748b; margin-left: 12px;">Events:</span>
            <strong style="color: #f1f5f9;">${view.filteredEventCount} / ${view.totalEventCount}</strong>
            ${
              (trace as any).pendingTasks
                ? `<span class="vrt-pill cyan" style="margin-left: 8px;">Pending Tasks: ${(trace as any).pendingTasks}</span>`
                : ''
            }
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="vrt-btn" id="vrt-zoom-out">-</button>
            <span style="color: #94a3b8; font-variant-numeric: tabular-nums;">${Math.round(zoomLevel * 100)}%</span>
            <button class="vrt-btn" id="vrt-zoom-in">+</button>
            <button class="vrt-btn" id="vrt-zoom-reset">Reset</button>
          </div>
        </div>

        <div class="vrt-timeline-viewport" id="vrt-viewport">
          <div class="vrt-ruler">
            ${[0, 0.25, 0.5, 0.75, 1.0]
              .map((fraction) => {
                const ms = (fraction * totalDuration).toFixed(1)
                const left = panOffset + fraction * laneWidthPx
                return `<div class="vrt-ruler-tick" style="left: ${left}px;">${ms}ms</div>`
              })
              .join('')}
          </div>

          <div class="vrt-tracks">
            <!-- Track 1: Interaction -->
            <div class="vrt-track">
              <div class="vrt-track-header">
                <span class="vrt-pill blue" style="font-size: 9px;">EVENT</span> Interaction
              </div>
              <div class="vrt-track-lane">
                ${interactions
                  .map((evt) => {
                    const left = getLeftPx(evt.timestamp)
                    const width = getWidthPx(12)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar interaction ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="${evt.event.toUpperCase()} <${evt.targetTag}>">
                        ${evt.event.toUpperCase()} &lt;${evt.targetTag}&gt;
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>

            <!-- Track 2: Async Tasks -->
            ${
              asyncTasks.length > 0
                ? `
            <div class="vrt-track">
              <div class="vrt-track-header">
                <span class="vrt-pill cyan" style="font-size: 9px;">ASYNC</span> Async Tasks
              </div>
              <div class="vrt-track-lane">
                ${asyncTasks
                  .map((evt) => {
                    const left = getLeftPx(evt.timestamp)
                    const width = getWidthPx(12)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar async ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="${evt.taskType.toUpperCase()} (${evt.name || 'async'})">
                        ${evt.taskType.toUpperCase()}
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>
            `
                : ''
            }

            <!-- Track 3: Reactive Mutations (with Event Aggregation & MVP 3 Labels) -->
            <div class="vrt-track">
              <div class="vrt-track-header">
                <span class="vrt-pill purple" style="font-size: 9px;">STATE</span> Mutations
              </div>
              <div class="vrt-track-lane">
                ${mutationItems
                  .map((evt) => {
                    const isAgg = evt.type === 'aggregated-mutation'
                    const timestamp = isAgg ? evt.start : evt.timestamp
                    const duration = isAgg ? evt.duration : 16
                    const left = getLeftPx(timestamp)
                    const width = getWidthPx(duration)
                    const isSel = evt.id === selectedEventId
                    const pathStr = !isAgg && evt.path && evt.path.length > 0 ? evt.path.join('.') : ''
                    const composableTag = evt.composable ? `[${evt.composable}] ` : ''
                    const externalTag = evt.isExternal ? `[EXT] ` : ''
                    const displayLabel = isAgg
                      ? `${externalTag}${composableTag}${evt.name} (${evt.count}x ${evt.operation})`
                      : `${externalTag}${composableTag}` + (evt.name || pathStr || 'mutation') + ` (${evt.operation})`
                    return `
                      <div class="vrt-event-bar mutation ${isAgg ? 'aggregated' : ''} ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="${displayLabel}">
                        ${displayLabel}
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>

            <!-- Track 4: Computed -->
            <div class="vrt-track">
              <div class="vrt-track-header">
                <span class="vrt-pill amber" style="font-size: 9px;">COMPUTED</span> Invalidation
              </div>
              <div class="vrt-track-lane">
                ${computeds
                  .map((evt) => {
                    const left = getLeftPx(evt.timestamp)
                    const width = getWidthPx(14)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar computed ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="${evt.name} (${evt.status})">
                        ${evt.name}
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>

            <!-- Track 5: Watch Callbacks -->
            ${
              watches.length > 0
                ? `
            <div class="vrt-track">
              <div class="vrt-track-header">
                <span class="vrt-pill yellow" style="font-size: 9px;">WATCH</span> Callbacks
              </div>
              <div class="vrt-track-lane">
                ${watches
                  .map((evt) => {
                    const left = getLeftPx(evt.timestamp)
                    const width = getWidthPx(14)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar watch ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="WATCH ${evt.name || 'callback'}">
                        WATCH: ${evt.name || 'callback'}
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>
            `
                : ''
            }

            <div class="vrt-track" data-track="component-trigger">
              <div class="vrt-track-header">
                <span class="vrt-pill teal" style="font-size: 9px;">TRIGGER</span> Vue Triggers
              </div>
              <div class="vrt-track-lane">
                ${triggers
                  .map((evt) => {
                    const left = getLeftPx(evt.timestamp)
                    const width = getWidthPx(14)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar trigger ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           data-event-type="component-trigger"
                           style="left: ${left}px; width: ${width}px;"
                           title="${evt.componentName} trigger">
                        ${evt.componentName}
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>

            <!-- Track 6: Component Render -->
            <div class="vrt-track" data-track="component-render">
              <div class="vrt-track-header">
                <span class="vrt-pill emerald" style="font-size: 9px;">RENDER</span> Vue Updates
              </div>
              <div class="vrt-track-lane">
                ${renders
                  .map((evt) => {
                    const left = getLeftPx(evt.start)
                    const width = getWidthPx(evt.duration)
                    const isSel = evt.id === selectedEventId
                    return `
                      <div class="vrt-event-bar render ${isSel ? 'selected' : ''}"
                           data-event-id="${evt.id}"
                           style="left: ${left}px; width: ${width}px;"
                           title="${evt.componentName}.vue (${evt.duration.toFixed(2)}ms)">
                        ${evt.componentName}.vue (${evt.duration.toFixed(1)}ms)
                      </div>
                    `
                  })
                  .join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Section 33 & 34: Event Detail Panel with Open in Editor -->
        <div class="vrt-detail-panel">
          ${renderEventDetail(selectedEvent, trace)}
        </div>
      </div>
    `
  }

  function renderEventDetail(event?: TraceEvent | AggregatedMutationGroup, trace?: Trace): string {
    if (!event) {
      return '<div class="vrt-empty" style="padding: 20px;">Select an event on the timeline to inspect details</div>'
    }

    if (event.type === 'aggregated-mutation') {
      const agg = event as AggregatedMutationGroup
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill purple">AGGREGATED MUTATION</span>
          <span>${agg.name} (${agg.count} operations)</span>
          ${renderScopeBadge(agg.scope)}
          ${agg.composable ? `<span class="vrt-pill cyan">Composable: ${agg.composable}()</span>` : ''}
          ${agg.isExternal ? `<span class="vrt-pill red">EXTERNAL REACTIVE</span>` : ''}
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${agg.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Operation</span>
            <span class="vrt-detail-val" style="color: #38bdf8; font-weight: 600;">${agg.operation}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Mutation Count</span>
            <span class="vrt-detail-val" style="color: #c084fc; font-weight: 700;">${agg.count} batched</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Total Duration</span>
            <span class="vrt-detail-val">${agg.duration.toFixed(2)} ms</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Declared</span>
            <span class="vrt-detail-val">${renderLoc(agg.declaredAt)}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Modified</span>
            <span class="vrt-detail-val">${renderLoc(agg.source)}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Confidence</span>
            <span class="vrt-detail-val" style="color: ${agg.confidence === 'exact' ? '#34d399' : '#facc15'}; font-weight: 700;">
              ${(agg.confidence || 'exact').toUpperCase()}
            </span>
          </div>
          <div class="vrt-detail-item" style="grid-column: 1 / -1;">
            <span class="vrt-detail-label">Value Mutation (Initial Before → Final After)</span>
            <div style="display: flex; gap: 12px; margin-top: 4px;">
              <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
                <div style="color: #f43f5e; font-size: 10px; font-weight: 700; margin-bottom: 2px;">INITIAL BEFORE</div>
                <pre style="margin: 0; font-size: 11px; color: #fca5a5; max-height: 60px; overflow-y: auto;">${JSON.stringify(agg.before, null, 2)}</pre>
              </div>
              <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
                <div style="color: #10b981; font-size: 10px; font-weight: 700; margin-bottom: 2px;">FINAL AFTER</div>
                <pre style="margin: 0; font-size: 11px; color: #86efac; max-height: 60px; overflow-y: auto;">${JSON.stringify(agg.after, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      `
    }

    if (event.type === 'async') {
      const a = event as AsyncTaskEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill cyan">ASYNC TASK</span>
          <span>${a.taskType.toUpperCase()}</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${a.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Async Type</span>
            <span class="vrt-detail-val" style="color: #22d3ee; font-weight: 600;">${a.taskType}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Timestamp</span>
            <span class="vrt-detail-val">${a.timestamp.toFixed(2)} ms</span>
          </div>
        </div>
      `
    }

    if (event.type === 'watch') {
      const w = event as WatchEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill yellow">WATCH</span>
          <span>${w.name || 'watchCallback'}</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${w.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Watch Target</span>
            <span class="vrt-detail-val" style="color: #facc15; font-weight: 600;">${w.name || 'anonymous'}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Triggered At</span>
            <span class="vrt-detail-val">${w.timestamp.toFixed(2)} ms</span>
          </div>
          ${
            w.source
              ? `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Source Location (Click to open)</span>
              <span class="vrt-detail-val">
                <span class="vrt-loc clickable" data-file="${w.source.file}" data-line="${w.source.line}" data-column="${w.source.column}" title="Click to open in editor">
                  ${w.source.file}:${w.source.line}:${w.source.column} ↗
                </span>
              </span>
            </div>
          `
              : ''
          }
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Caused by Mutation</span>
            <span class="vrt-detail-val">${w.triggeredByMutationId ? `#${w.triggeredByMutationId}` : 'Initial / Reaction'}</span>
          </div>
        </div>
      `
    }

    if (event.type === 'mutation') {
      const m = event as MutationEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill purple">MUTATION</span>
          <span>${m.name || 'reactive'}</span>
          ${renderScopeBadge(m.scope)}
          ${m.composable ? `<span class="vrt-pill cyan">Composable: ${m.composable}()</span>` : ''}
          ${m.isExternal ? `<span class="vrt-pill red">EXTERNAL REACTIVE</span>` : ''}
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${m.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Operation</span>
            <span class="vrt-detail-val" style="color: #38bdf8; font-weight: 600;">${m.operation}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Property Path</span>
            <span class="vrt-detail-val">${m.path && m.path.length > 0 ? m.path.join('.') : '(root)'}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Declared</span>
            <span class="vrt-detail-val">${renderLoc(m.declaredAt)}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Modified</span>
            <span class="vrt-detail-val">${renderLoc(m.source)}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Confidence</span>
            <span class="vrt-detail-val" style="color: ${m.confidence === 'exact' ? '#34d399' : '#facc15'}; font-weight: 700;">
              ${(m.confidence || (m.isExternal ? 'inferred' : 'exact')).toUpperCase()}
            </span>
          </div>
          ${
            m.isExternal
              ? `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Origin</span>
              <span class="vrt-detail-val" style="color: #fb7185;">${m.origin || 'external'}</span>
            </div>
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Trace Level</span>
              <span class="vrt-detail-val" style="color: #facc15;">partial</span>
            </div>
          `
              : `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Trace Level</span>
              <span class="vrt-detail-val" style="color: #38bdf8;">full</span>
            </div>
          `
          }
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Affected Components</span>
            <span class="vrt-detail-val">
              ${
                m.affectedComponents.length === 0
                  ? '<span style="color: #64748b;">None</span>'
                  : m.affectedComponents.map((c) => `<span class="vrt-pill emerald" style="margin-right: 4px;">${c}.vue</span>`).join('')
              }
            </span>
          </div>
          <div class="vrt-detail-item" style="grid-column: 1 / -1;">
            <span class="vrt-detail-label">Value Mutation</span>
            <div style="display: flex; gap: 12px; margin-top: 4px;">
              <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
                <div style="color: #f43f5e; font-size: 10px; font-weight: 700; margin-bottom: 2px;">BEFORE</div>
                <pre style="margin: 0; font-size: 11px; color: #fca5a5; max-height: 60px; overflow-y: auto;">${JSON.stringify(m.before, null, 2)}</pre>
              </div>
              <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
                <div style="color: #10b981; font-size: 10px; font-weight: 700; margin-bottom: 2px;">AFTER</div>
                <pre style="margin: 0; font-size: 11px; color: #86efac; max-height: 60px; overflow-y: auto;">${JSON.stringify(m.after, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      `
    }

    if (event.type === 'computed') {
      const c = event as ComputedEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill amber">COMPUTED</span>
          <span>${c.name}</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${c.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Status</span>
            <span class="vrt-detail-val" style="color: #fbbf24; font-weight: 600;">${c.status.toUpperCase()}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Timestamp</span>
            <span class="vrt-detail-val">${c.timestamp.toFixed(2)} ms</span>
          </div>
          ${
            c.source
              ? `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Source Declaration (Click to open)</span>
              <span class="vrt-detail-val">
                <span class="vrt-loc clickable" data-file="${c.source.file}" data-line="${c.source.line}" data-column="${c.source.column}" title="Click to open in editor">
                  ${c.source.file}:${c.source.line}:${c.source.column} ↗
                </span>
              </span>
            </div>
          `
              : ''
          }
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Triggered by Mutation</span>
            <span class="vrt-detail-val">${c.triggeredByMutationId ? `#${c.triggeredByMutationId}` : 'Direct'}</span>
          </div>
        </div>
      `
    }

    if (event.type === 'component-trigger') {
      const t = event as ComponentTriggerEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill teal">COMPONENT TRIGGER</span>
          <span>${t.componentName}</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${t.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Component</span>
            <span class="vrt-detail-val" style="color: #2dd4bf; font-weight: 600;">${t.componentName}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Triggered At</span>
            <span class="vrt-detail-val">${t.timestamp.toFixed(2)} ms</span>
          </div>
          ${
            t.file
              ? `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Component File (Click to open)</span>
              <span class="vrt-detail-val">
                <span class="vrt-loc clickable" data-file="${t.file}" data-line="1" data-column="1" title="Click to open in editor">
                  ${t.file} ↗
                </span>
              </span>
            </div>
          `
              : ''
          }
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Caused by Mutation</span>
            <span class="vrt-detail-val">${t.triggeredByMutationId ? `#${t.triggeredByMutationId}` : 'Initial / Reaction'}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Confidence</span>
            <span class="vrt-detail-val" style="color: #34d399; font-weight: 700;">
              ${(t.confidence || 'runtime').toUpperCase()}
            </span>
          </div>
        </div>
      `
    }

    if (event.type === 'component-render') {
      const r = event as ComponentRenderEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill emerald">COMPONENT RENDER</span>
          <span>${r.componentName}.vue</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${r.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Render Duration</span>
            <span class="vrt-detail-val" style="color: #34d399; font-weight: 700;">${r.duration.toFixed(2)} ms</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Render Window</span>
            <span class="vrt-detail-val">${r.start.toFixed(2)}ms → ${r.end.toFixed(2)}ms</span>
          </div>
          ${
            r.file
              ? `
            <div class="vrt-detail-item">
              <span class="vrt-detail-label">Component File (Click to open)</span>
              <span class="vrt-detail-val">
                <span class="vrt-loc clickable" data-file="${r.file}" data-line="1" data-column="1" title="Click to open in editor">
                  ${r.file} ↗
                </span>
              </span>
            </div>
          `
              : ''
          }
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Caused by Mutation</span>
            <span class="vrt-detail-val">${r.triggeredByMutationId ? `#${r.triggeredByMutationId}` : 'Initial / Batch'}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Confidence</span>
            <span class="vrt-detail-val" style="color: #34d399; font-weight: 700;">
              ${(r.confidence || 'runtime').toUpperCase()}
            </span>
          </div>
        </div>
      `
    }

    if (event.type === 'interaction') {
      const i = event as InteractionEvent
      return `
        <div class="vrt-detail-title">
          <span class="vrt-pill blue">USER INTERACTION</span>
          <span>${i.event.toUpperCase()} &lt;${i.targetTag}&gt;</span>
          <span style="color: #64748b; font-weight: normal; margin-left: auto;">ID: #${i.id}</span>
        </div>
        <div class="vrt-detail-grid">
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Event Type</span>
            <span class="vrt-detail-val" style="color: #38bdf8; font-weight: 600;">${i.event}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Target Tag</span>
            <span class="vrt-detail-val">&lt;${i.targetTag}&gt;</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Target Value / Text</span>
            <span class="vrt-detail-val">${i.targetText || 'None'}</span>
          </div>
          <div class="vrt-detail-item">
            <span class="vrt-detail-label">Interaction Time</span>
            <span class="vrt-detail-val">${i.timestamp.toFixed(2)} ms</span>
          </div>
        </div>
      `
    }

    return ''
  }

  function renderFlowView(trace: Trace, view: TraceViewModel): string {
    const { asyncTasks, mutations: mutationItems, watches, computeds, triggers, renders } = view.tracks

    return `
      <div class="vrt-flow">
        <!-- 1. Interaction -->
        <div class="vrt-step interaction">
          <div class="vrt-step-badge">1. User Interaction</div>
          <div class="vrt-step-title">
            ${trace.trigger.event.toUpperCase()}
            ${trace.trigger.targetTag ? `&lt;${trace.trigger.targetTag}&gt;` : ''}
            ${trace.trigger.targetText ? `"${trace.trigger.targetText}"` : ''}
          </div>
          <div class="vrt-step-detail">
            Started: ${trace.startedAt.toFixed(2)} ms
          </div>
        </div>

        ${
          asyncTasks.length > 0
            ? `
          <div class="vrt-arrow">↓</div>
          <!-- 2. Async Context -->
          <div class="vrt-step async">
            <div class="vrt-step-badge">2. Async Context (${asyncTasks.length} task${asyncTasks.length > 1 ? 's' : ''})</div>
            <div class="vrt-step-title">${asyncTasks.map((a) => a.taskType.toUpperCase()).join(' → ')}</div>
            <div class="vrt-step-detail">Async continuation preserved under Trace #${trace.id}</div>
          </div>
        `
            : ''
        }

        <div class="vrt-arrow">↓</div>

        <!-- 3. Reactive Mutations -->
        ${
          mutationItems.length === 0
            ? '<div class="vrt-step" style="opacity: 0.6;">No reactive mutations matching current filter</div>'
            : mutationItems
                .map((m) => {
                  if (m.type === 'aggregated-mutation') {
                    return `
                      <div class="vrt-step mutation">
                        <div class="vrt-step-badge">
                          3. Aggregated Mutation (${m.count} ops)
                          ${renderScopeBadge(m.scope)}
                          ${m.composable ? `<span class="vrt-pill cyan" style="margin-left: 6px;">${m.composable}()</span>` : ''}
                          ${m.isExternal ? `<span class="vrt-pill red" style="margin-left: 6px;">EXTERNAL REACTIVE</span>` : ''}
                        </div>
                        <div class="vrt-step-title">
                          ${m.name}:
                          <span style="color: #f43f5e">${JSON.stringify(m.before)}</span>
                          →
                          <span style="color: #10b981">${JSON.stringify(m.after)}</span>
                        </div>
                        <div class="vrt-step-detail">
                          Operation: <strong style="color: #38bdf8;">${m.count}x ${m.operation}</strong> (${m.duration.toFixed(2)}ms)<br/>
                          Declared: ${renderLoc(m.declaredAt)}<br/>
                          Modified: ${renderLoc(m.source)}<br/>
                          Confidence: <strong style="color: ${m.confidence === 'exact' ? '#34d399' : '#facc15'}">${(m.confidence || 'exact').toUpperCase()}</strong><br/>
                          Affected: ${
                            m.affectedComponents.length > 0
                              ? m.affectedComponents.map((c) => `<span class="vrt-pill emerald">${c}.vue</span>`).join(' ')
                              : 'None'
                          }
                        </div>
                      </div>
                    `
                  }
                  return `
                    <div class="vrt-step mutation">
                      <div class="vrt-step-badge">
                        3. Reactive Mutation
                        ${renderScopeBadge(m.scope)}
                        ${m.composable ? `<span class="vrt-pill cyan" style="margin-left: 6px;">${m.composable}()</span>` : ''}
                        ${m.isExternal ? `<span class="vrt-pill red" style="margin-left: 6px;">EXTERNAL REACTIVE</span>` : ''}
                      </div>
                      <div class="vrt-step-title">
                        ${m.name || 'reactive'}:
                        <span style="color: #f43f5e">${JSON.stringify(m.before)}</span>
                        →
                        <span style="color: #10b981">${JSON.stringify(m.after)}</span>
                      </div>
                      <div class="vrt-step-detail">
                        Operation: <strong style="color: #38bdf8;">${m.operation}</strong><br/>
                        ${m.path && m.path.length > 0 ? `Path: ${m.path.join('.')}<br/>` : ''}
                        Declared: ${renderLoc(m.declaredAt)}<br/>
                        Modified: ${renderLoc(m.source)}<br/>
                        Confidence: <strong style="color: ${m.confidence === 'exact' ? '#34d399' : '#facc15'}">${(m.confidence || (m.isExternal ? 'inferred' : 'exact')).toUpperCase()}</strong><br/>
                        Affected: ${
                          m.affectedComponents.length > 0
                            ? m.affectedComponents.map((c) => `<span class="vrt-pill emerald">${c}.vue</span>`).join(' ')
                            : 'None'
                        }
                      </div>
                    </div>
                  `
                })
                .join('<div class="vrt-arrow">↓</div>')
        }

        ${
          watches.length > 0
            ? `
          <div class="vrt-arrow">↓</div>
          <!-- 4. Watch Callbacks -->
          ${watches
            .map(
              (w) => `
            <div class="vrt-step watch">
              <div class="vrt-step-badge">4. Watch Triggered</div>
              <div class="vrt-step-title">${w.name || 'watchCallback'}</div>
              <div class="vrt-step-detail">
                Executed at ${w.timestamp.toFixed(2)} ms
                ${w.source ? `<br/>Source: <span class="vrt-loc clickable" data-file="${w.source.file}" data-line="${w.source.line}">${w.source.file}:${w.source.line} ↗</span>` : ''}
              </div>
            </div>
          `
            )
            .join('<div class="vrt-arrow">↓</div>')}
        `
            : ''
        }

        ${
          computeds.length > 0
            ? `
          <div class="vrt-arrow">↓</div>
          <!-- 5. Computed Invalidations -->
          ${computeds
            .map(
              (c) => `
            <div class="vrt-step computed">
              <div class="vrt-step-badge">5. Computed Invalidated</div>
              <div class="vrt-step-title">${c.name}</div>
              <div class="vrt-step-detail">
                Status: ${c.status} at ${c.timestamp.toFixed(2)} ms
                ${c.source ? `<br/>Declared: <span class="vrt-loc clickable" data-file="${c.source.file}" data-line="${c.source.line}">${c.source.file}:${c.source.line} ↗</span>` : ''}
              </div>
            </div>
          `
            )
            .join('<div class="vrt-arrow">↓</div>')}
        `
            : ''
        }

        ${
          triggers.length > 0
            ? `
          <div class="vrt-arrow">↓</div>
          ${triggers
            .map(
              (t) => `
            <div class="vrt-step trigger" data-event-type="component-trigger">
              <div class="vrt-step-badge">Component Trigger</div>
              <div class="vrt-step-title">${t.componentName}</div>
              <div class="vrt-step-detail">
                Triggered at ${t.timestamp.toFixed(2)} ms
                ${t.triggeredByMutationId ? `<br/>Caused by mutation #${t.triggeredByMutationId}` : ''}
                ${t.file ? `<br/>File: <span class="vrt-loc clickable" data-file="${t.file}" data-line="1" data-column="1">${t.file} ↗</span>` : ''}
              </div>
            </div>
          `
            )
            .join('<div class="vrt-arrow">↓</div>')}
        `
            : ''
        }

        <div class="vrt-arrow">↓</div>

        <!-- 6. Vue Component Render -->
        ${
          renders.length === 0
            ? '<div class="vrt-step" style="opacity: 0.6;">No component renders matching current filter</div>'
            : renders
                .map(
                  (r) => `
              <div class="vrt-step render">
                <div class="vrt-step-badge">6. Component Update</div>
                <div class="vrt-step-title">
                  ${r.componentName}.vue Rendered
                </div>
                <div class="vrt-step-detail">
                  Duration: ${r.duration.toFixed(2)} ms<br/>
                  ${r.file ? `File: <span class="vrt-loc clickable" data-file="${r.file}">${r.file} ↗</span>` : ''}
                </div>
              </div>
            `
                )
                .join('')
        }
      </div>
    `
  }

  function attachEventListeners(container: HTMLElement, traces: Trace[], activeTrace?: Trace) {
    const toggleBtn = container.querySelector('#vrt-toggle')
    toggleBtn?.addEventListener('click', () => {
      isOpen = !isOpen
      render()
    })

    const closeBtn = container.querySelector('#vrt-close')
    closeBtn?.addEventListener('click', () => {
      isOpen = false
      render()
    })

    const clearBtn = container.querySelector('#vrt-clear')
    clearBtn?.addEventListener('click', () => {
      traceCollector.clearTraces()
      selectedTraceId = null
      selectedEventId = null
      render()
    })

    const recBtn = container.querySelector('#vrt-toggle-rec')
    recBtn?.addEventListener('click', () => {
      traceCollector.setEnabled(!traceCollector.isEnabled())
      render()
    })

    // Trace export
    const exportBtn = container.querySelector('#vrt-export-json')
    exportBtn?.addEventListener('click', () => {
      if (!activeTrace) return
      const json = traceCollector.exportTracesAsJSON(activeTrace.id)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vue-trace-${activeTrace.id}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(`Trace #${activeTrace.id} exported as JSON`)
    })

    // Filter bar listeners
    const queryInput = container.querySelector('#vrt-filter-query') as HTMLInputElement | null
    queryInput?.addEventListener('input', (e) => {
      filterQuery = (e.target as HTMLInputElement).value
      render()
    })

    const typeSelect = container.querySelector('#vrt-filter-type') as HTMLSelectElement | null
    typeSelect?.addEventListener('change', (e) => {
      filterType = (e.target as HTMLSelectElement).value
      render()
    })

    const appCodeCheckbox = container.querySelector('#vrt-filter-app-code') as HTMLInputElement | null
    appCodeCheckbox?.addEventListener('change', (e) => {
      filterAppCodeOnly = (e.target as HTMLInputElement).checked
      render()
    })

    const filterResetBtn = container.querySelector('#vrt-filter-reset')
    filterResetBtn?.addEventListener('click', () => {
      filterQuery = ''
      filterType = 'all'
      filterAppCodeOnly = false
      render()
    })

    // Open in Editor links
    const clickableLocs = container.querySelectorAll('.vrt-loc.clickable')
    clickableLocs.forEach((loc) => {
      loc.addEventListener('click', (e) => {
        e.stopPropagation()
        const file = loc.getAttribute('data-file')
        const line = loc.getAttribute('data-line') || '1'
        const column = loc.getAttribute('data-column') || '1'
        if (file) {
          fetch(
            `/__reactive-trace/open-source?file=${encodeURIComponent(file)}&line=${line}&column=${column}`
          )
            .then((r) => r.json())
            .then((res) => {
              showToast(`Opened ${file}:${line}`)
            })
            .catch(() => {
              showToast(`Opening ${file}:${line}...`)
            })
        }
      })
    })

    const tabTimeline = container.querySelector('#vrt-tab-timeline')
    tabTimeline?.addEventListener('click', () => {
      activeTab = 'timeline'
      render()
    })

    const tabFlow = container.querySelector('#vrt-tab-flow')
    tabFlow?.addEventListener('click', () => {
      activeTab = 'flow'
      render()
    })

    const sidebarItems = container.querySelectorAll('.vrt-sidebar-item')
    sidebarItems.forEach((el) => {
      el.addEventListener('click', () => {
        const id = Number(el.getAttribute('data-id'))
        selectedTraceId = id
        selectedEventId = null
        render()
      })
    })

    const zoomInBtn = container.querySelector('#vrt-zoom-in')
    zoomInBtn?.addEventListener('click', () => {
      zoomLevel = Math.min(zoomLevel * 1.3, 10)
      render()
    })

    const zoomOutBtn = container.querySelector('#vrt-zoom-out')
    zoomOutBtn?.addEventListener('click', () => {
      zoomLevel = Math.max(zoomLevel / 1.3, 0.5)
      render()
    })

    const zoomResetBtn = container.querySelector('#vrt-zoom-reset')
    zoomResetBtn?.addEventListener('click', () => {
      zoomLevel = 1.0
      panOffset = 0
      render()
    })

    const eventBars = container.querySelectorAll('.vrt-event-bar')
    eventBars.forEach((bar) => {
      bar.addEventListener('click', (e) => {
        e.stopPropagation()
        const eventId = Number(bar.getAttribute('data-event-id'))
        selectedEventId = eventId
        render()
      })
    })

    const viewport = container.querySelector('#vrt-viewport') as HTMLElement | null
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault()
        if (e.deltaY < 0) {
          zoomLevel = Math.min(zoomLevel * 1.15, 10)
        } else {
          zoomLevel = Math.max(zoomLevel / 1.15, 0.5)
        }
        render()
      })

      viewport.addEventListener('mousedown', (e) => {
        isDragging = true
        dragStartX = e.clientX
        dragStartPan = panOffset
      })

      const win = typeof window !== 'undefined' ? window : (globalThis as any)
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('mousemove', (e: any) => {
          if (!isDragging) return
          const dx = e.clientX - dragStartX
          panOffset = dragStartPan + dx
          render()
        })

        win.addEventListener('mouseup', () => {
          isDragging = false
        })
      }
    }
  }

  traceCollector.subscribe(() => {
    render()
  })

  render()
}
