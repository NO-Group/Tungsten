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

import { defineBlock, type BlockDefinition } from './blockSchema'

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

const uiButton = defineBlock({
  type: 'ui.button',
  label: 'Button',
  category: 'UI',
  description: 'A button, rendered into the preview and the generated markup.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'text', label: 'Text', type: 'String', default: 'Submit', required: true },
    { id: 'id', label: 'Element id', type: 'String', default: 'submit' },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input }) => `render.button({ id: ${input('id')}, text: ${input('text')} })`,
  parse: parseOptions('render.button', { id: 'id', text: 'text' }),
})

const uiText = defineBlock({
  type: 'ui.text',
  label: 'Text',
  category: 'UI',
  description: 'A line of text.',
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'value', label: 'Value', type: 'Any', default: 'Hello', required: true },
  ],
  outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
  generate: ({ input }) => `render.text(${input('value')})`,
  parse: parseCall('render.text', ['value']),
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
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'value', label: 'Value', type: 'String' },
  ],
  generate: ({ input, symbol }) =>
    `const ${symbol} = render.input({ id: ${input('id')}, placeholder: ${input('placeholder')} })`,
  parse: parseOptions('render.input', { id: 'id', placeholder: 'placeholder' }),
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
    const match = /^for \(const [A-Za-z0-9_$]+ of (.*?)\) \{(\})?$/.exec(statement)
    if (!match) return undefined
    return { inputs: { list: match[1] }, opensBody: match[2] ? undefined : 'body' }
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
  generate: ({ input, symbol }) =>
    `const ${symbol} = await http.request({ url: ${input('url')}, method: ${input('method')}, body: ${input('body')} })`,
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
  uiButton, uiText, uiInput,
  logicIf, logicForEach, logicCompare, logicMath, logicLog,
  dataQuery, dataInsert, dataVariable, dataNumber,
  networkFetch,
  authSignUp, authOauth, authSession,
  storageUpload,
]
