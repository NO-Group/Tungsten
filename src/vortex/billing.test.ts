import { describe, expect, it } from 'vitest'

import {
  DUNNING,
  MINIMUM_INVOICE_USD,
  OVERAGE,
  REJECTED_CONTROLS,
  SPEND_CAP_USD,
  VERIFICATION,
  capCheck,
  dunningStage,
  freeStorageSpec,
  losesMoneyBelowUsd,
  marginOf,
  overageCostUsd,
  overageUsd,
  processingUsd,
  shouldInvoice,
  stillServing,
  verificationBillUsd,
  verificationCostUsd,
} from './billing'
import { R2 } from './infra'
import { FREE_TIER, NO_USAGE, quotaBreaches } from './tenancy'
import { fleetFor } from './fleet'
import {
  GlobalLimiter,
  localBudget,
  newBucket,
  take,
  tieredLimiter,
} from './limiter'

describe('verifying a card without paying for the privilege', () => {
  it('knows a refunded pre-auth is not a free pre-auth', () => {
    // Stripe has not returned processing fees on refunds since 2019.
    expect(verificationCostUsd('micro-charge', 1)).toBeCloseTo(0.329, 3)
    expect(verificationCostUsd('zero-amount-auth')).toBe(0)
  })

  it('prices the pre-auth idea against the fleet it would protect', () => {
    const bill = verificationBillUsd('micro-charge', 5_000)
    const fleet = fleetFor({ population: { spark: 5_000 } })
    expect(bill).toBeGreaterThan(1_400)
    // Fourteen times the cost of the thing it is defending.
    expect(bill / fleet.totalUsd).toBeGreaterThan(10)
    expect(verificationBillUsd('zero-amount-auth', 5_000)).toBe(0)
  })

  it('asks for the card when somebody wants to spend, not when they arrive', () => {
    expect(VERIFICATION.requiredAt).toBe('first-overage')
    expect(VERIFICATION.method).toBe('zero-amount-auth')
    expect(VERIFICATION.why).toContain('$0.015')
  })

  it('writes down the controls that are worse than the problem', () => {
    const ids = REJECTED_CONTROLS.map((entry) => entry.id)
    expect(ids).toContain('bin-blocking')
    expect(ids).toContain('micro-charge')
    expect(ids).toContain('delete-on-failure')
    for (const entry of REJECTED_CONTROLS) expect(entry.why.length).toBeGreaterThan(60)
  })
})

describe('overage, priced honestly', () => {
  it('doubles wholesale and passes egress through at zero', () => {
    expect(OVERAGE.storagePerGbMonthUsd).toBe(R2.storagePerGbMonthUsd * 2)
    expect(OVERAGE.egressPerGbUsd).toBe(0)
  })

  it('reproduces the headline margin, then the real one', () => {
    // The light-overage case: +10 GB, +50k writes, +500k reads.
    const light = marginOf({ storageGb: 10, writes: 50_000, reads: 500_000 })
    // $1.11, not the $1.12 a rate card gets by rounding reads up to
    // $0.75/M to make the margin read 52%. Clean 2x, stated as 2x.
    expect(light.revenueUsd).toBeCloseTo(1.11, 2)
    expect(light.headlineMargin).toBeCloseTo(0.5, 2)
    // A fixed 30c does not care how small the invoice is.
    expect(light.margin).toBeLessThan(0.25)
  })

  it('shows the fee mattering less as the invoice grows', () => {
    const medium = marginOf({ storageGb: 100, writes: 500_000, reads: 5_000_000 })
    const heavy = marginOf({ storageGb: 1_000, writes: 5_000_000, reads: 50_000_000 })
    const light = marginOf({ storageGb: 10, writes: 50_000, reads: 500_000 })
    expect(medium.margin).toBeGreaterThan(light.margin)
    expect(heavy.margin).toBeGreaterThan(medium.margin)
    expect(heavy.margin).toBeLessThan(heavy.headlineMargin)
  })

  it('always clears its own wholesale cost', () => {
    for (const over of [
      { storageGb: 1, writes: 0, reads: 0 },
      { storageGb: 0, writes: 1_000_000, reads: 0 },
      { storageGb: 0, writes: 0, reads: 10_000_000 },
    ]) {
      expect(overageUsd(over)).toBeGreaterThanOrEqual(overageCostUsd(over) * 2 - 0.0001)
    }
  })

  it('charges nothing for nothing', () => {
    expect(overageUsd({ storageGb: 0, writes: 0, reads: 0 })).toBe(0)
    expect(marginOf({ storageGb: 0, writes: 0, reads: 0 }).margin).toBe(0)
  })
})

describe('when to actually put it on a card', () => {
  it('knows the invoice below which the fee eats everything', () => {
    expect(losesMoneyBelowUsd()).toBeCloseTo(0.309, 3)
    expect(processingUsd(0.15)).toBeGreaterThan(0.15)
  })

  it('rolls a fifteen-cent balance forward instead of destroying it', () => {
    const decision = shouldInvoice(0.15)
    expect(decision.charge).toBe(false)
    expect(decision.rollForwardUsd).toBeCloseTo(0.15, 5)
    expect(decision.reason).toContain('%')
  })

  it('charges once the balance is worth collecting', () => {
    expect(shouldInvoice(MINIMUM_INVOICE_USD).charge).toBe(true)
    expect(shouldInvoice(12.4).amountUsd).toBeCloseTo(12.4, 5)
  })

  it('settles small balances at the quarter rather than carrying them forever', () => {
    expect(shouldInvoice(1.2, { endOfQuarter: true }).charge).toBe(true)
    expect(shouldInvoice(0, { endOfQuarter: true }).charge).toBe(false)
  })
})

