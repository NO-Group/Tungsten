/**
 * Editor and workbench preferences.
 *
 * These live outside the renderer so the settings dialog, the persistence
 * layer and the editor options builder all agree on the shape and on what a
 * fresh install looks like.
 */

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
