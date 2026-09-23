import { describe, expect, it } from 'vitest'
import {
  configurationByCategory,
  configurationSchema,
  resolveAll,
  resolveConfiguration,
  searchConfiguration,
  toSettingsJson,
  validateConfiguration,
} from './configurationRegistry'

describe('configuration schema', () => {
  it('declares a broad set of settings', () => {
    expect(Object.keys(configurationSchema).length).toBeGreaterThan(50)
  })

  it('gives every setting a description, category, and default', () => {
    for (const [key, schema] of Object.entries(configurationSchema)) {
      expect(schema.description, key).toBeTruthy()
      expect(schema.category, key).toBeTruthy()
      expect(schema.default, key).toBeDefined()
    }
  })

  it('gives every enum setting a default drawn from its own options', () => {
    for (const [key, schema] of Object.entries(configurationSchema)) {
      if (schema.type !== 'enum') continue
      expect(schema.enum, key).toBeTruthy()
      expect(schema.enum, key).toContain(schema.default as string)
    }
  })

  it('keeps every numeric default inside its declared range', () => {
    for (const [key, schema] of Object.entries(configurationSchema)) {
      if (schema.type !== 'number') continue
      const value = schema.default as number
      if (schema.minimum !== undefined) expect(value, key).toBeGreaterThanOrEqual(schema.minimum)
      if (schema.maximum !== undefined) expect(value, key).toBeLessThanOrEqual(schema.maximum)
    }
  })

  it('declares defaults whose type matches the declared type', () => {
    for (const [key, schema] of Object.entries(configurationSchema)) {
      switch (schema.type) {
        case 'boolean': expect(typeof schema.default, key).toBe('boolean'); break
        case 'number': expect(typeof schema.default, key).toBe('number'); break
        case 'string':
        case 'enum': expect(typeof schema.default, key).toBe('string'); break
        case 'array': expect(Array.isArray(schema.default), key).toBe(true); break
        case 'object': expect(typeof schema.default, key).toBe('object'); break
        default: break
      }
    }
  })

  it('validates its own defaults cleanly', () => {
    const defaults = Object.fromEntries(
      Object.entries(configurationSchema).map(([key, schema]) => [key, schema.default]),
    )
    expect(validateConfiguration(defaults)).toEqual([])
  })
})

describe('configuration resolution', () => {
  it('falls back to the schema default', () => {
    expect(resolveConfiguration('editor.fontSize', {})).toBe(13)
  })

  it('lets the user layer override the default', () => {
    expect(resolveConfiguration('editor.fontSize', { user: { 'editor.fontSize': 16 } })).toBe(16)
  })

  it('lets the workspace layer override the user layer', () => {
    const layers = { user: { 'editor.fontSize': 16 }, workspace: { 'editor.fontSize': 18 } }
    expect(resolveConfiguration('editor.fontSize', layers)).toBe(18)
  })

  it('lets a language override beat every other layer', () => {
    const layers = {
      user: { 'editor.tabSize': 4 },
      workspace: { 'editor.tabSize': 8 },
      language: { python: { 'editor.tabSize': 4 }, go: { 'editor.tabSize': 8 } },
    }
    expect(resolveConfiguration('editor.tabSize', layers, 'python')).toBe(4)
    expect(resolveConfiguration('editor.tabSize', layers, 'go')).toBe(8)
    // A language with no override still sees the workspace value.
    expect(resolveConfiguration('editor.tabSize', layers, 'rust')).toBe(8)
  })

  it('does not treat an absent key as an override', () => {
    const layers = { user: {}, workspace: {} }
    expect(resolveConfiguration('editor.fontSize', layers)).toBe(13)
  })

  it('preserves a falsy override rather than falling through', () => {
    // `false` and `0` are real values, not "unset".
    expect(resolveConfiguration('editor.minimap.enabled', { user: { 'editor.minimap.enabled': false } })).toBe(false)
    expect(resolveConfiguration('editor.lineHeight', { user: { 'editor.lineHeight': 0 } })).toBe(0)
  })

  it('resolves a full snapshot', () => {
    const all = resolveAll({ user: { 'editor.fontSize': 20 } })
    expect(all['editor.fontSize']).toBe(20)
    expect(all['editor.tabSize']).toBe(2)
    expect(Object.keys(all).length).toBe(Object.keys(configurationSchema).length)
  })
})

describe('configuration validation', () => {
  it('flags an unknown setting', () => {
    const issues = validateConfiguration({ 'editor.notARealSetting': 1 })
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Unknown setting')
  })

  it('flags a wrong type', () => {
    expect(validateConfiguration({ 'editor.fontSize': 'big' })[0].message).toContain('number')
    expect(validateConfiguration({ 'editor.minimap.enabled': 'yes' })[0].message).toContain('true or false')
  })

  it('flags an out-of-range number', () => {
    expect(validateConfiguration({ 'editor.fontSize': 500 })[0].message).toContain('at most')
    expect(validateConfiguration({ 'editor.fontSize': 1 })[0].message).toContain('at least')
  })

  it('flags an invalid enum value and lists the options', () => {
    const [issue] = validateConfiguration({ 'editor.wordWrap': 'sometimes' })
    expect(issue.message).toContain('must be one of')
    expect(issue.message).toContain('wordWrapColumn')
  })

  it('accepts valid values', () => {
    expect(validateConfiguration({ 'editor.fontSize': 14, 'editor.wordWrap': 'on' })).toEqual([])
  })

  it('validates inside a language override block', () => {
    const issues = validateConfiguration({ '[python]': { 'editor.tabSize': 'four' } })
    expect(issues).toHaveLength(1)
    expect(issues[0].key).toBe('[python].editor.tabSize')
  })

  it('accepts a valid language override block', () => {
    expect(validateConfiguration({ '[python]': { 'editor.tabSize': 4 } })).toEqual([])
  })
})

describe('settings editor support', () => {
  it('groups settings by category in a stable order', () => {
    const groups = configurationByCategory()
    expect(groups.map((group) => group.category)).toContain('Editor')
    expect(groups.map((group) => group.category)).toContain('Terminal')
    const total = groups.reduce((sum, group) => sum + group.keys.length, 0)
    expect(total).toBe(Object.keys(configurationSchema).length)
  })

  it('orders keys within a category by declared order', () => {
    const editor = configurationByCategory().find((group) => group.category === 'Editor')!
    expect(editor.keys[0]).toBe('editor.fontSize')
  })

  it('searches by key, description, and category', () => {
    expect(searchConfiguration('fontSize')).toContain('editor.fontSize')
    expect(searchConfiguration('minimap')).toContain('editor.minimap.enabled')
    // Description text is searchable too.
    expect(searchConfiguration('screen readers')).toContain('accessibility.screenReaderOptimized')
    expect(searchConfiguration('')).toHaveLength(Object.keys(configurationSchema).length)
  })

  it('writes only non-default values to settings.json', () => {
    const json = toSettingsJson({ 'editor.fontSize': 13, 'editor.tabSize': 4 })
    const parsed = JSON.parse(json)
    // fontSize equals the default, so it is omitted.
    expect(parsed).toEqual({ 'editor.tabSize': 4 })
  })

  it('produces valid JSON ending in a newline', () => {
    const json = toSettingsJson({ 'editor.tabSize': 4 })
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json.endsWith('\n')).toBe(true)
  })
})
