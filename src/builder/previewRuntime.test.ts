/**
 * The preview, actually run.
 *
 * Every other test about the sandbox asserts on the document it produces,
 * which proves nothing about whether the program inside it works. This one
 * executes the document in a real DOM with scripts enabled, clicks the
 * button, and reads what comes back over the message channel -- so "clicks
 * work without a build" is a thing that has happened rather than a claim.
 */

import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, type BlockGraph } from './blockSchema'
import { addNode, connect, createNode, resetIds, setNodeValue } from './graph'
import { generateProgram } from './codeGenerator'
import { schemaFromGraph } from './uiSchema'
import { previewHtml, PREVIEW_CHANNEL, type PreviewMessage } from './previewRuntime'
import { nodeAtLine } from './codeGenerator'
import { parseProgram } from './codeParser'

const registry = createRegistry(builtinBlocks)

function build(
  nodes: Array<[type: string]>,
  links: Array<[from: number, fromPort: string, to: number, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const [type] of nodes) {
    const node = createNode(type, { x: 0, y: ids.length * 100 })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  for (const [from, fromPort, to, toPort] of links) {
    const result = connect(graph, registry, { node: ids[from], port: fromPort }, { node: ids[to], port: toPort })
    if (result.rejected) throw new Error(result.rejected)
    graph = result.graph
  }
  return { graph, ids }
}

/** Loads a graph's preview into a real DOM and collects what it says. */
async function run(graph: BlockGraph) {
  const code = generateProgram(graph, registry).code
  const html = previewHtml({ document: schemaFromGraph(graph, registry), code })

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
  const messages: PreviewMessage[] = []
  dom.window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as PreviewMessage & { channel?: string }
    if (data?.channel === PREVIEW_CHANNEL) messages.push(data)
  })

  // Scripts run on load; messages arrive on the task queue after that.
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { dom, messages, code }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => resetIds())

