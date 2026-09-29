/**
 * Copying blocks, and pasting them somewhere else.
 *
 * The payload is JSON with a marker in it, which buys two things beyond an
 * in-memory copy: a selection can be pasted into another window or another
 * workspace, and text that came from somewhere else can be recognised as
 * not ours and refused rather than parsed into nonsense.
 *
 * Positions are stored relative to the top-left of what was copied, so a
 * paste lands where the pointer is with its shape intact. Connections are
 * kept only when both ends were copied: half a wire is worse than none,
 * and pasting one would silently attach to whatever block happened to
 * inherit the id.
 */

import { addNode, connect, createNode } from './graph'
import type { BlockGraph, BlockNode, BlockRegistry, Connection } from './blockSchema'

/** Bumped only if the shape changes in a way an older reader would misread. */
export const CLIPBOARD_VERSION = 1
export const CLIPBOARD_MARKER = 'tungsten.builder.blocks'

export type ClipboardNode = {
  type: string
  /** Relative to the top-left corner of the copied selection. */
  offset: { x: number; y: number }
  values: BlockNode['values']
}

export type ClipboardPayload = {
  marker: typeof CLIPBOARD_MARKER
  version: number
  /** Where the selection sat when it was copied, so a paste lands near it. */
  origin: { x: number; y: number }
  nodes: ClipboardNode[]
  /** Indexes into `nodes`, so ids never leave the graph they came from. */
  links: Array<{ from: number; fromPort: string; to: number; toPort: string }>
}

/** Builds a payload from a selection. Returns undefined when nothing is selected. */
export function copyNodes(graph: BlockGraph, selection: readonly string[]): ClipboardPayload | undefined {
  const chosen = graph.nodes.filter((node) => selection.includes(node.id))
  if (!chosen.length) return undefined

  const left = Math.min(...chosen.map((node) => node.position.x))
  const top = Math.min(...chosen.map((node) => node.position.y))
  const index = new Map(chosen.map((node, position) => [node.id, position]))

  return {
    marker: CLIPBOARD_MARKER,
    version: CLIPBOARD_VERSION,
    origin: { x: left, y: top },
    nodes: chosen.map((node) => ({
      type: node.type,
      offset: { x: node.position.x - left, y: node.position.y - top },
      values: { ...node.values },
    })),
    links: graph.connections
      .filter((link) => index.has(link.from.node) && index.has(link.to.node))
      .map((link) => ({
        from: index.get(link.from.node)!,
        fromPort: link.from.port,
        to: index.get(link.to.node)!,
        toPort: link.to.port,
      })),
  }
}

export function serialise(payload: ClipboardPayload): string {
  return JSON.stringify(payload, null, 2)
}

/**
 * Reads a payload back, or returns undefined.
 *
 * Undefined rather than throwing, because the usual input is whatever the
 * user last copied anywhere at all -- a URL, a line of code -- and that is
 * not an error, it is simply not blocks.
 */
export function parseClipboard(text: string): ClipboardPayload | undefined {
  if (!text.includes(CLIPBOARD_MARKER)) return undefined
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardPayload>
    if (parsed.marker !== CLIPBOARD_MARKER) return undefined
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) return undefined
    // A newer payload may carry fields this build does not know; refusing it
    // outright is friendlier than pasting something half-understood.
    if (typeof parsed.version !== 'number' || parsed.version > CLIPBOARD_VERSION) return undefined

    const nodes = parsed.nodes.filter((node): node is ClipboardNode => (
      Boolean(node) && typeof node.type === 'string'
    )).map((node) => ({
      type: node.type,
      offset: {
        x: Number.isFinite(node.offset?.x) ? node.offset.x : 0,
        y: Number.isFinite(node.offset?.y) ? node.offset.y : 0,
      },
      values: node.values && typeof node.values === 'object' ? node.values : {},
    }))
    if (!nodes.length) return undefined

    const links = (Array.isArray(parsed.links) ? parsed.links : []).filter((link) => (
      Number.isInteger(link?.from) && Number.isInteger(link?.to)
      && link.from >= 0 && link.from < nodes.length
      && link.to >= 0 && link.to < nodes.length
      && typeof link.fromPort === 'string' && typeof link.toPort === 'string'
    ))

    const origin = {
      x: Number.isFinite(parsed.origin?.x) ? parsed.origin!.x : 0,
      y: Number.isFinite(parsed.origin?.y) ? parsed.origin!.y : 0,
    }
    return { marker: CLIPBOARD_MARKER, version: parsed.version, origin, nodes, links }
  } catch {
    return undefined
  }
}

export type PasteResult = {
  graph: BlockGraph
  /** The ids of what was pasted, so the canvas can select it. */
  added: string[]
  /** Types the registry does not know: a plugin that is not installed here. */
  skipped: string[]
}

/**
 * Pastes a payload at a point on the canvas.
 *
 * Blocks whose type this workspace does not have are skipped rather than
 * created as broken nodes, and named, so the reason is visible: pasting
 * between workspaces is exactly when a plugin turns out to be missing.
 */
export function pasteNodes(
  graph: BlockGraph,
  registry: BlockRegistry,
  payload: ClipboardPayload,
  at: { x: number; y: number },
): PasteResult {
  let next = graph
  const added: string[] = []
  const skipped: string[] = []
  const created = new Map<number, string>()

  payload.nodes.forEach((entry, index) => {
    if (!registry.get(entry.type)) {
      if (!skipped.includes(entry.type)) skipped.push(entry.type)
      return
    }
    const node = createNode(entry.type, {
      x: Math.max(0, at.x + entry.offset.x),
      y: Math.max(0, at.y + entry.offset.y),
    })
    node.values = { ...node.values, ...entry.values }
    created.set(index, node.id)
    added.push(node.id)
    next = addNode(next, node)
  })

  for (const link of payload.links) {
    const from = created.get(link.from)
    const to = created.get(link.to)
    if (!from || !to) continue
    const result = connect(next, registry, { node: from, port: link.fromPort }, { node: to, port: link.toPort })
    // A refusal here means the copy was already invalid; the blocks are
    // still worth having, so the wire is dropped rather than the paste.
    if (!result.rejected) next = result.graph
  }

  return { graph: next, added, skipped }
}

/** Removes many blocks, and every wire that touched them. */
export function removeNodes(graph: BlockGraph, ids: readonly string[]): BlockGraph {
  const doomed = new Set(ids)
  if (!doomed.size) return graph
  return {
    nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
    connections: graph.connections.filter((link) => (
      !doomed.has(link.from.node) && !doomed.has(link.to.node)
    )),
  }
}

/** Moves many blocks by the same delta, never off the top or left edge. */
export function moveNodes(
  graph: BlockGraph,
  ids: readonly string[],
  delta: { x: number; y: number },
): BlockGraph {
  const moving = new Set(ids)
  if (!moving.size) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (moving.has(node.id)
      ? { ...node, position: { x: Math.max(0, node.position.x + delta.x), y: Math.max(0, node.position.y + delta.y) } }
      : node)),
  }
}

/** Copy and paste in one step, offset so the copy is visible. */
export function duplicateNodes(
  graph: BlockGraph,
  registry: BlockRegistry,
  selection: readonly string[],
  offset = { x: 32, y: 32 },
): PasteResult {
  const payload = copyNodes(graph, selection)
  if (!payload) return { graph, added: [], skipped: [] }
  return pasteNodes(graph, registry, payload, {
    x: payload.origin.x + offset.x,
    y: payload.origin.y + offset.y,
  })
}

export type Connectionish = Connection
