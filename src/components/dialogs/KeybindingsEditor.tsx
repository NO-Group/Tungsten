/**
 * The keyboard shortcuts editor.
 *
 * Recording a binding means capturing raw keystrokes, so while a row is armed
 * it swallows every key: Escape cancels, Backspace and Delete unbind, and
 * anything else becomes the new chord. The workbench is told the resulting
 * chord and decides what to do about conflicts.
 */

import { Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { Modal } from '../Modal'
import { chordFromEvent, keybindingLabel, type Keybinding } from '../../keybinding/keybindings'

export type KeybindingRow = {
  command: { id: string; label: string }
  binding?: Keybinding
}

export type KeybindingsEditorProps = {
  rows: KeybindingRow[]
  filter: string
  onFilterChange: (value: string) => void
  /** Command id currently capturing keystrokes, if any. */
  recording: string | null
  onRecordingChange: (commandId: string | null) => void
  /** Command ids the user has overridden, so those rows can offer a reset. */
  customised: string[]
  activeBindingCount: number
  onBind: (commandId: string, chord: string) => void
  onUnbind: (commandId: string) => void
  onReset: (commandId: string) => void
  onResetAll: () => void
  onClose: () => void
}

export function KeybindingsEditor({
  rows, filter, onFilterChange, recording, onRecordingChange, customised, activeBindingCount,
  onBind, onUnbind, onReset, onResetAll, onClose,
}: KeybindingsEditorProps) {
  const custom = new Set(customised)

  return (
    <Modal
      label="Keyboard shortcuts"
      className="keybindings-modal"
      onClose={onClose}
      // While a row is armed, Escape cancels the recording rather than
      // throwing away the whole editor.
      onEscape={() => (recording ? onRecordingChange(null) : onClose())}
    >
      <header>
        <div>
          <span className="modal-icon"><Keyboard size={17} /></span>
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>Select a command, then press the keys you want. Backspace removes a binding; Escape cancels.</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close keyboard shortcuts"><X size={17} /></button>
      </header>

      <div className="search-box-wrap keybinding-filter">
        <Search size={13} />
        <input autoFocus value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="Search commands and keybindings" />
      </div>

      <div className="keybindings-table" role="table">
        <div className="keybindings-head" role="row"><span>Command</span><span>Keybinding</span><span>When</span><span /></div>

        {rows.map(({ command, binding }) => {
          const isRecording = recording === command.id
          const isCustom = custom.has(command.id)
          return (
            <div className={`keybindings-row ${isCustom ? 'custom' : ''}`} role="row" key={command.id}>
              <span className="keybinding-command" title={command.id}>{command.label}</span>
              <button
                className={`keybinding-input ${isRecording ? 'recording' : ''}`}
                onClick={() => onRecordingChange(isRecording ? null : command.id)}
                onKeyDown={(event) => {
                  if (!isRecording) return
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.key === 'Escape') return onRecordingChange(null)
                  if (event.key === 'Backspace' || event.key === 'Delete') return onUnbind(command.id)
                  const chord = chordFromEvent(event)
                  if (chord) onBind(command.id, chord)
                }}
              >
                {isRecording ? 'Press keys…' : binding ? <kbd>{keybindingLabel(binding.chords)}</kbd> : <em>Unassigned</em>}
              </button>
              <span className="keybinding-when">{binding?.when || '—'}</span>
              <span className="keybinding-actions">
                {isCustom && (
                  <button title="Restore the default binding" onClick={() => onReset(command.id)}><RotateCcw size={12} /></button>
                )}
              </span>
            </div>
          )
        })}

        {!rows.length && <div className="no-results">No commands match “{filter}”</div>}
      </div>

      <footer>
        <span className="keybinding-count">{customised.length} customised · {activeBindingCount} active bindings</span>
        <button onClick={onResetAll}>Reset all</button>
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  )
}

export default KeybindingsEditor
