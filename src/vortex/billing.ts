/**
 * Getting paid, and not getting farmed.
 *
 * Four problems, and they are not the same problem:
 *
 *   1. People who sign up with an empty card to farm a free tier.
 *   2. People whose real card stops working months later.
 *   3. Overage small enough that charging for it loses money.
 *   4. A runaway loop turning somebody's bug into your invoice.
 *
 * The received wisdom bundles all four into "require a card and run a
 * $1 pre-authorisation at signup". That answer is wrong here in two
 * specific, costed ways, and the arithmetic is in this file rather
 * than in an argument.
 *
 * **A $1 pre-auth is not free.** Stripe has not returned processing
 * fees on refunds since 2019: a $1 charge voided one second later
 * still costs 2.9% + 30c. At 5,000 free signups a month that is
 * $1,500 — fourteen times what the entire free fleet costs to run.
 * You would be spending fourteen dollars to protect one. A zero-amount
 * card authorisation does the same job for nothing, which is why it
 * exists.
 *
 * **And a card should not gate the free tier at all.** `fleet.ts` says
 * a free tenant costs $0.015 a month. Card-gating reliably removes
 * most of the people who would have signed up, to defend a penny and a
 * half. The card belongs at the moment someone wants to *exceed* the
 * free tier — which is the upgrade trigger `upgrade.ts` already
 * describes, and it arrives with the motivation already attached.
 *
 * What is left after those two corrections is good advice, and it is
 * implemented here: verify before the first paid byte, meter overage
 * above wholesale, never invoice an amount smaller than the fee to
 * collect it, freeze rather than delete, and cap spending by default.
 */

import { R2, objectStorageUsd } from './infra'
import { tierFor, type Tier } from './tenancy'
import type { PlanId } from '../ai/plans'

/* ------------------------------------------------------- verification */

export type VerificationMethod =
  /** A zero-amount authorisation. Confirms the card exists and is live. */
  | 'zero-amount-auth'
  /** A small charge, refunded. Confirms funds. Costs a fee that is never returned. */
  | 'micro-charge'
  /** Nothing. */
  | 'none'

/** Stripe's standard rate, and the reason small transactions are a trap. */
export const PROCESSING = { percent: 0.029, fixedUsd: 0.3 }

export function processingUsd(amountUsd: number): number {
  return amountUsd * PROCESSING.percent + PROCESSING.fixedUsd
}

/**
 * What a verification method costs per signup.
 *
 * The refund does not come with the fee attached, so a micro-charge is
 * priced at its full processing cost however quickly it is reversed.
 */
export function verificationCostUsd(method: VerificationMethod, amountUsd = 1): number {
  if (method === 'micro-charge') return processingUsd(amountUsd)
  return 0
}

/** What verifying every free signup would cost in a month. */
export function verificationBillUsd(method: VerificationMethod, signups: number, amountUsd = 1): number {
  return verificationCostUsd(method, amountUsd) * Math.max(0, signups)
}

export type VerificationPolicy = {
  /** When the card is demanded. */
  requiredAt: 'signup' | 'first-overage' | 'never'
  method: VerificationMethod
  why: string
}

/**
 * The policy, stated once.
 *
 * A card is required the first time a tenant wants to spend money,
 * not the first time it wants to exist. That is both cheaper and the
 * moment at which asking for a card is a reasonable thing to do.
 */
export const VERIFICATION: VerificationPolicy = {
  requiredAt: 'first-overage',
  method: 'zero-amount-auth',
  why:
    'A free tenant costs $0.015 a month, so a card at signup defends a penny and a half ' +
    'by removing most of the funnel. A zero-amount authorisation at the point of overage ' +
    'proves the card is live, costs nothing, and arrives when the user already wants to pay.',
}

/**
 * Things people propose that are worse than the problem.
 *
 * Kept in code, with reasons, because every one of them gets
 * suggested again in six months.
 */
export const REJECTED_CONTROLS: Array<{ id: string; control: string; why: string }> = [
  {
    id: 'bin-blocking',
    control: 'Block prepaid and virtual card BINs',
    why:
      'Prepaid and virtual cards are how a large share of the world pays, including most of ' +
      'Africa, Latin America and anyone using a bank’s own single-use card for safety. BIN ' +
      'prefixes are shared between legitimate fintechs and burners, so the rule blocks real ' +
      'customers and the determined abuser moves BIN in an afternoon.',
  },
  {
    id: 'geo-blocking',
    control: 'Block high-risk jurisdictions',
    why:
      'This is a country blocklist with a compliance word in front of it. It will exclude ' +
      'entire markets to stop a cost measured in cents, and the people it excludes are ' +
      'disproportionately the ones a developer tool should want.',
  },
  {
    id: 'micro-charge',
    control: 'A $1 pre-authorisation, refunded immediately',
    why:
      'Stripe keeps the fee on refunds. At 5,000 signups a month this costs $1,500 to ' +
      'defend a fleet that costs $105. A zero-amount authorisation answers the same ' +
      'question for free.',
  },
  {
    id: 'delete-on-failure',
    control: 'Delete data when a payment fails',
    why:
      'Payments fail for expired cards, bank fraud holds and travel far more often than for ' +
      'fraud. Deleting on a failed charge turns a billing hiccup into the worst day of ' +
      'somebody’s year, and it is the single fastest way to never be trusted with a real project.',
  },
]

