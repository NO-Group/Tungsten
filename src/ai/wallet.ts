/**
 * The wallet: reserve, call, reconcile.
 *
 * The naive version of metering is `if (balance >= cost) { call() ;
 * balance -= cost }`. It is wrong in three separate ways and all three
 * show up in production:
 *
 * - **It races.** Two tabs, two agent steps, one balance. Both checks
 *   pass, both calls run, the balance goes negative.
 * - **It guesses.** The cost is not known until the provider reports
 *   usage. Charging the estimate overcharges short answers and
 *   undercharges long ones, forever.
 * - **It bills failures.** A 500 from the provider costs the customer
 *   credits and costs us the trust, which is the more expensive half.
 *
 * So: every call opens a **hold** for the most it could possibly cost,
 * against a specific key. The provider answers. The hold is **settled**
 * with real usage -- charge the actual, refund the difference -- or
 * **released** in full if nothing came back. Keys make all three
 * operations idempotent, so a retried request, a replayed webhook or a
 * double-clicked button cannot charge twice.
 *
 * Money is spent perishable-first: this period's allowance, then
 * today's free grant, then purchased top-ups, which never expire.
 *
 * Every function here is pure -- wallet in, wallet out -- and takes
 * `now` as an argument. Metering code that reads the clock cannot be
 * tested at a window boundary, and the window boundaries are exactly
 * where metering bugs live.
 */

import type { EngineId } from './engines'
import { cheapestPlanWith, planOr, type Plan, type PlanId, type Refusal } from './plans'
import { formatCredits, type Usage } from './pricing'

/** The rolling free window. Not "midnight UTC", which is 1am somewhere. */
export const FREE_WINDOW_MS = 24 * 60 * 60 * 1000

/** A hold left open this long is assumed to belong to a crashed client. */
export const HOLD_TTL_MS = 5 * 60 * 1000

/** How much history the wallet carries around. Older is the server's problem. */
export const LEDGER_LIMIT = 500

export type Bucket = 'included' | 'free' | 'topUp'

/** A per-bucket split. Holds remember it so refunds go home. */
export type Split = { included: number; free: number; topUp: number }

const totalOf = (split: Split) => split.included + split.free + split.topUp

export type Hold = {
  key: string
  engine: EngineId
  /** What was taken, per bucket. The sum is the ceiling of the call. */
  taken: Split
  openedAt: number
  expiresAt: number
}

export type LedgerKind = 'spend' | 'refund' | 'grant' | 'release' | 'adjust'

export type LedgerEntry = {
  key: string
  kind: LedgerKind
  at: number
  credits: number
  engine?: EngineId
  usage?: Usage
  note?: string
}

/** A free-grant spend, remembered only long enough to age out of the window. */
export type FreeSpend = { key: string; at: number; credits: number }

export type Wallet = {
  plan: PlanId
  /** Remaining credits from this period's allowance. Do not roll over. */
  included: number
  /** Purchased credits. Spent last, never expire. */
  topUp: number
  /** Epoch ms of the current billing period's start. */
  periodStart: number
  freeSpends: FreeSpend[]
  holds: Hold[]
  ledger: LedgerEntry[]
  /** Grant keys already applied, so a replayed webhook is free. */
  applied: string[]
}

export function newWallet(plan: PlanId, now: number): Wallet {
  return {
    plan,
    included: planOr(plan).monthlyCredits,
    topUp: 0,
    periodStart: now,
    freeSpends: [],
    holds: [],
    ledger: [],
    applied: [],
  }
}

/* ------------------------------------------------------------- balances */

export type Balance = Split & {
  /** Spendable right now, excluding anything already held. */
  total: number
  /** Sitting in open holds. Comes back as refunds when calls settle. */
  held: number
}

const liveFree = (wallet: Wallet, now: number) => wallet.freeSpends.filter((spend) => spend.at > now - FREE_WINDOW_MS)

/**
 * What the free grant has left in the last 24 hours. Only paid-for-free
 * plans have one; a paid plan whose allowance runs out is asked to top
 * up, not quietly given more.
 */
export function freeRemaining(wallet: Wallet, now: number, plan: Plan = planOr(wallet.plan)): number {
  if (plan.dailyCredits <= 0) return 0
  const spent = liveFree(wallet, now).reduce((sum, entry) => sum + entry.credits, 0)
  return Math.max(0, plan.dailyCredits - spent)
}

