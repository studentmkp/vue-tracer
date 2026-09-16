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
import { aggregateTraceEvents, filterTraceEvents } from './collector'

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
  tracks: TraceViewTracks
}

export function queryTraceView(
  trace: Trace,
  options: TraceFilterOptions = {},
  threshold: number = 3
): TraceViewModel {
  const filteredRaw = filterTraceEvents(trace.events, options)
  const aggregated = aggregateTraceEvents(filteredRaw, threshold)

  return {
    totalEventCount: trace.events.length,
    filteredEventCount: filteredRaw.length,
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
