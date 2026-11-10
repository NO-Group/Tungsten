/**
 * The blocks Tungsten ships with.
 *
 * Each one is a small, honest piece of TypeScript. The generators produce
 * code a person would be willing to own -- no runtime shim, no framework of
 * ours to learn -- because the text view is not a preview of the "real"
 * program, it *is* the program.
 *
 * Adding a block is adding an entry here, or in a plugin: same API either
 * way, which is what keeps the built-ins honest about the SDK.
 */

import { defineBlock, type BlockDefinition, type BlockNode, type Port } from './blockSchema'

/** A string the generator can safely drop into source. */
function quote(value: string): string {
  return JSON.stringify(value)
}

/**
 * Splits an argument list on the commas that are actually separators.
 *
 * `db.select("users", { id: 1 })` has two arguments, not three: commas
 * inside brackets or a string belong to the argument they sit in.
 */
export function splitArguments(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoteChar = ''
  let current = ''

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoteChar) {
      current += character
      if (character === quoteChar && text[index - 1] !== '\\') quoteChar = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quoteChar = character
      current += character
      continue
    }
    if ('([{'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  const last = current.trim()
  if (last) parts.push(last)
  return parts
}

/**
 * Reads `(left OP right)` back, respecting nesting and quotes.
 *
 * Splitting on the first operator found in the raw string would cut
 * `(items[a - 1] === "x - y")` in the wrong place twice over, so the scan
 * skips anything inside brackets or a string, exactly as `splitArguments`
 * does for commas.
 */
export function splitBinary(text: string, operators: string[]) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return undefined
  const inner = trimmed.slice(1, -1)

  let depth = 0
  let quoteChar = ''
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]
    if (quoteChar) {
      if (character === quoteChar && inner[index - 1] !== '\\') quoteChar = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quoteChar = character; continue }
    if ('([{'.includes(character)) { depth += 1; continue }
    if (')]}'.includes(character)) { depth -= 1; continue }
    if (depth !== 0) continue
    for (const operator of operators) {
      if (!inner.startsWith(` ${operator} `, index)) continue
      const left = inner.slice(0, index).trim()
      const right = inner.slice(index + operator.length + 2).trim()
      if (!left || !right) return undefined
      return { left, operator, right }
    }
  }
  return undefined
}

/** The arguments of `callee(...)`, or undefined when the text is something else. */
function callArguments(statement: string, callee: string): string[] | undefined {
  if (!statement.startsWith(`${callee}(`) || !statement.endsWith(')')) return undefined
  return splitArguments(statement.slice(callee.length + 1, -1))
}

/** The `{ key: value }` pairs of an object literal argument. */
function objectFields(text: string): Record<string, string> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  const fields: Record<string, string> = {}
  for (const entry of splitArguments(trimmed.slice(1, -1))) {
    const colon = entry.indexOf(':')
    if (colon < 0) continue
    fields[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim()
  }
  return fields
}

/** Builds a parser for a call whose arguments are positional. */
function parseCall(callee: string, ports: string[]) {
  return (statement: string) => {
    const args = callArguments(statement, callee)
    if (!args) return undefined
    const inputs: Record<string, string> = {}
    ports.forEach((port, index) => {
      if (args[index] !== undefined) inputs[port] = args[index]
    })
    return { inputs }
  }
}

/** Builds a parser for a call taking a single options object. */
function parseOptions(callee: string, ports: Record<string, string>) {
  return (statement: string) => {
    const args = callArguments(statement, callee)
    const fields = args?.length === 1 ? objectFields(args[0]) : undefined
    if (!fields) return undefined
    const inputs: Record<string, string> = {}
    for (const [key, port] of Object.entries(ports)) {
      if (fields[key] !== undefined) inputs[port] = fields[key]
    }
    return { inputs }
  }
}

// ---------------------------------------------------------------- Events

const onAppStart = defineBlock({
  type: 'event.start',
  label: 'On App Start',
  category: 'Events',
  description: 'Runs once, as soon as the application loads.',
  isEvent: true,
  inputs: [],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: () => '',
})

const onClick = defineBlock({
  type: 'event.click',
  label: 'On Click',
  category: 'Events',
  description: 'Runs when the named element is clicked.',
  isEvent: true,
  inputs: [{ id: 'target', label: 'Element id', type: 'String', default: 'submit', required: true }],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: () => '',
})

