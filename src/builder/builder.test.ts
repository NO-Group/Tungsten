import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { NODE_WIDTH, snapCandidate } from './canvasLayout'
import { createRegistry, defineBlock, isAssignable, type BlockGraph } from './blockSchema'
import { generateProgram, lineOfNode, nodeAtLine } from './codeGenerator'
import { checkIntegrity, diagnosticsByNode } from './integrity'
import { parseProgram } from './codeParser'
import { objectIn, parseObjectLiteral } from './targets/expressions'
import {
  addNode,
  canConnect,
  connect,
  createNode,
  disconnect,
  incoming,
  liveNodes,
  moveNode,
  nodeById,
  outgoing,
  removeNode,
  resetIds,
  setNodeValue,
} from './graph'

const registry = createRegistry(builtinBlocks)

/** Builds a graph from a terse description, so tests read as diagrams. */
function build(
  nodes: Array<[type: string, x?: number, y?: number]>,
  links: Array<[from: string, fromPort: string, to: string, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const [type, x = 0, y = 0] of nodes) {
    const node = createNode(type, { x, y })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  const at = (token: string) => ids[Number(token)]
  for (const [from, fromPort, to, toPort] of links) {
    const result = connect(
      graph,
      registry,
      { node: at(from), port: fromPort },
      { node: at(to), port: toPort },
    )
    if (result.rejected) throw new Error(`link refused: ${result.rejected}`)
    graph = result.graph
  }
  return { graph, ids }
}

beforeEach(() => resetIds())

describe('block schema', () => {
  it('keeps execution and data apart', () => {
    expect(isAssignable('Exec', 'Exec')).toBe(true)
    expect(isAssignable('Exec', 'Any')).toBe(false)
    expect(isAssignable('Any', 'Exec')).toBe(false)
  })

  it('lets Any stand in for a value in either direction', () => {
    expect(isAssignable('String', 'Any')).toBe(true)
    expect(isAssignable('Any', 'Number')).toBe(true)
    expect(isAssignable('String', 'Number')).toBe(false)
  })

  it('groups the library into the categories the sidebar shows', () => {
    const categories = registry.byCategory().map((group) => group.category)
    expect(categories).toEqual([
      'Events', 'UI', 'Navigation', 'Logic', 'Data', 'Network', 'Auth', 'Storage',
    ])
    expect(registry.all().length).toBe(builtinBlocks.length)
  })

  it('lets a plugin replace a built-in block', () => {
    const override = defineBlock({
      type: 'logic.log',
      label: 'Log to Sentry',
      category: 'Logic',
      description: 'Replacement.',
      inputs: [{ id: 'exec', label: 'Run', type: 'Exec' }],
      outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
      generate: () => 'sentry.log()',
    })
    const extended = createRegistry([...builtinBlocks, override])
    expect(extended.get('logic.log')?.label).toBe('Log to Sentry')
    expect(extended.all().length).toBe(builtinBlocks.length)
  })
})

describe('graph operations', () => {
  it('adds, moves, and removes nodes without mutating the original', () => {
    const { graph, ids } = build([['logic.log', 10, 20]])
    const moved = moveNode(graph, ids[0], { x: 90, y: 90 })
    expect(nodeById(graph, ids[0])?.position).toEqual({ x: 10, y: 20 })
    expect(nodeById(moved, ids[0])?.position).toEqual({ x: 90, y: 90 })
    expect(removeNode(graph, ids[0]).nodes).toHaveLength(0)
  })

  it('removes the links attached to a deleted node', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log']],
      [['0', 'exec', '1', 'exec']],
    )
    expect(removeNode(graph, ids[1]).connections).toHaveLength(0)
  })

  it('stores literal values typed into a port', () => {
    const { graph, ids } = build([['data.text']])
    const next = setNodeValue(graph, ids[0], 'value', 'hello')
    expect(nodeById(next, ids[0])?.values.value).toBe('hello')
  })

  it('refuses a link between incompatible types', () => {
    const { graph, ids } = build([['data.text'], ['logic.math']])
    const check = canConnect(
      graph,
      registry,
      { node: ids[0], port: 'value' },
      { node: ids[1], port: 'left' },
    )
    expect(check.ok).toBe(false)
    expect(check.ok === false && check.reason).toContain('does not fit')
  })

  it('refuses a block wired to itself', () => {
    const { graph, ids } = build([['logic.log']])
    const check = canConnect(
      graph,
      registry,
      { node: ids[0], port: 'exec' },
      { node: ids[0], port: 'exec' },
    )
    expect(check.ok === false && check.reason).toContain('wired to itself')
  })

  it('refuses a link that would close a loop', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log'], ['ui.text']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec']],
    )
    const check = canConnect(
      graph,
      registry,
      { node: ids[2], port: 'exec' },
      { node: ids[1], port: 'exec' },
    )
    expect(check.ok === false && check.reason).toContain('circle')
  })

  it('replaces the value already plugged into an input', () => {
    const { graph, ids } = build([['data.text'], ['data.text'], ['logic.log']])
    const first = connect(graph, registry, { node: ids[0], port: 'value' }, { node: ids[2], port: 'value' }).graph
    const second = connect(first, registry, { node: ids[1], port: 'value' }, { node: ids[2], port: 'value' }).graph
    expect(second.connections).toHaveLength(1)
    expect(incoming(second, ids[2], 'value')?.from.node).toBe(ids[1])
  })

  it('gives an execution output exactly one successor', () => {
    const { graph, ids } = build([['event.start'], ['logic.log'], ['ui.text']])
    const first = connect(graph, registry, { node: ids[0], port: 'exec' }, { node: ids[1], port: 'exec' }).graph
    const second = connect(first, registry, { node: ids[0], port: 'exec' }, { node: ids[2], port: 'exec' }).graph
    expect(outgoing(second, ids[0], 'exec')).toHaveLength(1)
    expect(outgoing(second, ids[0], 'exec')[0].to.node).toBe(ids[2])
  })

  it('refuses a duplicate of a link that already exists', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log']],
      [['0', 'exec', '1', 'exec']],
    )
    const check = canConnect(
      graph,
      registry,
      { node: ids[0], port: 'exec' },
      { node: ids[1], port: 'exec' },
    )
    expect(check.ok === false && check.reason).toContain('already connected')
  })

  it('disconnects by link id', () => {
    const { graph } = build([['event.start'], ['logic.log']], [['0', 'exec', '1', 'exec']])
    expect(disconnect(graph, graph.connections[0].id).connections).toHaveLength(0)
  })

  it('counts a node reached from an event as live', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log'], ['data.text']],
      [['0', 'exec', '1', 'exec'], ['2', 'value', '1', 'value']],
    )
    const live = liveNodes(graph, registry)
    expect(live.has(ids[1])).toBe(true)
    expect(live.has(ids[2])).toBe(true)
  })

  it('does not count a node merely fed by a live node as live', () => {
    // A query whose rows nobody reads: reachable on paper, dead in practice.
    const { graph, ids } = build(
      [['event.start'], ['data.query'], ['logic.forEach']],
      [['0', 'exec', '1', 'exec'], ['1', 'rows', '2', 'list']],
    )
    const live = liveNodes(graph, registry)
    expect(live.has(ids[1])).toBe(true)
    expect(live.has(ids[2])).toBe(false)
  })
})

