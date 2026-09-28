/**
 * Editor and workbench preferences.
 *
 * `SettingsState` is the handful of preferences the workbench itself reads
 * every render -- the editor's font, the minimap, the accessibility
 * switches. It is not a second store: each field is a view onto one key in
 * the configuration registry, which is where preferences actually live.
 * `settingsFromConfiguration` projects them out and `configurationPatch`
 * writes them back, so the quick settings dialog and the full settings
 * editor are always editing the same thing.
 */

import { configurationSchema } from './configuration/configurationRegistry'

export type SettingsState = {
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  autosave: boolean
  stickyScroll: boolean
  renderWhitespace: boolean
  reducedMotion: boolean
  highContrast: boolean
  screenReaderOptimized: boolean
  telemetry: boolean
  crashReports: boolean
}

export const defaultSettings: SettingsState = {
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  autosave: false,
  stickyScroll: true,
  renderWhitespace: false,
  reducedMotion: false,
  highContrast: false,
  screenReaderOptimized: false,
  /** Diagnostics stay local, so this is the one thing on by default. */
  telemetry: false,
  crashReports: true,
}

/**
 * Presets offered in the settings dialog. Accessible turns on every
 * assistive affordance at once; presentation enlarges text for an audience.
 */
export const settingsProfiles: Array<{ id: string; label: string; settings: SettingsState }> = [
  { id: 'focus', label: 'Focus', settings: { ...defaultSettings } },
  { id: 'accessible', label: 'Accessible', settings: { ...defaultSettings, highContrast: true, reducedMotion: true, screenReaderOptimized: true } },
  { id: 'presentation', label: 'Presentation', settings: { ...defaultSettings, fontSize: 17, minimap: false } },
]

/** The toggle rows, in the order the dialog shows them. */
export const settingToggles: Array<{ key: keyof SettingsState; title: string; description: string }> = [
  { key: 'wordWrap', title: 'Word wrap', description: 'Wrap long lines at the editor viewport.' },
  { key: 'minimap', title: 'Minimap', description: 'Show a compact overview of the active file.' },
  { key: 'stickyScroll', title: 'Sticky scroll', description: 'Keep surrounding scopes visible while scrolling.' },
  { key: 'renderWhitespace', title: 'Visible whitespace', description: 'Reveal spaces and tabs in selected text.' },
  { key: 'autosave', title: 'Auto save', description: 'Save changes after a short delay.' },
  { key: 'reducedMotion', title: 'Reduced motion', description: 'Disable non-essential motion and smooth scrolling.' },
  { key: 'highContrast', title: 'High contrast', description: 'Increase workbench borders and focus visibility.' },
  { key: 'screenReaderOptimized', title: 'Screen reader mode', description: 'Optimize editor accessibility and ARIA output.' },
  { key: 'telemetry', title: 'Product telemetry', description: 'Share anonymous feature usage; disabled by default.' },
  { key: 'crashReports', title: 'Crash reports', description: 'Allow packaged builds to create local crash diagnostics.' },
]

/**
 * The configuration key behind each workbench setting, with the conversion
 * between the boolean the workbench wants and the value the schema declares.
 */
type Binding = {
  key: string
  read: (value: unknown) => unknown
  write: (value: unknown) => unknown
}

const asBoolean = (fallback: boolean): Binding['read'] => (value) => (typeof value === 'boolean' ? value : fallback)
const identity: Binding['write'] = (value) => value
/** The schema stores a mode where the workbench wants a switch. */
const isOn = (off: string): Binding['read'] => (value) => value !== off
const toMode = (on: string, off: string): Binding['write'] => (value) => (value ? on : off)

export const SETTINGS_BINDINGS: Record<keyof SettingsState, Binding> = {
  fontSize: {
    key: 'editor.fontSize',
    read: (value) => (typeof value === 'number' ? value : defaultSettings.fontSize),
    write: identity,
  },
  wordWrap: { key: 'editor.wordWrap', read: isOn('off'), write: toMode('on', 'off') },
  minimap: { key: 'editor.minimap.enabled', read: asBoolean(true), write: identity },
  autosave: { key: 'files.autoSave', read: isOn('off'), write: toMode('afterDelay', 'off') },
  stickyScroll: { key: 'editor.stickyScroll.enabled', read: asBoolean(true), write: identity },
  renderWhitespace: { key: 'editor.renderWhitespace', read: isOn('none'), write: toMode('selection', 'none') },
  reducedMotion: { key: 'accessibility.reducedMotion', read: asBoolean(false), write: identity },
  highContrast: { key: 'accessibility.highContrast', read: asBoolean(false), write: identity },
  screenReaderOptimized: { key: 'accessibility.screenReaderOptimized', read: asBoolean(false), write: identity },
  telemetry: { key: 'telemetry.telemetryLevel', read: isOn('off'), write: toMode('all', 'off') },
  crashReports: { key: 'telemetry.crashReports', read: asBoolean(true), write: identity },
}

const bindings = Object.entries(SETTINGS_BINDINGS) as Array<[keyof SettingsState, Binding]>

/** Reads the workbench settings out of a set of configuration values. */
export function settingsFromConfiguration(values: Record<string, unknown>): SettingsState {
  const out: Record<string, unknown> = {}
  for (const [name, binding] of bindings) {
    const value = binding.key in values ? values[binding.key] : configurationSchema[binding.key]?.default
    out[name] = binding.read(value)
  }
  return out as SettingsState
}

/**
 * Turns the workbench settings into configuration keys.
 *
 * Passing the previous settings narrows the result to what actually changed,
 * so flipping one switch does not write ten keys into the user's overrides.
 */
export function configurationPatch(next: SettingsState, previous?: SettingsState): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [name, binding] of bindings) {
    if (previous && previous[name] === next[name]) continue
    patch[binding.key] = binding.write(next[name])
  }
  return patch
}

/**
 * Reads whatever is in storage, including the flat settings object earlier
 * versions wrote, and returns configuration keys.
 */
export function migrateStoredSettings(raw: string | null): Record<string, unknown> {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {
    return {}
  }
  const legacy = Object.keys(stored).some((key) => key in SETTINGS_BINDINGS)
  if (!legacy) {
    // Already configuration keys: keep the ones the schema still declares.
    return Object.fromEntries(Object.entries(stored).filter(([key]) => key in configurationSchema))
  }
  return configurationPatch({ ...defaultSettings, ...stored } as SettingsState)
}
