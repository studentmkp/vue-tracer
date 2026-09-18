import type {
  AggregatedMutationGroup,
  MutationEvent,
  Trace,
  TraceEvent,
  TraceFilterOptions,
  TraceViewModel
} from '@vue-reactive-trace/runtime'

export interface SourceLocation {
  file: string
  line: number
  column?: number
}

export interface TimelineState {
  zoomLevel: number
  panOffset: number
}

export interface TimelineCallbacks {
  onSelectEvent?: (eventId: number) => void
  onOpenLocation?: (loc: SourceLocation) => void
  onZoomChange?: (zoom: number) => void
  onPanChange?: (pan: number) => void
}

export interface TimelineRenderOptions {
  trace?: Trace
  selectedEventId?: number | null
  zoomLevel?: number
  panOffset?: number
  pendingTasks?: number
}

export interface FlowCallbacks {
  onOpenLocation?: (loc: SourceLocation) => void
  onSelectEvent?: (eventId: number) => void
}

export interface FlowRenderOptions {
  trace?: Trace
  selectedEventId?: number | null
}

export interface DetailCallbacks {
  onOpenLocation?: (loc: SourceLocation) => void
}

export interface DetailRenderOptions {
  trace?: Trace
  selectedEventId?: number | null
}

export interface OverlayControllerOptions {
  container?: HTMLElement
  autoMount?: boolean
  initialFilter?: TraceFilterOptions
  initialTab?: 'timeline' | 'flow'
}
