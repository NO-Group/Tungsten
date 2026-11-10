/**
 * What inference actually costs us.
 *
 * Retail prices are a decision; wholesale prices are a fact, and they
 * belong in one file with a date on them. Everything else in `src/ai`
 * derives from this table: an engine's markup, a plan's worst possible
 * month, whether a top-up pack is profitable. Edit a number here and
 * the tests tell you which plan just stopped making money.
 *
 * Rates were read from published provider pricing in **November 2026**
 * and are stored in **micro-dollars per 1,000 tokens** (so $2 per
 * million = 2,000), because that keeps every calculation in integers
 * and in the same unit as the credit weights.
 *
 * Three structural details that pricing pages bury and margin
 * calculations usually miss:
 *
 * 1. **Long-context cliffs.** Several models reprice the *entire*
 *    request once the prompt passes a threshold — Claude Haiku 5.5
 *    five-folds above 100k, Gemini Pro doubles above 200k. A margin
 *    computed on the headline rate is wrong exactly where it matters,
 *    so `worstRates` always includes the cliff unless we have capped
 *    the engine below it.
 * 2. **Scheduled increases.** Google has published that Gemini 3.8
 *    Flash goes from $0.75/$3.75 to $1.50/$7.50 on 1 January 2027. A
 *    price rise we already know about is part of the worst case today.
 * 3. **Cache reads are not all 10%.** Anthropic's current flagships
 *    read cache at 5% of input, Haiku 5.5 at 10%, Gemini Flash at
 *    around 4%. We bill cached input at a flat 10% of our input
 *    weight, so every one of these is a discount we pass on with room
 *    to spare.
 */

export const PRICES_READ_ON = '2026-11-20'

/** Revisit when the table is this old. Providers reprice constantly. */
export const PRICE_REVIEW_DAYS = 90

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'local'

export type Rates = {
  /** Micro-dollars per 1,000 input tokens. */
  inputPerK: number
  outputPerK: number
  cachedInputPerK: number
}

export type ProviderPrice = Rates & {
  provider: ProviderId
  model: string
  /** The model's real context window. */
  contextTokens: number
  /** Rates that replace the base ones for the whole request past a size. */
  longContext?: Rates & { overTokens: number }
  /** A published rise that has not landed yet. Counted in the worst case. */
  scheduled?: Rates & { from: string }
  note?: string
}

const price = (entry: ProviderPrice) => entry

/**
 * The table. Keys are `provider:model`, which is also what the gateway
 * reports as available and what `engines.ts` routes name.
 */
export const PRICES: ProviderPrice[] = [
  // ---------------------------------------------------------- Anthropic
  price({
    provider: 'anthropic',
    model: 'claude-haiku-5.5',
    inputPerK: 100,
    outputPerK: 500,
    cachedInputPerK: 10,
    contextTokens: 200_000,
    longContext: { overTokens: 100_000, inputPerK: 500, outputPerK: 2_500, cachedInputPerK: 50 },
    note: 'Priced by prompt length: past 100k the whole request costs five times as much.',
  }),
  price({
    provider: 'anthropic',
    model: 'claude-sonnet-5.5',
    inputPerK: 2_000,
    outputPerK: 10_000,
    cachedInputPerK: 100,
    contextTokens: 1_000_000,
    note: 'Cache reads at 5% of input, the best of the current flagships.',
  }),
  price({
    provider: 'anthropic',
    model: 'claude-opus-5.5',
    inputPerK: 4_000,
    outputPerK: 20_000,
    cachedInputPerK: 200,
    contextTokens: 1_000_000,
  }),

  // ------------------------------------------------------------- OpenAI
  price({
    provider: 'openai',
    model: 'gpt-5.4-nano',
    inputPerK: 200,
    outputPerK: 1_250,
    cachedInputPerK: 20,
    contextTokens: 400_000,
  }),
  price({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    inputPerK: 750,
    outputPerK: 4_500,
    cachedInputPerK: 75,
    contextTokens: 400_000,
  }),
  price({
    provider: 'openai',
    model: 'gpt-5',
    inputPerK: 1_250,
    outputPerK: 10_000,
    cachedInputPerK: 125,
    contextTokens: 400_000,
  }),
  price({
    provider: 'openai',
    model: 'gpt-5.4',
    inputPerK: 2_500,
    outputPerK: 15_000,
    cachedInputPerK: 250,
    contextTokens: 1_000_000,
  }),
  price({
    provider: 'openai',
    model: 'gpt-5.5',
    inputPerK: 5_000,
    outputPerK: 30_000,
    cachedInputPerK: 500,
    contextTokens: 1_000_000,
  }),

  // ------------------------------------------------------------- Google
  price({
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    inputPerK: 100,
    outputPerK: 400,
    cachedInputPerK: 25,
    contextTokens: 1_000_000,
  }),
  price({
    provider: 'google',
    model: 'gemini-3.8-flash',
    inputPerK: 750,
    outputPerK: 3_750,
    cachedInputPerK: 75,
    contextTokens: 1_000_000,
    scheduled: { from: '2027-01-01', inputPerK: 1_500, outputPerK: 7_500, cachedInputPerK: 150 },
    note: 'Google has published a doubling from 1 January 2027.',
  }),
  price({
    provider: 'google',
    model: 'gemini-3.1-pro',
    inputPerK: 2_000,
    outputPerK: 12_000,
    cachedInputPerK: 200,
    contextTokens: 1_000_000,
    longContext: { overTokens: 200_000, inputPerK: 4_000, outputPerK: 18_000, cachedInputPerK: 400 },
  }),

  // ----------------------------------------------------------- DeepSeek
  price({
    provider: 'deepseek',
    model: 'deepseek-v4',
    inputPerK: 300,
    outputPerK: 500,
    cachedInputPerK: 30,
    contextTokens: 1_000_000,
  }),
]

