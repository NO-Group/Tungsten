import { Check, Coins, Cpu, Lock, Zap } from 'lucide-react'

import {
  ENGINES,
  PLANS,
  TOP_UPS,
  annualCents,
  creditsFor,
  describeEntry,
  engineById,
  engineRefusal,
  formatCredits,
  perCreditCents,
  type Engine,
  type EngineId,
  type Plan,
  type PlanId,
} from '../../ai'
import type { AiWallet } from '../../ai/useAiWallet'

export type AiUsagePanelProps = {
  wallet: AiWallet
  /** The engine the assistant will use for the next request. */
  engine: EngineId
  onChooseEngine: (engine: EngineId) => void
  onChoosePlan: (plan: PlanId) => void
  onBuyTopUp: (packId: string) => void
}

/** A turn big enough to be representative: a screen's worth of context. */
const TYPICAL = { inputTokens: 6_000, cachedInputTokens: 4_000, outputTokens: 1_200 }

const money = (cents: number) => (cents === 0 ? 'Free' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`)

function turnsLeft(engine: Engine, credits: number): number {
  const perTurn = creditsFor(engine, TYPICAL)
  return perTurn <= 0 ? 0 : Math.floor(credits / perTurn)
}

/**
 * Plan, balance, engines and the receipt.
 *
 * Two things this panel refuses to do, both of them common and both of
 * them corrosive. It does not hide the price of a call until after the
 * call: every engine shows what a representative turn costs and how
 * many of those the current balance buys. And it does not show a
 * locked engine as missing — a locked engine is listed, priced, and
 * carries the sentence saying which plan unlocks it, because a feature
 * you cannot see is a feature you cannot decide to pay for.
 */
export function AiUsagePanel({ wallet, engine, onChooseEngine, onChoosePlan, onBuyTopUp }: AiUsagePanelProps) {
  const plan = wallet.plan
  const balance = wallet.balance
  const allowance = plan.monthlyCredits + plan.dailyCredits
  const used = Math.max(0, allowance - balance.included - balance.free)
  const portion = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0

  return (
    <div className="builder-credits">
      <section className="credits-balance">
        <header>
          <Coins size={13} />
          <h3>{plan.label}</h3>
          <span className="credits-total">{formatCredits(balance.total)} credits</span>
        </header>
        <div className="credits-bar" role="img" aria-label={`${portion}% of this period's allowance used`}>
          <span style={{ width: `${portion}%` }} />
        </div>
        <p className="credits-line">{wallet.summary.sentence}</p>
        <dl className="credits-split">
          <div>
            <dt>Allowance</dt>
            <dd>{formatCredits(balance.included)}</dd>
          </div>
          {plan.dailyCredits > 0 && (
            <div>
              <dt>Free today</dt>
              <dd>{formatCredits(balance.free)}</dd>
            </div>
          )}
          <div>
            <dt>Top-ups</dt>
            <dd>{formatCredits(balance.topUp)}</dd>
          </div>
          <div>
            <dt>On hold</dt>
            <dd>{formatCredits(balance.held)}</dd>
          </div>
        </dl>
      </section>

      <section className="credits-engines">
        <h4>Engines</h4>
        <ul>
          {ENGINES.map((candidate) => {
            const refusal = engineRefusal(plan, candidate.id)
            const perTurn = creditsFor(candidate, TYPICAL)
            const remaining = turnsLeft(candidate, balance.total)
            return (
              <li key={candidate.id} className={refusal ? 'locked' : candidate.id === engine ? 'chosen' : ''}>
                <button
                  type="button"
                  disabled={Boolean(refusal)}
                  aria-label={`Use the ${candidate.label} engine`}
                  onClick={() => onChooseEngine(candidate.id)}
                >
                  <span className="credits-engine-name">
                    {refusal ? <Lock size={11} /> : candidate.id === engine ? <Check size={11} /> : <Cpu size={11} />}
                    {candidate.label}
                  </span>
                  <span className="credits-engine-cost">
                    {perTurn} credits a turn
                    {!refusal && ` · about ${formatCredits(remaining)} left`}
                  </span>
                  <em>{refusal ? refusal.message : candidate.summary}</em>
                </button>
                {refusal?.upgradeTo && (
                  <button
                    type="button"
                    className="credits-upgrade"
                    onClick={() => onChoosePlan(refusal.upgradeTo as PlanId)}
                  >
                    Move to {engineById(candidate.id) && PLANS.find((entry) => entry.id === refusal.upgradeTo)?.label}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="credits-plans">
        <h4>Plans</h4>
        <ul>
          {PLANS.map((candidate) => (
            <PlanCard key={candidate.id} plan={candidate} current={plan.id} onChoose={onChoosePlan} />
          ))}
        </ul>
      </section>

      <section className="credits-topups">
        <h4>Top-ups</h4>
        <p className="credits-note">Bought credits never expire, and are spent after the monthly allowance.</p>
        <ul>
          {TOP_UPS.map((pack) => (
            <li key={pack.id}>
              <button type="button" onClick={() => onBuyTopUp(pack.id)}>
                <Zap size={11} />
                {formatCredits(pack.credits)} credits
                <span>{money(pack.priceCents)}</span>
                <em>{perCreditCents(pack).toFixed(3).replace(/0+$/, '')}¢ each</em>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="credits-history">
        <h4>Recent</h4>
        {wallet.history.length === 0 ? (
          <p className="builder-clean">Nothing spent yet.</p>
        ) : (
          <ul>
            {wallet.history.map((entry, index) => (
              <li key={`${entry.key}-${index}`}>{describeEntry(entry)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PlanCard({ plan, current, onChoose }: { plan: Plan; current: PlanId; onChoose: (plan: PlanId) => void }) {
  const here = plan.id === current
  return (
    <li className={here ? 'current' : ''}>
      <button type="button" disabled={here} aria-label={`Move to ${plan.label}`} onClick={() => onChoose(plan.id)}>
        <span className="credits-plan-name">{plan.label}</span>
        <span className="credits-plan-price">
          {money(plan.priceCents)}
          {plan.priceCents > 0 && <em>{money(annualCents(plan))} a year</em>}
        </span>
        <span className="credits-plan-credits">
          {formatCredits(plan.monthlyCredits)} credits
          {plan.dailyCredits > 0 && ` + ${plan.dailyCredits} a day`}
        </span>
        <em>{plan.summary}</em>
      </button>
    </li>
  )
}
