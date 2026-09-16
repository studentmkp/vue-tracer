import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { reactive, ref } from 'vue'
import {
  traceCollector,
  __trace_register,
  __trace_set,
  __trace_update,
  __trace_call,
  __trace_configure,
  resetRedact,
  isDefaultSensitive,
  safeClone,
  REDACTED,
  type MutationEvent
} from '@vue-reactive-trace/runtime'
import { transformCode, buildConfigureCall } from '@vue-reactive-trace/vite'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const loc = { file: 'auth.ts', line: 1, column: 0 }

describe('§45 — default redaction', () => {
  beforeEach(() => {
    resetRedact()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    resetRedact()
  })

  it('redacts the five default keywords', () => {
    for (const key of ['password', 'token', 'secret', 'authorization', 'cookie']) {
      expect(isDefaultSensitive(key)).toBe(true)
    }
  })

  it('redacts common variants', () => {
    for (const key of [
      'accessToken',
      'refresh_token',
      'userPassword',
      'Authorization',
      'Cookie',
      'apiSecret'
    ]) {
      expect(isDefaultSensitive(key)).toBe(true)
    }
  })

  it('does not redact innocuous keys', () => {
    for (const key of ['count', 'name', 'items', 'total', 'userId']) {
      expect(isDefaultSensitive(key)).toBe(false)
    }
  })

  it('redacts nested and array values at record time', () => {
    const s = reactive({ auth: { token: '', name: '' } })
    __trace_register(s, { name: 'auth', type: 'reactive' })
    __trace_set(
      s,
      'auth',
      () => (s.auth = { token: 'jwt_xyz987', name: 'Sarah' }),
      loc,
      { rootName: 's', path: ['auth'] }
    )
    const stored = traceCollector.getTraces().at(-1)!.events.at(-1) as MutationEvent
    expect(JSON.stringify(stored.after)).not.toContain('jwt_xyz987')
    expect((stored.after as any).token).toBe(REDACTED)
    expect((stored.after as any).name).toBe('Sarah')
  })

  it('redacts nested password paths and array items', () => {
    expect(safeClone({ profile: { password: 'x' } })).toEqual({
      profile: { password: REDACTED }
    })
    expect(safeClone([{ token: 'a' }])).toEqual([{ token: REDACTED }])
  })

  it('redacts Map and Set nested secrets', () => {
    const mapClone = safeClone(new Map([['token', 'jwt_xyz987'], ['name', 'Sarah']])) as any
    expect(mapClone.$type).toBe('Map')
    expect(JSON.stringify(mapClone)).not.toContain('jwt_xyz987')
    expect(mapClone.entries).toEqual([
      ['token', REDACTED],
      ['name', 'Sarah']
    ])

    const setClone = safeClone(new Set([{ token: 'a', name: 'n' }])) as any
    expect(setClone.$type).toBe('Set')
    expect(setClone.values[0].token).toBe(REDACTED)
    expect(setClone.values[0].name).toBe('n')
  })

  it('does not leak via export', () => {
    const authUser = ref<any>(null)
    __trace_register(authUser, { name: 'authUser', type: 'ref' })
    __trace_set(
      authUser,
      'value',
      () => (authUser.value = { name: 'Dr. Sarah Connor', token: 'jwt_xyz987' }),
      loc,
      { rootName: 'authUser', path: ['value'] }
    )
    expect(traceCollector.exportTracesAsJSON()).not.toContain('jwt_xyz987')
    expect(traceCollector.exportTracesAsJSON()).toContain(REDACTED)
  })

  it('does not break mutation arithmetic', () => {
    const s: any = reactive({ n: 5 })
    __trace_register(s, { name: 's', type: 'reactive' })
    const ret = __trace_update(s, 'n', '++', false, loc, {})
    expect(s.n).toBe(6)
    expect(ret).toBe(5)
  })

  it('redacts stored ++/-- values without changing the live target', () => {
    const s: any = reactive({ token: 5 })
    __trace_register(s, { name: 's', type: 'reactive' })
    const ret = __trace_update(s, 'token', '++', false, loc, { path: ['token'] })
    expect(s.token).toBe(6)
    expect(ret).toBe(5)
    const stored = traceCollector.getTraces().at(-1)!.events.at(-1) as MutationEvent
    expect(stored.before).toBe(REDACTED)
    expect(stored.after).toBe(REDACTED)
  })

  it('handles circular references', () => {
    const a: any = { token: 'x', name: 'ok' }
    a.self = a
    expect(() => safeClone(a, [])).not.toThrow()
    const cloned = safeClone(a, []) as any
    expect(cloned.token).toBe(REDACTED)
    expect(cloned.name).toBe('ok')
    expect(cloned.self).toBe('[Circular]')
  })

  it('does not redact innocuous objects', () => {
    expect(safeClone({ count: 1, name: 'Alice' })).toEqual({ count: 1, name: 'Alice' })
  })

  it('shows [REDACTED] in DevTools UI instead of the raw token', () => {
    const authUser = ref<any>(null)
    __trace_register(authUser, { name: 'authUser', type: 'ref' })
    __trace_set(
      authUser,
      'value',
      () => (authUser.value = { name: 'Dr. Sarah Connor', token: 'jwt_xyz987' }),
      loc,
      { rootName: 'authUser', path: ['value'] }
    )

    initDevTools()
    const devtools = document.getElementById('__vue_reactive_trace_devtools__')!
    const toggle = devtools.querySelector('#vrt-toggle') as HTMLElement
    toggle?.click()
    const bar = devtools.querySelector('.vrt-event-bar') as HTMLElement
    bar?.click()

    expect(devtools.innerHTML).toContain(REDACTED)
    expect(devtools.innerHTML).not.toContain('jwt_xyz987')
    expect(traceCollector.exportTracesAsJSON()).not.toContain('jwt_xyz987')
  })
})

