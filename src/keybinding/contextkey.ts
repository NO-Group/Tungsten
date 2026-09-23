/**
 * "When clause" expressions, modelled on VS Code's context key language.
 *
 * Supports the grammar VS Code documents for `when` conditions:
 *
 *   expression ::= or
 *   or         ::= and { '||' and }*
 *   and        ::= term { '&&' term }*
 *   term       ::= '!' term | primary
 *   primary    ::= 'true' | 'false' | '(' expression ')'
 *                | key | key '==' value | key '!=' value
 *                | key '=~' /regex/ | key 'in' key | key '>' n | key '<' n
 *
 * Context keys are supplied by the workbench (`editorFocus`, `terminalFocus`,
 * `activityBar`, `debugState`, ...) so keybindings and menu items can be scoped
 * the same way they are in VS Code.
 */

export type ContextValue = string | number | boolean | undefined | null | string[]
export type Context = Record<string, ContextValue>

export interface ContextKeyExpression {
  evaluate(context: Context): boolean
  serialize(): string
}

class Defined implements ContextKeyExpression {
  constructor(private readonly key: string) {}
  evaluate(context: Context) {
    const value = context[this.key]
    return !!value && value !== 'false'
  }
  serialize() { return this.key }
}

class Not implements ContextKeyExpression {
  constructor(private readonly expression: ContextKeyExpression) {}
  evaluate(context: Context) { return !this.expression.evaluate(context) }
  serialize() { return `!${this.expression.serialize()}` }
}

class Equals implements ContextKeyExpression {
  constructor(private readonly key: string, private readonly value: string, private readonly negate = false) {}
  evaluate(context: Context) {
    // Compare loosely so `editorFocus == true` works against a real boolean.
    const actual = context[this.key]
    const matches = String(actual ?? '') === this.value || (this.value === 'true' && actual === true) || (this.value === 'false' && (actual === false || actual === undefined))
    return this.negate ? !matches : matches
  }
  serialize() { return `${this.key} ${this.negate ? '!=' : '=='} ${this.value}` }
}

class Regex implements ContextKeyExpression {
  constructor(private readonly key: string, private readonly regex: RegExp | null, private readonly negate = false) {}
  evaluate(context: Context) {
    if (!this.regex) return false
    const matches = this.regex.test(String(context[this.key] ?? ''))
    return this.negate ? !matches : matches
  }
  serialize() { return `${this.key} ${this.negate ? '!~' : '=~'} ${this.regex?.toString() ?? '//'}` }
}

class In implements ContextKeyExpression {
  constructor(private readonly key: string, private readonly collectionKey: string, private readonly negate = false) {}
  evaluate(context: Context) {
    const collection = context[this.collectionKey]
    const needle = context[this.key]
    let matches = false
    if (Array.isArray(collection)) matches = collection.includes(String(needle))
    else if (collection && typeof collection === 'object') matches = Object.prototype.hasOwnProperty.call(collection, String(needle))
    else if (typeof collection === 'string') matches = collection.split(',').map((part) => part.trim()).includes(String(needle))
    return this.negate ? !matches : matches
  }
  serialize() { return `${this.key} ${this.negate ? 'not in' : 'in'} ${this.collectionKey}` }
}

class Compare implements ContextKeyExpression {
  constructor(private readonly key: string, private readonly operator: '>' | '<' | '>=' | '<=', private readonly value: number) {}
  evaluate(context: Context) {
    const actual = Number(context[this.key])
    if (Number.isNaN(actual)) return false
    switch (this.operator) {
      case '>': return actual > this.value
      case '<': return actual < this.value
      case '>=': return actual >= this.value
      case '<=': return actual <= this.value
    }
  }
  serialize() { return `${this.key} ${this.operator} ${this.value}` }
}

class And implements ContextKeyExpression {
  constructor(private readonly expressions: ContextKeyExpression[]) {}
  evaluate(context: Context) { return this.expressions.every((expression) => expression.evaluate(context)) }
  serialize() { return this.expressions.map((expression) => expression.serialize()).join(' && ') }
}

class Or implements ContextKeyExpression {
  constructor(private readonly expressions: ContextKeyExpression[]) {}
  evaluate(context: Context) { return this.expressions.some((expression) => expression.evaluate(context)) }
  serialize() { return this.expressions.map((expression) => expression.serialize()).join(' || ') }
}

