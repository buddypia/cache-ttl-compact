import type { EngineInterface, Register, Timer } from 'claude-code'

// Shows the time left until the prompt cache, refreshed by the main conversation's last API request, expires.
// Near expiry it compacts while the cache is still warm, so the next request does not pay to re-cache the whole context.
// A plugin cannot read the TTL, so it comes from the `ttl` option (default 1h).

const TTL_MS = { '1h': 3_600_000, '5m': 300_000 } as const
const INSTRUCTIONS = 'Keep the task in progress, the files changed and what changed in each, design decisions with their reasons, and open items. Write the summary in the language of the conversation.'

type Config = { ttlMs: number; marginMs: number; minTokens: number }

type State = {
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

function reset($: EngineInterface, s: State) {
  s.lastAt = undefined
  s.ticker?.cancel()
  s.ticker = undefined
  $.ui.status(undefined)
}

async function tick($: EngineInterface, s: State, cfg: Config) {
  const at = s.lastAt
  if (at === undefined) return
  const now = await $.clock.now()
  // A compaction or a new request while awaiting makes this tick stale
  if (s.lastAt !== at) return
  const left = at + cfg.ttlMs - now
  if (left <= 0) {
    s.ticker?.cancel()
    s.ticker = undefined
    $.ui.status('cache expired')
    return
  }
  $.ui.status(`cache ${formatLeft(left)}`)
  if (left > cfg.marginMs || s.running || s.triedAt === s.lastAt) return

  s.triedAt = s.lastAt
  try {
    const { context } = await $.session.usage()
    if ((context.tokens ?? 0) < cfg.minTokens) return
    $.ui.toast(`Prompt cache expires in ${formatLeft(left)}, compacting`)
    const done = await $.session.compact({ instructions: INSTRUCTIONS })
    // Our own compaction does not pass through our session.compact hook, so reset here
    if (done.skip === undefined) reset($, s)
    else $.ui.log(`cache-ttl-compact: skipped (${done.skip})`)
  } catch (err) {
    $.ui.log(`cache-ttl-compact: failed (${err instanceof Error ? err.message : String(err)})`)
  }
}

export const register: Register = (on, options) => {
  const cfg: Config = {
    ttlMs: options.ttl === '5m' ? TTL_MS['5m'] : TTL_MS['1h'],
    marginMs: Number(options.marginSeconds ?? 180) * 1000,
    minTokens: Number(options.minContextTokens ?? 30_000),
  }
  const s: State = { running: false }

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) s.running = true
    return next(e)
  })

  // Sending a request refreshes the cache TTL
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      s.lastAt = await $.clock.now()
      s.ticker ??= $.clock.every(1000, () => void tick($, s, cfg))
    }
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) s.running = false
    return next(e)
  })

  // After any compaction (manual, auto, another plugin) there is no warm cache until the next request
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
