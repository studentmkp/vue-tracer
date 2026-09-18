import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parse } from '@babel/parser'
import traverseDefault from '@babel/traverse'
import { parse as parseSFC } from '@vue/compiler-sfc'
import MagicString from 'magic-string'

// Handle CJS/ESM interop for @babel/traverse
const traverse = (traverseDefault as any).default || traverseDefault

import type { RedactContext, TraceEventType } from '@vue-reactive-trace/runtime'

export interface TransformOptions {
  root?: string
  redact?: (string | ((value: unknown, ctx: RedactContext) => unknown))[]
  events?: TraceEventType[]
  maxMemoryMB?: number
}

const SOURCE_EXT_RE = /\.(vue|ts|js|tsx|jsx|mts|mjs)$/
const selfPkgRoot = normalizeSlashes(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function normalizePath(path: string, root?: string): string {
  let relative = path
  if (root && path.startsWith(root)) {
    relative = path.slice(root.length)
    if (relative.startsWith('/')) {
      relative = relative.slice(1)
    }
  }
  return relative
}

function isInsideRoot(filepath: string, root: string): boolean {
  const file = normalizeSlashes(filepath)
  const base = normalizeSlashes(root).replace(/\/$/, '')
  return file === base || file.startsWith(base + '/')
}

function isVueScriptQuery(query: string): boolean {
  return /(^|&)type=script(&|$)/.test(query) || query.startsWith('vue&type=script')
}

export function shouldTransform(id: string, root?: string): boolean {
  const qIndex = id.indexOf('?')
  const filepath = normalizeSlashes(qIndex === -1 ? id : id.slice(0, qIndex))
  const query = qIndex === -1 ? '' : id.slice(qIndex + 1)

  if (!SOURCE_EXT_RE.test(filepath)) return false

  const lowered = filepath.toLowerCase()
  if (lowered.includes('/node_modules/') || lowered.endsWith('/node_modules')) return false

  if (/(^|&)raw(?:&|=|$)/.test(query)) return false

  if (root && !isInsideRoot(filepath, root)) return false

  if (isInsideRoot(filepath, selfPkgRoot)) return false
  if (filepath.includes('/packages/') && filepath.includes('/src/')) return false

  if (filepath.endsWith('.vue') && query && !isVueScriptQuery(query)) return false

  return true
}

export function transformCode(
  code: string,
  id: string,
  options: TransformOptions = {}
): { code: string; map: any } | null {
  if (!shouldTransform(id, options.root)) {
    return null
  }

  const relativeFile = normalizePath(id.split('?')[0], options.root)

  if (id.endsWith('.vue') && !id.includes('?')) {
    return transformVueSFC(code, id, relativeFile, options)
  }

  if (
    SOURCE_EXT_RE.test(id.split('?')[0]) ||
    id.includes('type=script')
  ) {
    const query = id.includes('?') ? id.slice(id.indexOf('?') + 1) : ''
    const blockKind = /(?:^|&)setup(?:&|=|$)/.test(query) ? 'setup' : 'normal'
    return transformScript(code, id, relativeFile, 0, 0, blockKind, options)
  }

  return null
}

const RUNTIME_HELPER_NAMES = [
  '__trace_configure',
  '__trace_register',
  '__trace_register_computed',
  '__trace_set',
  '__trace_update',
  '__trace_call',
  '__trace_delete',
  '__trace_watch_cb'
] as const
const [CONFIGURE_HELPER, ...RUNTIME_HELPER_IMPORTS] = RUNTIME_HELPER_NAMES

function serializeRedactMatcher(
  matcher: string | ((value: unknown, ctx: RedactContext) => unknown)
): string {
  return typeof matcher === 'function' ? matcher.toString() : JSON.stringify(matcher)
}

export function buildConfigureCall(options: TransformOptions): string {
  const fields: string[] = []
  if (options.redact !== undefined) {
    const items = options.redact.map(serializeRedactMatcher)
    fields.push(`redact: [${items.join(', ')}]`)
  }
  if (options.events !== undefined) fields.push(`events: ${JSON.stringify(options.events)}`)
  if (options.maxMemoryMB !== undefined) {
    fields.push(`maxMemoryMB: ${JSON.stringify(options.maxMemoryMB)}`)
  }

  return fields.length > 0 ? `${CONFIGURE_HELPER}({ ${fields.join(', ')} });\n` : ''
}

function runtimePreamble(options: TransformOptions): string {
  const imports: string[] = [...RUNTIME_HELPER_IMPORTS]
  if (
    options.redact !== undefined ||
    options.events !== undefined ||
    options.maxMemoryMB !== undefined
  ) {
    imports.push(CONFIGURE_HELPER)
  }
  return `import { ${imports.join(', ')} } from '@vue-reactive-trace/runtime';\n${buildConfigureCall(options)}`
}

const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
  'set', 'add', 'delete', 'clear'
])