describe('code generator', () => {
  it('says so when there is nothing to generate', () => {
    const { code } = generateProgram({ nodes: [], connections: [] }, registry)
    expect(code).toContain('No events yet')
  })

  it('emits an async handler per event', () => {
    const { graph } = build([['event.start']])
    const { code } = generateProgram(graph, registry)
    expect(code).toContain('app.onStart(async () => {')
    expect(code.trimEnd().endsWith('})')).toBe(true)
  })

  it('inlines a pure expression and binds a statement to a variable', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log'], ['data.text']],
      [['0', 'exec', '1', 'exec'], ['2', 'value', '1', 'value']],
    )
    const withValue = setNodeValue(graph, ids[2], 'value', 'hi')
    const { code } = generateProgram(withValue, registry)
    expect(code).toContain('console.log("hi")')
  })

  it('reads a statement block by the variable it assigned', () => {
    const { graph, ids } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['1', 'rows', '2', 'value'],
      ],
    )
    const { code, symbols } = generateProgram(graph, registry)
    expect(symbols[ids[1]]).toBe('query1')
    expect(code).toContain('const query1 = await db')
    expect(code).toContain('console.log(query1)')
  })

  it('awaits async blocks inside the handler', () => {
    const { graph } = build(
      [['event.start'], ['network.fetch']],
      [['0', 'exec', '1', 'exec']],
    )
    expect(generateProgram(graph, registry).code).toContain('await http.request(')
  })

  it('orders events top to bottom, then left to right', () => {
    const { graph, ids } = build([['event.start', 100, 200], ['event.start', 0, 0], ['event.start', 50, 0]])
    const { sourceMap } = generateProgram(graph, registry)
    const order = sourceMap.filter((entry) => ids.includes(entry.nodeId)).map((entry) => entry.nodeId)
    expect(order).toEqual([ids[1], ids[2], ids[0]])
  })

  it('produces the same text for the same graph', () => {
    const { graph } = build(
      [['event.start'], ['logic.log'], ['network.fetch']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec']],
    )
    expect(generateProgram(graph, registry).code).toBe(generateProgram(graph, registry).code)
  })

  it('leaves orphaned blocks out of the generated code', () => {
    const { graph, ids } = build([['event.start'], ['logic.log']])
    const dangling = setNodeValue(graph, ids[1], 'value', 'never runs')
    expect(generateProgram(dangling, registry).code).not.toContain('never runs')
  })

  it('nests a body inside a branch', () => {
    const { graph } = build(
      [['event.start'], ['logic.if'], ['logic.log']],
      [['0', 'exec', '1', 'exec'], ['1', 'body', '2', 'exec']],
    )
    const lines = generateProgram(graph, registry).code.split('\n')
    const branch = lines.findIndex((line) => line.includes('if ('))
    expect(lines[branch].startsWith('  if (')).toBe(true)
    expect(lines[branch + 1].startsWith('    console.log(')).toBe(true)
  })

  it('closes an empty body on the same line', () => {
    const { graph } = build([['event.start'], ['logic.if']], [['0', 'exec', '1', 'exec']])
    expect(generateProgram(graph, registry).code).toContain('if (true) {}')
  })

  it('maps two identical nested lines to their own blocks', () => {
    // The source map is built by locating a body inside its wrapper; two
    // blocks that generate byte-identical text are what breaks a naive
    // search, so the mapping has to survive exactly this graph.
    const { graph, ids } = build(
      [['event.start'], ['logic.if'], ['logic.log'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'body', '2', 'exec'],
        ['2', 'exec', '3', 'exec'],
      ],
    )
    const program = generateProgram(graph, registry)
    const first = lineOfNode(program, ids[2])
    const second = lineOfNode(program, ids[3])
    expect(program.code.split('\n').filter((line) => line.includes('console.log'))).toHaveLength(2)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
    expect(nodeAtLine(program, first!)).toBe(ids[2])
    expect(nodeAtLine(program, second!)).toBe(ids[3])
  })

  it('traces a line back to the block that produced it', () => {
    const { graph, ids } = build(
      [['event.start'], ['network.fetch']],
      [['0', 'exec', '1', 'exec']],
    )
    const program = generateProgram(graph, registry)
    const line = program.code.split('\n').findIndex((text) => text.includes('await http.request(')) + 1
    expect(nodeAtLine(program, line)).toBe(ids[1])
  })

  it('numbers variables by position, so two of a kind do not collide', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['data.query']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec']],
    )
    const { symbols } = generateProgram(graph, registry)
    expect(Object.values(symbols).sort()).toEqual(['query1', 'query2'])
  })
})

