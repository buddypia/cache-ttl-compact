import type { EngineInterface, Register, Timer } from 'claude-code'

// Shows the time left until the prompt cache, refreshed by the main conversation's last API request, expires.
// Near expiry it compacts while the cache is still warm, so the next request does not pay to re-cache the whole context.
// A plugin cannot read the TTL, so it comes from the `ttl` option; `auto` follows FORCE_PROMPT_CACHING_5M.
// Claude Code compacts large idle sessions on its own (idle compaction). Those are left to it, and this plugin
// compacts only what idle compaction does not cover: smaller contexts, the 5m TTL, and idle compaction turned off.

type Ttl = '1h' | '5m'

/** Timing per TTL; supporting another TTL is one more row */
const PROFILES: Record<Ttl, { ttlMs: number; marginMs: number }> = {
  '1h': { ttlMs: 3_600_000, marginMs: 180_000 },
  '5m': { ttlMs: 300_000, marginMs: 60_000 },
}

/**
 * What Claude Code's own idle compaction covers: a 1h cache, 200K+ tokens, from 2.1.299, unless
 * `"idleCompaction": false`; CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS moves the minimum.
 * Source: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (2.1.299)
 */
export const IDLE_COMPACTION = { since: '2.1.299', ttl: '1h' as Ttl, minTokens: 200_000 }

const DEFAULT_INSTRUCTIONS = 'Keep the task in progress, the files changed and what changed in each, design decisions with their reasons, and open items. Write the summary in the language of the conversation.'

type Config = { ttl: Ttl | 'auto'; marginMs?: number; minTokens: number; instructions: string }

/** Idle compaction as this session has it */
export type IdleCompaction = { version?: string; enabled: boolean; minTokens: number }

type State = {
  ttl?: Ttl
  /** When the main conversation last sent an API request (the cache's last refresh) */
  lastAt?: number
  /** The lastAt a compaction was tried for, so a skip or failure is not retried every second */
  triedAt?: number
  running: boolean
  ticker?: Timer
}

/** Formats the time left as m:ss */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Whether release `version` (`2.1.310`, `2.1.310-dev`) is `min` or later */
export function atLeast(version: string, min: string): boolean {
  const parse = (v: string) => (v.split('-')[0] ?? '').split('.').map(Number)
  const a = parse(version)
  const b = parse(min)
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** Whether Claude Code's idle compaction compacts this context before its cache expires */
export function idleCompactionCovers(ttl: Ttl, tokens: number, idle: IdleCompaction): boolean {
  return idle.enabled && idle.version !== undefined && atLeast(idle.version, IDLE_COMPACTION.since)
    && ttl === IDLE_COMPACTION.ttl && tokens >= idle.minTokens
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase())
}

async function resolveTtl($: EngineInterface, ttl: Config['ttl']): Promise<Ttl> {
  if (ttl !== 'auto') return ttl
  return isSet(await $.env.get('FORCE_PROMPT_CACHING_5M')) ? '5m' : '1h'
}

// Read on every attempt, so a /config toggle applies without a restart
async function readIdleCompaction($: EngineInterface): Promise<IdleCompaction> {
  const [version, setting, minTokens] = await Promise.all([
    $.session.version().then(v => v.base ?? v.version, () => undefined),
    $.settings.read({ key: 'idleCompaction' }),
    $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'),
  ])
  return { version, enabled: setting !== false, minTokens: Number(minTokens) || IDLE_COMPACTION.minTokens }
}

function reset($: EngineInterface, s: State) {
  s.lastAt = undefined
  s.ticker?.cancel()
  s.ticker = undefined
  $.ui.status(undefined)
}

async function tick($: EngineInterface, s: State, cfg: Config) {
  const at = s.lastAt
  if (at === undefined || s.ttl === undefined) return
  const ttl = s.ttl
  const now = await $.clock.now()
  // A compaction or a new request while awaiting makes this tick stale
  if (s.lastAt !== at) return
  const left = at + PROFILES[ttl].ttlMs - now
  if (left <= 0) {
    s.ticker?.cancel()
    s.ticker = undefined
    $.ui.status('cache expired')
    return
  }
  $.ui.status(`cache ${formatLeft(left)}`)
  if (left > (cfg.marginMs ?? PROFILES[ttl].marginMs) || s.running || s.triedAt === s.lastAt) return

  s.triedAt = s.lastAt
  try {
    const { context } = await $.session.usage()
    const tokens = context.tokens ?? 0
    if (tokens < cfg.minTokens) return
    if (idleCompactionCovers(ttl, tokens, await readIdleCompaction($))) {
      $.ui.log('cache-ttl-compact: left to idle compaction')
      return
    }
    $.ui.toast(`Prompt cache expires in ${formatLeft(left)}, compacting`)
    const done = await $.session.compact({ instructions: cfg.instructions })
    // Our own compaction does not pass through our session.compact hook, so reset here
    if (done.skip === undefined) reset($, s)
    else $.ui.log(`cache-ttl-compact: skipped (${done.skip})`)
  } catch (err) {
    $.ui.log(`cache-ttl-compact: failed (${err instanceof Error ? err.message : String(err)})`)
  }
}

export const register: Register = (on, options) => {
  const marginSeconds = Number(options.marginSeconds ?? 0)
  const cfg: Config = {
    ttl: options.ttl === '1h' || options.ttl === '5m' ? options.ttl : 'auto',
    // 0 takes the TTL's own margin
    marginMs: marginSeconds > 0 ? marginSeconds * 1000 : undefined,
    minTokens: Number(options.minContextTokens ?? 30_000),
    instructions: String(options.instructions || DEFAULT_INSTRUCTIONS),
  }
  const s: State = { running: false }

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) s.running = true
    return next(e)
  })

  // Sending a request refreshes the cache TTL
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      s.ttl ??= await resolveTtl($, cfg.ttl)
      s.lastAt = await $.clock.now()
      s.ticker ??= $.clock.every(1000, () => void tick($, s, cfg))
    }
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) s.running = false
    return next(e)
  })

  // After any compaction (manual, auto, idle, another plugin) there is no warm cache until the next request
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) reset($, s)
    return result
  })

  on('session.end', ($, e, next) => {
    s.running = false
    reset($, s)
    return next(e)
  })
}
