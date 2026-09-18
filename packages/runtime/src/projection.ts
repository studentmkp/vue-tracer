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
  TraceFilterOptions,
  WatchEvent
} from './types'

export interface TraceViewTracks {
  interactions: InteractionEvent[]
  asyncTasks: AsyncTaskEvent[]
  mutations: (MutationEvent | AggregatedMutationGroup)[]
  computeds: ComputedEvent[]
  watches: WatchEvent[]
  triggers: ComponentTriggerEvent[]
  renders: ComponentRenderEvent[]
}

export interface TraceViewModel {
  totalEventCount: number
  filteredEventCount: number
  visibleEventCount: number
  events: (TraceEvent | AggregatedMutationGroup)[]
  filteredEvents: TraceEvent[]
  aggregates: AggregatedMutationGroup[]
  tracks: TraceViewTracks
}

export function filterTraceEvents<T extends TraceEvent | AggregatedMutationGroup>(
  events: T[],
  options: TraceFilterOptions = {}
): T[] {
  return events.filter((event) => {
    // 1. Type filter
    if (options.types && options.types.length > 0) {
      const typeAliases =
        event.type === 'aggregated-mutation' ? ['aggregated-mutation', 'mutation'] : [event.type]
      if (!options.types.some((t) => typeAliases.includes(t))) {
        return false
      }
    }

    // 2. Query search (matches name, event, componentName, path, or file)
    if (options.query && options.query.trim()) {
      const q = options.query.toLowerCase().trim()
      let matches = false

      if ('name' in event && event.name && event.name.toLowerCase().includes(q)) matches = true
      if ('event' in event && (event as any).event && (event as any).event.toLowerCase().includes(q)) matches = true
      if ('componentName' in event && (event as any).componentName && (event as any).componentName.toLowerCase().includes(q)) matches = true
      if ('path' in event && (event as any).path && (event as any).path.join('.').toLowerCase().includes(q)) matches = true
      if ('source' in event && (event as any).source?.file && (event as any).source.file.toLowerCase().includes(q)) matches = true
      if ('file' in event && (event as any).file && (event as any).file.toLowerCase().includes(q)) matches = true
      if ('composable' in event && (event as any).composable && (event as any).composable.toLowerCase().includes(q)) matches = true
      if ('origin' in event && (event as any).origin && (event as any).origin.toLowerCase().includes(q)) matches = true

      if (!matches) return false
    }

    // 3. File filter
    if (options.file) {
      const fileTarget = options.file.toLowerCase()
      const eventFile = ('source' in event ? (event as any).source?.file : '') || ('file' in event ? (event as any).file : '') || ''
      if (!eventFile.toLowerCase().includes(fileTarget)) return false
    }

    // 4. Component filter
    if (options.component) {
      const cTarget = options.component.toLowerCase()
      let matches = false
      if ('componentName' in event && (event as any).componentName?.toLowerCase().includes(cTarget)) matches = true
      if ('affectedComponents' in event && (event as any).affectedComponents?.some((c: string) => c.toLowerCase().includes(cTarget))) matches = true
      if (!matches) return false
    }

    // 5. Min duration
    if (options.minDuration !== undefined && options.minDuration > 0) {
      let dur = 0
      if ('duration' in event && typeof (event as any).duration === 'number') {
        dur = (event as any).duration
      }
      if (dur < options.minDuration) return false
    }

    // 6. App Code Only (Noise Reduction, Section 42)
    if (options.appCodeOnly) {
      if ('isExternal' in event && (event as any).isExternal) return false
      if ('source' in event && (event as any).source?.file) {
        const f = (event as any).source.file
        if (f.includes('node_modules') || f.includes('@vite') || f.includes('@vue')) return false
      }
      if ('file' in event && (event as any).file) {
        const f = (event as any).file
        if (f.includes('node_modules') || f.includes('@vite') || f.includes('@vue')) return false
      }
    }

    // 7. Confidence filter
    if (options.confidence) {
      if ('confidence' in event && (event as any).confidence !== options.confidence) {
        return false
      }
    }

    // 8. isExternal filter
    if (options.isExternal !== undefined) {
      const isExt = ('isExternal' in event ? Boolean((event as any).isExternal) : false)
      if (isExt !== options.isExternal) return false
    }

    return true
  })
}

