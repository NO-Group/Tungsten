/**
 * Rate limiting and cold sleep, as mechanisms rather than intentions.
 *
 * Two of Gemini's four points were "hard quotas" and "scale to zero",
 * and both are correct. Neither is a policy document: a quota that
 * nothing enforces is a promise, and a project that sleeps only in a
 * diagram still costs 90 MB a month. So this file is the enforcement.
 *
 * The limiter is a token bucket, because the alternative — a fixed
 * window — punishes the honest. A client that makes sixty requests in
 * the first second of a minute and nothing afterwards is well inside
 * a 120-per-minute quota and will be refused by a window counter at
 * exactly the moment it is behaving reasonably. A bucket lets a burst
 * through, then holds the sustained rate at the line.
 *
 * The sleeper is deliberately boring. A project asleep must cost disk
 * and nothing else, waking must be automatic and must never lose a
 * request, and the first request after a week of silence pays ~900 ms
 * — charged to the people paying nothing, which is the right place to
 * put it.
 */

import { burstBudget, type Tier, type Usage } from './tenancy'

/* --------------------------------------------------------- the bucket */

export type Bucket = {
  /** Requests still available right now. Fractional between refills. */
  tokens: number
  /** When `tokens` was last recomputed, in epoch milliseconds. */
  updatedAt: number
}

export type Decision = {
  allowed: boolean
  bucket: Bucket
  /** How long to wait before retrying, in ms. Zero when allowed. */
  retryAfterMs: number
  /** What to put in the response headers. */
  remaining: number
  limit: number
}

/** A full bucket. New tenants start allowed to burst. */
export function newBucket(tier: Tier, now: number = Date.now()): Bucket {
  return { tokens: burstBudget(tier).burst, updatedAt: now }
}

/**
 * Spend one request against a tenant's bucket.
 *
 * Refills continuously rather than on a timer: there is no scheduler,
 * no cron, and no state to keep warm for a sleeping tenant. The bucket
 * is just two numbers and a subtraction, which is what makes it cheap
 * enough to run per tenant across a shared box.
 */
export function take(tier: Tier, bucket: Bucket, now: number = Date.now(), cost = 1): Decision {
  const { perSecond, burst } = burstBudget(tier)
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1_000
  const tokens = Math.min(burst, bucket.tokens + elapsedSeconds * perSecond)

  if (tokens >= cost) {
    return {
      allowed: true,
      bucket: { tokens: tokens - cost, updatedAt: now },
      retryAfterMs: 0,
      remaining: Math.floor(tokens - cost),
      limit: burst,
    }
  }

  const shortfall = cost - tokens
  return {
    allowed: false,
    bucket: { tokens, updatedAt: now },
    retryAfterMs: Math.ceil((shortfall / perSecond) * 1_000),
    remaining: 0,
    limit: burst,
  }
}

/**
 * A bucket per tenant, swept so an idle tenant does not keep memory
 * alive forever. A full bucket is indistinguishable from no bucket at
 * all, so anything that has refilled completely can simply be dropped.
 */
export function sweepBuckets(
  tier: Tier,
  buckets: Map<string, Bucket>,
  now: number = Date.now(),
): Map<string, Bucket> {
  const { perSecond, burst } = burstBudget(tier)
  const kept = new Map<string, Bucket>()
  for (const [id, bucket] of buckets) {
    const refilled = bucket.tokens + (Math.max(0, now - bucket.updatedAt) / 1_000) * perSecond
    if (refilled < burst) kept.set(id, bucket)
  }
  return kept
}

/* ---------------------------------------------------------- the sleeper */

export type SleepState = 'awake' | 'asleep'

export type SleepPlan = {
  /** What the project should be, given how long it has been idle. */
  state: SleepState
  /** Days until it would be put to sleep. Zero if it already should be. */
  daysUntilSleep: number
  /** What the next request will pay, in ms. */
  wakeMs: number
  /** Resident memory in this state, in MB. */
  ramMb: number
  /** Said plainly, for the project header. */
  message: string
}

/**
 * What state a project should be in, and what that costs its owner.
 *
 * Stated out loud on purpose. A cold start that nobody warned you
 * about is a bug report; a cold start printed on the dashboard next
 * to "sleeps after 7 quiet days" is a tier.
 */
export function sleepPlan(tier: Tier, usage: Usage): SleepPlan {
  if (tier.sleepsAfterDays === undefined) {
    return {
      state: 'awake',
      daysUntilSleep: Number.POSITIVE_INFINITY,
      wakeMs: 0,
      ramMb: tier.awakeRamMb,
      message: 'This project stays warm. Requests are served without a cold start.',
    }
  }
  const idle = Math.max(0, usage.idleDays)
  if (idle >= tier.sleepsAfterDays) {
    return {
      state: 'asleep',
      daysUntilSleep: 0,
      wakeMs: tier.wakeMs,
      ramMb: tier.asleepRamMb,
      message: `Asleep after ${Math.floor(idle)} quiet days. The next request wakes it in about ${(
        tier.wakeMs / 1000
      ).toFixed(1)}s — nothing is lost.`,
    }
  }
  const remaining = tier.sleepsAfterDays - idle
  return {
    state: 'awake',
    daysUntilSleep: remaining,
    wakeMs: 0,
    ramMb: tier.awakeRamMb,
    message: `Awake. After ${tier.sleepsAfterDays} quiet days this project sleeps, and the next request takes about ${(
      tier.wakeMs / 1000
    ).toFixed(1)}s longer.`,
  }
}

