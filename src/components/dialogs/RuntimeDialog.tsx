/**
 * What this build can reach.
 *
 * Opened from the `Desktop` / `Web` slot in the status bar, which used
 * to be a label with no handler. Every row is a capability with a
 * state and a sentence; nothing here is aspirational.
 */

import { Check, Minus, X } from 'lucide-react'

import { Modal } from '../Modal'
import type { RuntimeFacts } from '../../web/runtimeFacts'

export type RuntimeDialogProps = {
  facts: RuntimeFacts
  onClose: () => void
}

const MARK = {
  yes: Check,
  no: X,
  limited: Minus,
} as const

export function RuntimeDialog({ facts, onClose }: RuntimeDialogProps) {
  return (
    <Modal label="Runtime" className="runtime-dialog" onClose={onClose}>
      <header>
        <div>
          <strong>{facts.title}</strong>
          <p>{facts.summary}</p>
        </div>
        <button onClick={onClose} aria-label="Close runtime"><X size={14} /></button>
      </header>

      <ul>
        {facts.capabilities.map((capability) => {
          const Mark = MARK[capability.state]
          return (
            <li key={capability.id} className={`runtime-capability ${capability.state}`}>
              <Mark size={13} />
              <div>
                <strong>{capability.label}</strong>
                <p>{capability.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>

      <footer>
        {facts.versions.map((version) => (
          <span key={version.label}><em>{version.label}</em> {version.value}</span>
        ))}
      </footer>
    </Modal>
  )
}

export default RuntimeDialog