describe('integrity checker', () => {
  it('passes a well-formed graph', () => {
    const { graph } = build(
      [['event.start'], ['logic.log']],
      [['0', 'exec', '1', 'exec']],
    )
    const report = checkIntegrity(graph, registry)
    expect(report.diagnostics).toHaveLength(0)
    expect(report.compilable).toBe(true)
  })

  it('reports a block the workspace does not know', () => {
    const graph = addNode({ nodes: [], connections: [] }, createNode('plugin.missing', { x: 0, y: 0 }))
    const report = checkIntegrity(graph, registry)
    expect(report.compilable).toBe(false)
    expect(report.diagnostics.some((entry) => entry.code === 'unknown-block')).toBe(true)
  })

  it('flags a type mismatch in plain words and blocks compilation', () => {
    // Hand-built: canConnect would have refused this link at draw time, but
    // a graph parsed from edited code can still arrive in this state.
    const { graph, ids } = build([['data.text'], ['logic.math']])
    const broken: BlockGraph = {
      ...graph,
      connections: [{ id: 'l1', from: { node: ids[0], port: 'value' }, to: { node: ids[1], port: 'left' } }],
    }
    const report = checkIntegrity(broken, registry)
    const mismatch = report.diagnostics.find((entry) => entry.code === 'type-mismatch')
    expect(mismatch?.message).toContain('gives text')
    expect(mismatch?.message).toContain('needs a number')
    expect(mismatch?.connectionId).toBe('l1')
    expect(report.compilable).toBe(false)
  })

  it('flags a link to a port that no longer exists', () => {
    const { graph, ids } = build([['event.start'], ['logic.log']])
    const broken: BlockGraph = {
      ...graph,
      connections: [{ id: 'l1', from: { node: ids[0], port: 'gone' }, to: { node: ids[1], port: 'exec' } }],
    }
    const report = checkIntegrity(broken, registry)
    expect(report.diagnostics.some((entry) => entry.message.includes('no longer exists'))).toBe(true)
    expect(report.compilable).toBe(false)
  })

  it('reports a required input that was left empty', () => {
    const { graph, ids } = build(
      [['event.start'], ['storage.upload']],
      [['0', 'exec', '1', 'exec']],
    )
    const report = checkIntegrity(graph, registry)
    const missing = report.diagnostics.filter((entry) => entry.code === 'missing-input')
    expect(missing).toHaveLength(1)
    expect(missing[0].portId).toBe('file')
    expect(missing[0].nodeId).toBe(ids[1])
    expect(report.compilable).toBe(false)
  })

  it('accepts a required input satisfied by a typed value', () => {
    const { graph, ids } = build(
      [['event.start'], ['auth.signUp']],
      [['0', 'exec', '1', 'exec']],
    )
    const filled = setNodeValue(
      setNodeValue(graph, ids[1], 'email', 'a@b.co'),
      ids[1],
      'password',
      'hunter2',
    )
    expect(checkIntegrity(filled, registry).compilable).toBe(true)
  })

  it('ignores missing inputs on a block that never runs', () => {
    const { graph } = build([['storage.upload']])
    const report = checkIntegrity(graph, registry)
    expect(report.diagnostics.every((entry) => entry.code === 'orphan')).toBe(true)
    expect(report.compilable).toBe(true)
  })

  it('warns about an unconnected block without blocking compilation', () => {
    const { graph, ids } = build([['event.start'], ['logic.log']], [['0', 'exec', '1', 'exec']])
    const stray = addNode(graph, createNode('ui.text', { x: 400, y: 0 }))
    const report = checkIntegrity(stray, registry)
    const orphan = report.diagnostics.find((entry) => entry.code === 'orphan')
    expect(orphan?.message).toContain('not connected to anything')
    expect(report.orphans.has(orphan!.nodeId)).toBe(true)
    expect(report.orphans.has(ids[1])).toBe(false)
    expect(report.compilable).toBe(true)
  })

  it('tells a connected-but-unreached block apart from a stray one', () => {
    const { graph } = build(
      [['logic.log'], ['ui.text']],
      [['0', 'exec', '1', 'exec']],
    )
    const messages = checkIntegrity(graph, registry).diagnostics.map((entry) => entry.message)
    expect(messages.some((message) => message.includes('Nothing leads to'))).toBe(true)
  })

  it('finds a cycle and names the blocks in it', () => {
    const { graph, ids } = build([['event.start'], ['logic.log'], ['ui.text']])
    const looped: BlockGraph = {
      ...graph,
      connections: [
        { id: 'a', from: { node: ids[0], port: 'exec' }, to: { node: ids[1], port: 'exec' } },
        { id: 'b', from: { node: ids[1], port: 'exec' }, to: { node: ids[2], port: 'exec' } },
        { id: 'c', from: { node: ids[2], port: 'exec' }, to: { node: ids[1], port: 'exec' } },
      ],
    }
    const report = checkIntegrity(looped, registry)
    const cycle = report.diagnostics.find((entry) => entry.code === 'cycle')
    expect(cycle?.message).toContain('run in a circle')
    expect(report.cyclic.has(ids[1])).toBe(true)
    expect(report.cyclic.has(ids[2])).toBe(true)
    expect(report.cyclic.has(ids[0])).toBe(false)
    expect(report.compilable).toBe(false)
  })

  it('finds a block wired back into itself', () => {
    const { graph, ids } = build([['logic.log']])
    const looped: BlockGraph = {
      ...graph,
      connections: [{ id: 'a', from: { node: ids[0], port: 'exec' }, to: { node: ids[0], port: 'exec' } }],
    }
    expect(checkIntegrity(looped, registry).cyclic.has(ids[0])).toBe(true)
  })

  it('terminates on a long chain without overflowing', () => {
    let graph: BlockGraph = { nodes: [], connections: [] }
    let previous = createNode('event.start', { x: 0, y: 0 })
    graph = addNode(graph, previous)
    for (let index = 0; index < 2000; index += 1) {
      const node = createNode('logic.log', { x: 0, y: index })
      graph = addNode(graph, node)
      graph = connect(graph, registry, { node: previous.id, port: 'exec' }, { node: node.id, port: 'exec' }).graph
      previous = node
    }
    expect(checkIntegrity(graph, registry).cyclic.size).toBe(0)
  })

  it('refuses to compile a value read from a block that never runs', () => {
    // The generator would emit the variable name of a statement that was
    // never reached, so this has to be an error rather than a warning.
    const { graph, ids } = build([['event.start'], ['data.query'], ['logic.log']])
    const wired = connect(
      connect(graph, registry, { node: ids[0], port: 'exec' }, { node: ids[2], port: 'exec' }).graph,
      registry,
      { node: ids[1], port: 'rows' },
      { node: ids[2], port: 'value' },
    ).graph
    const report = checkIntegrity(wired, registry)
    const unreachable = report.diagnostics.find((entry) => entry.code === 'unreachable-value')
    expect(unreachable?.message).toContain('never runs')
    expect(unreachable?.nodeId).toBe(ids[2])
    expect(report.compilable).toBe(false)
  })

  it('warns when an awaited result is thrown away', () => {
    const { graph, ids } = build(
      [['event.start'], ['network.fetch']],
      [['0', 'exec', '1', 'exec']],
    )
    const report = checkIntegrity(graph, registry)
    const unused = report.diagnostics.find((entry) => entry.code === 'unused-result')
    expect(unused?.nodeId).toBe(ids[1])
    expect(unused?.severity).toBe('warning')
    expect(report.compilable).toBe(true)
  })

  it('stays quiet when the result is read', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['1', 'rows', '2', 'value'],
      ],
    )
    expect(checkIntegrity(graph, registry).diagnostics).toHaveLength(0)
  })

  it('groups diagnostics by block for the canvas badges', () => {
    const { graph, ids } = build(
      [['event.start'], ['storage.upload']],
      [['0', 'exec', '1', 'exec']],
    )
    const byNode = diagnosticsByNode(checkIntegrity(graph, registry))
    expect(byNode.get(ids[1])?.length).toBeGreaterThan(0)
  })

  it('never throws on a graph whose links point at nothing', () => {
    const graph: BlockGraph = {
      nodes: [],
      connections: [{ id: 'a', from: { node: 'gone', port: 'exec' }, to: { node: 'also-gone', port: 'exec' } }],
    }
    expect(() => checkIntegrity(graph, registry)).not.toThrow()
  })
})

