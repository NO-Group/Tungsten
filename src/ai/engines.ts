/**
 * The engine catalogue.
 *
 * Four engines, named for what they are rather than for what they cost:
 * Flash is quick and cheap, Balanced is the everyday one, Precise is for
 * hard problems, Agent runs tools in a loop. Deliberately *not* named
 * Spark / Core / Forge / Titan -- those are the subscription plans, and
 * a vocabulary where "I'm on Forge using Forge" is a sentence makes
 * every support conversation worse.
 *
 * Each engine is a **price band with a fallback chain inside it**, and
 * that is the important idea. A route is a model we are willing to
 * serve the band with; the band's retail weight is set against the
 * *dearest* route in the chain, so failing over from Sonnet to GPT-5
 * to Gemini changes the answer's flavour and never changes the bill.
 * Model ids are configuration -- providers rename and retire them --
 * so `resolveEngine` picks the first route the gateway actually has
 * and a stale name costs a fallback, not an outage.
 *
 * `contextCap` is a pricing instrument, not a limitation: several
 * models reprice the whole request past a threshold (Claude Haiku 5.5
 * above 100k, Gemini Pro above 200k), so a band that stays below its
 * cliffs has a worst case we can actually quote.
 *
 * Wholesale rates live in `costs.ts` with the date they were read.
 * Markups are asserted, not assumed: `metering.test.ts` fails if any
 * route in any chain brings an engine below `MINIMUM_MARKUP`.
 */

import { PRICES, priceFor, worstRates, type ProviderId, type Rates } from './costs'
import type { PlanId } from './plans'

export type EngineId = 'flash' | 'balanced' | 'precise' | 'agent'

/** One candidate model for an engine. Preference order is array order. */
export type ModelRoute = {
  provider: ProviderId
  model: string
  /** What we will send it, which can be less than the model can take. */
  contextTokens: number
}

export type Engine = {
  id: EngineId
  label: string
  summary: string
  /** The cheapest plan allowed to call it. */
  minimumPlan: PlanId
  /** Hard ceiling on a single reply, and the basis of the reservation. */
  maxOutputTokens: number
  /** Milli-credits per 1,000 input tokens. */
  creditsIn: number
  /** Milli-credits per 1,000 output tokens. */
  creditsOut: number
  /** The most context this band will send, so its cost has a ceiling. */
  contextCap: number
  routes: ModelRoute[]
}

/**
 * Cached input is billed at a tenth of the input weight, because that
 * is roughly what every provider charges for a cache hit. It is a
 * discount Tungsten passes on rather than pockets: the people with the
 * biggest schemas benefit most, and they are the ones most likely to
 * notice if we do not.
 */
export const CACHED_INPUT_DIVISOR = 10

/** One credit is worth a cent at list price. Everything else follows. */
export const CREDIT_VALUE_MICRO_DOLLARS = 10_000

/**
 * The floor on retail-over-wholesale for every engine, measured
 * against the dearest route it may fall back to. Below this the
 * gateway is a charity; the tests fail rather than let a weight be
 * edited down by accident.
 *
 * Flash and Balanced and Agent run at 3x. Precise runs at 2.8x on
 * purpose: at the top of the market people are buying capability, and
 * a thinner slice of a bigger number is still a bigger number.
 */
export const MINIMUM_MARKUP = 2.75

export const FLASH: Engine = {
  id: 'flash',
  label: 'Flash',
  summary: 'Fast and cheap. Renames, small edits, explanations, autocomplete-shaped work.',
  minimumPlan: 'spark',
  maxOutputTokens: 8_192,
  creditsIn: 100,
  creditsOut: 400,
  // Deliberately below Claude Haiku 5.5's 100k repricing cliff, which
  // would otherwise make this band five times dearer than it looks.
  contextCap: 100_000,
  routes: [
    { provider: 'google', model: 'gemini-2.5-flash-lite', contextTokens: 100_000 },
    { provider: 'anthropic', model: 'claude-haiku-5.5', contextTokens: 100_000 },
    { provider: 'openai', model: 'gpt-5.4-nano', contextTokens: 100_000 },
    { provider: 'deepseek', model: 'deepseek-v4', contextTokens: 100_000 },
  ],
}

export const BALANCED: Engine = {
  id: 'balanced',
  label: 'Balanced',
  summary: 'The everyday engine. Writes features, reads a project, answers properly.',
  minimumPlan: 'spark',
  maxOutputTokens: 16_384,
  creditsIn: 600,
  creditsOut: 3_000,
  contextCap: 400_000,
  routes: [
    { provider: 'anthropic', model: 'claude-sonnet-5.5', contextTokens: 400_000 },
    { provider: 'openai', model: 'gpt-5', contextTokens: 400_000 },
    { provider: 'google', model: 'gemini-3.8-flash', contextTokens: 400_000 },
  ],
}

