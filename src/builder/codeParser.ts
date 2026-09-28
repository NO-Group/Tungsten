/**
 * Source text back into blocks.
 *
 * This is the other half of the loop: the user edits the code, and the
 * canvas follows. It reads the dialect the generator writes -- event
 * handlers, statements, nested bodies -- and rebuilds the graph from it.
 *
 * Two rules keep this honest.
 *
 * It never guesses. A line it does not recognise is not silently dropped;
 * the parse fails, with the line number and a reason, and the canvas goes
 * into a read-only state that says so. Half a graph is worse than none,
 * because saving it would delete the user's work.
 *
 * It preserves meaning rather than block identity. An inline expression --
 * a literal, an arithmetic term -- comes back as a value typed into a port
 * rather than as the little block that may originally have produced it. The
 * code generated from the result is the same code, which is the property
 * that matters for a round trip.
 */

import type { BlockGraph, BlockNode, BlockRegistry, Connection } from './blockSchema'
import { nextId } from './graph'

export type ParseFailure = {
  ok: false
  /** 1-based line the parser gave up on. */
  line: number
  /** Written for the person reading the editor, not a stack trace. */
  reason: string
}

export type ParseResult = { ok: true; graph: BlockGraph } | ParseFailure

/** Vertical rhythm of the rebuilt layout, in canvas units. */
const ROW = 110
const COLUMN = 300

/** A literal in source text, as a value a port can hold. */
function literalValue(text: string): string | number | boolean | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return undefined
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (/^"([^"\\]|\\.)*"$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/** An open handler or body: where the next statement attaches. */
type Frame = {
  nodeId: string
  port: string
  /** The last statement emitted into this frame, if any. */
  previous?: string
  /** The slot a `} else {` switches to. */
  elseSlot?: string
  depth: number
}

