import { describe, expect, it } from 'vitest'
import { createResolver, keybindingLabel, normalizeChord, parseKeybinding } from './keybindings'
import { evaluateWhenClause, parseWhenClause } from './contextkey'
import defaultKeybindings from './defaults'

describe('chord normalisation', () => {
  it('orders modifiers canonically regardless of input order', () => {
    expect(normalizeChord('shift+ctrl+p')).toBe(normalizeChord('ctrl+shift+p'))
    expect(normalizeChord('ctrl+shift+p')).toBe('ctrl+shift+p')
  })

  it('maps aliases to canonical key names', () => {
    expect(normalizeChord('ctrl+Escape')).toBe('ctrl+escape')
    expect(normalizeChord('alt+ArrowUp')).toBe('alt+up')
    expect(normalizeChord('cmd+Return')).toBe('meta+enter')
  })

  it('resolves mod to a real platform modifier', () => {
    const chord = normalizeChord('mod+s')
    expect(chord === 'ctrl+s' || chord === 'meta+s').toBe(true)
  })

  it('splits multi-chord sequences', () => {
    expect(parseKeybinding('ctrl+k ctrl+s')).toEqual(['ctrl+k', 'ctrl+s'])
  })

  it('renders a readable label', () => {
    expect(keybindingLabel('ctrl+shift+p')).toMatch(/P$/)
    expect(keybindingLabel(['ctrl+k', 'ctrl+s']).split(' ')).toHaveLength(2)
  })
})

describe('when clauses', () => {
  it('evaluates defined keys', () => {
    expect(evaluateWhenClause('editorFocus', { editorFocus: true })).toBe(true)
    expect(evaluateWhenClause('editorFocus', {})).toBe(false)
  })

  it('evaluates negation, conjunction and disjunction', () => {
    const context = { editorFocus: true, terminalFocus: false, activityBar: 'explorer' }
    expect(evaluateWhenClause('!terminalFocus', context)).toBe(true)
    expect(evaluateWhenClause('editorFocus && !terminalFocus', context)).toBe(true)
    expect(evaluateWhenClause('terminalFocus || editorFocus', context)).toBe(true)
    expect(evaluateWhenClause('terminalFocus && editorFocus', context)).toBe(false)
  })

  it('evaluates equality and inequality against values', () => {
    const context = { activityBar: 'explorer', debugState: 'stopped' }
    expect(evaluateWhenClause('activityBar == explorer', context)).toBe(true)
    expect(evaluateWhenClause('activityBar != search', context)).toBe(true)
    expect(evaluateWhenClause("debugState == 'stopped'", context)).toBe(true)
  })

  it('evaluates regex, comparison and in operators', () => {
    expect(evaluateWhenClause('resourceExtname =~ /\\.tsx?$/', { resourceExtname: '.ts' })).toBe(true)
    expect(evaluateWhenClause('resourceExtname =~ /\\.tsx?$/', { resourceExtname: '.py' })).toBe(false)
    expect(evaluateWhenClause('openTabs > 2', { openTabs: 5 })).toBe(true)
    expect(evaluateWhenClause('openTabs > 2', { openTabs: 1 })).toBe(false)
    expect(evaluateWhenClause('lang in supported', { lang: 'go', supported: ['go', 'rust'] })).toBe(true)
  })

  it('honours parentheses', () => {
    const context = { a: true, b: false, c: true }
    expect(evaluateWhenClause('a && (b || c)', context)).toBe(true)
    expect(evaluateWhenClause('(a && b) || c', context)).toBe(true)
    expect(evaluateWhenClause('a && (b || !c)', context)).toBe(false)
  })

  it('treats an empty clause as always true and garbage as always false', () => {
    expect(parseWhenClause('').evaluate({})).toBe(true)
    expect(parseWhenClause(undefined).evaluate({})).toBe(true)
    expect(parseWhenClause('!!! ==').evaluate({})).toBe(false)
  })
})

describe('keybinding resolution', () => {
  it('resolves a simple binding', () => {
    const resolver = createResolver([{ command: 'save', key: 'mod+s' }])
    const result = resolver.resolve({}, [], normalizeChord('mod+s'))
    expect(result.kind).toBe('match')
    expect(result.kind === 'match' && result.command).toBe('save')
  })

  it('asks for more chords on a valid prefix, then matches', () => {
    const resolver = createResolver([{ command: 'saveAll', key: 'ctrl+k s' }])
    expect(resolver.resolve({}, [], 'ctrl+k').kind).toBe('more-chords-needed')
    const final = resolver.resolve({}, ['ctrl+k'], 's')
    expect(final.kind === 'match' && final.command).toBe('saveAll')
  })

  it('returns no-match for an unknown sequence', () => {
    const resolver = createResolver([{ command: 'saveAll', key: 'ctrl+k s' }])
    expect(resolver.resolve({}, ['ctrl+k'], 'q').kind).toBe('no-match')
    expect(resolver.resolve({}, [], 'ctrl+q').kind).toBe('no-match')
  })

  it('filters candidates by their when clause', () => {
    const resolver = createResolver([
      { command: 'terminal.clear', key: 'ctrl+k', when: 'terminalFocus' },
    ])
    expect(resolver.resolve({ terminalFocus: false }, [], 'ctrl+k').kind).toBe('no-match')
    const matched = resolver.resolve({ terminalFocus: true }, [], 'ctrl+k')
    expect(matched.kind === 'match' && matched.command).toBe('terminal.clear')
  })

  it('lets later (user) rules override earlier defaults on the same chord', () => {
    const resolver = createResolver([
      { command: 'default.action', key: 'mod+e' },
      { command: 'user.action', key: 'mod+e', isUser: true },
    ])
    const result = resolver.resolve({}, [], normalizeChord('mod+e'))
    expect(result.kind === 'match' && result.command).toBe('user.action')
  })

  it('reports conflicts for a chord under the active context', () => {
    const resolver = createResolver(defaultKeybindings)
    const conflicts = resolver.conflicts(parseKeybinding('mod+p'), {})
    expect(conflicts.some((binding) => binding.command === 'workbench.action.quickOpen')).toBe(true)
  })

  it('looks up the label for a command', () => {
    const resolver = createResolver(defaultKeybindings)
    expect(resolver.lookupLabel('workbench.action.showCommands')).toBeTruthy()
    expect(resolver.lookupLabel('does.not.exist')).toBe('')
  })

  it('ships defaults that all parse to at least one chord', () => {
    for (const rule of defaultKeybindings) {
      expect(parseKeybinding(rule.key).length, `${rule.command} (${rule.key})`).toBeGreaterThan(0)
    }
  })
})
