/**
 * The screens, as a strip above the canvas.
 *
 * It reads like the tab bar of a design tool rather than a file tree,
 * because that is what it is: one of these is on the canvas and the rest
 * are a click away. The order is meaningful -- the first screen is where
 * the app starts -- so it is shown, and it can be changed.
 *
 * The active tab is an input. Renaming a screen is a thing people do
 * constantly and early, and making it a separate dialog would mean a
 * project full of screens called "screen-2".
 */

import { Home, Plus, X } from 'lucide-react'

import type { Screen } from '../../builder/screens'

export type ScreenBarProps = {
  screens: Screen[]
  active: string
  /** How many blocks sit on each screen, by name. */
  counts: Record<string, number>
  /** How many blocks are selected, for the "move to" control. */
  selected: number
  readOnly?: boolean
  onOpen: (name: string) => void
  onAdd: () => void
  onRename: (index: number, name: string) => void
  onRemove: (index: number) => void
  onMove: (index: number, to: number) => void
  onMoveSelection: (name: string) => void
}

export function ScreenBar({
  screens, active, counts, selected, readOnly, onOpen, onAdd, onRename, onRemove, onMove, onMoveSelection,
}: ScreenBarProps) {
  const index = screens.findIndex((screen) => screen.name === active)

  /**
   * The rename commits on blur or Enter, not on every keystroke: “sett” is
   * not a screen anyone wants, and renaming per character would rewrite
   * the file four times and leave four entries on the undo stack.
   *
   * The field is uncontrolled, keyed by the screen it belongs to -- which
   * is how it reloads when the screen changes without a state mirror, and
   * without an effect that writes state during render. A rejected rename
   * deliberately leaves the typing in place: the notification says what
   * was wrong, and throwing the text away would be a second punishment.
   */
  const commit = (value: string) => {
    if (value.trim() === active) return
    onRename(index, value)
  }

  return (
    <nav className="builder-screens" aria-label="Screens">
      {screens.map((screen, position) => {
        const count = counts[screen.name] ?? 0
        const home = position === 0

        if (screen.name !== active) {
          return (
            <button
              key={screen.name}
              className="builder-screen"
              aria-label={`Open the ${screen.name} screen`}
              title={`${count} block${count === 1 ? '' : 's'}${home ? ' · the app starts here' : ''}`}
              onClick={() => onOpen(screen.name)}
            >
              {home && <Home size={10} />}
              <span>{screen.name}</span>
              <em>{count}</em>
            </button>
          )
        }

        return (
          <span key={screen.name} className="builder-screen active">
            {home && <Home size={10} aria-label="The app starts here" />}
            <input
              key={screen.name}
              defaultValue={screen.name}
              disabled={readOnly}
              aria-label="Rename screen"
              size={Math.max(4, screen.name.length)}
              onBlur={(event) => commit(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget.value) }
                if (event.key === 'Escape') { event.currentTarget.value = screen.name }
              }}
            />
            <em>{count}</em>
            {!home && (
              <button
                className="builder-screen-home"
                aria-label={`Start the app on ${screen.name}`}
                title="Make this the screen the app opens on"
                disabled={readOnly}
                onClick={() => onMove(position, 0)}
              >
                <Home size={10} />
              </button>
            )}
            <button
              className="builder-screen-close"
              aria-label={`Delete the ${screen.name} screen`}
              title={screens.length > 1
                ? 'Delete this screen and the blocks on it'
                : 'An app has at least one screen'}
              disabled={readOnly || screens.length <= 1}
              onClick={() => onRemove(position)}
            >
              <X size={10} />
            </button>
          </span>
        )
      })}

      <button
        className="builder-screen-add"
        aria-label="Add a screen"
        title="Add a screen"
        disabled={readOnly}
        onClick={onAdd}
      >
        <Plus size={11} />
      </button>

      {/*
        Only when there is both a selection and somewhere to send it. A
        control that is always visible and almost never usable is noise.
      */}
      {selected > 0 && screens.length > 1 && (
        <select
          className="builder-screen-move"
          aria-label="Move the selection to a screen"
          value=""
          disabled={readOnly}
          onChange={(event) => { if (event.target.value) onMoveSelection(event.target.value) }}
        >
          <option value="">Move {selected} to…</option>
          {screens
            .filter((screen) => screen.name !== active)
            .map((screen) => <option key={screen.name} value={screen.name}>{screen.name}</option>)}
        </select>
      )}
    </nav>
  )
}

export default ScreenBar
