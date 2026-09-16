import { traceCollector } from './collector'

/** Events that start an interaction Trace. Listeners are attached in capture phase. */
export const INTERACTION_EVENTS = ['click', 'input', 'change', 'submit', 'keydown'] as const

type InteractionEventName = (typeof INTERACTION_EVENTS)[number]

interface AttachedListener {
  type: InteractionEventName
  handler: (event: Event) => void
}

let attached: AttachedListener[] | null = null

function createHandler(eventName: InteractionEventName) {
  return (event: Event) => {
    if (!traceCollector.isEnabled()) return

    const target = event.target as HTMLElement | null
    // Avoid tracking devtool internal events
    if (target && target.closest && target.closest('#__vue_reactive_trace_devtools__')) {
      return
    }

    traceCollector.startInteractionTrace(eventName, target)
  }
}

/**
 * Starts capturing click/input/change/submit/keydown as interaction Traces.
 * Idempotent, and a no-op outside a DOM environment.
 */
export function installInteractionCapture(): void {
  if (attached) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  attached = INTERACTION_EVENTS.map((type) => {
    const handler = createHandler(type)
    document.addEventListener(type, handler, true)
    return { type, handler }
  })
}

/** Stops capturing interaction Traces and removes the document listeners. */
export function uninstallInteractionCapture(): void {
  if (!attached) return

  if (typeof document !== 'undefined') {
    for (const { type, handler } of attached) {
      document.removeEventListener(type, handler, true)
    }
  }

  attached = null
}

export function isInteractionCaptureInstalled(): boolean {
  return attached !== null
}