describe('the spending cap', () => {
  it('is on by default and low by default', () => {
    expect(SPEND_CAP_USD.spark).toBe(0)
    expect(SPEND_CAP_USD.core).toBe(20)
    expect(SPEND_CAP_USD.core).toBeLessThan(SPEND_CAP_USD.forge)
  })

  it('stops a free project from spending anything at all', () => {
    expect(capCheck('spark', 0.01).stop).toBe(true)
  })

  it('pauses writes without taking the project down', () => {
    const hit = capCheck('core', 20)
    expect(hit.stop).toBe(true)
    expect(hit.message).toContain('keeps serving')
    expect(hit.message).not.toMatch(/delet|lost/i)
  })

  it('lets somebody who means it raise the limit', () => {
    expect(capCheck('core', 150, 500).stop).toBe(false)
    expect(capCheck('core', 150, 500).pressure).toBeCloseTo(0.3, 5)
  })
})

describe('when a real card stops working', () => {
  it('warns before it does anything', () => {
    expect(dunningStage(1).id).toBe('current')
    expect(dunningStage(72).id).toBe('grace')
    expect(dunningStage(73).writes).toBe(true)
  })

  it('freezes writes after a week, and keeps serving reads', () => {
    const frozen = dunningStage(200)
    expect(frozen.id).toBe('frozen')
    expect(frozen.writes).toBe(false)
    expect(stillServing(frozen)).toBe(true)
    expect(frozen.message).toContain('every byte is still here')
  })

  it('archives after ninety days and still does not delete', () => {
    const archived = dunningStage(5_000)
    expect(archived.id).toBe('archived')
    expect(archived.message).toContain('Nothing is deleted')
  })

  it('never threatens deletion at any stage', () => {
    for (const stage of DUNNING) {
      expect(stage.message).not.toMatch(/will be deleted|permanently remov|wiped/i)
    }
  })
})

describe('the free storage spec', () => {
  it('gives twice the indie standard, and caps the operations too', () => {
    const spec = freeStorageSpec()
    expect(spec.storageGb).toBe(2)
    expect(spec.writesPerMonth).toBe(10_000)
    expect(spec.readsPerMonth).toBe(100_000)
    expect(spec.maxUploadMb).toBe(50)
    expect(spec.egress).toContain('free')
  })

  it('meters operations, which cost more than the storage does', () => {
    // At 1,000 active free users the request bill beats the storage bill.
    const storage = 1_000 * 1.2 * R2.storagePerGbMonthUsd
    const operations =
      (1_000 * 10_000) / 1_000_000 * R2.classAPerMillionUsd +
      (1_000 * 100_000) / 1_000_000 * R2.classBPerMillionUsd
    expect(operations).toBeGreaterThan(storage)
  })

  it('blocks uploads rather than the project when the write quota goes', () => {
    const breaches = quotaBreaches(FREE_TIER, { ...NO_USAGE, writesThisMonth: 10_001, readsThisMonth: 100_001 })
    expect(breaches.map((breach) => breach.quota)).toEqual(['writesPerMonth', 'readsPerMonth'])
    expect(breaches[0].effect).toBe('block-uploads')
    expect(breaches[1].effect).toBe('throttle')
    expect(breaches[0].message).toContain('still download')
  })
})

describe('the two-tier limiter, adopted', () => {
  const tenant = 'tenant-1'

  it('refuses locally without paying for a network hop', async () => {
    let globalCalls = 0
    const global: GlobalLimiter = {
      take: async (_id, _cost, now) => {
        globalCalls += 1
        return take(FREE_TIER, newBucket(FREE_TIER, now), now)
      },
    }
    const limiter = tieredLimiter({ tier: FREE_TIER, boxes: 9, global })
    const budget = localBudget(FREE_TIER, 9)

    let refused = 0
    for (let i = 0; i < budget.burst * 4; i += 1) {
      const decision = await limiter.take(tenant, 0)
      if (!decision.allowed) refused += 1
    }
    expect(refused).toBeGreaterThan(0)
    // The global tier only saw the requests that got past the bucket.
    expect(globalCalls).toBeLessThan(budget.burst * 4)
  })

  it('lets the global tier have the final word', async () => {
    const global: GlobalLimiter = {
      take: async () => ({ allowed: false, bucket: { tokens: 0, updatedAt: 0 }, retryAfterMs: 400, remaining: 0, limit: 1 }),
    }
    const limiter = tieredLimiter({ tier: FREE_TIER, boxes: 9, global })
    const decision = await limiter.take(tenant, 0)
    expect(decision.allowed).toBe(false)
    expect(decision.decidedBy).toBe('global')
    expect(decision.retryAfterMs).toBe(400)
  })

  it('fails open when coordination is down, and says so', async () => {
    const global: GlobalLimiter = { take: async () => { throw new Error('redis unreachable') } }
    const limiter = tieredLimiter({ tier: FREE_TIER, boxes: 9, global })
    const decision = await limiter.take(tenant, 0)
    expect(decision.allowed).toBe(true)
    // Degraded, not silently fine: a dashboard can show this.
    expect(decision.decidedBy).toBe('degraded')
  })

  it('reports a multi-box fleet with no global tier as degraded', async () => {
    const limiter = tieredLimiter({ tier: FREE_TIER, boxes: 9 })
    expect((await limiter.take(tenant, 0)).decidedBy).toBe('degraded')
  })

  it('needs none of this on one box', async () => {
    const limiter = tieredLimiter({ tier: FREE_TIER, boxes: 1 })
    const decision = await limiter.take(tenant, 0)
    expect(decision.allowed).toBe(true)
    expect(decision.decidedBy).toBe('local')
  })
})
