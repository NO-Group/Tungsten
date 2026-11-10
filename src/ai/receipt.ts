/**
 * Ledger lines, in the register a person reads.
 *
 * A balance that drops with no explanation is the single fastest way
 * to lose an argument about billing, so every entry can say what it
 * was: what it bought, what it refunded, or why it cost nothing.
 */

import { engineById } from './engines'
import { describeSpend, formatCredits } from './pricing'
import type { LedgerEntry } from './wallet'

export function describeEntry(entry: LedgerEntry): string {
  const engine = entry.engine ? engineById(entry.engine) : undefined
  if (entry.kind === 'grant') return `+${formatCredits(entry.credits)} credits \u2014 ${entry.note ?? 'granted'}`
  if (entry.kind === 'release') return entry.note ?? 'Call failed; not charged.'
  if (entry.kind === 'adjust') return entry.note ?? 'Adjustment; not charged.'
  if (engine && entry.usage) return describeSpend(engine, entry.usage, entry.credits)
  return `${formatCredits(entry.credits)} credits${engine ? ` on ${engine.label}` : ''}`
}
