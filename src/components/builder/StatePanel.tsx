/**
 * The variables panel.
 *
 * What the app remembers, listed: the name blocks refer to, whether it
 * belongs to one screen or to the whole application, and what it starts
 * as. Everything here writes straight into the generated file's opening
 * line, so this panel and the code are two views of the same declaration.
 *
 * The scope column is the important one, and it is a toggle rather than a
 * setting buried somewhere: *page* is cleared when the screen is left,
 * *app* persists. Naming that difference at the point of decision is the
 * whole reason for showing it here.
 */

import { Plus, Trash2 } from 'lucide-react'

import type { AppVariable, StateScope, StateType } from '../../builder/appState'

export type StatePanelProps = {
  state: AppVariable[]
  /** Which variables are actually read or written by a block. */
  used: Set<string>
  readOnly?: boolean
  onAdd: (scope: StateScope) => void
  onRename: (index: number, name: string) => void
  onScope: (index: number, scope: StateScope) => void
  onType: (index: number, type: StateType) => void
  onInitial: (index: number, initial: string) => void
  onRemove: (index: number) => void
}

const TYPES: StateType[] = ['String', 'Number', 'Boolean', 'List', 'Object']

export function StatePanel(props: StatePanelProps) {
  const { state, used, readOnly, onAdd, onRename, onScope, onType, onInitial, onRemove } = props

  return (
    <div className="state-panel">
      <div className="state-head">
        <span>{state.length} variable{state.length === 1 ? '' : 's'}</span>
        <button disabled={readOnly} onClick={() => onAdd('page')}><Plus size={11} /> Page</button>
        <button disabled={readOnly} onClick={() => onAdd('app')}><Plus size={11} /> App</button>
      </div>

      {!state.length && (
        <p className="state-empty">
          Nothing remembered yet. A page variable lives as long as the screen;
          an app variable outlives a reload. Read one with a “Read Variable”
          block, change it with “Set Variable”.
        </p>
      )}

      {state.map((variable, index) => (
        <div className={`state-row${used.has(variable.name) ? '' : ' unused'}`} key={`${variable.name}-${index}`}>
          <input
            className="state-name"
            aria-label={`Name of variable ${index + 1}`}
            defaultValue={variable.name}
            disabled={readOnly}
            // Committed on blur or Enter rather than per keystroke: a
            // half-typed name would be rejected on its way to being right.
            onBlur={(event) => { if (event.target.value !== variable.name) onRename(index, event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          />

          <button
            className={`state-scope ${variable.scope}`}
            aria-label={`Scope of ${variable.name}`}
            title={variable.scope === 'app'
              ? 'App: shared by every screen, and kept across a reload'
              : 'Page: belongs to this screen only'}
            disabled={readOnly}
            onClick={() => onScope(index, variable.scope === 'page' ? 'app' : 'page')}
          >
            {variable.scope}
          </button>

          <select
            aria-label={`Type of ${variable.name}`}
            value={variable.type}
            disabled={readOnly}
            onChange={(event) => onType(index, event.target.value as StateType)}
          >
            {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>

          <input
            className="state-initial"
            aria-label={`Initial value of ${variable.name}`}
            defaultValue={variable.initial}
            disabled={readOnly}
            onBlur={(event) => { if (event.target.value !== variable.initial) onInitial(index, event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          />

          <button
            className="state-remove"
            aria-label={`Remove ${variable.name}`}
            disabled={readOnly}
            onClick={() => onRemove(index)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}

      {state.some((variable) => !used.has(variable.name)) && (
        <p className="state-note">
          Dimmed variables are declared but nothing reads or writes them yet.
        </p>
      )}
    </div>
  )
}

export default StatePanel
