/**
 * What the metal costs.
 *
 * Vortex is the managed backend behind `src/backend/adapters/vortex.ts`:
 * auth, a row store with compiled policies, realtime fan-out with
 * cursors, object storage, functions and schema apply. Hosting it for
 * free users is a real bill, and the only way to decide a free tier
 * honestly is to price the bill first and the tier second.
 *
 * Rates read in **November 2026**, in US dollars. Two of them moved
 * recently and both moves matter:
 *
 * - Hetzner's June 2026 adjustment pushed dedicated-vCPU cloud
 *   instances up by about 170% (CCX13 went from €15.99 to €42.99),
 *   while bare metal barely moved. A 64 GB AX42 at ~$49 now costs less
 *   than 8 GB of dedicated cloud vCPU. That single fact decides the
 *   architecture: free tenants live on owned metal, not on per-tenant
 *   cloud instances.
 * - Cloudflare R2 still charges **nothing** for egress, against about
 *   $0.09/GB on S3. Egress is the line item that kills bootstrapped
 *   infrastructure, and it is avoidable by choosing a provider rather
 *   than by hoping users download less.
 */

export const RATES_READ_ON = '2026-11-20'

/** Hetzner invoices in euros; this is the rate used for the dollar figures. */
export const EUR_USD = 1.08

export type Machine = {
  id: string
  label: string
  /** Dollars per month. */
  costUsd: number
  ramGb: number
  vcpu: number
  diskGb: number
  /** Included outbound traffic, in GB. */
  egressGb: number
  note?: string
}

/** Bare metal. Where the shared fleet actually lives. */
export const AX42: Machine = {
  id: 'ax42',
  label: 'Hetzner AX42 (bare metal)',
  costUsd: 49,
  ramGb: 64,
  vcpu: 8,
  diskGb: 1_920,
  egressGb: 20_000,
  note: 'Ryzen 8c/16t, 64 GB ECC, NVMe. The unit the fleet is built from.',
}

/** A small shared-vCPU node, for edge/API duty that must scale sideways. */
export const CX33: Machine = {
  id: 'cx33',
  label: 'Hetzner CX33 (shared vCPU)',
  costUsd: 9.3,
  ramGb: 8,
  vcpu: 4,
  diskGb: 80,
  egressGb: 20_000,
}

/**
 * Dedicated vCPU, priced here only so the comparison can be made
 * honestly: this is what "one small instance per free user" would
 * cost after the June 2026 rise.
 */
export const CCX13: Machine = {
  id: 'ccx13',
  label: 'Hetzner CCX13 (dedicated vCPU)',
  costUsd: 50.49,
  ramGb: 8,
  vcpu: 2,
  diskGb: 80,
  egressGb: 20_000,
  note: 'Rose 169% in June 2026. The per-tenant-instance model priced at today’s rates.',
}

export const MACHINES: Machine[] = [AX42, CX33, CCX13]

/** Cloudflare R2. The reason the egress line is zero. */
export const R2 = {
  storagePerGbMonthUsd: 0.015,
  /** Writes, lists, copies. */
  classAPerMillionUsd: 4.5,
  /** Reads, heads. */
  classBPerMillionUsd: 0.36,
  egressPerGbUsd: 0,
  freeStorageGb: 10,
  freeClassAMillions: 1,
  freeClassBMillions: 10,
}

/** S3's egress rate, kept for the comparison that justifies the choice. */
export const S3_EGRESS_PER_GB_USD = 0.09

/** Flat monthly costs that do not scale with tenants. */
export const FIXED_COSTS_USD = {
  /** Storage Box for nightly per-schema dumps, ~1 TB. */
  backups: 4,
  /** Cloudflare Workers paid plan for the edge router. */
  edge: 5,
  /** Logs, metrics, uptime. */
  observability: 15,
  /** Domains, IPv4 addresses, certificates. */
  network: 6,
}

export function fixedMonthlyUsd(): number {
  return Object.values(FIXED_COSTS_USD).reduce((sum, value) => sum + value, 0)
}

/**
 * Headroom. A box packed to its last gigabyte is a box that falls over
 * on a Tuesday, so the model only ever spends this fraction of one.
 */
export const USABLE_FRACTION = 0.7

export function usableRamGb(machine: Machine): number {
  return machine.ramGb * USABLE_FRACTION
}

export function usableDiskGb(machine: Machine): number {
  return machine.diskGb * USABLE_FRACTION
}

/** R2's bill for a month, free allowances deducted. */
export function objectStorageUsd(input: { storedGb: number; writes: number; reads: number }): number {
  const storage = Math.max(0, input.storedGb - R2.freeStorageGb) * R2.storagePerGbMonthUsd
  const writes = Math.max(0, input.writes / 1_000_000 - R2.freeClassAMillions) * R2.classAPerMillionUsd
  const reads = Math.max(0, input.reads / 1_000_000 - R2.freeClassBMillions) * R2.classBPerMillionUsd
  return storage + writes + reads
}

/** What the same object workload would cost with S3-style egress fees. */
export function egressIfBilledUsd(gb: number): number {
  return gb * S3_EGRESS_PER_GB_USD
}
