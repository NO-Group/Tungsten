/**
 * Plans and what they entitle you to.
 *
 * Two layers, deliberately: a subscription buys *capacity and
 * capability* -- seats, hosted projects, a custom domain, the right to
 * call the expensive engines -- and credits buy *tokens*. Bundling the
 * two means either the light users subsidise the heavy ones until the
 * heavy ones leave, or everybody's bill is unpredictable. Splitting
 * them means a plan can be cheap and a heavy month can still pay for
 * itself.
 *
 * Three rules this file enforces rather than merely intends:
 *
 * 1. **An allowance cannot be spent into a loss.** Every plan's
 *    included credits, spent entirely on the most expensive engine the
 *    plan may call, must still leave `MINIMUM_PLAN_MARGIN` of the
 *    price. `plans.test.ts` asserts it, so a generous edit to the
 *    allowance fails the build instead of the quarter.
 * 2. **The free ladder is coherent.** The daily fallback is in the same
 *    order of magnitude as the monthly allowance divided by thirty. A
 *    free tier that gives 50 a month and 5 a day is really a 150-a-month
 *    tier for anyone who notices, which is everyone eventually.
 * 3. **Nothing is gated that makes the product look broken.** Code
 *    export is on every plan including free, because a builder you
 *    cannot leave is not a builder. Media is capped by *bytes*, not
 *    switched off: a refused 20 KB icon reads as a bug, a refused 80 MB
 *    video reads as a limit.
 */

import { ENGINES, engineById, type EngineId } from './engines'
import { wholesalePerCredit } from './pricing'

export type PlanId = 'spark' | 'core' | 'forge' | 'titan'

export type PlanFeatures = {
  /** Download or push the generated source. True everywhere, on purpose. */
  exportCode: boolean
  /** Point a project at Supabase or your own server. Also true everywhere. */
  ownBackend: boolean
  /** Hosted Vortex projects included. Spark's one project sleeps when idle. */
  hostedProjects: number
  /** Hosted projects stay warm. */
  alwaysOn: boolean
  customDomain: boolean
  /** Share a project with teammates who can edit it. */
  teamSharing: boolean
  /** Use your own provider key: those calls bypass credits entirely. */
  bringYourOwnKey: boolean
  auditLog: boolean
  prioritySupport: boolean
}

export type Plan = {
  id: PlanId
  label: string
  summary: string
  /** Monthly price in US cents. Annual is this x 10, handled at checkout. */
  priceCents: number
  /** Credits granted at the start of each billing period. They do not roll over. */
  monthlyCredits: number
  /**
   * Credits granted on a rolling 24-hour window once the monthly
   * allowance is gone. Free plans only: a paid plan that keeps working
   * after its allowance is a plan nobody tops up.
   */
  dailyCredits: number
  /** Engines this plan may call. */
  engines: EngineId[]
  /** Largest single media file, in bytes. */
  mediaBytes: number
  seats: number
  /**
   * Everything that is not inference: hosting the included projects,
   * storage, egress, support. An estimate, and the honest place to
   * put it is next to the price rather than in a spreadsheet nobody
   * opens.
   */
  infraCents: number
  features: PlanFeatures
}

const MB = 1024 * 1024

export const SPARK: Plan = {
  id: 'spark',
  label: 'Spark',
  summary: 'Free. Build real things, export the code, keep the project.',
  priceCents: 0,
  monthlyCredits: 250,
  dailyCredits: 10,
  engines: ['flash', 'balanced'],
  mediaBytes: 25 * MB,
  seats: 1,
  infraCents: 40,
  features: {
    exportCode: true,
    ownBackend: true,
    hostedProjects: 1,
    alwaysOn: false,
    customDomain: false,
    teamSharing: false,
    bringYourOwnKey: false,
    auditLog: false,
    prioritySupport: false,
  },
}

export const CORE: Plan = {
  id: 'core',
  label: 'Core',
  summary: 'For one person shipping. Precise engine, always-on hosting, your domain.',
  priceCents: 2_000,
  monthlyCredits: 3_000,
  dailyCredits: 0,
  engines: ['flash', 'balanced', 'precise'],
  mediaBytes: 100 * MB,
  seats: 1,
  infraCents: 200,
  features: {
    exportCode: true,
    ownBackend: true,
    hostedProjects: 5,
    alwaysOn: true,
    customDomain: true,
    teamSharing: false,
    bringYourOwnKey: false,
    auditLog: false,
    prioritySupport: false,
  },
}

