/**
 * Keybinding parsing, labelling and resolution — modelled on VS Code's
 * `KeybindingResolver`.
 *
 * Supports everything the workbench needs:
 *  - modifier normalisation (`ctrl+`, `cmd+`, `shift+`, `alt+`, `meta+`, `win+`)
 *  - the `mod` alias, which maps to Cmd on macOS and Ctrl elsewhere
 *  - multi-chord sequences such as `ctrl+k ctrl+s`
 *  - `when` clauses, evaluated against the workbench context
 *  - later rules overriding earlier ones, so user keybindings win over defaults
 */

import { parseWhenClause, type Context, type ContextKeyExpression } from './contextkey'

export type Keybinding = {
  /** Command identifier this binding invokes. */
  command: string
  /** Chord sequence, e.g. `['ctrl+k', 'ctrl+s']`. */
  chords: string[]
  /** Optional when-clause source text. */
  when?: string
  /** Compiled when-clause. */
  expression: ContextKeyExpression
  /** True when the rule came from user settings rather than the defaults. */
  isUser?: boolean
}

export type ResolutionResult =
  | { kind: 'no-match' }
  | { kind: 'more-chords-needed' }
  | { kind: 'match'; command: string; binding: Keybinding }

const NO_MATCH: ResolutionResult = { kind: 'no-match' }
const MORE_CHORDS_NEEDED: ResolutionResult = { kind: 'more-chords-needed' }

export const isMac = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')

/** Keys whose names differ between DOM events and keybinding syntax. */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  return: 'enter',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pageup: 'pageup',
  pagedown: 'pagedown',
  '+': 'plus',
  '-': 'minus',
}

/** Display labels, platform aware, matching the VS Code keyboard shortcut editor. */
const MAC_LABELS: Record<string, string> = {
  ctrl: '⌃', shift: '⇧', alt: '⌥', meta: '⌘', cmd: '⌘', mod: '⌘',
  enter: '↵', escape: '⎋', backspace: '⌫', delete: '⌦', tab: '⇥', space: '␣',
  up: '↑', down: '↓', left: '←', right: '→',
}

const WIN_LABELS: Record<string, string> = {
  ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win', cmd: 'Ctrl', mod: 'Ctrl',
  enter: 'Enter', escape: 'Esc', backspace: 'Backspace', delete: 'Delete', tab: 'Tab', space: 'Space',
  up: '↑', down: '↓', left: '←', right: '→',
}

/**
 * Normalise a single chord to a canonical form: modifiers in a fixed order,
 * lower-cased, with `mod` resolved to the platform modifier.
 */
export function normalizeChord(chord: string): string {
  const parts = chord.trim().toLowerCase().split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return ''

  let ctrl = false
  let shift = false
  let alt = false
  let meta = false
  let key = ''

  for (const part of parts) {
    switch (part) {
      case 'ctrl': case 'control': ctrl = true; break
      case 'shift': shift = true; break
      case 'alt': case 'option': alt = true; break
      case 'meta': case 'cmd': case 'command': case 'super': case 'win': meta = true; break
      case 'mod': if (isMac) meta = true; else ctrl = true; break
      default: key = KEY_ALIASES[part] || part
    }
  }

  if (!key) return ''
  const modifiers: string[] = []
  if (ctrl) modifiers.push('ctrl')
  if (shift) modifiers.push('shift')
  if (alt) modifiers.push('alt')
  if (meta) modifiers.push('meta')
  return [...modifiers, key].join('+')
}

/** Parse a possibly multi-chord keybinding string such as `ctrl+k ctrl+s`. */
export function parseKeybinding(value: string): string[] {
  return value.trim().split(/\s+/).map(normalizeChord).filter(Boolean)
}

/** Canonical chord for a DOM keyboard event. */
export function chordFromEvent(event: KeyboardEvent | React.KeyboardEvent): string {
  const rawKey = event.key
  if (!rawKey) return ''
  const lower = rawKey.toLowerCase()
  if (['control', 'shift', 'alt', 'meta', 'os', 'dead'].includes(lower)) return ''

  const key = KEY_ALIASES[lower] || lower
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.shiftKey) modifiers.push('shift')
  if (event.altKey) modifiers.push('alt')
  if (event.metaKey) modifiers.push('meta')
  return [...modifiers, key].join('+')
}

