/**
 * The generic quick pick.
 *
 * The status bar needs four small pickers — indentation, encoding,
 * line endings, language mode — and none of them deserves a dialog of
 * its own. They are all the same shape: a title, a list of choices,
 * one of them current, and a sentence under the list explaining what
 * the choice does to the file.
 *
 * Unlike the command palette this does not filter as you type. These
 * lists are four to twelve rows; a search box would be furniture. What
 * it does have is keyboard navigation, because a picker you can only
 * use with a mouse is a picker nobody uses twice.
 */

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import { Modal } from '../Modal'

export type QuickPickItem = {
  id: string
  label: string
  /** The right-hand column: what this choice means, in words. */
  detail?: string
  /** Rendered dimmed under the label, for a warning or a consequence. */
  note?: string
  /** Shown with a tick and announced as the current value. */
  current?: boolean
  /** Separates groups: "set the convention" from "rewrite the file". */
  group?: string
}

export type QuickPickProps = {
  title: string
  /** One line under the title saying what is being changed and in which file. */
  subtitle?: string
  items: QuickPickItem[]
  onPick: (id: string) => void
  onClose: () => void
}

export function QuickPick({ title, subtitle, items, onPick, onClose }: QuickPickProps) {
  const initial = Math.max(0, items.findIndex((item) => item.current))
  const [index, setIndex] = useState(initial)
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    // jsdom has no layout, so it has no scrollIntoView either.
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  const move = (delta: number) => {
    if (!items.length) return
    setIndex((current) => (current + delta + items.length) % items.length)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setIndex(0) }
    else if (event.key === 'End') { event.preventDefault(); setIndex(items.length - 1) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[index]
      if (item) onPick(item.id)
    }
  }

  return (
    <Modal label={title} className="command-palette quick-pick" overlayClassName="palette-overlay" onClose={onClose}>
      {/* The card takes the keys: there is no text input to hold focus. */}
      <div className="quick-pick-head" tabIndex={-1} autoFocus onKeyDown={onKeyDown}>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
        <kbd>ESC</kbd>
      </div>

      <div className="palette-list quick-pick-list" role="listbox" aria-label={title} ref={listRef}>
        {items.map((item, position) => {
          // A heading is drawn when the group changes, which is a
          // property of the pair rather than of a running variable.
          const heading = item.group && item.group !== items[position - 1]?.group ? item.group : undefined
          return (
            <div key={item.id}>
              {heading && <div className="palette-label">{heading}</div>}
              <button
                role="option"
                aria-selected={position === index}
                className={position === index ? 'selected' : ''}
                onMouseEnter={() => setIndex(position)}
                onClick={() => onPick(item.id)}
                onKeyDown={onKeyDown}
              >
                <span className="quick-pick-tick">{item.current ? <Check size={12} /> : null}</span>
                <span className="palette-label-text">
                  {item.label}
                  {item.note && <small>{item.note}</small>}
                </span>
                {item.detail && <span className="palette-detail">{item.detail}</span>}
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

export default QuickPick
