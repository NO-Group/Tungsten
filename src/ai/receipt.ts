/**
 * Ledger lines, in the register a person reads.
 *
 * A balance that drops with no explanation is the single fastest way
 * to lose an argument about billing, so every entry can say what it
 * was: what it bought, what it refunded, or why it cost nothing.
 */

import { engineById, type Engine } from './engines'
import { describeSpend, formatCredits, type Estimate } from './pricing'
import type { LedgerEntry } from './wallet'

export function describeEntry(entry: LedgerEntry): string {
  const engine = entry.engine ? engineById(entry.engine) : undefined
  if (entry.kind === 'grant') return `+${formatCredits(entry.credits)} credits \u2014 ${entry.note ?? 'granted'}`
  if (entry.kind === 'release') return entry.note ?? 'Call failed; not charged.'
  if (entry.kind === 'adjust') return entry.note ?? 'Adjustment; not charged.'
  if (engine && entry.usage) return describeSpend(engine, entry.usage, entry.credits)
  return `${formatCredits(entry.credits)} credits${engine ? ` on ${engine.label}` : ''}`
}

/**
 * The line beside the send button.
 *
 * Two numbers, because one is a lie in both directions. The estimate
 * alone makes the hold look like a bug when the balance dips further;
 * the ceiling alone makes a one-credit question look like a purchase.
 * Saying "about 6, at most 24" is what a person needs to decide
 * whether to press the button.
 */
export function describeEstimate(estimate: Estimate, engine?: Engine): string {
  const on = engine ? ` on ${engine.label}` : ''
  if (estimate.ceiling <= estimate.credits) {
    return `${formatCredits(estimate.credits)} credit${estimate.credits === 1 ? '' : 's'}${on}`
  }
  return `about ${formatCredits(estimate.credits)}, at most ${formatCredits(estimate.ceiling)} credits${on}`
}

/** Can this balance pay for that question at all? */
export function affords(balanceCredits: number, estimate: Estimate): boolean {
  return balanceCredits >= estimate.ceiling
}
