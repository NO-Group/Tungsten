/**
 * The user's preferences, as one store.
 *
 * Everything the user has changed lives here as configuration keys, the same
 * keys the settings editor lists and the same ones VS Code uses. The
 * workbench's own `SettingsState` is a projection of it rather than a second
 * copy, so the quick settings dialog and the settings editor cannot disagree.
 *
 * Only overrides are kept. A value that matches the schema's default is
 * removed rather than stored, which is what makes "reset" mean something and
 * keeps a new default from being shadowed by a stale copy of the old one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { configurationSchema, validateConfiguration } from './configurationRegistry'
import {
  configurationPatch,
  migrateStoredSettings,
  settingsFromConfiguration,
  type SettingsState,
} from '../settings'

export const SETTINGS_KEY = 'tungsten.settings.v1'

const isDefault = (key: string, value: unknown) =>
  JSON.stringify(configurationSchema[key]?.default) === JSON.stringify(value)

/** Drops overrides that match the default, and keys the schema dropped. */
export function pruneOverrides(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => key in configurationSchema && !isDefault(key, value)),
  )
}

export function useUserConfiguration() {
  const [overrides, setOverrides] = useState<Record<string, unknown>>(
    () => pruneOverrides(migrateStoredSettings(localStorage.getItem(SETTINGS_KEY))),
  )

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(overrides))
  }, [overrides])

  /** Every key, defaults filled in. */
  const values = useMemo(() => {
    const resolved: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(configurationSchema)) {
      resolved[key] = key in overrides ? overrides[key] : schema.default
    }
    return resolved
  }, [overrides])

  /** The subset the workbench reads directly, as booleans and numbers. */
  const settings = useMemo(() => settingsFromConfiguration(values), [values])

  /** Rejected values are dropped: a setting never holds something invalid. */
  const update = useCallback((patch: Record<string, unknown>) => {
    const rejected = new Set(validateConfiguration(patch).map((issue) => issue.key))
    setOverrides((current) => pruneOverrides({
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([key]) => !rejected.has(key))),
    }))
    return validateConfiguration(patch)
  }, [])

  const set = useCallback((key: string, value: unknown) => update({ [key]: value }), [update])

  const reset = useCallback((key: string) => {
    setOverrides((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const resetAll = useCallback(() => setOverrides({}), [])

  /** Writes through the workbench projection, touching only what changed. */
  const setSettings = useCallback((next: SettingsState | ((current: SettingsState) => SettingsState)) => {
    setOverrides((current) => {
      const resolved: Record<string, unknown> = {}
      for (const [key, schema] of Object.entries(configurationSchema)) {
        resolved[key] = key in current ? current[key] : schema.default
      }
      const previous = settingsFromConfiguration(resolved)
      const value = typeof next === 'function' ? next(previous) : next
      return pruneOverrides({ ...current, ...configurationPatch(value, previous) })
    })
  }, [])

  /** Which keys the user has actually changed, for the "modified" marks. */
  const modified = useMemo(() => new Set(Object.keys(overrides)), [overrides])

  return { values, overrides, modified, settings, setSettings, set, reset, resetAll, update }
}
