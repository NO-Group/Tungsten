/**
 * TextMate snippet grammar, ported from VS Code's
 * `src/vs/editor/contrib/snippet/browser/snippetParser.ts`.
 *
 * Supports the full syntax users expect from VS Code snippets:
 *
 *   $1, $2, $0              tabstops (0 is always the final stop)
 *   ${1:default}            placeholder with a default value
 *   ${1|a,b,c|}             choice
 *   $TM_FILENAME            variable
 *   ${TM_FILENAME:default}  variable with a fallback
 *   ${1/regex/format/flags} transform, with /upcase style format strings
 *   \$ \} \\                escapes
 *
 * Anything that fails to parse degrades to literal text rather than throwing,
 * matching upstream: a malformed snippet still inserts something sensible.
 */

export const enum TokenType {
  Dollar,
  Colon,
  Comma,
  CurlyOpen,
  CurlyClose,
  Backslash,
  Forwardslash,
  Pipe,
  Int,
  VariableName,
  Format,
  Plus,
  Dash,
  QuestionMark,
  EOF,
}

export interface Token {
  type: TokenType
  pos: number
  len: number
}

const STATIC_TOKENS: Record<string, TokenType> = {
  $: TokenType.Dollar,
  ':': TokenType.Colon,
  ',': TokenType.Comma,
  '{': TokenType.CurlyOpen,
  '}': TokenType.CurlyClose,
  '\\': TokenType.Backslash,
  '/': TokenType.Forwardslash,
  '|': TokenType.Pipe,
  '+': TokenType.Plus,
  '-': TokenType.Dash,
  '?': TokenType.QuestionMark,
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9'
const isVariableChar = (ch: string) => ch === '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')

export class Scanner {
  value = ''
  pos = 0

  text(value: string) {
    this.value = value
    this.pos = 0
  }

  tokenText(token: Token) {
    return this.value.substr(token.pos, token.len)
  }

  next(): Token {
    if (this.pos >= this.value.length) return { type: TokenType.EOF, pos: this.pos, len: 0 }

    const pos = this.pos
    let len = 0
    let ch = this.value[pos]

    const staticType = STATIC_TOKENS[ch]
    if (staticType !== undefined) {
      this.pos += 1
      return { type: staticType, pos, len: 1 }
    }

    if (isDigit(ch)) {
      do {
        len += 1
        ch = this.value[pos + len]
      } while (ch !== undefined && isDigit(ch))
      this.pos += len
      return { type: TokenType.Int, pos, len }
    }

    if (isVariableChar(ch)) {
      do {
        len += 1
        ch = this.value[pos + len]
      } while (ch !== undefined && (isVariableChar(ch) || isDigit(ch)))
      this.pos += len
      return { type: TokenType.VariableName, pos, len }
    }

    // Everything else clumps into a Format run.
    do {
      len += 1
      ch = this.value[pos + len]
    } while (ch !== undefined && STATIC_TOKENS[ch] === undefined && !isDigit(ch) && !isVariableChar(ch))
    this.pos += len
    return { type: TokenType.Format, pos, len }
  }
}

export abstract class Marker {
  parent!: Marker
  protected _children: Marker[] = []

  appendChild(child: Marker): this {
    const last = this._children[this._children.length - 1]
    if (child instanceof Text && last instanceof Text) {
      // Merge adjacent text runs so the tree stays compact.
      last.value += child.value
    } else {
      child.parent = this
      this._children.push(child)
    }
    return this
  }

  replace(child: Marker, others: Marker[]) {
    const parent = child.parent
    const index = parent.children.indexOf(child)
    const next = parent.children.slice(0)
    next.splice(index, 1, ...others)
    parent._children = next
    const fixParent = (children: Marker[], owner: Marker) => {
      for (const item of children) {
        item.parent = owner
        fixParent(item.children, item)
      }
    }
    fixParent(others, parent)
  }

  get children(): Marker[] {
    return this._children
  }

  toString(): string {
    return this.children.reduce((prev, cur) => prev + cur.toString(), '')
  }

  len(): number {
    return 0
  }

  abstract clone(): Marker
}

export class Text extends Marker {
  constructor(public value: string) {
    super()
  }
  static escape(value: string) {
    return value.replace(/\$|}|\\/g, '\\$&')
  }
  override toString() {
    return this.value
  }
  override len() {
    return this.value.length
  }
  clone(): Text {
    return new Text(this.value)
  }
}

export abstract class TransformableMarker extends Marker {
  transform?: Transform
}

