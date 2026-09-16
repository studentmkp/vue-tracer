import { toRaw } from 'vue'
import { traceCollector } from './collector'
import { registerReactive, getReactiveMeta, getReactivePathAndRoot, isRegisteredReactive } from './registry'
import { redactValue } from './redact'
import type { ReactiveMetadata, SourceLocation, MutationEvent, MutationOperation } from './types'

export interface TraceMutationOptions {
  rootName?: string
  path?: string[]
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
    const handler = (event: any) => {
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
      handler(event)
      if (typeof origOnTrigger === 'function') origOnTrigger(event)
    }
    if (comp.effect) {
      comp.effect.onTrigger = comp.onTrigger
    }
  }

  return target
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

  if (!traceCollector.isEnabled() || !isRegisteredReactive(target)) {
    return performWrite()
  }

  const meta = getReactiveMeta(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName = options?.rootName || pathAndRoot?.rootName || meta?.name
  const propPath = options?.path || (pathAndRoot?.pathPrefix ? [...pathAndRoot.pathPrefix, String(prop)] : [String(prop)])
  const before = safeClone(target[prop], propPath, rootName)
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: meta?.id,
      name: rootName || meta?.name || String(prop),
      path: propPath,
      operation: 'set',
      before,
      after: undefined,
      source,
      target,
      ...mutationFieldsFromMeta(meta)
    })
    traceCollector.setActiveMutation(mutationEvent)

    const result = performWrite()
    mutationEvent.after = safeClone(target[prop], propPath, rootName)
    return result
  } finally {
    traceCollector.setActiveMutation(null)
  }
}

export function __trace_update(
  target: any,
  prop: any,
  operator: '++' | '--',
  isPrefix: boolean,
  source: SourceLocation,
  options?: TraceMutationOptions
): any {
  if (!traceCollector.isEnabled() || !isRegisteredReactive(target)) {
    return operator === '++'
      ? (isPrefix ? ++target[prop] : target[prop]++)
      : (isPrefix ? --target[prop] : target[prop]--)
  }

  const meta = getReactiveMeta(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName = options?.rootName || pathAndRoot?.rootName || meta?.name
  const propPath = options?.path || (pathAndRoot?.pathPrefix ? [...pathAndRoot.pathPrefix, String(prop)] : [String(prop)])
  const rawBefore = target[prop]
  const key = String(prop)
  const numeric = typeof rawBefore === 'bigint' ? rawBefore : +rawBefore
  const after = operator === '++'
    ? (typeof numeric === 'bigint' ? numeric + 1n : numeric + 1)
    : (typeof numeric === 'bigint' ? numeric - 1n : numeric - 1)
  const beforeValue = redactValue(numeric, { path: propPath, key, rootName })
  const afterValue = redactValue(after, { path: propPath, key, rootName })
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: meta?.id,
      name: rootName || meta?.name || String(prop),
      path: propPath,
      operation: operator === '++' ? 'increment' : 'decrement',
      before: beforeValue,
      after: afterValue,
      source,
      target,
      ...mutationFieldsFromMeta(meta)
    })
    traceCollector.setActiveMutation(mutationEvent)

    target[prop] = after
    return isPrefix ? after : numeric
  } finally {
    traceCollector.setActiveMutation(null)
  }
}

export function __trace_call(
  target: any,
  method: string,
  args: any[],
  source: SourceLocation,
  options?: TraceMutationOptions
): any {
  if (!traceCollector.isEnabled() || !isRegisteredReactive(target)) {
    return target[method](...args)
  }

  const meta = getReactiveMeta(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName = options?.rootName || pathAndRoot?.rootName || meta?.name
  const propPath = options?.path || pathAndRoot?.pathPrefix || []
  const reactiveName = rootName
    ? (propPath.length > 0 ? `${rootName}.${propPath.join('.')}` : rootName)
    : (meta?.name || 'anonymous')

  let op: MutationOperation = method as any
  if (method === 'set') op = 'map-set'
  else if (method === 'add') op = 'set-add'
  else if (method === 'delete') op = 'delete'
  else if (method === 'clear') op = 'clear'

  const before = safeClone(target, propPath, rootName)
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: meta?.id,
      name: reactiveName,
      path: propPath,
      operation: op,
      before,
      after: undefined,
      source,
      target,
      ...mutationFieldsFromMeta(meta)
    })
    traceCollector.setActiveMutation(mutationEvent)

    const result = target[method](...args)
    mutationEvent.after = safeClone(target, propPath, rootName)
    return result
  } finally {
    traceCollector.setActiveMutation(null)
  }
}

export function __trace_delete(
  target: any,
  prop: any,
  source: SourceLocation,
  options?: TraceMutationOptions
): boolean {
  if (!traceCollector.isEnabled() || !isRegisteredReactive(target)) {
    return delete target[prop]
  }

  const meta = getReactiveMeta(target)
  const pathAndRoot = getReactivePathAndRoot(target)
  const rootName = options?.rootName || pathAndRoot?.rootName || meta?.name
  const propPath = options?.path || (pathAndRoot?.pathPrefix ? [...pathAndRoot.pathPrefix, String(prop)] : [String(prop)])
  const before = safeClone(target[prop], propPath, rootName)
  let mutationEvent: MutationEvent | null = null

  try {
    mutationEvent = traceCollector.recordMutation({
      reactiveId: meta?.id,
      name: rootName || meta?.name || String(prop),
      path: propPath,
      operation: 'delete',
      before,
      after: undefined,
      source,
      target,
      ...mutationFieldsFromMeta(meta)
    })
    traceCollector.setActiveMutation(mutationEvent)

    const result = delete target[prop]
    mutationEvent.after = undefined
    return result
  } finally {
    traceCollector.setActiveMutation(null)
  }
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
