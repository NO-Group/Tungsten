import { describe, expect, it } from 'vitest'

import { BackendError, type HttpReply, type HttpSend } from '../backend/contract'
import { BALANCED, routeKey } from './engines'
import { createGateway, cachePrefix, composePrompt, type StreamSend } from './gateway'
import { memoryStore, walletMeter, browserStore, WALLET_KEY } from './meter'
import { creditsFor } from './pricing'
import { applyGrant, balance, newWallet, type Wallet } from './wallet'

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** An HTTP stub that records what it was asked and replies from a queue. */
function recorder(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const http: HttpSend = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
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

const PROMPT = {
  system: 'You are Tungsten.',
  library: 'ui.button, ui.stack, data.query',
  schema: 'posts(title text, body text)',
  question: 'Add a delete button to the post row.',
}

function harness(options: { wallet?: Wallet; plan?: Parameters<typeof newWallet>[0]; replies?: Array<{ status?: number; body: unknown }> } = {}) {
  const wallet = options.wallet ?? newWallet(options.plan ?? 'core', T0)
  const store = memoryStore(wallet)
  const { http, calls } = recorder(options.replies ?? [])
  const gateway = createGateway({
    http,
    meter: walletMeter(store),
    baseUrl: 'https://gateway.test',
    token: 'identity-token',
    plan: () => store.read().plan,
    now: () => T0,
    models: () => [routeKey(BALANCED.routes[0])],
  })
  return { gateway, store, calls, left: () => balance(store.read(), T0).total }
}

const answer = (text: string, usage: Record<string, number>) => ({ body: { text, model: 'claude-sonnet-4', usage } })

describe('prompt composition', () => {
  it('orders the prompt so a provider cache can actually hit', () => {
    const messages = composePrompt({ ...PROMPT, history: [{ role: 'user', content: 'earlier' }] })
    expect(messages.map((message) => message.content)).toEqual([
      'You are Tungsten.',
      'ui.button, ui.stack, data.query',
      'posts(title text, body text)',
      'earlier',
      'Add a delete button to the post row.',
    ])
    expect(messages.filter((message) => message.cache)).toHaveLength(3)
  })

  it('keeps the cached prefix byte-identical between questions', () => {
    const first = cachePrefix(composePrompt(PROMPT))
    const second = cachePrefix(composePrompt({ ...PROMPT, question: 'Something else entirely.' }))
    expect(second).toBe(first)
  })

  it('changes the prefix when the project does, and not before', () => {
    const moved = cachePrefix(composePrompt({ ...PROMPT, schema: 'posts(title text)' }))
    expect(moved).not.toBe(cachePrefix(composePrompt(PROMPT)))
  })
})

describe('the metered gateway', () => {
  it('reserves, calls, and then charges what the gateway reported', () => {
    const usage = { inputTokens: 4_000, cachedInputTokens: 0, outputTokens: 1_000 }
    const kit = harness({ replies: [answer('Done.', usage)] })
    return kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-1' }).then((result) => {
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.text).toBe('Done.')
      expect(result.credits).toBe(creditsFor(BALANCED, usage))
      expect(kit.left()).toBe(3_000 - result.credits)
      expect(kit.store.read().holds).toHaveLength(0)
    })
  })

  it('believes the gateway about usage, not the estimate', async () => {
    // The client guessed a few hundred tokens; the gateway counted
    // twelve thousand and wrote eight. The gateway's numbers win.
    const kit = harness({ replies: [answer('x', { inputTokens: 12_000, outputTokens: 8_000 })] })
    const result = await kit.gateway.complete({ engine: 'balanced', prompt: { ...PROMPT, question: 'hi' }, key: 'call-2' })
    expect(result.ok && result.credits).toBe(32)
    expect(kit.left()).toBe(2_968)
  })

  it('eats the difference rather than charging past the hold', async () => {
    // A gateway that counts input very differently cannot bill more
    // than was reserved: the customer is never surprised, we absorb it.
    const kit = harness({ replies: [answer('x', { inputTokens: 400_000, outputTokens: 16_000 })] })
    const result = await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-2b' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(creditsFor(BALANCED, result.usage)).toBe(288)
    expect(result.credits).toBeLessThan(288)
    expect(kit.left()).toBe(3_000 - result.credits)
  })

  it('passes the cache discount on', async () => {
    const kit = harness({ replies: [answer('ok', { inputTokens: 1_000, cachedInputTokens: 40_000, outputTokens: 500 })] })
    const result = await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-3' })
    // 40k of cached context bills as 2.4 credits, not 24.
    expect(result.ok && result.credits).toBe(5)
  })

  it('refuses an engine the plan does not include, without calling anybody', async () => {
    const kit = harness({ plan: 'spark' })
    const result = await kit.gateway.complete({ engine: 'precise', prompt: PROMPT, key: 'call-4' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.upgradeTo).toBe('core')
    expect(kit.calls).toHaveLength(0)
    expect(kit.left()).toBe(260)
  })

  it('clamps the reply to what the balance can pay for, and says so', async () => {
    const thin: Wallet = { ...newWallet('core', T0), included: 30 }
    const kit = harness({
      wallet: thin,
      replies: [answer('short', { inputTokens: 2_000, outputTokens: 1_000 })],
    })
    const result = await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-5' })
    expect(result.ok && result.truncated).toBe(true)
    // 30 credits, minus ~0.1 for the input, buys about 5,600 output tokens.
    const sent = kit.calls[0].body as { maxOutputTokens: number }
    expect(sent.maxOutputTokens).toBeLessThan(BALANCED.maxOutputTokens)
    expect(sent.maxOutputTokens).toBeGreaterThan(5_000)
  })

  it('stops hard when there is not enough left to be worth starting', async () => {
    const empty: Wallet = { ...newWallet('core', T0), included: 0 }
    const kit = harness({ wallet: empty })
    const result = await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-6' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.reason).toBe('credits')
    expect(result.refusal.message).toContain('top up')
    expect(kit.calls).toHaveLength(0)
  })

  it('charges nothing when the provider fails, and leaves no hold behind', async () => {
    const kit = harness({ replies: [{ status: 503, body: { error: 'upstream down' } }] })
    await expect(
      kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-7' }),
    ).rejects.toBeInstanceOf(BackendError)
    expect(kit.left()).toBe(3_000)
    expect(kit.store.read().holds).toHaveLength(0)
  })

  it('translates the gateway rejecting a session into a sentence', async () => {
    const kit = harness({ replies: [{ status: 401, body: 'nope' }] })
    const failure = await kit.gateway
      .complete({ engine: 'balanced', prompt: PROMPT, key: 'call-8' })
      .catch((error: unknown) => error as BackendError)
    expect((failure as BackendError).code).toBe('unauthorized')
    expect((failure as BackendError).message).toContain('Sign in again')
  })

  it('charges once when a request is retried with the same key', async () => {
    const usage = { inputTokens: 4_000, outputTokens: 1_000 }
    const kit = harness({ replies: [answer('a', usage), answer('a', usage)] })
    await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'same-key' })
    await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'same-key' })
    expect(kit.left()).toBe(2_994)
  })

  it('carries identity and the idempotency key, and nothing about the plan', async () => {
    const kit = harness({ replies: [answer('a', { inputTokens: 10, outputTokens: 10 })] })
    await kit.gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'call-9' })
    const sent = kit.calls[0]
    expect(sent.url).toBe('https://gateway.test/v1/complete')
    expect(sent.headers.authorization).toBe('Bearer identity-token')
    expect(sent.headers['idempotency-key']).toBe('call-9')
    expect(JSON.stringify(sent.headers)).not.toContain('core')
  })

  it('will not route to a model the gateway does not have', async () => {
    const store = memoryStore(newWallet('forge', T0))
    const { http, calls } = recorder([])
    const gateway = createGateway({
      http,
      meter: walletMeter(store),
      baseUrl: 'https://gateway.test',
      plan: () => 'forge',
      now: () => T0,
      models: () => ['openai:something-retired'],
    })
    const result = await gateway.complete({ engine: 'precise', prompt: PROMPT, key: 'call-10' })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('reads the live model list', async () => {
    const kit = harness({ replies: [{ body: { models: [{ provider: 'anthropic', model: 'claude-sonnet-4' }, 'openai:gpt-4.1'] } }] })
    expect(await kit.gateway.models()).toEqual(['anthropic:claude-sonnet-4', 'openai:gpt-4.1'])
  })

  it('shows a cost before anybody is charged', () => {
    const kit = harness()
    const estimate = kit.gateway.estimate({ engine: 'balanced', prompt: PROMPT })
    expect(estimate.credits).toBeGreaterThan(0)
    expect(estimate.ceiling).toBeGreaterThanOrEqual(estimate.credits)
    expect(kit.left()).toBe(3_000)
  })
})

