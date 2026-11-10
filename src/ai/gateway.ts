/**
 * The metered gateway.
 *
 * One client, one wire format, four engines, any number of providers
 * behind it. Tungsten never imports a vendor SDK -- the same decision
 * the Universal Data Contract makes for backends, for the same
 * reasons: no supply chain, no vendor-shaped leaks into the product,
 * and a gateway that can re-route a request to a different provider
 * without a release.
 *
 * Every call follows the same five steps, and the order matters:
 *
 *   1. **Gate on plan** before anything else. Refusing after a network
 *      round trip wastes a second and a provider call.
 *   2. **Clamp the reply to what the balance can pay for**, and send
 *      that clamp as the request's hard output limit. This is the hard
 *      stop: the call is physically unable to overspend.
 *   3. **Reserve** the ceiling against an idempotency key.
 *   4. **Call.** Failures release the hold in full -- they are free.
 *   5. **Settle** against the usage the *gateway* reports, never the
 *      estimate the client made. Estimates are for showing people;
 *      ledgers are for providers' numbers.
 *
 * Prompt caching gets the same discipline: `composePrompt` always
 * emits system, then library, then project schema, then the
 * conversation, then the question. The stable part is byte-identical
 * between calls, which is the only way a provider cache ever hits, and
 * the cached tokens come back billed at a tenth.
 */

import { BackendError, type HttpSend } from '../backend/contract'
import {
  contextLimit,
  engineOr,
  resolveEngine,
  routeKey,
  type Engine,
  type EngineId,
  type ModelRoute,
} from './engines'
import { engineRefusal, planOr, type Plan, type PlanId, type Refusal } from './plans'
import {
  MINIMUM_OUTPUT_TOKENS,
  affordableOutputTokens,
  conservativeTokens,
  creditsFor,
  estimateFor,
  reservationFor,
  tokensFromText,
  type Estimate,
  type Usage,
} from './pricing'
import { insufficientRefusal } from './wallet'

/* -------------------------------------------------------------- prompts */

export type Role = 'system' | 'user' | 'assistant'

export type Message = {
  role: Role
  content: string
  /** Part of the stable prefix a provider may cache. */
  cache?: boolean
}

export type PromptParts = {
  /** Who the assistant is. Changes when Tungsten ships, not per call. */
  system: string
  /** Block library, API surface -- large, identical for everyone. */
  library?: string
  /** This project's schema and screens. Identical until the project changes. */
  schema?: string
  /** Earlier turns, oldest first. */
  history?: Message[]
  /** The thing actually being asked. */
  question: string
}

/**
 * Builds the message list in cache order.
 *
 * Stable to volatile, always. Putting the question first, or sorting
 * the schema differently between calls, silently turns every cache hit
 * into a full-price miss -- a 90% price rise that no error message
 * will ever tell you about.
 */
export function composePrompt(parts: PromptParts): Message[] {
  const messages: Message[] = [{ role: 'system', content: parts.system, cache: true }]
  if (parts.library) messages.push({ role: 'system', content: parts.library, cache: true })
  if (parts.schema) messages.push({ role: 'system', content: parts.schema, cache: true })
  for (const turn of parts.history ?? []) messages.push({ role: turn.role, content: turn.content })
  messages.push({ role: 'user', content: parts.question })
  return messages
}

/** The bytes a provider is being asked to cache. Stable or it is worthless. */
export function cachePrefix(messages: readonly Message[]): string {
  return messages
    .filter((message) => message.cache)
    .map((message) => `${message.role}:${message.content}`)
    .join('\n')
}

const textOf = (messages: readonly Message[]) => messages.map((message) => message.content).join('\n')

/* --------------------------------------------------------------- meter */

/**
 * The ledger, as the gateway needs it.
 *
 * In the product this is three HTTPS calls to the billing service; in
 * tests and in offline previews it is `walletMeter` over the pure
 * wallet in `wallet.ts`. The gateway cannot tell the difference, which
 * is the point: the metering rules are one implementation, exercised
 * by every test that runs locally.
 */
