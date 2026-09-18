import type {
  Trace,
  TraceViewModel
} from '@vue-reactive-trace/runtime'
import { renderLoc, renderScopeBadge, safeJsonStringify } from './formatters'
import type { FlowCallbacks, FlowRenderOptions } from './types'

export function renderFlowView(
  traceOrView: Trace | TraceViewModel,
  callbacksOrView?: FlowCallbacks | TraceViewModel,
  optionsOrCallbacks?: FlowRenderOptions | FlowCallbacks
): string {
  let trace: Trace | undefined
  let view: TraceViewModel
  let callbacks: FlowCallbacks | undefined

  if ('tracks' in traceOrView && 'events' in traceOrView) {
    view = traceOrView as TraceViewModel
    if (callbacksOrView && !('tracks' in callbacksOrView)) {
      callbacks = callbacksOrView as FlowCallbacks
    }
    if (optionsOrCallbacks && 'trace' in (optionsOrCallbacks as FlowRenderOptions)) {
      trace = (optionsOrCallbacks as FlowRenderOptions).trace
    }
  } else {
    trace = traceOrView as Trace
    view = callbacksOrView as TraceViewModel
    if (optionsOrCallbacks && !('trace' in (optionsOrCallbacks as any))) {
      callbacks = optionsOrCallbacks as FlowCallbacks
    }
  }

  const {
    interactions,
    asyncTasks,
    mutations: mutationItems,
    watches,
    computeds,
    triggers,
    renders
  } = view.tracks

  const interactionEvent = interactions[0]
  const triggerEvent = (trace?.trigger?.event || interactionEvent?.event || 'interaction').toUpperCase()
  const targetTag = trace?.trigger?.targetTag || interactionEvent?.targetTag || ''
  const targetText = trace?.trigger?.targetText || interactionEvent?.targetText || ''
  const startedAt = (trace?.startedAt ?? interactionEvent?.timestamp ?? 0).toFixed(2)
  const traceIdText = trace?.id !== undefined ? ` #${trace.id}` : ''

  return `
    <div class="vrt-flow">
      <!-- 1. Interaction -->
      <div class="vrt-step interaction">
        <div class="vrt-step-badge">1. User Interaction</div>
        <div class="vrt-step-title">
          ${triggerEvent}
          ${targetTag ? `&lt;${targetTag}&gt;` : ''}
          ${targetText ? `"${targetText}"` : ''}
        </div>
        <div class="vrt-step-detail">
          Started: ${startedAt} ms
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
          <div class="vrt-step-detail">Async continuation preserved under Trace${traceIdText}</div>
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
                    <div class="vrt-step mutation" data-event-id="${m.id}">
                      <div class="vrt-step-badge">
                        3. Aggregated Mutation (${m.count} ops)
                        ${renderScopeBadge(m.scope)}
                        ${m.composable ? `<span class="vrt-pill cyan" style="margin-left: 6px;">${m.composable}()</span>` : ''}
                        ${m.isExternal ? `<span class="vrt-pill red" style="margin-left: 6px;">EXTERNAL REACTIVE</span>` : ''}
                      </div>
                      <div class="vrt-step-title">
                        ${m.name}:
                        <span style="color: #f43f5e">${safeJsonStringify(m.before)}</span>
                        →
                        <span style="color: #10b981">${safeJsonStringify(m.after)}</span>
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
                  <div class="vrt-step mutation" data-event-id="${m.id}">
                    <div class="vrt-step-badge">
                      3. Reactive Mutation
                      ${renderScopeBadge(m.scope)}
                      ${m.composable ? `<span class="vrt-pill cyan" style="margin-left: 6px;">${m.composable}()</span>` : ''}
                      ${m.isExternal ? `<span class="vrt-pill red" style="margin-left: 6px;">EXTERNAL REACTIVE</span>` : ''}
                    </div>
                    <div class="vrt-step-title">
                      ${m.name || 'reactive'}:
                      <span style="color: #f43f5e">${safeJsonStringify(m.before)}</span>
                      →
                      <span style="color: #10b981">${safeJsonStringify(m.after)}</span>
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
          <div class="vrt-step watch" data-event-id="${w.id}">
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
          <div class="vrt-step computed" data-event-id="${c.id}">
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
          <div class="vrt-step trigger" data-event-type="component-trigger" data-event-id="${t.id}">
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
            <div class="vrt-step render" data-event-id="${r.id}">
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

export function attachFlowListeners(container: HTMLElement, callbacks?: FlowCallbacks): void {
  if (!callbacks) return

  if (callbacks.onOpenLocation) {
    const clickableLocs = container.querySelectorAll('.vrt-loc.clickable')
    clickableLocs.forEach((loc) => {
      loc.addEventListener('click', (e) => {
        e.stopPropagation()
        const file = loc.getAttribute('data-file')
        const line = Number(loc.getAttribute('data-line') || 1)
        const column = Number(loc.getAttribute('data-column') || 1)
        if (file) {
          callbacks.onOpenLocation?.({ file, line, column })
        }
      })
    })
  }

  if (callbacks.onSelectEvent) {
    const steps = container.querySelectorAll('.vrt-step[data-event-id]')
    steps.forEach((step) => {
      step.addEventListener('click', (e) => {
        const id = Number(step.getAttribute('data-event-id'))
        if (!Number.isNaN(id)) {
          callbacks.onSelectEvent?.(id)
        }
      })
    })
  }
}
