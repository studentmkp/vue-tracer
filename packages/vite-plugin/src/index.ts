import type { Plugin, PluginOption } from 'vite'
import { resolve, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { transformCode } from './transform.ts'
import type { RedactContext, TraceEventType } from '@vue-reactive-trace/runtime'

export interface ReactiveTracePluginOptions {
  enabled?: boolean
  editor?: 'vscode' | 'cursor' | 'webstorm' | string
  redact?: (string | ((value: unknown, ctx: RedactContext) => unknown))[]
  events?: TraceEventType[]
  /** Retention budget for retained Traces, in MiB. Unset means unlimited. */
  maxMemoryMB?: number
}

export function openInEditor(
  file: string,
  line: number = 1,
  column: number = 1,
  root?: string,
  preferredEditor?: string
): { success: boolean; targetPath: string; command?: string; error?: string } {
  const targetPath = root && !isAbsolute(file) ? resolve(root, file) : file
  const editor = preferredEditor || process.env.EDITOR || process.env.VISUAL

  let cmd = ''
  let args: string[] = []

  if (editor === 'cursor' || editor?.includes('cursor')) {
    cmd = 'cursor'
    args = ['-g', `${targetPath}:${line}:${column}`]
  } else if (editor === 'webstorm' || editor?.includes('webstorm')) {
    cmd = 'webstorm'
    args = ['--line', String(line), '--column', String(column), targetPath]
  } else if (editor === 'code' || editor?.includes('code') || !editor) {
    // Default to VS Code
    cmd = 'code'
    args = ['-g', `${targetPath}:${line}:${column}`]
  } else {
    cmd = editor
    args = [`${targetPath}:${line}:${column}`]
  }

  try {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true
    })
    child.on('error', () => {
      // Gracefully catch when editor executable is not in PATH
    })
    child.unref()
    return {
      success: true,
      targetPath,
      command: `${cmd} ${args.join(' ')}`
    }
  } catch (err: any) {
    return {
      success: false,
      targetPath,
      command: `${cmd} ${args.join(' ')}`,
      error: err.message
    }
  }
}

export function handleOpenSourceEndpoint(
  req: any,
  res: any,
  root?: string,
  preferredEditor?: string
): boolean {
  try {
    const urlObj = new URL(req.url, 'http://localhost')
    const file = urlObj.searchParams.get('file')
    const line = Number(urlObj.searchParams.get('line')) || 1
    const column = Number(urlObj.searchParams.get('column')) || 1
    const editor = urlObj.searchParams.get('editor') || preferredEditor

    if (!file) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Missing file parameter' }))
      return true
    }

    const result = openInEditor(file, line, column, root, editor)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify(result))
    return true
  } catch (e: any) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e.message }))
    return true
  }
}

function flattenPlugins(plugins: PluginOption[] | undefined): Plugin[] {
  const out: Plugin[] = []
  const stack: PluginOption[] = [...(plugins ?? [])]
  while (stack.length) {
    const item = stack.shift()
    if (!item || typeof item === 'boolean') continue
    if (Array.isArray(item)) {
      stack.unshift(...item)
      continue
    }
    if (item instanceof Promise) continue
    out.push(item)
  }
  return out
}

export default function reactiveTrace(options: ReactiveTracePluginOptions = {}): Plugin {
  let root = ''
  let isServe = false
  let userOrderViolated = false

  return {
    name: 'vue-reactive-trace',
    enforce: 'pre',
    config(userConfig) {
      const list = flattenPlugins(userConfig.plugins as PluginOption[] | undefined)
      const vuePluginIdx = list.findIndex((p) => p.name === 'vite:vue')
      const selfIdx = list.findIndex((p) => p.name === 'vue-reactive-trace')
      if (vuePluginIdx !== -1 && selfIdx > vuePluginIdx) {
        userOrderViolated = true
      }
    },
    configResolved(config) {
      root = config.root
      isServe = config.command === 'serve'

      // §36：本插件必須在 @vitejs/plugin-vue 之前執行，才能看到未經 Vue 編譯的
      // script 區塊（含正確的 <script setup> 語意判定）
      const vuePluginIdx = config.plugins.findIndex((p) => p.name === 'vite:vue')
      const selfIdx = config.plugins.findIndex((p) => p.name === 'vue-reactive-trace')
      if (userOrderViolated || (vuePluginIdx !== -1 && selfIdx > vuePluginIdx)) {
        config.logger.warn(
          '[vue-reactive-trace] plugin ordering violated: expected to run before ' +
            '"vite:vue" (§36). Scope classification may be incorrect.'
        )
      }

      // source map 必須開啟，否則 §35 的位置映射無效
      if (config.build.sourcemap === false && isServe === false) {
        config.logger.warn(
          '[vue-reactive-trace] build.sourcemap is disabled; §35 source map chain cannot be verified'
        )
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/__reactive-trace/open-source')) {
          handleOpenSourceEndpoint(req, res, root, options.editor)
          return
        }
        next()
      })
    },
    transform(code, id) {
      // Production build: ZERO instrumentation unless explicitly enabled
      const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST
      if (!isServe && !isTest && options.enabled !== true) {
        return null
      }

      return transformCode(code, id, {
        root,
        redact: options.redact,
        events: options.events,
        maxMemoryMB: options.maxMemoryMB
      })
    }
  }
}

export { transformCode, shouldTransform, buildConfigureCall } from './transform.ts'