export class Placeholder extends TransformableMarker {
  constructor(public index: number) {
    super()
  }

  static compareByIndex(a: Placeholder, b: Placeholder): number {
    if (a.index === b.index) return 0
    // The final tabstop always sorts last, however high the other indices go.
    if (a.isFinalTabstop) return 1
    if (b.isFinalTabstop) return -1
    return a.index < b.index ? -1 : 1
  }

  get isFinalTabstop() {
    return this.index === 0
  }

  get choice(): Choice | undefined {
    return this._children.length === 1 && this._children[0] instanceof Choice
      ? (this._children[0] as Choice)
      : undefined
  }

  clone(): Placeholder {
    const ret = new Placeholder(this.index)
    if (this.transform) ret.transform = this.transform.clone()
    ret._children = this.children.map((child) => child.clone())
    return ret
  }
}

export class Choice extends Marker {
  readonly options: Text[] = []

  override appendChild(marker: Marker): this {
    if (marker instanceof Text) {
      marker.parent = this
      this.options.push(marker)
    }
    return this
  }

  override toString() {
    return this.options[0]?.value ?? ''
  }

  override len() {
    return this.options[0]?.len() ?? 0
  }

  clone(): Choice {
    const ret = new Choice()
    this.options.forEach((option) => ret.appendChild(option.clone()))
    return ret
  }
}

export class Transform extends Marker {
  regexp: RegExp = new RegExp('')

  resolve(value: string): string {
    let didMatch = false
    let ret = value.replace(this.regexp, (...args: unknown[]) => {
      didMatch = true
      return this._replace(args.slice(0, -2) as string[])
    })
    // A transform with an else-branch still produces output when nothing matched.
    if (!didMatch && this._children.some((child) => child instanceof FormatString && Boolean(child.elseValue))) {
      ret = this._replace([])
    }
    return ret
  }

  private _replace(groups: string[]): string {
    let ret = ''
    for (const marker of this._children) {
      if (marker instanceof FormatString) {
        ret += marker.resolve(groups[marker.index] || '')
      } else {
        ret += marker.toString()
      }
    }
    return ret
  }

  override toString() {
    return ''
  }

  clone(): Transform {
    const ret = new Transform()
    ret.regexp = new RegExp(this.regexp.source, (this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : ''))
    ret._children = this.children.map((child) => child.clone())
    return ret
  }
}

export class FormatString extends Marker {
  constructor(
    readonly index: number,
    readonly shorthandName?: string,
    readonly ifValue?: string,
    readonly elseValue?: string,
  ) {
    super()
  }

  resolve(value?: string): string {
    switch (this.shorthandName) {
      case 'upcase': return value ? value.toLocaleUpperCase() : ''
      case 'downcase': return value ? value.toLocaleLowerCase() : ''
      case 'capitalize': return value ? value[0].toLocaleUpperCase() + value.substr(1) : ''
      case 'pascalcase': return value ? toPascalCase(value) : ''
      case 'camelcase': return value ? toCamelCase(value) : ''
      default: break
    }
    if (value && typeof this.ifValue === 'string') return this.ifValue
    if (!value && typeof this.elseValue === 'string') return this.elseValue
    return value || ''
  }

  clone(): FormatString {
    return new FormatString(this.index, this.shorthandName, this.ifValue, this.elseValue)
  }
}

function words(value: string) {
  return value.match(/[a-z0-9]+/gi) ?? []
}
function toPascalCase(value: string) {
  const match = words(value)
  if (!match.length) return value
  return match.map((word) => word.charAt(0).toUpperCase() + word.substr(1)).join('')
}
function toCamelCase(value: string) {
  const match = words(value)
  if (!match.length) return value
  return match
    .map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() : word.charAt(0).toUpperCase()) + word.substr(1))
    .join('')
}

export class Variable extends TransformableMarker {
  constructor(public name: string) {
    super()
  }

  resolve(resolver: VariableResolver): boolean {
    let value = resolver(this.name)
    if (this.transform) value = this.transform.resolve(value ?? '')
    if (value !== undefined) {
      this._children = [new Text(value)]
      return true
    }
    return false
  }

  clone(): Variable {
    const ret = new Variable(this.name)
    if (this.transform) ret.transform = this.transform.clone()
    ret._children = this.children.map((child) => child.clone())
    return ret
  }
}

export type VariableResolver = (name: string) => string | undefined