describe('the preview, executed', () => {
  it('renders the interface and reports that it started', async () => {
    const { graph, ids } = build([['ui.button'], ['event.start']], [[1, 'exec', 0, 'exec']])
    const named = setNodeValue(setNodeValue(graph, ids[0], 'id', 'save'), ids[0], 'text', 'Save it')

    const { dom, messages } = await run(named)
    const button = dom.window.document.getElementById('save')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('Save it')
    expect(messages.some((message) => message.kind === 'ready')).toBe(true)
  })

  it('runs the start handler on load', async () => {
    const { graph, ids } = build([['event.start'], ['logic.log']], [[0, 'exec', 1, 'exec']])
    const { messages } = await run(setNodeValue(graph, ids[1], 'value', 'started'))
    expect(messages).toContainEqual(expect.objectContaining({ kind: 'log', text: 'started' }))
  })

  it('runs the click handler when the button is clicked', async () => {
    const { graph, ids } = build(
      [['ui.button'], ['event.start'], ['event.click'], ['logic.log']],
      [[1, 'exec', 0, 'exec'], [2, 'exec', 3, 'exec']],
    )
    const wired = setNodeValue(
      setNodeValue(setNodeValue(graph, ids[0], 'id', 'save'), ids[2], 'target', 'save'),
      ids[3],
      'value',
      'clicked',
    )

    const { dom, messages } = await run(wired)
    expect(messages.some((message) => message.kind === 'log' && message.text === 'clicked')).toBe(false)

    dom.window.document.getElementById('save')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle()

    expect(messages).toContainEqual(expect.objectContaining({ kind: 'log', text: 'clicked' }))
  })

  it('reads what the user typed into an input', async () => {
    // The field is drawn at start-up and read from a click handler: two
    // different functions, which is why reading is by element id rather than
    // through a variable that would not be in scope.
    const { graph, ids } = build(
      [['ui.input'], ['ui.button'], ['event.start'], ['event.click'], ['logic.log'], ['ui.value']],
      [
        [2, 'exec', 0, 'exec'],
        [0, 'exec', 1, 'exec'],
        [3, 'exec', 4, 'exec'],
        [5, 'value', 4, 'value'],
      ],
    )
    const wired = setNodeValue(
      setNodeValue(
        setNodeValue(setNodeValue(graph, ids[0], 'id', 'email'), ids[1], 'id', 'save'),
        ids[3],
        'target',
        'save',
      ),
      ids[5],
      'id',
      'email',
    )

    const { dom, messages } = await run(wired)
    const input = dom.window.document.getElementById('email') as HTMLInputElement
    input.value = 'ada@example.com'
    dom.window.document.getElementById('save')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle()

    expect(messages).toContainEqual(expect.objectContaining({ kind: 'log', text: 'ada@example.com' }))
  })

  it('answers a query with seeded rows, and says the data is not real', async () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'], [1, 'rows', 2, 'value']],
    )
    const { messages } = await run(graph)
    const logs = messages.filter((message) => message.kind === 'log').map((message) => message.text)
    expect(logs.some((text) => text.includes('preview data'))).toBe(true)
    expect(logs.some((text) => text.includes('ada@example.com'))).toBe(true)
  })

  it('never lets a request leave the sandbox', async () => {
    const { graph } = build([['event.start'], ['network.fetch']], [[0, 'exec', 1, 'exec']])
    const { messages } = await run(graph)
    expect(messages.some((message) => (
      message.kind === 'log' && message.text.includes('no request left the sandbox')
    ))).toBe(true)
  })

  it('traces a thrown error to the exact line, and that line to its block', async () => {
    // A plugin-shaped block that calls something undefined: the failure has
    // to arrive with the line of the call, and that line has to map back.
    const registryWithBomb = createRegistry([
      ...builtinBlocks,
      {
        type: 'test.bomb',
        label: 'Boom',
        category: 'Logic',
        description: 'Calls something that does not exist.',
        inputs: [{ id: 'exec', label: 'Run', type: 'Exec' }],
        outputs: [{ id: 'exec', label: 'Then', type: 'Exec' }],
        generate: () => 'missingFunction()',
      },
    ])

    let graph: BlockGraph = { nodes: [], connections: [] }
    const start = createNode('event.start', { x: 0, y: 0 })
    const log = createNode('logic.log', { x: 0, y: 100 })
    const bomb = createNode('test.bomb', { x: 0, y: 200 })
    graph = addNode(addNode(addNode(graph, start), log), bomb)
    graph = connect(graph, registryWithBomb, { node: start.id, port: 'exec' }, { node: log.id, port: 'exec' }).graph
    graph = connect(graph, registryWithBomb, { node: log.id, port: 'exec' }, { node: bomb.id, port: 'exec' }).graph

    const program = generateProgram(graph, registryWithBomb)
    const html = previewHtml({ document: { components: [] }, code: program.code })
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
    const messages: PreviewMessage[] = []
    dom.window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as PreviewMessage & { channel?: string }
      if (data?.channel === PREVIEW_CHANNEL) messages.push(data)
    })
    await settle()

    const failure = messages.find((message) => message.kind === 'error')
    expect(failure).toBeDefined()
    if (failure?.kind !== 'error') return
    expect(failure.text).toContain('missingFunction')

    const expected = program.code.split('\n').findIndex((line) => line.includes('missingFunction()')) + 1
    expect(failure.line).toBe(expected)
    expect(nodeAtLine(program, failure.line!)).toBe(bomb.id)
  })

  it('says which element id a click handler could not find', async () => {
    const { graph, ids } = build([['event.click'], ['logic.log']], [[0, 'exec', 1, 'exec']])
    const { messages } = await run(setNodeValue(graph, ids[0], 'target', 'nowhere'))
    expect(messages.some((message) => (
      message.kind === 'log' && message.text.includes('No element with id "nowhere"')
    ))).toBe(true)
  })
})

