import { describe, expect, it } from 'vitest'

import {
  SETTINGS_BINDINGS,
  configurationPatch,
  defaultSettings,
  migrateStoredSettings,
  settingsFromConfiguration,
} from './settings'
import { configurationSchema } from './configuration/configurationRegistry'

describe('the bindings between workbench settings and configuration', () => {
  it('names a real setting for every workbench preference', () => {
    for (const [name, binding] of Object.entries(SETTINGS_BINDINGS)) {
      expect(configurationSchema[binding.key], `${name} -> ${binding.key}`).toBeDefined()
    }
  })

  it('agrees with the schema about what a fresh install looks like', () => {
    // Two stores that disagree on defaults is how a preference silently
    // changes the first time the other one writes.
    const fromSchema = settingsFromConfiguration({})
    expect(fromSchema).toEqual(defaultSettings)
  })

  it('round-trips every preference through configuration and back', () => {
    const flipped = {
      ...defaultSettings,
      fontSize: 18,
      wordWrap: true,
      minimap: false,
      autosave: true,
      renderWhitespace: true,
      telemetry: true,
      crashReports: false,
    }
    expect(settingsFromConfiguration(configurationPatch(flipped))).toEqual(flipped)
  })
})

describe('settingsFromConfiguration', () => {
  it('reads a mode as the switch the workbench wants', () => {
    expect(settingsFromConfiguration({ 'editor.wordWrap': 'bounded' }).wordWrap).toBe(true)
    expect(settingsFromConfiguration({ 'editor.wordWrap': 'off' }).wordWrap).toBe(false)
    expect(settingsFromConfiguration({ 'files.autoSave': 'onFocusChange' }).autosave).toBe(true)
  })

  it('ignores a value of the wrong type rather than passing it on', () => {
    expect(settingsFromConfiguration({ 'editor.fontSize': 'huge' }).fontSize).toBe(defaultSettings.fontSize)
    expect(settingsFromConfiguration({ 'editor.minimap.enabled': 'yes' }).minimap).toBe(true)
  })
})

describe('configurationPatch', () => {
  it('writes only what changed', () => {
    const patch = configurationPatch({ ...defaultSettings, minimap: false }, defaultSettings)
    expect(patch).toEqual({ 'editor.minimap.enabled': false })
  })

  it('writes everything when there is nothing to compare against', () => {
    expect(Object.keys(configurationPatch(defaultSettings))).toHaveLength(Object.keys(SETTINGS_BINDINGS).length)
  })
})

describe('migrateStoredSettings', () => {
  it('converts the flat settings earlier versions wrote', () => {
    const legacy = JSON.stringify({ fontSize: 16, minimap: false, wordWrap: true })
    const migrated = migrateStoredSettings(legacy)
    expect(migrated['editor.fontSize']).toBe(16)
    expect(migrated['editor.minimap.enabled']).toBe(false)
    expect(migrated['editor.wordWrap']).toBe('on')
  })

  it('passes configuration keys through untouched', () => {
    const stored = JSON.stringify({ 'editor.fontSize': 15, 'git.autofetch': true })
    expect(migrateStoredSettings(stored)).toEqual({ 'editor.fontSize': 15, 'git.autofetch': true })
  })

  it('drops keys the schema no longer declares', () => {
    expect(migrateStoredSettings('{"editor.gone":1}')).toEqual({})
  })

  it('survives a corrupt entry', () => {
    for (const raw of [null, '', 'not json', '[1,2]']) {
      expect(migrateStoredSettings(raw), raw ?? 'null').toEqual({})
    }
  })
})
