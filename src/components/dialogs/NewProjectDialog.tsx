/**
 * Scaffold a new project from a template.
 */

import { Check, Rocket, X } from 'lucide-react'
import { Modal } from '../Modal'

/** Templates the desktop scaffolder can write. */
const projectTemplates = [
  { id: 'web', name: 'Web app', detail: 'HTML, CSS and JavaScript', icon: '<>' },
  { id: 'node', name: 'Node.js', detail: 'Modern ESM application', icon: 'JS' },
  { id: 'python', name: 'Python', detail: 'Package with pytest', icon: 'PY' },
  { id: 'rust', name: 'Rust', detail: 'Cargo binary crate', icon: 'RS' },
  { id: 'go', name: 'Go', detail: 'Go module and main package', icon: 'GO' },
] as const

export type NewProjectDialogProps = {
  name: string
  onNameChange: (value: string) => void
  template: string
  onTemplateChange: (id: string) => void
  onCreate: () => void
  onClose: () => void
}

export function NewProjectDialog({ name, onNameChange, template, onTemplateChange, onCreate, onClose }: NewProjectDialogProps) {
  return (
    <Modal label="Forge a new project" className="project-modal" onClose={onClose}>
      <header>
        <span className="modal-icon"><Rocket size={18} /></span>
        <div><h2>Forge a new project</h2><p>Start with a clean, portable foundation.</p></div>
        <button onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>

      <div className="project-form">
        <label>PROJECT NAME<input value={name} onChange={(event) => onNameChange(event.target.value)} /></label>
        <span className="field-label">TEMPLATE</span>
        <div className="template-grid">
          {projectTemplates.map((item) => (
            <button key={item.id} className={template === item.id ? 'active' : ''} onClick={() => onTemplateChange(item.id)}>
              <span>{item.icon}</span>
              <div><strong>{item.name}</strong><small>{item.detail}</small></div>
              {template === item.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>

      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={onCreate}><Rocket size={13} /> Create project</button>
      </footer>
    </Modal>
  )
}

export default NewProjectDialog