describe('lists that repeat', () => {
  /** Query the seeded users table and draw a line per row. */
  function repeater() {
    const { graph, ids } = build(
      [['event.start'], ['data.query'], ['logic.forEach'], ['ui.text']],
      [
        [0, 'exec', 1, 'exec'],
        [1, 'exec', 2, 'exec'],
        [1, 'rows', 2, 'list'],
        [2, 'body', 3, 'exec'],
        [2, 'item', 3, 'value'],
      ],
    )
    return { graph: setNodeValue(graph, ids[1], 'table', 'users'), ids }
  }

  it('draws one element per row, not one element overwritten per row', async () => {
    const { dom } = await run(repeater().graph)
    const lines = [...dom.window.document.querySelectorAll('#app p')]

    // The seeded table has two rows, so there are two paragraphs -- before
    // this, the second upsert reused the first id and a list of fifty rows
    // rendered as one.
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).not.toBe(lines[1].textContent)
    // Anonymous components are numbered by the order they are drawn in.
    expect(lines.map((line) => line.id)).toEqual(['text-1', 'text-2'])
  })

  it('clears rows that a later pass no longer produces', async () => {
    const { dom } = await run(repeater().graph)
    expect(dom.window.document.querySelectorAll('#app p')).toHaveLength(2)

    // Re-running with an empty result must leave nothing behind.
    dom.window.eval(`
      db.select = async () => [];
      rerender();
    `)
    await settle()
    expect(dom.window.document.querySelectorAll('#app p')).toHaveLength(0)
  })

  it('keeps ids stable across passes, so nothing flickers', async () => {
    const { dom } = await run(repeater().graph)
    const before = [...dom.window.document.querySelectorAll('#app p')].map((line) => line.id)
    const first = dom.window.document.getElementById(before[0])

    dom.window.eval('rerender()')
    await settle()

    const after = [...dom.window.document.querySelectorAll('#app p')].map((line) => line.id)
    expect(after).toEqual(before)
    // The same element, updated, rather than a replacement.
    expect(dom.window.document.getElementById(before[0])).toBe(first)
  })
})

describe('containers', () => {
  /** A row holding two lines of text, inside a start handler. */
  function nested(direction = 'row') {
    const { graph, ids } = build(
      [['event.start'], ['ui.stack'], ['ui.text'], ['ui.text']],
      [
        [0, 'exec', 1, 'exec'],
        [1, 'children', 2, 'exec'],
        [2, 'exec', 3, 'exec'],
      ],
    )
    const withValues = setNodeValue(
      setNodeValue(setNodeValue(graph, ids[1], 'direction', direction), ids[2], 'value', 'left'),
      ids[3],
      'value',
      'right',
    )
    return { graph: setNodeValue(withValues, ids[1], 'id', 'bar'), ids }
  }

  it('draws its children inside itself, not beside them', async () => {
    const { dom } = await run(nested().graph)
    const bar = dom.window.document.getElementById('bar')!

    expect(bar.tagName).toBe('DIV')
    expect([...bar.querySelectorAll('p')].map((line) => line.textContent)).toEqual(['left', 'right'])
    // And nothing escaped to the top level.
    expect(dom.window.document.querySelectorAll('#app > p')).toHaveLength(0)
  })

  it('lays a row out as a row and a column as a column', async () => {
    const row = await run(nested('row').graph)
    expect(row.dom.window.document.getElementById('bar')!.style.flexDirection).toBe('row')

    const column = await run(nested('column').graph)
    expect(column.dom.window.document.getElementById('bar')!.style.flexDirection).toBe('column')
  })

  it('puts the same nesting in the schema the compiler reads', () => {
    const { graph } = nested()
    const { components } = schemaFromGraph(graph, registry)

    // One top-level component, with the two lines inside it.
    expect(components).toHaveLength(1)
    expect(components[0].type).toBe('stack')
    expect(components[0].children?.map((child) => child.properties.value)).toEqual(['left', 'right'])
  })

  it('renders that nesting as nested markup', async () => {
    const { renderComponent } = await import('./uiSchema')
    const { components } = schemaFromGraph(nested().graph, registry)
    const html = renderComponent(components[0])
    expect(html).toContain('flex-direction:row')
    expect(html.indexOf('left')).toBeLessThan(html.indexOf('right'))
    expect(html).toMatch(/<div[^>]*>.*<p[^>]*>left<\/p>.*<\/div>/s)
  })

  it('survives the round trip, nesting included', () => {
    const { graph } = nested()
    const first = generateProgram(graph, registry).code
    expect(first).toContain('await render.stack({ id: "bar", direction: "row", gap: 10 }, async () => {')

    const parsed = parseProgram(first, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(generateProgram(parsed.graph, registry).code).toBe(first)
  })

  it('generates an empty container without opening a body', () => {
    const { graph, ids } = build([['event.start'], ['ui.stack']], [[0, 'exec', 1, 'exec']])
    const code = generateProgram(setNodeValue(graph, ids[1], 'id', 'empty'), registry).code
    expect(code).toContain('async () => {})')

    const parsed = parseProgram(code, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(generateProgram(parsed.graph, registry).code).toBe(code)
  })
})
