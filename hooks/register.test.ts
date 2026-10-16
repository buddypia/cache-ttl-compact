import type { On } from 'claude-code'
import { type Engine, describe, expect, mock, test } from 'claude-code/testing'
import { formatLeft } from './register'

const HOUR = 3_600_000
const MARGIN = 180_000

function world(on: On, tokens: number) {
  const clock = mock.clock(on)
  const calls = { compact: 0, status: [] as (string | undefined)[] }
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn", usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: [] } }))
  on('session.compact', () => {
    calls.compact++
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
})