export type Meter = {
  /** Spendable credits right now. */
  available: (now: number) => Promise<number>
  reserve: (request: { key: string; engine: EngineId; credits: number; now: number }) => Promise<
    { ok: true } | { ok: false; refusal: Refusal }
  >
  /** Closes a hold and answers with the credits actually charged. */
  settle: (request: { key: string; credits: number; usage: Usage; now: number }) => Promise<number>
  release: (request: { key: string; reason: string; now: number }) => Promise<void>
}

/* ------------------------------------------------------------- the wire */

export const GATEWAY_URL = 'https://gateway.tungsten.dev'

export type GatewayOptions = {
  http: HttpSend
  meter: Meter
  /** Identity token. Carries no plan and no balance; see `account.ts`. */
  token?: string
  baseUrl?: string
  /** The account's plan, read server-side and refreshed, never from a token. */
  plan?: () => PlanId
  now?: () => number
  /** `provider:model` keys the gateway reported at boot. */
  models?: () => readonly string[]
  /** Optional streaming transport. Without one, `onChunk` is ignored. */
  stream?: StreamSend
}

/** Yields raw SSE `data:` payloads, in order. */
export type StreamSend = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => AsyncIterable<string>

export type CompleteRequest = {
  engine: EngineId
  prompt: PromptParts | Message[]
  /** Idempotency key. The same key never charges twice. */
  key: string
  maxOutputTokens?: number
  onChunk?: (text: string) => void
  /** Cooperative cancellation for streams. */
  isAborted?: () => boolean
}

export type CompleteResult =
  | {
      ok: true
      text: string
      usage: Usage
      credits: number
      engine: EngineId
      model: string
      /** True when the reply stopped because the budget ran out. */
      truncated: boolean
    }
  | { ok: false; refusal: Refusal }

export type Gateway = {
  /** What a request would cost, before anybody is charged. */
  estimate: (request: { engine: EngineId; prompt: PromptParts | Message[]; maxOutputTokens?: number }) => Estimate
  complete: (request: CompleteRequest) => Promise<CompleteResult>
  /** `provider:model` keys the gateway can serve right now. */
  models: () => Promise<string[]>
}

const trimSlash = (url: string) => url.replace(/\/+$/, '')

function errorFor(status: number, body: string): BackendError {
  const detail = body.slice(0, 500)
  if (status === 401 || status === 403) {
    return new BackendError('unauthorized', 'The AI gateway rejected this session. Sign in again.', detail)
  }
  if (status === 404) return new BackendError('not-found', 'That engine is not available on the gateway.', detail)
  if (status === 408 || status === 504) {
    return new BackendError('offline', 'The model took too long to answer. Nothing was charged.', detail)
  }
  if (status === 429) {
    return new BackendError('rate-limited', 'The gateway is at capacity for this engine. Try again shortly.', detail)
  }
  if (status >= 500) return new BackendError('offline', 'The AI gateway is having trouble. Nothing was charged.', detail)
  return new BackendError('invalid', 'The gateway refused that request.', detail)
}

function usageFrom(value: unknown, fallbackText: string): Usage {
  const record = (value ?? {}) as Record<string, unknown>
  const number = (key: string) => (typeof record[key] === 'number' ? (record[key] as number) : undefined)
  const input = number('inputTokens') ?? number('prompt_tokens') ?? 0
  const cached = number('cachedInputTokens') ?? number('cached_tokens') ?? 0
  const output = number('outputTokens') ?? number('completion_tokens')
  return {
    inputTokens: Math.max(0, input),
    cachedInputTokens: Math.max(0, cached),
    outputTokens: Math.max(0, output ?? tokensFromText(fallbackText)),
  }
}

/**
 * Builds a gateway client.
 *
 * `plan` and `models` are functions rather than values because both
 * change under the application's feet -- an upgrade must take effect
 * on the next call, and a model retired at the gateway must stop being
 * chosen without a reload.
 */
