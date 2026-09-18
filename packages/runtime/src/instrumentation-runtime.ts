import { toRaw, isRef, isReactive, isProxy } from 'vue'
import { traceCollector } from './collector'
import {
  getReactiveMeta,
  getReactivePathAndRoot,
  isReactiveCandidate,
  isRegisteredReactive,
  registerReactive
} from './registry'
import { configureRedact, redactValue, type RedactMatcher } from './redact'
import type {
  MutationEvent,
  MutationOperation,
  ReactiveMetadata,
  SourceLocation,
  TraceEventType
} from './types'

export interface TraceRuntimeConfig {
  redact?: RedactMatcher[]
  events?: readonly TraceEventType[]
  maxMemoryMB?: number
}

/** @deprecated Use TraceRuntimeConfig. */
export type RuntimeRedactConfig = Pick<TraceRuntimeConfig, 'redact'>

/** Single configuration seam used by transformed modules. */
export function __trace_configure(next: TraceRuntimeConfig): void {
  if (next.redact !== undefined) configureRedact({ matchers: next.redact })
  if (next.events !== undefined || next.maxMemoryMB !== undefined) {
    traceCollector.configureRecording({ events: next.events, maxMemoryMB: next.maxMemoryMB })
  }
}

export function __trace_register<T>(target: T, metadata?: Partial<ReactiveMetadata>): T {
  return registerReactive(target, metadata)
}

export function __trace_register_external<T>(
  target: T,
  metadata?: { name?: string; origin?: string }
): T {
  return registerReactive(target, {
    name: metadata?.name || 'external',
    origin: metadata?.origin || 'external',
    isExternal: true,
    traceLevel: 'partial',
    scope: 'local'
  })
}

export function __trace_register_computed<T>(
  target: T,
  metadata?: Partial<ReactiveMetadata>
): T {
  registerReactive(target, { ...metadata, type: 'computed' })

  const comp = target as any
  if (comp) {
    const handler = () => {
      if (traceCollector.isEnabled()) {
        traceCollector.recordComputedInvalidated({
          name: metadata?.name || 'computed',
          source: metadata?.source,
          target
        })
      }
    }
    const origOnTrigger = comp.onTrigger || comp.effect?.onTrigger
    comp.onTrigger = (event: any) => {
      handler()
      if (typeof origOnTrigger === 'function') origOnTrigger(event)
    }
    if (comp.effect) comp.effect.onTrigger = comp.onTrigger
  }

  return target
}

export interface TraceMutationOptions {
  rootName?: string
  path?: string[]
}

interface MutationIdentity {
  target: any
  meta?: ReactiveMetadata | null
  rootName?: string
  path: string[]
  isRuntimeExternal?: boolean
  reactiveId?: string | number
}

interface TracedWrite<T> {
  before: unknown
  after?: unknown | (() => unknown)
  run: () => T
}

const MAX_CLONE_DEPTH = 10

export function safeClone(
  val: unknown,
  path: string[] = [],
  rootName?: string,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): unknown {
  const key = path[path.length - 1] ?? ''
  if (key) {
    const redacted = redactValue(val, { path, key, rootName })
    if (redacted !== val) return redacted
  }

  if (val === null || val === undefined) return val
  const type = typeof val
  if (type === 'number' || type === 'string' || type === 'boolean' || type === 'bigint') {
    return val
  }

  if (depth > MAX_CLONE_DEPTH) return '[Object]'

  const raw = toRaw(val) as any
  if (raw && typeof raw === 'object') {
    if (seen.has(raw)) return '[Circular]'
    seen.add(raw)
  }

  try {
    const isSet =
      raw instanceof Set ||
      Object.prototype.toString.call(raw) === '[object Set]' ||
      (raw &&
        typeof raw.add === 'function' &&
        typeof raw.has === 'function' &&
        'size' in raw)
    const isMap =
      raw instanceof Map ||
      Object.prototype.toString.call(raw) === '[object Map]' ||
      (raw &&
        typeof raw.get === 'function' &&
        typeof raw.set === 'function' &&
        'size' in raw)

    if (isSet) {
      try {
        const values: any[] = []
        let count = 0
        for (const v of raw.values()) {
          if (count++ > 50) break
          values.push(safeClone(v, path, rootName, seen, depth + 1))
        }
        return { $type: 'Set', size: raw.size, values }
      } catch {
        return { $type: 'Set', size: raw.size }
      }
    }

    if (isMap) {
      try {
        const entries: [any, any][] = []
        let count = 0
        for (const [k, v] of raw.entries()) {
          if (count++ > 50) break
          entries.push([
            safeClone(k, path, rootName, seen, depth + 1),
            safeClone(v, [...path, String(k)], rootName, seen, depth + 1)
          ])
        }
        return { $type: 'Map', size: raw.size, entries }
      } catch {
        return { $type: 'Map', size: raw.size }
      }
    }

    if (Array.isArray(raw)) {
      return raw.slice(0, 50).map((x, i) => safeClone(x, [...path, String(i)], rootName, seen, depth + 1))
    }
    if (type === 'object') {
      try {
        if (typeof raw.toJSON === 'function') {
          return safeClone(raw.toJSON(), path, rootName, seen, depth + 1)
        }
        const out: Record<string, unknown> = {}
        for (const k of Object.keys(raw)) {
          const cloned = safeClone(raw[k], [...path, k], rootName, seen, depth + 1)
          if (cloned !== undefined) out[k] = cloned
        }
        return out
      } catch {
        return '[Object]'
      }
    }
    return String(val)
  } finally {
    if (raw && typeof raw === 'object') seen.delete(raw)
  }
}

