import { describe, it, expect } from 'vitest'
import { createServer } from 'vite'
import { resolve } from 'path'

const playgroundRoot = resolve(import.meta.dirname, '../playground')

function extractDeclMeta(code: string): { name: string; scope: string; composable?: string }[] {
  const decls: { name: string; scope: string; composable?: string }[] = []
  const re =
    /name:\s*['"]([^'"]+)['"],\s*type:\s*['"][^'"]+['"],\s*scope:\s*['"]([^'"]+)['"](?:,\s*composable:\s*['"]([^'"]+)['"])?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code))) {
    decls.push({ name: match[1], scope: match[2], composable: match[3] })
  }
  return decls
}

describe('§23 — Vite pipeline scope classification', () => {
  it(
    'classifies playground <script setup> decls as local via the real Vite transform pipeline',
    async () => {
      const server = await createServer({
        root: playgroundRoot,
        configFile: resolve(playgroundRoot, 'vite.config.ts'),
        server: { middlewareMode: true },
        clearScreen: false
      })

      try {
        const appMod = await server.transformRequest('/src/App.vue')
        expect(appMod?.code).toBeTruthy()
        const appDecls = extractDeclMeta(appMod!.code)

        const setupLocals = [
          'count',
          'user',
          'cart',
          'cartTotal',
          'authLoading',
          'authUser',
          'watchUserId',
          'watcherMessage',
          'reactiveMap',
          'reactiveSet',
          'batchItems',
          'inputText',
          'mousePos',
          'remainder'
        ]

        for (const name of setupLocals) {
          const decl = appDecls.find((d) => d.name === name)
          expect(decl, `missing decl ${name}`).toBeDefined()
          expect(decl!.scope, name).toBe('local')
        }

        const feature = appDecls.find((d) => d.name === 'featureCount')
        expect(feature).toBeDefined()
        expect(feature!.scope).toBe('composable')
        expect(feature!.composable).toBe('useFeatureCounter')

        const stateMod = await server.transformRequest('/src/state.ts')
        expect(stateMod?.code).toBeTruthy()
        const stateDecls = extractDeclMeta(stateMod!.code)
        const session = stateDecls.find((d) => d.name === 'sessionUser')
        expect(session).toBeDefined()
        expect(session!.scope).toBe('module')
      } finally {
        await Promise.race([
          server.close(),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ])
      }
    },
    30_000
  )
})
