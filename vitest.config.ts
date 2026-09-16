import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const currentDir = import.meta.dirname

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true
  },
  resolve: {
    alias: {
      '@vue-reactive-trace/runtime': resolve(currentDir, 'packages/runtime/src'),
      '@vue-reactive-trace/vue-adapter': resolve(currentDir, 'packages/vue-adapter/src'),
      '@vue-reactive-trace/devtools-ui': resolve(currentDir, 'packages/devtools-ui/src'),
      '@vue-reactive-trace/vite': resolve(currentDir, 'packages/vite-plugin/src')
    }
  }
})
