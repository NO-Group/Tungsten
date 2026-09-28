/**
 * The builder surface: blocks on the left, the code they are on the right.
 *
 * Neither pane is the preview of the other. The graph is the program; the
 * text is the program; editing either one edits the same thing, and the
 * strip between them says whether what is there right now would compile.
 */

import { useMemo } from 'react'
import { AlertTriangle, Code2, Eraser, FileDown, Info, X } from 'lucide-react'

import Editor from '../ConfiguredEditor'
import { BuilderCanvas } from './BuilderCanvas'
import { diagnosticsByNode } from '../../builder/integrity'
import { lineOfNode, nodeAtLine } from '../../builder/codeGenerator'
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
  onClose: () => void
}

export function BuilderView({ builder, editorOptions, theme, onExport, onClose }: BuilderViewProps) {
  const { graph, registry, report, program, code, parseError } = builder
  const diagnostics = useMemo(() => diagnosticsByNode(report), [report])

  const errors = report.diagnostics.filter((entry) => entry.severity === 'error')
  const warnings = report.diagnostics.filter((entry) => entry.severity === 'warning')

  return (
    <div className="builder-view">
      <header className="builder-toolbar">
        <span className="builder-title"><Code2 size={13} /> Builder</span>
        <span className="builder-count">{graph.nodes.length} blocks</span>

        <span className={`builder-state ${parseError ? 'blocked' : report.compilable ? 'ready' : 'blocked'}`}>
          {parseError
            ? 'Read-only: the code does not parse'
            : report.compilable
              ? 'Ready to compile'
              : `${errors.length} error${errors.length === 1 ? '' : 's'} block compilation`}
        </span>

        <span className="builder-toolbar-spacer" />

        <button onClick={() => onExport(program.code)} disabled={!report.compilable || Boolean(parseError)}>
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

          <section className="builder-problems">
            <header>
              Integrity
              <span className="builder-problem-counts">
                {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning
                {warnings.length === 1 ? '' : 's'}
              </span>
            </header>

            {!report.diagnostics.length && (
              <p className="builder-clean">Nothing wrong with the graph.</p>
            )}

            <ul>
              {report.diagnostics.map((entry, index) => (
                <li key={`${entry.nodeId}-${entry.code}-${index}`}>
                  <button
                    className={`builder-problem ${entry.severity}`}
                    onClick={() => builder.revealNode(entry.nodeId)}
                  >
                    {entry.severity === 'error' ? <AlertTriangle size={12} /> : <Info size={12} />}
                    <span>{entry.message}</span>
                    {lineOfNode(program, entry.nodeId) !== undefined && (
                      <span className="builder-problem-line">line {lineOfNode(program, entry.nodeId)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="builder-pane code">
          <Editor
            value={code}
            language="typescript"
            theme={theme}
            options={editorOptions}
            onChange={(next) => builder.editCode(next ?? '')}
            onMount={(instance) => {
              // Putting the cursor on a line selects the block that wrote it:
              // the traceback works in both directions from the same map.
              instance.onDidChangeCursorPosition((event) => {
                const id = nodeAtLine(program, event.position.lineNumber)
                if (id) builder.select(id)
              })
            }}
          />
        </div>
      </div>
    </div>
  )
}
