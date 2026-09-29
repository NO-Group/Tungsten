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

/**
 * What a snapshot contains is the caller's business.
 *
 * It began as the graph alone, which quietly excluded the app's variables
 * from undo: adding one and pressing Ctrl+Z put the blocks back and left
 * the declaration behind. Making the stack generic means the caller
 * decides what "the document" is, and cannot forget part of it.
 */

/** How many steps back the canvas remembers. */
export const HISTORY_LIMIT = 100
/** Mutations with the same key this close together count as one gesture. */
export const COALESCE_WINDOW = 600

export type History<T> = {
  past: T[]
  future: T[]
  /** The key and time of the last recorded mutation, for coalescing. */
  last?: { key: string; at: number }
}

export const EMPTY_HISTORY: History<never> = { past: [], future: [] }

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
export function record<T>(history: History<T>, previous: T, options: RecordOptions = {}): History<T> {
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

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

/** Steps back. The current graph goes onto the redo stack. */
export function undo<T>(history: History<T>, current: T): { history: History<T>; snapshot: T } | undefined {
  if (!history.past.length) return undefined
  const snapshot = history.past[history.past.length - 1]
  return {
    snapshot,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      // A gesture cannot continue across an undo.
      last: undefined,
    },
  }
}

/** Steps forward again. */
export function redo<T>(history: History<T>, current: T): { history: History<T>; snapshot: T } | undefined {
  if (!history.future.length) return undefined
  const snapshot = history.future[history.future.length - 1]
  return {
    snapshot,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      last: undefined,
    },
  }
}
