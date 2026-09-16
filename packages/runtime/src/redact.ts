export type RedactMatcher = string | ((value: unknown, context: RedactContext) => unknown)

export interface RedactContext {
  /** 屬性完整路徑，例如 ['authUser', 'token'] */
  path: string[]
  /** 觸發遮蔽的屬性名 */
  key: string
  /** 所屬 reactive 的根名稱（若已知） */
  rootName?: string
}

/** §45 明列的 default 關鍵字 */
const DEFAULT_SENSITIVE = ['password', 'token', 'secret', 'authorization', 'cookie']

/** 比對用的正規化：去除分隔符與大小寫，讓 accessToken / access_token / ACCESS-TOKEN 皆命中 */
function normalize(key: string): string {
  return key.replace(/[_\-\s]/g, '').toLowerCase()
}

const DEFAULT_SET = new Set(DEFAULT_SENSITIVE.map(normalize))

/** 是否為預設敏感鍵。採「包含」比對，涵蓋 accessToken / refresh_token / userPassword 等變體。 */
export function isDefaultSensitive(key: string): boolean {
  const n = normalize(key)
  if (DEFAULT_SET.has(n)) return true
  for (const s of DEFAULT_SET) {
    if (n.includes(s)) return true
  }
  return false
}

export const REDACTED = '[REDACTED]'

export interface RedactConfig {
  /** 額外/覆寫的規則。字串支援 '**.password' 形式（** = 任意深度） */
  matchers?: RedactMatcher[]
  /** 完全停用遮蔽（不建議） */
  disabled?: boolean
}

export interface RuntimeTraceConfig {
  redact?: RedactMatcher[]
  maxMemoryMB?: number
  events?: string[]
}

let config: RedactConfig = {}
let runtimeConfig: RuntimeTraceConfig = {}
let lastConfigureKey = ''

/** 由插件注入或使用者手動呼叫 */
export function configureRedact(next: RedactConfig): void {
  config = { ...config, ...next }
}

export function resetRedact(): void {
  config = {}
  runtimeConfig = {}
  lastConfigureKey = ''
}

export function getRuntimeTraceConfig(): RuntimeTraceConfig {
  return runtimeConfig
}

/** 將 '**.token' / 'password' / 'user.*.secret' 轉為比對函式 */
function compileMatcher(pattern: string): (ctx: RedactContext) => boolean {
  const parts = pattern.split('.').filter((p) => p !== '' && p !== '**' && p !== '*')
  const leaf = parts[parts.length - 1] ?? ''
  const normalizedLeaf = normalize(leaf)
  return (ctx) => normalize(ctx.key) === normalizedLeaf
}

function configureKey(next: RuntimeTraceConfig): string {
  return JSON.stringify({
    maxMemoryMB: next.maxMemoryMB,
    events: next.events,
    redact: next.redact?.map((m) => (typeof m === 'function' ? m.toString() : m))
  })
}

/**
 * Idempotent runtime 配置入口。由插件注入；重複呼叫同值無副作用。
 * maxMemoryMB / events 於此儲存，供 Plan 05 消費。
 */
export function __trace_configure(next: RuntimeTraceConfig): void {
  const key = configureKey(next)
  if (key === lastConfigureKey) return
  lastConfigureKey = key
  runtimeConfig = { ...runtimeConfig, ...next }
  if (next.redact !== undefined) {
    configureRedact({ matchers: next.redact })
  }
}

/**
 * 遮蔽單一值。回傳 REDACTED 或原始值。
 * 命中順序：自訂函式 → 自訂字串規則 → default 敏感鍵
 */
export function redactValue(value: unknown, ctx: RedactContext): unknown {
  if (config.disabled) return value

  for (const m of config.matchers ?? []) {
    if (typeof m === 'function') {
      const out = m(value, ctx)
      if (out !== undefined) return out
    }
  }

  for (const m of config.matchers ?? []) {
    if (typeof m === 'string' && compileMatcher(m)(ctx)) return REDACTED
  }

  if (isDefaultSensitive(ctx.key)) return REDACTED

  return value
}
