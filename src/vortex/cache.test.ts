import { describe, expect, it } from 'vitest'

import {
  CACHE_VERDICTS,
  LATENCY_US,
  breakEvenHitRate,
  cacheMaths,
  coldStartDominance,
  describeCacheDecision,
  displacedBy,
  justifiesCache,
  verdictFor,
} from './cache'
import { PLAUSIBLE_HIT_RATE } from './offload'
import { FREE_TIER, burstBudget } from './tenancy'
import { LOCAL_SLACK, effectiveLimit, limitIsHonest, localBudget } from './limiter'
import { fleetFor } from './fleet'

describe('whether a cache pays for itself', () => {
  it('needs a far higher hit rate than anybody assumes', () => {
    const breakEven = breakEvenHitRate({
      cacheUs: LATENCY_US.redisSameRegion,
      databaseUs: LATENCY_US.postgresWarm,
    })
    // 80%, against the 60% application caches actually measure.
    expect(breakEven).toBeCloseTo(0.8, 2)
    expect(breakEven).toBeGreaterThan(PLAUSIBLE_HIT_RATE)
  })

  it('loses at the hit rate we are honest enough to assume', () => {
    const maths = cacheMaths({
      hitRate: PLAUSIBLE_HIT_RATE,
      cacheUs: LATENCY_US.redisSameRegion,
      databaseUs: LATENCY_US.postgresWarm,
    })
    expect(maths.worth).toBe(false)
    expect(maths.savedUs).toBeLessThan(0)
    expect(maths.cachedUs).toBeGreaterThan(maths.uncachedUs)
  })

  it('wins once the hit rate clears the break-even', () => {
    const maths = cacheMaths({
      hitRate: 0.95,
      cacheUs: LATENCY_US.redisSameRegion,
      databaseUs: LATENCY_US.postgresWarm,
    })
    expect(maths.worth).toBe(true)
    expect(maths.savedUs).toBeGreaterThan(0)
  })

  it('wins easily when the thing it replaces is slow', () => {
    // A cold page off NVMe is a different proposition from a warm one.
    const cold = cacheMaths({
      hitRate: PLAUSIBLE_HIT_RATE,
      cacheUs: LATENCY_US.redisLoopback,
      databaseUs: LATENCY_US.postgresCold,
    })
    expect(cold.worth).toBe(true)
    expect(cold.breakEven).toBeLessThan(PLAUSIBLE_HIT_RATE)
  })

  it('admits that a cache on the same box would actually be faster', () => {
    // The honest nuance, kept in a test so nobody can quote the "no"
    // without it: Redis over loopback is ~250us against a ~1.2ms warm
    // query, which breaks even at a 35% hit rate and therefore wins.
    // It loses this argument on RAM, not on speed.
    const sameBox = cacheMaths({
      hitRate: PLAUSIBLE_HIT_RATE,
      cacheUs: LATENCY_US.redisLoopback,
      databaseUs: LATENCY_US.postgresWarm,
    })
    expect(sameBox.breakEven).toBeLessThan(PLAUSIBLE_HIT_RATE)
    expect(sameBox.worth).toBe(true)
    // And then it costs a thousand free projects to run.
    expect(displacedBy(8).tenantsDisplaced).toBeGreaterThan(1_000)
  })

  it('never claims a perfect cache is free', () => {
    const perfect = cacheMaths({
      hitRate: 1,
      cacheUs: LATENCY_US.redisSameRegion,
      databaseUs: LATENCY_US.postgresWarm,
    })
    expect(perfect.cachedUs).toBe(LATENCY_US.redisSameRegion)
    expect(perfect.savedUs).toBeGreaterThan(0)
  })
})

