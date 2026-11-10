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
 * Three facts live on every engine and all three are load-bearing:
 *
 * 1. **Retail weights** (`creditsIn` / `creditsOut`), in milli-credits
 *    per thousand tokens. Billing is per token because cost is per
 *    token. A 200k-context call is thirty times the work of a short
 *    one, and pricing per prompt means the thirty-times call is sold at
 *    the price of the short one.
 * 2. **Wholesale cost** (`costIn` / `costOut`), in micro-dollars per
 *    thousand tokens, written down next to the retail price so the
 *    margin is a number anybody can check -- and so a test can check it
 *    on every commit. This is the difference between "the loophole is
 *    sealed" as a claim and as an assertion.
 * 3. **A fallback chain.** A model id is configuration, not a constant
 *    of nature: providers rename and retire them. Each engine lists
 *    routes in preference order, the gateway reports which models it
 *    actually has, and `resolveEngine` picks the first route that is
 *    really there. A stale name costs a fallback, not an outage.
 */

import type { PlanId } from './plans'

export type EngineId = 'flash' | 'balanced' | 'precise' | 'agent'

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'local'

/** One candidate model for an engine. Preference order is array order. */
export type ModelRoute = {
  provider: ProviderId
  model: string
  /** Rough context window, for the "this prompt will not fit" message. */
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
  /** Micro-dollars per 1,000 input tokens, at list provider pricing. */
  costIn: number
  /** Micro-dollars per 1,000 output tokens, at list provider pricing. */
  costOut: number
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
 * The floor on retail-over-wholesale for every engine. Below this the
 * gateway is a charity; `engines.test.ts` fails rather than let a
 * weight be edited down by accident.
 */
export const MINIMUM_MARKUP = 3

export const FLASH: Engine = {
  id: 'flash',
  label: 'Flash',
  summary: 'Fast and cheap. Renames, small edits, explanations, autocomplete-shaped work.',
  minimumPlan: 'spark',
  maxOutputTokens: 8_192,
  creditsIn: 50,
  creditsOut: 200,
  costIn: 100,
  costOut: 400,
  routes: [
    { provider: 'google', model: 'gemini-2.0-flash', contextTokens: 1_000_000 },
    { provider: 'openai', model: 'gpt-4o-mini', contextTokens: 128_000 },
    { provider: 'anthropic', model: 'claude-3-5-haiku', contextTokens: 200_000 },
  ],
}

export const BALANCED: Engine = {
  id: 'balanced',
  label: 'Balanced',
  summary: 'The everyday engine. Writes features, reads a project, answers properly.',
  minimumPlan: 'spark',
  maxOutputTokens: 16_384,
  creditsIn: 1_000,
  creditsOut: 5_000,
  costIn: 3_000,
  costOut: 15_000,
  routes: [
    { provider: 'anthropic', model: 'claude-sonnet-4', contextTokens: 200_000 },
    { provider: 'openai', model: 'gpt-4.1', contextTokens: 1_000_000 },
    { provider: 'google', model: 'gemini-2.5-pro', contextTokens: 1_000_000 },
  ],
}

export const PRECISE: Engine = {
  id: 'precise',
  label: 'Precise',
  summary: 'Slow, expensive, and right more often. Architecture, migrations, nasty bugs.',
  minimumPlan: 'core',
  maxOutputTokens: 32_768,
  creditsIn: 4_800,
  creditsOut: 24_000,
  costIn: 15_000,
  costOut: 75_000,
  routes: [
    { provider: 'anthropic', model: 'claude-opus-4', contextTokens: 200_000 },
    { provider: 'openai', model: 'o3', contextTokens: 200_000 },
    { provider: 'google', model: 'gemini-2.5-pro-thinking', contextTokens: 1_000_000 },
  ],
}

export const AGENT: Engine = {
  id: 'agent',
  label: 'Agent',
  summary: 'Runs tools in a loop: reads files, edits, builds, reads the error, tries again.',
  minimumPlan: 'forge',
  maxOutputTokens: 16_384,
  creditsIn: 1_800,
  creditsOut: 9_000,
  costIn: 5_000,
  costOut: 25_000,
  routes: [
    { provider: 'anthropic', model: 'claude-sonnet-4', contextTokens: 200_000 },
    { provider: 'openai', model: 'gpt-4.1', contextTokens: 1_000_000 },
    { provider: 'deepseek', model: 'deepseek-v3', contextTokens: 128_000 },
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

/** The widest context any live route for this engine can take. */
export function contextLimit(engine: Engine, available: readonly string[] = []): number {
  const route = resolveEngine(engine, available)
  return route?.contextTokens ?? engine.routes[0]?.contextTokens ?? 0
}
