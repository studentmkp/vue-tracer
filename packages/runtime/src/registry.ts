import { toRaw, isRef, isReactive, isProxy } from 'vue'
import type { ReactiveMetadata } from './types'

const registry = new WeakMap<object, ReactiveMetadata>()
const childToParentMap = new WeakMap<object, { parent: object; key: string; root: object; path: string[] }>()
let idCounter = 1

export function isReactiveCandidate(val: unknown): val is object {
  return val !== null && (typeof val === 'object' || typeof val === 'function')
}

function registerNestedChildren(target: any, root: object, path: string[], visited = new WeakSet<object>()) {
  if (!isReactiveCandidate(target)) return
  const raw = toRaw(target)
  if (visited.has(raw)) return
  visited.add(raw)

  if (path.length > 5) return
  if (Array.isArray(raw)) return

  for (const key of Object.keys(raw)) {
    if (key.startsWith('$') || key.startsWith('_') || key === 'effect' || key === 'dep') continue
    try {
      const child: unknown = Reflect.get(raw, key)
      if (isReactiveCandidate(child)) {
        const childRaw = toRaw(child)
        const childPath = [...path, key]
        childToParentMap.set(child, { parent: target, key, root, path: childPath })
        if (childRaw !== child) {
          childToParentMap.set(childRaw, { parent: target, key, root, path: childPath })
        }
        if (!visited.has(childRaw)) {
          registerNestedChildren(child, root, childPath, visited)
        }
      }
    } catch {
      // Ignore getter side-effects
    }
  }
}

export function registerReactive<T>(target: T, metadata?: Partial<ReactiveMetadata>): T {
  if (!isReactiveCandidate(target)) {
    return target
  }

  const raw = toRaw(target)
  const inferredType = isRef(target) ? 'ref' : isReactive(target) ? 'reactive' : 'unknown'

  const isExternal = metadata?.isExternal ?? false
  const meta: ReactiveMetadata = {
    id: metadata?.id || `reactive_${idCounter++}`,
    name: metadata?.name || 'anonymous',
    type: metadata?.type || inferredType,
    source: metadata?.source,
    scope: metadata?.scope || (metadata?.composable ? 'composable' : 'local'),
    composable: metadata?.composable,
    origin: metadata?.origin,
    isExternal,
    traceLevel: metadata?.traceLevel || (isExternal ? 'partial' : 'full')
  }

  registry.set(target, meta)
  if (raw !== target) {
    registry.set(raw, meta)
  }

  registerNestedChildren(target, target, [])

  return target
}

export function registerExternalReactive<T>(
  target: T,
  options?: { name?: string; origin?: string }
): T {
  return registerReactive(target, {
    name: options?.name || 'externalReactive',
    type: isRef(target) ? 'ref' : isReactive(target) ? 'reactive' : 'unknown',
    isExternal: true,
    origin: options?.origin || 'external',
    traceLevel: 'partial',
    scope: 'local'
  })
}

export function getReactivePathAndRoot(target: unknown): { rootName?: string; pathPrefix?: string[] } | undefined {
  if (!isReactiveCandidate(target)) return undefined
  const raw = toRaw(target)
  const entry = childToParentMap.get(target) || childToParentMap.get(raw)
  if (entry) {
    const rootMeta = registry.get(entry.root) || registry.get(toRaw(entry.root))
    return {
      rootName: rootMeta?.name,
      pathPrefix: entry.path
    }
  }
  return undefined
}

export function getReactiveMeta(target: unknown): ReactiveMetadata | undefined {
  if (!isReactiveCandidate(target)) {
    return undefined
  }

  let meta = registry.get(target)
  if (!meta) {
    const raw = toRaw(target)
    if (raw !== target) {
      meta = registry.get(raw)
    }
  }

  // Check child to parent map
  if (!meta) {
    const raw = toRaw(target)
    const entry = childToParentMap.get(target) || childToParentMap.get(raw)
    if (entry) {
      const rootMeta = registry.get(entry.root) || registry.get(toRaw(entry.root))
      if (rootMeta) {
        meta = {
          id: rootMeta.id,
          name: rootMeta.name,
          type: rootMeta.type,
          source: rootMeta.source,
          scope: rootMeta.scope,
          composable: rootMeta.composable,
          origin: rootMeta.origin,
          isExternal: rootMeta.isExternal,
          traceLevel: rootMeta.traceLevel
        }
        return meta
      }
    }
  }

  // If not explicitly registered via AST declaration, but is a Vue reactive/ref at runtime
  if (!meta && (isRef(target) || isReactive(target) || isProxy(target))) {
    const inferredType = isRef(target) ? 'ref' : 'reactive'
    meta = {
      id: `reactive_auto_${idCounter++}`,
      name: 'anonymous',
      type: inferredType,
      scope: 'local',
      isExternal: true,
      origin: 'external',
      traceLevel: 'partial'
    }
    registry.set(target, meta)
  }

  return meta
}

export function isRegisteredReactive(target: unknown): boolean {
  if (!isReactiveCandidate(target)) {
    return false
  }
  return isRef(target) || isReactive(target) || registry.has(target) || registry.has(toRaw(target)) || childToParentMap.has(target) || childToParentMap.has(toRaw(target))
}