export function balance(wallet: Wallet, now: number, plan: Plan = planOr(wallet.plan)): Balance {
  const free = freeRemaining(wallet, now, plan)
  const held = wallet.holds.filter((hold) => hold.expiresAt > now).reduce((sum, hold) => sum + totalOf(hold.taken), 0)
  return {
    included: wallet.included,
    free,
    topUp: wallet.topUp,
    total: wallet.included + free + wallet.topUp,
    held,
  }
}

/** When the free grant next grows, or undefined if there is no grant. */
export function freeResetsAt(wallet: Wallet, now: number, plan: Plan = planOr(wallet.plan)): number | undefined {
  if (plan.dailyCredits <= 0) return undefined
  const oldest = liveFree(wallet, now)[0]
  return oldest ? oldest.at + FREE_WINDOW_MS : undefined
}

/* -------------------------------------------------------------- reserve */

export type ReserveRequest = {
  key: string
  engine: EngineId
  /** The ceiling of the call, from `reservationFor`. */
  credits: number
  now: number
  ttlMs?: number
}

export type ReserveResult =
  | { ok: true; wallet: Wallet; hold: Hold; replayed: boolean }
  | { ok: false; wallet: Wallet; refusal: Refusal; available: number }

/** Takes `credits` from the buckets, perishable first. */
function take(wallet: Wallet, credits: number, free: number): { split: Split; included: number; topUp: number } {
  const fromIncluded = Math.min(wallet.included, credits)
  const fromFree = Math.min(free, credits - fromIncluded)
  const fromTopUp = Math.min(wallet.topUp, credits - fromIncluded - fromFree)
  return {
    split: { included: fromIncluded, free: fromFree, topUp: fromTopUp },
    included: wallet.included - fromIncluded,
    topUp: wallet.topUp - fromTopUp,
  }
}

/** The sentence a person sees when the money runs out, and the way out of it. */
export function insufficientRefusal(plan: Plan, wanted: number, available: number): Refusal {
  const upgrade = cheapestPlanWith((candidate) => candidate.monthlyCredits > plan.monthlyCredits)
  const short = `That call needs up to ${formatCredits(wanted)} credits and ${formatCredits(
    available,
  )} ${available === 1 ? 'is' : 'are'} left.`
  const next = upgrade
    ? ` ${upgrade.label} includes ${formatCredits(upgrade.monthlyCredits)} a month, or top up without changing plan.`
    : ' Top up to keep going.'
  return { reason: 'credits', message: short + next, upgradeTo: upgrade?.id }
}

/**
 * Opens a hold.
 *
 * Reserving the same key twice returns the first hold untouched --
 * that is the whole retry story. A hold past its TTL is swept first,
 * so a crashed client's money comes back without anybody filing
 * anything.
 */
export function reserve(wallet: Wallet, request: ReserveRequest): ReserveResult {
  const plan = planOr(wallet.plan)
  const swept = expire(wallet, request.now)
  const existing = swept.holds.find((hold) => hold.key === request.key)
  if (existing) return { ok: true, wallet: swept, hold: existing, replayed: true }

  // A key that already settled is a retry of a call that finished. It
  // gets a hold of nothing: the gateway is idempotent on the same key
  // and will hand back the stored answer, and `settle` will recognise
  // the key and charge nothing. Taking real credits here is how a
  // retried request quietly costs twice.
  const finished = swept.ledger.find((entry) => entry.key === request.key && entry.kind !== 'grant')
  if (finished) {
    return {
      ok: true,
      replayed: true,
      wallet: swept,
      hold: {
        key: request.key,
        engine: request.engine,
        taken: { included: 0, free: 0, topUp: 0 },
        openedAt: request.now,
        expiresAt: request.now,
      },
    }
  }

  const credits = Math.max(0, Math.ceil(request.credits))
  const free = freeRemaining(swept, request.now, plan)
  const available = swept.included + free + swept.topUp
  if (credits > available) {
    return { ok: false, wallet: swept, refusal: insufficientRefusal(plan, credits, available), available }
  }

  const taken = take(swept, credits, free)
  const hold: Hold = {
    key: request.key,
    engine: request.engine,
    taken: taken.split,
    openedAt: request.now,
    expiresAt: request.now + (request.ttlMs ?? HOLD_TTL_MS),
  }
  const freeSpends =
    taken.split.free > 0
      ? [...swept.freeSpends, { key: request.key, at: request.now, credits: taken.split.free }]
      : swept.freeSpends
  return {
    ok: true,
    replayed: false,
    hold,
    wallet: {
      ...swept,
      included: taken.included,
      topUp: taken.topUp,
      freeSpends,
      holds: [...swept.holds, hold],
    },
  }
}

/* --------------------------------------------------------------- settle */

