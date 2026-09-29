/**
 * Selecting more than one block.
 *
 * Everything the canvas does to a block -- move it, copy it, delete it,
 * nudge it -- should work on a handful of blocks as readily as on one, and
 * the difference between those two cases should not be spread through the
 * event handlers. So the selection is a set, the operations take sets, and
 * the rules about what a click means live here rather than in the DOM.
 */

import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT, portsOf } from './canvasLayout'
import type { BlockGraph, BlockNode, BlockRegistry } from './blockSchema'

export type Rect = { x: number; y: number; width: number; height: number }

/** How tall a block is drawn: header plus a row per port. */
export function nodeHeight(registry: BlockRegistry, type: string): number {
  const rows = portsOf(registry, type, 'in').length + portsOf(registry, type, 'out').length
  return HEADER_HEIGHT + Math.max(1, rows) * ROW_HEIGHT
}

export function nodeBounds(registry: BlockRegistry, node: BlockNode): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: NODE_WIDTH,
    height: nodeHeight(registry, node.type),
  }
}

/** A rectangle from two corners, in either order. */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Which blocks a marquee has caught.
 *
 * Touching counts, rather than requiring full containment: dragging a box
 * that clips the edge of a block and not selecting it feels broken, and
 * every editor that has tried the stricter rule has been asked to change it.
 */
export function nodesInRect(graph: BlockGraph, registry: BlockRegistry, rect: Rect): string[] {
  return graph.nodes
    .filter((node) => overlaps(rect, nodeBounds(registry, node)))
    .map((node) => node.id)
}

/**
 * What a click on a block means for the selection.
 *
 * Shift or the platform modifier adds and removes; a plain click replaces,
 * except on something already selected -- dragging a group must not collapse
 * it to the one block the pointer happened to land on.
 */
export function selectionAfterClick(
  current: readonly string[],
  id: string,
  modifiers: { additive?: boolean } = {},
): string[] {
  if (modifiers.additive) {
    return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
  }
  return current.includes(id) ? [...current] : [id]
}

/** Adds a marquee's catch to what was already selected, without duplicates. */
export function mergeSelection(current: readonly string[], caught: readonly string[]): string[] {
  const seen = new Set(current)
  return [...current, ...caught.filter((id) => !seen.has(id))]
}

/** Drops ids that are no longer in the graph, after a delete or an undo. */
export function pruneSelection(current: readonly string[], graph: BlockGraph): string[] {
  const alive = new Set(graph.nodes.map((node) => node.id))
  return current.filter((id) => alive.has(id))
}

/** The box that contains everything selected, for framing or for tidying. */
export function selectionBounds(
  graph: BlockGraph,
  registry: BlockRegistry,
  selection: readonly string[],
): Rect | undefined {
  const bounds = graph.nodes
    .filter((node) => selection.includes(node.id))
    .map((node) => nodeBounds(registry, node))
  if (!bounds.length) return undefined

  const x = Math.min(...bounds.map((entry) => entry.x))
  const y = Math.min(...bounds.map((entry) => entry.y))
  return {
    x,
    y,
    width: Math.max(...bounds.map((entry) => entry.x + entry.width)) - x,
    height: Math.max(...bounds.map((entry) => entry.y + entry.height)) - y,
  }
}