describe('§44 — configurable redaction', () => {
  beforeEach(() => {
    resetRedact()
    traceCollector.clearTraces()
    traceCollector.setEnabled(true)
  })

  afterEach(() => {
    resetRedact()
  })

  it('applies custom string matchers during recording and export', () => {
    __trace_configure({ redact: ['**.password', '**.token', '**.ssn'] })
    const person = reactive({ profile: { ssn: '111-22-3333', name: 'Ada' } })
    __trace_register(person, { name: 'person', type: 'reactive' })

    __trace_set(
      person,
      'profile',
      () => (person.profile = { ssn: '999-88-7777', name: 'Grace' }),
      loc,
      { rootName: 'person', path: ['profile'] }
    )

    const stored = traceCollector.getTraces().at(-1)!.events.at(-1) as MutationEvent
    expect(stored.before).toEqual({ ssn: REDACTED, name: 'Ada' })
    expect(stored.after).toEqual({ ssn: REDACTED, name: 'Grace' })

    const exported = traceCollector.exportTracesAsJSON()
    expect(exported).not.toContain('111-22-3333')
    expect(exported).not.toContain('999-88-7777')
    expect(exported).toContain(REDACTED)
  })

  it('applies a custom redact function', () => {
    __trace_configure({
      redact: [(v, ctx) => (ctx.key === 'ssn' ? '***' : undefined)]
    })
    expect(safeClone({ ssn: '111-22-3333', token: 'jwt' })).toEqual({
      ssn: '***',
      token: REDACTED
    })
  })

  it('injects redaction configuration from plugin transform options', () => {
    const source = `const count = ref(0)\n`
    const result = transformCode(source, '/src/App.ts', {
      root: '/src',
      redact: ['**.password', '**.token']
    })
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__trace_configure')
    expect(result!.code).toContain('**.password')
    expect(result!.code).toContain('**.token')
  })

  it('does not inject configuration when no custom redaction is configured', () => {
    const result = transformCode(`const count = ref(0)\n`, '/src/App.ts', { root: '/src' })
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__trace_register')
    expect(result!.code).not.toContain('__trace_configure')
  })

  it('serializes function matchers into the injected configure call', () => {
    const fn = (v: unknown, ctx: { key: string }) => (ctx.key === 'ssn' ? '***' : undefined)
    const call = buildConfigureCall({
      redact: [fn as any]
    })
    expect(call).toContain('__trace_configure')
    expect(call).toContain('ssn')
  })
})
