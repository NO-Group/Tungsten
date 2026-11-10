/**
 * Credit arithmetic.
 *
 * One rule underneath all of it: **a credit is a unit of tokens, not a
 * unit of prompts.** Pricing per prompt is pricing a 200,000-token
 * refactor the same as "rename this variable", which the people sending
 * the long prompts notice long before the people selling the plan do.
 *
 *     credits = ceil( (uncachedIn x wIn + cachedIn x wIn / 10 + out x wOut) / 1e6 )
 *
 * with the weights in milli-credits per thousand tokens, so the sum is
 * in micro-credits and every intermediate value is an integer. No
 * floating point touches money: `0.1 + 0.2` problems in a ledger are
 * support tickets that take an hour each.
 *
 * The other idea here is `affordableOutputTokens`. A balance check
 * before a call is a race and a guess; instead Tungsten works out how
 * many output tokens the remaining balance can actually pay for and
 * sends that as the request's hard output limit. The call then cannot
 * overspend -- not "should not", cannot -- which is what makes the
 * reservation exact and the hard stop real.
 */

import { CACHED_INPUT_DIVISOR, CREDIT_VALUE_MICRO_DOLLARS, type Engine } from './engines'

/** Micro-credits in one credit. Everything internal is micro-credits. */
export const MICRO = 1_000_000

/** Any call that reaches a provider costs at least this. */
export const MINIMUM_BILLABLE_CREDITS = 1

/** Below this an answer is not worth starting, so the call is refused instead. */
export const MINIMUM_OUTPUT_TOKENS = 256

/**
 * What a call consumed.
 *
 * `inputTokens` is **uncached** input. Cached input is counted
 * separately because it is billed separately; adding it to both fields
 * is the single easiest way to overcharge somebody by 10%.
 */
export type Usage = {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
}

export const NO_USAGE: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }

const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)

/** The raw cost of a usage record, in micro-credits. Exact integer. */
export function microCreditsFor(engine: Engine, usage: Usage): number {
  const uncached = whole(usage.inputTokens) * engine.creditsIn
  const cached = Math.ceil((whole(usage.cachedInputTokens ?? 0) * engine.creditsIn) / CACHED_INPUT_DIVISOR)
  const output = whole(usage.outputTokens) * engine.creditsOut
  return uncached + cached + output
}

/**
 * What to charge for a usage record.
 *
 * Rounded up, because a fraction of a credit cannot be shown in a
 * balance, and floored at one credit for anything that actually ran --
 * a provider charged us for it either way. A record with no tokens at
 * all costs nothing: that is a failure, and failures are free.
 */
export function creditsFor(engine: Engine, usage: Usage): number {
  const micro = microCreditsFor(engine, usage)
  if (micro === 0) return 0
  return Math.max(MINIMUM_BILLABLE_CREDITS, Math.ceil(micro / MICRO))
}

/** A character count read as tokens. An estimate, and only ever used as one. */
export function tokensFromText(text: string): number {
  return Math.ceil(text.length / 4)
}

/** How far our four-characters-a-token guess is allowed to be wrong. */
export const INPUT_ESTIMATE_MARGIN = 0.2

/**
 * The input figure a *reservation* uses.
 *
 * Every tokeniser disagrees with every other one, and the gateway's
 * count is the one that gets billed. Holding a little more than we
 * think we need means the settle is almost always a refund rather
 * than a clamp, and a refund is invisible while a clamp is us
 * absorbing the difference.
 */
export function conservativeTokens(tokens: number): number {
  return Math.ceil(whole(tokens) * (1 + INPUT_ESTIMATE_MARGIN)) + 256
}

