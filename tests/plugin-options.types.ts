/**
 * §44 type-surface contract for `ReactiveTracePluginOptions`.
 *
 * This is not a Vitest test — `plugin-options.types.test.ts` typechecks it with
 * `tsc` and fails on any diagnostic reported against this file. The directives
 * below *are* the assertions: while an option stays on the interface its
 * `@ts-expect-error` is unused (TS2578), and once it is removed the directive
 * suppresses a real excess-property error (TS2353).
 *
 * An option may only leave this file when the transform/runtime genuinely
 * honours it — see docs/plans/issue-6-plugin-config.md.
 */
import type { ReactiveTracePluginOptions } from '@vue-reactive-trace/vite'

const valid: ReactiveTracePluginOptions = {
  enabled: true,
  editor: 'cursor',
  redact: ['**.ssn', (value, ctx) => (ctx.key === 'ssn' ? '[SSN]' : value)]
}
void valid

// @ts-expect-error include: the transform already instruments all app source
const withInclude: ReactiveTracePluginOptions = { include: ['src/**'] }
// @ts-expect-error exclude: no ignore list is consulted during transform
const withExclude: ReactiveTracePluginOptions = { exclude: ['**/*.spec.ts'] }
// @ts-expect-error events: recording is not event-filtered
const withEvents: ReactiveTracePluginOptions = { events: ['mutation'] }
// @ts-expect-error async: async tracing is installed by the adapter, not configured here
const withAsync: ReactiveTracePluginOptions = { async: false }
// @ts-expect-error computed: computed instrumentation is always on
const withComputed: ReactiveTracePluginOptions = { computed: false }
// @ts-expect-error watch: watch instrumentation is always on
const withWatch: ReactiveTracePluginOptions = { watch: false }
// @ts-expect-error pinia: Pinia stores are registered by the Vue adapter
const withPinia: ReactiveTracePluginOptions = { pinia: false }
// @ts-expect-error maxMemoryMB: no retention policy is implemented
const withMemory: ReactiveTracePluginOptions = { maxMemoryMB: 50 }

void [withInclude, withExclude, withEvents, withAsync, withComputed, withWatch, withPinia, withMemory]
