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
- **Vue + Pinia**: component trigger/render causality owned by the Vue adapter; Pinia stores registered automatically in either install order
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
| `@vue-reactive-trace/vue-adapter` | Vue plugin: component causality + Pinia store registration |
| `@vue-reactive-trace/devtools-ui` | Floating overlay (`initDevTools()`) |
| `playground` | Interactive demo of the full chain |

## Requirements

- Node.js 18+
- Vue 3.5+
- Vite 5+ (playground uses Vite 8)

## Quick start (this repo)

```bash
npm install
npm run dev
```

Open the playground, click around, then use the badge in the **bottom-right** to open the overlay.

```bash
npm test           # Vitest runtime/integration tests
npm run typecheck  # tsc --noEmit over the whole repo
npm run build      # production build of the playground
```

Vitest and the Vite build transpile without full typechecking, so run `tsc` explicitly before shipping.

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
      // events: ['mutation', 'component-render'], // only retain these event types
      // maxMemoryMB: 25, // retention budget for retained traces, in MiB
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

Call `app.use(pinia)` **before** the adapter so Pinia stores are registered. If Pinia arrives later through `app.use(pinia)`, the adapter's wrapped `app.use` attaches its Pinia plugin then, and stores created before the plugin was attached are registered too.

### Component causality

The adapter owns the link from a mutation to the component it updates. Vue's `renderTriggered` hook names the dependency that fired the update, and the adapter resolves the recorded mutation that wrote it; the `updated` hook carries that id onto the render event. The correlation therefore does not depend on the collector's active-mutation window still being open when Vue flushes.

The adapter records through the runtime's small `TraceRecorder` seam. Tests can use
`InMemoryTraceRecorder` without intercepting writes to the collector singleton:

```ts
import { InMemoryTraceRecorder } from '@vue-reactive-trace/runtime'
import { createComponentCausalityMixin } from '@vue-reactive-trace/vue-adapter'

const recorder = new InMemoryTraceRecorder({ currentTrace: trace })
const mixin = createComponentCausalityMixin(recorder)
```

or inject one when installing:

```ts
app.use(reactiveTraceVueAdapter, { recorder })
```

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
installTracing({ recorder })            // record through an injected adapter
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
| `events` | all recorded event types | Recording allow-list; valid values are `interaction`, `mutation`, `computed`, `watch`, `component-trigger`, `component-render`, and `async` |
| `maxMemoryMB` | unset (unlimited) | Retention budget for the retained trace payload, in MiB. Fractions are allowed. An invalid value throws a `RangeError` from `configureRecording()` |

`events` is applied while recording, before an event enters `Trace.events`. Leaving it
undefined retains every recorded event; `events: []` retains none. The trace trigger
(including an interaction's event and target metadata, or a manual trigger) is kept
regardless of this list. The overlay and JSON export read the same retained
`Trace.events`; their interactive filters only change the current view.

If a dependent event is allowed but the mutation that would have caused it is not,
the dependent event is still retained without `triggeredByMutationId`. The collector
never secretly retains the dropped mutation or emits a dangling causal id. Async
subtypes such as `microtask` are values of an `async` event's `taskType`, not values
for the top-level `events` option. A recording-policy call (`configureRecording({...})`)
replaces the whole policy: omitted fields reset to their defaults (all events, no budget).
Re-applying the same values is idempotent, so the per-module preamble cannot clear
traces or toggle recording.

### Bounded retention (`maxMemoryMB`)

`maxMemoryMB` caps the retained trace payload. It is an estimate of what the collector
keeps, **not** a JavaScript heap limit:

- The size of a Trace is the UTF-8 byte length of its compact, export-safe JSON. The
  live-only `target` reference on a mutation is excluded; the trigger, timestamps,
  status, events, and snapshots are included. The export wrapper (`version`, `summary`,
  array separators) and collector bookkeeping are not counted.
- Eviction always removes whole Traces, never single events. Only completed Traces are
  evicted, oldest `startedAt` first (ties keep their retained order). The Trace the
  collector is currently recording is never evicted.
- The current Trace is allowed to overshoot the budget on its own. When that happens,
  the collector keeps the complete Trace, stops recording (auto-pause), and the overlay
  shows the paused state immediately. Resume with an explicit `setEnabled(true)`, which
  first enforces the budget: a completed oversized current Trace can be evicted to make
  room; an active oversized one keeps recording paused until it finishes, the budget is
  raised, or `clearTraces()` runs.
- `setEnabled(false)` only stops new traces, events, and async adoption; retained Traces
  are untouched. Already adopted async work still settles and can complete its Trace.
- `clearTraces()` empties retained Traces, the mutation index, and session state but keeps
  the `events`/`maxMemoryMB` policy and the enabled/disabled flag. After an overflow
  auto-pause, clearing still requires an explicit `setEnabled(true)`.
- `importTraces()` is a data load, so it works while recording is disabled, but it applies
  the same budget: imported `active` Traces become completed snapshots, a local active
  current Trace is never replaced, and an oversized import evicts older completed Traces
  (or auto-pauses when the selected Trace alone cannot fit).

Completed Traces release their mutation `target` references, so finished history does not
pin live application state; `maxMemoryMB` does not include those references while the
Trace is being recorded.

The transform instruments supported syntax in app source (not `node_modules`, not this repo’s `packages/*/src`).

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
