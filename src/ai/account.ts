/**
 * Who you are, and what that entitles you to -- kept apart on purpose.
 *
 * The tempting design is to stamp the plan into the session token:
 * one signature, no lookup, every service can read it. It is also how
 * you end up honouring a cancelled subscription for the rest of the
 * token's life, refunding people who upgraded and then waited an hour
 * for it to take effect, and discovering that a balance cannot live in
 * a token at all because it changes every few seconds.
 *
 * So the token carries **identity only** -- subject, session, expiry --
 * and entitlements are read server-side from the account on every
 * request, through a cache with a short TTL that the billing webhook
 * invalidates by hand. An upgrade is live in milliseconds; a
 * cancellation is live in milliseconds; and a stolen token buys exactly
 * as much as the account behind it currently has.
 */

import { balance, applyGrant, changePlan, newWallet, type Balance, type Wallet } from './wallet'
import { engineRefusal, planOr, type Plan, type PlanId, type Refusal } from './plans'
import type { EngineId } from './engines'

export type Account = {
  id: string
  email: string
  emailVerified: boolean
  wallet: Wallet
  /** Seats actually in use, for the seat gate. */
  seatsUsed: number
  createdAt: number
}

export function newAccount(id: string, email: string, now: number, plan: PlanId = 'spark'): Account {
  return { id, email, emailVerified: false, wallet: newWallet(plan, now), seatsUsed: 1, createdAt: now }
}

/* --------------------------------------------------------------- tokens */

/**
 * Everything a Tungsten session token is allowed to say.
 *
 * No plan. No credits. No feature flags. `claims.test` asserts this
 * list, so the first well-meaning `plan: 'titan'` someone adds fails
 * the build with a comment explaining why.
 */
export type TokenClaims = {
  /** Account id. */
  sub: string
  /** Session id, so one device can be signed out without the others. */
  sid: string
  /** Issued at, epoch seconds. */
  iat: number
  /** Expires at, epoch seconds. */
  exp: number
}

export const IDENTITY_CLAIMS = ['sub', 'sid', 'iat', 'exp'] as const

export const SESSION_TTL_MS = 60 * 60 * 1000

export function claimsFor(account: Account, session: { sessionId: string; now: number; ttlMs?: number }): TokenClaims {
  const ttl = session.ttlMs ?? SESSION_TTL_MS
  return {
    sub: account.id,
    sid: session.sessionId,
    iat: Math.floor(session.now / 1000),
    exp: Math.floor((session.now + ttl) / 1000),
  }
}

/* --------------------------------------------------------- entitlements */

export type Entitlements = {
  accountId: string
  plan: Plan
  balance: Balance
  engines: EngineId[]
  mediaBytes: number
  seats: number
  /** When this snapshot was taken. The cache's age is visible, not implied. */
  readAt: number
}

export function entitlementsFor(account: Account, now: number): Entitlements {
  const plan = planOr(account.wallet.plan)
  return {
    accountId: account.id,
    plan,
    balance: balance(account.wallet, now, plan),
    engines: plan.engines,
    mediaBytes: plan.mediaBytes,
    seats: plan.seats,
    readAt: now,
  }
}

/** May this account call this engine right now? */
export function mayUseEngine(entitlements: Entitlements, engine: EngineId): Refusal | undefined {
  return engineRefusal(entitlements.plan, engine)
}

/**
 * A read-through cache with a deliberately short memory.
 *
 * The TTL is the worst case for a stale plan; the webhook's
 * `invalidate` is the normal case, which is immediate. Balances are
 * *not* served from here for spending decisions -- a reservation always
 * touches the real wallet -- this is for rendering and for gates.
 */
export const ENTITLEMENT_TTL_MS = 30_000

export type EntitlementCache = {
  get: (accountId: string, now: number) => Entitlements | undefined
  invalidate: (accountId: string) => void
  /** Number of entries, for tests and for a metrics line. */
  size: () => number
}