function extractMemberChain(node: any): { rootName?: string; path: string[] } {
  const path: string[] = []
  let curr = node
  while (curr && curr.type === 'MemberExpression') {
    if (!curr.computed && curr.property && curr.property.type === 'Identifier') {
      path.unshift(curr.property.name)
    } else if (curr.computed && curr.property && curr.property.type === 'StringLiteral') {
      path.unshift(curr.property.value)
    } else if (curr.computed && curr.property && curr.property.type === 'NumericLiteral') {
      path.unshift(String(curr.property.value))
    }
    curr = curr.object
  }
  let rootName: string | undefined
  if (curr && curr.type === 'Identifier') {
    rootName = curr.name
  }
  return { rootName, path }
}

function isPurePropertyKey(node: any): boolean {
  if (!node) return false
  return (
    node.type === 'Identifier' ||
    node.type === 'StringLiteral' ||
    node.type === 'NumericLiteral' ||
    node.type === 'BigIntLiteral'
  )
}

function isPureMemberBase(node: any): boolean {
  let curr = node
  while (curr && curr.type === 'MemberExpression') {
    if (curr.computed && !isPurePropertyKey(curr.property)) {
      return false
    }
    curr = curr.object
  }
  return curr?.type === 'Identifier' || curr?.type === 'ThisExpression'
}

function warnUnsafeAssignment(snippet: string) {
  const isProd = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  const isTest = typeof process !== 'undefined' && (process.env.VITEST || process.env.NODE_ENV === 'test')
  if (!isProd && !isTest) {
    console.warn(
      `[vue-reactive-trace] skip thunk instrumentation for assignment with a side-effectful object: ${snippet}`
    )
  }
}

function transformVueSFC(
  code: string,
  id: string,
  relativeFile: string,
  options: TransformOptions = {}
): { code: string; map: any } | null {
  const { descriptor } = parseSFC(code, { filename: id })
  const s = new MagicString(code)
  let transformed = false

  const scripts = [descriptor.script, descriptor.scriptSetup].filter(Boolean)

  for (const script of scripts) {
    if (!script || !script.content.trim()) continue

    const offset = script.loc.start.offset
    const lineOffset = script.loc.start.line - 1

    const isSetupBlock = script === descriptor.scriptSetup
    const didTransform = applyASTTransform(
      s,
      script.content,
      offset,
      lineOffset,
      relativeFile,
      isSetupBlock ? 'setup' : 'normal'
    )

    if (didTransform) {
      transformed = true
      s.prependLeft(
        offset,
        `\n${runtimePreamble(options)}`
      )
    }
  }

  if (!transformed) return null

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: id, includeContent: true })
  }
}

function transformScript(
  code: string,
  id: string,
  relativeFile: string,
  offset: number = 0,
  lineOffset: number = 0,
  blockKind: 'setup' | 'normal' = 'normal',
  options: TransformOptions = {}
): { code: string; map: any } | null {
  const s = new MagicString(code)
  const didTransform = applyASTTransform(s, code, offset, lineOffset, relativeFile, blockKind)

  if (!didTransform) return null

  s.prepend(runtimePreamble(options))

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: id, includeContent: true })
  }
}

function applyASTTransform(
  s: MagicString,
  scriptContent: string,
  charOffset: number,
  lineOffset: number,
  relativeFile: string,
  blockKind: 'setup' | 'normal' = 'normal'
): boolean {
  let ast: any
  try {
    ast = parse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    })
  } catch (e) {
    return false
  }