export function isVueReactive(val: unknown): val is object {
  return isReactiveCandidate(val) && (isRef(val) || isReactive(val) || isProxy(val))
}

/**
 * Answers whether this reactive target is eligible to be recorded as a Mutation.
 * Either it is an explicitly registered reactive (instrumented or external) or a
 * runtime-discovered external Vue reactive.
 * Does not mutate the registry or trigger auto-registration.
 */
export function isRecordableReactive(target: unknown): boolean {
  return isRegisteredReactive(target) || isVueReactive(target)
}

/**
 * Answers “Will this write record?” without mutating the registry or auto-registering.
 */
export function shouldRecordMutation(target: unknown): boolean {
  return traceCollector.isEnabled() && isRecordableReactive(target)
}

let externalIdCounter = 1
const externalTargetIdMap = new WeakMap<object, string>()

function getExternalReactiveId(target: object): string {
  const raw = toRaw(target)
  let id = externalTargetIdMap.get(target) || externalTargetIdMap.get(raw)
  if (!id) {
    id = `reactive_auto_${externalIdCounter++}`
    externalTargetIdMap.set(target, id)
    if (raw !== target) {
      externalTargetIdMap.set(raw, id)
    }
  }
  return id
}

type MutationMetadataFields = Pick<
  MutationEvent,
  'composable' | 'isExternal' | 'origin' | 'traceLevel' | 'confidence' | 'scope' | 'declaredAt'
>

function mutationFieldsFromIdentity(identity: MutationIdentity): MutationMetadataFields {
  const { meta } = identity
  if (meta) {
    return {
      composable: meta.composable,
      isExternal: meta.isExternal,
      origin: meta.origin,
      traceLevel: meta.traceLevel,
      confidence: meta.isExternal ? 'inferred' : 'exact',
      scope: meta.scope,
      declaredAt: meta.source
    }
  }
  return {
    composable: undefined,
    isExternal: true,
    origin: 'external',
    traceLevel: 'partial',
    confidence: 'inferred',
    scope: 'local',
    declaredAt: undefined
  }
}

function resolveMutationIdentity(
  target: any,
  prop: any,
  options: TraceMutationOptions | undefined,
  pathMode: 'property' | 'collection'
): MutationIdentity {
  const meta = getReactiveMeta(target)
  const isRuntimeExternal = !meta && isVueReactive(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName =
    options?.rootName ||
    pathAndRoot?.rootName ||
    meta?.name ||
    (isRuntimeExternal ? 'anonymous' : undefined)
  const path =
    options?.path ||
    (pathMode === 'property'
      ? pathAndRoot?.pathPrefix
        ? [...pathAndRoot.pathPrefix, String(prop)]
        : [String(prop)]
      : pathAndRoot?.pathPrefix || [])
  const reactiveId = meta?.id || (isRuntimeExternal ? getExternalReactiveId(target) : undefined)

  return { target, meta, rootName, path, isRuntimeExternal, reactiveId }
}

function mutationName(identity: MutationIdentity, prop: any, nameMode: 'root' | 'qualified'): string {
  const { rootName, meta, path } = identity
  if (nameMode === 'qualified') {
    return rootName
      ? path.length > 0
        ? `${rootName}.${path.join('.')}`
        : rootName
      : meta?.name || 'anonymous'
  }
  return rootName || meta?.name || (prop !== undefined ? String(prop) : 'anonymous')
}

/**
 * Records one MutationEvent around a write: identity, redacted snapshots, and the
 * active-mutation window used to correlate component renders.
 */
function recordInstrumentedMutation<T>(input: {
  target: any
  source: SourceLocation
  options?: TraceMutationOptions
  prop?: any
  pathMode: 'property' | 'collection'
  nameMode: 'root' | 'qualified'
  operation: MutationOperation
  untraced: () => T
  traced: (identity: MutationIdentity) => TracedWrite<T>
}): T {
  const { target } = input
  if (!shouldRecordMutation(target)) {
    return input.untraced()
  }

  const identity = resolveMutationIdentity(target, input.prop, input.options, input.pathMode)
  const { before, after, run } = input.traced(identity)
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: identity.reactiveId,
      name: mutationName(identity, input.prop, input.nameMode),
      path: identity.path,
      pathMode: input.pathMode,
      operation: input.operation,
      before,
      after: undefined,
      source: input.source,
      target,
      ...mutationFieldsFromIdentity(identity)
    })
    traceCollector.setActiveMutation(mutationEvent)

    const result = run()
    if (after !== undefined) {
      traceCollector.finalizeMutation(mutationEvent, typeof after === 'function' ? after() : after)
    }
    return result
  } finally {
    traceCollector.setActiveMutation(null)
  }
}

