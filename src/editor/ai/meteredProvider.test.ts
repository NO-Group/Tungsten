import { beforeEach, describe, expect, it } from 'vitest'

import type { HttpReply, HttpSend } from '../../backend/contract'
import { BALANCED, PRECISE, routeKey } from '../../ai/engines'
import { cachePrefix, composePrompt, createGateway } from '../../ai/gateway'
import { memoryStore, walletMeter } from '../../ai/meter'
import { balance, newWallet } from '../../ai/wallet'
import { affords, describeEstimate } from '../../ai/receipt'
import type { AiContext } from './aiModel'
import {
  ASSISTANT_RULES,
  ASSISTANT_SYSTEM,
  ASSISTANT_MAX_OUTPUT,
  estimateTurn,
  meteredAssistant,
  promptFor,
  refusalAnswer,
  resetTurnCounter,
} from './meteredProvider'

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

const BUFFER = [
  'export function total(items) {',
  '  return items.reduce((sum, item) => sum + item.price, 0)',
  '}',
].join('\n')

const context = (over: Partial<AiContext> = {}): AiContext => ({
  path: 'src/cart.ts',
  buffer: BUFFER,
  selection: '',
  startLine: 1,
  endLine: 3,
  language: 'typescript',
  ...over,
})

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function recorder(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const http: HttpSend = async (url, init) => {
    calls.push({
      url,
      headers: init?.headers ?? {},
      body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {},
    })
    const next = replies.shift() ?? { status: 200, body: {} }
    const status = next.status ?? 200
    const reply: HttpReply = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
      headers: { get: () => null },
    }
    return reply
  }
  return { http, calls }
}

function harness(options: { plan?: 'spark' | 'core'; replies?: Array<{ status?: number; body: unknown }> } = {}) {
  const store = memoryStore(newWallet(options.plan ?? 'core', T0))
  const { http, calls } = recorder(options.replies ?? [])
  const gateway = createGateway({
    http,
    meter: walletMeter(store),
    baseUrl: 'https://gateway.test',
    token: 'identity-token',
    plan: () => store.read().plan,
    now: () => T0,
    models: () => [routeKey(BALANCED.routes[0]), routeKey(PRECISE.routes[0])],
  })
  return { gateway, store, calls, left: () => balance(store.read(), T0).total }
}

const answer = (text: string, usage: Record<string, number>) => ({
  body: { text, model: 'claude-sonnet-5.5', usage },
})

beforeEach(() => resetTurnCounter())

describe('the prompt the editor sends', () => {
  it('puts the constant parts first so the cache can hit', () => {
    const messages = composePrompt(promptFor({ prompt: 'explain this', context: context() }))
    expect(messages[0].content).toBe(ASSISTANT_SYSTEM)
    expect(messages[1].content).toBe(ASSISTANT_RULES)
    expect(messages.filter((message) => message.cache)).toHaveLength(2)
  })

  it('keeps the cached prefix identical across different files', () => {
    const first = cachePrefix(composePrompt(promptFor({ prompt: 'explain', context: context() })))
    const second = cachePrefix(
      composePrompt(promptFor({ prompt: 'wrap in try/catch', context: context({ path: 'other.ts', buffer: 'x' }) })),
    )
    expect(second).toBe(first)
  })

  it('keeps the file out of the cached prefix, because it changes on every keystroke', () => {
    const prefix = cachePrefix(composePrompt(promptFor({ prompt: 'explain', context: context() })))
    expect(prefix).not.toContain('items.reduce')
  })

  it('sends the selection when there is one, and the whole file when there is not', () => {
    const whole = promptFor({ prompt: 'explain', context: context() })
    expect(whole.question).toContain('Whole file')
    expect(whole.question).toContain('the whole file')

    const selected = promptFor({
      prompt: 'explain',
      context: context({ selection: '  return items.reduce', startLine: 2, endLine: 2 }),
    })
    expect(selected.question).toContain('Selected lines')
    expect(selected.question).toContain('line 2')
    expect(selected.question).not.toContain('export function total')
  })

  it('names the file and its language, which a model guesses badly', () => {
    expect(promptFor({ prompt: 'explain', context: context() }).question).toContain('src/cart.ts (typescript)')
  })
})

describe('the price beside the send button', () => {
  it('quotes a likely cost and a ceiling', () => {
    const estimate = estimateTurn('balanced', { prompt: 'explain this', context: context() })
    expect(estimate.credits).toBeGreaterThan(0)
    expect(estimate.ceiling).toBeGreaterThan(estimate.credits)
    expect(describeEstimate(estimate)).toMatch(/about \d+, at most \d+ credits/)
  })

  it('names the engine when it is given one', () => {
    const estimate = estimateTurn('precise', { prompt: 'explain this', context: context() })
    expect(describeEstimate(estimate, PRECISE)).toContain('on Precise')
  })

  it('charges more for a bigger file, because it is more tokens', () => {
    const small = estimateTurn('balanced', { prompt: 'explain', context: context() })
    const large = estimateTurn('balanced', {
      prompt: 'explain',
      context: context({ buffer: BUFFER.repeat(2_000) }),
    })
    expect(large.credits).toBeGreaterThan(small.credits * 5)
  })

  it('costs more on a dearer engine for exactly the same question', () => {
    const balanced = estimateTurn('balanced', { prompt: 'explain this', context: context() })
    const precise = estimateTurn('precise', { prompt: 'explain this', context: context() })
    expect(precise.credits).toBeGreaterThan(balanced.credits)
  })

  it('knows when a balance cannot cover the ceiling', () => {
    const estimate = estimateTurn('precise', { prompt: 'explain', context: context({ buffer: BUFFER.repeat(200) }) })
    expect(affords(estimate.ceiling, estimate)).toBe(true)
    expect(affords(estimate.ceiling - 1, estimate)).toBe(false)
  })
})

