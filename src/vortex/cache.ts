/**
 * Should Vortex run Redis?
 *
 * The reflex answer is yes, because Redis is fast and caches make
 * things faster. The reflex is wrong often enough to be worth doing
 * the arithmetic, and this file is the arithmetic.
 *
 * Three facts about *this* architecture decide it:
 *
 * 1. **The fleet is memory-bound.** `fleet.ts` says so: at every
 *    population the binding constraint is RAM, not disk and not
 *    traffic. Redis is a RAM-resident database. Adding one to a
 *    memory-bound fleet to make it faster is adding passengers to make
 *    the car lighter — `displacedBy()` prices exactly how many free
 *    tenants each gigabyte costs.
 *
 * 2. **A cache only pays above a break-even hit rate**, and that rate
 *    is much higher than people assume. On a hit you still pay the
 *    cache round trip; on a miss you pay it *and* the database *and*
 *    the write-back. `breakEvenHitRate()` works it out, and for a
 *    primary-key lookup against a table already resident in memory the
 *    answer lands near 80% — above the 60% that application caches
 *    actually measure.
 *
 * 3. **The real latency in Vortex is not query time.** A sleeping
 *    tenant wakes in ~900 ms. That is six thousand times the saving a
 *    perfect cache could offer on a warm read. Optimising the 0.15 ms
 *    while the 900 ms stands is motion, not progress.
 *
 * None of which means never. Redis has two jobs here that nothing else
 * does as well, and both of them are about **correctness across
 * boxes**, not speed: see `CACHE_VERDICTS`.
 */

import { AX42, type Machine } from './infra'
import { FREE_TIER, averageRamMb } from './tenancy'

/**
 * Round-trip latencies, in microseconds.
 *
 * Order-of-magnitude figures from published 2026 benchmarks, not
 * measurements of a Vortex that does not exist yet. They are here so
 * the comparison is explicit and can be corrected, rather than
 * implicit in somebody's intuition.
 */
export const LATENCY_US = {
  /** Redis GET over loopback on the same box. */
  redisLoopback: 250,
  /** Redis GET to a managed instance in the same region. */
  redisSameRegion: 800,
  /** Redis p99. Flat, because it does no planning, locking or MVCC. */
  redisP99: 950,
  /** A primary-key lookup against a table resident in shared_buffers. */
  postgresWarm: 1_200,
  /** The same query at p99: WAL flushes, checkpointer stalls, buffer locks. */
  postgresWarmP99: 18_600,
  /** The same query when the page has to come off NVMe. */
  postgresCold: 5_000,
  /** A read the device already had. It never leaves the machine. */
  clientCache: 0,
  /** Waking a sleeping free tenant. The number that actually matters. */
  coldStart: 900_000,
} as const

/* ------------------------------------------------- is a cache worth it */

export type CacheMaths = {
  hitRate: number
  /** Expected latency with the cache in front. */
  cachedUs: number
  /** Expected latency without it. */
  uncachedUs: number
  /** Positive means the cache helps. Negative means it is making things worse. */
  savedUs: number
  worth: boolean
  /** The hit rate at which the cache stops losing money. */
  breakEven: number
}

/**
 * The hit rate a cache must beat to be worth having.
 *
 * On a hit you pay the cache. On a miss you pay the cache, then the
 * database, then the write-back. Setting that equal to the uncached
 * cost and solving for the hit rate gives `(cache + writeBack) /
 * (database + writeBack)` — which is the single most useful number in
 * this file and the one almost nobody computes before installing
 * Redis.
 */
export function breakEvenHitRate(input: { cacheUs: number; databaseUs: number; writeBackUs?: number }): number {
  const writeBack = input.writeBackUs ?? input.cacheUs
  const denominator = input.databaseUs + writeBack
  if (denominator <= 0) return 1
  return Math.min(1, (input.cacheUs + writeBack) / denominator)
}

/** Expected latency with and without a cache, at a given hit rate. */
export function cacheMaths(input: {
  hitRate: number
  cacheUs: number
  databaseUs: number
  writeBackUs?: number
}): CacheMaths {
  const hitRate = Math.min(1, Math.max(0, input.hitRate))
  const writeBack = input.writeBackUs ?? input.cacheUs
  const cachedUs = hitRate * input.cacheUs + (1 - hitRate) * (input.cacheUs + input.databaseUs + writeBack)
  const savedUs = input.databaseUs - cachedUs
  return {
    hitRate,
    cachedUs,
    uncachedUs: input.databaseUs,
    savedUs,
    worth: savedUs > 0,
    breakEven: breakEvenHitRate(input),
  }
}

/* --------------------------------------------- what the RAM would cost */

export type Displacement = {
  redisGb: number
  /** Free tenants that gigabyte could have housed instead. */
  tenantsDisplaced: number
  /** Extra machines needed to put them back. */
  extraBoxes: number
  extraUsdPerMonth: number
}

/**
 * What a Redis tier costs a memory-bound fleet.
 *
 * Not in dollars for the Redis process — it is free software on a box
 * we already rent. In tenants: the fleet's binding constraint is
 * memory, so every gigabyte handed to a cache is a gigabyte not
 * holding somebody's project.
 */
export function displacedBy(redisGb: number, machine: Machine = AX42): Displacement {
  const perTenantMb = averageRamMb(FREE_TIER, 40)
  const tenantsDisplaced = Math.round((redisGb * 1024) / perTenantMb)
  const usableGb = machine.ramGb * 0.7 - 6
  const extraBoxes = Math.ceil(redisGb / usableGb)
  return {
    redisGb,
    tenantsDisplaced,
    extraBoxes,
    extraUsdPerMonth: extraBoxes * machine.costUsd,
  }
}