function resolveWrite(target: any, prop: any, write: any): () => any {
  return typeof write === 'function' ? write : () => (target[prop] = write)
}

export function __trace_set(
  target: any,
  prop: any,
  write: (() => any) | any,
  source: SourceLocation,
  options?: TraceMutationOptions
): any {
  const performWrite = resolveWrite(target, prop, write)
  return recordInstrumentedMutation({
    target,
    source,
    options,
    prop,
    pathMode: 'property',
    nameMode: 'root',
    operation: 'set',
    untraced: performWrite,
    traced: ({ path, rootName }) => ({
      before: safeClone(target[prop], path, rootName),
      after: () => safeClone(target[prop], path, rootName),
      run: performWrite
    })
  })
}

export function __trace_update(
  target: any,
  prop: any,
  operator: '++' | '--',
  isPrefix: boolean,
  source: SourceLocation,
  options?: TraceMutationOptions
): any {
  const untraced = () =>
    operator === '++'
      ? isPrefix
        ? ++target[prop]
        : target[prop]++
      : isPrefix
        ? --target[prop]
        : target[prop]--

  return recordInstrumentedMutation({
    target,
    source,
    options,
    prop,
    pathMode: 'property',
    nameMode: 'root',
    operation: operator === '++' ? 'increment' : 'decrement',
    untraced,
    traced: ({ path, rootName }) => {
      const rawBefore = target[prop]
      const key = String(prop)
      const numeric = typeof rawBefore === 'bigint' ? rawBefore : +rawBefore
      const after =
        operator === '++'
          ? typeof numeric === 'bigint'
            ? numeric + 1n
            : numeric + 1
          : typeof numeric === 'bigint'
            ? numeric - 1n
            : numeric - 1
      return {
        before: redactValue(numeric, { path, key, rootName }),
        after: redactValue(after, { path, key, rootName }),
        run: () => {
          target[prop] = after
          return isPrefix ? after : numeric
        }
      }
    }
  })
}

export function __trace_call(
  target: any,
  method: string,
  args: any[],
  source: SourceLocation,
  options?: TraceMutationOptions
): any {
  let operation: MutationOperation = method as MutationOperation
  if (method === 'set') operation = 'map-set'
  else if (method === 'add') operation = 'set-add'
  else if (method === 'delete') operation = 'delete'
  else if (method === 'clear') operation = 'clear'

  return recordInstrumentedMutation({
    target,
    source,
    options,
    pathMode: 'collection',
    nameMode: 'qualified',
    operation,
    untraced: () => target[method](...args),
    traced: ({ path, rootName }) => ({
      before: safeClone(target, path, rootName),
      after: () => safeClone(target, path, rootName),
      run: () => target[method](...args)
    })
  })
}

export function __trace_delete(
  target: any,
  prop: any,
  source: SourceLocation,
  options?: TraceMutationOptions
): boolean {
  return recordInstrumentedMutation({
    target,
    source,
    options,
    prop,
    pathMode: 'property',
    nameMode: 'root',
    operation: 'delete',
    untraced: () => delete target[prop],
    traced: ({ path, rootName }) => ({
      before: safeClone(target[prop], path, rootName),
      run: () => delete target[prop]
    })
  })
}

export function __trace_watch_cb<T extends (...args: any[]) => any>(
  cb: T,
  metadata?: { name?: string; source?: SourceLocation }
): T {
  if (typeof cb !== 'function') return cb

  const wrapped = function (this: any, ...args: any[]) {
    if (traceCollector.isEnabled()) {
      traceCollector.recordWatchExecuted({
        name: metadata?.name || cb.name || 'watch',
        source: metadata?.source
      })
    }
    return cb.apply(this, args)
  } as unknown as T

  return wrapped
}