export const FORGE: Plan = {
  id: 'forge',
  label: 'Forge',
  summary: 'For a small team. The Agent engine, shared projects, your own provider keys.',
  priceCents: 6_000,
  monthlyCredits: 9_000,
  dailyCredits: 0,
  engines: ['flash', 'balanced', 'precise', 'agent'],
  mediaBytes: 500 * MB,
  seats: 5,
  infraCents: 700,
  features: {
    exportCode: true,
    ownBackend: true,
    hostedProjects: 25,
    alwaysOn: true,
    customDomain: true,
    teamSharing: true,
    bringYourOwnKey: true,
    auditLog: false,
    prioritySupport: false,
  },
}

export const TITAN: Plan = {
  id: 'titan',
  label: 'Titan',
  summary: 'For a company. Every engine, 25 seats, audit log, someone who answers.',
  priceCents: 20_000,
  monthlyCredits: 25_000,
  dailyCredits: 0,
  engines: ['flash', 'balanced', 'precise', 'agent'],
  mediaBytes: 2048 * MB,
  seats: 25,
  infraCents: 3_000,
  features: {
    exportCode: true,
    ownBackend: true,
    hostedProjects: 200,
    alwaysOn: true,
    customDomain: true,
    teamSharing: true,
    bringYourOwnKey: true,
    auditLog: true,
    prioritySupport: true,
  },
}

/** Cheapest first. The order the pricing page shows, and the upgrade order. */
export const PLANS: Plan[] = [SPARK, CORE, FORGE, TITAN]

export const DEFAULT_PLAN: PlanId = 'spark'

/** The fraction of a plan's price that must survive a worst-case month. */
export const MINIMUM_PLAN_MARGIN = 0.3

export function planById(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id)
}

export function planOr(id: string | undefined): Plan {
  return planById(id ?? '') ?? SPARK
}

export function planRank(id: PlanId): number {
  return PLANS.findIndex((plan) => plan.id === id)
}

/** True when `id` is at least as good as `required`. */
export function atLeast(id: PlanId, required: PlanId): boolean {
  return planRank(id) >= planRank(required)
}

/* ----------------------------------------------------------- entitlement */

/**
 * A refusal that knows what to do about itself.
 *
 * Every gate in the product returns one of these or nothing. The
 * sentence is shown to the person, `upgradeTo` drives the button, and
 * because the cheapest sufficient plan is computed rather than typed
 * in, nobody ever gets upsold two tiers for a feature one tier has.
 */
export type Refusal = {
  reason: 'plan' | 'credits' | 'size' | 'seats'
  message: string
  upgradeTo?: PlanId
}

/** The cheapest plan satisfying a predicate, if any does. */
export function cheapestPlanWith(predicate: (plan: Plan) => boolean): Plan | undefined {
  return PLANS.find(predicate)
}

/** May this plan call this engine? A refusal naming the cheapest plan that can. */
export function engineRefusal(plan: Plan, engineId: EngineId): Refusal | undefined {
  if (plan.engines.includes(engineId)) return undefined
  const engine = engineById(engineId)
  const upgrade = cheapestPlanWith((candidate) => candidate.engines.includes(engineId))
  const label = engine?.label ?? engineId
  return {
    reason: 'plan',
    message: upgrade
      ? `The ${label} engine is part of ${upgrade.label}. ${plan.label} includes ${plan.engines
          .map((id) => engineById(id)?.label ?? id)
          .join(' and ')}.`
      : `The ${label} engine is not available on ${plan.label}.`,
    upgradeTo: upgrade?.id,
  }
}

/** Is this file small enough? Bytes, never capability. */
export function mediaRefusal(plan: Plan, bytes: number): Refusal | undefined {
  if (bytes <= plan.mediaBytes) return undefined
  const upgrade = cheapestPlanWith((candidate) => candidate.mediaBytes >= bytes)
  const mb = (value: number) => `${Math.round(value / MB)} MB`
  return {
    reason: 'size',
    message: upgrade
      ? `That file is ${mb(bytes)}. ${plan.label} takes files up to ${mb(plan.mediaBytes)}; ${
          upgrade.label
        } takes up to ${mb(upgrade.mediaBytes)}.`
      : `That file is ${mb(bytes)}, past the ${mb(plan.mediaBytes)} limit.`,
    upgradeTo: upgrade?.id,
  }
}

export function seatRefusal(plan: Plan, seatsWanted: number): Refusal | undefined {
  if (seatsWanted <= plan.seats) return undefined
  const upgrade = cheapestPlanWith((candidate) => candidate.seats >= seatsWanted)
  return {
    reason: 'seats',
    message: `${plan.label} covers ${plan.seats} ${plan.seats === 1 ? 'seat' : 'seats'}.`,
    upgradeTo: upgrade?.id,
  }
}

