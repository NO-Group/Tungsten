/**
 * The permission engine.
 *
 * An assistant that can edit your files is a dangerous thing to get subtly
 * wrong, so the rule about who may write is not spread through the UI: it is
 * one function, `mayMutate`, and every path that could change a buffer goes
 * through a proposal that names its mode. A provider cannot write to
 * anything. It returns text; this decides what happens to it.
 *
 *   Advisor    — answers in the panel. Nothing else. Cannot touch a buffer.
 *   Diff       — prepares an edit and shows it. Applied only when accepted.
 *   Autonomous — applies as it streams, and says what it did.
 *
 * Pure: no editor, no network, no React. What the modes mean is decided here
 * and tested here.
 */

export type AiMode = 'advisor' | 'diff' | 'autonomous'

export const AI_MODES: Array<{ id: AiMode; label: string; detail: string }> = [
  { id: 'advisor', label: 'Advisor', detail: 'Answers in the panel. Never edits.' },
  { id: 'diff', label: 'Diff preview', detail: 'Shows the change; you accept or discard.' },
  { id: 'autonomous', label: 'Autonomous', detail: 'Edits the buffer as it answers.' },
]

/** What the editor hands the assistant. */
export type AiContext = {
  path: string
  /** The whole file. */
  buffer: string
  /** The selected text, empty when nothing is selected. */
  selection: string
  /** 1-based, inclusive. Equal when the selection is empty. */
  startLine: number
  endLine: number
  language: string
}

/** What a provider produces. Text only; it never applies anything. */
export type AiProposal = {
  /** Prose for the panel. Always present. */
  answer: string
  /**
   * A replacement for the selected lines, when the request implies an edit.
   * Absent means "this was a question", and no mode will write anything.
   */
  replacement?: string
  /** One line naming what the edit does, for the accept prompt. */
  summary?: string
}

export type AiTurn = {
  id: number
  prompt: string
  mode: AiMode
  context: AiContext
  /** Streamed in as it arrives. */
  answer: string
  proposal?: AiProposal
  state: 'streaming' | 'proposed' | 'applied' | 'answered' | 'discarded' | 'failed'
  error?: string
}

/** The one rule: may a turn in this mode change the buffer at all? */
export function mayMutate(mode: AiMode): boolean {
  return mode !== 'advisor'
}

/** And may it do so without being asked again? */
export function appliesImmediately(mode: AiMode): boolean {
  return mode === 'autonomous'
}

/**
 * Replaces the selected lines with new text.
 *
 * Line-based rather than offset-based because that is what the editor
 * reports and what a person sees; an off-by-one here would silently eat a
 * line of someone's file, so the bounds are clamped and tested.
 */
export function applyReplacement(context: AiContext, replacement: string): string {
  const lines = context.buffer.split('\n')
  const start = Math.max(1, Math.min(context.startLine, lines.length))
  const end = Math.max(start, Math.min(context.endLine, lines.length))
  return [
    ...lines.slice(0, start - 1),
    ...replacement.split('\n'),
    ...lines.slice(end),
  ].join('\n')
}

/**
 * What the buffer would become if this turn were applied.
 *
 * Returns the buffer unchanged when the mode is not allowed to write or the
 * provider did not propose an edit -- so a caller cannot accidentally apply
 * an advisor answer by reading the wrong field.
 */
export function previewOf(turn: AiTurn): string {
  if (!mayMutate(turn.mode) || !turn.proposal?.replacement) return turn.context.buffer
  return applyReplacement(turn.context, turn.proposal.replacement)
}

/** The lines a turn is about, as a 1-based inclusive range, for the header. */
export function describeRange(context: AiContext): string {
  if (!context.selection.trim()) return 'the whole file'
  if (context.startLine === context.endLine) return `line ${context.startLine}`
  return `lines ${context.startLine}–${context.endLine}`
}

/** Folds a streamed chunk into a turn. */
export function withChunk(turn: AiTurn, chunk: string): AiTurn {
  return { ...turn, answer: turn.answer + chunk }
}

/**
 * Settles a turn once the stream ends.
 *
 * This is where the permission tiers actually differ, and the only place
 * they do.
 */
export function settle(turn: AiTurn, proposal: AiProposal): AiTurn {
  const next = { ...turn, proposal, answer: proposal.answer || turn.answer }
  if (!proposal.replacement || !mayMutate(turn.mode)) return { ...next, state: 'answered' }
  return { ...next, state: appliesImmediately(turn.mode) ? 'applied' : 'proposed' }
}