/**
 * Whether a waking request should be held rather than refused.
 *
 * Scale-to-zero is only acceptable if waking is invisible apart from
 * latency. A request that arrives at a sleeping tenant is queued for
 * up to this long; past it, something is wrong with the box, not with
 * the sleeper, and failing fast is the honest answer.
 */
export function wakeDeadlineMs(tier: Tier): number {
  return Math.max(5_000, tier.wakeMs * 6)
}

/** Memory handed back to the fleet by putting this project to sleep. */
export function sleepSavingMb(tier: Tier): number {
  if (tier.sleepsAfterDays === undefined) return 0
  return tier.awakeRamMb - tier.asleepRamMb
}

/* ------------------------------------------------- more than one box */

/**
 * The bug that arrives with the second machine.
 *
 * `take()` holds its buckets in process memory, which is exactly right
 * for one box and quietly wrong for nine: N instances each enforcing a
 * limit of L admit N×L between them. At fifty thousand free projects
 * `fleet.ts` says nine boxes, so the 120-per-minute free quota becomes
 * 1,080 per minute — and nothing anywhere reports it, because every
 * box believes it is doing its job.
 *
 * This is stated in code rather than in a comment so a test can fail
 * when somebody scales the fleet without scaling the limiter.
 */
export function effectiveLimit(tier: Tier, boxes: number): number {
  return tier.quota.requestsPerMinute * Math.max(1, Math.floor(boxes))
}

/** Does this fleet still enforce the quota it advertises? */
export function limitIsHonest(tier: Tier, boxes: number): boolean {
  return effectiveLimit(tier, boxes) === tier.quota.requestsPerMinute
}

/**
 * The two-tier shape, for when it stops being honest.
 *
 * A local bucket in every box absorbs bursts with no network hop and
 * sheds obvious abuse; a global tier holds the exact quota. The local
 * limit is deliberately *more* permissive than the real one — its job
 * is to keep spikes off the global tier, not to be the limiter. Which
 * store backs the global tier is an implementation detail this
 * interface refuses to care about: Redis with an atomic script, or a
 * Durable Object per tenant at the edge.
 */
export type GlobalLimiter = {
  /** Spends against the cluster-wide quota. */
  take: (tenantId: string, cost: number, now: number) => Promise<Decision>
}

/** How much slack a per-box bucket gets before the global tier decides. */
export const LOCAL_SLACK = 2

/** The per-box bucket, sized as a backstop rather than as the quota. */
export function localBudget(tier: Tier, boxes: number): { perSecond: number; burst: number } {
  const share = Math.max(1, Math.floor(boxes))
  const budget = burstBudget(tier)
  return {
    perSecond: (budget.perSecond / share) * LOCAL_SLACK,
    burst: Math.ceil((budget.burst / share) * LOCAL_SLACK),
  }
}

/**
 * The two tiers, composed.
 *
 * Local first, because a request the local bucket can already refuse
 * should never cost a network hop. Global second, and only for
 * requests that got past it. The ordering is the whole optimisation:
 * under an attack the global tier sees a trickle rather than the
 * flood, which is also what keeps it affordable.
 *
 * Fail-open is deliberate and bounded. If the global tier is
 * unreachable the local bucket has already had its say, so the worst
 * case is the over-admission we started with — and the alternative,
 * failing closed, turns one coordination outage into a total outage
 * for every tenant at once. The decision records which tier decided,
 * so a dashboard can show when enforcement is degraded rather than
 * discovering it in a bill.
 */
export type TieredDecision = Decision & {
  decidedBy: 'local' | 'global' | 'degraded'
}

export function tieredLimiter(options: {
  tier: Tier
  boxes: number
  global?: GlobalLimiter
  /** Buckets for this box. Mutated in place; sweep it periodically. */
  buckets?: Map<string, Bucket>
}) {
  const buckets = options.buckets ?? new Map<string, Bucket>()
  const local: Tier = {
    ...options.tier,
    quota: { ...options.tier.quota, requestsPerMinute: localBudget(options.tier, options.boxes).burst * 2 },
  }

  return {
    buckets,
    take: async (tenantId: string, now: number = Date.now(), cost = 1): Promise<TieredDecision> => {
      const bucket = buckets.get(tenantId) ?? newBucket(local, now)
      const decision = take(local, bucket, now, cost)
      buckets.set(tenantId, decision.bucket)
      if (!decision.allowed) return { ...decision, decidedBy: 'local' }

      if (!options.global) {
        return { ...decision, decidedBy: limitIsHonest(options.tier, options.boxes) ? 'local' : 'degraded' }
      }

      try {
        const global = await options.global.take(tenantId, cost, now)
        return { ...global, bucket: decision.bucket, decidedBy: 'global' }
      } catch {
        // The global tier is down. The local bucket already decided,
        // and a coordination outage must not become a service outage.
        return { ...decision, decidedBy: 'degraded' }
      }
    },
  }
}