// -------------------------------------------------------------------- UI

/**
 * The style properties every visual block carries.
 *
 * They are ports marked `property`, so the inspector edits them, the
 * generator writes them, the parser reads them back and undo covers them --
 * with no new state anywhere. Colours are Graphene token names rather than
 * hex, so a generated app re-themes with the design system instead of
 * freezing today's palette into the source.
 */
const STYLE_PORTS: Port[] = [
  { id: 'radius', label: 'Corner radius', type: 'Number', default: 6, property: true },
  { id: 'padding', label: 'Padding', type: 'String', default: '', property: true },
  { id: 'background', label: 'Background', type: 'String', default: '', property: true },
  { id: 'color', label: 'Text colour', type: 'String', default: '', property: true },
  { id: 'width', label: 'Width', type: 'String', default: '', property: true },
  { id: 'align', label: 'Align', type: 'String', default: '', property: true },
]

const STYLE_KEYS = STYLE_PORTS.map((port) => port.id)

/** Every style port, as a parser map. The same six on every visual block. */
const STYLE_MAP = Object.fromEntries(STYLE_KEYS.map((key) => [key, key]))

/** Reads `key: value, key: value` back into raw expression text per key. */
function readOptions(text: string, extra: string[] = []): Record<string, string> {
  const wanted = [...STYLE_KEYS, ...extra]
  const found: Record<string, string> = {}
  for (const part of splitArguments(text)) {
    const at = part.indexOf(':')
    if (at < 0) continue
    const key = part.slice(0, at).trim()
    if (wanted.includes(key)) found[key] = part.slice(at + 1).trim()
  }
  return found
}

/**
 * The style fragment for a generated call.
 *
 * Only what differs from the default is written. A file full of
 * `radius: 6, padding: "", background: ""` is noise, and the round trip
 * stays stable because the comparison is against the default rather than
 * against "was it ever set".
 */