function walk(markers: Marker[], visitor: (marker: Marker) => boolean) {
  const stack = [...markers]
  while (stack.length > 0) {
    const marker = stack.shift()!
    if (!visitor(marker)) break
    stack.unshift(...marker.children)
  }
}

export class TextmateSnippet extends Marker {
  private _placeholders?: { all: Placeholder[]; last?: Placeholder }

  get placeholderInfo() {
    if (!this._placeholders) {
      const all: Placeholder[] = []
      let last: Placeholder | undefined
      this.walk((candidate) => {
        if (candidate instanceof Placeholder) {
          all.push(candidate)
          last = !last || last.index < candidate.index ? candidate : last
        }
        return true
      })
      this._placeholders = { all, last }
    }
    return this._placeholders
  }

  get placeholders(): Placeholder[] {
    return this.placeholderInfo.all
  }

  /** Character offset of a marker within the rendered snippet text. */
  offset(marker: Marker): number {
    let pos = 0
    let found = false
    this.walk((candidate) => {
      if (candidate === marker) {
        found = true
        return false
      }
      pos += candidate.len()
      return true
    })
    return found ? pos : -1
  }

  fullLen(marker: Marker): number {
    let ret = 0
    walk([marker], (item) => {
      ret += item.len()
      return true
    })
    return ret
  }

  resolveVariables(resolver: VariableResolver): this {
    this.walk((candidate) => {
      if (candidate instanceof Variable && candidate.resolve(resolver)) this._placeholders = undefined
      return true
    })
    return this
  }

  override appendChild(child: Marker) {
    this._placeholders = undefined
    return super.appendChild(child)
  }

  override replace(child: Marker, others: Marker[]) {
    this._placeholders = undefined
    super.replace(child, others)
  }

  clone(): TextmateSnippet {
    const ret = new TextmateSnippet()
    ret._children = this.children.map((child) => child.clone())
    return ret
  }

  walk(visitor: (marker: Marker) => boolean) {
    walk(this.children, visitor)
  }
}

export class SnippetParser {
  private _scanner = new Scanner()
  private _token: Token = { type: TokenType.EOF, pos: 0, len: 0 }

