/**
 * The snippets browser.
 *
 * Lists what is insertable in the current language, with each body rendered
 * through the variable resolver so the preview shows the real text -- today's
 * date, the actual filename -- rather than raw `$TM_FILENAME` placeholders.
 */

import { X } from 'lucide-react'
import { Modal } from '../Modal'
import type { Snippet } from '../../snippets/snippetService'

export type SnippetsDialogProps = {
  snippets: Snippet[]
  /** Language of the active file, for the count line and preview resolution. */
  languageId?: string
  /** True once the user has imported snippets that can be cleared again. */
  hasUserSnippets: boolean
  /** Resolves a snippet body to the text it would insert. */
  preview: (snippet: Snippet) => string
  onInsert: (snippet: Snippet) => void
  onImport: () => void
  onClearUserSnippets: () => void
  onClose: () => void
}

export function SnippetsDialog({
  snippets, languageId, hasUserSnippets, preview, onInsert, onImport, onClearUserSnippets, onClose,
}: SnippetsDialogProps) {
  return (
    <Modal label="Snippets" className="snippets-modal" onClose={onClose}>
      <div className="modal-head">
        <strong>Snippets</strong>
        <button className="snippets-import" onClick={onImport}>Import snippets file…</button>
        {hasUserSnippets && <button className="snippets-import" onClick={onClearUserSnippets}>Clear user snippets</button>}
        <button className="icon-button" onClick={onClose} aria-label="Close snippets"><X size={15} /></button>
      </div>

      <div className="snippets-meta">
        {snippets.length} available for {languageId ?? 'this language'} · type a prefix in the editor to insert
      </div>

      <div className="snippets-list">
        {snippets.map((snippet) => (
          <button key={snippet.id} onClick={() => onInsert(snippet)}>
            <div className="snippets-row-head">
              <kbd>{snippet.prefix}</kbd>
              <strong>{snippet.name}</strong>
              <span className={`snippets-source ${snippet.source}`}>{snippet.source}</span>
            </div>
            <pre>{preview(snippet)}</pre>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export default SnippetsDialog