describe('code parser', () => {
  /** Generate, parse, generate again: the text has to survive the trip. */
  function roundTrip(graph: BlockGraph) {
    const before = generateProgram(graph, registry).code
    const parsed = parseProgram(before, registry)
    if (!parsed.ok) throw new Error(`${parsed.reason} (line ${parsed.line})`)
    return { before, after: generateProgram(parsed.graph, registry).code, graph: parsed.graph }
  }

  it('reads an empty program', () => {
    const parsed = parseProgram('// nothing here\n', registry)
    expect(parsed.ok && parsed.graph.nodes).toEqual([])
  })

  it('rebuilds an event and its chain', () => {
    const { graph } = build(
      [['event.start'], ['logic.log'], ['ui.text']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec']],
    )
    const trip = roundTrip(graph)
    expect(trip.after).toBe(trip.before)
    expect(trip.graph.nodes.map((node) => node.type)).toEqual(['event.start', 'logic.log', 'ui.text'])
  })

  it('keeps the element id of a click handler', () => {
    const { graph, ids } = build([['event.click']])
    const trip = roundTrip(setNodeValue(graph, ids[0], 'target', 'save-button'))
    expect(trip.after).toBe(trip.before)
    expect(trip.graph.nodes[0].values.target).toBe('save-button')
  })

  it('restores a link from a variable back to the block that assigned it', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['1', 'rows', '2', 'value'],
      ],
    )
    const trip = roundTrip(graph)
    expect(trip.after).toBe(trip.before)
    const query = trip.graph.nodes.find((node) => node.type === 'data.query')!
    const log = trip.graph.nodes.find((node) => node.type === 'logic.log')!
    expect(trip.graph.connections).toContainEqual(
      expect.objectContaining({
        from: { node: query.id, port: 'rows' },
        to: { node: log.id, port: 'value' },
      }),
    )
  })

  it('rebuilds a nested branch', () => {
    const { graph } = build(
      [['event.start'], ['logic.if'], ['logic.log'], ['ui.text']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'body', '2', 'exec'],
        ['1', 'else', '3', 'exec'],
      ],
    )
    const trip = roundTrip(graph)
    expect(trip.after).toBe(trip.before)
    const branch = trip.graph.nodes.find((node) => node.type === 'logic.if')!
    expect(trip.graph.connections.filter((link) => link.from.node === branch.id)).toHaveLength(2)
  })

  it('rebuilds a loop over a list', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.forEach'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['1', 'rows', '2', 'list'],
        ['2', 'body', '3', 'exec'],
      ],
    )
    expect(roundTrip(graph).after).toBe(roundTrip(graph).before)
  })

  it('survives a chain of every async block in the library', () => {
    const { graph } = build(
      [['event.start'], ['auth.session'], ['network.fetch'], ['storage.upload'], ['data.insert']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['2', 'exec', '3', 'exec'],
        ['3', 'exec', '4', 'exec'],
      ],
    )
    expect(roundTrip(graph).after).toBe(roundTrip(graph).before)
  })

  it('turns an inline literal into a value on the port', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.log'], ['data.text']],
      [['0', 'exec', '1', 'exec'], ['2', 'value', '1', 'value']],
    )
    const trip = roundTrip(setNodeValue(graph, ids[2], 'value', 'hello'))
    const log = trip.graph.nodes.find((node) => node.type === 'logic.log')!
    expect(log.values.value).toBe('hello')
    expect(trip.after).toBe(trip.before)
  })

  it('keeps commas inside an argument out of the split', () => {
    const parsed = parseProgram(
      'app.onStart(async () => {\n  console.log("one, two")\n})\n',
      registry,
    )
    expect(parsed.ok && parsed.graph.nodes[1].values.value).toBe('one, two')
  })

  it('refuses a line it does not recognise, and says which', () => {
    const parsed = parseProgram('app.onStart(async () => {\n  launchMissiles()\n})\n', registry)
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.line).toBe(2)
    expect(!parsed.ok && parsed.reason).toContain('launchMissiles()')
  })

  it('refuses a statement outside any handler', () => {
    const parsed = parseProgram('console.log("stray")\n', registry)
    expect(!parsed.ok && parsed.reason).toContain('top level')
  })

  it('refuses a file that ends mid-block', () => {
    const parsed = parseProgram('app.onStart(async () => {\n  console.log("x")\n', registry)
    expect(!parsed.ok && parsed.reason).toContain('still open')
  })

  it('refuses an unbalanced closing brace', () => {
    const parsed = parseProgram('}\n', registry)
    expect(!parsed.ok && parsed.line).toBe(1)
  })

  it('produces a graph the checker is happy with', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['1', 'rows', '2', 'value'],
      ],
    )
    const parsed = parseProgram(generateProgram(graph, registry).code, registry)
    expect(parsed.ok && checkIntegrity(parsed.graph, registry).compilable).toBe(true)
  })
})

