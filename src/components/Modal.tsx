/**
 * The shared modal shell.
 *
 * Every dialog in Tungsten is a card centred on a dimmed backdrop, dismissed
 * by clicking outside it or pressing Escape. Doing that once here means no
 * dialog can forget a piece of it: each one gets the dialog role, an
 * accessible name, backdrop dismissal, and Escape handling for free.
 *
 * Escape is captured at the document so it works before focus has landed
 * inside the card, and only the topmost modal reacts -- a dialog opened from
 * another dialog closes itself first.
 */

import { useEffect, useRef } from 'react'
import type React from 'react'

/** Open modals, innermost last. Only the last one handles Escape. */
const stack: symbol[] = []

export type ModalProps = {
  /** Accessible name for the dialog. */
  label: string
  /** Class on the card itself; the visual design lives in styles.css. */
  className: string
  /** Extra class on the backdrop, e.g. `palette-overlay` for top-aligned lists. */
  overlayClassName?: string
  onClose: () => void
  /**
   * What Escape does, when that is not simply closing. The keybinding editor
   * uses this to cancel an in-progress recording first.
   */
  onEscape?: () => void
  children: React.ReactNode
}

export function Modal({ label, className, overlayClassName = '', onClose, onEscape, children }: ModalProps) {
  // Held in a ref so the Escape listener is installed once, yet always calls
  // the current handler even though callers pass a fresh closure each render.
  const escapeRef = useRef(onEscape ?? onClose)
  useEffect(() => { escapeRef.current = onEscape ?? onClose })

  useEffect(() => {
    const token = Symbol('modal')
    stack.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== token) return
      event.stopPropagation()
      escapeRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      stack.splice(stack.indexOf(token), 1)
    }
  }, [])

  return (
    <div className={`overlay ${overlayClassName}`.trim()} onMouseDown={onClose}>
      <section
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  )
}

export default Modal
