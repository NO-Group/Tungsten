/**
 * The builder's state: one graph, several views of it.
 *
 * The graph is the single source of truth. The canvas edits it directly; the
 * code view edits text, which is parsed back into it after a pause; the
 * preview and every compile target are derived from it and never edited.
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
import { EMPTY_HISTORY, canRedo, canUndo, record, redo, undo, type History } from './history'
import { instantiate, recipeById } from './recipes'
import { BUILDER_SYNC_KEY, readSyncPreference, writeSyncPreference } from './fileSync'
import { checkIntegrity, type IntegrityReport } from './integrity'
import { compile, type CompileResult, type CompileTarget } from './compile'
import { EMPTY_SCHEMA, type Column, type DataSchema, type Table } from './dataSchema'
import { previewHtml } from './previewRuntime'
import { schemaFromGraph, type UiDocument } from './uiSchema'
import { explainFailure, type Traceback } from './traceback'
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

/** The most log lines the preview strip keeps. */
export const MAX_PREVIEW_LOGS = 80

export type BuilderHost = {
  notify: (message: string) => void
  /** Blocks contributed by workspace plugins, already parsed. */
  plugins?: BlockDefinition[]
}

type Stored = { graph: BlockGraph; schema: DataSchema }

export type BuilderState = {
  graph: BlockGraph
  registry: ReturnType<typeof createRegistry>
  program: GeneratedProgram
  report: IntegrityReport
  /** The interface, as data: what the preview and every target render. */
  ui: UiDocument
  /** The database the query blocks are drawn against. */
  schema: DataSchema
  /** The sandbox document, rebuilt whenever the program or interface changes. */
  previewDocument: string
  /** Lines the running preview has logged. */
  logs: string[]
  /** The last failure inside the preview, mapped back to a block. */
  failure?: Traceback
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
  /**
   * Creates a block already wired to the pin a wire was dragged from: one
   * gesture where placing and connecting used to be three.
   */
  addConnectedBlock: (
    type: string,
    position: { x: number; y: number },
    link: { node: string; port: string; side: 'in' | 'out' },
  ) => void
  /** Copies a block, values and all, just below itself. */
  duplicateBlock: (id: string) => void
  /** Drops a whole working feature onto the canvas. */
  addRecipe: (id: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  moveBlock: (id: string, position: { x: number; y: number }) => void
  removeBlock: (id: string) => void
  setValue: (id: string, portId: string, value: string | number | boolean) => void
  link: (from: Connection['from'], to: Connection['to']) => void
  unlink: (connectionId: string) => void
  select: (id?: string) => void
  /** Reveals the block behind a line of generated code. */
  revealNode: (id: string) => void
  editCode: (next: string) => void
  /**
   * Text arriving from outside the builder -- the workspace file, edited in
   * an ordinary editor tab. Parsed at once, because the caller has already
   * waited for the typing to pause.
   */
  adoptCode: (next: string) => void
  /** True while the program is mirrored into a workspace file. */
  syncEnabled: boolean
  setSyncEnabled: (enabled: boolean) => void
  clear: () => void
  addTable: (name?: string) => void
  renameTable: (index: number, name: string) => void
  removeTable: (index: number) => void
  addColumn: (table: number) => void
  updateColumn: (table: number, column: number, patch: Partial<Column>) => void
  removeColumn: (table: number, column: number) => void
  /** Compiles for a target, or refuses with a reason. */
  build: (target: CompileTarget) => CompileResult
  /** A line the preview logged. */
  appendLog: (text: string) => void
  clearLogs: () => void
  /** A failure reported by the preview, against a line of generated code. */
  reportFailure: (text: string, line?: number) => void
}

function load(): Stored {
  const empty: Stored = { graph: { nodes: [], connections: [] }, schema: EMPTY_SCHEMA }
  try {
    const stored = localStorage.getItem(BUILDER_STORAGE_KEY)
    if (!stored) return empty
    const parsed = JSON.parse(stored) as Partial<Stored> & Partial<BlockGraph>
    // The first release stored a bare graph; a saved canvas outlives its
    // storage format, so the old shape is still read rather than discarded.
    const graph = parsed.graph ?? (Array.isArray(parsed.nodes) && Array.isArray(parsed.connections)
      ? { nodes: parsed.nodes, connections: parsed.connections }
      : empty.graph)
    const schema = parsed.schema?.tables ? parsed.schema : EMPTY_SCHEMA
    return { graph, schema }
  } catch {
    return empty
  }
}

export function useBuilder(host: BuilderHost): BuilderState {
  const plugins = host.plugins
  const registry = useMemo(() => createRegistry([...builtinBlocks, ...(plugins ?? [])]), [plugins])

  const [initial] = useState(load)
  const [graph, setGraph] = useState<BlockGraph>(initial.graph)
  const [schema, setSchema] = useState<DataSchema>(initial.schema)
  const [code, setCode] = useState(() => generateProgram(initial.graph, registry).code)
  const [parseError, setParseError] = useState<ParseFailure | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [revealed, setRevealed] = useState<string | undefined>(undefined)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [syncEnabled, setSyncEnabled] = useState(() => {
    try {
      return readSyncPreference(localStorage.getItem(BUILDER_SYNC_KEY))
    } catch {
      return true
    }
  })
  const [logs, setLogs] = useState<string[]>([])
  const [failure, setFailure] = useState<Traceback | undefined>(undefined)

  const program = useMemo(() => generateProgram(graph, registry), [graph, registry])
  const ui = useMemo(() => schemaFromGraph(graph, registry), [graph, registry])

  /**
   * The checker runs on every mutation. It is pure and touches nothing but
   * the graph, so at this size it is cheaper than the re-render it feeds;
   * if a graph ever grows large enough to notice, this memo is the seam to
   * move onto a worker without changing a single caller.
   */
  const report = useMemo(() => checkIntegrity(graph, registry), [graph, registry])

  /**
   * The sandbox is rebuilt from the generated program, not from the text in
   * the pane: a preview of half-typed code would be noise.
   */
  const previewDocument = useMemo(
    () => previewHtml({ document: ui, code: program.code }),
    [program.code, ui],
  )

  const { notify } = host
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /**
   * What gets saved, computed rather than serialised inside the effect: the
   * effect then depends on one string, so it writes exactly when the saved
   * bytes would differ and not merely when an object identity changed.
   */
  const persisted = useMemo(() => JSON.stringify({ graph, schema }), [graph, schema])

  useEffect(() => {
    try {
      localStorage.setItem(BUILDER_STORAGE_KEY, persisted)
    } catch {
      // A full storage quota is not worth interrupting the user over. Nothing
      // else can throw here: the value was serialised before the effect ran,
      // so a bad graph fails loudly at the memo instead of silently here.
    }
  }, [persisted])

  /**
   * Applies a canvas edit, records the graph it replaced, and rewrites the
   * text to match.
   *
   * `coalesce` names the gesture: a drag or a run of keystrokes in one field
   * shares a key, so the whole gesture undoes in one step rather than fifty.
   */
  const apply = useCallback((next: BlockGraph, coalesce?: string) => {
    if (timer.current) clearTimeout(timer.current)
    setHistory((current) => record(current, graph, { coalesce }))
    setGraph(next)
    setCode(generateProgram(next, registry).code)
    setParseError(undefined)
  }, [graph, registry])

  /** Restores a graph from the history stacks. */
  const restore = useCallback((step: { history: History; graph: BlockGraph } | undefined) => {
    if (!step) return
    if (timer.current) clearTimeout(timer.current)
    setHistory(step.history)
    setGraph(step.graph)
    setCode(generateProgram(step.graph, registry).code)
    setParseError(undefined)
    setSelected((current) => (step.graph.nodes.some((node) => node.id === current) ? current : undefined))
  }, [registry])

  const undoAction = useCallback(() => restore(undo(history, graph)), [graph, history, restore])
  const redoAction = useCallback(() => restore(redo(history, graph)), [graph, history, restore])

  const addBlock = useCallback((type: string, position?: { x: number; y: number }) => {
    if (!registry.get(type)) return
    // New blocks land below the lowest one rather than on top of it.
    const lowest = graph.nodes.reduce((value, node) => Math.max(value, node.position.y), -110)
    const node = createNode(type, position ?? { x: 40, y: lowest + 110 })
    apply(addNode(graph, node))
    setSelected(node.id)
  }, [apply, graph, registry])

  /**
   * The quick add: a block created and connected in the same gesture.
   *
   * The link is attempted after the block exists, and a refusal is reported
   * rather than swallowed -- dragging a String output into a List input
   * should say so, not quietly leave an unconnected block behind.
   */
  const addConnectedBlock = useCallback((
    type: string,
    position: { x: number; y: number },
    to: { node: string; port: string; side: 'in' | 'out' },
  ) => {
    const definition = registry.get(type)
    if (!definition) return
    const node = createNode(type, position)
    const withNode = addNode(graph, node)

    // Take the first port on the new block the drag could legally reach, so
    // dragging an Exec pin lands on Run and a String output lands on the
    // first String input rather than on nothing.
    const candidates = to.side === 'out'
      ? definition.inputs
      : [...definition.outputs, ...(definition.slots ?? [])]

    let next = withNode
    let linked = false
    for (const port of candidates) {
      const attempt = to.side === 'out'
        ? connectPortsIn(withNode, registry, { node: to.node, port: to.port }, { node: node.id, port: port.id })
        : connectPortsIn(withNode, registry, { node: node.id, port: port.id }, { node: to.node, port: to.port })
      if (attempt.rejected) continue
      next = attempt.graph
      linked = true
      break
    }

    apply(next)
    setSelected(node.id)
    if (!linked) notify(`${definition.label} has no port that fits that connection`)
  }, [apply, graph, notify, registry])

  const duplicateBlock = useCallback((id: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    const copy = createNode(node.type, { x: node.position.x + 32, y: node.position.y + 32 })
    copy.values = { ...node.values }
    apply(addNode(graph, copy))
    setSelected(copy.id)
  }, [apply, graph])

  /** Drops a whole feature in, already wired. */
  const addRecipe = useCallback((id: string) => {
    const recipe = recipeById(id)
    if (!recipe) return
    const result = instantiate(recipe, graph, registry)
    apply(result.graph)
    setSelected(result.added[0])
    notify(
      result.rejected.length
        ? `${recipe.name} added, but ${result.rejected.length} link was refused`
        : `Added ${recipe.outcome}`,
    )
  }, [apply, graph, notify, registry])

  const moveBlock = useCallback((id: string, position: { x: number; y: number }) => {
    apply(moveNode(graph, id, position), `move:${id}`)
  }, [apply, graph])

  const removeBlock = useCallback((id: string) => {
    apply(removeNode(graph, id))
    setSelected((current) => (current === id ? undefined : current))
  }, [apply, graph])

  const setValue = useCallback((id: string, portId: string, value: string | number | boolean) => {
    apply(setNodeValue(graph, id, portId, value), `value:${id}:${portId}`)
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

  /**
   * The same read as `editCode`, without the wait.
   *
   * History is recorded so a change that arrived from the file is as
   * undoable as one made on the canvas, and the text is kept exactly as it
   * was written -- reformatting someone's file underneath them is not sync,
   * it is vandalism.
   */
  const adoptCode = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current)
    setCode(next)
    const parsed = parseProgram(next, registry)
    if (!parsed.ok) {
      setParseError(parsed)
      return
    }
    setParseError(undefined)
    setHistory((current) => record(current, graph, { coalesce: 'file' }))
    setGraph(parsed.graph)
  }, [graph, registry])

  const chooseSync = useCallback((enabled: boolean) => {
    setSyncEnabled(enabled)
    try {
      localStorage.setItem(BUILDER_SYNC_KEY, writeSyncPreference(enabled))
    } catch {
      // A full quota is not a reason to refuse the choice for this session.
    }
  }, [])

  const clear = useCallback(() => apply({ nodes: [], connections: [] }), [apply])

  const revealNode = useCallback((id: string) => {
    setSelected(id)
    setRevealed(id)
  }, [])

  // ------------------------------------------------------- the database

  const addTable = useCallback((name?: string) => {
    // Guarded rather than trusted: a handler wired straight to onClick would
    // hand an event in here, and a table named after a DOM node poisons
    // everything downstream of it.
    const requested = typeof name === 'string' && name.trim() ? name.trim() : 'table'
    setSchema((current) => {
      const taken = new Set(current.tables.map((table) => table.name))
      let candidate = requested
      let index = 1
      while (taken.has(candidate)) { index += 1; candidate = `${requested}_${index}` }
      const table: Table = { name: candidate, columns: [{ name: 'title', type: 'text', required: true }] }
      return { tables: [...current.tables, table] }
    })
  }, [])

  const renameTable = useCallback((index: number, name: string) => {
    setSchema((current) => ({
      tables: current.tables.map((table, position) => (position === index ? { ...table, name } : table)),
    }))
  }, [])

  const removeTable = useCallback((index: number) => {
    setSchema((current) => ({ tables: current.tables.filter((_, position) => position !== index) }))
  }, [])

  const addColumn = useCallback((table: number) => {
    setSchema((current) => ({
      tables: current.tables.map((entry, position) => (position === table
        ? { ...entry, columns: [...entry.columns, { name: `column_${entry.columns.length + 1}`, type: 'text' as const }] }
        : entry)),
    }))
  }, [])

  const updateColumn = useCallback((table: number, column: number, patch: Partial<Column>) => {
    setSchema((current) => ({
      tables: current.tables.map((entry, position) => (position === table
        ? {
          ...entry,
          columns: entry.columns.map((candidate, index) => (index === column ? { ...candidate, ...patch } : candidate)),
        }
        : entry)),
    }))
  }, [])

  const removeColumn = useCallback((table: number, column: number) => {
    setSchema((current) => ({
      tables: current.tables.map((entry, position) => (position === table
        ? { ...entry, columns: entry.columns.filter((_, index) => index !== column) }
        : entry)),
    }))
  }, [])

  // ------------------------------------------- compiling, and the preview

  const build = useCallback(
    (target: CompileTarget) => compile({ graph, registry, schema, target }),
    [graph, registry, schema],
  )

  const appendLog = useCallback((text: string) => {
    setLogs((current) => [...current, text].slice(-MAX_PREVIEW_LOGS))
  }, [])

  const clearLogs = useCallback(() => { setLogs([]); setFailure(undefined) }, [])

  const reportFailure = useCallback((text: string, line?: number) => {
    const explained = explainFailure(
      program,
      registry,
      text,
      line,
      (nodeId) => graph.nodes.find((node) => node.id === nodeId)?.type,
    )
    setFailure(explained)
    if (explained.nodeId) {
      setSelected(explained.nodeId)
      setRevealed(explained.nodeId)
    }
  }, [graph.nodes, program, registry])

  return {
    graph,
    registry,
    program,
    report,
    ui,
    schema,
    previewDocument,
    logs,
    failure,
    code,
    parseError,
    selected,
    revealed,
    addBlock,
    addConnectedBlock,
    duplicateBlock,
    addRecipe,
    undo: undoAction,
    redo: redoAction,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    moveBlock,
    removeBlock,
    setValue,
    link,
    unlink,
    select: setSelected,
    revealNode,
    editCode,
    adoptCode,
    syncEnabled,
    setSyncEnabled: chooseSync,
    clear,
    addTable,
    renameTable,
    removeTable,
    addColumn,
    updateColumn,
    removeColumn,
    build,
    appendLog,
    clearLogs,
    reportFailure,
  }
}