describe('scope', () => {
  it('refuses a value read from another handler', () => {
    // Two events, one value: the variable the first handler binds does not
    // exist inside the second, however the wire looks on the canvas.
    const { graph, ids } = build(
      [['event.start'], ['data.query'], ['event.click'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['2', 'exec', '3', 'exec'],
        ['1', 'rows', '3', 'value'],
      ],
    )
    const report = checkIntegrity(graph, registry)
    const scope = report.diagnostics.find((entry) => entry.code === 'out-of-scope')
    expect(scope?.message).toContain('different handler')
    expect(scope?.fix).toContain('Input Value')
    expect(scope?.nodeId).toBe(ids[3])
    expect(report.compilable).toBe(false)
  })

  it('refuses a value read after the branch that bound it closed', () => {
    const { graph, ids } = build(
      [['event.start'], ['logic.if'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'body', '2', 'exec'],
        ['1', 'exec', '3', 'exec'],
        ['2', 'rows', '3', 'value'],
      ],
    )
    const report = checkIntegrity(graph, registry)
    const scope = report.diagnostics.find((entry) => entry.code === 'out-of-scope')
    expect(scope?.message).toContain('already finished')
    expect(scope?.nodeId).toBe(ids[3])
    expect(report.compilable).toBe(false)
  })

  it('allows a value read inside the branch that bound it', () => {
    const { graph } = build(
      [['event.start'], ['logic.if'], ['data.query'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'body', '2', 'exec'],
        ['2', 'exec', '3', 'exec'],
        ['2', 'rows', '3', 'value'],
      ],
    )
    expect(checkIntegrity(graph, registry).compilable).toBe(true)
  })

  it('allows an outer value read from inside a branch', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.if'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['2', 'body', '3', 'exec'],
        ['1', 'rows', '3', 'value'],
      ],
    )
    expect(checkIntegrity(graph, registry).compilable).toBe(true)
  })

  it('lets an Input Value block be read from any handler', () => {
    const { graph, ids } = build(
      [['event.start'], ['ui.input'], ['event.click'], ['logic.log'], ['ui.value']],
      [
        ['0', 'exec', '1', 'exec'],
        ['2', 'exec', '3', 'exec'],
        ['4', 'value', '3', 'value'],
      ],
    )
    const named = setNodeValue(setNodeValue(graph, ids[1], 'id', 'email'), ids[4], 'id', 'email')
    const report = checkIntegrity(named, registry)
    expect(report.diagnostics.filter((entry) => entry.severity === 'error')).toHaveLength(0)
    expect(generateProgram(named, registry).code).toContain('console.log(render.value("email"))')
  })

  it('round-trips a field read through the parser', () => {
    const { graph, ids } = build(
      [['event.click'], ['logic.log'], ['ui.value']],
      [['0', 'exec', '1', 'exec'], ['2', 'value', '1', 'value']],
    )
    const named = setNodeValue(graph, ids[2], 'id', 'email')
    const before = generateProgram(named, registry).code
    const parsed = parseProgram(before, registry)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && generateProgram(parsed.graph, registry).code).toBe(before)
  })
})