export type SettleResult = {
  wallet: Wallet
  /** Credits actually charged. Zero for a failed call. */
  charged: number
  /** Credits handed back from the hold. */
  refunded: number
  entry?: LedgerEntry
  replayed: boolean
}

function trim(ledger: LedgerEntry[]): LedgerEntry[] {
  return ledger.length <= LEDGER_LIMIT ? ledger : ledger.slice(ledger.length - LEDGER_LIMIT)
}

/** Puts `credits` back, in the proportions they were taken. */
function refund(wallet: Wallet, hold: Hold, keep: number, now: number): Wallet {
  // Charge the cheapest-to-replace money first: keep taking from
  // `included` (which expires anyway) and return the top-ups.
  const chargeIncluded = Math.min(hold.taken.included, keep)
  const chargeFree = Math.min(hold.taken.free, keep - chargeIncluded)
  const chargeTopUp = Math.max(0, keep - chargeIncluded - chargeFree)
  const freeSpends = wallet.freeSpends
    .map((spend) => (spend.key === hold.key ? { ...spend, at: now, credits: chargeFree } : spend))
    .filter((spend) => spend.credits > 0)
  return {
    ...wallet,
    included: wallet.included + (hold.taken.included - chargeIncluded),
    topUp: wallet.topUp + (hold.taken.topUp - chargeTopUp),
    freeSpends,
    holds: wallet.holds.filter((open) => open.key !== hold.key),
  }
}

export type SettleRequest = {
  key: string
  /** What the provider reported. Never what the client estimated. */
  credits: number
  now: number
  usage?: Usage
  note?: string
}

/**
 * Closes a hold against real usage.
 *
 * The charge is clamped to the hold. The hold was computed from the
 * output limit the request actually carried, so a provider cannot
 * exceed it by generating more; the only way past the ceiling is a
 * gateway counting *input* tokens differently from our estimate, and
 * in that argument the customer wins. The reservation already carries
 * a margin for exactly this, so the clamp should be rare and is cheap
 * when it is not.
 *
 * Settling a key twice returns the first result. Settling a key with
 * no hold -- a hold that timed out, say -- records an `adjust` entry
 * and charges nothing: we would rather eat one call than bill against
 * a balance we no longer have a reservation in.
 */
export function settle(wallet: Wallet, request: SettleRequest): SettleResult {
  const done = wallet.ledger.find((entry) => entry.key === request.key && entry.kind !== 'grant')
  if (done) return { wallet, charged: done.kind === 'spend' ? done.credits : 0, refunded: 0, entry: done, replayed: true }

  const hold = wallet.holds.find((open) => open.key === request.key)
  if (!hold) {
    const entry: LedgerEntry = {
      key: request.key,
      kind: 'adjust',
      at: request.now,
      credits: 0,
      usage: request.usage,
      note: request.note ?? 'Settled with no open hold; not charged.',
    }
    return { wallet: { ...wallet, ledger: trim([...wallet.ledger, entry]) }, charged: 0, refunded: 0, entry, replayed: false }
  }

  const ceiling = totalOf(hold.taken)
  const charged = Math.min(ceiling, Math.max(0, Math.ceil(request.credits)))
  const entry: LedgerEntry = {
    key: request.key,
    kind: charged > 0 ? 'spend' : 'release',
    at: request.now,
    credits: charged,
    engine: hold.engine,
    usage: request.usage,
    note: request.note,
  }
  const settled = refund(wallet, hold, charged, hold.openedAt)
  return {
    wallet: { ...settled, ledger: trim([...settled.ledger, entry]) },
    charged,
    refunded: ceiling - charged,
    entry,
    replayed: false,
  }
}

/**
 * Gives a hold back in full. This is what a failed call does, and the
 * reason a provider outage is not also a billing incident.
 */
export function release(wallet: Wallet, request: { key: string; now: number; reason?: string }): SettleResult {
  return settle(wallet, { key: request.key, credits: 0, now: request.now, note: request.reason ?? 'Call failed; not charged.' })
}

/**
 * The streaming rule, written down once.
 *
 * An abandoned stream is billed for the tokens that were actually
 * delivered -- the provider charges us for those, and a user who can
 * cancel a 10,000-token answer for free can read the first 9,000 of
 * every answer for free. Nothing is charged if nothing arrived.
 */
export function settleAbort(
  wallet: Wallet,
  request: { key: string; credits: number; now: number; usage?: Usage },
): SettleResult {
  return settle(wallet, { ...request, note: 'Stopped early; billed for what was delivered.' })
}

