/**
 * The builder surface: blocks on the left, the program on the right.
 *
 * Neither pane is the preview of the other. The graph is the program; the
 * text is the program; the sandbox is the program, running. Editing any of
 * the first two edits the same thing, and the strip between them says whether
 * what is there right now would compile.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BoxSelect, Code2, Copy, Eraser, FileDown, Hammer, Hand, Info, LayoutGrid, Link2,
  Link2Off, MousePointer2, Play, Redo2, SlidersHorizontal, Undo2, X,
} from 'lucide-react'

import Editor from '../ConfiguredEditor'
import { BuilderCanvas } from './BuilderCanvas'
import { InspectorPanel } from './InspectorPanel'
import { StatePanel } from './StatePanel'
import { BuilderPreview } from './BuilderPreview'
import { DataSchemaPanel } from './DataSchemaPanel'
import { diagnosticsByNode } from '../../builder/integrity'
import { lineOfNode, nodeAtLine } from '../../builder/codeGenerator'
import type { CompileTarget } from '../../builder/compile'
import type { BuilderState } from '../../builder/useBuilder'
import { BUILDER_SYNC_PATH } from '../../builder/fileSync'
import { TOOLS, toolForKey, type ToolId } from '../../builder/tools'

export type BuilderViewProps = {
  builder: BuilderState
  /**
   * Resolved Monaco options, so the code pane obeys the user's settings.
   * Same shape the editor groups are handed: already resolved, never read
   * from the configuration here.
   */
  editorOptions: Record<string, unknown>
  theme: string
  /** Writes the generated program into the workspace. */
  onExport: (code: string) => void
  /** Opens the mirrored file in an editor tab, without closing the builder. */
  onOpenFile?: (path: string) => void
  /** Writes a compiled target into the workspace. */
  onBuild: (target: CompileTarget) => void
  onClose: () => void
}

const TARGETS: Array<{ id: CompileTarget; label: string }> = [
  { id: 'web', label: 'Web bundle' },
  { id: 'mobile', label: 'Mobile source' },
  { id: 'node', label: 'Local runner' },
]