export function priceKey(provider: ProviderId, model: string): string {
  return `${provider}:${model}`
}

export function priceFor(provider: ProviderId, model: string): ProviderPrice | undefined {
  return PRICES.find((entry) => entry.provider === provider && entry.model === model)
}

/** The rates that apply to a request of this size, cliffs included. */
export function ratesFor(entry: ProviderPrice, inputTokens: number): Rates {
  const cliff = entry.longContext
  if (cliff && inputTokens > cliff.overTokens) {
    return { inputPerK: cliff.inputPerK, outputPerK: cliff.outputPerK, cachedInputPerK: cliff.cachedInputPerK }
  }
  return { inputPerK: entry.inputPerK, outputPerK: entry.outputPerK, cachedInputPerK: entry.cachedInputPerK }
}

/**
 * The dearest this model can ever be, given a cap on how much context
 * we will send it. Published future rises count; a cliff we stay below
 * does not.
 */
export function worstRates(entry: ProviderPrice, contextCap = Number.POSITIVE_INFINITY): Rates {
  const candidates: Rates[] = [
    { inputPerK: entry.inputPerK, outputPerK: entry.outputPerK, cachedInputPerK: entry.cachedInputPerK },
  ]
  if (entry.longContext && contextCap > entry.longContext.overTokens) {
    candidates.push({
      inputPerK: entry.longContext.inputPerK,
      outputPerK: entry.longContext.outputPerK,
      cachedInputPerK: entry.longContext.cachedInputPerK,
    })
  }
  if (entry.scheduled) {
    candidates.push({
      inputPerK: entry.scheduled.inputPerK,
      outputPerK: entry.scheduled.outputPerK,
      cachedInputPerK: entry.scheduled.cachedInputPerK,
    })
  }
  return {
    inputPerK: Math.max(...candidates.map((rate) => rate.inputPerK)),
    outputPerK: Math.max(...candidates.map((rate) => rate.outputPerK)),
    cachedInputPerK: Math.max(...candidates.map((rate) => rate.cachedInputPerK)),
  }
}

/** What a call cost us, in micro-dollars, at the rates that applied. */
export function costOf(
  entry: ProviderPrice,
  usage: { inputTokens: number; cachedInputTokens?: number; outputTokens: number },
): number {
  const rates = ratesFor(entry, usage.inputTokens + (usage.cachedInputTokens ?? 0))
  return Math.round(
    (usage.inputTokens * rates.inputPerK) / 1000 +
      ((usage.cachedInputTokens ?? 0) * rates.cachedInputPerK) / 1000 +
      (usage.outputTokens * rates.outputPerK) / 1000,
  )
}

/** Dollars per million tokens, for reading a rate back in the usual unit. */
export function perMillion(microDollarsPerK: number): number {
  return microDollarsPerK / 1000
}
