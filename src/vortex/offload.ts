/**
 * Pushing work to the client, costed.
 *
 * Gemini's third point — cache in IndexedDB, run what you can in the
 * browser, stop asking the server the same question — is the best of
 * the four, and it is the one usually argued for the wrong reason.
 * The reason is not that it saves money on reads. It is that a read
 * served from the device is *faster*, works on a train, and does not
 * wake a sleeping tenant. The savings are a side effect of building
 * something better, which is the only kind of saving that survives
 * contact with a product decision.
 *
 * So this file does two things. It states a **cache policy per table
 * kind**, because "cache everything" and "cache nothing" are both
 * wrong and the difference is whether another user can change the row
 * under you. And it prices the effect, so the saving can be compared
 * against the complexity honestly rather than assumed.
 */

import { objectStorageUsd } from './infra'
import type { Footprint } from './fleet'

/* ---------------------------------------------------------- the policy */

export type Strategy =
  /** Serve from the device, revalidate in the background. */
  | 'cache-first'
  /** Ask the server, fall back to the device when offline. */
  | 'network-first'
  /** Always ask. Never persist. */
  | 'never'

export type CacheRule = {
  id: string
  label: string
  strategy: Strategy
  /** How long a cached copy may be served before revalidating, in seconds. */
  ttlSeconds: number
  /** Why this rule is what it is. */
  reason: string
}

/**
 * What may be cached on the device, and for how long.
 *
 * The ordering principle: cache by **who can change it**, not by how
 * often it is read. A hot row that another user edits is the worst
 * possible thing to serve stale, and a cold row nobody can touch is
 * free to keep forever.
 */
export const CACHE_RULES: CacheRule[] = [
  {
    id: 'schema',
    label: 'The project blueprint',
    strategy: 'cache-first',
    ttlSeconds: 86_400,
    reason: 'It changes when the owner applies a migration, and the apply can invalidate it directly.',
  },
  {
    id: 'own-rows',
    label: 'Rows this user owns',
    strategy: 'cache-first',
    ttlSeconds: 300,
    reason: 'Only this device writes them, so a stale copy can only be stale by its own doing.',
  },
  {
    id: 'reference',
    label: 'Reference tables: categories, settings, lookups',
    strategy: 'cache-first',
    ttlSeconds: 3_600,
    reason: 'Read constantly, written almost never. The cheapest possible thing to stop asking for.',
  },
  {
    id: 'shared-rows',
    label: 'Rows other users can edit',
    strategy: 'network-first',
    ttlSeconds: 30,
    reason: 'Serving these stale means showing one user another user’s undone work.',
  },
  {
    id: 'files',
    label: 'Objects from storage',
    strategy: 'cache-first',
    ttlSeconds: 604_800,
    reason: 'Content-addressed and immutable; a changed file is a different URL.',
  },
  {
    id: 'auth',
    label: 'Sessions, tokens and policy decisions',
    strategy: 'never',
    ttlSeconds: 0,
    reason: 'A cached authorisation is a revocation that did not happen.',
  },
  {
    id: 'realtime',
    label: 'Live subscription payloads',
    strategy: 'never',
    ttlSeconds: 0,
    reason: 'The whole point of the socket is that the device is not guessing.',
  },
]

export function ruleFor(id: string): CacheRule | undefined {
  return CACHE_RULES.find((rule) => rule.id === id)
}

/** Everything the device is allowed to keep between sessions. */
export function cacheable(): CacheRule[] {
  return CACHE_RULES.filter((rule) => rule.strategy !== 'never')
}

/* ----------------------------------------------------------- the maths */

/**
 * The share of reads a device cache can plausibly absorb.
 *
 * Not 90%. Measured hit rates on application caches of this shape sit
 * between a half and three quarters once cold starts, first visits,
 * private windows and invalidations are counted, and a model that
 * assumes more than that is a model written to justify a decision
 * already taken.
 */
export const PLAUSIBLE_HIT_RATE = 0.6

/** Writes are never cacheable. Nothing here pretends otherwise. */
export type Offload = {
  hitRate: number
  readsAvoided: number
  egressAvoidedGb: number
  /** Dollars off the monthly bill across the whole population. */
  savedUsd: number
  /** Requests that never wake a sleeping tenant. */
  wakesAvoided: number
}

/**
 * What a device cache is worth across a population of tenants.
 *
 * Deliberately computed as a *difference between two bills* rather
 * than as a rate times a count, so the free allowances are applied in
 * both worlds and the answer does not quietly credit savings that
 * Cloudflare was giving away anyway.
 */
export function offloadFor(
  footprint: Footprint,
  tenants: number,
  options: { hitRate?: number } = {},
): Offload {
  const hitRate = Math.min(1, Math.max(0, options.hitRate ?? PLAUSIBLE_HIT_RATE))
  const reads = footprint.reads * tenants
  const writes = footprint.writes * tenants
  const storedGb = (footprint.filesMb / 1024) * tenants
  const egressGb = footprint.egressGb * tenants

  const before = objectStorageUsd({ storedGb, writes, reads })
  const after = objectStorageUsd({ storedGb, writes, reads: reads * (1 - hitRate) })

  return {
    hitRate,
    readsAvoided: reads * hitRate,
    // Egress is already free on R2; this is the traffic that does not
    // cross the wire, which matters for the fleet's traffic ceiling
    // rather than for the invoice.
    egressAvoidedGb: egressGb * hitRate,
    savedUsd: before - after,
    wakesAvoided: reads * hitRate,
  }
}

/**
 * The honest summary.
 *
 * Says the saving and then says it is small, because the argument for
 * caching is latency and offline support, and a team that adopts it
 * for the invoice will drop it the first time an invalidation bug
 * costs them a day.
 */
export function describeOffload(offload: Offload): string {
  return `A ${Math.round(offload.hitRate * 100)}% device cache avoids ${Math.round(
    offload.readsAvoided,
  ).toLocaleString('en-US')} reads for $${offload.savedUsd.toFixed(
    2,
  )} a month. Do it for the latency; the invoice is a rounding error.`
}
