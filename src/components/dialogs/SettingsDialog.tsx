/**
 * The settings dialog: the live, editable preferences.
 *
 * The rows are generated from the descriptors in `src/settings.ts`, so adding
 * a preference is a one-line change there rather than more JSX here.
 */

import { Settings, X } from 'lucide-react'
import { Modal } from '../Modal'
import { defaultSettings, settingToggles, settingsProfiles, type SettingsState } from '../../settings'

export type SettingsDialogProps = {
  settings: SettingsState
  onChange: (settings: SettingsState) => void
  /** Rendered keystroke for the keybinding editor command. */
  keybindingShortcut: string
  onOpenKeybindings: () => void
  onClose: () => void
}

export function SettingsDialog({ settings, onChange, keybindingShortcut, onOpenKeybindings, onClose }: SettingsDialogProps) {
  return (
    <Modal label="Editor settings" className="settings-modal" onClose={onClose}>
      <header>
        <div>
          <span className="modal-icon"><Settings size={17} /></span>
          <div><h2>Editor settings</h2><p>Make the forge yours.</p></div>
        </div>
        <button onClick={onClose} aria-label="Close settings"><X size={17} /></button>
      </header>

      <div className="settings-body">
        <div className="settings-profiles">
          <div><strong>Workspace profiles</strong><span>Apply a focused settings preset.</span></div>
          {settingsProfiles.map((profile) => (
            <button key={profile.id} onClick={() => onChange({ ...profile.settings })}>{profile.label}</button>
          ))}
        </div>

        <label className="range-setting">
          <div><strong>Font size</strong><span>Controls the editor text size.</span></div>
          <div>
            <input
              type="range"
              min="11"
              max="19"
              value={settings.fontSize}
              onChange={(event) => onChange({ ...settings, fontSize: Number(event.target.value) })}
            />
            <output>{settings.fontSize}px</output>
          </div>
        </label>

        {settingToggles.map((toggle) => (
          <label className="toggle-setting" key={toggle.key}>
            <div><strong>{toggle.title}</strong><span>{toggle.description}</span></div>
            <input
              type="checkbox"
              checked={settings[toggle.key] as boolean}
              onChange={(event) => onChange({ ...settings, [toggle.key]: event.target.checked })}
            />
            <span className="toggle-track"><i /></span>
          </label>
        ))}

        <div className="keybinding-editor">
          <div><strong>Keyboard shortcuts</strong><span>Search and execute all commands from the palette.</span></div>
          <button onClick={onOpenKeybindings}>Open keybinding editor <kbd>{keybindingShortcut}</kbd></button>
        </div>
      </div>

      <footer>
        <button onClick={() => onChange(defaultSettings)}>Reset defaults</button>
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  )
}

export default SettingsDialog