  static escape(value: string) {
    return value.replace(/\$|}|\\/g, '\\$&')
  }

  /** The snippet's plain text, with every tabstop and variable stripped. */
  static asInsertText(value: string) {
    return new SnippetParser().parse(value).toString()
  }

  parse(value: string, insertFinalTabstop?: boolean, enforceFinalTabstop?: boolean): TextmateSnippet {
    const snippet = new TextmateSnippet()
    this.parseFragment(value, snippet)
    this.ensureFinalTabstop(snippet, enforceFinalTabstop ?? false, insertFinalTabstop ?? false)
    return snippet
  }

  parseFragment(value: string, snippet: TextmateSnippet): readonly Marker[] {
    const offset = snippet.children.length
    this._scanner.text(value)
    this._token = this._scanner.next()
    while (this._parse(snippet)) {
      // consume the whole template
    }

    // The first placeholder of an index that carries a value defines the value
    // for every other placeholder sharing that index.
    const defaults = new Map<number, Marker[] | undefined>()
    const incomplete: Placeholder[] = []
    snippet.walk((marker) => {
      if (marker instanceof Placeholder) {
        if (marker.isFinalTabstop) defaults.set(0, undefined)
        else if (!defaults.has(marker.index) && marker.children.length > 0) defaults.set(marker.index, marker.children)
        else incomplete.push(marker)
      }
      return true
    })

    const fillIn = (placeholder: Placeholder, stack: Set<number>) => {
      const values = defaults.get(placeholder.index)
      if (!values) return
      const clone = new Placeholder(placeholder.index)
      clone.transform = placeholder.transform
      for (const child of values) {
        const next = child.clone()
        clone.appendChild(next)
        if (next instanceof Placeholder && defaults.has(next.index) && !stack.has(next.index)) {
          stack.add(next.index)
          fillIn(next, stack)
          stack.delete(next.index)
        }
      }
      snippet.replace(placeholder, [clone])
    }

    const stack = new Set<number>()
    for (const placeholder of incomplete) fillIn(placeholder, stack)

    return snippet.children.slice(offset)
  }

  ensureFinalTabstop(snippet: TextmateSnippet, enforceFinalTabstop: boolean, insertFinalTabstop: boolean) {
    if (enforceFinalTabstop || (insertFinalTabstop && snippet.placeholders.length > 0)) {
      if (!snippet.placeholders.find((p) => p.index === 0)) snippet.appendChild(new Placeholder(0))
    }
  }

  private _accept(type?: TokenType): boolean
  private _accept(type: TokenType | undefined, value: true): string
  private _accept(type?: TokenType, value?: boolean): boolean | string {
    if (type === undefined || this._token.type === type) {
      const ret = !value ? true : this._scanner.tokenText(this._token)
      this._token = this._scanner.next()
      return ret
    }
    return false
  }

  private _backTo(token: Token): false {
    this._scanner.pos = token.pos + token.len
    this._token = token
    return false
  }

  private _until(type: TokenType): false | string {
    const start = this._token
    while (this._token.type !== type) {
      if (this._token.type === TokenType.EOF) return false
      if (this._token.type === TokenType.Backslash) {
        const next = this._scanner.next()
        if (next.type !== TokenType.Dollar && next.type !== TokenType.CurlyClose && next.type !== TokenType.Backslash) {
          return false
        }
      }
      this._token = this._scanner.next()
    }
    const value = this._scanner.value.substring(start.pos, this._token.pos).replace(/\\(\$|}|\\)/g, '$1')
    this._token = this._scanner.next()
    return value
  }

  private _parse(marker: Marker): boolean {
    return this._parseEscaped(marker)
      || this._parseTabstopOrVariableName(marker)
      || this._parseComplexPlaceholder(marker)
      || this._parseComplexVariable(marker)
      || this._parseAnything(marker)
  }

  private _parseEscaped(marker: Marker): boolean {
    let value = this._accept(TokenType.Backslash, true)
    if (value) {
      value = this._accept(TokenType.Dollar, true)
        || this._accept(TokenType.CurlyClose, true)
        || this._accept(TokenType.Backslash, true)
        || value
      marker.appendChild(new Text(value))
      return true
    }
    return false
  }

  private _parseTabstopOrVariableName(parent: Marker): boolean {
    let value = ''
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && (value = this._accept(TokenType.VariableName, true) || this._accept(TokenType.Int, true))
    if (!match) return this._backTo(token)
    parent.appendChild(/^\d+$/.test(value) ? new Placeholder(Number(value)) : new Variable(value))
    return true
  }

  private _parseComplexPlaceholder(parent: Marker): boolean {
    let index = ''
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && this._accept(TokenType.CurlyOpen)
      && (index = this._accept(TokenType.Int, true))
    if (!match) return this._backTo(token)

    const placeholder = new Placeholder(Number(index))

    if (this._accept(TokenType.Colon)) {
      for (;;) {
        if (this._accept(TokenType.CurlyClose)) {
          parent.appendChild(placeholder)
          return true
        }
        if (this._parse(placeholder)) continue
        // Unterminated: emit what we saw as literal text.
        parent.appendChild(new Text(`\${${index}:`))
        placeholder.children.forEach((child) => parent.appendChild(child))
        return true
      }
    }

    if (placeholder.index > 0 && this._accept(TokenType.Pipe)) {
      const choice = new Choice()
      for (;;) {
        if (this._parseChoiceElement(choice)) {
          if (this._accept(TokenType.Comma)) continue
          if (this._accept(TokenType.Pipe)) {
            placeholder.appendChild(choice)
            if (this._accept(TokenType.CurlyClose)) {
              parent.appendChild(placeholder)
              return true
            }
          }
        }
        return this._backTo(token)
      }
    }

    if (this._accept(TokenType.Forwardslash)) {
      if (this._parseTransform(placeholder)) {
        parent.appendChild(placeholder)
        return true
      }
      return this._backTo(token)
    }

    if (this._accept(TokenType.CurlyClose)) {
      parent.appendChild(placeholder)
      return true
    }

    return this._backTo(token)
  }

  private _parseChoiceElement(parent: Choice): boolean {
    const token = this._token
    const values: string[] = []
    for (;;) {
      if (this._token.type === TokenType.Comma || this._token.type === TokenType.Pipe) break
      let value = this._accept(TokenType.Backslash, true)
      if (value) {
        value = this._accept(TokenType.Comma, true)
          || this._accept(TokenType.Pipe, true)
          || this._accept(TokenType.Backslash, true)
          || value
      } else {
        value = this._accept(undefined, true)
      }
      if (!value) return this._backTo(token)
      values.push(value)
    }
    if (values.length === 0) return this._backTo(token)
    parent.appendChild(new Text(values.join('')))
    return true
  }

  private _parseComplexVariable(parent: Marker): boolean {
    let name = ''
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && this._accept(TokenType.CurlyOpen)
      && (name = this._accept(TokenType.VariableName, true))
    if (!match) return this._backTo(token)

    const variable = new Variable(name)

    if (this._accept(TokenType.Colon)) {
      for (;;) {
        if (this._accept(TokenType.CurlyClose)) {
          parent.appendChild(variable)
          return true
        }
        if (this._parse(variable)) continue
        parent.appendChild(new Text(`\${${name}:`))
        variable.children.forEach((child) => parent.appendChild(child))
        return true
      }
    }

    if (this._accept(TokenType.Forwardslash)) {
      if (this._parseTransform(variable)) {
        parent.appendChild(variable)
        return true
      }
      return this._backTo(token)
    }

    if (this._accept(TokenType.CurlyClose)) {
      parent.appendChild(variable)
      return true
    }

    return this._backTo(token)
  }

  private _parseTransform(parent: TransformableMarker): boolean {
    const transform = new Transform()
    let regexValue = ''
    let regexOptions = ''

    // /regex
    for (;;) {
      if (this._accept(TokenType.Forwardslash)) break
      let escaped = this._accept(TokenType.Backslash, true)
      if (escaped) {
        escaped = this._accept(TokenType.Forwardslash, true) || escaped
        regexValue += escaped
        continue
      }
      if (this._token.type !== TokenType.EOF) {
        regexValue += this._accept(undefined, true)
        continue
      }
      return false
    }

    // /format
    for (;;) {
      if (this._accept(TokenType.Forwardslash)) break
      let escaped = this._accept(TokenType.Backslash, true)
      if (escaped) {
        escaped = this._accept(TokenType.Forwardslash, true) || escaped
        transform.appendChild(new Text(escaped))
        continue
      }
      if (this._parseFormatString(transform) || this._parseAnything(transform)) continue
      return false
    }

    // /options}
    for (;;) {
      if (this._accept(TokenType.CurlyClose)) break
      if (this._token.type !== TokenType.EOF) {
        regexOptions += this._accept(undefined, true)
        continue
      }
      return false
    }

    try {
      transform.regexp = new RegExp(regexValue, regexOptions)
    } catch {
      // An invalid pattern must not take down the whole snippet.
      return false
    }
    parent.transform = transform
    return true
  }

  private _parseFormatString(parent: Transform): boolean {
    const token = this._token
    if (!this._accept(TokenType.Dollar)) return false

    let complex = false
    if (this._accept(TokenType.CurlyOpen)) complex = true

    const index = this._accept(TokenType.Int, true)
    if (!index) return this._backTo(token)

    if (!complex) {
      // $1
      parent.appendChild(new FormatString(Number(index)))
      return true
    }

    if (this._accept(TokenType.CurlyClose)) {
      // ${1}
      parent.appendChild(new FormatString(Number(index)))
      return true
    }

    if (!this._accept(TokenType.Colon)) return this._backTo(token)

    if (this._accept(TokenType.Forwardslash)) {
      // ${1:/upcase}
      const shorthand = this._accept(TokenType.VariableName, true)
      if (!shorthand || !this._accept(TokenType.CurlyClose)) return this._backTo(token)
      parent.appendChild(new FormatString(Number(index), shorthand))
      return true
    }

    if (this._accept(TokenType.Plus)) {
      // ${1:+if}
      const ifValue = this._until(TokenType.CurlyClose)
      if (ifValue === false) return this._backTo(token)
      parent.appendChild(new FormatString(Number(index), undefined, ifValue, undefined))
      return true
    }

    if (this._accept(TokenType.Dash)) {
      // ${1:-else}
      const elseValue = this._until(TokenType.CurlyClose)
      if (elseValue === false) return this._backTo(token)
      parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue))
      return true
    }

    if (this._accept(TokenType.QuestionMark)) {
      // ${1:?if:else}
      const ifValue = this._until(TokenType.Colon)
      if (ifValue === false) return this._backTo(token)
      const elseValue = this._until(TokenType.CurlyClose)
      if (elseValue === false) return this._backTo(token)
      parent.appendChild(new FormatString(Number(index), undefined, ifValue, elseValue))
      return true
    }

    // ${1:else}
    const elseValue = this._until(TokenType.CurlyClose)
    if (elseValue === false) return this._backTo(token)
    parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue))
    return true
  }

  private _parseAnything(marker: Marker): boolean {
    if (this._token.type !== TokenType.EOF) {
      marker.appendChild(new Text(this._scanner.tokenText(this._token)))
      this._accept(undefined)
      return true
    }
    return false
  }
}