function styleFragment(node: BlockNode): string {
  const parts: string[] = []
  for (const port of STYLE_PORTS) {
    const value = node.values[port.id]
    if (value === undefined || value === '' || value === port.default) continue
    parts.push(`${port.id}: ${typeof value === 'number' ? value : quote(String(value))}`)
  }
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/**
 * A heading level, clamped to the six that exist.
 *
 * Written unconditionally rather than only when it differs from the
 * default, because `level` is what every renderer switches on and a
 * missing one would have each of them inventing its own fallback.
 */
function headingLevel(node: BlockNode): number {
  const raw = Number(node.values.level ?? 2)
  if (!Number.isFinite(raw)) return 2
  return Math.min(6, Math.max(1, Math.round(raw)))
}

const uiButton = defineBlock({
  type: 'ui.button',
  label: 'Button',
  category: 'UI',
  description: 'A button, rendered into the preview and the generated markup.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'text', label: 'Text', type: 'String', default: 'Submit', required: true },
    { id: 'id', label: 'Element id', type: 'String', default: 'submit' },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.button({ id: ${input('id')}, text: ${input('text')}${styleFragment(node)} })`,
  parse: parseOptions('render.button', { id: 'id', text: 'text', ...STYLE_MAP }),
})

/**
 * A stack: the container everything else sits in.
 *
 * One block rather than separate Row and Column blocks, because they are
 * the same box with one property different, and a palette that says
 * otherwise teaches people that they are not.
 *
 * It opens a body, exactly as a loop or a branch does, so nesting comes
 * from the machinery the canvas already has.
 */
const uiStack = defineBlock({
  type: 'ui.stack',
  label: 'Stack',
  category: 'UI',
  description: 'A row or a column. Blocks inside it are laid out within it.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'stack' },
    { id: 'direction', label: 'Direction', type: 'String', default: 'column', property: true },
    { id: 'gap', label: 'Gap', type: 'Number', default: 10, property: true },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  slots: [{ id: 'children', label: 'Inside', type: 'Exec' }],
  generate: ({ input, node, body, symbol, indent }) => {
    void symbol
    const inside = body('children')
    const direction = String(node.values.direction ?? 'column') === 'row' ? 'row' : 'column'
    const gap = Number(node.values.gap ?? 10)
    const options = `{ id: ${input('id')}, direction: ${quote(direction)}, gap: ${gap}${styleFragment(node)} }`
    return inside
      ? `await render.stack(${options}, async () => {\n${inside}\n${indent}})`
      : `await render.stack(${options}, async () => {})`
  },
  parse: (statement) => {
    const match = /^await render\.stack\(\{ (.*) \}, async \(\) => \{(\})?\)?$/.exec(statement)
      ?? /^await render\.stack\(\{ (.*) \}, async \(\) => \{\}\)$/.exec(statement)
    if (!match) return undefined
    const options = readOptions(match[1], ['id', 'direction', 'gap'])
    const empty = statement.endsWith('{})')
    return { inputs: options, opensBody: empty ? undefined : 'children' }
  },
})

const uiText = defineBlock({
  type: 'ui.text',
  label: 'Text',
  category: 'UI',
  description: 'A line of text.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'value', label: 'Value', type: 'Any', default: 'Hello', required: true },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) => {
    const style = styleFragment(node)
    // Styles arrive as a second argument only when there are any, so an
    // unstyled line of text still generates `render.text(value)`.
    return style
      ? `render.text(${input('value')}, {${style.slice(1)} })`
      : `render.text(${input('value')})`
  },
  parse: (statement) => {
    // The styled form is checked first. The plain reader takes the first
    // argument and ignores the rest, so trying it first would parse a
    // styled call successfully and quietly drop every style on it.
    const match = /^render\.text\((.*), \{ (.*) \}\)$/.exec(statement)
    if (match) return { inputs: { value: match[1], ...readOptions(match[2]) } }
    return parseCall('render.text', ['value'])(statement)
  },
})

const uiInput = defineBlock({
  type: 'ui.input',
  label: 'Text Input',
  category: 'UI',
  description: 'A text field. Its value can be read by other blocks.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'email', required: true },
    { id: 'placeholder', label: 'Placeholder', type: 'String', default: '' },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node, symbol }) =>
    `const ${symbol} = render.input({ id: ${input('id')}, placeholder: ${input('placeholder')}${styleFragment(node)} })`,
  parse: parseOptions('render.input', { id: 'id', placeholder: 'placeholder', ...STYLE_MAP }),
})

/**
 * Reading a field is deliberately a separate block.
 *
 * An input is drawn once, at start-up, and read later from a click handler
 * -- a different function, where the variable the input block bound is not
 * in scope. Reading by element id has no scope at all, so the obvious graph
 * is also the correct one.
 */
const uiValue = defineBlock({
  type: 'ui.value',
  label: 'Input Value',
  category: 'UI',
  description: 'What the user has typed into a field, read by element id.',
  inputs: [{ id: 'id', label: 'Element id', type: 'String', default: 'email', required: true }],
  outputs: [{ id: 'value', label: 'Value', type: 'String' }],
  generate: ({ input }) => `render.value(${input('id')})`,
  parse: parseCall('render.value', ['id']),
})

/**
 * A heading.
 *
 * Deliberately not "a Text block with a bigger font". A level is semantic
 * and every target has somewhere real to put it -- `<h2>` on the web,
 * `headlineMedium` in Compose, `.title` in SwiftUI, a weighted TextStyle in
 * Flutter. Faking one with a font size throws that away on all four, and
 * takes the document outline and the screen reader with it.
 */
const uiHeading = defineBlock({
  type: 'ui.heading',
  label: 'Heading',
  category: 'UI',
  description: 'A heading. Its level is semantic, not a font size.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'title' },
    { id: 'text', label: 'Text', type: 'Any', default: 'Heading', required: true },
    { id: 'level', label: 'Level (1-6)', type: 'Number', default: 2, property: true },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.heading({ id: ${input('id')}, text: ${input('text')}, level: ${headingLevel(node)}${styleFragment(node)} })`,
  parse: parseOptions('render.heading', { id: 'id', text: 'text', level: 'level', ...STYLE_MAP }),
})

/**
 * An image.
 *
 * The source defaults to empty rather than to some stock photograph on a
 * host that may not be reachable: an empty source draws a labelled
 * placeholder, which is honest about there being no picture yet and works
 * with the network off.
 */
const uiImage = defineBlock({
  type: 'ui.image',
  label: 'Image',
  category: 'UI',
  description: 'A picture, from a URL. An empty source draws a placeholder.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'image' },
    { id: 'src', label: 'Source URL', type: 'String', default: '', required: true },
    { id: 'alt', label: 'Alt text', type: 'String', default: 'Image' },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.image({ id: ${input('id')}, src: ${input('src')}, alt: ${input('alt')}${styleFragment(node)} })`,
  parse: parseOptions('render.image', { id: 'id', src: 'src', alt: 'alt', ...STYLE_MAP }),
})

/**
 * A checkbox.
 *
 * Its state is read by the Input Value block, exactly as a text field is,
 * and arrives as the string "true" or "false". One way to read what the
 * user did beats a second block that exists only because the control is a
 * different shape.
 */
const uiCheckbox = defineBlock({
  type: 'ui.checkbox',
  label: 'Checkbox',
  category: 'UI',
  description: 'A box to tick. Read it with Input Value; it answers "true" or "false".',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'agree', required: true },
    { id: 'label', label: 'Label', type: 'String', default: 'I agree' },
    { id: 'checked', label: 'Ticked to start', type: 'Boolean', default: false, property: true },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.checkbox({ id: ${input('id')}, label: ${input('label')}, checked: ${
      node.values.checked === true ? 'true' : 'false'
    }${styleFragment(node)} })`,
  parse: parseOptions('render.checkbox', { id: 'id', label: 'label', checked: 'checked', ...STYLE_MAP }),
})

/**
 * A dropdown.
 *
 * The choices are one comma-separated string rather than a list port,
 * because every alternative was worse: a list port needs a block to build
 * the list, and a repeated port needs inspector machinery no other block
 * would use. Splitting on commas is a rule a person can hold in their head.
 */
const uiSelect = defineBlock({
  type: 'ui.select',
  label: 'Dropdown',
  category: 'UI',
  description: 'A list of choices, comma separated. Read it with Input Value.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'choice', required: true },
    { id: 'options', label: 'Choices', type: 'String', default: 'One, Two, Three', required: true },
    { id: 'value', label: 'Selected', type: 'String', default: '' },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.select({ id: ${input('id')}, options: ${input('options')}, value: ${input('value')}${styleFragment(node)} })`,
  parse: parseOptions('render.select', { id: 'id', options: 'options', value: 'value', ...STYLE_MAP }),
})

/**
 * A link out of the app.
 *
 * Going to another screen is the Go To Screen block; this is for leaving.
 * Keeping them apart means the generated code never has to guess whether
 * "/pricing" meant a screen or a URL -- on a phone, where one is a view
 * change and the other opens the browser, guessing wrong is very visible.
 */
const uiLink = defineBlock({
  type: 'ui.link',
  label: 'Link',
  category: 'UI',
  description: 'Opens a URL outside the app. Use Go To Screen to move within it.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'link' },
    { id: 'text', label: 'Text', type: 'String', default: 'Learn more', required: true },
    { id: 'href', label: 'URL', type: 'String', default: 'https://example.com', required: true },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) =>
    `render.link({ id: ${input('id')}, text: ${input('text')}, href: ${input('href')}${styleFragment(node)} })`,
  parse: parseOptions('render.link', { id: 'id', text: 'text', href: 'href', ...STYLE_MAP }),
})

/** A rule between sections. */
const uiDivider = defineBlock({
  type: 'ui.divider',
  label: 'Divider',
  category: 'UI',
  description: 'A horizontal rule.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'id', label: 'Element id', type: 'String', default: 'divider' },
    ...STYLE_PORTS,
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) => `render.divider({ id: ${input('id')}${styleFragment(node)} })`,
  parse: parseOptions('render.divider', { id: 'id', ...STYLE_MAP }),
})

// ----------------------------------------------------------------- Logic

const logicIf = defineBlock({
  type: 'logic.if',
  label: 'If',
  category: 'Logic',
  description: 'Runs the blocks inside it only when the condition holds.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'condition', label: 'Condition', type: 'Boolean', default: true, required: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  slots: [
    { id: 'body', label: 'Do', type: 'Exec' },
    { id: 'else', label: 'Otherwise', type: 'Exec' },
  ],
  generate: ({ input, body, indent }) => {
    // An empty branch closes on the same line: a blank body should read as
    // "nothing happens here", not as a gap in the file.
    const block = (lines: string) => (lines ? `{\n${lines}\n${indent}}` : '{}')
    const otherwise = body('else')
    const head = `if (${input('condition')}) ${block(body('body'))}`
    return otherwise ? `${head} else ${block(otherwise)}` : head
  },
  parse: (statement) => {
    // Three shapes reach here: an open branch, an empty one, and an empty
    // one whose “otherwise” is where the blocks actually are.
    const match = /^if \((.*?)\) \{(\}( else \{)?)?$/.exec(statement)
    if (!match) return undefined
    const empty = Boolean(match[2])
    const otherwise = Boolean(match[3])
    return {
      inputs: { condition: match[1] },
      opensBody: otherwise ? 'else' : empty ? undefined : 'body',
      elseSlot: otherwise ? undefined : 'else',
    }
  },
})

const logicForEach = defineBlock({
  type: 'logic.forEach',
  label: 'For Each',
  category: 'Logic',
  description: 'Runs the blocks inside it once per item in a list.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'list', label: 'List', type: 'List', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'item', label: 'Item', type: 'Any' },
  ],
  slots: [{ id: 'body', label: 'Do', type: 'Exec' }],
  generate: ({ input, body, symbol, indent }) => {
    const lines = body('body')
    return `for (const ${symbol} of ${input('list')}) ${lines ? `{\n${lines}\n${indent}}` : '{}'}`
  },
  parse: (statement) => {
    const match = /^for \(const ([A-Za-z0-9_$]+) of (.*?)\) \{(\})?$/.exec(statement)
    if (!match) return undefined
    // The loop variable is this block's Item output. Naming it here is what
    // lets the blocks inside the loop read the item back after a round trip.
    return { inputs: { list: match[2] }, binds: match[1], opensBody: match[3] ? undefined : 'body' }
  },
})

const logicCompare = defineBlock({
  type: 'logic.compare',
  label: 'Compare',
  category: 'Logic',
  description: 'Compares two values and reports whether the test passes.',
  inputs: [
    { id: 'left', label: 'Left', type: 'Any', required: true },
    { id: 'operator', label: 'Operator', type: 'String', default: '===' },
    { id: 'right', label: 'Right', type: 'Any', required: true },
  ],
  outputs: [{ id: 'result', label: 'Result', type: 'Boolean' }],
  generate: ({ node, input }) => {
    // The operator is a literal choice, not an expression: it is never
    // interpolated from a connected block, so generated code cannot be
    // steered into something other than a comparison.
    const allowed = ['===', '!==', '<', '<=', '>', '>=']
    const raw = String(node.values.operator ?? '===')
    const operator = allowed.includes(raw) ? raw : '==='
    return `(${input('left')} ${operator} ${input('right')})`
  },
  // Longest first: `<=` must win over `<`, or the halves come out wrong.
  parse: (statement) => {
    const split = splitBinary(statement, ['===', '!==', '<=', '>=', '<', '>'])
    return split && { inputs: { left: split.left, operator: `"${split.operator}"`, right: split.right } }
  },
})

const logicMath = defineBlock({
  type: 'logic.math',
  label: 'Math',
  category: 'Logic',
  description: 'Adds, subtracts, multiplies or divides two numbers.',
  inputs: [
    { id: 'left', label: 'Left', type: 'Number', default: 0, required: true },
    { id: 'operator', label: 'Operator', type: 'String', default: '+' },
    { id: 'right', label: 'Right', type: 'Number', default: 0, required: true },
  ],
  outputs: [{ id: 'result', label: 'Result', type: 'Number' }],
  generate: ({ node, input }) => {
    const allowed = ['+', '-', '*', '/', '%']
    const raw = String(node.values.operator ?? '+')
    const operator = allowed.includes(raw) ? raw : '+'
    return `(${input('left')} ${operator} ${input('right')})`
  },
  parse: (statement) => {
    const split = splitBinary(statement, ['+', '-', '*', '/', '%'])
    return split && { inputs: { left: split.left, operator: `"${split.operator}"`, right: split.right } }
  },
})

const logicExists = defineBlock({
  type: 'logic.exists',
  label: 'Has a Value',
  category: 'Logic',
  description: 'True when a value is present: not null, not undefined.',
  inputs: [{ id: 'value', label: 'Value', type: 'Any', required: true }],
  outputs: [{ id: 'result', label: 'Result', type: 'Boolean' }],
  // `!= null` rather than `!== null` on purpose: it is the one place loose
  // equality is the right tool, because it catches undefined as well.
  generate: ({ input }) => `(${input('value')} != null)`,
  parse: (statement) => {
    const split = splitBinary(statement, ['!='])
    return split && split.right === 'null' ? { inputs: { value: split.left } } : undefined
  },
})

const logicLog = defineBlock({
  type: 'logic.log',
  label: 'Log',
  category: 'Logic',
  description: 'Writes a value to the console.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'value', label: 'Value', type: 'Any', default: 'Hello', required: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input }) => `console.log(${input('value')})`,
  parse: parseCall('console.log', ['value']),
})

// ------------------------------------------------------------------ Data

// ------------------------------------------------------------- App state

const stateGet = defineBlock({
  type: 'state.get',
  label: 'Read Variable',
  category: 'Data',
  description: 'The current value of an app or page variable.',
  inputs: [{ id: 'name', label: 'Variable', type: 'String', default: '', required: true, property: true }],
  outputs: [{ id: 'value', label: 'Value', type: 'Any' }],
  // Pure: it reads, it does not occupy a step, and it can be wired into
  // anything that takes a value -- including a component's own properties.
  generate: ({ node }) => `state.get(${quote(String(node.values.name ?? ''))})`,
  parse: (statement) => {
    const match = /^state\.get\("([A-Za-z0-9_]*)"\)$/.exec(statement)
    return match ? { inputs: { name: `"${match[1]}"` } } : undefined
  },
})

const stateSet = defineBlock({
  type: 'state.set',
  label: 'Set Variable',
  category: 'Data',
  description: 'Stores a value in an app or page variable.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'name', label: 'Variable', type: 'String', default: '', required: true, property: true },
    { id: 'value', label: 'Value', type: 'Any', default: '', required: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input, node }) => `state.set(${quote(String(node.values.name ?? ''))}, ${input('value')})`,
  parse: (statement) => {
    const match = /^state\.set\("([A-Za-z0-9_]*)", (.*)\)$/.exec(statement)
    return match ? { inputs: { name: `"${match[1]}"`, value: match[2] } } : undefined
  },
})

// ------------------------------------------------------------ Navigation

const navGo = defineBlock({
  type: 'nav.go',
  label: 'Go To Screen',
  category: 'Navigation',
  description: 'Leaves this screen and opens another one.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'screen', label: 'Screen', type: 'String', default: '', required: true, property: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  // A property rather than a socket, like a variable name: the screen is
  // chosen from the ones that exist, and the checker can tell you when the
  // one you chose no longer does.
  generate: ({ node }) => `app.goTo(${quote(String(node.values.screen ?? ''))})`,
  parse: (statement) => {
    const match = /^app\.goTo\("([a-z0-9-]*)"\)$/.exec(statement)
    return match ? { inputs: { screen: `"${match[1]}"` } } : undefined
  },
})

const navBack = defineBlock({
  type: 'nav.back',
  label: 'Go Back',
  category: 'Navigation',
  description: 'Returns to the screen the user came from.',
  inputs: [{ id: 'exec', label: 'Run', type: 'Exec' }],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: () => 'app.back()',
  parse: (statement) => (statement === 'app.back()' ? { inputs: {} } : undefined),
})

const navCurrent = defineBlock({
  type: 'nav.current',
  label: 'Current Screen',
  category: 'Navigation',
  description: 'The name of the screen being shown.',
  inputs: [],
  outputs: [{ id: 'name', label: 'Name', type: 'String' }],
  generate: () => 'app.currentScreen()',
  parse: (statement) => (statement === 'app.currentScreen()' ? { inputs: {} } : undefined),
})

const dataQuery = defineBlock({
  type: 'data.query',
  label: 'Query Table',
  category: 'Data',
  description: 'Reads rows from a table. Runs asynchronously.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'table', label: 'Table', type: 'String', default: 'users', required: true },
    { id: 'where', label: 'Where', type: 'Object' },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'rows', label: 'Rows', type: 'List' },
  ],
  generate: ({ input, symbol, node }) => {
    const where = node.values.where !== undefined || input('where') !== 'undefined'
      ? `, ${input('where')}`
      : ''
    return `const ${symbol} = await db.select(${input('table')}${where})`
  },
  parse: parseCall('await db.select', ['table', 'where']),
})

const dataInsert = defineBlock({
  type: 'data.insert',
  label: 'Insert Row',
  category: 'Data',
  description: 'Writes a row to a table. Runs asynchronously.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'table', label: 'Table', type: 'String', default: 'users', required: true },
    { id: 'row', label: 'Row', type: 'Object', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'saved', label: 'Saved row', type: 'Object' },
  ],
  generate: ({ input, symbol }) => `const ${symbol} = await db.insert(${input('table')}, ${input('row')})`,
  parse: parseCall('await db.insert', ['table', 'row']),
})

const dataUpdate = defineBlock({
  type: 'data.update',
  label: 'Update Row',
  category: 'Data',
  description: 'Changes the fields you give, on one row. Runs asynchronously.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'table', label: 'Table', type: 'String', default: 'users', required: true },
    { id: 'id', label: 'Row id', type: 'String', required: true },
    { id: 'changes', label: 'Changes', type: 'Object', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'saved', label: 'Saved row', type: 'Object' },
  ],
  generate: ({ input, symbol }) => (
    `const ${symbol} = await db.update(${input('table')}, ${input('id')}, ${input('changes')})`
  ),
  parse: parseCall('await db.update', ['table', 'id', 'changes']),
})

const dataRemove = defineBlock({
  type: 'data.remove',
  label: 'Delete Row',
  category: 'Data',
  description: 'Removes one row by id. Runs asynchronously.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'table', label: 'Table', type: 'String', default: 'users', required: true },
    { id: 'id', label: 'Row id', type: 'String', required: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input }) => `await db.remove(${input('table')}, ${input('id')})`,
  parse: parseCall('await db.remove', ['table', 'id']),
})

const dataVariable = defineBlock({
  type: 'data.text',
  label: 'Text Value',
  category: 'Data',
  description: 'A fixed piece of text.',
  inputs: [{ id: 'value', label: 'Value', type: 'String', default: '' }],
  outputs: [{ id: 'value', label: 'Value', type: 'String' }],
  generate: ({ node }) => quote(String(node.values.value ?? '')),
})

const dataNumber = defineBlock({
  type: 'data.number',
  label: 'Number Value',
  category: 'Data',
  description: 'A fixed number.',
  inputs: [{ id: 'value', label: 'Value', type: 'Number', default: 0 }],
  outputs: [{ id: 'value', label: 'Value', type: 'Number' }],
  generate: ({ node }) => {
    const value = Number(node.values.value ?? 0)
    return Number.isFinite(value) ? String(value) : '0'
  },
})

// --------------------------------------------------------------- Network

const networkFetch = defineBlock({
  type: 'network.fetch',
  label: 'HTTP Request',
  category: 'Network',
  description: 'Calls an HTTP endpoint and reads the response as JSON.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'url', label: 'URL', type: 'String', default: 'https://api.example.com', required: true },
    { id: 'method', label: 'Method', type: 'String', default: 'GET' },
    { id: 'body', label: 'Body', type: 'Object' },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'response', label: 'Response', type: 'Object' },
  ],
  generate: ({ input, node, symbol }) => {
    // An unset body is left out rather than written as `undefined`: the
    // generated file is something people read, and `body: undefined` reads
    // like a bug even though it runs.
    const body = node.values.body === undefined ? '' : `, body: ${input('body')}`
    return `const ${symbol} = await http.request({ url: ${input('url')}, method: ${input('method')}${body} })`
  },
  parse: parseOptions('await http.request', { url: 'url', method: 'method', body: 'body' }),
})

// ------------------------------------------------------------------ Auth

const authSignUp = defineBlock({
  type: 'auth.signUp',
  label: 'Sign Up with Email',
  category: 'Auth',
  description: 'Creates an account and starts a session.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'email', label: 'Email', type: 'String', required: true },
    { id: 'password', label: 'Password', type: 'String', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'user', label: 'User', type: 'Object' },
  ],
  generate: ({ input, symbol }) => `const ${symbol} = await auth.signUp(${input('email')}, ${input('password')})`,
  parse: parseCall('await auth.signUp', ['email', 'password']),
})

const authSignIn = defineBlock({
  type: 'auth.signIn',
  label: 'Sign In with Email',
  category: 'Auth',
  description: 'Starts a session for an account that already exists.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'email', label: 'Email', type: 'String', required: true },
    { id: 'password', label: 'Password', type: 'String', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'user', label: 'User', type: 'Object' },
  ],
  generate: ({ input, symbol }) => `const ${symbol} = await auth.signIn(${input('email')}, ${input('password')})`,
  parse: parseCall('await auth.signIn', ['email', 'password']),
})

const authSignOut = defineBlock({
  type: 'auth.signOut',
  label: 'Sign Out',
  category: 'Auth',
  description: 'Forgets the session, here and on the backend.',
  isAsync: true,
  inputs: [{ id: 'exec', label: 'Run', type: 'Exec' }],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: () => 'await auth.signOut()',
  parse: parseCall('await auth.signOut', []),
})

const authOauth = defineBlock({
  type: 'auth.oauth',
  label: 'Sign In with Provider',
  category: 'Auth',
  description: 'Starts an OAuth sign-in with Google, GitHub or Apple.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'provider', label: 'Provider', type: 'String', default: 'google', required: true },
    { id: 'redirect', label: 'Redirect to', type: 'String', default: '/' },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'user', label: 'User', type: 'Object' },
  ],
  generate: ({ input, symbol, node }) => {
    // The provider is a fixed choice rather than an expression: an OAuth
    // provider interpolated from a connected block is a redirect waiting to
    // be pointed somewhere it should not go.
    const allowed = ['google', 'github', 'apple', 'microsoft']
    const raw = String(node.values.provider ?? 'google').toLowerCase()
    const provider = allowed.includes(raw) ? raw : 'google'
    return `const ${symbol} = await auth.oauth(${quote(provider)}, { redirectTo: ${input('redirect')} })`
  },
  parse: (statement) => {
    const match = /^await auth\.oauth\("([a-z]+)", \{ redirectTo: (.*) \}\)$/.exec(statement)
    return match ? { inputs: { provider: `"${match[1]}"`, redirect: match[2] } } : undefined
  },
})

const authSession = defineBlock({
  type: 'auth.session',
  label: 'Current Session',
  category: 'Auth',
  description: 'The signed-in user, or null.',
  isAsync: true,
  inputs: [{ id: 'exec', label: 'Run', type: 'Exec' }],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'user', label: 'User', type: 'Object' },
  ],
  generate: ({ symbol }) => `const ${symbol} = await auth.session()`,
  parse: parseCall('await auth.session', []),
})

// --------------------------------------------------------------- Storage

const storageUpload = defineBlock({
  type: 'storage.upload',
  label: 'Upload File',
  category: 'Storage',
  description: 'Stores a file and reports its URL.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'bucket', label: 'Bucket', type: 'String', default: 'uploads', required: true },
    { id: 'file', label: 'File', type: 'Object', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'url', label: 'URL', type: 'String' },
  ],
  generate: ({ input, symbol }) => `const ${symbol} = await storage.upload(${input('bucket')}, ${input('file')})`,
  parse: parseCall('await storage.upload', ['bucket', 'file']),
})

export const builtinBlocks: BlockDefinition[] = [
  onAppStart, onClick,
  uiButton, uiText, uiInput, uiValue, uiStack,
  uiHeading, uiImage, uiCheckbox, uiSelect, uiLink, uiDivider,
  navGo, navBack, navCurrent,
  logicIf, logicForEach, logicCompare, logicMath, logicExists, logicLog,
  dataQuery, dataInsert, dataUpdate, dataRemove, dataVariable, dataNumber,
  stateGet, stateSet,
  networkFetch,
  authSignUp, authSignIn, authSignOut, authOauth, authSession,
  storageUpload,
]
