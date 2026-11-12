/**
 * How a Vortex tenant is housed, and what it is allowed to use.
 *
 * The rule that makes a free tier survivable is simple and unpopular:
 * **free tenants share everything and own nothing.** One Postgres
 * cluster on owned metal, one schema per tenant, pooled connections,
 * and the project asleep on disk whenever nobody is using it. A paid
 * tenant gets a warm, reserved slice; an enterprise tenant gets its
 * own box. The per-user cost difference between those three is roughly
 * two orders of magnitude, which is the whole reason a free tier can
 * exist at all.
 *
 * The rule that makes it *safe* is less simple: row-level security is
 * one bug away from being the only thing between two customers' data,
 * so it is never the only thing. `ISOLATION_CONTROLS` lists the layers
 * a shared tenant sits behind, each with the failure it is there to
 * survive, and a test asserts that the free tier uses all of them.
 */

import type { PlanId } from '../ai/plans'

export type Housing = 'shared' | 'reserved' | 'dedicated'

export type Quota = {
  /** Rows, indexes and WAL for this tenant, in MB. */
  databaseMb: number
  /** Objects in R2, in MB. */
  filesMb: number
  /** Outbound traffic a month, in GB. */
  egressGb: number
  /** Sustained request rate. Bursts are allowed above it, briefly. */
  requestsPerMinute: number
  /** Hard monthly request ceiling. */
  requestsPerMonth: number
  /** Concurrent realtime sockets. The constraint people forget. */
  realtimeConnections: number
  /** Rows across all tables. Keeps one tenant from eating a box. */
  rows: number
  /** Longest a single query may run before it is killed. */
  statementTimeoutMs: number
}

export type Tier = {
  plan: PlanId
  housing: Housing
  quota: Quota
  /**
   * Idle days before the project is put to sleep. Sleeping costs only
   * disk. `undefined` means it never sleeps.
   */
  sleepsAfterDays?: number
  /** Cold start, in milliseconds, when a sleeping project is poked. */
  wakeMs: number
  /** Resident memory while awake, in MB: pooled connections and cache. */
  awakeRamMb: number
  /** Resident memory while asleep. Not zero, but close. */
  asleepRamMb: number
}

const MINUTE = 60

export const FREE_TIER: Tier = {
  plan: 'spark',
  housing: 'shared',
  quota: {
    databaseMb: 500,
    filesMb: 1_024,
    egressGb: 5,
    requestsPerMinute: 120,
    requestsPerMonth: 1_000_000,
    realtimeConnections: 20,
    rows: 100_000,
    statementTimeoutMs: 5_000,
  },
  sleepsAfterDays: 7,
  wakeMs: 900,
  awakeRamMb: 90,
  asleepRamMb: 2,
}

export const CORE_TIER: Tier = {
  plan: 'core',
  housing: 'reserved',
  quota: {
    databaseMb: 8_192,
    filesMb: 51_200,
    egressGb: 250,
    requestsPerMinute: 1_200,
    requestsPerMonth: 20_000_000,
    realtimeConnections: 500,
    rows: 10_000_000,
    statementTimeoutMs: 30_000,
  },
  wakeMs: 0,
  awakeRamMb: 280,
  asleepRamMb: 280,
}

export const FORGE_TIER: Tier = {
  plan: 'forge',
  housing: 'reserved',
  quota: {
    databaseMb: 32_768,
    filesMb: 256_000,
    egressGb: 1_000,
    requestsPerMinute: 6_000,
    requestsPerMonth: 100_000_000,
    realtimeConnections: 2_500,
    rows: 50_000_000,
    statementTimeoutMs: 60_000,
  },
  wakeMs: 0,
  awakeRamMb: 700,
  asleepRamMb: 700,
}

export const TITAN_TIER: Tier = {
  plan: 'titan',
  housing: 'dedicated',
  quota: {
    databaseMb: 262_144,
    filesMb: 2_048_000,
    egressGb: 10_000,
    requestsPerMinute: 30_000,
    requestsPerMonth: 1_000_000_000,
    realtimeConnections: 20_000,
    rows: 500_000_000,
    statementTimeoutMs: 120_000,
  },
  wakeMs: 0,
  awakeRamMb: 8_000,
  asleepRamMb: 8_000,
}

export const TIERS: Tier[] = [FREE_TIER, CORE_TIER, FORGE_TIER, TITAN_TIER]

export function tierFor(plan: PlanId): Tier {
  return TIERS.find((tier) => tier.plan === plan) ?? FREE_TIER
}

/* ------------------------------------------------------------ isolation */

export type IsolationControl = {
  id: string
  label: string
  /** The specific failure this layer is there to survive. */
  survives: string
  /** Which housings must have it. */
  requiredFor: Housing[]
}

/**
 * Defence in depth for shared housing.
 *
 * Every one of these has been the last line of defence in somebody
 * else's incident report. The point of listing them is that "we use
 * RLS" is a sentence, and this is a checklist.
 */