describe('snapping pieces together', () => {
  it('snaps to the nearest free Then pin and lines the pins up', () => {
    const { graph, ids } = build([['event.start', 0, 0], ['logic.log', 400, 400]])

    // Dropped close to On App Start's Then pin, but not exactly on it.
    const snap = snapCandidate(graph, registry, ids[1], { x: NODE_WIDTH + 12, y: 18 })
    expect(snap?.from).toEqual({ node: ids[0], port: 'exec' })
    expect(snap?.to).toEqual({ node: ids[1], port: 'exec' })

    // Lined up exactly: the Run pin now sits on the Then pin it joined.
    expect(snap?.position).toEqual({ x: NODE_WIDTH, y: 0 })
  })

  it('ignores a pin that is out of reach', () => {
    const { graph, ids } = build([['event.start', 0, 0], ['logic.log', 400, 400]])
    expect(snapCandidate(graph, registry, ids[1], { x: 600, y: 600 })).toBeUndefined()
  })

  it('ignores a Then pin that already drives a block', () => {
    const { graph, ids } = build(
      [['event.start', 0, 0], ['logic.log', 300, 0], ['logic.log', 400, 400]],
      [['0', 'exec', '1', 'exec']],
    )
    expect(snapCandidate(graph, registry, ids[2], { x: NODE_WIDTH, y: 0 })).toBeUndefined()
  })

  it('ignores a block whose Run pin is already taken', () => {
    const { graph, ids } = build(
      [['event.start', 0, 0], ['event.click', 0, 300], ['logic.log', 400, 400]],
      [['0', 'exec', '2', 'exec']],
    )
    // The second event's Then pin is free, but the log block is already wired.
    expect(snapCandidate(graph, registry, ids[2], { x: NODE_WIDTH, y: 300 })).toBeUndefined()
  })

  it('never snaps a block to itself', () => {
    const { graph, ids } = build([['logic.log', 0, 0]])
    expect(snapCandidate(graph, registry, ids[0], { x: 0, y: 0 })).toBeUndefined()
  })

  it('picks the closer of two candidates', () => {
    const { graph, ids } = build([['event.start', 0, 0], ['event.click', 0, 40], ['logic.log', 500, 500]])
    const snap = snapCandidate(graph, registry, ids[2], { x: NODE_WIDTH, y: 34 })
    expect(snap?.from.node).toBe(ids[1])
  })
})

