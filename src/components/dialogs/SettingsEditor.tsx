/**
 * The settings editor: a searchable browse of the configuration registry.
 *
 * It shows the declared schema -- key, description and default -- rather than
 * live values, which is why every control renders read-only. Editing happens
 * in the settings dialog; this is the map of what exists.
 */

import { Search, X } from 'lucide-react'
import { Modal } from '../Modal'
import type { ConfigurationPropertySchema } from '../../configuration/configurationRegistry'

export type SettingsEditorProps = {
  query: string
  onQueryChange: (value: string) => void
  /** Matching keys, grouped by the category the registry declares. */
  groups: Array<{ category: string; keys: string[] }>
  schema: Record<string, ConfigurationPropertySchema>
  onClose: () => void
}

/** Defaults are rendered as text; objects and arrays need encoding first. */
function defaultText(schema: ConfigurationPropertySchema) {
  return schema.type === 'array' || schema.type === 'object'
    ? JSON.stringify(schema.default)
    : String(schema.default)
}

export function SettingsEditor({ query, onQueryChange, groups, schema, onClose }: SettingsEditorProps) {
  const count = groups.reduce((sum, group) => sum + group.keys.length, 0)

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
              <div className="settings-row" key={key}>
                <div className="settings-row-label">
                  <code>{key}</code>
                  <p>{schema[key].description}</p>
                </div>
                <div className="settings-row-control">
                  <span className="settings-readonly">{defaultText(schema[key])}</span>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="settings-editor-foot">
        <span>{count} setting{count === 1 ? '' : 's'} · defaults shown</span>
        <span className="settings-hint">Edit live values from the Settings dialog</span>
      </div>
    </Modal>
  )
}

export default SettingsEditor
