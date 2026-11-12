import { describe, expect, it } from 'vitest'

import { CORE_TIER, FREE_TIER, NO_USAGE, TITAN_TIER, burstBudget, type Usage } from './tenancy'
import { newBucket, sleepPlan, sleepSavingMb, sweepBuckets, take, wakeDeadlineMs } from './limiter'
import { CACHE_RULES, PLAUSIBLE_HIT_RATE, cacheable, describeOffload, offloadFor, ruleFor } from './offload'
import { CAPABILITIES, NUDGE_AT, nudgesFor, topNudge } from './upgrade'
import { FREE_FOOTPRINT, fleetFor } from './fleet'

const usage = (over: Partial<Usage>): Usage => ({ ...NO_USAGE, ...over })

describe('the rate limiter', () => {
  it('lets an honest burst through', () => {
    // 120/minute on the free tier: a client that fires sixty requests
    // at once is inside its quota and a fixed window would refuse it.
    const { burst } = burstBudget(FREE_TIER)
    let bucket = newBucket(FREE_TIER, 0)
    for (let i = 0; i < burst; i += 1) {
      const decision = take(FREE_TIER, bucket, 0)
      expect(decision.allowed).toBe(true)
      bucket = decision.bucket
    }
    expect(take(FREE_TIER, bucket, 0).allowed).toBe(false)
  })

  it('holds the sustained rate at the line', () => {
    let bucket: ReturnType<typeof newBucket> = { tokens: 0, updatedAt: 0 }
    // Two requests a second is exactly 120 a minute.
    for (let second = 1; second <= 30; second += 1) {
      const first = take(FREE_TIER, bucket, second * 1_000)
      bucket = first.bucket
      const next = take(FREE_TIER, bucket, second * 1_000)
      bucket = next.bucket
      expect(first.allowed).toBe(true)
      expect(next.allowed).toBe(true)
    }
    expect(take(FREE_TIER, bucket, 30_000).allowed).toBe(false)
  })

  it('says how long to wait instead of just saying no', () => {
    const refused = take(FREE_TIER, { tokens: 0, updatedAt: 0 }, 0)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBe(500)
    expect(refused.remaining).toBe(0)
    expect(refused.limit).toBe(burstBudget(FREE_TIER).burst)
  })

  it('refills continuously, so there is no scheduler to run', () => {
    const spent = take(FREE_TIER, { tokens: 0, updatedAt: 0 }, 10_000)
    expect(spent.allowed).toBe(true)
    // Ten seconds at two a second, capped at the burst.
    expect(spent.bucket.tokens).toBeCloseTo(19, 5)
  })

  it('forgets a tenant whose bucket has refilled', () => {
    const buckets = new Map([
      ['busy', { tokens: 1, updatedAt: 0 }],
      ['gone', { tokens: 59, updatedAt: 0 }],
    ])
    const kept = sweepBuckets(FREE_TIER, buckets, 1_000)
    expect([...kept.keys()]).toEqual(['busy'])
    expect([...sweepBuckets(FREE_TIER, buckets, 600_000).keys()]).toEqual([])
  })

  it('gives a bigger tenant a bigger bucket', () => {
    expect(burstBudget(CORE_TIER).burst).toBeGreaterThan(burstBudget(FREE_TIER).burst * 5)
  })
})

describe('the sleeper', () => {
  it('tells a free project what is about to happen to it', () => {
    const plan = sleepPlan(FREE_TIER, usage({ idleDays: 3 }))
    expect(plan.state).toBe('awake')
    expect(plan.daysUntilSleep).toBe(4)
    expect(plan.message).toContain('7 quiet days')
  })

  it('promises nothing is lost when it wakes', () => {
    const plan = sleepPlan(FREE_TIER, usage({ idleDays: 40 }))
    expect(plan.state).toBe('asleep')
    expect(plan.ramMb).toBe(FREE_TIER.asleepRamMb)
    expect(plan.message).toContain('nothing is lost')
    expect(plan.message).toContain('0.9s')
  })

  it('never sleeps a paid project', () => {
    const plan = sleepPlan(CORE_TIER, usage({ idleDays: 9_999 }))
    expect(plan.state).toBe('awake')
    expect(plan.daysUntilSleep).toBe(Number.POSITIVE_INFINITY)
    expect(plan.message).toContain('stays warm')
    expect(sleepSavingMb(CORE_TIER)).toBe(0)
  })

  it('queues a waking request rather than refusing it', () => {
    expect(wakeDeadlineMs(FREE_TIER)).toBeGreaterThanOrEqual(5_000)
    expect(wakeDeadlineMs(FREE_TIER)).toBeGreaterThan(FREE_TIER.wakeMs)
  })

  it('hands 88 MB back to the fleet per sleeping project', () => {
    expect(sleepSavingMb(FREE_TIER)).toBe(88)
  })
})

