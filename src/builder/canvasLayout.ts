/**
 * Where a block and its pins sit, and what a dragged block would snap onto.
 *
 * Pure geometry, kept out of the component so the snapping rules can be
 * tested as rules rather than through a rendered canvas -- and so the palette
 * can name the drag payload without importing the canvas.
 */

import type { BlockGraph, BlockRegistry, Connection, Port } from './blockSchema'
import { incoming } from './graph'

export const NODE_WIDTH = 216
export const HEADER_HEIGHT = 30
export const ROW_HEIGHT = 26

/** Dropped blocks and dragged blocks land on this grid. */
export const GRID = 8
/** How close two pins must be before a block snaps onto the chain. */
export const SNAP_RADIUS = 56
/** The drag payload a palette item carries. */
export const BLOCK_DRAG_TYPE = 'application/x-tungsten-block'

/** A join the canvas is offering: these two pins, with the block moved here. */
export type Snap = { from: Connection['from']; to: Connection['to']; position: { x: number; y: number } }

/** Rounds a canvas coordinate onto the grid, never off the left or top edge. */
export const round = (value: number) => Math.max(0, Math.round(value / GRID) * GRID)

/** The ports of one side of a block, in the order they are drawn. */
export function portsOf(registry: BlockRegistry, type: string, side: 'in' | 'out'): Port[] {
  const definition = registry.get(type)
  if (!definition) return []
  return side === 'in' ? definition.inputs : [...definition.outputs, ...(definition.slots ?? [])]
}

/** Where a pin sits, given where its block is. */
export function pinOffset(registry: BlockRegistry, type: string, portId: string, side: 'in' | 'out') {
  const index = portsOf(registry, type, side).findIndex((port) => port.id === portId)
  if (index < 0) return undefined
  return { dx: side === 'in' ? 0 : NODE_WIDTH, dy: HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2 }
}

/** Where a port sits, relative to the canvas. */
export function portPosition(
  graph: BlockGraph,
  registry: BlockRegistry,
  nodeId: string,
  portId: string,
  side: 'in' | 'out',
) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return undefined
  const offset = pinOffset(registry, node.type, portId, side)
  if (!offset) return undefined
  return { x: node.position.x + offset.dx, y: node.position.y + offset.dy }
}

/**
 * Finds the chain this block would click into, if it were dropped here.
 *
 * Only the execution pins snap: those are the ones that read as puzzle studs,
 * and an accidental data link is much harder to notice than an accidental
 * step in the sequence. A pin that is already occupied is not a candidate,
 * so snapping can never silently replace a connection you made on purpose.
 */
export function snapCandidate(
  graph: BlockGraph,
  registry: BlockRegistry,
  nodeId: string,
  position: { x: number; y: number },
): Snap | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return undefined

  const execIn = portsOf(registry, node.type, 'in').find((port) => port.type === 'Exec')
  if (!execIn || incoming(graph, nodeId, execIn.id)) return undefined
  const offset = pinOffset(registry, node.type, execIn.id, 'in')
  if (!offset) return undefined

  const pin = { x: position.x + offset.dx, y: position.y + offset.dy }
  let best: (Snap & { distance: number }) | undefined

  for (const other of graph.nodes) {
    if (other.id === nodeId) continue
    for (const port of portsOf(registry, other.type, 'out')) {
      if (port.type !== 'Exec') continue
      const taken = graph.connections.some((link) => link.from.node === other.id && link.from.port === port.id)
      if (taken) continue
      const target = portPosition(graph, registry, other.id, port.id, 'out')
      if (!target) continue
      const distance = Math.hypot(target.x - pin.x, target.y - pin.y)
      if (distance > SNAP_RADIUS || (best && distance >= best.distance)) continue
      best = {
        distance,
        from: { node: other.id, port: port.id },
        to: { node: nodeId, port: execIn.id },
        // Line the two pins up exactly, so the pieces read as joined.
        position: { x: Math.max(0, target.x - offset.dx), y: Math.max(0, target.y - offset.dy) },
      }
    }
  }
  return best && { from: best.from, to: best.to, position: best.position }
}

