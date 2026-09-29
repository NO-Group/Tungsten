/**
 * Undo, as rules.
 *
 * The interesting part is coalescing: a drag or a burst of typing has to
 * undo as one gesture, and two separate edits must not.
 */

import { describe, expect, it } from 'vitest'

import {
  COALESCE_WINDOW, EMPTY_HISTORY, HISTORY_LIMIT, canRedo, canUndo, record, redo, undo,
} from './history'
import type { History } from './history'
import type { BlockGraph } from './blockSchema'

/** Graphs are compared by identity here; the contents do not matter. */
const graph = (tag: string): BlockGraph => ({ nodes: [{ id: tag } as never], connections: [] })

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false)
    expect(canRedo(EMPTY_HISTORY)).toBe(false)
    expect(undo(EMPTY_HISTORY, graph('a'))).toBeUndefined()
    expect(redo(EMPTY_HISTORY, graph('a'))).toBeUndefined()
  })

  it('steps back to the graph that was replaced', () => {
    const history = record(EMPTY_HISTORY, graph('first'))
    const step = undo(history, graph('second'))
    expect(step?.snapshot.nodes[0].id).toBe('first')
    expect(canUndo(step!.history)).toBe(false)
    expect(canRedo(step!.history)).toBe(true)
  })

  it('steps forward again to exactly what was undone', () => {
    const history = record(EMPTY_HISTORY, graph('first'))
    const back = undo(history, graph('second'))!
    const forward = redo(back.history, back.snapshot)!
    expect(forward.snapshot.nodes[0].id).toBe('second')
    expect(canUndo(forward.history)).toBe(true)
  })

  it('collapses one gesture into one step', () => {
    // A drag: many mutations, same key, close together.
    let history = record(EMPTY_HISTORY, graph('before'), { coalesce: 'move:1', at: 1000 })
    history = record(history, graph('during-1'), { coalesce: 'move:1', at: 1040 })
    history = record(history, graph('during-2'), { coalesce: 'move:1', at: 1080 })

    expect(history.past).toHaveLength(1)
    expect(undo(history, graph('after'))?.snapshot.nodes[0].id).toBe('before')
  })

  it('starts a new step once the gesture has paused', () => {
    let history = record(EMPTY_HISTORY, graph('a'), { coalesce: 'move:1', at: 1000 })
    history = record(history, graph('b'), { coalesce: 'move:1', at: 1000 + COALESCE_WINDOW + 1 })
    expect(history.past).toHaveLength(2)
  })

  it('does not collapse edits to different things', () => {
    let history = record(EMPTY_HISTORY, graph('a'), { coalesce: 'move:1', at: 1000 })
    history = record(history, graph('b'), { coalesce: 'move:2', at: 1010 })
    expect(history.past).toHaveLength(2)
  })

  it('never collapses an unkeyed mutation', () => {
    let history = record(EMPTY_HISTORY, graph('a'), { at: 1000 })
    history = record(history, graph('b'), { at: 1001 })
    expect(history.past).toHaveLength(2)
  })

  it('drops the redo stack once a new edit lands', () => {
    const history = record(EMPTY_HISTORY, graph('a'))
    const back = undo(history, graph('b'))!
    expect(canRedo(back.history)).toBe(true)
    expect(canRedo(record(back.history, graph('c')))).toBe(false)
  })

  it('does not let a gesture continue across an undo', () => {
    let history = record(EMPTY_HISTORY, graph('a'), { coalesce: 'move:1', at: 1000 })
    history = undo(history, graph('b'))!.history
    history = record(history, graph('c'), { coalesce: 'move:1', at: 1010 })
    expect(history.past).toHaveLength(1)
  })

  it('remembers a bounded number of steps', () => {
    let history: History<BlockGraph> = EMPTY_HISTORY
    for (let step = 0; step < HISTORY_LIMIT + 25; step += 1) history = record(history, graph(`s${step}`))
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    // The oldest were dropped, the newest kept.
    expect(history.past[history.past.length - 1].nodes[0].id).toBe(`s${HISTORY_LIMIT + 24}`)
  })
})
