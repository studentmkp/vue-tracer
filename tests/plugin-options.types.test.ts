import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * §44 — the Vite plugin may only advertise options the transform honours.
 *
 * `tests/plugin-options.types.ts` holds `@ts-expect-error` assertions for every
 * option that was removed from `ReactiveTracePluginOptions`. Types do not exist
 * at runtime, so the only way to verify the public surface is to typecheck it:
 * this test runs `tsc` over the fixture and fails on any diagnostic reported
 * against that file.
 *
 * Diagnostics in other files are ignored on purpose — the repo has a
 * pre-existing `tsc --noEmit` baseline that fails on unrelated source files.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = 'tests/plugin-options.types.ts'

/** Options removed because the transform still does not honour them (issue #6). */
const REMOVED_OPTIONS = [
  'include',
  'exclude',
  'async',
  'computed',
  'watch',
  'pinia',
  'maxMemoryMB'
] as const

const require = createRequire(import.meta.url)
const tscBin = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')

function typecheckFixture(): string {
  const result = spawnSync(
    process.execPath,
    [
      tscBin,
      '--noEmit',
      '--ignoreConfig',
      '--strict',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--target',
      'esnext',
      '--allowImportingTsExtensions',
      '--skipLibCheck',
      FIXTURE
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  )

  if (result.error) throw result.error
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('§44 — Vite plugin option surface', () => {
  it('rejects every option the transform does not honour', { timeout: 60_000 }, () => {
    const fixturePath = join(repoRoot, FIXTURE)
    expect(existsSync(fixturePath), `${FIXTURE} is the assertion fixture for this test`).toBe(true)

    const source = readFileSync(fixturePath, 'utf8')
    for (const option of REMOVED_OPTIONS) {
      expect(source, `fixture must assert that "${option}" is rejected`).toContain(
        `@ts-expect-error ${option}:`
      )
    }
    expect(source).toContain('@ts-expect-error events: only recorded top-level event types')

    const output = typecheckFixture()
    const fixtureDiagnostics = output
      .split('\n')
      .filter((line) => line.startsWith(`${FIXTURE}(`))

    expect(fixtureDiagnostics, output.trim()).toEqual([])
  })
})