/* ------------------------------------------------------- the decisions */

export type Verdict =
  /** Postgres already holds this in memory. A second copy is a slower copy. */
  | 'already-cached'
  /** Real need, better answered by something we are already paying for. */
  | 'cheaper-elsewhere'
  /** Redis, or something exactly like it, earns its place. */
  | 'worth-it'
  /** Caching this is a correctness bug, not a performance decision. */
  | 'never'

export type CacheJob = {
  id: string
  job: string
  verdict: Verdict
  why: string
  /** What to do instead. Required whenever the verdict is not `worth-it`. */
  instead?: string
}

/**
 * Every job a cache tier is usually bought for, judged one at a time.
 *
 * The pattern that emerges: where Redis wins, it wins on **shared
 * state across boxes**, not on speed. A single-box Vortex needs none
 * of it. A nine-box Vortex — which `fleet.ts` reaches at fifty
 * thousand free projects — needs two of them, and needs them for
 * correctness.
 */
export const CACHE_VERDICTS: CacheJob[] = [
  {
    id: 'rows',
    job: 'Caching tenant rows in front of Postgres',
    verdict: 'already-cached',
    why:
      'A free tenant’s entire database is 120 MB and the box has 64 GB. ' +
      'Postgres is already holding it in shared_buffers, and it evicts more ' +
      'cleverly than a TTL does. At a measured 60% hit rate the round trip ' +
      'costs more than the query it replaces.',
    instead: 'Give the RAM to shared_buffers and the page cache, where it is already working.',
  },
  {
    id: 'sessions',
    job: 'Session and token lookup',
    verdict: 'never',
    why: 'A cached authorisation is a revocation that did not happen.',
    instead: 'Identity-only JWTs with a short life, and entitlements read server-side.',
  },
  {
    id: 'rate-limit',
    job: 'Rate limiting across more than one box',
    verdict: 'cheaper-elsewhere',
    why:
      'Real and not optional: N boxes each enforcing a limit of L admit N×L ' +
      'between them, so the 120/minute free quota silently becomes 1,080/minute ' +
      'across nine boxes. But the decision belongs at the edge, before the ' +
      'request has crossed the network at all.',
    instead:
      'A Durable Object per tenant on the Cloudflare Workers plan already in the fixed costs — ' +
      'it holds the bucket, it is strongly consistent, and a throttled request never reaches the fleet.',
  },
  {
    id: 'fanout',
    job: 'Realtime fan-out between subscribers on different boxes',
    verdict: 'cheaper-elsewhere',
    why:
      'Postgres LISTEN/NOTIFY does not cross clusters and caps payloads at 8 kB, ' +
      'so at multiple boxes this is a genuine gap.',
    instead:
      'Pin a tenant’s sockets to the box its schema lives on. One tenant is already one box; ' +
      'fan-out only needs to cross machines once that stops being true.',
  },
  {
    id: 'wake-table',
    job: 'The routing table of which tenant is awake, and where',
    verdict: 'cheaper-elsewhere',
    why: 'Five thousand rows, read once per cold request, next to a 900 ms wake.',
    instead: 'A table in the control-plane database every box already has a connection to.',
  },
  {
    id: 'queue',
    job: 'Background jobs: backups, migrations, wake-ups',
    verdict: 'cheaper-elsewhere',
    why: 'A queue wants durability, and a second durability story is a second thing to lose.',
    instead: 'SELECT ... FOR UPDATE SKIP LOCKED, which is genuinely good and already transactional.',
  },
  {
    id: 'counters',
    job: 'Per-tenant usage counters feeding the quota checks',
    verdict: 'worth-it',
    why:
      'High-frequency integer increments on every request are the one workload Postgres ' +
      'is actively bad at: each one is a row version, and the vacuum bill lands on every ' +
      'tenant sharing the box. This is the job Redis was designed for.',
  },
  {
    id: 'tail',
    job: 'Flattening the p99 on a shared box under write load',
    verdict: 'worth-it',
    why:
      'A warm Postgres read is ~1.2 ms at p50 but can reach ~19 ms at p99 when WAL flushes, ' +
      'the checkpointer and buffer-header contention collide. Redis has no planner, no MVCC ' +
      'and no vacuum, so its p99 stays under a millisecond. On a box shared by thousands of ' +
      'tenants, one tenant’s write storm becomes everyone’s tail.',
  },
]

export function verdictFor(id: string): CacheJob | undefined {
  return CACHE_VERDICTS.find((entry) => entry.id === id)
}

/** The jobs that actually justify a cache tier. */
export function justifiesCache(): CacheJob[] {
  return CACHE_VERDICTS.filter((entry) => entry.verdict === 'worth-it')
}

/**
 * The summary, in one line.
 *
 * Phrased as "not yet, and here is the trigger" rather than "no",
 * because the answer genuinely changes the day the fleet stops fitting
 * on one machine.
 */
export function describeCacheDecision(boxes: number): string {
  const jobs = justifiesCache().length
  if (boxes <= 1) {
    return `One box: no cache tier. Postgres already holds every free tenant in RAM, and the ${LATENCY_US.coldStart / 1000}ms cold start dwarfs anything a cache could save.`
  }
  return `${boxes} boxes: ${jobs} job${jobs === 1 ? '' : 's'} now justify a cache tier, and both are about correctness across machines rather than speed.`
}

/**
 * How much faster a perfect cache could make a warm read, against the
 * cold start standing next to it. The ratio is the argument.
 */
export function coldStartDominance(): number {
  return LATENCY_US.coldStart / LATENCY_US.postgresWarm
}
