/**
 * The code integrity checker.
 *
 * A visual editor makes states a text editor cannot: a string plugged into
 * a multiplication, a query whose result nobody reads, a chain of steps that
 * loops back on itself. This runs over the whole graph after every change
 * and reports what is wrong, in the user's words, attached to the block that
 * is wrong rather than to a line of generated output.
 *
 * Errors block compilation. Warnings do not -- an orphaned block is a
 * half-finished thought, not a mistake, and dimming it is enough.
 *
 * The checker is pure and total: it never throws, and it terminates on any
 * graph, including a cyclic one, because that is precisely the input it
 * exists to describe.
 */

import {
  findPort,
  isAssignable,
  type BlockGraph,
  type BlockRegistry,
  type PortType,
} from './blockSchema'
import { execChainNodes, inScope, incoming, liveNodes, nodeById, scopesOf } from './graph'

export type DiagnosticSeverity = 'error' | 'warning'

export type BuilderDiagnostic = {
  severity: DiagnosticSeverity
  /** The block the problem belongs to; the canvas highlights it. */
  nodeId: string
  /** The link at fault, when the problem is a connection. */
  connectionId?: string
  portId?: string
  /** Written for the person who drew the graph, not for a compiler. */
  message: string
  /** What to do about it, in one sentence. Always present. */
  fix: string
  code: IntegrityRule
}

export type IntegrityRule =
  | 'unknown-block'
  | 'type-mismatch'
  | 'missing-input'
  | 'cycle'
  | 'orphan'
  | 'unreachable-value'
  | 'out-of-scope'
  | 'unused-result'
  | 'unknown-variable'

export type IntegrityReport = {
  diagnostics: BuilderDiagnostic[]
  /** Nodes that never run: dimmed on the canvas, left out of the code. */
  orphans: Set<string>
  /** Nodes involved in a cycle. */
  cyclic: Set<string>
  /** True when nothing blocks compilation. */
  compilable: boolean
}

const ARTICLE: Record<PortType, string> = {
  Exec: 'a step', String: 'text', Number: 'a number', Boolean: 'a yes/no value',
  List: 'a list', Object: 'an object', Any: 'anything',
}

/**
 * Tarjan's strongly connected components.
 *
 * Any component with more than one node -- or a node linked to itself -- is
 * a cycle: an execution chain that never ends, or a value that depends on
 * itself. Both are found by the same traversal because both are edges.
 */
function stronglyConnected(graph: BlockGraph): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0

  const successors = new Map<string, string[]>()
  for (const node of graph.nodes) successors.set(node.id, [])
  for (const connection of graph.connections) {
    successors.get(connection.from.node)?.push(connection.to.node)
  }

  // Iterative: a deep chain of blocks must not overflow the stack.
  for (const root of graph.nodes) {
    if (index.has(root.id)) continue
    const work: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }]
    index.set(root.id, counter)
    low.set(root.id, counter)
    counter += 1
    stack.push(root.id)
    onStack.add(root.id)

    while (work.length) {
      const frame = work[work.length - 1]
      const children = successors.get(frame.id) ?? []

      if (frame.next < children.length) {
        const child = children[frame.next]
        frame.next += 1
        if (!index.has(child)) {
          index.set(child, counter)
          low.set(child, counter)
          counter += 1
          stack.push(child)
          onStack.add(child)
          work.push({ id: child, next: 0 })
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(child)!))
        }
        continue
      }

      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!))

      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = []
        let member: string
        do {
          member = stack.pop()!
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.id)
        components.push(component)
      }
    }
  }

  return components
}

