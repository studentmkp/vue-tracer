import type { MutationEvent } from '@vue-reactive-trace/runtime'
import type { SourceLocation } from './types'

export function renderScopeBadge(scope?: MutationEvent['scope']): string {
  if (scope === 'module') return `<span class="vrt-pill amber">GLOBAL REACTIVE</span>`
  if (scope === 'composable') return `<span class="vrt-pill cyan">COMPOSABLE</span>`
  return ''
}

export function renderLoc(loc?: SourceLocation, empty = '—'): string {
  if (!loc) return empty
  const column = loc.column ?? 0
  return `<span class="vrt-loc clickable" data-file="${loc.file}" data-line="${loc.line}" data-column="${column}" title="Click to open in editor">${loc.file}:${loc.line}${column ? `:${column}` : ''} ↗</span>`
}

export function safeJsonStringify(value: unknown, space: number = 2): string {
  try {
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === 'bigint' ? `${val.toString()}n` : val),
      space
    )
  } catch {
    return String(value)
  }
}
