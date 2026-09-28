/**
 * The settings editor: every declared setting, searchable and editable.
 *
 * The control a row shows is decided by the schema -- a switch for a
 * boolean, a menu for an enum, a bounded number field, a text field, and raw
 * JSON for the array and object settings. A row the user has changed is
 * marked, and can be put back to its default from the row itself.
 *
 * The dialog holds no state of its own beyond the text of a field being
 * typed into: values come in resolved and changes go straight back out.
 */

import { useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
import { Modal } from '../Modal'
import type { ConfigurationPropertySchema } from '../../configuration/configurationRegistry'

export type SettingsEditorProps = {
  query: string
  onQueryChange: (value: string) => void
  /** Matching keys, grouped by the category the registry declares. */
  groups: Array<{ category: string; keys: string[] }>
  schema: Record<string, ConfigurationPropertySchema>
  /** Every setting, resolved: the user's value, or the default. */
  values: Record<string, unknown>
  /** The keys the user has changed. */
  modified: Set<string>
  onChange: (key: string, value: unknown) => void
  onReset: (key: string) => void
  onClose: () => void
}

/** Arrays and objects are edited as the JSON they are. */
function asText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

type RowProps = {
  settingKey: string
  schema: ConfigurationPropertySchema
  value: unknown
  onChange: (value: unknown) => void
}

/** A JSON field keeps its own text so a half-typed value is not rejected. */
function JsonField({ settingKey, value, onChange }: RowProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? asText(value)
  let invalid = false
  try {
    JSON.parse(text)
  } catch {
    invalid = true
  }

  return (
    <input
      className="settings-json"
      aria-label={settingKey}
      aria-invalid={invalid || undefined}
      value={text}
      onChange={(event) => {
        setDraft(event.target.value)
        try {
          onChange(JSON.parse(event.target.value))
        } catch {
          // Keep typing; the value is only written once it parses.
        }
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

function SettingControl(props: RowProps) {
  const { settingKey, schema, value, onChange } = props

  if (schema.type === 'boolean') {
    return (
      <label className="toggle-setting compact">
        <input
          type="checkbox"
          aria-label={settingKey}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-track"><i /></span>
      </label>
    )
  }

  if (schema.type === 'enum') {
    return (
      <select aria-label={settingKey} value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {schema.enum?.map((option) => (
          <option key={option} value={option}>{option === '\n' ? '\\n' : option === '\r\n' ? '\\r\\n' : option}</option>
        ))}
      </select>
    )
  }

  if (schema.type === 'number') {
    return (
      <input
        type="number"
        aria-label={settingKey}
        value={Number(value)}
        min={schema.minimum}
        max={schema.maximum}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    )
  }

  if (schema.type === 'string') {
    return (
      <input
        type="text"
        aria-label={settingKey}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return <JsonField {...props} />
}

export function SettingsEditor({
  query, onQueryChange, groups, schema, values, modified, onChange, onReset, onClose,
}: SettingsEditorProps) {
  const count = groups.reduce((sum, group) => sum + group.keys.length, 0)
  const changed = groups.reduce(
    (sum, group) => sum + group.keys.filter((key) => modified.has(key)).length,
    0,
  )

  return (
    <Modal label="Settings" className="settings-editor" onClose={onClose}>
      <div className="settings-editor-head">
        <div className="search-box-wrap">
          <Search size={13} />
          <input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search settings" aria-label="Search settings" />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={15} /></button>
      </div>

      <div className="settings-editor-body">
        {groups.length === 0 && <div className="settings-empty">No settings match “{query}”.</div>}
        {groups.map((group) => (
          <section key={group.category}>
            <h3>{group.category}</h3>
            {group.keys.map((key) => (
              <div className={`settings-row ${modified.has(key) ? 'modified' : ''}`} key={key}>
                <div className="settings-row-label">
                  <code>{key}</code>
                  <p>{schema[key].description}</p>
                </div>
                <div className="settings-row-control">
                  <SettingControl
                    settingKey={key}
                    schema={schema[key]}
                    value={values[key]}
                    onChange={(value) => onChange(key, value)}
                  />
                  {modified.has(key) && (
                    <button
                      className="icon-button"
                      aria-label={`Reset ${key}`}
                      title={`Reset to ${asText(schema[key].default)}`}
                      onClick={() => onReset(key)}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="settings-editor-foot">
        <span>{count} setting{count === 1 ? '' : 's'}{changed ? ` · ${changed} changed` : ''}</span>
        <span className="settings-hint">Changes apply immediately and are kept</span>
      </div>
    </Modal>
  )
}

export default SettingsEditor
