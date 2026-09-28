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
})

export const builtinBlocks: BlockDefinition[] = [
  onAppStart, onClick,
  uiButton, uiText, uiInput,
  logicIf, logicForEach, logicCompare, logicMath, logicLog,
  dataQuery, dataInsert, dataVariable, dataNumber,
  networkFetch,
  authSignUp, authSession,
  storageUpload,
]
