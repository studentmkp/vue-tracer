import type {
  AggregatedMutationGroup,
  AsyncTaskEvent,
  ComponentRenderEvent,
  ComponentTriggerEvent,
  ComputedEvent,
  InteractionEvent,
  MutationEvent,
  Trace,
  TraceEvent,
  TraceViewModel,
  WatchEvent
} from '@vue-reactive-trace/runtime'
import { findTraceViewItem, firstTraceViewItem } from '@vue-reactive-trace/runtime'
import { renderLoc, renderScopeBadge, safeJsonStringify } from './formatters'
import type { DetailCallbacks, DetailRenderOptions } from './types'

export type DetailTarget = TraceEvent | AggregatedMutationGroup | TraceViewModel | undefined

export function renderDetailView(
  target: DetailTarget,
  callbacks?: DetailCallbacks,
  options?: DetailRenderOptions
): string {
  let event: TraceEvent | AggregatedMutationGroup | undefined

  if (target && 'tracks' in target && 'events' in target) {
    const vm = target as TraceViewModel
    const selectedId = options?.selectedEventId
    if (selectedId !== undefined && selectedId !== null) {
      event = findTraceViewItem(vm, selectedId)
    }
    if (!event) {
      event = firstTraceViewItem(vm)
    }
  } else {
    event = target as (TraceEvent | AggregatedMutationGroup | undefined)
  }

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
              <pre style="margin: 0; font-size: 11px; color: #fca5a5; max-height: 60px; overflow-y: auto;">${safeJsonStringify(agg.before)}</pre>
            </div>
            <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
              <div style="color: #10b981; font-size: 10px; font-weight: 700; margin-bottom: 2px;">FINAL AFTER</div>
              <pre style="margin: 0; font-size: 11px; color: #86efac; max-height: 60px; overflow-y: auto;">${safeJsonStringify(agg.after)}</pre>
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
              <pre style="margin: 0; font-size: 11px; color: #fca5a5; max-height: 60px; overflow-y: auto;">${safeJsonStringify(m.before)}</pre>
            </div>
            <div style="flex: 1; background: #06090e; padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b;">
              <div style="color: #10b981; font-size: 10px; font-weight: 700; margin-bottom: 2px;">AFTER</div>
              <pre style="margin: 0; font-size: 11px; color: #86efac; max-height: 60px; overflow-y: auto;">${safeJsonStringify(m.after)}</pre>
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

export function attachDetailListeners(container: HTMLElement, callbacks?: DetailCallbacks): void {
  if (!callbacks?.onOpenLocation) return
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
