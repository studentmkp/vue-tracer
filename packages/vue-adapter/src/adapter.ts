import type { App, Plugin } from 'vue'
import { traceCollector, registerReactive, installTracing } from '@vue-reactive-trace/runtime'

export function reactiveTracePiniaPlugin({ store }: { store: any }) {
  if (!store) return

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

function getComponentInfo(vm: any): { name: string; file?: string } {
  const instance = vm?.$
  const type = instance?.type || vm?.$options || {}
  const file = type.__file || vm?.$options?.__file
  let name = type.__name || type.name || vm?.$options?.name

  if (!name && file) {
    const filename = file.split(/[/\\]/).pop() || ''
    name = filename.replace(/\.(vue|ts|js|jsx|tsx)$/, '')
  }

  return {
    name: name || 'Component',
    file
  }
}

export const reactiveTraceVueAdapter: Plugin = {
  install(app: App) {
    // Tracing starts here: this is the documented single install path.
    installTracing()

    // Auto-integrate with Pinia if present
    const pinia = (app.config.globalProperties as any)?.$pinia
    if (pinia && typeof pinia.use === 'function') {
      pinia.use(reactiveTracePiniaPlugin)
    }

    const origUse = app.use.bind(app)
    app.use = function (plugin: any, ...options: any[]) {
      const result = origUse(plugin, ...options)
      if (plugin && typeof plugin.use === 'function') {
        try {
          plugin.use(reactiveTracePiniaPlugin)
        } catch {
          // Ignore if not a pinia instance
        }
      }
      return result
    }

    app.mixin({
      renderTriggered(event: any) {
        if (!traceCollector.isEnabled()) return
        const info = getComponentInfo(this)
        traceCollector.recordComponentTrigger(info.name, info.file)
      },
      beforeUpdate() {
        if (!traceCollector.isEnabled()) return
        ;(this as any).__trace_render_start = performance.now()
      },
      updated() {
        if (!traceCollector.isEnabled()) return
        const info = getComponentInfo(this)
        const start = (this as any).__trace_render_start || performance.now()
        const end = performance.now()
        traceCollector.recordComponentRender(info.name, start, end, info.file)
      }
    })
  }
}