export function BuilderView({ builder, editorOptions, theme, onExport, onOpenFile, onBuild, onClose }: BuilderViewProps) {
  const { graph, registry, report, program, code, parseError } = builder
  const diagnostics = useMemo(() => diagnosticsByNode(report), [report])

  const [tool, setTool] = useState<ToolId>('pick')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [rightPane, setRightPane] = useState<'code' | 'preview'>('code')
  const [bottomPane, setBottomPane] = useState<'integrity' | 'data' | 'state'>('integrity')
  const [target, setTarget] = useState<CompileTarget>('web')

  /**
   * The keys that make a canvas quick.
   *
   * Bound on the document rather than the canvas so they work wherever the
   * focus happens to be in the builder -- except in a field, where every one
   * of these means something else to the person typing.
   */
  const { selection, selected, duplicateBlock, moveBlock, undo, redo } = builder
  const { removeSelection, selectAll, copySelection, cutSelection, paste } = builder
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selected),
    [graph.nodes, selected],
  )
  const selectedNodes = useMemo(
    () => graph.nodes.filter((node) => selection.includes(node.id)),
    [graph.nodes, selection],
  )

  /**
   * The system clipboard, used when it will have us.
   *
   * It is permission-gated and unavailable outside a secure context, so
   * every call is best-effort: the builder keeps its own copy, and paste
   * falls back to that. Failing to reach the OS clipboard must never mean
   * failing to copy.
   */
  const toClipboard = (text?: string) => {
    if (!text) return
    void navigator.clipboard?.writeText?.(text).catch(() => undefined)
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (typing) return

      // A bare letter picks a tool, the way it does in a drawing program.
      const picked = !event.metaKey && !event.ctrlKey && !event.altKey ? toolForKey(event.key) : undefined
      if (picked) {
        event.preventDefault()
        setTool(picked)
        return
      }

      const accel = event.metaKey || event.ctrlKey

      if (accel && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAll()
        return
      }
      if (accel && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        toClipboard(copySelection())
        return
      }
      if (accel && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        toClipboard(cutSelection())
        return
      }
      if (accel && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        // Ask the OS first; `paste` falls back to the internal copy when
        // the read is refused or the text is not ours.
        const read = navigator.clipboard?.readText?.()
        if (read) void read.then((text) => paste(text)).catch(() => paste())
        else paste()
        return
      }
      if (accel && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (accel && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (!selectedNode) return

      if (accel && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        // Duplicating a group is a copy and a paste, which is exactly what
        // it means, rather than a second code path.
        if (selection.length > 1) { copySelection(); paste() }
        else duplicateBlock(selectedNode.id)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelection()
        return
      }

      // Arrows nudge: a grid step, or a coarse one with shift.
      const step = event.shiftKey ? 32 : 8
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      }
      const delta = nudge[event.key]
      if (!delta) return
      event.preventDefault()
      // moveBlock carries the rest of the selection with it.
      moveBlock(selectedNode.id, {
        x: Math.max(0, selectedNode.position.x + delta[0]),
        y: Math.max(0, selectedNode.position.y + delta[1]),
      })
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [
    copySelection, cutSelection, duplicateBlock, moveBlock, paste, redo, removeSelection,
    selectAll, selectedNode, selection.length, undo,
  ])

  /** Variables some block actually reads or writes, for the dimming. */
  const usedVariables = useMemo(() => new Set(
    graph.nodes
      .filter((node) => node.type === 'state.get' || node.type === 'state.set')
      .map((node) => String(node.values.name ?? '').replace(/^"|"$/g, ''))
      .filter(Boolean),
  ), [graph.nodes])

  const errors = report.diagnostics.filter((entry) => entry.severity === 'error')
  const warnings = report.diagnostics.filter((entry) => entry.severity === 'warning')
  const blocked = Boolean(parseError) || !report.compilable

  return (
    <div className="builder-view">
      <header className="builder-toolbar">
        <span className="builder-title"><Code2 size={13} /> Builder</span>
        <span className="builder-count">
          {selection.length > 1 ? `${selection.length} of ` : ''}{graph.nodes.length} blocks · {builder.ui.components.length} components · {builder.schema.tables.length} tables
        </span>

        <span className={`builder-state ${blocked ? 'blocked' : 'ready'}`}>
          {parseError
            ? 'Read-only: the code does not parse'
            : report.compilable
              ? 'Ready to compile'
              : `${errors.length} error${errors.length === 1 ? '' : 's'} block compilation`}
        </span>

        <span className="builder-toolbar-spacer" />

        {/*
          The mirrored file, said plainly: what it is bound to, and a way to
          go look at it. A sync you cannot see is a sync you cannot trust.
        */}
        <button
          className={`builder-sync ${builder.syncEnabled ? 'on' : 'off'}`}
          aria-label={builder.syncEnabled ? 'Turn off file sync' : 'Turn on file sync'}
          title={builder.syncEnabled
            ? `Two-way sync with ${BUILDER_SYNC_PATH} — edits there move the blocks`
            : `Not synced with ${BUILDER_SYNC_PATH}`}
          onClick={() => builder.setSyncEnabled(!builder.syncEnabled)}
        >
          {builder.syncEnabled ? <Link2 size={13} /> : <Link2Off size={13} />}
          <span>{builder.syncEnabled ? 'Synced' : 'Not synced'}</span>
        </button>
        {Boolean(onOpenFile) && (
          <button
            aria-label="Open the synced file"
            title={`Open ${BUILDER_SYNC_PATH} in an editor tab`}
            onClick={() => onOpenFile?.(BUILDER_SYNC_PATH)}
          >
            <Code2 size={13} /> {BUILDER_SYNC_PATH.split('/').pop()}
          </button>
        )}

        <button aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!builder.canUndo}>
          <Undo2 size={13} />
        </button>
        <button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!builder.canRedo}>
          <Redo2 size={13} />
        </button>
        <button
          aria-label={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
          title="The properties of whatever is selected"
          className={inspectorOpen ? 'active' : ''}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          <SlidersHorizontal size={13} />
        </button>
        <button
          aria-label="Tidy the canvas"
          title="Lay the graph out left to right, one column per step"
          onClick={builder.tidy}
          disabled={!graph.nodes.length || builder.isTidy}
        >
          <LayoutGrid size={13} />
        </button>
        <button
          aria-label="Duplicate block"
          title={selection.length > 1
            ? `Duplicate the ${selection.length} selected blocks (Ctrl+D)`
            : 'Duplicate the selected block (Ctrl+D)'}
          onClick={() => {
            if (selection.length > 1) { copySelection(); paste() }
            else if (selectedNode) duplicateBlock(selectedNode.id)
          }}
          disabled={!selectedNodes.length}
        >
          <Copy size={13} />
        </button>

        <select
          aria-label="Compile target"
          value={target}
          onChange={(event) => setTarget(event.target.value as CompileTarget)}
        >
          {TARGETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <button onClick={() => onBuild(target)} disabled={blocked}>
          <Hammer size={13} /> Build
        </button>
        <button onClick={() => onExport(program.code)} disabled={blocked}>
          <FileDown size={13} /> Write to file
        </button>
        <button onClick={builder.clear} disabled={!graph.nodes.length}>
          <Eraser size={13} /> Clear
        </button>
        <button aria-label="Close the builder" onClick={onClose}><X size={13} /></button>
      </header>

      {parseError && (
        <p className="builder-banner" role="alert">
          <AlertTriangle size={13} />
          Line {parseError.line}: {parseError.reason} The canvas is read-only until the code reads
          as blocks again -- your graph is untouched.
        </p>
      )}

      <div className="builder-panes">
        <div className="builder-pane blocks">
          <div className="builder-tools" role="toolbar" aria-label="Canvas tools">
          {TOOLS.map((entry) => (
            <button
              key={entry.id}
              className={tool === entry.id ? 'active' : ''}
              aria-pressed={tool === entry.id}
              aria-label={entry.label}
              title={`${entry.label} (${entry.shortcut.toUpperCase()}) — ${entry.hint}`}
              onClick={() => setTool(entry.id)}
            >
              {entry.id === 'pick' && <MousePointer2 size={14} />}
              {entry.id === 'pan' && <Hand size={14} />}
              {entry.id === 'marquee' && <BoxSelect size={14} />}
            </button>
          ))}
        </div>

        <BuilderCanvas
          tool={tool}
            graph={graph}
            registry={registry}
            report={report}
            diagnostics={diagnostics}
            selected={builder.selected}
            revealed={builder.revealed}
            readOnly={Boolean(parseError)}
            onSelect={builder.select}
            selection={builder.selection}
        onSelectInRect={builder.selectInRect}
        onDropBlock={(type, position) => builder.addBlock(type, position)}
        onQuickAdd={builder.addConnectedBlock}
        onMove={builder.moveBlock}
            onRemove={builder.removeBlock}
            onValue={builder.setValue}
            onLink={builder.link}
            onUnlink={builder.unlink}
          />

          {inspectorOpen && (
            <InspectorPanel
              graph={graph}
              registry={registry}
              selection={selection}
              readOnly={Boolean(parseError)}
              onValue={builder.setValue}
            />
          )}

          <section className="builder-bottom">
            <header className="builder-tabs">
              <button
                className={bottomPane === 'integrity' ? 'active' : ''}
                onClick={() => setBottomPane('integrity')}
              >
                Integrity
                <span className="builder-problem-counts">
                  {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning
                  {warnings.length === 1 ? '' : 's'}
                </span>
              </button>
              <button className={bottomPane === 'state' ? 'active' : ''} onClick={() => setBottomPane('state')}>
                Variables
                <span className="builder-problem-counts">{builder.state.length}</span>
              </button>
              <button className={bottomPane === 'data' ? 'active' : ''} onClick={() => setBottomPane('data')}>
                Data
                <span className="builder-problem-counts">{builder.schema.tables.length} tables</span>
              </button>
            </header>

            {bottomPane === 'integrity' ? (
              <div className="builder-problems">
                {!report.diagnostics.length && <p className="builder-clean">Nothing wrong with the graph.</p>}
                <ul>
                  {report.diagnostics.map((entry, index) => (
                    <li key={`${entry.nodeId}-${entry.code}-${index}`}>
                      <button
                        className={`builder-problem ${entry.severity}`}
                        onClick={() => builder.revealNode(entry.nodeId)}
                      >
                        {entry.severity === 'error' ? <AlertTriangle size={12} /> : <Info size={12} />}
                        <span>
                          {entry.message}
                          <em className="builder-problem-fix">{entry.fix}</em>
                        </span>
                        {lineOfNode(program, entry.nodeId) !== undefined && (
                          <span className="builder-problem-line">line {lineOfNode(program, entry.nodeId)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : bottomPane === 'state' ? (
              <StatePanel
                state={builder.state}
                used={usedVariables}
                readOnly={Boolean(parseError)}
                onAdd={builder.addVariable}
                onRename={builder.renameVariable}
                onScope={builder.setVariableScope}
                onType={builder.setVariableType}
                onInitial={builder.setVariableInitial}
                onRemove={builder.removeVariable}
              />
            ) : (
              <DataSchemaPanel
                schema={builder.schema}
                onAddTable={builder.addTable}
                onRenameTable={builder.renameTable}
                onRemoveTable={builder.removeTable}
                onAddColumn={builder.addColumn}
                onUpdateColumn={builder.updateColumn}
                onRemoveColumn={builder.removeColumn}
              />
            )}
          </section>
        </div>

        <div className="builder-pane code">
          <header className="builder-tabs">
            <button className={rightPane === 'code' ? 'active' : ''} onClick={() => setRightPane('code')}>
              <Code2 size={12} /> Code
            </button>
            <button className={rightPane === 'preview' ? 'active' : ''} onClick={() => setRightPane('preview')}>
              <Play size={12} /> Preview
            </button>
          </header>

          {rightPane === 'code' ? (
            <Editor
              value={code}
              language="typescript"
              theme={theme}
              options={editorOptions}
              onChange={(next) => builder.editCode(next ?? '')}
              onMount={(instance) => {
                // Putting the cursor on a line selects the block that wrote
                // it: the traceback works in both directions from one map.
                instance.onDidChangeCursorPosition((event) => {
                  const id = nodeAtLine(program, event.position.lineNumber)
                  if (id) builder.select(id)
                })
              }}
            />
          ) : (
            <BuilderPreview
              document={builder.previewDocument}
              logs={builder.logs}
              failure={builder.failure}
              onLog={builder.appendLog}
              onFailure={builder.reportFailure}
              onClear={builder.clearLogs}
              onReveal={builder.revealNode}
            />
          )}
        </div>
      </div>
    </div>
  )
}