/* ----------------------------------------------------------- streaming */

function streamOf(frames: string[]): StreamSend {
  return async function* send() {
    for (const frame of frames) yield frame
  }
}

describe('streaming', () => {
  const streamHarness = (frames: string[], isAborted?: () => boolean) => {
    const store = memoryStore(newWallet('core', T0))
    const { http } = recorder([])
    const chunks: string[] = []
    const gateway = createGateway({
      http,
      meter: walletMeter(store),
      baseUrl: 'https://gateway.test',
      plan: () => 'core',
      now: () => T0,
      models: () => [routeKey(BALANCED.routes[0])],
      stream: streamOf(frames),
    })
    return { gateway, store, chunks, isAborted }
  }

  it('delivers chunks and settles on the usage frame', async () => {
    const kit = streamHarness([
      JSON.stringify({ delta: 'Hello ' }),
      JSON.stringify({ delta: 'world' }),
      JSON.stringify({ usage: { inputTokens: 4_000, outputTokens: 1_000 }, model: 'claude-sonnet-4' }),
      '[DONE]',
    ])
    const result = await kit.gateway.complete({
      engine: 'balanced',
      prompt: PROMPT,
      key: 'stream-1',
      onChunk: (text) => kit.chunks.push(text),
    })
    expect(kit.chunks.join('')).toBe('Hello world')
    expect(result.ok && result.credits).toBe(6)
    expect(balance(kit.store.read(), T0).total).toBe(2_994)
  })

  it('bills an answer the user stopped for what had already arrived', async () => {
    let seen = 0
    const kit = streamHarness(
      [JSON.stringify({ delta: 'a'.repeat(4_000) }), JSON.stringify({ delta: 'never shown' })],
      () => (seen += 1) >= 1,
    )
    const result = await kit.gateway.complete({
      engine: 'balanced',
      prompt: PROMPT,
      key: 'stream-2',
      onChunk: (text) => kit.chunks.push(text),
      isAborted: kit.isAborted,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.text).toHaveLength(4_000)
    // 1,000 delivered tokens, charged, because the provider charged us.
    expect(result.usage.outputTokens).toBe(1_000)
    expect(result.credits).toBeGreaterThan(0)
    expect(kit.store.read().holds).toHaveLength(0)
  })

  it('charges nothing when a stream dies before the first token', async () => {
    const store = memoryStore(newWallet('core', T0))
    const { http } = recorder([])
    const gateway = createGateway({
      http,
      meter: walletMeter(store),
      baseUrl: 'https://gateway.test',
      plan: () => 'core',
      now: () => T0,
      models: () => [routeKey(BALANCED.routes[0])],
      // eslint-disable-next-line require-yield
      stream: async function* () {
        throw new Error('socket closed')
      },
    })
    await expect(
      gateway.complete({ engine: 'balanced', prompt: PROMPT, key: 'stream-3', onChunk: () => {} }),
    ).rejects.toBeInstanceOf(BackendError)
    expect(balance(store.read(), T0).total).toBe(3_000)
  })
})

/* -------------------------------------------------------------- stores */

describe('wallet stores', () => {
  it('survives a reload', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
    const first = browserStore(storage, { plan: 'core', now: T0 })
    first.write(applyGrant(first.read(), { key: 'pack', at: T0, kind: 'topUp', credits: 400 }))
    expect(data.has(WALLET_KEY)).toBe(true)

    const second = browserStore(storage, { plan: 'core', now: T0 })
    expect(balance(second.read(), T0).total).toBe(3_400)
  })

  it('starts fresh rather than throwing on nonsense', () => {
    const storage = { getItem: () => '{not json', setItem: () => {} }
    expect(balance(browserStore(storage, { plan: 'spark', now: T0 }).read(), T0).total).toBe(260)
  })
})
