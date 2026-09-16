# Vue Reactive Trace

A development-time causality tracer for Vue 3.

It records **why** state changed — not just that it changed — by connecting a user interaction (or async task) to the mutations, computed/watch work, and component renders that follow.

```
click / input
  → async / microtask / timeout
    → ref / reactive / Pinia mutation
      → computed + watch
        → component trigger + render
```

Each event keeps a source location so you can jump from the overlay back to the line that caused it.

This repo is an npm workspaces monorepo at version `0.0.1`. Packages currently export TypeScript source (no published build yet).

## Features

- **Exact source locations** for `ref`, `shallowRef`, `reactive`, `shallowReactive`, and `computed` declarations, plus assignments and mutating methods (`push`, `splice`, `Map.set`, …)
- **Scope labels**: component-local (`<script setup>`), module-level globals, and `use*` composables
- **Vue + Pinia**: render trigger/duration via a Vue plugin; Pinia stores registered automatically when present
- **Async context**: traces stay tied to the interaction that started them across `await`, microtasks, and timers
- **In-app overlay**: timeline + flow views, filters, aggregation of noisy mutation bursts, JSON export
- **Open in editor**: click a location in the overlay to open VS Code, Cursor, or WebStorm
- **Redaction**: `password`, `token`, `secret`, `authorization`, and `cookie` (and common variants) are stored as `[REDACTED]`
- **Dev-only by default**: Vite `build` does not instrument unless you set `enabled: true`

## Packages

| Package | Role |
| --- | --- |
| `@vue-reactive-trace/vite` | Vite plugin (`enforce: 'pre'`). Instruments `.vue` / `.ts` / `.js` before `@vitejs/plugin-vue` |
| `@vue-reactive-trace/runtime` | Collector, registry, install/uninstall of tracing, redaction |
| `@vue-reactive-trace/vue-adapter` | Vue plugin + Pinia store registration |
| `@vue-reactive-trace/devtools-ui` | Floating overlay (`initDevTools()`) |
| `playground` | Interactive demo of the full chain |

## Requirements

- Node.js 18+
- Vue 3.5+
- Vite 5+ (playground uses Vite 6+)

## Quick start (this repo)

```bash
npm install
npm run dev
```

Open the playground, click around, then use the badge in the **bottom-right** to open the overlay.

```bash
npm test    # vitest
npm run build
```

## Use in a Vite + Vue app

Install the workspace packages (or link them) and wire three things: the Vite plugin, the Vue adapter, and the overlay.

### 1. Vite plugin — before `vue()`

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import reactiveTrace from '@vue-reactive-trace/vite'

export default defineConfig({
  plugins: [
    reactiveTrace({
      editor: 'cursor', // 'vscode' | 'cursor' | 'webstorm' | custom binary
      // redact: ['**.ssn'],
      // maxMemoryMB: 50,
      // events: ['mutation', 'computed', 'watch', 'async', 'component-render'],
      // enabled: true, // also instrument `vite build`
    }),
    vue(),
  ],
})
```

**Order matters.** This plugin must run **before** `@vitejs/plugin-vue` so it still sees `<script setup>` as written. If the order is wrong, Vite logs:

`[vue-reactive-trace] plugin ordering violated`

Production / `vite build` skips transforms unless `enabled: true`.

### 2. Vue adapter + overlay

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { reactiveTraceVueAdapter } from '@vue-reactive-trace/vue-adapter'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(reactiveTraceVueAdapter)
app.mount('#app')

initDevTools()
```

Call `app.use(pinia)` **before** the adapter so Pinia stores are registered. If Pinia is installed later, the adapter still wraps `app.use` and attaches its Pinia plugin.

### When tracing starts

`app.use(reactiveTraceVueAdapter)` is the single install path. Installing the adapter is what

- patches `Promise.prototype.then`, `queueMicrotask`, `requestAnimationFrame`, and short `setTimeout`s so async work stays on the Trace that started it, and
- attaches the capture-phase `click` / `input` / `change` / `submit` / `keydown` listeners that start interaction Traces.

**Importing `@vue-reactive-trace/runtime` does none of this.** The collector, registry, transform helpers, and redaction are inert until something installs them, so a test — or any host that only wants mutations — can import the runtime without inheriting global patches or DOM listeners.

Outside a Vue app, install the same two halves yourself:

```ts
import { installTracing, uninstallTracing } from '@vue-reactive-trace/runtime'

installTracing()                        // async + interactions
installTracing({ async: false })        // interactions only
uninstallTracing()                      // restore every patched global
```

`setEnabled(false)` is still there, but it is a per-collector switch: recording is silenced while the patches and listeners stay in place. Use `uninstallTracing()` when you want the host globals genuinely untouched.

### 3. Third-party reactive state

Libraries such as VueUse are not rewritten by the plugin. Mark them yourself:

```ts
import { registerExternalReactive } from '@vue-reactive-trace/runtime'

registerExternalReactive(mousePos, {
  name: 'mousePos',
  origin: '@vueuse/core',
})
```

Those events are tagged `isExternal` so the overlay’s **app code only** filter can hide them.

## Overlay

The overlay is a fixed panel (not a browser-extension DevTools tab).

| Control | What it does |
| --- | --- |
| Timeline | Ordered events for the selected trace |
| Flow | Causality graph for the same trace |
| Filters | Type, text query, app-code-only |
| Location chip | Opens the file via `GET /__reactive-trace/open-source?file=&line=&column=` |
| Export | Downloads `vue-trace-*.json` (`TraceExportData`) |

## Plugin options

| Option | Default | Notes |
| --- | --- | --- |
| `enabled` | `false` for `vite build` | Dev server always instruments. Set `true` to instrument production builds. |
| `editor` | `EDITOR` / `VISUAL`, else VS Code | Used by the open-source middleware |
| `redact` | built-in sensitive keys | Extra glob strings (`'**.ssn'`) or `(value, ctx) => unknown` functions |
| `maxMemoryMB` | unset | Passed through to runtime config |
| `events` | unset | Restrict recorded event types when set |

`include`, `exclude`, `async`, `computed`, `watch`, and `pinia` exist on the options type for the planned config surface; the transform currently always instruments supported syntax in app source (not `node_modules`, not this repo’s `packages/*/src`).

## What gets instrumented

The transform wraps:

- Declarations: `ref` / `shallowRef` / `reactive` / `shallowReactive` / `computed`
- Assignments and update expressions (`++`, `--`)
- Mutating calls: array methods, `Map`/`Set` mutators
- `watch` / `watchEffect` callbacks
- Async boundaries so a trace can outlive the original click handler

`<script setup>` top-level declarations are **local to the component**, not treated as module singletons.

## Privacy

Mutation `before` / `after` snapshots go through redaction before they are stored. Default keys (substring match, separator-insensitive):

`password`, `token`, `secret`, `authorization`, `cookie`

Example: `accessToken`, `refresh_token`, and `userPassword` are all redacted.

Do not ship the overlay or `enabled: true` builds to untrusted environments if traces may contain other PII.

## Layout

```
packages/
  vite-plugin/    @vue-reactive-trace/vite
  runtime/        @vue-reactive-trace/runtime
  vue-adapter/    @vue-reactive-trace/vue-adapter
  devtools-ui/    @vue-reactive-trace/devtools-ui
playground/       demo app
tests/            acceptance, redaction, plugin order, script-setup e2e
```

## Status

Early MVP. Useful for local debugging of Vue reactivity; APIs and overlay UX can still change. Contributions should keep plugin order, redaction, and `<script setup>` scope behavior covered by the existing tests.
