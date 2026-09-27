/**
 * Create or rename a file.
 *
 * One dialog serves both: a rename is a create with a target, and the copy
 * changes to match. The value is a path, not a name, so typing
 * `src/components/button.tsx` creates the folders on the way.
 */

import type React from 'react'
import { FileCode2 } from 'lucide-react'
import { Modal } from '../Modal'

export type NewFileDialogProps = {
  /** Path being renamed, or null when creating. */
  renameTarget: string | null
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function NewFileDialog({ renameTarget, value, onChange, onSubmit, onCancel, inputRef }: NewFileDialogProps) {
  const renaming = Boolean(renameTarget)
  return (
    <Modal label={renaming ? 'Rename file' : 'Create a new file'} className="new-file-modal" onClose={onCancel}>
      <div className="new-file-icon"><FileCode2 size={20} /></div>
      <div>
        <h2>{renaming ? 'Rename file' : 'Create a new file'}</h2>
        <p>{renaming ? 'Change the file name or move it to another folder.' : 'Use a path to place it inside a folder.'}</p>
      </div>
      <label>
        FILE PATH
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onSubmit() }}
          placeholder="src/components/button.tsx"
        />
      </label>
      <footer>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!value.trim()} onClick={onSubmit}>{renaming ? 'Rename file' : 'Create file'}</button>
      </footer>
    </Modal>
  )
}

export default NewFileDialog
