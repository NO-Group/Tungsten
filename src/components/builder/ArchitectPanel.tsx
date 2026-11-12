/**
 * The AI Architect, and the gate in front of it.
 *
 * Three states and one rule. You describe the app; it drafts a
 * blueprint; you read what it would do and approve or discard. The
 * rule is that the approve button is the only path from the second
 * state to anything real — the panel never applies on arrival, never
 * applies on a timer, and never applies the half of a plan it liked.
 *
 * What the gate shows is chosen to be *readable*, not complete. Policy
 * rules are spelled out in English, because "owner" means nothing to
 * somebody who has not read `blueprint.ts`. Destructive operations are
 * pulled out of the list and put at the top in their own block, since
 * a `DROP COLUMN` buried at line 14 of a migration is a thing people
 * approve by accident exactly once.
 */

import { useState } from 'react'
import { AlertTriangle, Check, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'

import type { Draft } from '../../backend/architect'
import { describeApplied, review, type Review } from '../../backend/architect'
import type { Blueprint } from '../../backend/blueprint'

export type ArchitectPanelProps = {
  /** Drafts a blueprint. Never applies anything. */
  onDraft: (description: string) => Promise<Draft>
  /** What applying it would do, from the configured backend. */
  onPlan?: (blueprint: Blueprint) => Promise<Review['plan']>
  /** Runs the approved plan and adopts the schema. */
  onApply: (gate: Review) => Promise<void> | void
  /** Spendable credits, when a gateway is configured. */
  credits?: number
  /** Tables already on the canvas, named so the user knows what is at stake. */
  existingTables?: string[]
  busy?: boolean
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | { kind: 'failed'; reason: string }
  | { kind: 'review'; gate: Review; source: Draft extends { ok: true } ? never : string; credits: number }
  | { kind: 'applying'; gate: Review }
  | { kind: 'done'; message: string }

export function ArchitectPanel(props: ArchitectPanelProps) {
  const { onDraft, onPlan, onApply, credits, existingTables = [] } = props
  const [description, setDescription] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })

  const working = stage.kind === 'drafting' || stage.kind === 'applying' || Boolean(props.busy)

  async function draft() {
    if (!description.trim() || working) return
    setStage({ kind: 'drafting' })
    const result = await onDraft(description)
    if (!result.ok) {
      setStage({ kind: 'failed', reason: result.reason })
      return
    }
    const plan = onPlan ? await onPlan(result.blueprint) : undefined
    setStage({
      kind: 'review',
      gate: review(result.blueprint, plan),
      source: result.source,
      credits: result.credits,
    })
  }

  async function approve() {
    if (stage.kind !== 'review' || !stage.gate.approvable) return
    const gate = stage.gate
    setStage({ kind: 'applying', gate })
    await onApply(gate)
    setStage({ kind: 'done', message: describeApplied(gate) })
    setDescription('')
  }

  return (
    <div className="architect" aria-label="AI Architect">
      <div className="architect-ask">
        <textarea
          aria-label="Describe the app"
          placeholder="Describe what the app stores. “A recipe site where cooks post recipes, people save favourites and leave comments.”"
          value={description}
          rows={3}
          disabled={working}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="architect-ask-row">
          <button className="primary" onClick={() => void draft()} disabled={working || !description.trim()}>
            {stage.kind === 'drafting' ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
            {stage.kind === 'drafting' ? 'Designing…' : 'Design the backend'}
          </button>
          {credits !== undefined && <span className="architect-credits">{credits.toLocaleString('en-US')} credits</span>}
          {existingTables.length > 0 && (
            <span className="architect-existing">
              Extends {existingTables.length} existing table{existingTables.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {stage.kind === 'failed' && <p className="architect-failed">{stage.reason}</p>}
      {stage.kind === 'done' && <p className="architect-done"><Check size={12} /> {stage.message}</p>}

      {(stage.kind === 'review' || stage.kind === 'applying') && (
        <Gate
          gate={stage.gate}
          source={stage.kind === 'review' ? stage.source : undefined}
          credits={stage.kind === 'review' ? stage.credits : undefined}
          applying={stage.kind === 'applying'}
          onApprove={() => void approve()}
          onDiscard={() => setStage({ kind: 'idle' })}
        />
      )}
    </div>
  )
}

function Gate(props: {
  gate: Review
  source?: string
  credits?: number
  applying: boolean
  onApprove: () => void
  onDiscard: () => void
}) {
  const { gate, source, credits, applying, onApprove, onDiscard } = props
  const safe = (gate.plan?.operations ?? []).filter((operation) => !operation.destructive)

  return (
    <section className="architect-gate" aria-label="Review before applying">
      <header>
        <Sparkles size={12} />
        <strong>Nothing has been applied yet</strong>
        <span className="architect-source">
          {source === 'offline' ? 'drafted offline' : source === 'ai' ? `drafted for ${credits} credits` : ''}
        </span>
      </header>

      {gate.blockers.length > 0 && (
        <ul className="architect-blockers">
          {gate.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>
      )}

      {gate.destructive.length > 0 && (
        <div className="architect-destructive">
          <p><AlertTriangle size={12} /> These could lose data that is already there.</p>
          <ul>
            {gate.destructive.map((operation) => (
              <li key={operation.subject}><code>{operation.subject}</code> — {operation.statement}</li>
            ))}
          </ul>
        </div>
      )}

      <table className="architect-tables">
        <thead>
          <tr><th>Table</th><th>Columns</th><th>Who can do what</th></tr>
        </thead>
        <tbody>
          {gate.summary.tables.map((table) => (
            <tr key={table.name}>
              <td>{table.name}{table.realtime ? ' ·live' : ''}</td>
              <td className="architect-columns">{table.columns}</td>
              <td className="architect-policies">{table.policies}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {gate.summary.buckets.length > 0 && (
        <p className="architect-extras">Storage: {gate.summary.buckets.join(', ')}</p>
      )}
      {gate.summary.functions.length > 0 && (
        <p className="architect-extras">Functions: {gate.summary.functions.join('; ')}</p>
      )}

      {gate.cautions.length > 0 && (
        <ul className="architect-cautions">
          {gate.cautions.map((caution) => <li key={caution}>{caution}</li>)}
        </ul>
      )}

      {safe.length > 0 && (
        <details className="architect-sql">
          <summary>{safe.length} operation{safe.length === 1 ? '' : 's'} to run</summary>
          <ol>
            {safe.map((operation) => (
              <li key={`${operation.kind}:${operation.subject}`}><code>{operation.statement}</code></li>
            ))}
          </ol>
        </details>
      )}

      {gate.blueprint.notes?.length ? (
        <ul className="architect-notes">
          {gate.blueprint.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}

      <div className="architect-actions">
        <button className="primary" onClick={onApprove} disabled={!gate.approvable || applying}>
          {applying ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
          {applying ? 'Applying…' : 'Approve and apply'}
        </button>
        <button onClick={onDiscard} disabled={applying}><Trash2 size={12} /> Discard</button>
      </div>
    </section>
  )
}

export default ArchitectPanel
