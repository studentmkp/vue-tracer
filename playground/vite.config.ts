import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import reactiveTrace from '../packages/vite-plugin/src/index.ts'
import { resolve } from 'path'

const currentDir = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      '@vue-reactive-trace/runtime': resolve(currentDir, '../packages/runtime/src'),
      '@vue-reactive-trace/vue-adapter': resolve(currentDir, '../packages/vue-adapter/src'),
      '@vue-reactive-trace/devtools-ui': resolve(currentDir, '../packages/devtools-ui/src'),
      '@vue-reactive-trace/vite': resolve(currentDir, '../packages/vite-plugin/src')
    }
  },
  plugins: [
    reactiveTrace(),
    vue()
  ]
})
