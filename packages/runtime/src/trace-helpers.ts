import { traceCollector } from './collector'
import { registerReactive } from './registry'
import { redactValue } from './redact'
import {
  recordInstrumentedMutation,
  safeClone,
  type TraceMutationOptions
} from './mutation-recording'
import type { MutationOperation, ReactiveMetadata, SourceLocation } from './types'

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
  let op: MutationOperation = method as MutationOperation
  if (method === 'set') op = 'map-set'
  else if (method === 'add') op = 'set-add'
  else if (method === 'delete') op = 'delete'
  else if (method === 'clear') op = 'clear'

  return recordInstrumentedMutation({
    target,
    source,
    options,
    pathMode: 'collection',
    nameMode: 'qualified',
    operation: op,
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