class Constant implements ContextKeyExpression {
  constructor(private readonly value: boolean) {}
  evaluate() { return this.value }
  serialize() { return String(this.value) }
}

export const trueExpression: ContextKeyExpression = new Constant(true)
export const falseExpression: ContextKeyExpression = new Constant(false)

/** Split on a top-level operator, ignoring anything inside parentheses or a regex. */
function splitTopLevel(input: string, operator: '&&' | '||') {
  const parts: string[] = []
  let depth = 0
  let inRegex = false
  let start = 0
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (char === '/' && input[i - 1] !== '\\') inRegex = !inRegex
    if (inRegex) continue
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (depth === 0 && input.startsWith(operator, i)) {
      parts.push(input.slice(start, i))
      i += 1
      start = i + 1
    }
  }
  parts.push(input.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

function stripOuterParens(input: string) {
  let value = input.trim()
  while (value.startsWith('(') && value.endsWith(')')) {
    // Only strip if the leading paren actually closes at the very end.
    let depth = 0
    let balanced = true
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1
      else if (value[i] === ')') {
        depth -= 1
        if (depth === 0 && i < value.length - 1) { balanced = false; break }
      }
    }
    if (!balanced) break
    value = value.slice(1, -1).trim()
  }
  return value
}

function unquote(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Recursive-descent parse returning `null` when the input is not a valid clause.
 *
 * Returning `null` rather than `falseExpression` matters: a parse failure must
 * propagate out through enclosing operators. If `!x` treated an unparseable `x`
 * as "false" then `!!! ==` would negate its way to `true` and the rule would fire
 * on every keystroke.
 */
function parseExpression(clause: string): ContextKeyExpression | null {
  const input = stripOuterParens(clause)
  if (!input) return null

  const orParts = splitTopLevel(input, '||')
  if (orParts.length > 1) {
    const parsed = orParts.map(parseExpression)
    return parsed.every((expression): expression is ContextKeyExpression => expression !== null)
      ? new Or(parsed)
      : null
  }

  const andParts = splitTopLevel(input, '&&')
  if (andParts.length > 1) {
    const parsed = andParts.map(parseExpression)
    return parsed.every((expression): expression is ContextKeyExpression => expression !== null)
      ? new And(parsed)
      : null
  }

  const term = input

  if (term === 'true') return trueExpression
  if (term === 'false') return falseExpression

  if (term.startsWith('!')) {
    const inner = parseExpression(term.slice(1))
    return inner ? new Not(inner) : null
  }

  const regexMatch = term.match(/^([\w.\-:]+)\s*=~\s*\/(.+)\/([gimsuy]*)$/)
  if (regexMatch) {
    try {
      return new Regex(regexMatch[1], new RegExp(regexMatch[2], regexMatch[3]))
    } catch {
      return null
    }
  }

  const compareMatch = term.match(/^([\w.\-:]+)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/)
  if (compareMatch) {
    return new Compare(compareMatch[1], compareMatch[2] as '>' | '<' | '>=' | '<=', Number(compareMatch[3]))
  }

  const equalsMatch = term.match(/^([\w.\-:]+)\s*(==|!=)\s*(.+)$/)
  if (equalsMatch) {
    return new Equals(equalsMatch[1], unquote(equalsMatch[3]), equalsMatch[2] === '!=')
  }

  const notInMatch = term.match(/^([\w.\-:]+)\s+not\s+in\s+([\w.\-:]+)$/)
  if (notInMatch) return new In(notInMatch[1], notInMatch[2], true)

  const inMatch = term.match(/^([\w.\-:]+)\s+in\s+([\w.\-:]+)$/)
  if (inMatch) return new In(inMatch[1], inMatch[2])

  if (/^[\w.\-:]+$/.test(term)) return new Defined(term)

  return null
}

/**
 * Parse a when-clause. Returns `trueExpression` for an empty clause and
 * `falseExpression` for anything unparseable, so a malformed rule simply never
 * fires instead of throwing during keystroke dispatch.
 */
export function parseWhenClause(clause: string | undefined | null): ContextKeyExpression {
  if (!clause || !clause.trim()) return trueExpression
  return parseExpression(clause) ?? falseExpression
}

/** Convenience helper for one-off checks. */
export function evaluateWhenClause(clause: string | undefined, context: Context) {
  return parseWhenClause(clause).evaluate(context)
}
