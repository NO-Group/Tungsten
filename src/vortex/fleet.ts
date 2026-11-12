/**
 * The fleet, costed.
 *
 * Given how many tenants of each kind exist, this works out how many
 * machines that needs, what the month costs, which resource forced
 * the purchase, and how many paying customers it takes to fund the
 * free ones. It is a model, not a prophecy — but a wrong model you can
 * read beats a confident number you cannot.
 *
 * Two deliberate choices in the arithmetic:
 *
 * 1. **Cost is attributed by the binding constraint.** If disk is what
 *    forces another box, the box is split by disk; if memory is, by
 *    memory. You pay for the thing that made you buy it.
 * 2. **Averages are usage, not quota.** A free tenant is allowed 500 MB
 *    and typically uses a tenth of that, and sizing a fleet by quota
 *    is how people conclude a free tier is impossible when it is
 *    merely careful.
 */

import { economicsOf, planOr, type PlanId } from '../ai/plans'
import {
  AX42,
  CCX13,
  egressIfBilledUsd,
  fixedMonthlyUsd,
  objectStorageUsd,
  usableDiskGb,
  usableRamGb,
  type Machine,
} from './infra'
import { averageRamMb, tierFor, type Tier } from './tenancy'

/** What one tenant of a kind actually consumes in a month. */
export type Footprint = {
  tier: Tier
  /** Rows and indexes on the box, in MB. */
  databaseMb: number
  /** Objects in R2, in MB. */
  filesMb: number
  egressGb: number
  /** R2 Class A operations: uploads, copies, lists. */
  writes: number
  /** R2 Class B operations: downloads, heads. */
  reads: number
  /** Hours a month the project is awake. Free ones are mostly asleep. */
  awakeHoursPerMonth: number
}

/**
 * A free project, measured the way free projects actually behave:
 * built in an evening, visited a few times, then left alone until the
 * sleeper puts it on disk.
 */
export const FREE_FOOTPRINT: Footprint = {
  tier: tierFor('spark'),
  databaseMb: 120,
  filesMb: 200,
  egressGb: 2,
  writes: 500,
  reads: 5_000,
  awakeHoursPerMonth: 40,
}

export const CORE_FOOTPRINT: Footprint = {
  tier: tierFor('core'),
  databaseMb: 1_500,
  filesMb: 6_000,
  egressGb: 40,
  writes: 20_000,
  reads: 400_000,
  awakeHoursPerMonth: 730,
}

export const FORGE_FOOTPRINT: Footprint = {
  tier: tierFor('forge'),
  databaseMb: 6_000,
  filesMb: 30_000,
  egressGb: 200,
  writes: 120_000,
  reads: 2_500_000,
  awakeHoursPerMonth: 730,
}

export const TITAN_FOOTPRINT: Footprint = {
  tier: tierFor('titan'),
  databaseMb: 40_000,
  filesMb: 200_000,
  egressGb: 1_200,
  writes: 800_000,
  reads: 20_000_000,
  awakeHoursPerMonth: 730,
}

/** Write-ahead log, indexes and the room a vacuum needs. */
export const DISK_OVERHEAD = 1.5

/** What the operating system, Postgres and the router take per box. */
export const BOX_OVERHEAD_GB = 6

export type Population = Partial<Record<PlanId, number>>

export type FleetInput = {
  population: Population
  machine?: Machine
  footprints?: Partial<Record<PlanId, Footprint>>
}

export type FleetCost = {
  /** Shared boxes, plus one each for dedicated tenants. */
  boxes: number
  dedicatedBoxes: number
  boxesUsd: number
  objectStorageUsd: number
  fixedUsd: number
  totalUsd: number
  ramGb: number
  diskGb: number
  egressGb: number
  /** What forced the last box. */
  binding: 'memory' | 'disk' | 'traffic'
  /** Cost attributed to free tenants, and the per-tenant share of it. */
  freeUsd: number
  perFreeUserUsd: number
  /** What the same egress would have cost on an S3-shaped bill. */
  egressAvoidedUsd: number
}

const DEFAULT_FOOTPRINTS: Record<PlanId, Footprint> = {
  spark: FREE_FOOTPRINT,
  core: CORE_FOOTPRINT,
  forge: FORGE_FOOTPRINT,
  titan: TITAN_FOOTPRINT,
}

const PLAN_IDS: PlanId[] = ['spark', 'core', 'forge', 'titan']

