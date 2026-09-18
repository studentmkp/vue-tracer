import type {
  AggregatedMutationGroup,
  Trace,
  TraceEvent,
  TraceViewModel
} from '@vue-reactive-trace/runtime'
import { findTraceViewItem, firstTraceViewItem } from '@vue-reactive-trace/runtime'
import { renderDetailView } from './detail'
import type { TimelineCallbacks, TimelineRenderOptions, TimelineState } from './types'

export function renderTimelineView(
  traceOrView: Trace | TraceViewModel,
  callbacksOrView?: TimelineCallbacks | TraceViewModel,
  optionsOrCallbacks?: TimelineRenderOptions | TimelineCallbacks,
  maybeOptions?: TimelineRenderOptions
): string {
  let trace: Trace | undefined
  let view: TraceViewModel
  let callbacks: TimelineCallbacks | undefined
  let options: TimelineRenderOptions | undefined

  if ('tracks' in traceOrView && 'events' in traceOrView) {
    view = traceOrView as TraceViewModel
    if (callbacksOrView && !('tracks' in callbacksOrView)) {
      callbacks = callbacksOrView as TimelineCallbacks
    }
    if (optionsOrCallbacks && !('onSelectEvent' in optionsOrCallbacks)) {
      options = optionsOrCallbacks as TimelineRenderOptions
    }
  } else {
    trace = traceOrView as Trace
    view = callbacksOrView as TraceViewModel
    if (optionsOrCallbacks && ('onSelectEvent' in optionsOrCallbacks || 'onOpenLocation' in optionsOrCallbacks)) {
      callbacks = optionsOrCallbacks as TimelineCallbacks
    }
    options = maybeOptions
  }

  const zoomLevel = options?.zoomLevel ?? 1.0
  const panOffset = options?.panOffset ?? 0
  const selectedEventId = options?.selectedEventId ?? null
  const pendingTasks = options?.pendingTasks

  const traceStart = trace?.startedAt ?? (view.events[0] ? (view.events[0] as any).timestamp ?? 0 : 0)
  const defaultEnd = traceStart + 50
  const traceEnd = trace?.completedAt || (view.events.length > 0 ? Math.max(...view.events.map((e: any) => (e.end || e.timestamp || traceStart))) : defaultEnd)
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
  if (selectedEventId !== null && selectedEventId !== undefined) {
    selectedEvent = findTraceViewItem(view, selectedEventId)
  }
  if (!selectedEvent) {
    selectedEvent = firstTraceViewItem(view)
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
            pendingTasks
              ? `<span class="vrt-pill cyan" style="margin-left: 8px;">Pending Tasks: ${pendingTasks}</span>`
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
                  const isSel = evt.id === (selectedEvent?.id ?? selectedEventId)
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
        ${renderDetailView(selectedEvent, { onOpenLocation: callbacks?.onOpenLocation }, { trace, selectedEventId })}
      </div>
    </div>
  `
}

export class TimelineInteractionManager {
  private zoomLevel: number
  private panOffset: number
  private isDragging = false
  private dragStartX = 0
  private dragStartPan = 0

  constructor(
    initialState?: Partial<TimelineState>,
    private callbacks?: TimelineCallbacks
  ) {
    this.zoomLevel = initialState?.zoomLevel ?? 1.0
    this.panOffset = initialState?.panOffset ?? 0
  }

  getState(): TimelineState {
    return {
      zoomLevel: this.zoomLevel,
      panOffset: this.panOffset
    }
  }

  setZoom(zoom: number): void {
    const clamped = Math.max(0.5, Math.min(10, zoom))
    if (clamped !== this.zoomLevel) {
      this.zoomLevel = clamped
      this.callbacks?.onZoomChange?.(this.zoomLevel)
    }
  }

  zoomIn(): void {
    this.setZoom(this.zoomLevel * 1.3)
  }

  zoomOut(): void {
    this.setZoom(this.zoomLevel / 1.3)
  }

  resetZoom(): void {
    this.zoomLevel = 1.0
    this.panOffset = 0
    this.callbacks?.onZoomChange?.(1.0)
    this.callbacks?.onPanChange?.(0)
  }

  setPan(pan: number): void {
    this.panOffset = pan
    this.callbacks?.onPanChange?.(pan)
  }

  attachListeners(container: HTMLElement): () => void {
    const zoomInBtn = container.querySelector('#vrt-zoom-in')
    const zoomOutBtn = container.querySelector('#vrt-zoom-out')
    const zoomResetBtn = container.querySelector('#vrt-zoom-reset')

    const onZoomIn = () => this.zoomIn()
    const onZoomOut = () => this.zoomOut()
    const onReset = () => this.resetZoom()

    zoomInBtn?.addEventListener('click', onZoomIn)
    zoomOutBtn?.addEventListener('click', onZoomOut)
    zoomResetBtn?.addEventListener('click', onReset)

    // Event selection
    const eventBars = container.querySelectorAll('.vrt-event-bar')
    const barListeners: Array<{ el: Element; fn: (e: Event) => void }> = []
    eventBars.forEach((bar) => {
      const handler = (e: Event) => {
        e.stopPropagation()
        const eventId = Number(bar.getAttribute('data-event-id'))
        if (!Number.isNaN(eventId)) {
          this.callbacks?.onSelectEvent?.(eventId)
        }
      }
      bar.addEventListener('click', handler)
      barListeners.push({ el: bar, fn: handler })
    })

    // Clickable location links in detail panel
    const clickableLocs = container.querySelectorAll('.vrt-loc.clickable')
    const locListeners: Array<{ el: Element; fn: (e: Event) => void }> = []
    clickableLocs.forEach((loc) => {
      const handler = (e: Event) => {
        e.stopPropagation()
        const file = loc.getAttribute('data-file')
        const line = Number(loc.getAttribute('data-line') || 1)
        const column = Number(loc.getAttribute('data-column') || 1)
        if (file) {
          this.callbacks?.onOpenLocation?.({ file, line, column })
        }
      }
      loc.addEventListener('click', handler)
      locListeners.push({ el: loc, fn: handler })
    })

    // Viewport drag & wheel zoom
    const viewport = container.querySelector('#vrt-viewport') as HTMLElement | null

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) {
        this.setZoom(this.zoomLevel * 1.15)
      } else {
        this.setZoom(this.zoomLevel / 1.15)
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      this.isDragging = true
      this.dragStartX = e.clientX
      this.dragStartPan = this.panOffset
    }

    const win = typeof window !== 'undefined' ? window : (globalThis as any)
    const onMouseMove = (e: any) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.dragStartX
      this.setPan(this.dragStartPan + dx)
    }

    const onMouseUp = () => {
      this.isDragging = false
    }

    viewport?.addEventListener('wheel', onWheel)
    viewport?.addEventListener('mousedown', onMouseDown)
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('mousemove', onMouseMove)
      win.addEventListener('mouseup', onMouseUp)
    }

    return () => {
      zoomInBtn?.removeEventListener('click', onZoomIn)
      zoomOutBtn?.removeEventListener('click', onZoomOut)
      zoomResetBtn?.removeEventListener('click', onReset)
      viewport?.removeEventListener('wheel', onWheel)
      viewport?.removeEventListener('mousedown', onMouseDown)
      barListeners.forEach(({ el, fn }) => el.removeEventListener('click', fn))
      locListeners.forEach(({ el, fn }) => el.removeEventListener('click', fn))
      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('mousemove', onMouseMove)
        win.removeEventListener('mouseup', onMouseUp)
      }
    }
  }
}
