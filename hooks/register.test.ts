import type { On } from 'claude-code'
import { type Engine, describe, expect, mock, test } from 'claude-code/testing'
import { atLeast, formatLeft } from './register'

const HOUR = 3_600_000
const MARGIN = 180_000

type World = { version?: string; settings?: Record<string, unknown>; env?: Record<string, string> }

function world(on: On, tokens: number, w: World = {}) {
  const clock = mock.clock(on)
  mock.env(on, w.env ?? {})
  const calls = { compact: 0, instructions: [] as (string | undefined)[], status: [] as (string | undefined)[] }
  on('session.version', () => ({ value: { version: w.version ?? '2.1.310', base: w.version ?? '2.1.310' } }))
  on('settings.read', () => ({ value: w.settings ?? {} }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn", usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: [] } }))
  on('session.compact', ($, e) => {
    calls.compact++
    calls.instructions.push(e.instructions)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] as never }
  })
  on('ui.status', ($, e) => {
    calls.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return { clock, calls }
}

/** Runs one main-conversation turn (one request) */
async function mainTurn($: Engine, agentId?: string) {
  await $.turn.start({ text: 'x', turnId: 't', agentId })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId })) {
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId })
}

describe('formatLeft', () => {
  test('formats as m:ss', () => {
    expect(formatLeft(HOUR)).toBe('60:00')
    expect(formatLeft(61_500)).toBe('1:02')
    expect(formatLeft(-5)).toBe('0:00')
  })
})

describe('atLeast', () => {
  test('compares releases and development builds', () => {
    expect(atLeast('2.1.310', '2.1.299')).toBe(true)
    expect(atLeast('2.1.299-dev', '2.1.299')).toBe(true)
    expect(atLeast('2.1.290', '2.1.299')).toBe(false)
    expect(atLeast('2.2.0', '2.1.299')).toBe(true)
  })
})

describe('cache expiry', () => {
  test('shows the time left and compacts once, margin before expiry', async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($)
    await clock.advance(1_000)
    expect(calls.status.at(-1)).toBe('cache 59:59')

    await clock.advance(HOUR - MARGIN - 2_000)
    expect(calls.compact).toBe(0)
    await clock.advance(2_000)
    expect(calls.compact).toBe(1)
    // After compacting the status clears and nothing compacts again until the next request
    expect(calls.status.at(-1)).toBe(undefined)
    await clock.advance(HOUR)
    expect(calls.compact).toBe(1)
  })

  test('a small context is not compacted and shows expiry', async ($, on) => {
    const { clock, calls } = world(on, 5_000)
    await mainTurn($)
    await clock.advance(HOUR + 1_000)
    expect(calls.compact).toBe(0)
    expect(calls.status.at(-1)).toBe('cache expired')
  })

  test('does not compact while a turn runs', async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($)
    await $.turn.start({ text: 'y', turnId: 't2' })
    await clock.advance(HOUR - MARGIN + 1_000)
    expect(calls.compact).toBe(0)
  })

  test('a new request restarts the countdown', async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($)
    await clock.advance(HOUR / 2)
    await mainTurn($)
    await clock.advance(HOUR / 2)
    expect(calls.compact).toBe(0)
    await clock.advance(HOUR / 2)
    expect(calls.compact).toBe(1)
  })

  test('ignores subagent requests', async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($, 'a1')
    await clock.advance(HOUR)
    expect(calls.compact).toBe(0)
    expect(calls.status.length).toBe(0)
  })

  test('counts 5 minutes with the 5m setting', { options: { ttl: '5m', marginSeconds: 60 } }, async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($)
    await clock.advance(1_000)
    expect(calls.status.at(-1)).toBe('cache 4:59')
    await clock.advance(240_000)
    expect(calls.compact).toBe(1)
  })

  test('takes the 5m TTL and its margin from FORCE_PROMPT_CACHING_5M', async ($, on) => {
    const { clock, calls } = world(on, 80_000, { env: { FORCE_PROMPT_CACHING_5M: '1' } })
    await mainTurn($)
    await clock.advance(1_000)
    expect(calls.status.at(-1)).toBe('cache 4:59')
    await clock.advance(238_000)
    expect(calls.compact).toBe(0)
    await clock.advance(2_000)
    expect(calls.compact).toBe(1)
  })

  test('passes the instructions option to the compaction', { options: { instructions: 'keep the plan' } }, async ($, on) => {
    const { clock, calls } = world(on, 80_000)
    await mainTurn($)
    await clock.advance(HOUR - MARGIN)
    expect(calls.instructions).toEqual(['keep the plan'])
  })
})

describe('Claude Code idle compaction', () => {
  const BIG = 250_000

  test('leaves a context it covers to it, still counting down', async ($, on) => {
    const { clock, calls } = world(on, BIG)
    await mainTurn($)
    await clock.advance(HOUR - MARGIN + 1_000)
    expect(calls.compact).toBe(0)
    expect(calls.status.at(-1)).toBe('cache 2:59')
  })

  test('compacts when idle compaction is turned off', async ($, on) => {
    const { clock, calls } = world(on, BIG, { settings: { idleCompaction: false } })
    await mainTurn($)
    await clock.advance(HOUR - MARGIN)
    expect(calls.compact).toBe(1)
  })

  test('compacts below its minimum set by CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS', async ($, on) => {
    const { clock, calls } = world(on, BIG, { env: { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '300000' } })
    await mainTurn($)
    await clock.advance(HOUR - MARGIN)
    expect(calls.compact).toBe(1)
  })

  test('compacts on a version without it', async ($, on) => {
    const { clock, calls } = world(on, BIG, { version: '2.1.290' })
    await mainTurn($)
    await clock.advance(HOUR - MARGIN)
    expect(calls.compact).toBe(1)
  })

  test('compacts on the 5m TTL, which it does not cover', { options: { ttl: '5m' } }, async ($, on) => {
    const { clock, calls } = world(on, BIG)
    await mainTurn($)
    await clock.advance(240_000)
    expect(calls.compact).toBe(1)
  })
})
