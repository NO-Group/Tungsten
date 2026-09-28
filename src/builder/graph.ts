/**
 * Operations on the block graph.
 *
 * Every one of these is pure: a graph goes in, a new graph comes out. The
 * canvas, the palette and the undo stack all go through here, so there is
 * one place where the rules about what may connect to what are enforced --
 * and one place to test them.
 */

import {
  findPort,
  isAssignable,
  type BlockGraph,
  type BlockNode,
  type BlockRegistry,
  type Connection,
} from './blockSchema'

let counter = 0

/** Ids are readable rather than random, which makes a saved graph diffable. */
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}_${counter.toString(36)}`
}

/** Only for tests, so ids are predictable from a known starting point. */
export function resetIds(value = 0) {
  counter = value
}

export function nodeById(graph: BlockGraph, id: string): BlockNode | undefined {
  return graph.nodes.find((node) => node.id === id)
}

export function addNode(graph: BlockGraph, node: BlockNode): BlockGraph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

export function createNode(type: string, position: { x: number; y: number }): BlockNode {
  return { id: nextId(type.split('.').pop() || 'node'), type, position, values: {} }
}

/** Removing a node takes its wiring with it; a dangling edge is not a state. */
export function removeNode(graph: BlockGraph, id: string): BlockGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== id),
    connections: graph.connections.filter(
      (connection) => connection.from.node !== id && connection.to.node !== id,
    ),
  }
}

export function moveNode(graph: BlockGraph, id: string, position: { x: number; y: number }): BlockGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === id ? { ...node, position } : node)),
  }
}

export function setNodeValue(
  graph: BlockGraph,
  id: string,
  portId: string,
  value: string | number | boolean,
): BlockGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (
      node.id === id ? { ...node, values: { ...node.values, [portId]: value } } : node
    )),
  }
}

export type ConnectionRejection = {
  ok: false
  reason: string
}

export type ConnectionCheck = { ok: true } | ConnectionRejection

/**
 * Whether a proposed connection is allowed.
 *
 * This is the first line of the integrity checker, and the only one that
 * runs while the user is still holding the mouse button: an illegal link is
 * refused at the moment it is drawn rather than reported afterwards.
 */
export function canConnect(
  graph: BlockGraph,
  registry: BlockRegistry,
  from: Connection['from'],
  to: Connection['to'],
): ConnectionCheck {
  if (from.node === to.node) return { ok: false, reason: 'A block cannot be wired to itself.' }

  const source = nodeById(graph, from.node)
  const target = nodeById(graph, to.node)
  if (!source || !target) return { ok: false, reason: 'One end of the link is missing.' }

  const sourceDefinition = registry.get(source.type)
  const targetDefinition = registry.get(target.type)
  if (!sourceDefinition || !targetDefinition) return { ok: false, reason: 'Unknown block.' }

  const output = sourceDefinition.outputs.find((port) => port.id === from.port)
    ?? sourceDefinition.slots?.find((port) => port.id === from.port)
  const input = targetDefinition.inputs.find((port) => port.id === to.port)
  if (!output) return { ok: false, reason: `“${sourceDefinition.label}” has no output “${from.port}”.` }
  if (!input) return { ok: false, reason: `“${targetDefinition.label}” has no input “${to.port}”.` }

  if (!isAssignable(output.type, input.type)) {
    return {
      ok: false,
      reason: `${output.type} does not fit into ${input.type}: “${output.label}” cannot drive “${input.label}”.`,
    }
  }

  // An input takes one value, and a step leads to one next step. Re-linking
  // an occupied port replaces what is there, so only a duplicate is refused.
  const occupied = graph.connections.find((connection) => (
    connection.to.node === to.node && connection.to.port === to.port
  ))
  if (occupied && occupied.from.node === from.node && occupied.from.port === from.port) {
    return { ok: false, reason: 'Those ports are already connected.' }
  }

  if (wouldCycle(graph, from.node, to.node)) {
    return { ok: false, reason: 'That link would make the graph run in a circle.' }
  }

  return { ok: true }
}

/** Does adding source -> target close a loop back to the source? */
function wouldCycle(graph: BlockGraph, fromNode: string, toNode: string): boolean {
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === fromNode) return true
    if (seen.has(id)) return false
    seen.add(id)
    return graph.connections
      .filter((connection) => connection.from.node === id)
      .some((connection) => walk(connection.to.node))
  }
  return walk(toNode)
}

/**
 * Connects two ports, replacing whatever occupied the target input and --
 * for execution, where a step has exactly one successor -- whatever occupied
 * the source output.
 */
export function connect(
  graph: BlockGraph,
  registry: BlockRegistry,
  from: Connection['from'],
  to: Connection['to'],
): { graph: BlockGraph; rejected?: string } {
  const check = canConnect(graph, registry, from, to)
  if (!check.ok) return { graph, rejected: check.reason }

  const definition = registry.get(nodeById(graph, from.node)!.type)!
  const outputPort = findPort(definition, from.port)
  const exclusiveSource = outputPort?.type === 'Exec'

  const connections = graph.connections.filter((connection) => {
    const sameTarget = connection.to.node === to.node && connection.to.port === to.port
    const sameSource = exclusiveSource
      && connection.from.node === from.node
      && connection.from.port === from.port
    return !sameTarget && !sameSource
  })

  return { graph: { ...graph, connections: [...connections, { id: nextId('link'), from, to }] } }
}

export function disconnect(graph: BlockGraph, connectionId: string): BlockGraph {
  return { ...graph, connections: graph.connections.filter((connection) => connection.id !== connectionId) }
}

/** The connection feeding a node's input port, if any. */
export function incoming(graph: BlockGraph, nodeId: string, portId: string): Connection | undefined {
  return graph.connections.find(
    (connection) => connection.to.node === nodeId && connection.to.port === portId,
  )
}

/** The connections leaving a node's output port. */
export function outgoing(graph: BlockGraph, nodeId: string, portId: string): Connection[] {
  return graph.connections.filter(
    (connection) => connection.from.node === nodeId && connection.from.port === portId,
  )
}

/**
 * Every node that occupies a step: the execution chain itself.
 *
 * This is the forward closure over `Exec` edges from the events. A block in
 * here runs, in this order, and -- crucially -- a block *not* in here never
 * assigns its variable, so reading its output is an error rather than a
 * stylistic matter.
 */
export function execChainNodes(graph: BlockGraph, registry: BlockRegistry): Set<string> {
  const isExec = execPortTest(graph, registry)
  const running = new Set<string>()
  const stack = graph.nodes
    .filter((node) => registry.get(node.type)?.isEvent)
    .map((node) => node.id)

  while (stack.length) {
    const id = stack.pop()!
    if (running.has(id)) continue
    running.add(id)
    for (const connection of graph.connections) {
      if (connection.from.node === id && isExec(connection.from.node, connection.from.port)) {
        stack.push(connection.to.node)
      }
    }
  }
  return running
}

/**
 * Every node that contributes to the program.
 *
 * The execution chain, plus the values those steps read -- data edges are
 * followed backwards, because a block that runs pulls in what it needs. A
 * node fed *by* something that runs is not itself reached: producing a value
 * nobody asked for is exactly what an orphan is.
 */
export function liveNodes(graph: BlockGraph, registry: BlockRegistry): Set<string> {
  const isExec = execPortTest(graph, registry)
  const live = new Set<string>()
  const stack = [...execChainNodes(graph, registry)]

  while (stack.length) {
    const id = stack.pop()!
    if (live.has(id)) continue
    live.add(id)
    for (const connection of graph.connections) {
      // Backwards along the values this node reads.
      if (connection.to.node === id && !isExec(connection.to.node, connection.to.port)) {
        stack.push(connection.from.node)
      }
    }
  }
  return live
}

/** Is this port an execution port rather than a value? */
function execPortTest(graph: BlockGraph, registry: BlockRegistry) {
  return (nodeId: string, portId: string) => {
    const node = nodeById(graph, nodeId)
    const definition = node && registry.get(node.type)
    return definition ? findPort(definition, portId)?.type === 'Exec' : false
  }
}

/** Where a statement sits: which handler, inside which bodies, and when. */
export type Scope = {
  /** The event whose chain the statement belongs to. */
  event: string
  /** Enclosing containers, outermost first: the event, then each body slot. */
  path: string[]
  /** Position in the program, for "was this bound before it was read". */
  order: number
}

/**
 * The scope of every statement in the graph.
 *
 * Generated code is ordinary JavaScript, so its variables obey ordinary
 * scoping: a value bound in one handler is invisible in another, and one
 * bound inside a branch is gone once the branch closes. The canvas shows
 * neither of those boundaries, which is exactly why they have to be checked
 * rather than left for the user to discover at runtime.
 */
export function scopesOf(graph: BlockGraph, registry: BlockRegistry): Map<string, Scope> {
  const scopes = new Map<string, Scope>()
  let order = 0

  const walk = (nodeId: string, portId: string, event: string, path: string[]) => {
    const seen = new Set<string>()
    let link = outgoing(graph, nodeId, portId)[0]

    while (link) {
      const node = nodeById(graph, link.to.node)
      const definition = node && registry.get(node.type)
      if (!node || !definition || seen.has(node.id)) break
      seen.add(node.id)

      order += 1
      scopes.set(node.id, { event, path, order })

      for (const slot of definition.slots ?? []) {
        walk(node.id, slot.id, event, [...path, `${node.id}:${slot.id}`])
      }

      link = outgoing(graph, node.id, 'exec')[0]
    }
  }

  for (const node of graph.nodes) {
    if (!registry.get(node.type)?.isEvent) continue
    order += 1
    scopes.set(node.id, { event: node.id, path: [node.id], order })
    walk(node.id, 'exec', node.id, [node.id])
  }

  return scopes
}

/** Can a statement in `here` read a value bound in `there`? */
export function inScope(there: Scope, here: Scope): boolean {
  if (there.event !== here.event) return false
  if (there.order >= here.order) return false
  return there.path.every((step, index) => here.path[index] === step)
}
