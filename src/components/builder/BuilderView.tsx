/**
 * The builder surface: blocks on the left, the program on the right.
 *
 * Neither pane is the preview of the other. The graph is the program; the
 * text is the program; the sandbox is the program, running. Editing any of
 * the first two edits the same thing, and the strip between them says whether
 * what is there right now would compile.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Code2, Eraser, FileDown, Hammer, Info, Play, X } from 'lucide-react'

import Editor from '../ConfiguredEditor'
import { BuilderCanvas } from './BuilderCanvas'
import { BuilderPreview } from './BuilderPreview'
import { DataSchemaPanel } from './DataSchemaPanel'
import { diagnosticsByNode } from '../../builder/integrity'
import { lineOfNode, nodeAtLine } from '../../builder/codeGenerator'
import type { CompileTarget } from '../../builder/compile'
import type { BuilderState } from '../../builder/useBuilder'

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
  /** Writes a compiled target into the workspace. */
  onBuild: (target: CompileTarget) => void
  onClose: () => void
}

const TARGETS: Array<{ id: CompileTarget; label: string }> = [
  { id: 'web', label: 'Web bundle' },
  { id: 'mobile', label: 'Mobile source' },
  { id: 'node', label: 'Local runner' },
]

export function BuilderView({ builder, editorOptions, theme, onExport, onBuild, onClose }: BuilderViewProps) {
  const { graph, registry, report, program, code, parseError } = builder
  const diagnostics = useMemo(() => diagnosticsByNode(report), [report])

  const [rightPane, setRightPane] = useState<'code' | 'preview'>('code')
  const [bottomPane, setBottomPane] = useState<'integrity' | 'data'>('integrity')
  const [target, setTarget] = useState<CompileTarget>('web')

  const errors = report.diagnostics.filter((entry) => entry.severity === 'error')
  const warnings = report.diagnostics.filter((entry) => entry.severity === 'warning')
  const blocked = Boolean(parseError) || !report.compilable

  return (
    <div className="builder-view">
      <header className="builder-toolbar">
        <span className="builder-title"><Code2 size={13} /> Builder</span>
        <span className="builder-count">
          {graph.nodes.length} blocks · {builder.ui.components.length} components · {builder.schema.tables.length} tables
        </span>

        <span className={`builder-state ${blocked ? 'blocked' : 'ready'}`}>
          {parseError
            ? 'Read-only: the code does not parse'
            : report.compilable
              ? 'Ready to compile'
              : `${errors.length} error${errors.length === 1 ? '' : 's'} block compilation`}
        </span>

        <span className="builder-toolbar-spacer" />

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
          <BuilderCanvas
            graph={graph}
            registry={registry}
            report={report}
            diagnostics={diagnostics}
            selected={builder.selected}
            revealed={builder.revealed}
            readOnly={Boolean(parseError)}
            onSelect={builder.select}
            onMove={builder.moveBlock}
            onRemove={builder.removeBlock}
            onValue={builder.setValue}
            onLink={builder.link}
            onUnlink={builder.unlink}
          />

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
