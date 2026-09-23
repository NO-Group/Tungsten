import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import defaultKeybindingRules from '../keybinding/defaults'
import { parseKeybinding, createResolver, keybindingLabel } from '../keybinding/keybindings'
import { parseWhenClause, type Context } from '../keybinding/contextkey'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

/** Command ids declared by the workbench command table. */
const declaredCommands = new Set(
  [...app.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1]),
)

/** Command ids referenced from the menu bar definition. */
const menuCommands = (() => {
  const start = app.indexOf('const menus')
  const block = app.slice(start, app.indexOf('\n  }', app.indexOf('Help:', start)))
  return [...block.matchAll(/command:\s*'([^']+)'/g)].map((match) => match[1])
})()

describe('command surface', () => {
  it('declares a substantial command table', () => {
    expect(declaredCommands.size).toBeGreaterThan(100)
  })

  it('exposes no menu item that points at a missing command', () => {
    const missing = [...new Set(menuCommands)].filter((id) => !declaredCommands.has(id))
    expect(missing).toEqual([])
    expect(menuCommands.length).toBeGreaterThan(40)
  })

  it('binds no keystroke to a command that does not exist', () => {
    // A default binding for an unknown id is a dead keystroke: the user presses
    // the key and nothing happens, with no error to explain why.
    const missing = defaultKeybindingRules
      .map((rule) => rule.command)
      .filter((id) => !declaredCommands.has(id))
    expect([...new Set(missing)]).toEqual([])
  })

  it('parses every default keybinding', () => {
    for (const rule of defaultKeybindingRules) {
      const chords = parseKeybinding(rule.key)
      expect(chords.length, `${rule.command} (${rule.key})`).toBeGreaterThan(0)
      expect(keybindingLabel(chords), rule.command).toBeTruthy()
    }
  })

  it('parses every when-clause attached to a default keybinding', () => {
    for (const rule of defaultKeybindingRules) {
      if (!rule.when) continue
      // An unparseable clause degrades to the constant `false`, which would
      // disable the binding permanently and silently.
      const expression = parseWhenClause(rule.when)
      expect(expression.serialize(), `${rule.command} when=${rule.when}`).not.toBe('false')
    }
  })

  it('satisfies every default when-clause under some context', () => {
    for (const rule of defaultKeybindingRules) {
      if (!rule.when) continue
      const expression = parseWhenClause(rule.when)
      // Build a context that asserts each referenced key, using the literal an
      // equality check compares against so `key == value` clauses can hold.
      const context: Context = {}
      for (const [, key, value] of rule.when.matchAll(/([A-Za-z][\w.]*)\s*==\s*'?([\w-]+)'?/g)) {
        context[key] = value
      }
      for (const [, key] of rule.when.matchAll(/(?<![!=~<>]\s?)\b([A-Za-z][\w.]*)\b/g)) {
        if (!(key in context) && !['true', 'false', 'in', 'not'].includes(key)) context[key] = true
      }
      expect(expression.evaluate(context), `${rule.command} when=${rule.when}`).toBe(true)
    }
  })

  it('has no two commands sharing an id', () => {
    const ids = [...app.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1])
    const seen = new Set<string>()
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
    expect(duplicates).toEqual([])
  })

  it('resolves an unambiguous binding for each unconditional keystroke', () => {
    const resolver = createResolver(defaultKeybindingRules)
    // Unconditional bindings must not collide with one another, or the later
    // registration silently shadows the earlier one.
    const unconditional = defaultKeybindingRules.filter((rule) => !rule.when)
    const byKey = new Map<string, string[]>()
    for (const rule of unconditional) {
      const label = keybindingLabel(parseKeybinding(rule.key))
      byKey.set(label, [...(byKey.get(label) ?? []), rule.command])
    }
    const collisions = [...byKey].filter(([, commands]) => new Set(commands).size > 1)
    expect(collisions.map(([key, commands]) => `${key}: ${commands.join(', ')}`)).toEqual([])
    expect(resolver.all().length).toBe(defaultKeybindingRules.length)
  })
})
