import { toRaw } from 'vue'
import type { ComponentEventOptions, MutationEvent, Trace } from '@vue-reactive-trace/runtime'

/**
 * The recorder seam the Vue adapter needs: enough to read the Trace being recorded
 * and to attach component events to it. `traceCollector` satisfies this; tests pass
 * a mock so mixin behaviour is asserted without a playground session.
 */
export interface ComponentCausalityRecorder {
  isEnabled(): boolean
  getCurrentTrace(): Trace | null
  recordComponentTrigger(
    componentName: string,
    file?: string,
    options?: ComponentEventOptions
  ): unknown
  recordComponentRender(
    componentName: string,
    start: number,
    end: number,
    file?: string,
    options?: ComponentEventOptions
  ): unknown
}

/** The subset of Vue's `renderTriggered` debug event the adapter reads. */
export interface RenderTriggeredEvent {
  target?: unknown
  key?: PropertyKey
}

export interface ComponentCausalityMixin {
  renderTriggered(event: RenderTriggeredEvent): void
  beforeUpdate(): void
  updated(): void
}

function sameTarget(a: unknown, b: unknown): boolean {
  const objectA = a !== null && (typeof a === 'object' || typeof a === 'function')
  const objectB = b !== null && (typeof b === 'object' || typeof b === 'function')
  if (!objectA || !objectB) return a === b
  return toRaw(a as object) === toRaw(b as object)
}

function pathKey(mutation: MutationEvent): string | undefined {
  const tail = mutation.path?.[mutation.path.length - 1]
  return tail === undefined ? undefined : String(tail)
}

/**
 * The mutation that caused Vue to report `event`: the most recent recorded write to
 * the dependency Vue names. Property writes must match the path key; collection
 * mutators match on target alone because their path does not name the triggered key.
 */
function findCausingMutation(
  trace: Trace | null,
  event?: RenderTriggeredEvent
): MutationEvent | null {
  const target = event?.target
  if (!trace || target == null) return null

  const key = event?.key === undefined ? undefined : String(event.key)
  let collectionMatch: MutationEvent | null = null

  for (let i = trace.events.length - 1; i >= 0; i--) {
    const candidate = trace.events[i]
    if (candidate.type !== 'mutation') continue
    if (candidate.target == null || !sameTarget(candidate.target, target)) continue

    if (key !== undefined && pathKey(candidate) === key) return candidate
    if (!collectionMatch && (candidate.pathMode === 'collection' || !candidate.path?.length)) {
      collectionMatch = candidate
    }
  }

  return collectionMatch
}

function getComponentInfo(vm: any): { name: string; file?: string } {
  const instance = vm?.$
  const type = instance?.type || vm?.$options || {}
  const file = type.__file || vm?.$options?.__file
  let name = type.__name || type.name || vm?.$options?.name

  if (!name && file) {
    const filename = file.split(/[/\\]/).pop() || ''
    name = filename.replace(/\.(vue|ts|js|jsx|tsx)$/, '')
  }

  return {
    name: name || 'Component',
    file
  }
}

/**
 * Component render causality, owned by the adapter.
 *
 * `renderTriggered` is Vue's own report of which dependency fired the update, so the
 * adapter resolves the causing mutation at trigger time and carries it to the
 * `updated` hook. The collector's active-mutation window is never read: correlation
 * holds even though the window closes in `recordInstrumentedMutation`'s finally-block
 * long before Vue flushes the render.
 */
export function createComponentCausalityMixin(
  recorder: ComponentCausalityRecorder
): ComponentCausalityMixin {
  return {
    renderTriggered(this: any, event: RenderTriggeredEvent) {
      if (!recorder.isEnabled()) return

      const cause = findCausingMutation(recorder.getCurrentTrace(), event)
      // One update can report several triggered deps; keep a cause already found.
      if (cause) this.__trace_cause_mutation_id = cause.id

      const info = getComponentInfo(this)
      recorder.recordComponentTrigger(info.name, info.file, {
        triggeredByMutationId: cause?.id
      })
    },
    beforeUpdate(this: any) {
      if (!recorder.isEnabled()) return
      this.__trace_render_start = performance.now()
    },
    updated(this: any) {
      // Consume the cause even while disabled so a stale id cannot leak into a
      // later render after recording resumes.
      const triggeredByMutationId = this.__trace_cause_mutation_id as number | undefined
      this.__trace_cause_mutation_id = undefined
      if (!recorder.isEnabled()) return

      const info = getComponentInfo(this)
      const start =
        typeof this.__trace_render_start === 'number' ? this.__trace_render_start : performance.now()

      recorder.recordComponentRender(info.name, start, performance.now(), info.file, {
        triggeredByMutationId
      })
    }
  }
}