export function fleetFor(input: FleetInput): FleetCost {
  const machine = input.machine ?? AX42
  const footprintOf = (plan: PlanId) => input.footprints?.[plan] ?? DEFAULT_FOOTPRINTS[plan]
  const count = (plan: PlanId) => Math.max(0, Math.floor(input.population[plan] ?? 0))

  let sharedRamMb = 0
  let sharedDiskMb = 0
  let freeRamMb = 0
  let freeDiskMb = 0
  let dedicatedBoxes = 0
  let storedGb = 0
  let writes = 0
  let reads = 0
  let egressGb = 0
  let freeStoredGb = 0

  for (const plan of PLAN_IDS) {
    const tenants = count(plan)
    if (tenants === 0) continue
    const footprint = footprintOf(plan)
    const ram = averageRamMb(footprint.tier, footprint.awakeHoursPerMonth) * tenants
    const disk = footprint.databaseMb * DISK_OVERHEAD * tenants

    if (footprint.tier.housing === 'dedicated') {
      dedicatedBoxes += tenants
    } else {
      sharedRamMb += ram
      sharedDiskMb += disk
    }
    if (plan === 'spark') {
      freeRamMb += ram
      freeDiskMb += disk
      freeStoredGb += (footprint.filesMb / 1024) * tenants
    }

    storedGb += (footprint.filesMb / 1024) * tenants
    writes += footprint.writes * tenants
    reads += footprint.reads * tenants
    egressGb += footprint.egressGb * tenants
  }

  const ramPerBox = Math.max(1, usableRamGb(machine) - BOX_OVERHEAD_GB)
  const diskPerBox = usableDiskGb(machine)

  // Boxes are whole things, so the count rounds up; the binding
  // constraint is read off the unrounded demand, because rounding ties
  // would otherwise hide which resource is actually running out.
  const needMemory = sharedRamMb / 1024 / ramPerBox
  const needDisk = sharedDiskMb / 1024 / diskPerBox
  const needTraffic = egressGb / machine.egressGb
  const shared = Math.max(1, Math.ceil(needMemory), Math.ceil(needDisk), Math.ceil(needTraffic))
  const binding: FleetCost['binding'] =
    needMemory >= needDisk && needMemory >= needTraffic
      ? 'memory'
      : needDisk >= needTraffic
        ? 'disk'
        : 'traffic'

  const boxes = shared + dedicatedBoxes
  const boxesUsd = boxes * machine.costUsd
  const objects = objectStorageUsd({ storedGb, writes, reads })
  const fixedUsd = fixedMonthlyUsd()
  const totalUsd = boxesUsd + objects + fixedUsd

  // The free tenants' share of the shared boxes, split by whichever
  // resource forced the purchase, plus their own object storage.
  const sharedTotal = binding === 'disk' ? sharedDiskMb : sharedRamMb
  const freeShare = sharedTotal > 0 ? (binding === 'disk' ? freeDiskMb : freeRamMb) / sharedTotal : 0
  const freeObjects = objectStorageUsd({
    storedGb: freeStoredGb,
    writes: writes * freeShare,
    reads: reads * freeShare,
  })
  const freeUsd = shared * machine.costUsd * freeShare + freeObjects
  const freeTenants = count('spark')

  return {
    boxes,
    dedicatedBoxes,
    boxesUsd,
    objectStorageUsd: objects,
    fixedUsd,
    totalUsd,
    ramGb: sharedRamMb / 1024,
    diskGb: sharedDiskMb / 1024,
    egressGb,
    binding,
    freeUsd,
    perFreeUserUsd: freeTenants > 0 ? freeUsd / freeTenants : 0,
    egressAvoidedUsd: egressIfBilledUsd(egressGb),
  }
}

/* ------------------------------------------------------- the comparison */

/**
 * What the per-tenant-instance model would cost at today's rates.
 *
 * This is the thing not to copy. Supabase could give every free
 * project its own Postgres because it had raised money to do it;
 * after Hetzner's June 2026 rise, a dedicated 8 GB instance is
 * $50.49 a month, so the same generosity is $252,450 a month for
 * 5,000 free projects. The shared fleet is roughly four figures less.
 */
export function perTenantInstanceUsd(tenants: number, machine: Machine = CCX13): number {
  return tenants * machine.costUsd
}

/* ---------------------------------------------------------- the funding */

export type Funding = {
  plan: PlanId
  /** Profit per paying customer per month, after inference and hosting. */
  contributionUsd: number
  /** Free tenants one paying customer pays for. */
  fundsFreeUsers: number
  /** Paying customers needed to cover the free fleet as modelled. */
  payersNeeded: number
}

/**
 * How many subscribers it takes to carry the free tier.
 *
 * Measured twice on purpose. `utilisation: 1` is the month where every
 * paying customer burns their entire AI allowance on the dearest
 * engine — the worst case, and the one a plan has to survive.
 * Anything lower is the normal month.
 */
export function fundingFor(
  plan: PlanId,
  fleet: FleetCost,
  options: { utilisation?: number } = {},
): Funding {
  const economics = economicsOf(planOr(plan), { utilisation: options.utilisation ?? 1 })
  const contributionUsd = (economics.priceCents - economics.totalCostCents) / 100
  const perFree = fleet.perFreeUserUsd
  return {
    plan,
    contributionUsd,
    fundsFreeUsers: perFree > 0 ? Math.floor(contributionUsd / perFree) : Number.POSITIVE_INFINITY,
    payersNeeded: contributionUsd > 0 ? Math.ceil(fleet.freeUsd / contributionUsd) : Number.POSITIVE_INFINITY,
  }
}

/** The fraction of free users who must convert for the fleet to pay for itself. */
export function breakEvenConversion(fleet: FleetCost, plan: PlanId, freeUsers: number): number {
  if (freeUsers <= 0) return 0
  const funding = fundingFor(plan, fleet)
  return funding.payersNeeded / freeUsers
}

/** A one-line summary for the ops page. */
export function describeFleet(fleet: FleetCost): string {
  return `${fleet.boxes} box${fleet.boxes === 1 ? '' : 'es'}, $${fleet.totalUsd.toFixed(
    2,
  )} a month, ${fleet.binding}-bound. R2 free egress saved $${fleet.egressAvoidedUsd.toFixed(2)}.`
}
