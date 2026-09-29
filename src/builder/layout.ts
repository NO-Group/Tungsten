/**
 * Tidying the canvas.
 *
 * A graph that has been worked on for an hour is a graph nobody can read:
 * blocks land where they were dropped, wires cross, and the shape of the
 * program stops being visible. Tidy lays it out the way it reads -- flow
 * left to right, one column per step of depth, independent chains stacked
 * in the order they already had.
 *
 * Two properties this deliberately keeps:
 *
 *  - It is stable. Tidying twice changes nothing the second time, and the
 *    relative order of blocks the user arranged by hand is preserved within
 *    a column, so it feels like straightening rather than shuffling.
 *  - It cannot lose a block. Every node in comes out with a position, cycle
 *    or no cycle, which matters because the checker allows a graph to be
 *    invalid while it is being built.
 */

import { NODE_WIDTH } from './canvasLayout'
import { nodeHeight } from './selection'
import type { BlockGraph, BlockRegistry } from './blockSchema'

/** Space between columns and between stacked blocks. */
export const COLUMN_GAP = 84
export const ROW_GAP = 28
export const MARGIN = 40

export type Positions = Map<string, { x: number; y: number }>

/**
 * How deep each node sits: one further than the deepest thing feeding it.
 *
 * Depth is computed over every edge, execution and data alike, because a
 * value a block reads has to be computed before it -- a layout that put the
 * producer to the right of its consumer would draw every wire backwards.
 */
export function depths(graph: BlockGraph): Map<string, number> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const node of graph.nodes) { incoming.set(node.id, []); outgoing.set(node.id, []) }
  for (const link of graph.connections) {
    if (!incoming.has(link.to.node) || !outgoing.has(link.from.node)) continue
    incoming.get(link.to.node)!.push(link.from.node)
    outgoing.get(link.from.node)!.push(link.to.node)
  }

  // Kahn's algorithm, so a cycle simply stops contributing depth instead of
  // spinning: whatever is left over keeps the depth it had reached.
  const remaining = new Map(graph.nodes.map((node) => [node.id, incoming.get(node.id)!.length]))
  const depth = new Map(graph.nodes.map((node) => [node.id, 0]))
  const queue = graph.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id)

  while (queue.length) {
    const id = queue.shift()!
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1))
      const left = (remaining.get(next) ?? 1) - 1
      remaining.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  return depth
}

/**
 * The tidy positions for a whole graph.
 *
 * Returns a map rather than a graph so the caller decides whether this is
 * one undo step, an animation, or a preview.
 */
export function tidyPositions(graph: BlockGraph, registry: BlockRegistry): Positions {
  const depth = depths(graph)
  const columns = new Map<number, typeof graph.nodes>()

  for (const node of graph.nodes) {
    const column = depth.get(node.id) ?? 0
    columns.set(column, [...(columns.get(column) ?? []), node])
  }

  const positions: Positions = new Map()
  for (const [column, nodes] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    // Keep the order the user already had, top to bottom, so tidying reads
    // as straightening rather than as rearranging.
    const ordered = [...nodes].sort((a, b) => (
      a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id)
    ))

    let y = MARGIN
    for (const node of ordered) {
      positions.set(node.id, { x: MARGIN + column * (NODE_WIDTH + COLUMN_GAP), y })
      y += nodeHeight(registry, node.type) + ROW_GAP
    }
  }

  return positions
}

/** Applies tidy positions to a graph. */
export function tidy(graph: BlockGraph, registry: BlockRegistry): BlockGraph {
  const positions = tidyPositions(graph, registry)
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id)
      return position ? { ...node, position } : node
    }),
  }
}

/** True when tidying would change nothing, so the button can be disabled. */
export function isTidy(graph: BlockGraph, registry: BlockRegistry): boolean {
  const positions = tidyPositions(graph, registry)
  return graph.nodes.every((node) => {
    const target = positions.get(node.id)
    return target && target.x === node.position.x && target.y === node.position.y
  })
}
