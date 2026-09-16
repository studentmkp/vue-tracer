import { traceCollector } from './collector'

/** setTimeout callbacks longer than this are not adopted into the current Trace. */
const MAX_TRACKED_DELAY_MS = 3000

interface PatchedGlobal {
  target: any
  key: string
  original: any
}

let patches: PatchedGlobal[] | null = null

function patch(target: any, key: string, replacement: any, applied: PatchedGlobal[]) {
  applied.push({ target, key, original: target[key] })
  target[key] = replacement
}

/**
 * Adopts Promise/timer continuations into the Trace that is active when they are
 * scheduled, so an interaction keeps its causality across `await` and timers.
 *
 * Adoption and settling are session lifecycle calls (`adoptAsyncTask` /
 * `settleAsyncTask`); this module only decides which globals to intercept.
 *
 * Explicit install: importing the runtime leaves the host globals untouched.
 */
export function installAsyncTracking(): void {
  if (patches) return

  const applied: PatchedGlobal[] = []

  // 1. Intercept Promise.prototype.then
  if (typeof Promise !== 'undefined' && Promise.prototype && Promise.prototype.then) {
    const origThen = Promise.prototype.then

    patch(
      Promise.prototype,
      'then',
      function (this: any, onFulfilled?: any, onRejected?: any) {
        const trace = traceCollector.getCurrentTrace()
        if (!trace || trace.status !== 'active' || traceCollector.isInternalAsync()) {
          return origThen.call(this, onFulfilled, onRejected)
        }

        traceCollector.adoptAsyncTask(trace, 'promise')

        const wrappedFulfilled =
          typeof onFulfilled === 'function'
            ? function (this: any, ...args: any[]) {
                return traceCollector.runWithTrace(trace, () => {
                  try {
                    return onFulfilled.apply(this, args)
                  } finally {
                    traceCollector.settleAsyncTask(trace)
                  }
                })
              }
            : onFulfilled

        const wrappedRejected =
          typeof onRejected === 'function'
            ? function (this: any, ...args: any[]) {
                return traceCollector.runWithTrace(trace, () => {
                  try {
                    return onRejected.apply(this, args)
                  } finally {
                    traceCollector.settleAsyncTask(trace)
                  }
                })
              }
            : onRejected

        return origThen.call(this, wrappedFulfilled, wrappedRejected)
      },
      applied
    )
  }

  // 2. Intercept queueMicrotask
  if (typeof queueMicrotask !== 'undefined') {
    const origQueueMicrotask = queueMicrotask
    const targetObj = typeof window !== 'undefined' ? window : globalThis
    patch(
      targetObj,
      'queueMicrotask',
      function (cb: () => void) {
        const trace = traceCollector.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          traceCollector.isInternalAsync() ||
          typeof cb !== 'function'
        ) {
          return origQueueMicrotask(cb)
        }

        traceCollector.adoptAsyncTask(trace, 'microtask')

        return origQueueMicrotask(() => {
          traceCollector.runWithTrace(trace, () => {
            try {
              cb()
            } finally {
              traceCollector.settleAsyncTask(trace)
            }
          })
        })
      },
      applied
    )
  }

  // 3. Intercept requestAnimationFrame
  const globalTarget =
    typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null
  if (globalTarget && typeof (globalTarget as any).requestAnimationFrame === 'function') {
    const origRaf = (globalTarget as any).requestAnimationFrame.bind(globalTarget)
    patch(
      globalTarget,
      'requestAnimationFrame',
      function (cb: (ts: number) => void) {
        const trace = traceCollector.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          traceCollector.isInternalAsync() ||
          typeof cb !== 'function'
        ) {
          return origRaf(cb)
        }

        traceCollector.adoptAsyncTask(trace, 'raf')

        return origRaf((ts: number) => {
          traceCollector.runWithTrace(trace, () => {
            try {
              cb(ts)
            } finally {
              traceCollector.settleAsyncTask(trace)
            }
          })
        })
      },
      applied
    )
  }

  // 4. Intercept setTimeout (for <= 3000ms delays)
  if (typeof setTimeout !== 'undefined') {
    const origSetTimeout = setTimeout
    const targetObj = typeof window !== 'undefined' ? window : globalThis
    patch(
      targetObj,
      'setTimeout',
      function (cb: any, delay?: number, ...args: any[]) {
        const numDelay = typeof delay === 'number' ? delay : 0
        const trace = traceCollector.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          traceCollector.isInternalAsync() ||
          typeof cb !== 'function' ||
          numDelay > MAX_TRACKED_DELAY_MS
        ) {
          return origSetTimeout(cb, delay, ...args)
        }

        traceCollector.adoptAsyncTask(trace, 'timeout')

        return origSetTimeout(
          (...cbArgs: any[]) => {
            traceCollector.runWithTrace(trace, () => {
              try {
                cb(...cbArgs)
              } finally {
                traceCollector.settleAsyncTask(trace)
              }
            })
          },
          delay,
          ...args
        )
      },
      applied
    )
  }

  patches = applied
}

/** Restores every patched global. The collector itself is left untouched. */
export function uninstallAsyncTracking(): void {
  if (!patches) return

  for (const { target, key, original } of patches) {
    target[key] = original
  }

  patches = null
}

export function isAsyncTrackingInstalled(): boolean {
  return patches !== null
}