export function aggregateTraceEvents(
  events: TraceEvent[],
  threshold: number = 3
): (TraceEvent | AggregatedMutationGroup)[] {
  const result: (TraceEvent | AggregatedMutationGroup)[] = []
  let i = 0

  while (i < events.length) {
    const event = events[i]

    if (event.type !== 'mutation') {
      result.push(event)
      i++
      continue
    }

    let j = i + 1
    while (
      j < events.length &&
      events[j].type === 'mutation' &&
      (events[j] as MutationEvent).name === (event as MutationEvent).name &&
      (events[j] as MutationEvent).operation === (event as MutationEvent).operation
    ) {
      j++
    }

    const count = j - i
    if (count >= threshold) {
      const batched = events.slice(i, j) as MutationEvent[]
      const first = batched[0]
      const last = batched[batched.length - 1]
      const affected = Array.from(new Set(batched.flatMap((m) => m.affectedComponents)))

      const agg: AggregatedMutationGroup = {
        id: first.id,
        traceId: first.traceId,
        type: 'aggregated-mutation',
        name: first.name || 'mutation',
        count,
        operation: first.operation,
        start: first.timestamp,
        end: last.timestamp,
        duration: Math.max(last.timestamp - first.timestamp, 0.01),
        events: batched,
        before: first.before,
        after: last.after,
        source: first.source,
        affectedComponents: affected,
        pathMode: first.pathMode,
        composable: first.composable,
        isExternal: first.isExternal,
        origin: first.origin,
        traceLevel: first.traceLevel,
        confidence: first.confidence,
        scope: first.scope,
        declaredAt: first.declaredAt
      }
      result.push(agg)
      i = j
    } else {
      result.push(event)
      i++
    }
  }

  return result
}

/**
 * Single projection seam: takes a raw Trace and filter options and returns the
 * Trace view model (filtered events, aggregates, total and visible counts).
 */
export function projectTraceView(
  trace: Trace,
  options: TraceFilterOptions = {},
  threshold: number = 3
): TraceViewModel {
  const filteredRaw = filterTraceEvents(trace.events, options)
  const aggregated = aggregateTraceEvents(filteredRaw, threshold)
  const aggregates = aggregated.filter(
    (it): it is AggregatedMutationGroup => it.type === 'aggregated-mutation'
  )

  return {
    totalEventCount: trace.events.length,
    filteredEventCount: filteredRaw.length,
    visibleEventCount: filteredRaw.length,
    events: aggregated,
    filteredEvents: filteredRaw,
    aggregates,
    tracks: {
      interactions: filteredRaw.filter((e): e is InteractionEvent => e.type === 'interaction'),
      asyncTasks: filteredRaw.filter((e): e is AsyncTaskEvent => e.type === 'async'),
      mutations: aggregated.filter(
        (it): it is MutationEvent | AggregatedMutationGroup =>
          it.type === 'mutation' || it.type === 'aggregated-mutation'
      ),
      computeds: filteredRaw.filter((e): e is ComputedEvent => e.type === 'computed'),
      watches: filteredRaw.filter((e): e is WatchEvent => e.type === 'watch'),
      triggers: filteredRaw.filter((e): e is ComponentTriggerEvent => e.type === 'component-trigger'),
      renders: filteredRaw.filter((e): e is ComponentRenderEvent => e.type === 'component-render')
    }
  }
}

export const queryTraceView = projectTraceView

export function findTraceViewItem(
  view: TraceViewModel,
  id: number
): TraceEvent | AggregatedMutationGroup | undefined {
  const { tracks } = view
  return (
    tracks.mutations.find((it) => it.id === id) ||
    tracks.interactions.find((e) => e.id === id) ||
    tracks.asyncTasks.find((e) => e.id === id) ||
    tracks.computeds.find((e) => e.id === id) ||
    tracks.watches.find((e) => e.id === id) ||
    tracks.triggers.find((e) => e.id === id) ||
    tracks.renders.find((e) => e.id === id)
  )
}

export function firstTraceViewItem(
  view: TraceViewModel
): TraceEvent | AggregatedMutationGroup | undefined {
  const t = view.tracks
  return (
    t.mutations[0] ||
    t.interactions[0] ||
    t.asyncTasks[0] ||
    t.computeds[0] ||
    t.watches[0] ||
    t.triggers[0] ||
    t.renders[0]
  )
}
