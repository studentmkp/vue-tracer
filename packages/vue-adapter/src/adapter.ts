import type { App, ComponentOptions, Plugin } from 'vue'
import {
  collectorRecorder,
  registerReactive,
  installTracing,
  type TraceRecorder
} from '@vue-reactive-trace/runtime'
import { createComponentCausalityMixin } from './component-causality'

export interface VueAdapterOptions {
  /**
   * Recorder seam. Defaults to the production collector adapter; tests can inject
   * an in-memory recorder without touching the collector singleton.
   */
  recorder?: TraceRecorder
}

const tracedStores = new WeakSet<object>()

export function reactiveTracePiniaPlugin({ store }: { store: any }) {
  if (!store || tracedStores.has(store)) return
  tracedStores.add(store)

  if (store.$state) {
    registerReactive(store.$state, {
      name: store.$id,
      type: 'pinia',
      scope: 'module'
    })
  }

  registerReactive(store, {
    name: store.$id,
    type: 'pinia',
    scope: 'module'
  })
}

export function createPiniaTracePlugin() {
  return reactiveTracePiniaPlugin
}

interface PiniaLike {
  use(plugin: typeof reactiveTracePiniaPlugin): unknown
  _s?: Map<string, unknown>
}

function isPiniaLike(value: unknown): value is PiniaLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as any
  return (
    typeof candidate.install === 'function' &&
    typeof candidate.use === 'function' &&
    '_a' in candidate
  )
}

const tracedPinias = new WeakSet<object>()

/**
 * Attaches the Pinia plugin however Pinia shows up:
 *
 * - `pinia` was installed before the adapter — `$pinia` is already on `app`;
 * - `app.use(pinia)` runs after the adapter — the wrapped `app.use` reports it;
 * - stores already exist (created before the plugin was attached) — register them now.
 */
function registerPiniaTraces(value: unknown): void {
  if (!isPiniaLike(value)) return
  if (tracedPinias.has(value as object)) return
  tracedPinias.add(value as object)

  value.use(reactiveTracePiniaPlugin)

  // `pinia.use` only reaches stores created afterwards; retrofit the existing ones.
  if (value._s instanceof Map) {
    for (const store of value._s.values()) {
      try {
        reactiveTracePiniaPlugin({ store })
      } catch {
        // A store that cannot be walked must not break adapter install.
      }
    }
  }
}

export const reactiveTraceVueAdapter: Plugin<[VueAdapterOptions?]> = {
  install(app: App, options: VueAdapterOptions = {}) {
    // Tracing starts here: this is the documented single install path.
    const recorder = options.recorder ?? collectorRecorder
    installTracing({ recorder })

    app.mixin(createComponentCausalityMixin(recorder) as ComponentOptions)

    // Pinia may already be installed when the adapter arrives…
    registerPiniaTraces((app.config.globalProperties as any)?.$pinia)

    // …or arrive later through `app.use`.
    const origUse = app.use.bind(app)
    app.use = function (plugin: any, ...useOptions: any[]) {
      const result = origUse(plugin, ...useOptions)
      registerPiniaTraces(plugin)
      return result
    }
  }
}
