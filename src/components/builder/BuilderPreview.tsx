/**
 * The live sandbox.
 *
 * An iframe with `sandbox="allow-scripts"` and nothing else: no same-origin
 * access, no forms, no top-level navigation. The program the blocks generated
 * runs inside it for real, so a click is a click and a typed value is a typed
 * value -- but it cannot touch the workbench, the workspace, or the network.
 *
 * Everything it has to say comes back over `postMessage`, which is also how
 * a thrown error finds its way to the block that threw it.
 */

import { useEffect, useRef } from 'react'
import { Eraser, TriangleAlert } from 'lucide-react'

import { PREVIEW_CHANNEL, type PreviewMessage } from '../../builder/previewRuntime'
import type { Traceback } from '../../builder/traceback'

export type BuilderPreviewProps = {
  /** The whole sandbox document, already built from the graph. */
  document: string
  logs: string[]
  failure?: Traceback
  onLog: (text: string) => void
  onFailure: (text: string, line?: number) => void
  onClear: () => void
  /** Reveals the block a failure was traced to. */
  onReveal: (nodeId: string) => void
}

export function BuilderPreview(props: BuilderPreviewProps) {
  const { document: html, logs, failure, onLog, onFailure, onClear, onReveal } = props
  const frame = useRef<HTMLIFrameElement | null>(null)
  const tail = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data as (PreviewMessage & { channel?: string }) | undefined
      // The frame is sandboxed, so its origin is "null"; the channel tag is
      // what distinguishes our messages from anything else on the bus.
      if (!data || data.channel !== PREVIEW_CHANNEL) return
      if (data.kind === 'log') onLog(data.text)
      if (data.kind === 'error') onFailure(data.text, data.line)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onFailure, onLog])

  useEffect(() => {
    tail.current?.scrollTo({ top: tail.current.scrollHeight })
  }, [logs])

  return (
    <div className="builder-preview">
      <iframe
        ref={frame}
        className="builder-frame"
        title="App preview"
        sandbox="allow-scripts"
        srcDoc={html}
      />

      {failure && (
        <button
          className="builder-preview-failure"
          onClick={() => failure.nodeId && onReveal(failure.nodeId)}
          disabled={!failure.nodeId}
        >
          <TriangleAlert size={13} />
          <span>{failure.message}</span>
          {failure.line !== undefined && <em>line {failure.line}</em>}
        </button>
      )}

      <div className="builder-console">
        <header>
          Console
          <button aria-label="Clear the preview console" onClick={onClear}><Eraser size={12} /></button>
        </header>
        <div className="builder-console-lines" ref={tail}>
          {logs.length
            ? logs.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)
            : <p className="muted">Nothing logged yet. Click something in the preview.</p>}
        </div>
      </div>
    </div>
  )
}