/* -------------------------------------------------------- the overage */

/**
 * Overage rates: twice R2 wholesale.
 *
 * Doubling looks like a 50% margin and is not, because the processing
 * fee lands on the invoice rather than on the resource. `marginOf()`
 * computes the real number, which on a small invoice is closer to 20%.
 * That gap is the entire argument for the minimum invoice below.
 */
export const OVERAGE = {
  storagePerGbMonthUsd: R2.storagePerGbMonthUsd * 2,
  writesPerMillionUsd: R2.classAPerMillionUsd * 2,
  readsPerMillionUsd: R2.classBPerMillionUsd * 2,
  /** Passed through at cost, because R2's cost is zero and that is the selling point. */
  egressPerGbUsd: 0,
}

export type Overage = {
  storageGb: number
  writes: number
  reads: number
}

/** What the tenant is billed for going over. */
export function overageUsd(over: Overage): number {
  return (
    Math.max(0, over.storageGb) * OVERAGE.storagePerGbMonthUsd +
    (Math.max(0, over.writes) / 1_000_000) * OVERAGE.writesPerMillionUsd +
    (Math.max(0, over.reads) / 1_000_000) * OVERAGE.readsPerMillionUsd
  )
}

/** What that same usage costs us, with no free allowance assumed. */
export function overageCostUsd(over: Overage): number {
  return objectStorageUsd({
    storedGb: Math.max(0, over.storageGb) + R2.freeStorageGb,
    writes: Math.max(0, over.writes) + R2.freeClassAMillions * 1_000_000,
    reads: Math.max(0, over.reads) + R2.freeClassBMillions * 1_000_000,
  })
}

export type Margin = {
  revenueUsd: number
  costUsd: number
  processingUsd: number
  profitUsd: number
  /** The real margin, after the card fee. */
  margin: number
  /** The margin a rate card claims when it forgets the fee. */
  headlineMargin: number
}

/**
 * The real margin on an overage invoice.
 *
 * Two numbers on purpose. `headlineMargin` is what doubling the
 * wholesale rate looks like on a slide; `margin` is what reaches the
 * bank. On a $1.12 invoice they are 51% and 21%, and the difference is
 * a fixed 30 cents that does not care how small the invoice is.
 */
export function marginOf(over: Overage): Margin {
  const revenueUsd = overageUsd(over)
  const costUsd = overageCostUsd(over)
  const fee = revenueUsd > 0 ? processingUsd(revenueUsd) : 0
  const profitUsd = revenueUsd - costUsd - fee
  return {
    revenueUsd,
    costUsd,
    processingUsd: fee,
    profitUsd,
    margin: revenueUsd > 0 ? profitUsd / revenueUsd : 0,
    headlineMargin: revenueUsd > 0 ? (revenueUsd - costUsd) / revenueUsd : 0,
  }
}

/* ----------------------------------------------- when to actually bill */

/**
 * Do not charge a card for fifteen cents.
 *
 * At 2.9% + 30c, every invoice below about $10.35 loses more than a
 * tenth of itself to the fee, and an invoice below roughly 31 cents
 * loses money outright. Balances roll forward until they are worth
 * collecting.
 */
export const MINIMUM_INVOICE_USD = 5

/** The invoice below which the fee exceeds the revenue entirely. */
export function losesMoneyBelowUsd(): number {
  return PROCESSING.fixedUsd / (1 - PROCESSING.percent)
}

export type InvoiceDecision = {
  charge: boolean
  amountUsd: number
  /** Carried into next month. */
  rollForwardUsd: number
  reason: string
}

/**
 * Whether to charge now or roll forward.
 *
 * A quarter boundary forces the issue regardless of size, because a
 * balance that rolls forever is a receivable nobody ever collects and
 * a surprise the first time it is.
 */
