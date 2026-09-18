import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createLogger, createServer, build, type Plugin, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import reactiveTrace from '../packages/vite-plugin/src/index.ts'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/plugin-ordering')

async function withServer(plugins: Plugin[], fn: (server: ViteDevServer) => Promise<void>) {
  const server = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, port: 0, strictPort: false },
    plugins
  })
  try {
    await fn(server)
  } finally {
    await Promise.race([server.close(), new Promise((r) => setTimeout(r, 2000))])
  }
}

async function assertExactLocations(
  server: ViteDevServer,
  url: string,
  expected: Record<string, number>
) {
  const res = await server.transformRequest(url)
  expect(res?.code, `no transform result for ${url}`).toBeTruthy()
  for (const [name, line] of Object.entries(expected)) {
    const re = new RegExp(`name:\\s*['"]${name}['"][\\s\\S]*?line:\\s*(\\d+)`)
    const m = res!.code.match(re)
    expect(m, `${name} not instrumented in ${url}`).not.toBeNull()
    expect(Number(m![1])).toBe(line)
  }
  return res!.code
}

function collectFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectFiles(full))
    else out.push(full)
  }
  return out
}

describe('§36 plugin ordering and §35 source map chain', () => {
  it(
    '<script setup> SFC: bare module line numbers match original source; script submodule is not requested',
    async () => {
      const seen: string[] = []
      await withServer(
        [
          {
            name: 'id-probe',
            enforce: 'pre',
            transform(_code, id) {
              if (id.includes('SetupSFC.vue')) seen.push(id)
              return null
            }
          },
          reactiveTrace(),
          vue()
        ],
        async (server) => {
          await assertExactLocations(server, '/SetupSFC.vue', { marker: 6 })
          expect(seen.some((id) => id.includes('type=script'))).toBe(false)
          expect(seen.some((id) => /SetupSFC\.vue$/.test(id.split('?')[0]) && !id.includes('?'))).toBe(
            true
          )
        }
      )
    },
    30_000
  )

  it(
    'plain <script> SFC: type=script submodule line numbers match original source (HMR path)',
    async () => {
      await withServer([reactiveTrace(), vue()], async (server) => {
        await assertExactLocations(server, '/PlainScript.vue', { marker: 6 })
        await assertExactLocations(
          server,
          '/PlainScript.vue?vue&type=script&lang.js',
          { marker: 6 }
        )
      })
    },
    30_000
  )

  it(
    '.ts module line numbers match original source without Vue',
    async () => {
      await withServer([reactiveTrace()], async (server) => {
        await assertExactLocations(server, '/marker.ts', { marker: 6 })
      })
    },
    30_000
  )

  it(
    'reversed [vue(), reactiveTrace()] still maps original lines via enforce:pre, and warns on user order',
    async () => {
      const warnings: string[] = []
      const logger = createLogger('silent')
      const origWarn = logger.warn.bind(logger)
      logger.warn = (msg, opts) => {
        warnings.push(String(msg))
        origWarn(msg, opts)
      }

      const server = await createServer({
        root: fixtureRoot,
        configFile: false,
        customLogger: logger,
        server: { middlewareMode: true, port: 0, strictPort: false },
        plugins: [vue(), reactiveTrace()]
      })

      try {
        await assertExactLocations(server, '/SetupSFC.vue', { marker: 6 })
        expect(
          warnings.some((w) => w.includes('plugin ordering violated') && w.includes('vite:vue'))
        ).toBe(true)
      } finally {
        await Promise.race([server.close(), new Promise((r) => setTimeout(r, 2000))])
      }
    },
    30_000
  )

  it(
    'playground-style production build stays uninstrumented when enabled is not set',
    async () => {
      const prevVitest = process.env.VITEST
      const prevNode = process.env.NODE_ENV
      delete process.env.VITEST
      process.env.NODE_ENV = 'production'
      const outDir = mkdtempSync(join(tmpdir(), 'vrt-prod-'))

      try {
        await build({
          root: fixtureRoot,
          configFile: false,
          logLevel: 'silent',
          plugins: [reactiveTrace(), vue()],
          build: {
            write: true,
            outDir,
            emptyOutDir: true,
            sourcemap: false
          }
        })

        const files = collectFiles(outDir)
        const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8'))
        expect(js.length).toBeGreaterThan(0)
        for (const code of js) {
          expect(code).not.toContain('__trace_register')
          expect(code).not.toContain('__trace_set')
          expect(code).not.toContain('__trace_update')
        }
      } finally {
        if (prevVitest === undefined) delete process.env.VITEST
        else process.env.VITEST = prevVitest
        if (prevNode === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = prevNode
        rmSync(outDir, { recursive: true, force: true })
      }
    },
    60_000
  )

  it(
    'wires open-source endpoint through configureServer middleware',
    async () => {
      await withServer([reactiveTrace({ editor: 'cursor' })], async (server) => {
        let statusCode = 0
        let responseBody = ''
        const req: any = {
          method: 'GET',
          url: '/__reactive-trace/open-source?file=src/marker.ts&line=6&column=1',
          headers: { host: 'localhost' }
        }
        const res: any = {
          statusCode: 0,
          setHeader: () => {},
          end: (body: string) => {
            statusCode = res.statusCode
            responseBody = body
          }
        }

        const traceMiddleware = server.middlewares.stack.find((s) =>
          s.handle.toString().includes('__reactive-trace')
        )
        expect(traceMiddleware).toBeDefined()

        let nextCalled = false
        ;(traceMiddleware!.handle as any)(req, res, () => {
          nextCalled = true
        })

        expect(nextCalled).toBe(false)
        expect(statusCode).toBe(200)
        const parsed = JSON.parse(responseBody)
        expect(parsed.success).toBe(true)
        expect(parsed.targetPath).toBe(resolve(fixtureRoot, 'src/marker.ts'))
        expect(parsed.command).toContain('cursor -g')
      })
    },
    30_000
  )
})