/** A yes/no feature gate, with the same manners as the others. */
export function featureRefusal(plan: Plan, feature: keyof PlanFeatures, what: string): Refusal | undefined {
  const value = plan.features[feature]
  if (typeof value === 'number' ? value > 0 : value) return undefined
  const upgrade = cheapestPlanWith((candidate) => {
    const theirs = candidate.features[feature]
    return typeof theirs === 'number' ? theirs > 0 : theirs
  })
  return {
    reason: 'plan',
    message: upgrade ? `${what} starts on ${upgrade.label}.` : `${what} is not part of ${plan.label}.`,
    upgradeTo: upgrade?.id,
  }
}

/* ---------------------------------------------------------- the invariant */

/** What the payment processor takes: 2.9% plus 30 cents, the usual shape. */
export const PROCESSING_RATE = 0.029
export const PROCESSING_FIXED_CENTS = 30

export function processingCents(priceCents: number): number {
  return priceCents === 0 ? 0 : priceCents * PROCESSING_RATE + PROCESSING_FIXED_CENTS
}

export type PlanEconomics = {
  plan: PlanId
  priceCents: number
  /** Provider bill for the credits assumed spent. */
  inferenceCents: number
  infraCents: number
  processingCents: number
  /** Everything above, added up. */
  totalCostCents: number
  /** Fraction of the price left over. Negative means the plan loses money. */
  margin: number
  dearestEngine: EngineId
  /** What fraction of the allowance this figure assumes was used. */
  utilisation: number
}

/**
 * What a plan costs us, and what is left.
 *
 * The default is the **worst** month: every included credit spent on
 * the dearest engine the plan may call, at the dearest route that
 * engine may fall back to, with the long-context cliffs and published
 * price rises counted in. Hosting and the payment processor's cut are
 * added, because a margin that ignores them is a margin that is not
 * there.
 *
 * Pass a `utilisation` below 1 for the realistic case. Both numbers
 * are worth knowing and only one of them is worth betting the company
 * on.
 */
export function economicsOf(plan: Plan, options: { utilisation?: number } = {}): PlanEconomics {
  const utilisation = options.utilisation ?? 1
  const allowed = ENGINES.filter((engine) => plan.engines.includes(engine.id))
  const dearest = allowed.reduce(
    (worst, engine) => (wholesalePerCredit(engine) > wholesalePerCredit(worst) ? engine : worst),
    allowed[0] ?? ENGINES[0],
  )
  const credits = (plan.monthlyCredits + plan.dailyCredits * 30) * utilisation
  const inferenceCents = (credits * wholesalePerCredit(dearest)) / 10_000
  const processing = processingCents(plan.priceCents)
  const totalCostCents = inferenceCents + plan.infraCents + processing
  return {
    plan: plan.id,
    priceCents: plan.priceCents,
    inferenceCents,
    infraCents: plan.infraCents,
    processingCents: processing,
    totalCostCents,
    margin: plan.priceCents === 0 ? 0 : (plan.priceCents - totalCostCents) / plan.priceCents,
    dearestEngine: dearest.id,
    utilisation,
  }
}

/**
 * How much more AI a plan includes than the same credits bought
 * outright. Core and Forge include half as much again; Titan
 * deliberately includes less of a discount, because the biggest
 * allowance is also the one worth farming, and the top tier is sold on
 * seats, audit and support rather than on the cheapest token.
 */
export function includedValueRatio(plan: Plan): number {
  if (plan.priceCents === 0) return Number.POSITIVE_INFINITY
  return (plan.monthlyCredits * LIST_CENTS_PER_CREDIT) / plan.priceCents
}

/** One credit, bought on its own, costs a cent. Everything hangs off this. */
export const LIST_CENTS_PER_CREDIT = 1

/* ------------------------------------------------------------- top-ups */

export type TopUp = {
  id: string
  credits: number
  priceCents: number
}

/**
 * Credit packs. They never expire, which is the point of buying them,
 * and they are spent only after the monthly allowance and the daily
 * grant are gone -- spend the perishable money first.
 */
export const TOP_UPS: TopUp[] = [
  { id: 'pack-1k', credits: 1_000, priceCents: 1_000 },
  { id: 'pack-5k', credits: 5_000, priceCents: 4_500 },
  { id: 'pack-20k', credits: 20_000, priceCents: 16_000 },
]

/** Annual billing: pay for ten months, get twelve. */
export const ANNUAL_MONTHS_CHARGED = 10

export function annualCents(plan: Plan): number {
  return plan.priceCents * ANNUAL_MONTHS_CHARGED
}

export function topUpById(id: string): TopUp | undefined {
  return TOP_UPS.find((pack) => pack.id === id)
}

/** "$0.008 per credit" — shown on the pack so the discount is visible. */
export function perCreditCents(pack: TopUp): number {
  return pack.priceCents / pack.credits
}
