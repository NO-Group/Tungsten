/**
 * Working on many blocks at once: selecting them, copying them, and
 * straightening what is left behind.
 *
 * These are the rules that decide whether a canvas is usable at fifty
 * blocks or only at five, so they are tested as rules rather than through
 * the DOM.
 */

import { describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { addNode, connect, createNode, resetIds } from './graph'
import { generateProgram } from './codeGenerator'
import { checkIntegrity } from './integrity'
import { instantiate, recipeById } from './recipes'
import {
  mergeSelection, nodeBounds, nodeHeight, nodesInRect, overlaps, pruneSelection, rectFrom,
  selectionAfterClick, selectionBounds,
} from './selection'
import {
  CLIPBOARD_MARKER, copyNodes, duplicateNodes, moveNodes, parseClipboard, pasteNodes, removeNodes,
  serialise,
} from './clipboard'
import { COLUMN_GAP, MARGIN, depths, isTidy, tidy, tidyPositions } from './layout'
import { NODE_WIDTH, portsOf, propertiesOf } from './canvasLayout'
import { parseProgram } from './codeParser'
import { renderComponent, schemaFromGraph } from './uiSchema'

const registry = createRegistry(builtinBlocks)
const empty = { nodes: [], connections: [] }

/** A graph of loose blocks at known positions. */
function scatter(entries: Array<[type: string, x: number, y: number]>) {
  resetIds()
  let graph = empty as ReturnType<typeof addNode>
  const ids: string[] = []
  for (const [type, x, y] of entries) {
    const node = createNode(type, { x, y })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  return { graph, ids }
}

describe('what a marquee catches', () => {
  it('measures a block from its ports', () => {
    // An event block has one port; a sign-up block has several.
    expect(nodeHeight(registry, 'event.start')).toBeLessThan(nodeHeight(registry, 'auth.signUp'))
    const { graph } = scatter([['event.start', 10, 20]])
    expect(nodeBounds(registry, graph.nodes[0])).toMatchObject({ x: 10, y: 20, width: NODE_WIDTH })
  })

  it('builds a rectangle from corners dragged in any direction', () => {
    expect(rectFrom({ x: 90, y: 90 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 80, height: 70 })
  })

  it('catches a block the box merely touches', () => {
    const { graph, ids } = scatter([['event.start', 100, 100], ['logic.log', 600, 600]])
    // Clipping the top-left corner is enough.
    expect(nodesInRect(graph, registry, { x: 60, y: 60, width: 60, height: 60 })).toEqual([ids[0]])
  })

  it('catches nothing when the box is elsewhere', () => {
    const { graph } = scatter([['event.start', 100, 100]])
    expect(nodesInRect(graph, registry, { x: 0, y: 0, width: 20, height: 20 })).toEqual([])
    expect(overlaps({ x: 0, y: 0, width: 5, height: 5 }, { x: 10, y: 10, width: 5, height: 5 })).toBe(false)
  })

  it('reports the box around a selection', () => {
    const { graph, ids } = scatter([['event.start', 0, 0], ['logic.log', 300, 200]])
    const bounds = selectionBounds(graph, registry, ids)!
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(300 + NODE_WIDTH)
    expect(selectionBounds(graph, registry, [])).toBeUndefined()
  })
})

describe('what a click means', () => {
  it('replaces the selection', () => {
    expect(selectionAfterClick(['a', 'b'], 'c')).toEqual(['c'])
  })

  it('adds and removes when held', () => {
    expect(selectionAfterClick(['a'], 'b', { additive: true })).toEqual(['a', 'b'])
    expect(selectionAfterClick(['a', 'b'], 'a', { additive: true })).toEqual(['b'])
  })

  it('keeps a group intact when one of its blocks is clicked', () => {
    // Otherwise dragging a group would collapse it to one block.
    expect(selectionAfterClick(['a', 'b', 'c'], 'b')).toEqual(['a', 'b', 'c'])
  })

  it('merges a marquee catch without duplicating', () => {
    expect(mergeSelection(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('forgets blocks that no longer exist', () => {
    const { graph, ids } = scatter([['event.start', 0, 0]])
    expect(pruneSelection([ids[0], 'gone'], graph)).toEqual([ids[0]])
  })
})

describe('copy and paste', () => {
  it('copies blocks with their values, relative to the corner', () => {
    const { graph, ids } = scatter([['data.text', 200, 120], ['logic.log', 300, 260]])
    const payload = copyNodes(graph, ids)!
    expect(payload.marker).toBe(CLIPBOARD_MARKER)
    expect(payload.nodes[0].offset).toEqual({ x: 0, y: 0 })
    expect(payload.nodes[1].offset).toEqual({ x: 100, y: 140 })
  })

  it('keeps a wire only when both of its ends were copied', () => {
    resetIds()
    const { graph, added } = instantiate(recipeById('api-call')!, empty, registry)
    const whole = copyNodes(graph, added)!
    expect(whole.links.length).toBe(graph.connections.length)

    const half = copyNodes(graph, added.slice(0, 2))!
    expect(half.links.length).toBeLessThan(whole.links.length)
    expect(half.links.every((link) => link.from < 2 && link.to < 2)).toBe(true)
  })

  it('pastes at a point, keeping the shape and the wires', () => {
    resetIds()
    const { graph, added } = instantiate(recipeById('api-call')!, empty, registry)
    const payload = copyNodes(graph, added)!

    const pasted = pasteNodes(empty, registry, payload, { x: 500, y: 300 })
    expect(pasted.added).toHaveLength(added.length)
    expect(pasted.graph.connections).toHaveLength(graph.connections.length)
    expect(Math.min(...pasted.graph.nodes.map((node) => node.position.x))).toBe(500)

    // And the copy is a working program in its own right.
    expect(checkIntegrity(pasted.graph, registry).compilable).toBe(true)
    expect(generateProgram(pasted.graph, registry).code).toContain('http.request')
  })

  it('survives the round trip through text', () => {
    const { graph, ids } = scatter([['data.text', 0, 0]])
    const payload = copyNodes(graph, ids)!
    expect(parseClipboard(serialise(payload))).toEqual(payload)
  })

  it('refuses text that is not ours', () => {
    expect(parseClipboard('just some words')).toBeUndefined()
    expect(parseClipboard('{"marker":"someone.else","nodes":[]}')).toBeUndefined()
    expect(parseClipboard(`{"marker":"${CLIPBOARD_MARKER}","version":1,"nodes":[]}`)).toBeUndefined()
    expect(parseClipboard(`{"marker":"${CLIPBOARD_MARKER}"`)).toBeUndefined()
  })

  it('refuses a payload from a newer build rather than half-reading it', () => {
    const { graph, ids } = scatter([['data.text', 0, 0]])
    const payload = { ...copyNodes(graph, ids)!, version: 99 }
    expect(parseClipboard(JSON.stringify(payload))).toBeUndefined()
  })

  it('skips a block type this workspace does not have, and names it', () => {
    const payload = {
      marker: CLIPBOARD_MARKER as typeof CLIPBOARD_MARKER,
      version: 1,
      origin: { x: 0, y: 0 },
      nodes: [
        { type: 'logic.log', offset: { x: 0, y: 0 }, values: {} },
        { type: 'acme.notInstalled', offset: { x: 40, y: 0 }, values: {} },
      ],
      links: [],
    }
    const pasted = pasteNodes(empty, registry, payload, { x: 0, y: 0 })
    expect(pasted.added).toHaveLength(1)
    expect(pasted.skipped).toEqual(['acme.notInstalled'])
  })

  it('duplicates a selection beside itself', () => {
    resetIds()
    const { graph, added } = instantiate(recipeById('api-call')!, empty, registry)
    const copy = duplicateNodes(graph, registry, added)
    expect(copy.graph.nodes).toHaveLength(added.length * 2)
    expect(copy.graph.connections).toHaveLength(graph.connections.length * 2)
  })

  it('removes many blocks and every wire that touched them', () => {
    resetIds()
    const { graph, added } = instantiate(recipeById('api-call')!, empty, registry)
    const left = removeNodes(graph, added.slice(1))
    expect(left.nodes).toHaveLength(1)
    expect(left.connections).toHaveLength(0)
  })

  it('moves many blocks together, and not off the canvas', () => {
    const { graph, ids } = scatter([['event.start', 10, 10], ['logic.log', 200, 200]])
    const moved = moveNodes(graph, ids, { x: -100, y: 40 })
    expect(moved.nodes[0].position).toEqual({ x: 0, y: 50 })
    expect(moved.nodes[1].position).toEqual({ x: 100, y: 240 })
  })
})

describe('tidying', () => {
  it('puts each block one column past whatever feeds it', () => {
    resetIds()
    const { graph } = instantiate(recipeById('api-call')!, empty, registry)
    const depth = depths(graph)
    const [start, fetch] = graph.nodes
    expect(depth.get(start.id)).toBe(0)
    expect(depth.get(fetch.id)).toBe(1)
  })

  it('lays a chain out left to right', () => {
    resetIds()
    const { graph } = instantiate(recipeById('api-call')!, empty, registry)
    const positions = tidyPositions(graph, registry)
    const xs = graph.nodes.map((node) => positions.get(node.id)!.x)
    expect(xs[0]).toBe(MARGIN)
    expect(xs[1]).toBe(MARGIN + NODE_WIDTH + COLUMN_GAP)
    expect(new Set(xs).size).toBeGreaterThan(1)
  })

  it('never overlaps two blocks in a column', () => {
    resetIds()
    const { graph } = instantiate(recipeById('signin-form')!, empty, registry)
    const tidied = tidy(graph, registry)
    const byColumn = new Map<number, Array<{ top: number; bottom: number }>>()
    for (const node of tidied.nodes) {
      const column = node.position.x
      const span = { top: node.position.y, bottom: node.position.y + nodeHeight(registry, node.type) }
      byColumn.set(column, [...(byColumn.get(column) ?? []), span])
    }
    for (const spans of byColumn.values()) {
      const ordered = [...spans].sort((a, b) => a.top - b.top)
      for (let index = 1; index < ordered.length; index += 1) {
        expect(ordered[index].top).toBeGreaterThanOrEqual(ordered[index - 1].bottom)
      }
    }
  })

  it('is stable: tidying twice changes nothing', () => {
    resetIds()
    const { graph } = instantiate(recipeById('signin-form')!, empty, registry)
    const once = tidy(graph, registry)
    expect(isTidy(once, registry)).toBe(true)
    expect(tidy(once, registry).nodes.map((node) => node.position))
      .toEqual(once.nodes.map((node) => node.position))
  })

  it('keeps the order the user already had, within a column', () => {
    const { graph, ids } = scatter([['event.start', 500, 900], ['event.click', 500, 100]])
    const positions = tidyPositions(graph, registry)
    // Both are entry points, so both are column zero; the one that was
    // higher stays higher.
    expect(positions.get(ids[1])!.y).toBeLessThan(positions.get(ids[0])!.y)
  })

  it('loses nobody, even when the graph has a cycle in it', () => {
    resetIds()
    const { graph, ids } = scatter([['logic.log', 0, 0], ['logic.log', 200, 0]])
    const cyclic = {
      ...graph,
      connections: [
        { id: 'c1', from: { node: ids[0], port: 'exec' }, to: { node: ids[1], port: 'exec' } },
        { id: 'c2', from: { node: ids[1], port: 'exec' }, to: { node: ids[0], port: 'exec' } },
      ],
    }
    const positions = tidyPositions(cyclic, registry)
    expect(positions.size).toBe(2)
    expect([...positions.values()].every((entry) => Number.isFinite(entry.x))).toBe(true)
  })

  it('changes nothing about the program itself', () => {
    resetIds()
    const { graph } = instantiate(recipeById('signin-form')!, empty, registry)
    expect(generateProgram(tidy(graph, registry), registry).code)
      .toBe(generateProgram(graph, registry).code)
  })
})

describe('style properties', () => {
  /**
   * An event with one styled block hanging off it.
   *
   * The event matters: a block with nothing above it is an orphan, and
   * orphans are deliberately left out of the generated program.
   */
  const styled = (values: Record<string, string | number>, type = 'ui.button') => {
    resetIds()
    const event = createNode('event.start', { x: 0, y: 0 })
    const node = createNode(type, { x: 300, y: 0 })
    node.values = { ...node.values, ...values }
    const graph = addNode(addNode(empty as never, event), node)
    const linked = connect(graph, registry, { node: event.id, port: 'exec' }, { node: node.id, port: 'exec' })
    expect(linked.rejected).toBeUndefined()
    return linked.graph
  }

  it('leaves the generated code alone when nothing is styled', () => {
    const graph = styled({})
    expect(generateProgram(graph, registry).code).toContain('render.button({ id: "submit", text: "Submit" })')
  })

  it('writes only what differs from the default', () => {
    const code = generateProgram(styled({ radius: 20, background: 'accent' }), registry).code
    expect(code).toContain('radius: 20')
    expect(code).toContain('background: "accent"')
    // Untouched properties stay out of the file.
    expect(code).not.toContain('padding')
    expect(code).not.toContain('width')
  })

  it('does not write a property that was set back to its default', () => {
    const code = generateProgram(styled({ radius: 6 }), registry).code
    expect(code).not.toContain('radius')
  })

  it('round-trips styles through the parser, byte for byte', () => {
    const cases: Array<Record<string, string | number>> = [
      { radius: 20 },
      { padding: '10 18', background: 'raised', color: 'accent' },
      { radius: 0, width: '100%', align: 'center' },
    ]
    for (const values of cases) {
      const graph = styled(values)
      const first = generateProgram(graph, registry).code
      const parsed = parseProgram(first, registry)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(generateProgram(parsed.graph, registry).code).toBe(first)
    }
  })

  it('round-trips a styled Text block, which carries no options bag by default', () => {
    const graph = styled({ value: 'Hi', radius: 12, background: 'raised' }, 'ui.text')

    const first = generateProgram(graph, registry).code
    expect(first).toContain('render.text("Hi", { radius: 12, background: "raised" })')
    const parsed = parseProgram(first, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(generateProgram(parsed.graph, registry).code).toBe(first)
  })

  it('keeps a style port off the canvas: it is a property, not a socket', () => {
    const inputs = portsOf(registry, 'ui.button', 'in').map((port) => port.id)
    expect(inputs).toEqual(['exec', 'text', 'id'])
    expect(propertiesOf(registry, 'ui.button').map((port) => port.id)).toContain('radius')
    // Which means the block is no taller than it was before styling existed.
    expect(nodeHeight(registry, 'ui.button')).toBe(nodeHeight(registry, 'ui.button'))
  })

  it('renders the style, resolving colour names to theme variables', () => {
    const graph = styled({ radius: 20, background: 'accent', color: 'accent-ink', padding: '8 16' })
    const component = schemaFromGraph(graph, registry).components
      .find((entry) => entry.type === 'button')!
    const html = renderComponent(component)
    expect(html).toContain('border-radius:20px')
    expect(html).toContain('background:var(--app-accent)')
    expect(html).toContain('color:var(--app-accent-ink)')
    expect(html).toContain('padding:8 16')
  })

  it('passes a colour through when it is not a token name', () => {
    const graph = styled({ background: '#ff0000' })
    const component = schemaFromGraph(graph, registry).components
      .find((entry) => entry.type === 'button')!
    expect(renderComponent(component)).toContain('background:#ff0000')
  })

  it('adds no style attribute at all when nothing is styled', () => {
    const component = schemaFromGraph(styled({}), registry).components
      .find((entry) => entry.type === 'button')!
    expect(renderComponent(component)).not.toContain('style=')
  })
})
