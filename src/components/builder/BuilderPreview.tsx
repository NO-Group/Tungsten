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

import { useEffect, useRef, useState } from 'react'
import { Eraser, Server, TriangleAlert } from 'lucide-react'

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
  /** The backend the preview talks to. Empty means the simulation. */
  backend: string
  onBackend: (url: string) => void
  /** Suggested when the switch is first turned on. */
  defaultBackend: string
}

export function BuilderPreview(props: BuilderPreviewProps) {
  const { document: html, logs, failure, onLog, onFailure, onClear, onReveal } = props
  const { backend, onBackend, defaultBackend } = props
  const frame = useRef<HTMLIFrameElement | null>(null)
  const tail = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState(backend)

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

      {/*
        Simulated by default, live only when asked.

        The data, auth and storage blocks fake themselves in the preview
        and say so in the console. Typing an address here points the same
        blocks at a real service -- the one the Backend Service target
        writes -- which is a different and much less reversible thing, so
        it is a switch rather than a default.
      */}
      <div className="builder-backend">
        <label>
          <input
            type="checkbox"
            aria-label="Use a real backend"
            checked={Boolean(backend)}
            onChange={(event) => {
              if (!event.target.checked) { setDraft(''); onBackend(''); return }
              const next = draft || defaultBackend
              setDraft(next)
              onBackend(next)
            }}
          />
          <Server size={12} />
          <span>{backend ? 'Live backend' : 'Simulated backend'}</span>
        </label>
        <input
          className="builder-backend-url"
          aria-label="Backend address"
          placeholder={defaultBackend}
          value={draft}
          disabled={!backend}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onBackend(draft)}
          onKeyDown={(event) => { if (event.key === 'Enter') onBackend(draft) }}
        />
      </div>

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
