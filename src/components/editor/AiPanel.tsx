/**
 * The assistant panel.
 *
 * Floats over the editor rather than taking a pane, because it is a
 * conversation about what you are looking at and moving the code away to
 * make room for it defeats the point.
 *
 * The mode selector is the most important control here, so it is the first
 * thing in the panel and it says what each tier will do in plain words. A
 * proposed edit is shown as a real diff and cannot apply itself: the Accept
 * button is the only route, and it is the caller that does the applying.
 */

import { Suspense, lazy, useState } from 'react'
import { Check, Loader2, Sparkles, Trash2, Undo2, X } from 'lucide-react'

import { AI_MODES, describeRange, type AiContext, type AiMode, type AiTurn } from '../../editor/ai/aiModel'

// Loaded only when a diff is actually shown: the assistant panel must not
// drag Monaco into the initial bundle.
const DiffEditor = lazy(() => import('../ConfiguredEditor').then((module) => ({ default: module.DiffEditor })))

export type AiPanelProps = {
  mode: AiMode
  onModeChange: (mode: AiMode) => void
  turns: AiTurn[]
  busy: boolean
  /** What the panel is about right now: the active file and selection. */
  context?: AiContext
  providerLabel: string
  theme: string
  onAsk: (prompt: string) => void
  onAccept: (id: number) => void
  onDiscard: (id: number) => void
  onClear: () => void
  onClose: () => void
  /** The buffer as it would be if a proposal were applied. */
  preview: (id: number) => string | undefined
}

const STATE_LABEL: Record<AiTurn['state'], string> = {
  streaming: 'Thinking',
  proposed: 'Proposed',
  applied: 'Applied',
  answered: 'Answered',
  discarded: 'Discarded',
  failed: 'Failed',
}

export function AiPanel(props: AiPanelProps) {
  const { mode, onModeChange, turns, busy, context, providerLabel, theme } = props
  const { onAsk, onAccept, onDiscard, onClear, onClose, preview } = props
  const [prompt, setPrompt] = useState('')

  const send = () => {
    if (!prompt.trim() || busy) return
    onAsk(prompt)
    setPrompt('')
  }

  return (
    <aside className="ai-panel" aria-label="Code assistant">
      <header className="ai-panel-head">
        <Sparkles size={13} />
        <strong>Assistant</strong>
        <span className="ai-provider">{providerLabel}</span>
        <button aria-label="Clear the conversation" onClick={onClear} disabled={!turns.length}>
          <Trash2 size={12} />
        </button>
        <button aria-label="Close the assistant" onClick={onClose}><X size={12} /></button>
      </header>

      <div className="ai-modes" role="radiogroup" aria-label="Permission level">
        {AI_MODES.map((entry) => (
          <button
            key={entry.id}
            role="radio"
            aria-checked={mode === entry.id}
            className={mode === entry.id ? 'active' : ''}
            title={entry.detail}
            onClick={() => onModeChange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="ai-mode-detail">{AI_MODES.find((entry) => entry.id === mode)?.detail}</p>

      <div className="ai-turns">
        {!turns.length && (
          <p className="ai-empty">
            Ask about {context ? describeRange(context) : 'the open file'}. Try “explain this”,
            “wrap it in try/catch”, “document this function”.
          </p>
        )}

        {turns.map((turn) => (
          <article key={turn.id} className={`ai-turn ${turn.state}`}>
            <header>
              <span className="ai-turn-prompt">{turn.prompt}</span>
              <span className="ai-turn-state">
                {turn.state === 'streaming' && <Loader2 size={11} className="spin" />}
                {STATE_LABEL[turn.state]}
              </span>
            </header>

            <p className="ai-answer">{turn.answer || (turn.state === 'streaming' ? '…' : '')}</p>
            {turn.error && <p className="ai-error">{turn.error}</p>}

            {turn.state === 'proposed' && turn.proposal?.replacement && (
              <div className="ai-proposal">
                <div className="ai-diff">
                  <Suspense fallback={<p className="ai-empty">Loading the diff…</p>}>
                    <DiffEditor
                      original={turn.context.buffer}
                      modified={preview(turn.id) ?? turn.context.buffer}
                      language={turn.context.language}
                      theme={theme}
                      height="180px"
                      options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false } }}
                    />
                  </Suspense>
                </div>
                <div className="ai-actions">
                  <button className="primary" onClick={() => onAccept(turn.id)}>
                    <Check size={11} /> Accept{turn.proposal.summary ? `: ${turn.proposal.summary}` : ''}
                  </button>
                  <button onClick={() => onDiscard(turn.id)}><Undo2 size={11} /> Discard</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="ai-compose">
        <input
          aria-label="Ask the assistant"
          placeholder={context ? `Ask about ${describeRange(context)}…` : 'Open a file to ask about it'}
          value={prompt}
          disabled={!context}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') send() }}
        />
        <button onClick={send} disabled={busy || !prompt.trim() || !context}>
          {busy ? <Loader2 size={12} className="spin" /> : 'Ask'}
        </button>
      </div>
    </aside>
  )
}

export default AiPanel