export function checkIntegrity(
  graph: BlockGraph,
  registry: BlockRegistry,
  state: readonly { name: string }[] = [],
): IntegrityReport {
  /** Variables the file declares. A block may only name one of these. */
  const declared = new Set(state.map((variable) => variable.name))
  const diagnostics: BuilderDiagnostic[] = []
  const cyclic = new Set<string>()

  // ------------------------------------------------- unknown variables
  // A block naming a variable the file does not declare would generate
  // code that reads undefined at runtime, which is exactly the class of
  // mistake the canvas exists to make impossible.
  for (const node of graph.nodes) {
    if (node.type !== 'state.get' && node.type !== 'state.set') continue
    const name = String(node.values.name ?? '').replace(/^"|"$/g, '')
    if (name && declared.has(name)) continue
    diagnostics.push({
      severity: 'error',
      nodeId: node.id,
      portId: 'name',
      message: name
        ? `There is no variable called “${name}”.`
        : 'This block does not say which variable it means.',
      fix: name
        ? `Add “${name}” in the Variables panel, or pick one that exists.`
        : 'Choose a variable in the inspector, or add one in the Variables panel.',
      code: 'unknown-variable',
    })
  }

  // ---------------------------------------------------- unknown blocks
  for (const node of graph.nodes) {
    if (registry.get(node.type)) continue
    diagnostics.push({
      severity: 'error',
      nodeId: node.id,
      code: 'unknown-block',
      message: `“${node.type}” is not a block this workspace knows.`,
      fix: `Install the plugin that provides “${node.type}”, or delete the block.`,
    })
  }

  // ------------------------------------------------------ type safety
  for (const connection of graph.connections) {
    const source = nodeById(graph, connection.from.node)
    const target = nodeById(graph, connection.to.node)
    const sourceDefinition = source && registry.get(source.type)
    const targetDefinition = target && registry.get(target.type)
    if (!source || !target || !sourceDefinition || !targetDefinition) continue

    const output = findPort(sourceDefinition, connection.from.port)
    const input = findPort(targetDefinition, connection.to.port)
    if (!output || !input) {
      diagnostics.push({
        severity: 'error',
        nodeId: target.id,
        connectionId: connection.id,
        code: 'type-mismatch',
        message: 'This link points at a port that no longer exists.',
        fix: 'Delete the link and draw it again to whichever port replaced it.',
      })
      continue
    }

    if (!isAssignable(output.type, input.type)) {
      diagnostics.push({
        severity: 'error',
        nodeId: target.id,
        connectionId: connection.id,
        portId: input.id,
        code: 'type-mismatch',
        message: `“${sourceDefinition.label} → ${output.label}” gives ${ARTICLE[output.type]}, but “${input.label}” needs ${ARTICLE[input.type]}.`,
        fix: `Remove the link, or put a block between them that turns ${ARTICLE[output.type]} into ${ARTICLE[input.type]}.`,
      })
    }
  }

  // ------------------------------------------------- cycles and loops
  for (const component of stronglyConnected(graph)) {
    const selfLink = component.length === 1
      && graph.connections.some((connection) => (
        connection.from.node === component[0] && connection.to.node === component[0]
      ))
    if (component.length === 1 && !selfLink) continue

    for (const id of component) cyclic.add(id)
    const labels = component
      .map((id) => registry.get(nodeById(graph, id)?.type ?? '')?.label ?? id)
      .join(' → ')
    diagnostics.push({
      severity: 'error',
      nodeId: component[0],
      code: 'cycle',
      message: `These blocks run in a circle and would never finish: ${labels}.`,
      fix: 'Delete one link in the loop. If you meant to repeat something, use a For Each block instead.',
    })
  }

  // ------------------------------------- what runs, and what does not
  const live = liveNodes(graph, registry)
  const running = execChainNodes(graph, registry)
  const scopes = scopesOf(graph, registry)

  for (const node of graph.nodes) {
    const definition = registry.get(node.type)
    if (!definition || live.has(node.id)) continue
    const isolated = !graph.connections.some(
      (connection) => connection.from.node === node.id || connection.to.node === node.id,
    )
    diagnostics.push({
      severity: 'warning',
      nodeId: node.id,
      code: 'orphan',
      message: isolated
        ? `“${definition.label}” is not connected to anything, so it will not run or appear in the code.`
        : `Nothing leads to “${definition.label}”.`,
      fix: 'Link its Run port to the step before it, or delete the block.',
    })
  }

  // --------------------------------- required inputs, and their order
  for (const node of graph.nodes) {
    const definition = registry.get(node.type)
    if (!definition || !live.has(node.id)) continue

    for (const port of definition.inputs) {
      if (port.type === 'Exec') continue
      const link = incoming(graph, node.id, port.id)

      if (!link) {
        const given = node.values[port.id] ?? port.default
        if (port.required && (given === undefined || given === '')) {
          diagnostics.push({
            severity: 'error',
            nodeId: node.id,
            portId: port.id,
            code: 'missing-input',
            message: `“${definition.label}” needs ${ARTICLE[port.type]} for “${port.label}”.`,
            fix: `Type a value into “${port.label}”, or connect a block that produces ${ARTICLE[port.type]}.`,
          })
        }
        continue
      }

      // A block that occupies a step is read by the variable it assigns, so
      // the step has to happen first. Reading one that never runs would
      // generate a reference to a variable that was never declared.
      const source = nodeById(graph, link.from.node)
      const sourceDefinition = source && registry.get(source.type)
      if (!source || !sourceDefinition) continue
      const sourceIsStatement = sourceDefinition.inputs.some((candidate) => candidate.type === 'Exec')
      if (sourceIsStatement && !running.has(source.id)) {
        diagnostics.push({
          severity: 'error',
          nodeId: node.id,
          connectionId: link.id,
          portId: port.id,
          code: 'unreachable-value',
          message: `“${definition.label}” reads “${sourceDefinition.label}”, but that block never runs.`,
          fix: `Put “${sourceDefinition.label}” in the execution chain before this block.`,
        })
        continue
      }

      // Reachable is not the same as readable. The value lives in a variable,
      // and a variable belongs to the handler and the body it was bound in.
      const here = scopes.get(node.id)
      const there = scopes.get(source.id)
      if (sourceIsStatement && here && there && !inScope(there, here)) {
        const crossHandler = there.event !== here.event
        const later = there.order >= here.order
        diagnostics.push({
          severity: 'error',
          nodeId: node.id,
          connectionId: link.id,
          portId: port.id,
          code: 'out-of-scope',
          message: crossHandler
            ? `“${definition.label}” reads “${sourceDefinition.label}”, which runs in a different handler.`
            : later
              ? `“${definition.label}” reads “${sourceDefinition.label}” before that block has run.`
              : `“${definition.label}” reads “${sourceDefinition.label}”, which is inside a branch that has already finished.`,
          fix: crossHandler
            ? 'Move both blocks into the same handler, or read the value from the page instead — an Input Value block reads a field by id from anywhere.'
            : later
              ? `Move “${sourceDefinition.label}” earlier in the chain.`
              : `Move “${definition.label}” inside the same branch as “${sourceDefinition.label}”.`,
        })
      }
    }
  }

  // ------------------------------------------- results nobody reads
  for (const node of graph.nodes) {
    const definition = registry.get(node.type)
    if (!definition?.isAsync || !live.has(node.id)) continue
    const dataOutputs = definition.outputs.filter((port) => port.type !== 'Exec')
    if (!dataOutputs.length) continue
    const read = dataOutputs.some((port) => graph.connections.some(
      (connection) => connection.from.node === node.id && connection.from.port === port.id,
    ))
    if (read) continue
    diagnostics.push({
      severity: 'warning',
      nodeId: node.id,
      code: 'unused-result',
      message: `“${definition.label}” waits for a result that nothing reads.`,
      fix: 'Connect its result to something, or delete the block: you are paying for a round trip and discarding it.',
    })
  }

  const orphans = new Set(graph.nodes.map((node) => node.id).filter((id) => !live.has(id)))

  return {
    diagnostics: diagnostics.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.code.localeCompare(b.code)),
    orphans,
    cyclic,
    compilable: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  }
}

/** Groups diagnostics by block, for the canvas badges. */
export function diagnosticsByNode(report: IntegrityReport): Map<string, BuilderDiagnostic[]> {
  const byNode = new Map<string, BuilderDiagnostic[]>()
  for (const diagnostic of report.diagnostics) {
    byNode.set(diagnostic.nodeId, [...(byNode.get(diagnostic.nodeId) ?? []), diagnostic])
  }
  return byNode
}