/** Sweeps holds whose client never came back. */
export function expire(wallet: Wallet, now: number): Wallet {
  const stale = wallet.holds.filter((hold) => hold.expiresAt <= now)
  if (stale.length === 0) return wallet
  return stale.reduce((current, hold) => {
    const returned = refund(current, hold, 0, hold.openedAt)
    const entry: LedgerEntry = {
      key: hold.key,
      kind: 'release',
      at: now,
      credits: 0,
      engine: hold.engine,
      note: 'Hold expired; credits returned.',
    }
    return { ...returned, ledger: trim([...returned.ledger, entry]) }
  }, wallet)
}

/* --------------------------------------------------------------- grants */

/**
 * A billing event. The payment webhook is the only thing that moves
 * money *into* a wallet, and it is idempotent by key because payment
 * providers retry webhooks as a matter of policy.
 */
export type Grant = {
  key: string
  at: number
  kind: 'period' | 'topUp' | 'gift'
  credits?: number
  /** For a period grant after a plan change. */
  plan?: PlanId
}

export function applyGrant(wallet: Wallet, grant: Grant): Wallet {
  if (wallet.applied.includes(grant.key)) return wallet
  const applied = [...wallet.applied, grant.key].slice(-LEDGER_LIMIT)
  const plan = planOr(grant.plan ?? wallet.plan)

  if (grant.kind === 'period') {
    const credits = grant.credits ?? plan.monthlyCredits
    const entry: LedgerEntry = { key: grant.key, kind: 'grant', at: grant.at, credits, note: `${plan.label} allowance` }
    return {
      ...wallet,
      plan: plan.id,
      included: credits,
      periodStart: grant.at,
      applied,
      ledger: trim([...wallet.ledger, entry]),
    }
  }

  const credits = Math.max(0, Math.floor(grant.credits ?? 0))
  const entry: LedgerEntry = {
    key: grant.key,
    kind: 'grant',
    at: grant.at,
    credits,
    note: grant.kind === 'topUp' ? 'Top-up' : 'Gift',
  }
  return { ...wallet, topUp: wallet.topUp + credits, applied, ledger: trim([...wallet.ledger, entry]) }
}

/**
 * A plan change mid-period.
 *
 * Upgrades grant the difference straight away, because somebody who
 * just paid more expects more immediately. Downgrades keep whatever is
 * left -- it was paid for -- and simply grant less next period. What
 * neither does is wait for a token to expire, which is why the plan is
 * read from here and never from a JWT claim.
 */
export function changePlan(wallet: Wallet, next: PlanId, at: number, key = `plan:${next}:${at}`): Wallet {
  if (wallet.plan === next) return wallet
  const before = planOr(wallet.plan)
  const after = planOr(next)
  const difference = after.monthlyCredits - before.monthlyCredits
  const moved: Wallet = { ...wallet, plan: next }
  if (difference <= 0 || wallet.applied.includes(key)) return moved
  const entry: LedgerEntry = { key, kind: 'grant', at, credits: difference, note: `Upgrade to ${after.label}` }
  return {
    ...moved,
    included: moved.included + difference,
    applied: [...moved.applied, key],
    ledger: trim([...moved.ledger, entry]),
  }
}

/* ------------------------------------------------------------- for eyes */

export type WalletSummary = {
  plan: PlanId
  planLabel: string
  total: number
  held: number
  free: number
  sentence: string
}

export function summarise(wallet: Wallet, now: number): WalletSummary {
  const plan = planOr(wallet.plan)
  const current = balance(wallet, now, plan)
  const resets = freeResetsAt(wallet, now, plan)
  const freeLine =
    plan.dailyCredits > 0
      ? ` ${formatCredits(current.free)} of today's ${formatCredits(plan.dailyCredits)} free credits left${
          resets ? `, more in ${Math.max(1, Math.round((resets - now) / 3_600_000))}h` : ''
        }.`
      : ''
  return {
    plan: plan.id,
    planLabel: plan.label,
    total: current.total,
    held: current.held,
    free: current.free,
    sentence: `${formatCredits(current.total)} credits on ${plan.label}.${freeLine}`,
  }
}

/** Newest first, for the usage list. */
export function recent(wallet: Wallet, count = 20): LedgerEntry[] {
  return [...wallet.ledger].reverse().slice(0, count)
}

/** What has been spent since the period began. The number a finance page wants. */
export function spentThisPeriod(wallet: Wallet): number {
  return wallet.ledger
    .filter((entry) => entry.kind === 'spend' && entry.at >= wallet.periodStart)
    .reduce((sum, entry) => sum + entry.credits, 0)
}