function detectComposableName(path: any, relativeFile: string): string | undefined {
  const funcParent = path.getFunctionParent ? path.getFunctionParent() : null
  if (funcParent) {
    if (funcParent.node.id?.name) {
      const name = funcParent.node.id.name
      if (name.startsWith('use')) return name
    }
    if (funcParent.parentPath && funcParent.parentPath.isVariableDeclarator()) {
      const varId = funcParent.parentPath.node.id
      if (varId && varId.type === 'Identifier' && varId.name.startsWith('use')) {
        return varId.name
      }
    }
  }

  const filename = relativeFile.split('/').pop()?.replace(/\.(ts|js|vue|tsx|jsx)$/, '') || ''
  if (filename.startsWith('use')) {
    return filename
  }
  if (relativeFile.includes('/composables/') && funcParent?.node?.id?.name) {
    return funcParent.node.id.name
  }

  return undefined
}

  let hasTransform = false

  traverse(ast, {
    VariableDeclarator(path: any) {
      const init = path.node.init
      if (!init || init.type !== 'CallExpression') return

      const callee = init.callee
      let reactiveType = ''

      if (callee.type === 'Identifier') {
        if (callee.name === 'ref' || callee.name === 'shallowRef') {
          reactiveType = 'ref'
        } else if (callee.name === 'reactive' || callee.name === 'shallowReactive') {
          reactiveType = 'reactive'
        } else if (callee.name === 'computed') {
          reactiveType = 'computed'
        }
      }

      if (reactiveType) {
        hasTransform = true
        const varName = path.node.id.type === 'Identifier' ? path.node.id.name : 'anonymous'
        const isModuleScope = path.scope.block.type === 'Program'
        const composableName = detectComposableName(path, relativeFile)
        let scope: 'module' | 'local' | 'composable'
        if (blockKind === 'setup') {
          // <script setup> top-level decls are component-local, never module singletons
          scope = composableName ? 'composable' : 'local'
        } else {
          scope = isModuleScope ? 'module' : composableName ? 'composable' : 'local'
        }
        const line = lineOffset + init.loc.start.line
        const column = init.loc.start.column

        const start = charOffset + init.start
        const end = charOffset + init.end
        const originalCall = scriptContent.slice(init.start, init.end)
        const composableProp = composableName ? `composable: '${composableName}', ` : ''

        if (reactiveType === 'computed') {
          s.overwrite(
            start,
            end,
            `__trace_register_computed(${originalCall}, { name: '${varName}', type: 'computed', scope: '${scope}', ${composableProp}source: { file: '${relativeFile}', line: ${line}, column: ${column} } })`
          )
        } else {
          s.overwrite(
            start,
            end,
            `__trace_register(${originalCall}, { name: '${varName}', type: '${reactiveType}', scope: '${scope}', ${composableProp}source: { file: '${relativeFile}', line: ${line}, column: ${column} } })`
          )
        }
      }
    },

    UpdateExpression(path: any) {
      if (path.node.argument.type !== 'MemberExpression') return

      const mem = path.node.argument
      const chain = extractMemberChain(mem)
      const isPrefix = path.node.prefix
      const op = path.node.operator // '++' or '--'
      const line = lineOffset + path.node.loc.start.line
      const column = path.node.loc.start.column

      const locStr = `{ file: '${relativeFile}', line: ${line}, column: ${column} }`
      const optsStr = `{ rootName: '${chain.rootName || ''}', path: ${JSON.stringify(chain.path)} }`
      const objCode = scriptContent.slice(mem.object.start, mem.object.end)
      const propCode = mem.computed
        ? scriptContent.slice(mem.property.start, mem.property.end)
        : `'${mem.property.name}'`

      hasTransform = true

      const nodeStart = charOffset + path.node.start
      const nodeEnd = charOffset + path.node.end

      s.overwrite(
        nodeStart,
        nodeEnd,
        `__trace_update(${objCode}, ${propCode}, '${op}', ${isPrefix}, ${locStr}, ${optsStr})`
      )
    },

    AssignmentExpression(path: any) {
      if (path.node.left.type !== 'MemberExpression') return

      const mem = path.node.left
      const chain = extractMemberChain(mem)
      const op = path.node.operator
      const line = lineOffset + path.node.loc.start.line
      const column = path.node.loc.start.column
      const locStr = `{ file: '${relativeFile}', line: ${line}, column: ${column} }`
      const optsStr = `{ rootName: '${chain.rootName || ''}', path: ${JSON.stringify(chain.path)} }`

      const objCode = scriptContent.slice(mem.object.start, mem.object.end)
      const propCode = mem.computed
        ? scriptContent.slice(mem.property.start, mem.property.end)
        : `'${mem.property.name}'`
      const valCode = scriptContent.slice(path.node.right.start, path.node.right.end)
      const leftCode = scriptContent.slice(path.node.left.start, path.node.left.end)
      const original = `${leftCode} ${op} ${valCode}`

      const nodeStart = charOffset + path.node.start
      const nodeEnd = charOffset + path.node.end
      const canThunk = isPureMemberBase(mem.object)

      if (!canThunk) {
        if (op === '=') {
          hasTransform = true
          s.overwrite(
            nodeStart,
            nodeEnd,
            `__trace_set(${objCode}, ${propCode}, ${valCode}, ${locStr}, ${optsStr})`
          )
        } else {
          warnUnsafeAssignment(original)
        }
        return
      }

      hasTransform = true
      s.overwrite(
        nodeStart,
        nodeEnd,
        `__trace_set(${objCode}, ${propCode}, () => (${original}), ${locStr}, ${optsStr})`
      )
    },

    UnaryExpression(path: any) {
      if (path.node.operator === 'delete' && path.node.argument.type === 'MemberExpression') {
        const mem = path.node.argument
        const chain = extractMemberChain(mem)
        const line = lineOffset + path.node.loc.start.line
        const column = path.node.loc.start.column
        const locStr = `{ file: '${relativeFile}', line: ${line}, column: ${column} }`
        const optsStr = `{ rootName: '${chain.rootName || ''}', path: ${JSON.stringify(chain.path)} }`

        const objCode = scriptContent.slice(mem.object.start, mem.object.end)
        const propCode = mem.computed
          ? scriptContent.slice(mem.property.start, mem.property.end)
          : `'${mem.property.name}'`

        hasTransform = true
        s.overwrite(
          charOffset + path.node.start,
          charOffset + path.node.end,
          `__trace_delete(${objCode}, ${propCode}, ${locStr}, ${optsStr})`
        )
      }
    },

    CallExpression(path: any) {
      const callee = path.node.callee

      // 1. Handle watch and watchEffect
      if (callee.type === 'Identifier') {
        if (callee.name === 'watch') {
          if (path.node.arguments.length >= 2) {
            const cbArg = path.node.arguments[1]
            if (
              cbArg.type === 'ArrowFunctionExpression' ||
              cbArg.type === 'FunctionExpression' ||
              cbArg.type === 'Identifier'
            ) {
              const line = lineOffset + cbArg.loc.start.line
              const column = cbArg.loc.start.column
              const cbName = cbArg.type === 'Identifier' ? cbArg.name : 'watchCallback'
              hasTransform = true
              s.prependLeft(charOffset + cbArg.start, '__trace_watch_cb(')
              s.appendRight(
                charOffset + cbArg.end,
                `, { name: '${cbName}', source: { file: '${relativeFile}', line: ${line}, column: ${column} } })`
              )
            }
          }
          return
        } else if (
          callee.name === 'watchEffect' ||
          callee.name === 'watchSyncEffect' ||
          callee.name === 'watchPostEffect'
        ) {
          if (path.node.arguments.length >= 1) {
            const cbArg = path.node.arguments[0]
            if (
              cbArg.type === 'ArrowFunctionExpression' ||
              cbArg.type === 'FunctionExpression' ||
              cbArg.type === 'Identifier'
            ) {
              const line = lineOffset + cbArg.loc.start.line
              const column = cbArg.loc.start.column
              const cbName = cbArg.type === 'Identifier' ? cbArg.name : callee.name
              hasTransform = true
              s.prependLeft(charOffset + cbArg.start, '__trace_watch_cb(')
              s.appendRight(
                charOffset + cbArg.end,
                `, { name: '${cbName}', source: { file: '${relativeFile}', line: ${line}, column: ${column} } })`
              )
            }
          }
          return
        }
      }

      if (callee.type !== 'MemberExpression') return

      // Avoid re-instrumenting trace helpers
      if (callee.object.type === 'Identifier' && callee.object.name.startsWith('__trace_')) return

      const method = !callee.computed && callee.property && callee.property.type === 'Identifier'
        ? callee.property.name
        : undefined

      if (!method || !MUTATING_METHODS.has(method)) return

      const chain = extractMemberChain(callee.object)
      const line = lineOffset + path.node.loc.start.line
      const column = path.node.loc.start.column
      const locStr = `{ file: '${relativeFile}', line: ${line}, column: ${column} }`
      const optsStr = `{ rootName: '${chain.rootName || ''}', path: ${JSON.stringify(chain.path)} }`

      const objCode = scriptContent.slice(callee.object.start, callee.object.end)
      let argsCode = ''
      if (path.node.arguments.length > 0) {
        const firstArg = path.node.arguments[0]
        const lastArg = path.node.arguments[path.node.arguments.length - 1]
        argsCode = scriptContent.slice(firstArg.start, lastArg.end)
      }

      hasTransform = true

      const nodeStart = charOffset + path.node.start
      const nodeEnd = charOffset + path.node.end

      s.overwrite(
        nodeStart,
        nodeEnd,
        `__trace_call(${objCode}, '${method}', [${argsCode}], ${locStr}, ${optsStr})`
      )
    }
  })

  return hasTransform
}
