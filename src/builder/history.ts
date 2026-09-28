/**
 * Undo for the canvas.
 *
 * A graph is small and immutable, so history is a stack of whole graphs
 * rather than a stack of inverse operations: there is no operation whose
 * inverse can be got wrong, and a restored graph is exactly the graph that
 * was there.
 *
 * The one subtlety is coalescing. Dragging a block fires a mutation per
 * mouse move and typing in a port fires one per keystroke; without
 * coalescing, one gesture would take fifty undos to unwind. Consecutive
 * mutations that carry the same `coalesce` key inside the window collapse
 * into the single snapshot taken before the gesture began.
 */

import type { BlockGraph } from './blockSchema'

/** How many steps back the canvas remembers. */
export const HISTORY_LIMIT = 100
/** Mutations with the same key this close together count as one gesture. */
export const COALESCE_WINDOW = 600

export type History = {
  past: BlockGraph[]
  future: BlockGraph[]
  /** The key and time of the last recorded mutation, for coalescing. */
  last?: { key: string; at: number }
}

export const EMPTY_HISTORY: History = { past: [], future: [] }

export type RecordOptions = {
  /** Mutations sharing this key collapse into one step. */
  coalesce?: string
  /** Now, injected so the rule can be tested without waiting. */
  at?: number
}

/**
 * Records the graph as it was before a mutation.
 *
 * Called with the *previous* graph, not the next one: undo restores what was
 * there, and redo is rebuilt from the graph that is current at the time.
 */
export function record(history: History, previous: BlockGraph, options: RecordOptions = {}): History {
  const { coalesce, at = Date.now() } = options
  const continues = Boolean(
    coalesce
    && history.last
    && history.last.key === coalesce
    && at - history.last.at <= COALESCE_WINDOW
    && history.past.length,
  )

  // Part of the same gesture: keep the snapshot from before it started, and
  // only move the clock forward so a long drag stays one step.
  if (continues) {
    return { ...history, future: [], last: { key: coalesce!, at } }
  }

  const past = [...history.past, previous].slice(-HISTORY_LIMIT)
  return { past, future: [], last: coalesce ? { key: coalesce, at } : undefined }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}

export function canRedo(history: History): boolean {
  return history.future.length > 0
}

/** Steps back. The current graph goes onto the redo stack. */
export function undo(history: History, current: BlockGraph): { history: History; graph: BlockGraph } | undefined {
  if (!history.past.length) return undefined
  const graph = history.past[history.past.length - 1]
  return {
    graph,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      // A gesture cannot continue across an undo.
      last: undefined,
    },
  }
}

/** Steps forward again. */
export function redo(history: History, current: BlockGraph): { history: History; graph: BlockGraph } | undefined {
  if (!history.future.length) return undefined
  const graph = history.future[history.future.length - 1]
  return {
    graph,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      last: undefined,
    },
  }
}
