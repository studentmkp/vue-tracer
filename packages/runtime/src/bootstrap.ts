import { installAsyncTracking, uninstallAsyncTracking } from './async-context'
import { installInteractionCapture, uninstallInteractionCapture } from './interaction-capture'

export interface InstallTracingOptions {
  /** Adopt Promise/microtask/rAF/timeout continuations into the active Trace. */
  async?: boolean
  /** Listen for click/input/change/submit/keydown on `document`. */
  interactions?: boolean
}

/**
 * The one place tracing starts: patches globals and attaches DOM listeners.
 *
 * Importing the runtime never does this on its own — a host calls this (or installs
 * the Vue adapter, which calls it for you).
 */
export function installTracing(options: InstallTracingOptions = {}): void {
  const { async: asyncTracking = true, interactions = true } = options

  if (asyncTracking) installAsyncTracking()
  if (interactions) installInteractionCapture()
}

/** Undoes whatever `installTracing` installed. */
export function uninstallTracing(options: InstallTracingOptions = {}): void {
  const { async: asyncTracking = true, interactions = true } = options

  if (asyncTracking) uninstallAsyncTracking()
  if (interactions) uninstallInteractionCapture()
}

export { installAsyncTracking, uninstallAsyncTracking, isAsyncTrackingInstalled } from './async-context'
export {
  installInteractionCapture,
  uninstallInteractionCapture,
  isInteractionCaptureInstalled,
  INTERACTION_EVENTS
} from './interaction-capture'