/** Human-readable label for a chord sequence, e.g. `⌘K ⌘S` or `Ctrl+K Ctrl+S`. */
export function keybindingLabel(value: string | string[]): string {
  const chords = Array.isArray(value) ? value : parseKeybinding(value)
  const labels = isMac ? MAC_LABELS : WIN_LABELS
  const separator = isMac ? '' : '+'
  return chords
    .map((chord) => chord
      .split('+')
      .map((part) => labels[part] || (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(separator))
    .join(' ')
}

/**
 * Resolves keystrokes to commands.
 *
 * Bindings are indexed by their first chord. Within a bucket, later-registered
 * rules are tried first so user overrides beat defaults, and the first rule whose
 * `when` clause passes wins — the same precedence VS Code uses.
 */
export class KeybindingResolver {
  private readonly map = new Map<string, Keybinding[]>()

  constructor(bindings: Keybinding[] = []) {
    for (const binding of bindings) this.add(binding)
  }

  add(binding: Keybinding) {
    if (!binding.chords.length) return
    const bucket = this.map.get(binding.chords[0])
    if (bucket) bucket.push(binding)
    else this.map.set(binding.chords[0], [binding])
  }

  /** All bindings currently registered, flattened. */
  all(): Keybinding[] {
    return [...this.map.values()].flat()
  }

  /** Bindings assigned to a command, most recent first. */
  lookupCommand(command: string): Keybinding[] {
    return this.all().filter((binding) => binding.command === command).reverse()
  }

  /** The chord sequence to display for a command, if any. */
  lookupLabel(command: string): string {
    const binding = this.lookupCommand(command)[0]
    return binding ? keybindingLabel(binding.chords) : ''
  }

  /** Detect bindings that would collide with `chords` under `context`. */
  conflicts(chords: string[], context: Context, ignoreCommand?: string): Keybinding[] {
    if (!chords.length) return []
    return (this.map.get(chords[0]) || []).filter((binding) =>
      binding.command !== ignoreCommand
      && binding.chords.length === chords.length
      && binding.chords.every((chord, index) => chord === chords[index])
      && binding.expression.evaluate(context))
  }

  /**
   * Resolve a keypress given the chords already entered.
   *
   * Returns `more-chords-needed` when the sequence is a valid prefix, which the
   * workbench surfaces as the "(ctrl+k) was pressed. Waiting for second key…"
   * status message.
   */
  resolve(context: Context, currentChords: string[], keypress: string): ResolutionResult {
    const pressed = [...currentChords, keypress]
    const candidates = this.map.get(pressed[0])
    if (!candidates?.length) return NO_MATCH

    // Later registrations take precedence, so evaluate in reverse order.
    let needsMoreChords = false
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i]
      if (pressed.length > candidate.chords.length) continue
      if (!candidate.expression.evaluate(context)) continue

      let prefixMatches = true
      for (let chordIndex = 1; chordIndex < pressed.length; chordIndex += 1) {
        if (candidate.chords[chordIndex] !== pressed[chordIndex]) { prefixMatches = false; break }
      }
      if (!prefixMatches) continue

      if (pressed.length < candidate.chords.length) { needsMoreChords = true; continue }
      return { kind: 'match', command: candidate.command, binding: candidate }
    }

    return needsMoreChords ? MORE_CHORDS_NEEDED : NO_MATCH
  }
}

export type KeybindingRule = { command: string; key: string; when?: string; isUser?: boolean }

/** Compile plain rules (from defaults or user settings) into a resolver. */
export function createResolver(rules: KeybindingRule[]): KeybindingResolver {
  return new KeybindingResolver(rules.map((rule) => ({
    command: rule.command,
    chords: parseKeybinding(rule.key),
    when: rule.when,
    expression: parseWhenClause(rule.when),
    isUser: rule.isUser,
  })).filter((binding) => binding.chords.length > 0))
}
