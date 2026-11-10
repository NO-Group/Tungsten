/**
 * What the three native emitters agree about expressions.
 *
 * Each language spells a comparison differently, so the rendering lives
 * with the target. What does *not* differ is which operators exist, which
 * of them are allowed, and what to do with an operator nobody recognises --
 * and that was the part three copies would get subtly out of step.
 */

import type { IrCall, IrValue } from '../compile'

/** The comparisons a Compare block may produce. */
export const COMPARISONS = ['===', '!==', '<', '<=', '>', '>='] as const

/** The arithmetic a Math block may produce. */
export const ARITHMETIC = ['+', '-', '*', '/', '%'] as const

/**
 * The operator a call carries, restricted to a known list.
 *
 * The operator is a literal choice rather than an expression -- the block
 * marks the port as a property -- so a generated comparison can never be
 * steered into something that is not one. Anything unexpected becomes the
 * fallback rather than reaching a target's source file.
 */
export function operatorOf(call: IrCall, allowed: readonly string[], fallback: string): string {
  const input: IrValue | undefined = call.inputs.operator
  if (!input || input.kind !== 'literal') return fallback
  const raw = String(input.value)
  return allowed.includes(raw) ? raw : fallback
}

/**
 * Whether a comparison is an equality test.
 *
 * Equality is compared as text and ordering as numbers, in all three
 * languages: the values coming out of a dynamic field map have no static
 * type, and `"3" < "20"` being true is the kind of bug that takes an hour
 * to find in generated code.
 */
export function isEquality(operator: string): boolean {
  return operator === '===' || operator === '!=='
}

/**
 * Whether a value is already a string in the target language.
 *
 * Used to keep the generated source readable: wrapping a literal, a field
 * read or the current screen name in a conversion is noise, and noise in
 * generated code is what makes people stop reading it.
 */
export function isTextual(value: IrValue | undefined): boolean {
  if (!value) return false
  if (value.kind === 'literal') return typeof value.value === 'string'
  if (value.kind !== 'call') return false
  return value.type === 'ui.value' || value.type === 'nav.current' || value.type === 'data.text'
}

/** One field of a flat object literal, with its value as written. */
export type ObjectEntry = { key: string; value: string }

const KEY = /^(?:([A-Za-z_$][\w$]*)|"((?:[^"\\]|\\.)*)")$/
const JSON_LITERAL = /^(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)$/

/**
 * Reads `{ title: "Hello", done: true }` into its fields.
 *
 * An Object port holds text the user typed, and every target needs it as
 * an object in that target's own spelling -- a map in Kotlin, a
 * dictionary in Swift, a JSON body on the wire. Passing the text through
 * as a string, which is what used to happen, meant the backend received
 * `"{ title: \"Hello\" }"` and stored none of it.
 *
 * Deliberately strict: one level deep, keys that are identifiers or
 * quoted strings, and values that are JSON literals. Anything else --
 * nesting, a call, an expression -- returns undefined and the caller
 * falls back to treating the text as text. A generator that guesses at
 * arbitrary JavaScript and emits it as Kotlin would be worse than one
 * that declines.
 */
export function parseObjectLiteral(text: string): ObjectEntry[] | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  const body = trimmed.slice(1, -1).trim()
  if (!body) return []
  // No nesting: a brace or bracket inside is a shape this cannot promise
  // to spell correctly in four languages.
  if (/[{}[\]]/.test(body)) return undefined

  const entries: ObjectEntry[] = []
  for (const part of splitTopLevel(body)) {
    const colon = indexOfColon(part)
    if (colon < 0) return undefined
    const rawKey = part.slice(0, colon).trim()
    const rawValue = part.slice(colon + 1).trim()
    const key = KEY.exec(rawKey)
    if (!key || !JSON_LITERAL.test(rawValue)) return undefined
    entries.push({ key: key[1] ?? key[2], value: rawValue })
  }
  return entries
}

/** Splits on commas that are not inside a string. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (quoted) {
      current += character
      if (character === '\\') { current += body[index + 1] ?? ''; index += 1 }
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') { quoted = true; current += character; continue }
    if (character === ',') { parts.push(current); current = ''; continue }
    current += character
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** The colon separating key from value, skipping any inside the key. */
function indexOfColon(part: string): number {
  let quoted = false
  for (let index = 0; index < part.length; index += 1) {
    const character = part[index]
    if (quoted) {
      if (character === '\\') index += 1
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === ':') return index
  }
  return -1
}

/** The same fields, as the literal each language writes. */
export function objectIn(language: 'kotlin' | 'swift' | 'dart' | 'js', entries: ObjectEntry[]): string {
  if (!entries.length) {
    if (language === 'kotlin') return 'emptyMap<String, Any?>()'
    if (language === 'swift') return '[String: Any]()'
    if (language === 'dart') return '<String, dynamic>{}'
    return '{}'
  }
  const pairs = entries.map(({ key, value }) => {
    const name = JSON.stringify(key)
    if (language === 'kotlin') return `${name} to ${value}`
    if (language === 'js') return `${key}: ${value}`
    return `${name}: ${value}`
  })
  if (language === 'kotlin') return `mapOf(${pairs.join(', ')})`
  if (language === 'dart') return `<String, dynamic>{${pairs.join(', ')}}`
  if (language === 'swift') return `[${pairs.join(', ')}]`
  return `{ ${pairs.join(', ')} }`
}
