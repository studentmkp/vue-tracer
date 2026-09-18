export const OVERLAY_STYLES = `
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

const STYLE_ID = '__vue_reactive_trace_styles__'

export function injectOverlayStyles(doc: Document = document): HTMLStyleElement | null {
  if (typeof doc === 'undefined' || !doc.head) return null
  const existing = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (existing) return existing

  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = OVERLAY_STYLES
  doc.head.appendChild(style)
  return style
}