export function createEntitlementCache(options: {
  load: (accountId: string) => Account | undefined
  ttlMs?: number
}): EntitlementCache {
  const ttl = options.ttlMs ?? ENTITLEMENT_TTL_MS
  const entries = new Map<string, Entitlements>()
  return {
    get(accountId, now) {
      const cached = entries.get(accountId)
      if (cached && now - cached.readAt < ttl) return cached
      const account = options.load(accountId)
      if (!account) {
        entries.delete(accountId)
        return undefined
      }
      const fresh = entitlementsFor(account, now)
      entries.set(accountId, fresh)
      return fresh
    },
    invalidate(accountId) {
      entries.delete(accountId)
    },
    size: () => entries.size,
  }
}

/* ------------------------------------------------------------- billing */

export type BillingEvent =
  | { type: 'period.renewed'; accountId: string; key: string; at: number; plan?: PlanId }
  | { type: 'plan.changed'; accountId: string; key: string; at: number; plan: PlanId }
  | { type: 'topup.purchased'; accountId: string; key: string; at: number; credits: number }
  | { type: 'subscription.cancelled'; accountId: string; key: string; at: number }

/**
 * Applies a payment provider's event to an account.
 *
 * Idempotent, because webhooks are delivered at-least-once and a
 * replayed "topup.purchased" that grants twice is a bug you find in
 * the accounts, months later. Cancellation drops to the free plan
 * immediately but keeps purchased top-ups -- those were bought, not
 * rented.
 */
export function applyBillingEvent(account: Account, event: BillingEvent): Account {
  switch (event.type) {
    case 'period.renewed':
      return {
        ...account,
        wallet: applyGrant(account.wallet, { key: event.key, at: event.at, kind: 'period', plan: event.plan }),
      }
    case 'plan.changed':
      return { ...account, wallet: changePlan(account.wallet, event.plan, event.at, event.key) }
    case 'topup.purchased':
      return {
        ...account,
        wallet: applyGrant(account.wallet, { key: event.key, at: event.at, kind: 'topUp', credits: event.credits }),
      }
    case 'subscription.cancelled':
      return { ...account, wallet: { ...changePlan(account.wallet, 'spark', event.at, event.key), included: 0 } }
  }
}

/* --------------------------------------------------------- free tier */

export type SignupSignals = {
  emailVerified: boolean
  /** How many accounts this browser/device has already made. */
  accountsOnDevice: number
  /** How many accounts share this payment-less IP in the last day. */
  accountsOnNetwork: number
  /** Disposable-domain list hit. */
  disposableEmail: boolean
}

export const DEVICE_ACCOUNT_LIMIT = 3
export const NETWORK_ACCOUNT_LIMIT = 10

/**
 * Whether a new free account gets its allowance.
 *
 * Free credits are real money -- a Spark wallet spent entirely on the
 * dearest engine it may call costs us about a dollar and a half a
 * month -- so the grant is withheld, not the account. Somebody who
 * fails this can still build, export and bring their own key; they
 * just do not get free inference until the email is verified. Refusing
 * the *account* instead punishes the shared-office case, which is a
 * real case.
 */
export function freeGrantRefusal(signals: SignupSignals): Refusal | undefined {
  if (signals.disposableEmail) {
    return { reason: 'plan', message: 'Free credits need a permanent email address.', upgradeTo: 'core' }
  }
  if (!signals.emailVerified) {
    return { reason: 'plan', message: 'Verify your email to collect your free credits.' }
  }
  if (signals.accountsOnDevice > DEVICE_ACCOUNT_LIMIT || signals.accountsOnNetwork > NETWORK_ACCOUNT_LIMIT) {
    return {
      reason: 'plan',
      message: 'This device has collected the free allowance a few times already. A paid plan has no such limit.',
      upgradeTo: 'core',
    }
  }
  return undefined
}