/**
 * The second half of the component library.
 *
 * A block is only real once the text it writes can be read back into the
 * same block: the canvas and the code view are the same document, and a
 * component that survives generation but not parsing would silently
 * disappear the first time someone edited the file by hand.
 */
describe('headings, pictures and the rest', () => {
  function roundTrip(graph: BlockGraph) {
    const before = generateProgram(graph, registry).code
    const parsed = parseProgram(before, registry)
    if (!parsed.ok) throw new Error(`${parsed.reason} (line ${parsed.line})`)
    return { before, after: generateProgram(parsed.graph, registry).code, graph: parsed.graph }
  }

  const NEW_BLOCKS = ['ui.heading', 'ui.image', 'ui.checkbox', 'ui.select', 'ui.link', 'ui.divider']

  it('puts all six in the UI category of the palette', () => {
    const ui = registry.byCategory().find((group) => group.category === 'UI')?.blocks ?? []
    const types = ui.map((block) => block.type)
    for (const type of NEW_BLOCKS) expect(types).toContain(type)
  })

  it('survives the round trip, every one of them', () => {
    for (const type of NEW_BLOCKS) {
      resetIds()
      const { graph } = build([['event.start'], [type]], [['0', 'exec', '1', 'exec']])
      const trip = roundTrip(graph)
      expect(trip.after).toBe(trip.before)
      expect(trip.graph.nodes.map((node) => node.type)).toEqual(['event.start', type])
    }
  })

  it('keeps the values that were typed into them', () => {
    const { graph, ids } = build([['event.start'], ['ui.select']], [['0', 'exec', '1', 'exec']])
    const filled = setNodeValue(
      setNodeValue(setNodeValue(graph, ids[1], 'id', 'plan'), ids[1], 'options', 'Free, Pro'),
      ids[1],
      'value',
      'Pro',
    )
    const trip = roundTrip(filled)
    expect(trip.before).toContain('render.select({ id: "plan", options: "Free, Pro", value: "Pro" })')
    expect(trip.after).toBe(trip.before)
  })

  it('writes a heading level as a number, and clamps a silly one', () => {
    const { graph, ids } = build([['event.start'], ['ui.heading']], [['0', 'exec', '1', 'exec']])
    expect(generateProgram(setNodeValue(graph, ids[1], 'level', 9), registry).code)
      .toContain('level: 6')
    expect(generateProgram(setNodeValue(graph, ids[1], 'level', 0), registry).code)
      .toContain('level: 1')
  })

  it('keeps a checkbox boolean a boolean, not the word "true"', () => {
    // The parser turns literals back into values, so a quoted true here
    // would come back as a string and the next generation would quote it
    // again -- the classic way a round trip stops being stable.
    const { graph, ids } = build([['event.start'], ['ui.checkbox']], [['0', 'exec', '1', 'exec']])
    const ticked = setNodeValue(graph, ids[1], 'checked', true)
    const trip = roundTrip(ticked)
    expect(trip.before).toContain('checked: true')
    expect(trip.after).toBe(trip.before)
    expect(trip.graph.nodes[1].values.checked).toBe(true)
  })

  it('carries style properties through, as every visual block does', () => {
    const { graph, ids } = build([['event.start'], ['ui.link']], [['0', 'exec', '1', 'exec']])
    const styled = setNodeValue(graph, ids[1], 'color', 'accent')
    const trip = roundTrip(styled)
    expect(trip.before).toContain('color: "accent"')
    expect(trip.after).toBe(trip.before)
  })
})

/**
 * The backend blocks, against the backend that now exists.
 *
 * Sign-in, sign-out, update and delete were missing from the palette while
 * the generated service answered all four. A route nothing can call is
 * dead weight, and a block whose call nothing answers is worse, so these
 * tests hold the two sides together.
 */
