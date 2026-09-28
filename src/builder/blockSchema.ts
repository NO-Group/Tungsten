/**
 * The vocabulary of the visual builder: blocks, ports, and the graph they
 * form.
 *
 * A block definition is a contract. It declares the ports a block exposes,
 * the types flowing through them, and how the block turns into source text.
 * Nothing here knows about React, the canvas, or the editor -- the graph is
 * the single source of truth, and both the canvas and the text view are
 * projections of it.
 *
 * Two kinds of edge run through a graph. `Exec` edges are the order things
 * happen in, the way a statement follows a statement; data edges carry
 * values into a block's inputs. Keeping them in one graph, distinguished by
 * port type, is what lets the integrity checker reason about execution
 * order and about values with the same traversal.
 */

/** The types a port can carry. `Exec` is control flow rather than a value. */
export type PortType = 'Exec' | 'String' | 'Number' | 'Boolean' | 'List' | 'Object' | 'Any'

export type Port = {
  id: string
  label: string
  type: PortType
  /** A data input with no connection falls back to this literal. */
  default?: string | number | boolean
  /** An input that must be connected or given a value before code is generated. */
  required?: boolean
}

export type BlockCategory = 'Events' | 'UI' | 'Logic' | 'Data' | 'Network' | 'Auth' | 'Storage'

/** What a code generator is handed when it is asked for its text. */
export type GenerateContext = {
  node: BlockNode
  /**
   * The expression text for a data input: the connected block's generated
   * value, or the literal the user typed, or the port's default.
   */
  input: (portId: string) => string
  /** The statements of a nested body (the blocks inside a loop or branch). */
  body: (portId: string) => string
  /** A stable identifier derived from the node id, safe to use as a variable. */
  symbol: string
  /** Indentation to apply to nested lines. */
  indent: string
}

export type BlockDefinition = {
  type: string
  label: string
  category: BlockCategory
  description: string
  /** Events start an execution chain; everything else has to be reached. */
  isEvent?: boolean
  /** Generates a promise, so its call site is awaited and its handler async. */
  isAsync?: boolean
  inputs: Port[]
  outputs: Port[]
  /**
   * Nested statement slots, each rendered as a body the user can drop blocks
   * into -- the inside of an `if`, the inside of a loop.
   */
  slots?: Port[]
  /** Turns the node into source text: a statement, or an expression. */
  generate: (context: GenerateContext) => string
}

/**
 * Declares a block.
 *
 * This is the plugin SDK: a package adds blocks by exporting definitions
 * built with this function, and the registry picks them up. It exists rather
 * than using an object literal directly so a definition is checked at its
 * declaration site, where the error is readable.
 */
export function defineBlock(definition: BlockDefinition): BlockDefinition {
  return definition
}

export type BlockNode = {
  id: string
  type: string
  position: { x: number; y: number }
  /** Literal values for unconnected data inputs, by port id. */
  values: Record<string, string | number | boolean>
}

export type Connection = {
  id: string
  from: { node: string; port: string }
  to: { node: string; port: string }
}

export type BlockGraph = {
  nodes: BlockNode[]
  connections: Connection[]
}

export const EMPTY_GRAPH: BlockGraph = { nodes: [], connections: [] }

/**
 * Whether a value of one type can flow into a port of another.
 *
 * `Any` is the escape hatch in both directions -- it is what a pass-through
 * block like "log" accepts. Execution never mixes with data: an `Exec` port
 * only ever connects to another `Exec` port, which is what stops a user
 * wiring the order of operations into a number.
 */
export function isAssignable(from: PortType, to: PortType): boolean {
  if (from === 'Exec' || to === 'Exec') return from === to
  if (from === 'Any' || to === 'Any') return true
  return from === to
}

export type BlockRegistry = {
  get: (type: string) => BlockDefinition | undefined
  all: () => BlockDefinition[]
  byCategory: () => Array<{ category: BlockCategory; blocks: BlockDefinition[] }>
}

const CATEGORY_ORDER: BlockCategory[] = ['Events', 'UI', 'Logic', 'Data', 'Network', 'Auth', 'Storage']

/**
 * Builds a registry from definitions.
 *
 * A later definition wins, so a plugin can replace a built-in block rather
 * than colliding with it.
 */
export function createRegistry(definitions: BlockDefinition[]): BlockRegistry {
  const byType = new Map<string, BlockDefinition>()
  for (const definition of definitions) byType.set(definition.type, definition)

  return {
    get: (type) => byType.get(type),
    all: () => [...byType.values()],
    byCategory: () => {
      const groups = new Map<BlockCategory, BlockDefinition[]>()
      for (const definition of byType.values()) {
        groups.set(definition.category, [...(groups.get(definition.category) ?? []), definition])
      }
      return CATEGORY_ORDER
        .filter((category) => groups.has(category))
        .map((category) => ({
          category,
          blocks: (groups.get(category) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
        }))
    },
  }
}

/** The port declarations of a node, looked up through its definition. */
export function portsOf(definition: BlockDefinition) {
  return {
    inputs: definition.inputs,
    outputs: definition.outputs,
    slots: definition.slots ?? [],
  }
}

export function findPort(definition: BlockDefinition, portId: string): Port | undefined {
  return definition.inputs.find((port) => port.id === portId)
    ?? definition.outputs.find((port) => port.id === portId)
    ?? definition.slots?.find((port) => port.id === portId)
}
