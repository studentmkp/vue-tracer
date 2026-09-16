export interface SourceLocation {
  file: string
  line: number
  column: number
}

export type TraceConfidence = 'exact' | 'runtime' | 'inferred'
export type TraceLevel = 'full' | 'partial'

export interface ReactiveMetadata {
  id: string | number
  name?: string
  type: ReactiveType
  source?: SourceLocation
  scope?: 'module' | 'local' | 'composable'
  composable?: string
  origin?: string
  isExternal?: boolean
  traceLevel?: TraceLevel
}

export type MutationOperation =
  | 'set'
  | 'increment'
  | 'decrement'
  | 'delete'
  | 'clear'
  | 'push'
  | 'pop'
  | 'shift'
  | 'unshift'
  | 'splice'
  | 'sort'
  | 'reverse'
  | 'map-set'
  | 'set-add'

export interface MutationEvent {
  id: number
  traceId: number
  type: 'mutation'
  reactiveId?: string | number
  name?: string
  rootName?: string
  path?: string[]
  operation: MutationOperation
  before: any
  after: any
  source: SourceLocation
  timestamp: number
  target?: any
  affectedComponents: string[]
  composable?: string
  isExternal?: boolean
  origin?: string
  traceLevel?: TraceLevel
  confidence?: TraceConfidence
  scope?: 'module' | 'local' | 'composable'
  declaredAt?: SourceLocation
}

export interface ComputedEvent {
  id: number
  traceId: number
  type: 'computed'
  name: string
  source?: SourceLocation
  status: 'invalidated' | 'evaluated'
  triggeredByMutationId?: number
  timestamp: number
  value?: any
}

export interface WatchEvent {
  id: number
  traceId: number
  type: 'watch'
  name?: string
  source?: SourceLocation
  triggeredByMutationId?: number
  timestamp: number
}

export type AsyncTaskType = 'promise' | 'microtask' | 'timeout' | 'raf'

export interface AsyncTaskEvent {
  id: number
  traceId: number
  type: 'async'
  taskType: AsyncTaskType
  name?: string
  timestamp: number
  duration?: number
}

export interface AggregatedMutationGroup {
  id: number
  traceId: number
  type: 'aggregated-mutation'
  name: string
  count: number
  operation: MutationOperation
  start: number
  end: number
  duration: number
  events: MutationEvent[]
  before: any
  after: any
  source: SourceLocation
  affectedComponents: string[]
  composable?: string
  isExternal?: boolean
  origin?: string
  traceLevel?: TraceLevel
  confidence?: TraceConfidence
  scope?: 'module' | 'local' | 'composable'
  declaredAt?: SourceLocation
}

export interface ComponentTriggerEvent {
  id: number
  traceId: number
  type: 'component-trigger'
  componentName: string
  file?: string
  triggeredByMutationId?: number
  timestamp: number
  confidence?: TraceConfidence
}

export interface ComponentRenderEvent {
  id: number
  traceId: number
  type: 'component-render'
  componentName: string
  file?: string
  start: number
  end: number
  duration: number
  triggeredByMutationId?: number
  confidence?: TraceConfidence
}

export interface InteractionEvent {
  id: number
  traceId: number
  type: 'interaction'
  event: string
  targetTag: string
  targetText?: string
  source?: SourceLocation
  timestamp: number
}

export type TraceEvent =
  | MutationEvent
  | ComputedEvent
  | WatchEvent
  | ComponentTriggerEvent
  | ComponentRenderEvent
  | InteractionEvent
  | AsyncTaskEvent

export interface Trace {
  id: number
  trigger: {
    type: 'interaction' | 'manual'
    event: string
    targetTag?: string
    targetText?: string
    source?: SourceLocation
  }
  startedAt: number
  completedAt?: number
  events: TraceEvent[]
  status: 'active' | 'completed'
}

export type TraceEventType =
  | 'interaction'
  | 'function'
  | 'mutation'
  | 'computed'
  | 'watch'
  | 'component-trigger'
  | 'component-render'
  | 'vue-flush'
  | 'microtask'
  | 'async'

export interface TraceFilterOptions {
  types?: string[]
  query?: string
  file?: string
  component?: string
  minDuration?: number
  appCodeOnly?: boolean
  confidence?: TraceConfidence
  isExternal?: boolean
}

export interface TraceExportData {
  version: string
  exportedAt: number
  summary: {
    tracesCount: number
    totalEventsCount: number
    mutationsCount: number
    rendersCount: number
  }
  traces: Trace[]
}