export const ISOLATION_CONTROLS: IsolationControl[] = [
  {
    id: 'schema',
    label: 'One Postgres schema per tenant',
    survives: 'A query that forgets its tenant filter finds nothing rather than everything.',
    requiredFor: ['shared', 'reserved'],
  },
  {
    id: 'role',
    label: 'A database role per tenant with a forced search_path',
    survives: 'A connection reused from the pool cannot read the previous tenant’s schema.',
    requiredFor: ['shared', 'reserved'],
  },
  {
    id: 'rls',
    label: 'Row-level security compiled from the blueprint',
    survives: 'An application bug that builds the wrong WHERE clause.',
    requiredFor: ['shared', 'reserved', 'dedicated'],
  },
  {
    id: 'assertion',
    label: 'Every query carries the tenant id, checked at the gateway',
    survives: 'A stolen or stale API key pointed at another tenant’s project.',
    requiredFor: ['shared', 'reserved', 'dedicated'],
  },
  {
    id: 'no-raw-sql',
    label: 'No arbitrary SQL on shared housing',
    survives: 'A tenant running a query designed to read the catalogue or burn the box.',
    requiredFor: ['shared'],
  },
  {
    id: 'timeout',
    label: 'Statement timeouts and per-tenant connection caps',
    survives: 'One tenant’s cartesian join taking five thousand others down with it.',
    requiredFor: ['shared', 'reserved'],
  },
  {
    id: 'per-schema-backup',
    label: 'Nightly per-schema dumps alongside cluster PITR',
    survives: 'Restoring one tenant without rolling back everybody else.',
    requiredFor: ['shared', 'reserved'],
  },
]

export function controlsFor(housing: Housing): IsolationControl[] {
  return ISOLATION_CONTROLS.filter((control) => control.requiredFor.includes(housing))
}

/* --------------------------------------------------------------- usage */

export type Usage = {
  databaseMb: number
  filesMb: number
  egressGb: number
  requestsThisMonth: number
  requestsLastMinute: number
  realtimeConnections: number
  rows: number
  /** Days since anything touched this project. */
  idleDays: number
}

export const NO_USAGE: Usage = {
  databaseMb: 0,
  filesMb: 0,
  egressGb: 0,
  requestsThisMonth: 0,
  requestsLastMinute: 0,
  realtimeConnections: 0,
  rows: 0,
  idleDays: 0,
}

export type QuotaBreach = {
  quota: keyof Quota
  message: string
  /** Reads stay up; writes stop. The difference between a limit and an outage. */
  effect: 'throttle' | 'block-writes' | 'block-uploads'
}

const mb = (value: number) => (value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`)

/**
 * What a tenant has run out of, if anything.
 *
 * Breaching a quota never deletes anything and never takes a project
 * offline: reads keep serving, writes stop. A free tier whose penalty
 * is data loss is a free tier nobody trusts with a real project, and
 * the whole point of the free tier is that real projects start on it.
 */
export function quotaBreaches(tier: Tier, usage: Usage): QuotaBreach[] {
  const breaches: QuotaBreach[] = []
  const { quota } = tier
  if (usage.databaseMb > quota.databaseMb) {
    breaches.push({
      quota: 'databaseMb',
      effect: 'block-writes',
      message: `This project is using ${mb(usage.databaseMb)} of its ${mb(
        quota.databaseMb,
      )} of database. Reads keep working; new writes need more room.`,
    })
  }
  if (usage.rows > quota.rows) {
    breaches.push({
      quota: 'rows',
      effect: 'block-writes',
      message: `${usage.rows.toLocaleString('en-US')} rows is past the ${quota.rows.toLocaleString(
        'en-US',
      )} this plan holds.`,
    })
  }
  if (usage.filesMb > quota.filesMb) {
    breaches.push({
      quota: 'filesMb',
      effect: 'block-uploads',
      message: `Storage is full at ${mb(quota.filesMb)}. Existing files still download.`,
    })
  }
  if (usage.egressGb > quota.egressGb) {
    breaches.push({
      quota: 'egressGb',
      effect: 'throttle',
      message: `This project has served ${Math.round(usage.egressGb)} GB this month, past its ${
        quota.egressGb
      } GB. Downloads are being slowed rather than cut off.`,
    })
  }
  if (usage.requestsLastMinute > quota.requestsPerMinute) {
    breaches.push({
      quota: 'requestsPerMinute',
      effect: 'throttle',
      message: `More than ${quota.requestsPerMinute} requests a minute. Extra requests are being queued.`,
    })
  }
  if (usage.requestsThisMonth > quota.requestsPerMonth) {
    breaches.push({
      quota: 'requestsPerMonth',
      effect: 'throttle',
      message: `This project has made ${usage.requestsThisMonth.toLocaleString('en-US')} requests this month.`,
    })
  }
  if (usage.realtimeConnections > quota.realtimeConnections) {
    breaches.push({
      quota: 'realtimeConnections',
      effect: 'throttle',
      message: `${usage.realtimeConnections} live connections is past the ${quota.realtimeConnections} this plan keeps open.`,
    })
  }
  return breaches
}

/** Should this project be asleep right now? */
export function shouldSleep(tier: Tier, usage: Usage): boolean {
  return tier.sleepsAfterDays !== undefined && usage.idleDays >= tier.sleepsAfterDays
}

/**
 * Memory a tenant occupies this month, averaged.
 *
 * `awakeHoursPerMonth` is the number that decides the fleet's size,
 * and for free projects it is small: most of them are built in one
 * evening and visited twice afterwards.
 */
export function averageRamMb(tier: Tier, awakeHoursPerMonth: number): number {
  if (tier.sleepsAfterDays === undefined) return tier.awakeRamMb
  const hours = Math.min(730, Math.max(0, awakeHoursPerMonth))
  return (tier.awakeRamMb * hours + tier.asleepRamMb * (730 - hours)) / 730
}

/** Requests a minute, as a per-second budget for the rate limiter. */
export function burstBudget(tier: Tier): { perSecond: number; burst: number } {
  return { perSecond: tier.quota.requestsPerMinute / MINUTE, burst: Math.ceil(tier.quota.requestsPerMinute / 2) }
}
