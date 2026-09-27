/**
 * Quick access: the command palette and its file, symbol and line modes.
 *
 * The workbench decides what the list contains -- scoring, mode prefixes and
 * what running an entry does. This owns the keyboard model of a listbox:
 * arrows wrap, Home and End jump to the ends, Enter runs the highlighted
 * entry, and the active row is announced through `aria-activedescendant`
 * because focus never leaves the input.
 */

import { useEffect, useRef } from 'react'
import { Command, type File } from 'lucide-react'
import { Modal } from '../Modal'
import { Highlight } from '../Highlight'
import type { Match } from '../../quickopen/fuzzyScorer'

/** Quick-access modes, mirroring VS Code's quick-open prefixes. */
export type PaletteMode = 'commands' | 'files' | 'symbols' | 'line'

/** A scored row in quick access, carrying fuzzy highlight ranges. */
export type PaletteEntry = {
  id: string
  label: string
  detail: string
  icon: typeof File
  action: () => void | Promise<void>
  labelMatch: Match[]
  detailMatch: Match[]
  keybinding?: string
}

export type CommandPaletteProps = {
  query: string
  onQueryChange: (value: string) => void
  items: PaletteEntry[]
  /** Index of the highlighted row, owned by the workbench so commands can reset it. */
  index: number
  onIndexChange: (index: number) => void
  modeLabel: string
  placeholder: string
  onRun: (item: PaletteEntry) => void
  onClose: () => void
}

/** Rendering every match in a large workspace costs more than it helps. */
const VISIBLE_LIMIT = 100

export function CommandPalette({
  query, onQueryChange, items, index, onIndexChange, modeLabel, placeholder, onRun, onClose,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // The palette is opened by a keystroke, so it has to take focus itself.
  useEffect(() => { inputRef.current?.focus() }, [])

  const move = (delta: number) => {
    if (!items.length) return onIndexChange(0)
    onIndexChange((index + delta + items.length) % items.length)
  }

  return (
    <Modal label="Quick access" className="command-palette" overlayClassName="palette-overlay" onClose={onClose}>
      <div className="palette-input">
        <Command size={17} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { onQueryChange(event.target.value); onIndexChange(0) }}
          placeholder={placeholder}
          aria-label="Quick access"
          aria-activedescendant={items[index] ? `palette-item-${index}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
            else if (event.key === 'Home') { event.preventDefault(); onIndexChange(0) }
            else if (event.key === 'End') { event.preventDefault(); onIndexChange(Math.max(0, items.length - 1)) }
            else if (event.key === 'Enter') {
              event.preventDefault()
              const item = items[index]
              if (item) onRun(item)
            }
          }}
        />
        <kbd>ESC</kbd>
      </div>

      <div className="palette-label">{modeLabel} · {items.length} result{items.length === 1 ? '' : 's'}</div>

      <div className="palette-list" role="listbox">
        {items.slice(0, VISIBLE_LIMIT).map((item, position) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              id={`palette-item-${position}`}
              role="option"
              aria-selected={position === index}
              ref={position === index ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
              className={position === index ? 'selected' : ''}
              onMouseMove={() => onIndexChange(position)}
              onClick={() => onRun(item)}
            >
              <Icon size={16} />
              <div>
                <strong><Highlight text={item.label} matches={item.labelMatch} /></strong>
                <span><Highlight text={item.detail} matches={item.detailMatch} /></span>
              </div>
              {item.keybinding ? <div className="shortcut-keys"><kbd>{item.keybinding}</kbd></div> : null}
            </button>
          )
        })}
        {!items.length && <div className="no-results">No matching {modeLabel.toLowerCase()}</div>}
      </div>

      <footer>
        <span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span>
        <span className="palette-hints"><kbd>&gt;</kbd> commands <kbd>@</kbd> symbols <kbd>:</kbd> line</span>
      </footer>
    </Modal>
  )
}

export default CommandPalette