export type Estimate = {
  /** What the UI shows before the call: input plus the expected reply. */
  credits: number
  /** The most this call could possibly cost, which is what gets held. */
  ceiling: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

/**
 * The number shown next to the send button.
 *
 * Two figures, not one: the likely cost and the ceiling. Showing only
 * the likely cost makes the reservation look like a bug when the
 * balance dips by more than the estimate; showing only the ceiling
 * makes every call look ruinous.
 */
export function estimateFor(
  engine: Engine,
  input: { inputTokens: number; cachedInputTokens?: number; expectedOutputTokens?: number; maxOutputTokens?: number },
): Estimate {
  const cachedInputTokens = whole(input.cachedInputTokens ?? 0)
  const inputTokens = whole(input.inputTokens)
  const ceilingOutput = Math.min(whole(input.maxOutputTokens ?? engine.maxOutputTokens), engine.maxOutputTokens)
  const outputTokens = Math.min(whole(input.expectedOutputTokens ?? Math.ceil(ceilingOutput / 4)), ceilingOutput)
  return {
    credits: creditsFor(engine, { inputTokens, cachedInputTokens, outputTokens }),
    ceiling: creditsFor(engine, { inputTokens, cachedInputTokens, outputTokens: ceilingOutput }),
    inputTokens,
    cachedInputTokens,
    outputTokens,
  }
}

/**
 * The exact amount to reserve: input, plus output at the hard limit the
 * request will carry. Nothing after this point can cost more.
 */
export function reservationFor(
  engine: Engine,
  input: { inputTokens: number; cachedInputTokens?: number; maxOutputTokens: number },
): number {
  return creditsFor(engine, {
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    outputTokens: Math.min(whole(input.maxOutputTokens), engine.maxOutputTokens),
  })
}

/**
 * How long a reply the balance can pay for, after the input is paid.
 *
 * This is the hard stop, expressed as a number the provider enforces
 * for us. Returns 0 when the input alone is unaffordable, which the
 * caller turns into a refusal rather than a truncated answer.
 */
export function affordableOutputTokens(
  engine: Engine,
  availableCredits: number,
  input: { inputTokens: number; cachedInputTokens?: number },
): number {
  const budget = whole(availableCredits) * MICRO
  const spent = microCreditsFor(engine, { ...input, outputTokens: 0 })
  const left = budget - spent
  if (left <= 0) return 0
  if (engine.creditsOut <= 0) return engine.maxOutputTokens
  // micro-credits = tokens x weight, so tokens = micro-credits / weight.
  return Math.min(engine.maxOutputTokens, Math.floor(left / engine.creditsOut))
}

/* ------------------------------------------------------------ the margin */

/** What a call cost Tungsten at list provider pricing, in micro-dollars. */
export function wholesaleMicroDollars(engine: Engine, usage: Usage): number {
  const uncached = (whole(usage.inputTokens) * engine.costIn) / 1000
  const cached = (whole(usage.cachedInputTokens ?? 0) * engine.costIn) / 1000 / CACHED_INPUT_DIVISOR
  const output = (whole(usage.outputTokens) * engine.costOut) / 1000
  return Math.round(uncached + cached + output)
}

/** Retail over wholesale for an engine, as a ratio. The margin, in one number. */
export function markupOf(engine: Engine): number {
  const onInput = (engine.creditsIn * CREDIT_VALUE_MICRO_DOLLARS) / 1000 / engine.costIn
  const onOutput = (engine.creditsOut * CREDIT_VALUE_MICRO_DOLLARS) / 1000 / engine.costOut
  return Math.min(onInput, onOutput)
}

/**
 * The worst case a single credit can cost us on this engine, in
 * micro-dollars. Plans are checked against this: an allowance spent
 * entirely on the most expensive engine still has to leave a margin,
 * or the plan is a loss-leader by accident rather than on purpose.
 */
export function wholesalePerCredit(engine: Engine): number {
  return Math.max((1000 * engine.costIn) / engine.creditsIn, (1000 * engine.costOut) / engine.creditsOut)
}

/* -------------------------------------------------------------- for eyes */

export function formatCredits(credits: number): string {
  const value = Math.max(0, Math.round(credits))
  return value.toLocaleString('en-US')
}

export function formatUsd(microDollars: number): string {
  return `$${(microDollars / 1_000_000).toFixed(2)}`
}

/** "1,402 credits — 200k in, 16k out on Precise". For the usage list. */
export function describeSpend(engine: Engine, usage: Usage, credits: number): string {
  const compact = (tokens: number) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`)
  const cached = usage.cachedInputTokens ? `, ${compact(usage.cachedInputTokens)} cached` : ''
  return `${formatCredits(credits)} credits — ${compact(usage.inputTokens)} in${cached}, ${compact(
    usage.outputTokens,
  )} out on ${engine.label}`
}
