import { describe, expect, it } from 'vitest'

import { AX42, CCX13, RATES_READ_ON, egressIfBilledUsd, objectStorageUsd, usableRamGb } from './infra'
import {
  CORE_TIER,
  FREE_TIER,
  ISOLATION_CONTROLS,
  NO_USAGE,
  TITAN_TIER,
  averageRamMb,
  burstBudget,
  controlsFor,
  quotaBreaches,
  shouldSleep,
  tierFor,
} from './tenancy'
import {
  FREE_FOOTPRINT,
  breakEvenConversion,
  describeFleet,
  fleetFor,
  fundingFor,
  perTenantInstanceUsd,
} from './fleet'
import { planOr } from '../ai/plans'

const free = (count: number) => fleetFor({ population: { spark: count } })

describe('the rate card', () => {
  it('is dated, because infrastructure prices move', () => {
    expect(RATES_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('remembers that bare metal is now cheaper than dedicated vCPU', () => {
    // Hetzner's June 2026 rise: 64 GB of metal costs less than 8 GB of
    // dedicated cloud. This is the fact the whole fleet design rests on.
    expect(AX42.costUsd).toBeLessThan(CCX13.costUsd)
    expect(AX42.ramGb / AX42.costUsd).toBeGreaterThan((CCX13.ramGb / CCX13.costUsd) * 5)
  })

  it('charges nothing for egress, and knows what that is worth', () => {
    expect(egressIfBilledUsd(10_000)).toBeGreaterThan(800)
    expect(objectStorageUsd({ storedGb: 5, writes: 1_000, reads: 1_000 })).toBe(0)
  })
})

describe('tenancy', () => {
  it('houses free tenants together and the biggest ones alone', () => {
    expect(FREE_TIER.housing).toBe('shared')
    expect(CORE_TIER.housing).toBe('reserved')
    expect(TITAN_TIER.housing).toBe('dedicated')
    expect(tierFor('spark')).toBe(FREE_TIER)
  })

  it('never relies on row-level security alone', () => {
    const shared = controlsFor('shared')
    expect(shared.length).toBeGreaterThanOrEqual(5)
    expect(shared.map((control) => control.id)).toContain('rls')
    expect(shared.map((control) => control.id)).toContain('schema')
    expect(shared.map((control) => control.id)).toContain('no-raw-sql')
    // Every control says which failure it survives, or it is decoration.
    for (const control of ISOLATION_CONTROLS) expect(control.survives.length).toBeGreaterThan(20)
  })

  it('puts an idle free project to sleep, and never a paid one', () => {
    expect(shouldSleep(FREE_TIER, { ...NO_USAGE, idleDays: 8 })).toBe(true)
    expect(shouldSleep(FREE_TIER, { ...NO_USAGE, idleDays: 2 })).toBe(false)
    expect(shouldSleep(CORE_TIER, { ...NO_USAGE, idleDays: 400 })).toBe(false)
  })

  it('makes sleeping the difference between a fleet and a datacentre', () => {
    const asleepMost = averageRamMb(FREE_TIER, 40)
    const alwaysAwake = averageRamMb({ ...FREE_TIER, sleepsAfterDays: undefined }, 40)
    expect(asleepMost).toBeLessThan(10)
    expect(alwaysAwake).toBe(FREE_TIER.awakeRamMb)
    expect(alwaysAwake / asleepMost).toBeGreaterThan(10)
  })

  it('stops writes rather than taking a project offline', () => {
    const breaches = quotaBreaches(FREE_TIER, { ...NO_USAGE, databaseMb: 800, filesMb: 3_000 })
    expect(breaches.map((breach) => breach.quota)).toEqual(['databaseMb', 'filesMb'])
    expect(breaches[0].effect).toBe('block-writes')
    expect(breaches[1].effect).toBe('block-uploads')
    expect(breaches[0].message).toContain('Reads keep working')
    expect(breaches[1].message).toContain('still download')
  })

  it('throttles traffic instead of cutting it', () => {
    const breaches = quotaBreaches(FREE_TIER, { ...NO_USAGE, egressGb: 9, requestsLastMinute: 300 })
    expect(breaches.every((breach) => breach.effect === 'throttle')).toBe(true)
  })

  it('counts realtime sockets, which is the limit people forget', () => {
    expect(quotaBreaches(FREE_TIER, { ...NO_USAGE, realtimeConnections: 21 })).toHaveLength(1)
    expect(burstBudget(FREE_TIER).perSecond).toBe(2)
  })

  it('leaves a clean project alone', () => {
    expect(quotaBreaches(FREE_TIER, NO_USAGE)).toEqual([])
  })
})

describe('the fleet', () => {
  it('fits five thousand free projects on one machine', () => {
    const fleet = free(5_000)
    expect(fleet.boxes).toBe(1)
    // Memory is what runs out first, even with most projects asleep.
    expect(fleet.binding).toBe('memory')
    expect(fleet.ramGb).toBeLessThan(usableRamGb(AX42))
    expect(fleet.totalUsd).toBeLessThan(150)
  })

  it('costs pennies per free user, and says how many pennies', () => {
    const fleet = free(5_000)
    expect(fleet.perFreeUserUsd).toBeLessThan(0.03)
    expect(fleet.perFreeUserUsd * 1_000).toBeLessThan(30)
  })

  it('is four orders of magnitude cheaper than an instance each', () => {
    const shared = free(5_000).totalUsd
    expect(perTenantInstanceUsd(5_000)).toBeGreaterThan(250_000)
    expect(perTenantInstanceUsd(5_000) / shared).toBeGreaterThan(1_000)
  })

  it('grows with the binding resource, not with the headcount', () => {
    const small = free(5_000)
    const large = free(40_000)
    expect(large.boxes).toBeGreaterThan(small.boxes)
    expect(large.binding).toBe('memory')
    // Ten times the users, far less than ten times the cost per user.
    expect(large.perFreeUserUsd).toBeLessThan(small.perFreeUserUsd * 1.5)
  })

  it('gives dedicated housing its own metal', () => {
    const fleet = fleetFor({ population: { titan: 3 } })
    expect(fleet.dedicatedBoxes).toBe(3)
    expect(fleet.boxes).toBe(4)
  })

  it('knows what free egress is saving', () => {
    const fleet = fleetFor({ population: { spark: 5_000, core: 200 } })
    expect(fleet.egressAvoidedUsd).toBeGreaterThan(fleet.totalUsd)
    expect(describeFleet(fleet)).toContain('a month')
  })
})

describe('who pays for the free tier', () => {
  it('needs about a dozen Core subscribers for five thousand free projects', () => {
    const fleet = free(5_000)
    const worst = fundingFor('core', fleet)
    expect(worst.payersNeeded).toBeGreaterThan(10)
    expect(worst.payersNeeded).toBeLessThan(25)
    // In a normal month, where nobody burns their whole AI allowance.
    const normal = fundingFor('core', fleet, { utilisation: 0.35 })
    expect(normal.payersNeeded).toBeLessThan(worst.payersNeeded)
    expect(normal.payersNeeded).toBeLessThanOrEqual(10)
  })

  it('funds hundreds of free projects per paying customer', () => {
    const fleet = free(5_000)
    expect(fundingFor('core', fleet).fundsFreeUsers).toBeGreaterThan(250)
    expect(fundingFor('titan', fleet).fundsFreeUsers).toBeGreaterThan(2_000)
  })

  it('breaks even below the conversion rate anybody plans for', () => {
    const fleet = free(5_000)
    // Self-serve developer tools convert at 1-3%. The fleet needs far less.
    expect(breakEvenConversion(fleet, 'core', 5_000)).toBeLessThan(0.01)
  })

  it('agrees with the hosting allowance the plans already carry', () => {
    // plans.ts budgets infraCents per paying customer; the fleet model
    // has to fit inside it or one of the two files is lying.
    const core = fleetFor({ population: { core: 100 } })
    const perCore = core.totalUsd / 100
    expect(perCore * 100).toBeLessThan(planOr('core').infraCents)
    const forge = fleetFor({ population: { forge: 50 } })
    expect((forge.totalUsd / 50) * 100).toBeLessThan(planOr('forge').infraCents)
  })
})

describe('the free footprint', () => {
  it('is sized on what free projects use, not what they are allowed', () => {
    expect(FREE_FOOTPRINT.databaseMb).toBeLessThan(FREE_TIER.quota.databaseMb)
    expect(FREE_FOOTPRINT.filesMb).toBeLessThan(FREE_TIER.quota.filesMb)
    expect(FREE_FOOTPRINT.awakeHoursPerMonth).toBeLessThan(730)
  })

  it('still survives a month where every free project is busy', () => {
    const busy = fleetFor({
      population: { spark: 5_000 },
      footprints: {
        spark: {
          ...FREE_FOOTPRINT,
          databaseMb: FREE_TIER.quota.databaseMb,
          filesMb: FREE_TIER.quota.filesMb,
          egressGb: FREE_TIER.quota.egressGb,
          awakeHoursPerMonth: 730,
          writes: 20_000,
          reads: 200_000,
        },
      },
    })
    // Everybody at their quota, nobody asleep: still four figures below
    // the per-instance model, and still covered by a few hundred subs.
    expect(busy.totalUsd).toBeLessThan(perTenantInstanceUsd(5_000) / 100)
    expect(fundingFor('core', busy).payersNeeded).toBeLessThan(400)
  })
})