export function parseProgram(code: string, registry: BlockRegistry): ParseResult {
  const nodes: BlockNode[] = []
  const connections: Connection[] = []
  /** Variable name to the node that assigned it, for restoring data links. */
  const symbols = new Map<string, string>()
  const stack: Frame[] = []
  let row = 0

  const definitions = registry.all()

  const add = (type: string, depth: number): BlockNode => {
    const node: BlockNode = {
      id: nextId(type.split('.')[1] ?? 'node'),
      type,
      position: { x: depth * COLUMN, y: row * ROW },
      values: {},
    }
    row += 1
    nodes.push(node)
    return node
  }

  const link = (from: Connection['from'], to: Connection['to']) => {
    connections.push({ id: nextId('link'), from, to })
  }

  /** Attaches a statement to whatever comes before it in its frame. */
  const chain = (frame: Frame, nodeId: string) => {
    const from = frame.previous
      ? { node: frame.previous, port: 'exec' }
      : { node: frame.nodeId, port: frame.port }
    link(from, { node: nodeId, port: 'exec' })
    frame.previous = nodeId
  }

  /** A named output of a node, when the source text read one off by name. */
  const outputPort = (nodeId: string, portId: string): string | undefined => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const definition = node && registry.get(node.type)
    return definition?.outputs.find((port) => port.id === portId && port.type !== 'Exec')?.id
  }

  /** The first value output of a node, which is what a variable refers to. */
  const valuePort = (nodeId: string): string | undefined => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const definition = node && registry.get(node.type)
    return definition?.outputs.find((port) => port.type !== 'Exec')?.id
  }

  /**
   * Rebuilds a pure expression block from its own generated text.
   *
   * Without this, `console.log(render.value("email"))` would come back as a
   * block logging the *string* `render.value("email")` -- text that still
   * parses and no longer means anything like the same thing. Statements are
   * handled by the main loop; only expressions are reconstructed here.
   */
  const expressionFrom = (text: string, depth: number, remaining: number) => {
    if (remaining <= 0) return undefined
    for (const definition of definitions) {
      if (definition.inputs.some((port) => port.type === 'Exec')) continue
      const parsed = definition.parse?.(text)
      if (!parsed) continue
      const port = definition.outputs.find((candidate) => candidate.type !== 'Exec')
      if (!port) continue

      const node = add(definition.type, Math.max(0, depth - 1))
      for (const [portId, argument] of Object.entries(parsed.inputs)) {
        applyInput(node, portId, argument, depth, remaining - 1)
      }
      return { node: node.id, port: port.id }
    }
    return undefined
  }

  /** Resolves one parsed input: a link to an earlier block, or a literal. */
  const applyInput = (node: BlockNode, portId: string, text: string, depth = 0, remaining = 6) => {
    const trimmed = text.trim()

    // `input1.value` is a block's output read off the variable it bound, so
    // the property names the port; `input1` on its own means the block's
    // first value output.
    const member = /^([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)$/.exec(trimmed)
    const base = member ? member[1] : trimmed
    const source = symbols.get(base)
    if (source) {
      const named = member ? outputPort(source, member[2]) : undefined
      const port = named ?? valuePort(source)
      if (port) {
        link({ node: source, port }, { node: node.id, port: portId })
        return
      }
    }
    const expression = expressionFrom(trimmed, depth, remaining)
    if (expression) {
      link(expression, { node: node.id, port: portId })
      return
    }

    const value = literalValue(trimmed)
    if (value !== undefined) node.values[portId] = value
  }

  const lines = code.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim()
    const lineNumber = index + 1
    if (!raw || raw.startsWith('//')) continue

    const frame = stack[stack.length - 1]

    // ------------------------------------------------- closing a body
    if (raw === '})' || raw === '}' || raw === '});') {
      if (!frame) return { ok: false, line: lineNumber, reason: 'A closing brace with nothing open before it.' }
      stack.pop()
      continue
    }

    if (raw === '} else {') {
      if (!frame?.elseSlot) {
        return { ok: false, line: lineNumber, reason: 'An “else” that does not belong to an “if”.' }
      }
      stack[stack.length - 1] = {
        ...frame,
        port: frame.elseSlot,
        previous: undefined,
        elseSlot: undefined,
      }
      continue
    }

    // ----------------------------------------------------- an event
    const start = /^app\.onStart\(async \(\) => \{$/.exec(raw)
    const click = /^app\.onClick\((.*), async \(\) => \{$/.exec(raw)
    if (start || click) {
      if (frame) {
        return { ok: false, line: lineNumber, reason: 'An event handler cannot sit inside another block.' }
      }
      const node = add(click ? 'event.click' : 'event.start', 0)
      if (click) applyInput(node, 'target', click[1])
      stack.push({ nodeId: node.id, port: 'exec', depth: 1 })
      continue
    }

    if (!frame) {
      return {
        ok: false,
        line: lineNumber,
        reason: 'Only event handlers can sit at the top level of a builder file.',
      }
    }

    // -------------------------------------------------- a statement
    const binding = /^const ([A-Za-z0-9_$]+) = (.*)$/.exec(raw)
    const statement = binding ? binding[2] : raw

    const matched = definitions
      .map((definition) => ({ definition, parsed: definition.parse?.(statement) }))
      .find((candidate) => candidate.parsed)

    if (!matched?.parsed) {
      return {
        ok: false,
        line: lineNumber,
        reason: `Nothing in the block library matches “${statement.slice(0, 60)}”.`,
      }
    }

    const node = add(matched.definition.type, frame.depth)
    chain(frame, node.id)
    if (binding) symbols.set(binding[1], node.id)
    // A block can name something the plain `const x =` scan cannot see -- a
    // loop variable, for one -- so the definition gets to say so.
    if (matched.parsed.binds) symbols.set(matched.parsed.binds, node.id)
    for (const [portId, text] of Object.entries(matched.parsed.inputs)) {
      applyInput(node, portId, text, frame.depth)
    }

    if (matched.parsed.opensBody) {
      stack.push({
        nodeId: node.id,
        port: matched.parsed.opensBody,
        elseSlot: matched.parsed.elseSlot,
        depth: frame.depth + 1,
      })
    }
  }

  if (stack.length) {
    return { ok: false, line: lines.length, reason: 'The file ends with a block still open.' }
  }

  return { ok: true, graph: { nodes, connections } }
}