export function createGateway(options: GatewayOptions): Gateway {
  const base = trimSlash(options.baseUrl ?? GATEWAY_URL)
  const clock = options.now ?? (() => Date.now())
  const planOf = (): Plan => planOr(options.plan?.() ?? 'spark')
  const available = () => options.models?.() ?? []

  const headers = (key?: string): Record<string, string> => ({
    'content-type': 'application/json',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
  })

  const messagesOf = (prompt: PromptParts | Message[]) => (Array.isArray(prompt) ? prompt : composePrompt(prompt))

  function estimate(request: { engine: EngineId; prompt: PromptParts | Message[]; maxOutputTokens?: number }): Estimate {
    const engine = engineOr(request.engine)
    const messages = messagesOf(request.prompt)
    return estimateFor(engine, {
      inputTokens: tokensFromText(textOf(messages)),
      maxOutputTokens: request.maxOutputTokens,
    })
  }

  /** Everything the call needs, or the reason it is not happening. */
  function prepare(
    request: CompleteRequest,
    now: number,
    spendable: number,
  ):
    | { ok: false; refusal: Refusal }
    | {
        ok: true
        engine: Engine
        route: ModelRoute
        messages: Message[]
        inputTokens: number
        maxOutputTokens: number
        hold: number
        truncated: boolean
      } {
    const engine = engineOr(request.engine)
    const plan = planOf()

    const gate = engineRefusal(plan, engine.id)
    if (gate) return { ok: false, refusal: gate }

    const route = resolveEngine(engine, available())
    if (!route) {
      return {
        ok: false,
        refusal: { reason: 'plan', message: `No provider is serving the ${engine.label} engine right now.` },
      }
    }

    const messages = messagesOf(request.prompt)
    // The reservation assumes nothing is cached. A cache hit then makes
    // the settle cheaper than the hold, which is the right direction
    // for a surprise to run in.
    const inputTokens = tokensFromText(textOf(messages))
    const window = contextLimit(engine, available())
    if (inputTokens > window) {
      return {
        ok: false,
        refusal: {
          reason: 'size',
          message: `That prompt is about ${Math.round(inputTokens / 1000)}k tokens and ${engine.label} holds ${Math.round(
            window / 1000,
          )}k. Narrow the context or start a new conversation.`,
        },
      }
    }

    const billable = conservativeTokens(inputTokens)
    const wanted = Math.min(request.maxOutputTokens ?? engine.maxOutputTokens, engine.maxOutputTokens)
    const affordable = affordableOutputTokens(engine, spendable, { inputTokens: billable })
    const maxOutputTokens = Math.min(wanted, affordable)
    if (maxOutputTokens < MINIMUM_OUTPUT_TOKENS) {
      const needed = reservationFor(engine, { inputTokens: billable, maxOutputTokens: MINIMUM_OUTPUT_TOKENS })
      return { ok: false, refusal: insufficientRefusal(plan, needed, spendable) }
    }

    return {
      ok: true,
      engine,
      route,
      messages,
      inputTokens,
      maxOutputTokens,
      hold: reservationFor(engine, { inputTokens: billable, maxOutputTokens }),
      truncated: maxOutputTokens < wanted,
    }
  }

  async function complete(request: CompleteRequest): Promise<CompleteResult> {
    const now = clock()
    const spendable = await options.meter.available(now)
    const plan = prepare(request, now, spendable)
    if (!plan.ok) return plan

    const reserved = await options.meter.reserve({
      key: request.key,
      engine: plan.engine.id,
      credits: plan.hold,
      now,
    })
    if (!reserved.ok) return { ok: false, refusal: reserved.refusal }

    const body = JSON.stringify({
      engine: plan.engine.id,
      provider: plan.route.provider,
      model: plan.route.model,
      maxOutputTokens: plan.maxOutputTokens,
      cachePrefixBytes: cachePrefix(plan.messages).length,
      messages: plan.messages.map((message) => ({ role: message.role, content: message.content, cache: message.cache })),
    })

    const streaming = Boolean(request.onChunk && options.stream)
    try {
      const answer = streaming
        ? await readStream(options.stream!, `${base}/v1/stream`, body, headers(request.key), request)
        : await readOnce(options.http, `${base}/v1/complete`, body, headers(request.key))

      const usage = answer.usage
      // What the ledger charged, not what we calculated: a clamp or a
      // replayed key means those two numbers differ, and the receipt
      // has to show the one that moved money.
      const credits = await options.meter.settle({
        key: request.key,
        credits: creditsFor(plan.engine, usage),
        usage,
        now: clock(),
      })
      return {
        ok: true,
        text: answer.text,
        usage,
        credits,
        engine: plan.engine.id,
        model: answer.model || plan.route.model,
        truncated: plan.truncated || answer.truncated,
      }
    } catch (error) {
      // Anything that arrived before the failure was still generated and
      // still billed to us, so a part-delivered stream is settled for
      // what it delivered and everything else is released in full.
      const partial = error instanceof StreamStopped ? error : undefined
      if (partial) {
        const credits = await options.meter.settle({
          key: request.key,
          credits: creditsFor(plan.engine, partial.usage),
          usage: partial.usage,
          now: clock(),
        })
        return {
          ok: true,
          text: partial.text,
          usage: partial.usage,
          credits,
          engine: plan.engine.id,
          model: plan.route.model,
          truncated: true,
        }
      }
      await options.meter.release({
        key: request.key,
        reason: error instanceof Error ? error.message : 'The call failed.',
        now: clock(),
      })
      throw error
    }
  }

  async function models(): Promise<string[]> {
    const reply = await options.http(`${base}/v1/models`, { method: 'GET', headers: headers() })
    const text = await reply.text()
    if (!reply.ok) throw errorFor(reply.status, text)
    const parsed = JSON.parse(text || '{}') as { models?: Array<{ provider?: string; model?: string } | string> }
    return (parsed.models ?? []).map((entry) =>
      typeof entry === 'string' ? entry : routeKey({ provider: (entry.provider ?? 'openai') as ModelRoute['provider'], model: entry.model ?? '', contextTokens: 0 }),
    )
  }

  return { estimate, complete, models }
}

