/**
 * Why somebody upgrades.
 *
 * Gemini's fourth point was to engineer a wall for free users to hit.
 * Half right. The hitting is real and unavoidable — a product with no
 * ceiling has no upgrade — but *designing the pain* is a strategy that
 * works once per customer and teaches them exactly what you did. The
 * numbers in `fleet.ts` say hosting a free project costs about a penny
 * and a half a month, which means there is no financial reason to make
 * the free tier hurt. It can simply stop at the point where the next
 * thing is genuinely a different product.
 *
 * So every trigger in this file names a **capability the next plan
 * has**, and none of them is a tax invented to prompt a decision. The
 * difference is testable, and it is tested: no nudge threatens
 * deletion, none fires before a tenant is actually near a limit, and
 * every one of them has to name what the money buys.
 */

import { planOr, planRank, type PlanId } from '../ai/plans'
import { tierFor, type Tier, type Usage } from './tenancy'

export type Trigger =
  | 'storage'
  | 'database'
  | 'rows'
  | 'traffic'
  | 'rate'
  | 'realtime'
  | 'cold-start'
  | 'seats'

export type Nudge = {
  trigger: Trigger
  /** How full the relevant quota is, 0-1. Over 1 means already past it. */
  pressure: number
  /** The plan that resolves it. */
  plan: PlanId
  /** What the next plan can do that this one cannot. */
  capability: string
  /** Shown to the user. Never a threat. */
  message: string
}

/** Below this, say nothing. Nobody wants a sales pitch at 40% full. */
export const NUDGE_AT = 0.8

const PLAN_ORDER: PlanId[] = ['spark', 'core', 'forge', 'titan']

function nextPlan(plan: PlanId): PlanId | undefined {
  return PLAN_ORDER[planRank(plan) + 1]
}

const gb = (mb: number) => (mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${Math.round(mb)} MB`)

/**
 * What this project is close to needing, and which plan has it.
 *
 * Returns the pressures in descending order, so the dashboard can
 * show the one that matters rather than a wall of meters. An empty
 * array is the common case and the desirable one.
 */
export function nudgesFor(tier: Tier, usage: Usage, options: { seatsWanted?: number } = {}): Nudge[] {
  const up = nextPlan(tier.plan)
  if (!up) return []
  const better = tierFor(up)
  const plan = planOr(up)
  const quota = tier.quota
  const found: Nudge[] = []

  const add = (trigger: Trigger, pressure: number, capability: string, message: string) => {
    if (pressure >= NUDGE_AT) found.push({ trigger, pressure, plan: up, capability, message })
  }

  add(
    'database',
    usage.databaseMb / quota.databaseMb,
    `${gb(better.quota.databaseMb)} of database`,
    `This project is using ${gb(usage.databaseMb)} of ${gb(quota.databaseMb)}. ${plan.label} holds ${gb(
      better.quota.databaseMb,
    )}.`,
  )
  add(
    'rows',
    usage.rows / quota.rows,
    `${better.quota.rows.toLocaleString('en-US')} rows`,
    `${usage.rows.toLocaleString('en-US')} rows of ${quota.rows.toLocaleString('en-US')}. ${
      plan.label
    } holds ${better.quota.rows.toLocaleString('en-US')}.`,
  )
  add(
    'storage',
    usage.filesMb / quota.filesMb,
    `${gb(better.quota.filesMb)} of file storage`,
    `Storage is ${Math.round((usage.filesMb / quota.filesMb) * 100)}% full. ${plan.label} gives ${gb(
      better.quota.filesMb,
    )}.`,
  )
  add(
    'traffic',
    usage.egressGb / quota.egressGb,
    `${better.quota.egressGb} GB of traffic a month`,
    `This project has served ${Math.round(usage.egressGb)} GB of its ${
      quota.egressGb
    } GB this month. ${plan.label} allows ${better.quota.egressGb} GB.`,
  )
  add(
    'rate',
    usage.requestsLastMinute / quota.requestsPerMinute,
    `${better.quota.requestsPerMinute.toLocaleString('en-US')} requests a minute`,
    `Traffic is close to ${quota.requestsPerMinute} requests a minute, where requests start queuing. ${
      plan.label
    } raises that to ${better.quota.requestsPerMinute.toLocaleString('en-US')}.`,
  )
  add(
    'realtime',
    usage.realtimeConnections / quota.realtimeConnections,
    `${better.quota.realtimeConnections.toLocaleString('en-US')} live connections`,
    `${usage.realtimeConnections} of ${quota.realtimeConnections} live connections are in use. ${
      plan.label
    } keeps ${better.quota.realtimeConnections.toLocaleString('en-US')} open.`,
  )

  // Not a quota at all — a capability. A project that goes quiet and
  // then gets visited is exactly the project whose owner cares about
  // the cold start, and it is the most honest upgrade in the list.
  if (tier.sleepsAfterDays !== undefined && usage.idleDays >= tier.sleepsAfterDays) {
    found.push({
      trigger: 'cold-start',
      pressure: 1,
      plan: up,
      capability: 'no cold start',
      message: `This project slept after ${tier.sleepsAfterDays} quiet days, so the next visitor waits about ${(
        tier.wakeMs / 1000
      ).toFixed(1)}s. ${plan.label} projects stay warm.`,
    })
  }

  // Seats are the one trigger that may skip a plan: Core has a single
  // seat too, so offering it to somebody inviting three people would
  // be selling them a second thing that does not work either.
  const seatsWanted = options.seatsWanted ?? 0
  const seats = planOr(tier.plan).seats
  if (seatsWanted > seats) {
    const roomy = planOr(PLAN_ORDER.find((id) => planOr(id).seats >= seatsWanted) ?? 'titan')
    found.push({
      trigger: 'seats',
      pressure: seatsWanted / seats,
      plan: roomy.id,
      capability: `${roomy.seats} seats`,
      message: `Inviting ${seatsWanted} people needs more than the ${seats} seat${
        seats === 1 ? '' : 's'
      } on this plan. ${roomy.label} includes ${roomy.seats}.`,
    })
  }

  return found.sort((a, b) => b.pressure - a.pressure)
}

/** The one thing worth saying, if anything is. */
export function topNudge(tier: Tier, usage: Usage, options: { seatsWanted?: number } = {}): Nudge | undefined {
  return nudgesFor(tier, usage, options)[0]
}

/**
 * Capabilities each plan adds, for the pricing page.
 *
 * Written as things you can do, not as numbers that got bigger,
 * because a row of numbers is how you end up competing on gigabytes.
 */
export const CAPABILITIES: Record<PlanId, string[]> = {
  spark: [
    'One project, hosted and public',
    'A real database with policies, not a toy',
    'Sleeps after a quiet week, wakes in about a second',
  ],
  core: [
    'Projects stay warm — no cold start, ever',
    'Custom domains with managed certificates',
    'Restore any night from the last thirty, yourself',
    'The Precise engine',
  ],
  forge: [
    'Five seats with per-person history and roles',
    'Staging and production from the same blueprint',
    'The Agent engine, for work that runs unattended',
    'Point-in-time recovery to the second',
  ],
  titan: [
    'Your own machine, not a slice of one',
    'Twenty-five seats, SSO and an audit log that exports',
    'A support channel with a name on it',
    'Data residency you choose',
  ],
}
