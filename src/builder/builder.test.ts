import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, defineBlock, isAssignable, type BlockGraph } from './blockSchema'
import { generateProgram, lineOfNode, nodeAtLine } from './codeGenerator'
import { checkIntegrity, diagnosticsByNode } from './integrity'
import { parseProgram } from './codeParser'
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
    expect(categories).toEqual(['Events', 'UI', 'Logic', 'Data', 'Network', 'Auth', 'Storage'])
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