describe('the metered assistant', () => {
  it('spends real credits and reports what it cost', async () => {
    const { gateway, calls, left } = harness({
      replies: [answer('It sums the prices.', { inputTokens: 4_000, outputTokens: 1_000 })],
    })
    const provider = meteredAssistant({ gateway, engine: () => 'balanced' })
    const before = left()
    const proposal = await provider.run({ prompt: 'explain this', context: context() }, () => undefined)

    expect(proposal.answer).toBe('It sums the prices.')
    expect(proposal.replacement).toBeUndefined()
    expect(left()).toBeLessThan(before)
    expect(calls[0].url).toBe('https://gateway.test/v1/complete')
    expect(calls[0].headers.authorization).toBe('Bearer identity-token')
    expect(calls[0].headers['idempotency-key']).toBe('editor:1')
  })

  it('clamps the reply so one question cannot run away with the balance', async () => {
    const { gateway, calls } = harness({
      replies: [answer('ok', { inputTokens: 100, outputTokens: 10 })],
    })
    const provider = meteredAssistant({ gateway, engine: () => 'balanced' })
    await provider.run({ prompt: 'explain', context: context() }, () => undefined)
    expect(calls[0].body.maxOutputTokens).toBeLessThanOrEqual(ASSISTANT_MAX_OUTPUT)
  })

  it('pulls the fence out as an edit and prices it in the accept button', async () => {
    const reply = ['Here you go.', '```ts', 'const total = 1', '```'].join('\n')
    const { gateway } = harness({ replies: [answer(reply, { inputTokens: 2_000, outputTokens: 500 })] })
    const provider = meteredAssistant({ gateway, engine: () => 'balanced' })
    const proposal = await provider.run({ prompt: 'simplify this', context: context() }, () => undefined)

    expect(proposal.replacement).toBe('const total = 1')
    expect(proposal.summary).toMatch(/Apply the assistant’s edit \(\d+ credits?\)/)
  })

  it('reads the engine fresh, so changing it applies to the next question', async () => {
    const { gateway, calls } = harness({
      replies: [
        answer('one', { inputTokens: 100, outputTokens: 10 }),
        answer('two', { inputTokens: 100, outputTokens: 10 }),
      ],
    })
    let engine: 'balanced' | 'precise' = 'balanced'
    const provider = meteredAssistant({ gateway, engine: () => engine })
    await provider.run({ prompt: 'a', context: context() }, () => undefined)
    engine = 'precise'
    await provider.run({ prompt: 'b', context: context() }, () => undefined)

    expect(calls[0].body.engine).toBe('balanced')
    expect(calls[1].body.engine).toBe('precise')
  })

  it('gives each question its own idempotency key', async () => {
    const { gateway, calls } = harness({
      replies: [
        answer('one', { inputTokens: 100, outputTokens: 10 }),
        answer('two', { inputTokens: 100, outputTokens: 10 }),
      ],
    })
    const provider = meteredAssistant({ gateway, engine: () => 'balanced' })
    await provider.run({ prompt: 'a', context: context() }, () => undefined)
    await provider.run({ prompt: 'b', context: context() }, () => undefined)
    expect(calls[0].headers['idempotency-key']).not.toBe(calls[1].headers['idempotency-key'])
  })

  it('answers a refusal instead of throwing one', async () => {
    const { gateway, left } = harness({ plan: 'spark' })
    const provider = meteredAssistant({ gateway, engine: () => 'precise' })
    const before = left()
    const proposal = await provider.run({ prompt: 'explain', context: context() }, () => undefined)

    expect(proposal.answer).toContain('Precise')
    expect(proposal.replacement).toBeUndefined()
    // Refused before the wire, so nothing was spent and nothing was sent.
    expect(left()).toBe(before)
  })

  it('never proposes an edit from a refusal', () => {
    const proposal = refusalAnswer({ reason: 'credits', message: 'Out of credits.', upgradeTo: 'core' })
    expect(proposal.replacement).toBeUndefined()
    expect(proposal.answer).toContain('Upgrading to core')
  })

  it('does not charge for a failed call', async () => {
    const { gateway, left } = harness({ replies: [{ status: 500, body: 'boom' }] })
    const provider = meteredAssistant({ gateway, engine: () => 'balanced' })
    const before = left()
    await expect(provider.run({ prompt: 'explain', context: context() }, () => undefined)).rejects.toThrow()
    expect(left()).toBe(before)
  })
})
