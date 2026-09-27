/**
 * The live HTML preview surface.
 *
 * The document is rendered into a sandboxed iframe with `allow-scripts` but
 * no `allow-same-origin`, so previewed project code cannot reach Tungsten's
 * own origin, storage or parent frame. Reloading remounts the iframe by key
 * rather than touching its contentWindow, which keeps that boundary intact.
 */

import { useState } from 'react'
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'

export function Preview({ html, onReload }: { html: string; onReload: () => void }) {
  const [key, setKey] = useState(0)
  return (
    <section className="preview-shell">
      <div className="preview-toolbar">
        <div className="preview-controls">
          <button aria-label="Reload preview" title="Reload preview" onClick={() => { setKey((value) => value + 1); onReload() }}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="preview-address">
          <ShieldCheck size={13} />
          <span>tungsten://preview/forge</span>
        </div>
        <button className="preview-external" title="Open preview in a new tab" onClick={() => {
          const blob = new Blob([html], { type: 'text/html' })
          window.open(URL.createObjectURL(blob), '_blank')
        }}><ExternalLink size={13} /></button>
      </div>
      <iframe key={key} title="Project preview" sandbox="allow-scripts" srcDoc={html} />
    </section>
  )
}

export default Preview
