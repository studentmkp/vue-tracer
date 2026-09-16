import { toRaw } from 'vue'
import { traceCollector } from './collector'
import { getReactiveMeta, getReactivePathAndRoot, isRegisteredReactive } from './registry'
import { redactValue } from './redact'
import type { MutationEvent, MutationOperation, ReactiveMetadata, SourceLocation } from './types'

export interface TraceMutationOptions {
  rootName?: string
  path?: string[]
}

export interface MutationIdentity {
  target: any
  meta?: ReactiveMetadata | null
  rootName?: string
  path: string[]
}

export interface TracedWrite<T> {
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

function mutationFieldsFromMeta(meta?: ReactiveMetadata | null) {
  return {
    composable: meta?.composable,
    isExternal: meta?.isExternal,
    origin: meta?.origin,
    traceLevel: meta?.traceLevel,
    confidence: (meta?.isExternal ? 'inferred' : 'exact') as const,
    scope: meta?.scope,
    declaredAt: meta?.source
  }
}

function resolveMutationIdentity(
  target: any,
  prop: any,
  options: TraceMutationOptions | undefined,
  pathMode: 'property' | 'collection'
): MutationIdentity {
  const meta = getReactiveMeta(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName = options?.rootName || pathAndRoot?.rootName || meta?.name
  const path =
    options?.path ||
    (pathMode === 'property'
      ? pathAndRoot?.pathPrefix
        ? [...pathAndRoot.pathPrefix, String(prop)]
        : [String(prop)]
      : pathAndRoot?.pathPrefix || [])
  return { target, meta, rootName, path }
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
  return rootName || meta?.name || String(prop)
}

/**
 * Records one MutationEvent around a write: identity, redacted snapshots, and the
 * active-mutation window used to correlate component renders.
 */
export function recordInstrumentedMutation<T>(input: {
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
  if (!traceCollector.isEnabled() || !isRegisteredReactive(target)) {
    return input.untraced()
  }

  const identity = resolveMutationIdentity(target, input.prop, input.options, input.pathMode)
  const { before, after, run } = input.traced(identity)
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: identity.meta?.id,
      name: mutationName(identity, input.prop, input.nameMode),
      path: identity.path,
      pathMode: input.pathMode,
      operation: input.operation,
      before,
      after: undefined,
      source: input.source,
      target,
      ...mutationFieldsFromMeta(identity.meta)
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
