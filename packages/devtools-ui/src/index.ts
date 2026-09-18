import {
  createOverlayController,
  OverlayController
} from './overlay-controller'
import type { OverlayControllerOptions } from './types'

let defaultController: OverlayController | null = null

export function initDevTools(options?: OverlayControllerOptions): OverlayController | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

  if (document.getElementById('__vue_reactive_trace_devtools__')) {
    return defaultController ?? undefined
  }

  defaultController = createOverlayController(options)
  return defaultController
}

export * from './types'
export * from './formatters'
export * from './styles'
export * from './detail'
export * from './timeline'
export * from './flow'
export * from './overlay-controller'