describe('pushing work to the client', () => {
  it('caches by who can change the row, not by how hot it is', () => {
    expect(ruleFor('reference')?.strategy).toBe('cache-first')
    expect(ruleFor('shared-rows')?.strategy).toBe('network-first')
    expect(ruleFor('own-rows')?.ttlSeconds).toBeGreaterThan(ruleFor('shared-rows')!.ttlSeconds)
  })

  it('never caches an authorisation', () => {
    expect(ruleFor('auth')?.strategy).toBe('never')
    expect(ruleFor('realtime')?.strategy).toBe('never')
    expect(cacheable().map((rule) => rule.id)).not.toContain('auth')
    for (const rule of CACHE_RULES) expect(rule.reason.length).toBeGreaterThan(20)
  })

  it('assumes a hit rate somebody has actually measured', () => {
    expect(PLAUSIBLE_HIT_RATE).toBeLessThanOrEqual(0.7)
    expect(PLAUSIBLE_HIT_RATE).toBeGreaterThanOrEqual(0.4)
  })

  it('saves real reads and a trivial amount of money', () => {
    const offload = offloadFor(FREE_FOOTPRINT, 5_000)
    const fleet = fleetFor({ population: { spark: 5_000 } })
    expect(offload.readsAvoided).toBe(15_000_000)
    expect(offload.savedUsd).toBeCloseTo(5.4, 2)
    // The honest headline: it is a few percent of the bill.
    expect(offload.savedUsd / fleet.totalUsd).toBeLessThan(0.1)
    expect(describeOffload(offload)).toContain('rounding error')
  })

  it('keeps fifteen thousand requests from waking a sleeping project', () => {
    expect(offloadFor(FREE_FOOTPRINT, 5_000).wakesAvoided).toBeGreaterThan(1_000_000)
  })

  it('credits nothing when the free allowance already covered it', () => {
    expect(offloadFor(FREE_FOOTPRINT, 10).savedUsd).toBe(0)
  })
})

describe('why somebody upgrades', () => {
  it('says nothing to a project that is fine', () => {
    expect(nudgesFor(FREE_TIER, usage({ databaseMb: 100, filesMb: 100 }))).toEqual([])
  })

  it('speaks up only once a limit is actually near', () => {
    expect(nudgesFor(FREE_TIER, usage({ databaseMb: 500 * (NUDGE_AT - 0.05) }))).toEqual([])
    const near = nudgesFor(FREE_TIER, usage({ databaseMb: 500 * NUDGE_AT }))
    expect(near).toHaveLength(1)
    expect(near[0].trigger).toBe('database')
  })

  it('names the capability, never the punishment', () => {
    const nudges = nudgesFor(
      FREE_TIER,
      usage({ databaseMb: 480, filesMb: 2_000, egressGb: 4.9, realtimeConnections: 19 }),
    )
    expect(nudges.length).toBeGreaterThan(3)
    for (const nudge of nudges) {
      expect(nudge.capability.length).toBeGreaterThan(3)
      expect(nudge.plan).toBe('core')
      expect(nudge.message).not.toMatch(/delet|lost|suspend|lock|penalt/i)
      expect(nudge.message).toContain('Core')
    }
  })

  it('puts the tightest limit first', () => {
    const nudges = nudgesFor(FREE_TIER, usage({ databaseMb: 420, filesMb: 2_040 }))
    expect(nudges[0].trigger).toBe('storage')
    expect(topNudge(FREE_TIER, usage({ databaseMb: 420, filesMb: 2_040 }))?.trigger).toBe('storage')
  })

  it('treats the cold start as the most honest upgrade there is', () => {
    const nudge = topNudge(FREE_TIER, usage({ idleDays: 10 }))
    expect(nudge?.trigger).toBe('cold-start')
    expect(nudge?.capability).toBe('no cold start')
    expect(nudge?.message).toContain('stay warm')
  })

  it('counts seats, which are a capability rather than a quota', () => {
    const nudge = topNudge(FREE_TIER, NO_USAGE, { seatsWanted: 3 })
    expect(nudge?.trigger).toBe('seats')
    expect(nudge?.message).toContain('1 seat')
    // Core also has one seat, so the nudge has to skip it.
    expect(nudge?.plan).toBe('forge')
    expect(nudge?.capability).toBe('5 seats')
  })

  it('has nothing to sell the top plan', () => {
    expect(nudgesFor(TITAN_TIER, usage({ databaseMb: 262_144, idleDays: 900 }))).toEqual([])
  })

  it('describes every plan as things you can do', () => {
    for (const [plan, lines] of Object.entries(CAPABILITIES)) {
      expect(lines.length).toBeGreaterThanOrEqual(3)
      for (const line of lines) expect(line.length).toBeGreaterThan(10)
      expect(plan).toBeTruthy()
    }
    expect(CAPABILITIES.core).toContain('Projects stay warm — no cold start, ever')
  })
})
