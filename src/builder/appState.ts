/**
 * The variables an app keeps.
 *
 * This is the difference between a screen and an application: somewhere to
 * put what changed. A counter, a search box's contents, the signed-in user
 * -- values that outlive a single handler and that several blocks read.
 *
 * Two scopes, and only two, because the third is always a mistake:
 *
 *   page — belongs to one screen, cleared when it is left
 *   app  — global, and persisted, so a reload does not lose it
 *
 * Like everything else in the builder, the declarations live in the
 * generated file, not beside it. `app.state({ … })` is the one line the
 * program opens with, the parser reads it back, and the round trip stays
 * byte-stable -- so the variables panel and the code are the same thing.
 */

export type StateType = 'String' | 'Number' | 'Boolean' | 'List' | 'Object'
export type StateScope = 'page' | 'app'

export type AppVariable = {
  name: string
  type: StateType
  scope: StateScope
  /** The value it starts at, as written in the generated file. */
  initial: string
}

export const EMPTY_STATE: AppVariable[] = []

/** The default a new variable of each type starts with. */
export const INITIAL_FOR: Record<StateType, string> = {
  String: '""',
  Number: '0',
  Boolean: 'false',
  List: '[]',
  Object: '{}',
}

/** A name that can be a property key and read as a variable. */
export function isValidName(name: string): boolean {
  return /^[a-z][A-Za-z0-9_]*$/.test(name)
}

/** Makes a requested name legal and unique against what is already there. */
export function uniqueName(requested: string, taken: readonly AppVariable[]): string {
  const cleaned = requested.replace(/[^A-Za-z0-9_]/g, '')
  const base = /^[a-z]/.test(cleaned) ? cleaned : `value${cleaned.replace(/^[a-z]/, '')}`
  const names = new Set(taken.map((variable) => variable.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base}${index}`)) index += 1
  return `${base}${index}`
}

export function variableByName(state: readonly AppVariable[], name: string): AppVariable | undefined {
  return state.find((variable) => variable.name === name)
}

/**
 * The declaration line, or empty when there are no variables.
 *
 * Page variables come first and app variables second, each group in
 * declaration order, so the line is stable: reordering the panel is a
 * change to the file, and nothing else is.
 */
export function generateState(state: readonly AppVariable[]): string {
  if (!state.length) return ''
  const entry = (variable: AppVariable) => `${variable.name}: ${variable.initial}`
  const page = state.filter((variable) => variable.scope === 'page')
  const app = state.filter((variable) => variable.scope === 'app')
  const parts = [
    page.length ? `page: { ${page.map(entry).join(', ')} }` : '',
    app.length ? `app: { ${app.map(entry).join(', ')} }` : '',
  ].filter(Boolean)
  return `const state = app.state({ ${parts.join(', ')} })`
}

/** Splits `a: 1, b: "two"` on the commas that are not inside something. */
function splitEntries(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      current += character
      if (character === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; current += character; continue }
    if ('([{'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** The type a written initial value implies, for the panel to show. */
export function typeOfInitial(initial: string): StateType {
  const text = initial.trim()
  if (/^["'`]/.test(text)) return 'String'
  if (text === 'true' || text === 'false') return 'Boolean'
  if (text.startsWith('[')) return 'List'
  if (text.startsWith('{')) return 'Object'
  if (Number.isFinite(Number(text))) return 'Number'
  return 'Object'
}

/**
 * Reads the declaration back.
 *
 * Returns undefined when the line is not a state declaration at all, so
 * the parser can carry on and try the next thing rather than failing.
 */
export function parseState(line: string): AppVariable[] | undefined {
  const match = /^const state = app\.state\(\{(.*)\}\)$/.exec(line.trim())
  if (!match) return undefined

  const state: AppVariable[] = []
  for (const group of splitEntries(match[1])) {
    const scoped = /^(page|app):\s*\{(.*)\}$/.exec(group.trim())
    if (!scoped) continue
    const scope = scoped[1] as StateScope
    for (const entry of splitEntries(scoped[2])) {
      const at = entry.indexOf(':')
      if (at < 0) continue
      const name = entry.slice(0, at).trim()
      const initial = entry.slice(at + 1).trim()
      if (!isValidName(name) || !initial) continue
      state.push({ name, scope, type: typeOfInitial(initial), initial })
    }
  }
  return state
}

/** The names a `state.get` or `state.set` block may refer to. */
export function stateNames(state: readonly AppVariable[]): string[] {
  return state.map((variable) => variable.name)
}