export const PRECISE: Engine = {
  id: 'precise',
  label: 'Precise',
  summary: 'Slow, expensive, and right more often. Architecture, migrations, nasty bugs.',
  minimumPlan: 'core',
  maxOutputTokens: 32_768,
  creditsIn: 1_400,
  creditsOut: 8_400,
  // Gemini 3.1 Pro doubles above 200k; staying under it keeps the
  // fallback honest instead of quietly doubling the worst case.
  contextCap: 200_000,
  routes: [
    { provider: 'anthropic', model: 'claude-opus-5.5', contextTokens: 200_000 },
    { provider: 'openai', model: 'gpt-5.5', contextTokens: 200_000 },
    { provider: 'google', model: 'gemini-3.1-pro', contextTokens: 200_000 },
  ],
}

export const AGENT: Engine = {
  id: 'agent',
  label: 'Agent',
  summary: 'Runs tools in a loop: reads files, edits, builds, reads the error, tries again.',
  minimumPlan: 'forge',
  maxOutputTokens: 16_384,
  creditsIn: 750,
  creditsOut: 4_500,
  contextCap: 400_000,
  routes: [
    { provider: 'anthropic', model: 'claude-sonnet-5.5', contextTokens: 400_000 },
    { provider: 'openai', model: 'gpt-5.4', contextTokens: 400_000 },
    { provider: 'deepseek', model: 'deepseek-v4', contextTokens: 400_000 },
  ],
}

/** Every engine, cheapest first. The order the picker shows. */
export const ENGINES: Engine[] = [FLASH, BALANCED, PRECISE, AGENT]

export function engineById(id: string): Engine | undefined {
  return ENGINES.find((engine) => engine.id === id)
}

/** The engine a request means, falling back to Balanced rather than failing. */
export function engineOr(id: string | undefined, fallback: EngineId = 'balanced'): Engine {
  return engineById(id ?? '') ?? engineById(fallback) ?? BALANCED
}

/** `provider:model`, the key the gateway reports availability under. */
export function routeKey(route: ModelRoute): string {
  return `${route.provider}:${route.model}`
}

/**
 * Picks the live route for an engine.
 *
 * `available` is what the gateway said it had when Tungsten booted --
 * `provider:model` strings. An empty list means "we have not asked
 * yet", and the preferred route is used optimistically; a non-empty
 * list is believed, which is how a retired model id turns into a
 * fallback instead of a 404 in front of a paying customer.
 */
export function resolveEngine(engine: Engine, available: readonly string[] = []): ModelRoute | undefined {
  if (available.length === 0) return engine.routes[0]
  const live = new Set(available)
  return engine.routes.find((route) => live.has(routeKey(route)))
}

export type RouteReport = {
  engine: EngineId
  /** The route that will be used, if any survives. */
  route?: ModelRoute
  /** Routes the gateway does not have. Worth a log line, not an alarm. */
  missing: string[]
  /** True when nothing at all is available: the engine must be hidden. */
  dark: boolean
}

/**
 * Checks the whole catalogue against what the gateway actually serves.
 * Called once at boot. A dark engine is removed from the picker rather
 * than offered and then refused, because the second one reads as a bug
 * and the first reads as a product decision.
 */
export function validateRoutes(available: readonly string[], catalogue: readonly Engine[] = ENGINES): RouteReport[] {
  return catalogue.map((engine) => {
    const route = resolveEngine(engine, available)
    const missing =
      available.length === 0
        ? []
        : engine.routes.map(routeKey).filter((key) => !available.includes(key))
    return { engine: engine.id, route, missing, dark: route === undefined }
  })
}

/**
 * The dearest rates any route in this engine's chain can charge,
 * cliffs and published increases included. Every margin figure in the
 * product is computed from this rather than from the preferred route,
 * because a fallback must never turn a sale into a loss.
 */
export function worstRatesFor(engine: Engine): Rates {
  const rates = engine.routes
    .map((route) => priceFor(route.provider, route.model))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => worstRates(entry, engine.contextCap))
  if (rates.length === 0) return { inputPerK: 0, outputPerK: 0, cachedInputPerK: 0 }
  return {
    inputPerK: Math.max(...rates.map((rate) => rate.inputPerK)),
    outputPerK: Math.max(...rates.map((rate) => rate.outputPerK)),
    cachedInputPerK: Math.max(...rates.map((rate) => rate.cachedInputPerK)),
  }
}

/** Every route in the catalogue has a price, or the margin maths is fiction. */
export function unpricedRoutes(catalogue: readonly Engine[] = ENGINES): string[] {
  return catalogue
    .flatMap((engine) => engine.routes)
    .filter((route) => !PRICES.some((entry) => entry.provider === route.provider && entry.model === route.model))
    .map(routeKey)
}

/** The widest context any live route for this engine can take. */
export function contextLimit(engine: Engine, available: readonly string[] = []): number {
  const route = resolveEngine(engine, available)
  return Math.min(engine.contextCap, route?.contextTokens ?? engine.routes[0]?.contextTokens ?? 0)
}
