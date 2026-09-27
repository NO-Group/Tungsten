/**
 * The colour theme picker.
 *
 * Like VS Code, moving through the list previews the theme on the real
 * workbench rather than in a thumbnail: `onPreview` applies it immediately,
 * and dismissing the picker restores whatever was active when it opened.
 */

import { Check, Eye } from 'lucide-react'
import { Modal } from '../Modal'
import type { TungstenTheme } from '../../theme/themeService'

export type ThemePickerProps = {
  themes: TungstenTheme[]
  /** The theme currently previewed, which is also the one the workbench shows. */
  activeId: string
  query: string
  onQueryChange: (value: string) => void
  onPreview: (id: string) => void
  onApply: (theme: TungstenTheme) => void
  onCancel: () => void
}

/** Theme kinds read better as words than as ids. */
function kindLabel(kind: TungstenTheme['kind']) {
  if (kind === 'hc-dark' || kind === 'hc-light') return 'High contrast'
  return kind === 'light' ? 'Light' : 'Dark'
}

export function ThemePicker({ themes, activeId, query, onQueryChange, onPreview, onApply, onCancel }: ThemePickerProps) {
  const step = (delta: number) => {
    if (!themes.length) return
    const index = Math.max(0, themes.findIndex((theme) => theme.id === activeId))
    onPreview(themes[(index + delta + themes.length) % themes.length].id)
  }

  return (
    <Modal label="Select color theme" className="command-palette theme-picker" overlayClassName="palette-overlay" onClose={onCancel}>
      <div className="palette-input">
        <Eye size={17} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Select a color theme (arrow keys preview instantly)"
          aria-label="Select color theme"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
            else if (event.key === 'Enter') {
              event.preventDefault()
              const theme = themes.find((item) => item.id === activeId)
              if (theme) onApply(theme)
            }
          }}
        />
        <kbd>ESC</kbd>
      </div>

      <div className="palette-label">COLOR THEMES · imported from Visual Studio Code</div>

      <div className="palette-list" role="listbox">
        {themes.map((theme) => (
          <button
            key={theme.id}
            role="option"
            aria-selected={theme.id === activeId}
            className={theme.id === activeId ? 'selected' : ''}
            onMouseEnter={() => onPreview(theme.id)}
            onClick={() => onApply(theme)}
          >
            <span className="theme-swatch" style={{ background: theme.workbench.background, borderColor: theme.workbench.border }}>
              <i style={{ background: theme.workbench.accent }} />
              <i style={{ background: theme.workbench.added }} />
              <i style={{ background: theme.workbench.error }} />
            </span>
            <div>
              <strong>{theme.label}</strong>
              <span>{kindLabel(theme.kind)} · {theme.rules.length} token rules</span>
            </div>
            {theme.id === activeId && <Check size={14} />}
          </button>
        ))}
        {!themes.length && <div className="no-results">No themes match “{query}”</div>}
      </div>

      <footer><span><kbd>↑↓</kbd> preview</span><span><kbd>↵</kbd> apply</span><span><kbd>esc</kbd> close</span></footer>
    </Modal>
  )
}

export default ThemePicker
