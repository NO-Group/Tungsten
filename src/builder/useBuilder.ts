/**
 * The builder's state: one graph, two views of it.
 *
 * The graph is the single source of truth. The canvas edits it directly; the
 * code view edits text, which is parsed back into it after a pause. Both
 * directions run through this hook, which is what keeps them from fighting.
 *
 * The echo loop -- canvas writes code, code writes canvas, forever -- is
 * broken by never doing both in one direction. A canvas edit replaces the
 * text in the same update, so there is no later effect to misfire; a code
 * edit changes the graph and deliberately leaves the text alone, because
 * regenerating it under the cursor is the one thing an editor must never do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, type BlockDefinition, type BlockGraph, type Connection } from './blockSchema'
import { generateProgram, type GeneratedProgram } from './codeGenerator'
import { parseProgram, type ParseFailure } from './codeParser'
import { checkIntegrity, type IntegrityReport } from './integrity'
import {
  addNode,
  connect as connectPortsIn,
  createNode,
  disconnect as disconnectIn,
  moveNode,
  removeNode,
  setNodeValue,
} from './graph'

export const BUILDER_STORAGE_KEY = 'tungsten.builder.v1'

/** How long the user has to stop typing before the canvas follows. */
export const PARSE_DEBOUNCE = 300

export type BuilderHost = {
  notify: (message: string) => void
  /** Blocks contributed by plugins, already loaded. */
  plugins?: BlockDefinition[]
}

export type BuilderState = {
  graph: BlockGraph
  registry: ReturnType<typeof createRegistry>
  program: GeneratedProgram
  report: IntegrityReport
  /** The text in the code pane, which may be ahead of the graph while typing. */
  code: string
  /**
   * Set when the text cannot be read as blocks. The canvas goes read-only
   * rather than showing a graph that no longer matches the file.
   */
  parseError?: ParseFailure
  selected?: string
  /** The block the traceback last pointed at, for the canvas to reveal. */
  revealed?: string
  addBlock: (type: string, position?: { x: number; y: number }) => void
  moveBlock: (id: string, position: { x: number; y: number }) => void
  removeBlock: (id: string) => void
  setValue: (id: string, portId: string, value: string | number | boolean) => void
  link: (from: Connection['from'], to: Connection['to']) => void
  unlink: (connectionId: string) => void
  select: (id?: string) => void
  /** Reveals the block behind a line of generated code. */
  revealNode: (id: string) => void
  editCode: (next: string) => void
  clear: () => void
}

function loadGraph(): BlockGraph {
  try {
    const stored = localStorage.getItem(BUILDER_STORAGE_KEY)
    if (!stored) return { nodes: [], connections: [] }
    const parsed = JSON.parse(stored) as BlockGraph
    return Array.isArray(parsed.nodes) && Array.isArray(parsed.connections)
      ? parsed
      : { nodes: [], connections: [] }
  } catch {
    return { nodes: [], connections: [] }
  }
}

export function useBuilder(host: BuilderHost): BuilderState {
  const plugins = host.plugins
  const registry = useMemo(() => createRegistry([...builtinBlocks, ...(plugins ?? [])]), [plugins])

  const [graph, setGraph] = useState<BlockGraph>(loadGraph)
  const [code, setCode] = useState(() => generateProgram(loadGraph(), registry).code)
  const [parseError, setParseError] = useState<ParseFailure | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [revealed, setRevealed] = useState<string | undefined>(undefined)

  const program = useMemo(() => generateProgram(graph, registry), [graph, registry])

  /**
   * The checker runs on every mutation. It is pure and touches nothing but
   * the graph, so at this size it is cheaper than the re-render it feeds;
   * if a graph ever grows large enough to notice, this memo is the seam to
   * move onto a worker without changing a single caller.
   */
  const report = useMemo(() => checkIntegrity(graph, registry), [graph, registry])

  const { notify } = host
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    try {
      localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(graph))
    } catch {
      // A full quota is not worth interrupting the user over.
    }
  }, [graph])

  /** Applies a canvas edit, and rewrites the text to match it. */
  const apply = useCallback((next: BlockGraph) => {
    if (timer.current) clearTimeout(timer.current)
    setGraph(next)
    setCode(generateProgram(next, registry).code)
    setParseError(undefined)
  }, [registry])

  const addBlock = useCallback((type: string, position?: { x: number; y: number }) => {
    if (!registry.get(type)) return
    // New blocks land below the lowest one rather than on top of it.
    const lowest = graph.nodes.reduce((value, node) => Math.max(value, node.position.y), -110)
    const node = createNode(type, position ?? { x: 40, y: lowest + 110 })
    apply(addNode(graph, node))
    setSelected(node.id)
  }, [apply, graph, registry])

  const moveBlock = useCallback((id: string, position: { x: number; y: number }) => {
    apply(moveNode(graph, id, position))
  }, [apply, graph])

  const removeBlock = useCallback((id: string) => {
    apply(removeNode(graph, id))
    setSelected((current) => (current === id ? undefined : current))
  }, [apply, graph])

  const setValue = useCallback((id: string, portId: string, value: string | number | boolean) => {
    apply(setNodeValue(graph, id, portId, value))
  }, [apply, graph])

  const link = useCallback((from: Connection['from'], to: Connection['to']) => {
    const result = connectPortsIn(graph, registry, from, to)
    if (result.rejected) {
      notify(result.rejected)
      return
    }
    apply(result.graph)
  }, [apply, graph, notify, registry])

  const unlink = useCallback((connectionId: string) => {
    apply(disconnectIn(graph, connectionId))
  }, [apply, graph])

  /**
   * A keystroke in the code pane.
   *
   * The text is kept exactly as typed. Reading it back into blocks waits for
   * a pause, because parsing every keystroke would rebuild the canvas from
   * half-written lines and fill the screen with errors the user is already
   * in the middle of fixing.
   */
  const editCode = useCallback((next: string) => {
    setCode(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const parsed = parseProgram(next, registry)
      if (!parsed.ok) {
        setParseError(parsed)
        return
      }
      setParseError(undefined)
      setGraph(parsed.graph)
    }, PARSE_DEBOUNCE)
  }, [registry])

  const clear = useCallback(() => apply({ nodes: [], connections: [] }), [apply])

  const revealNode = useCallback((id: string) => {
    setSelected(id)
    setRevealed(id)
  }, [])

  return {
    graph,
    registry,
    program,
    report,
    code,
    parseError,
    selected,
    revealed,
    addBlock,
    moveBlock,
    removeBlock,
    setValue,
    link,
    unlink,
    select: setSelected,
    revealNode,
    editCode,
    clear,
  }
}
