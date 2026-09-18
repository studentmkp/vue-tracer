import { collectorRecorder, type TraceRecorder } from './recorder'

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
export function installAsyncTracking(recorder: TraceRecorder = collectorRecorder): void {
  if (patches) return

  const applied: PatchedGlobal[] = []

  // 1. Intercept Promise.prototype.then
  if (typeof Promise !== 'undefined' && Promise.prototype && Promise.prototype.then) {
    const origThen = Promise.prototype.then

    patch(
      Promise.prototype,
      'then',
      function (this: any, onFulfilled?: any, onRejected?: any) {
        const trace = recorder.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          !recorder.isEnabled() ||
          recorder.isInternalAsync()
        ) {
          return origThen.call(this, onFulfilled, onRejected)
        }

        recorder.adoptAsyncTask(trace, 'promise')

        const wrappedFulfilled =
          typeof onFulfilled === 'function'
            ? function (this: any, ...args: any[]) {
                return recorder.runWithTrace(trace, () => {
                  try {
                    return onFulfilled.apply(this, args)
                  } finally {
                    recorder.settleAsyncTask(trace)
                  }
                })
              }
            : onFulfilled

        const wrappedRejected =
          typeof onRejected === 'function'
            ? function (this: any, ...args: any[]) {
                return recorder.runWithTrace(trace, () => {
                  try {
                    return onRejected.apply(this, args)
                  } finally {
                    recorder.settleAsyncTask(trace)
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
        const trace = recorder.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          !recorder.isEnabled() ||
          recorder.isInternalAsync() ||
          typeof cb !== 'function'
        ) {
          return origQueueMicrotask(cb)
        }

        recorder.adoptAsyncTask(trace, 'microtask')

        return origQueueMicrotask(() => {
          recorder.runWithTrace(trace, () => {
            try {
              cb()
            } finally {
              recorder.settleAsyncTask(trace)
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
        const trace = recorder.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          !recorder.isEnabled() ||
          recorder.isInternalAsync() ||
          typeof cb !== 'function'
        ) {
          return origRaf(cb)
        }

        recorder.adoptAsyncTask(trace, 'raf')

        return origRaf((ts: number) => {
          recorder.runWithTrace(trace, () => {
            try {
              cb(ts)
            } finally {
              recorder.settleAsyncTask(trace)
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
        const trace = recorder.getCurrentTrace()
        if (
          !trace ||
          trace.status !== 'active' ||
          !recorder.isEnabled() ||
          recorder.isInternalAsync() ||
          typeof cb !== 'function' ||
          numDelay > MAX_TRACKED_DELAY_MS
        ) {
          return origSetTimeout(cb, delay, ...args)
        }

        recorder.adoptAsyncTask(trace, 'timeout')

        return origSetTimeout(
          (...cbArgs: any[]) => {
            recorder.runWithTrace(trace, () => {
              try {
                cb(...cbArgs)
              } finally {
                recorder.settleAsyncTask(trace)
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