describe('the blocks the backend can answer', () => {
  function roundTrip(graph: BlockGraph) {
    const before = generateProgram(graph, registry).code
    const parsed = parseProgram(before, registry)
    if (!parsed.ok) throw new Error(`${parsed.reason} (line ${parsed.line})`)
    return { before, after: generateProgram(parsed.graph, registry).code, graph: parsed.graph }
  }

  const BACKEND_BLOCKS = ['auth.signIn', 'auth.signOut', 'data.update', 'data.remove']

  it('files them under the category they belong to', () => {
    const groups = registry.byCategory()
    const auth = groups.find((group) => group.category === 'Auth')?.blocks.map((block) => block.type) ?? []
    const data = groups.find((group) => group.category === 'Data')?.blocks.map((block) => block.type) ?? []
    expect(auth).toContain('auth.signIn')
    expect(auth).toContain('auth.signOut')
    expect(data).toContain('data.update')
    expect(data).toContain('data.remove')
  })

  it('survives the round trip, every one of them', () => {
    for (const type of BACKEND_BLOCKS) {
      resetIds()
      const { graph } = build([['event.start'], [type]], [['0', 'exec', '1', 'exec']])
      const trip = roundTrip(graph)
      expect(trip.after).toBe(trip.before)
      expect(trip.graph.nodes.map((node) => node.type)).toEqual(['event.start', type])
    }
  })

  it('writes the call the runtime actually has', () => {
    const { graph, ids } = build(
      [['event.start'], ['data.update'], ['data.remove'], ['auth.signIn'], ['auth.signOut']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec'], ['2', 'exec', '3', 'exec'], ['3', 'exec', '4', 'exec']],
    )
    let next = setNodeValue(graph, ids[1], 'table', 'notes')
    next = setNodeValue(next, ids[1], 'id', '7')
    next = setNodeValue(next, ids[2], 'table', 'notes')
    next = setNodeValue(next, ids[2], 'id', '7')
    next = setNodeValue(next, ids[3], 'email', 'ada@example.com')
    next = setNodeValue(next, ids[3], 'password', 'correct horse')
    const { code } = generateProgram(next, registry)
    expect(code).toContain('await db.update("notes", "7",')
    expect(code).toContain('await db.remove("notes", "7")')
    expect(code).toContain('await auth.signIn("ada@example.com", "correct horse")')
    expect(code).toContain('await auth.signOut()')
  })

  it('binds a result only where there is one to bind', () => {
    // Deleting a row and signing out return nothing worth naming, so they
    // are statements rather than `const x = ...` with an unused x.
    const { graph } = build([['event.start'], ['data.remove'], ['auth.signOut']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec']])
    const { code } = generateProgram(graph, registry)
    expect(code).not.toMatch(/const \w+ = await db\.remove/)
    expect(code).not.toMatch(/const \w+ = await auth\.signOut/)
  })
})

/**
 * Object literals, read and written.
 *
 * The parser behind `parseObjectLiteral` is deliberately narrow, and the
 * value of a narrow parser is entirely in where it says no.
 */
describe('reading a typed-in object', () => {
  it('reads identifier keys, quoted keys and JSON values', () => {
    expect(parseObjectLiteral('{ title: "Hello", "count": 3, done: true, note: null }')).toEqual([
      { key: 'title', value: '"Hello"' },
      { key: 'count', value: '3' },
      { key: 'done', value: 'true' },
      { key: 'note', value: 'null' },
    ])
  })

  it('reads the empty object', () => {
    expect(parseObjectLiteral('{}')).toEqual([])
    expect(parseObjectLiteral('  {  }  ')).toEqual([])
  })

  it('keeps a comma inside a string out of the split', () => {
    expect(parseObjectLiteral('{ title: "Hello, world" }')).toEqual([{ key: 'title', value: '"Hello, world"' }])
  })

  it('declines anything it cannot spell in four languages', () => {
    for (const text of [
      'notAnObject',
      '{ nested: { a: 1 } }',
      '{ list: [1, 2] }',
      '{ computed: 1 + 1 }',
      '{ called: fetch() }',
      '{ missingValue }',
      '{ "unterminated: 1 }',
    ]) {
      expect(parseObjectLiteral(text), text).toBeUndefined()
    }
  })

  it('spells the fields the way each language does', () => {
    const entries = parseObjectLiteral('{ title: "Hello", done: true }')!
    expect(objectIn('js', entries)).toBe('{ title: "Hello", done: true }')
    expect(objectIn('kotlin', entries)).toBe('mapOf("title" to "Hello", "done" to true)')
    expect(objectIn('swift', entries)).toBe('["title": "Hello", "done": true]')
    expect(objectIn('dart', entries)).toBe('<String, dynamic>{"title": "Hello", "done": true}')
    expect(objectIn('kotlin', [])).toBe('emptyMap<String, Any?>()')
    expect(objectIn('swift', [])).toBe('[String: Any]()')
    expect(objectIn('dart', [])).toBe('<String, dynamic>{}')
  })

  it('comes back from generated code as a Row Fields block', () => {
    const { graph, ids } = build([['event.start'], ['data.insert']], [['0', 'exec', '1', 'exec']])
    let next = setNodeValue(graph, ids[1], 'table', 'notes')
    next = setNodeValue(next, ids[1], 'row', '{ title: "Hello" }')
    const code = generateProgram(next, registry).code
    expect(code).toContain('db.insert("notes", { title: "Hello" })')

    // Typed into a port it is text; read back off the code it becomes the
    // block that means the same thing, which is the direction the parser
    // is supposed to pull in.
    const back = parseProgram(code, registry)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    const row = back.graph.nodes.find((node) => node.type === 'data.row')
    expect(row?.values.name1).toBe('title')
    expect(row?.values.value1).toBe('Hello')
    const insert = back.graph.nodes.find((node) => node.type === 'data.insert')
    expect(back.graph.connections.some((link) => (
      link.from.node === row?.id && link.to.node === insert?.id && link.to.port === 'row'
    ))).toBe(true)
    // And it generates the same line it was read from.
    expect(generateProgram(back.graph, registry).code).toContain('db.insert("notes", { "title": "Hello" })')
  })
})