/* ------------------------------------------------------------ transports */

type Answer = { text: string; usage: Usage; model: string; truncated: boolean }

async function readOnce(
  http: HttpSend,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<Answer> {
  const reply = await http(url, { method: 'POST', headers, body })
  const text = await reply.text()
  if (!reply.ok) throw errorFor(reply.status, text)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text || '{}') as Record<string, unknown>
  } catch {
    throw new BackendError('unknown', 'The gateway sent something that was not an answer.', text.slice(0, 200))
  }
  const answer = typeof parsed.text === 'string' ? parsed.text : ''
  return {
    text: answer,
    usage: usageFrom(parsed.usage, answer),
    model: typeof parsed.model === 'string' ? parsed.model : '',
    truncated: parsed.finishReason === 'length',
  }
}

/** Thrown when a stream ends early but delivered something billable. */
class StreamStopped extends Error {
  readonly text: string
  readonly usage: Usage

  constructor(text: string, usage: Usage) {
    super('The answer stopped early.')
    this.name = 'StreamStopped'
    this.text = text
    this.usage = usage
  }
}

async function readStream(
  stream: StreamSend,
  url: string,
  body: string,
  headers: Record<string, string>,
  request: CompleteRequest,
): Promise<Answer> {
  let text = ''
  let model = ''
  let usage: Usage | undefined
  let truncated = false
  const delivered = (inputText: string): Usage => ({
    inputTokens: tokensFromText(inputText),
    cachedInputTokens: 0,
    outputTokens: tokensFromText(text),
  })

  try {
    for await (const frame of stream(url, { method: 'POST', headers, body })) {
      const payload = frame.trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>
      } catch {
        continue
      }
      if (typeof parsed.delta === 'string') {
        text += parsed.delta
        request.onChunk?.(parsed.delta)
      }
      if (typeof parsed.model === 'string') model = parsed.model
      if (parsed.finishReason === 'length') truncated = true
      if (parsed.usage) usage = usageFrom(parsed.usage, text)
      if (request.isAborted?.()) throw new StreamStopped(text, usage ?? delivered(body))
    }
  } catch (error) {
    if (error instanceof StreamStopped) throw error
    if (text) throw new StreamStopped(text, usage ?? delivered(body))
    throw error instanceof BackendError
      ? error
      : new BackendError('offline', 'The answer stopped before it started. Nothing was charged.')
  }

  return { text, usage: usage ?? delivered(body), model, truncated }
}