describe('what the RAM would cost', () => {
  it('prices a cache tier in tenants, because memory is the binding resource', () => {
    expect(fleetFor({ population: { spark: 5_000 } }).binding).toBe('memory')
    const eight = displacedBy(8)
    expect(eight.tenantsDisplaced).toBeGreaterThan(1_000)
    expect(eight.extraBoxes).toBe(1)
    expect(eight.extraUsdPerMonth).toBe(49)
  })

  it('costs about 150 free projects per gigabyte', () => {
    const one = displacedBy(1)
    expect(one.tenantsDisplaced).toBeGreaterThan(130)
    expect(one.tenantsDisplaced).toBeLessThan(170)
  })

  it('scales the way an unwelcome cost does', () => {
    expect(displacedBy(64).extraBoxes).toBeGreaterThan(displacedBy(8).extraBoxes)
  })
})

describe('the cold start dwarfs all of it', () => {
  it('is three orders of magnitude bigger than the saving', () => {
    expect(coldStartDominance()).toBeGreaterThan(500)
    expect(LATENCY_US.coldStart).toBeGreaterThan(LATENCY_US.postgresWarmP99 * 40)
  })

  it('is what the one-box answer actually says', () => {
    expect(describeCacheDecision(1)).toContain('no cache tier')
    expect(describeCacheDecision(1)).toContain('900ms cold start')
  })
})

describe('the verdicts', () => {
  it('judges each job separately rather than buying a cache wholesale', () => {
    expect(CACHE_VERDICTS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(CACHE_VERDICTS.map((entry) => entry.verdict)).size).toBeGreaterThan(2)
  })

  it('always names an alternative when the answer is no', () => {
    for (const entry of CACHE_VERDICTS) {
      if (entry.verdict === 'worth-it') continue
      expect(entry.instead, entry.id).toBeTruthy()
      expect(entry.instead!.length).toBeGreaterThan(20)
    }
  })

  it('refuses to cache an authorisation at any hit rate', () => {
    expect(verdictFor('sessions')?.verdict).toBe('never')
    expect(verdictFor('sessions')?.why).toContain('revocation')
  })

  it('will not put a second copy of what Postgres already holds', () => {
    expect(verdictFor('rows')?.verdict).toBe('already-cached')
  })

  it('sends rate limiting to the edge rather than to Redis', () => {
    const limit = verdictFor('rate-limit')
    expect(limit?.verdict).toBe('cheaper-elsewhere')
    expect(limit?.instead).toContain('Durable Object')
  })

  it('keeps the two jobs a cache genuinely wins', () => {
    const worth = justifiesCache().map((entry) => entry.id)
    expect(worth).toContain('counters')
    expect(worth).toContain('tail')
    expect(worth).not.toContain('rows')
  })

  it('changes its answer when the fleet grows', () => {
    expect(describeCacheDecision(9)).toContain('correctness')
    expect(describeCacheDecision(9)).not.toContain('no cache tier')
  })
})

describe('the limiter stops being honest at the second box', () => {
  it('admits N times the quota across N boxes', () => {
    expect(effectiveLimit(FREE_TIER, 1)).toBe(120)
    expect(effectiveLimit(FREE_TIER, 9)).toBe(1_080)
    expect(limitIsHonest(FREE_TIER, 1)).toBe(true)
    expect(limitIsHonest(FREE_TIER, 9)).toBe(false)
  })

  it('is a bug the fleet model predicts rather than a hypothetical', () => {
    const big = fleetFor({ population: { spark: 50_000 } })
    expect(big.boxes).toBeGreaterThan(1)
    expect(limitIsHonest(FREE_TIER, big.boxes)).toBe(false)
  })

  it('sizes the per-box bucket as a backstop, not as the quota', () => {
    const local = localBudget(FREE_TIER, 9)
    const whole = burstBudget(FREE_TIER)
    // Generous enough to absorb a burst without a network hop...
    expect(local.perSecond).toBeGreaterThan(whole.perSecond / 9)
    // ...and still far below the quota it is a backstop for.
    expect(local.perSecond * 9).toBeGreaterThan(whole.perSecond)
    expect(local.perSecond).toBeLessThan(whole.perSecond)
    expect(LOCAL_SLACK).toBeGreaterThan(1)
  })

  it('leaves a single box exactly as it was', () => {
    expect(localBudget(FREE_TIER, 1).perSecond).toBe(burstBudget(FREE_TIER).perSecond * LOCAL_SLACK)
  })
})