export function shouldInvoice(
  accruedUsd: number,
  options: { endOfQuarter?: boolean; minimumUsd?: number } = {},
): InvoiceDecision {
  const minimum = options.minimumUsd ?? MINIMUM_INVOICE_USD
  const amount = Math.max(0, accruedUsd)
  if (amount <= 0) return { charge: false, amountUsd: 0, rollForwardUsd: 0, reason: 'Nothing owed.' }
  if (amount >= minimum) {
    return { charge: true, amountUsd: amount, rollForwardUsd: 0, reason: `Balance reached the $${minimum} threshold.` }
  }
  if (options.endOfQuarter) {
    return { charge: true, amountUsd: amount, rollForwardUsd: 0, reason: 'End of quarter; small balances are settled.' }
  }
  return {
    charge: false,
    amountUsd: 0,
    rollForwardUsd: amount,
    reason: `$${amount.toFixed(2)} is below the $${minimum} minimum; the card fee would take ${Math.round(
      (processingUsd(amount) / amount) * 100,
    )}% of it. Rolled forward.`,
  }
}

/* ------------------------------------------------------- the spend cap */

/** What a tenant may spend on overage before being asked, per month. */
export const SPEND_CAP_USD: Record<PlanId, number> = {
  spark: 0,
  core: 20,
  forge: 100,
  titan: 1_000,
}

export type CapVerdict = {
  capUsd: number
  spentUsd: number
  /** Fraction of the cap used. */
  pressure: number
  /** Stop spending. Reads keep serving; nothing is deleted. */
  stop: boolean
  message: string
}

/**
 * The cap that keeps somebody else's infinite loop off your invoice.
 *
 * On by default and low by default. A user who genuinely wants to
 * spend $500 can raise it in a minute; a user whose app is in a retry
 * storm at 3am cannot lower it, and will not be awake to.
 */
export function capCheck(plan: PlanId, spentUsd: number, overrideUsd?: number): CapVerdict {
  const capUsd = overrideUsd ?? SPEND_CAP_USD[plan]
  const pressure = capUsd > 0 ? spentUsd / capUsd : spentUsd > 0 ? Number.POSITIVE_INFINITY : 0
  const stop = spentUsd >= capUsd
  return {
    capUsd,
    spentUsd,
    pressure,
    stop,
    message: stop
      ? `This project has reached its $${capUsd} monthly spending limit. Writes and uploads are paused; everything already stored keeps serving. Raise the limit to continue.`
      : `$${spentUsd.toFixed(2)} of a $${capUsd} monthly limit.`,
  }
}

/* ----------------------------------------------------------- dunning */

export type DunningStage = {
  id: 'current' | 'grace' | 'frozen' | 'archived'
  /** Hours after the failed charge that this stage begins. */
  afterHours: number
  /** What the tenant can still do. */
  reads: boolean
  writes: boolean
  message: string
}

/**
 * What happens when a real card stops working.
 *
 * The ladder never deletes. It ends at `archived` — cold storage, off
 * the hot fleet, restorable — because a 90-day-old unpaid account
 * should stop costing money without becoming a story about a company
 * that destroys people's work. Every stage after the first keeps reads
 * alive, which is the same rule `quotaBreaches` follows, for the same
 * reason.
 */
export const DUNNING: DunningStage[] = [
  {
    id: 'current',
    afterHours: 0,
    reads: true,
    writes: true,
    message: 'The payment did not go through. We will try again; nothing has changed yet.',
  },
  {
    id: 'grace',
    afterHours: 72,
    reads: true,
    writes: true,
    message:
      'Three days to update the card. Everything keeps working — this is a warning, not a penalty.',
  },
  {
    id: 'frozen',
    afterHours: 168,
    reads: true,
    writes: false,
    message:
      'Writes are paused until the balance is settled. The project stays online and every byte is still here; updating the card unpauses it immediately.',
  },
  {
    id: 'archived',
    afterHours: 2_160,
    reads: false,
    writes: false,
    message:
      'After ninety days the project moves to cold storage. Nothing is deleted, and settling the balance restores it.',
  },
]

export function dunningStage(hoursPastDue: number): DunningStage {
  let stage = DUNNING[0]
  for (const candidate of DUNNING) {
    if (hoursPastDue >= candidate.afterHours) stage = candidate
  }
  return stage
}

/** Does this state still let the tenant's users read their data? */
export function stillServing(stage: DunningStage): boolean {
  return stage.reads
}

/* ------------------------------------------------------------ the spec */

/** The free tier's storage spec, in the words a pricing page uses. */
export function freeStorageSpec(tier: Tier = tierFor('spark')) {
  return {
    storageGb: tier.quota.filesMb / 1024,
    writesPerMonth: tier.quota.writesPerMonth,
    readsPerMonth: tier.quota.readsPerMonth,
    maxUploadMb: tier.quota.maxUploadMb,
    egress: 'unlimited, free',
  }
}
