import { traceCollector } from './collector'

let isTrackingInitialized = false

export function initAsyncTracking() {
  if (isTrackingInitialized) return
  isTrackingInitialized = true

  // 1. Intercept Promise.prototype.then
  if (typeof Promise !== 'undefined' && Promise.prototype && (Promise.prototype as any).then) {
    const origThen = Promise.prototype.then

    Promise.prototype.then = function (onFulfilled?: any, onRejected?: any) {
      const trace = traceCollector.getCurrentTrace()
      if (!trace || trace.status !== 'active' || traceCollector.isInternalAsync()) {
        return origThen.call(this, onFulfilled, onRejected)
      }

      traceCollector.recordAsyncTask('promise')
      ;(trace as any).pendingTasks = ((trace as any).pendingTasks || 0) + 1

      const wrappedFulfilled =
        typeof onFulfilled === 'function'
          ? function (this: any, ...args: any[]) {
              return traceCollector.runWithTrace(trace, () => {
                try {
                  return onFulfilled.apply(this, args)
                } finally {
                  ;(trace as any).pendingTasks = Math.max(0, ((trace as any).pendingTasks || 0) - 1)
                  traceCollector.scheduleCompletion(trace)
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
                  ;(trace as any).pendingTasks = Math.max(0, ((trace as any).pendingTasks || 0) - 1)
                  traceCollector.scheduleCompletion(trace)
                }
              })
            }
          : onRejected

      return origThen.call(this, wrappedFulfilled, wrappedRejected)
    }
  }

  // 2. Intercept queueMicrotask
  if (typeof queueMicrotask !== 'undefined') {
    const origQueueMicrotask = queueMicrotask
    const targetObj = typeof window !== 'undefined' ? window : globalThis
    ;(targetObj as any).queueMicrotask = function (cb: () => void) {
      const trace = traceCollector.getCurrentTrace()
      if (
        !trace ||
        trace.status !== 'active' ||
        traceCollector.isInternalAsync() ||
        typeof cb !== 'function'
      ) {
        return origQueueMicrotask(cb)
      }

      traceCollector.recordAsyncTask('microtask')
      ;(trace as any).pendingTasks = ((trace as any).pendingTasks || 0) + 1

      return origQueueMicrotask(() => {
        traceCollector.runWithTrace(trace, () => {
          try {
            cb()
          } finally {
            ;(trace as any).pendingTasks = Math.max(0, ((trace as any).pendingTasks || 0) - 1)
            traceCollector.scheduleCompletion(trace)
          }
        })
      })
    }
  }

  // 3. Intercept requestAnimationFrame
  const globalTarget =
    typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null
  if (globalTarget && typeof (globalTarget as any).requestAnimationFrame === 'function') {
    const origRaf = (globalTarget as any).requestAnimationFrame.bind(globalTarget)
    ;(globalTarget as any).requestAnimationFrame = function (cb: (ts: number) => void) {
      const trace = traceCollector.getCurrentTrace()
      if (
        !trace ||
        trace.status !== 'active' ||
        traceCollector.isInternalAsync() ||
        typeof cb !== 'function'
      ) {
        return origRaf(cb)
      }

      traceCollector.recordAsyncTask('raf')
      ;(trace as any).pendingTasks = ((trace as any).pendingTasks || 0) + 1

      return origRaf((ts: number) => {
        traceCollector.runWithTrace(trace, () => {
          try {
            cb(ts)
          } finally {
            ;(trace as any).pendingTasks = Math.max(0, ((trace as any).pendingTasks || 0) - 1)
            traceCollector.scheduleCompletion(trace)
          }
        })
      })
    }
  }

  // 4. Intercept setTimeout (for <= 3000ms delays)
  if (typeof setTimeout !== 'undefined') {
    const origSetTimeout = setTimeout
    const targetObj = typeof window !== 'undefined' ? window : globalThis
    ;(targetObj as any).setTimeout = function (cb: any, delay?: number, ...args: any[]) {
      const numDelay = typeof delay === 'number' ? delay : 0
      const trace = traceCollector.getCurrentTrace()
      if (
        !trace ||
        trace.status !== 'active' ||
        traceCollector.isInternalAsync() ||
        typeof cb !== 'function' ||
        numDelay > 3000
      ) {
        return origSetTimeout(cb, delay, ...args)
      }

      traceCollector.recordAsyncTask('timeout')
      ;(trace as any).pendingTasks = ((trace as any).pendingTasks || 0) + 1

      return origSetTimeout((...cbArgs: any[]) => {
        traceCollector.runWithTrace(trace, () => {
          try {
            cb(...cbArgs)
          } finally {
            ;(trace as any).pendingTasks = Math.max(0, ((trace as any).pendingTasks || 0) - 1)
            traceCollector.scheduleCompletion(trace)
          }
        })
      }, delay, ...args)
    }
  }
}

// Auto-initialize async tracking
initAsyncTracking()
