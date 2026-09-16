/**
 * Repo-wide shim for `.vue` imports.
 *
 * The root `tsc --noEmit` gate covers playground and test fixtures as plain
 * TypeScript, so they need `*.vue` module declarations to resolve. This only
 * declares the module shape (a Vue component); it does not typecheck SFC
 * template or `<script setup>` contents — use `vue-tsc` for that.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
