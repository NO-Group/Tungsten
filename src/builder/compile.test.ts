import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, type BlockGraph } from './blockSchema'
import { addNode, connect, createNode, resetIds, setNodeValue } from './graph'
import { buildIr, compile } from './compile'
import { schemaFromGraph, renderDocumentBody } from './uiSchema'
import { previewHtml, PREVIEW_PREAMBLE_LINES } from './previewRuntime'
import {
  checkSchema,
  createFetchers,
  createMigration,
  diffMigration,
  safeName,
  typeName,
  type DataSchema,
} from './dataSchema'
import { blockFromManifest, loadPluginBlocks, EXAMPLE_PLUGIN } from './pluginBlocks'
import { explainFailure, lineFromMessage } from './traceback'
import { generateProgram } from './codeGenerator'

const registry = createRegistry(builtinBlocks)

function build(
  nodes: Array<[type: string, x?: number, y?: number]>,
  links: Array<[from: string, fromPort: string, to: string, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const [type, x = 0, y = 0] of nodes) {
    const node = createNode(type, { x, y })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  for (const [from, fromPort, to, toPort] of links) {
    const result = connect(
      graph,
      registry,
      { node: ids[Number(from)], port: fromPort },
      { node: ids[Number(to)], port: toPort },
    )
    if (result.rejected) throw new Error(result.rejected)
    graph = result.graph
  }
  return { graph, ids }
}

/** A button wired to a click handler that logs: the smallest whole app. */
function clickableApp() {
  const { graph, ids } = build(
    [['ui.button'], ['event.click'], ['logic.log'], ['event.start']],
    [
      ['3', 'exec', '0', 'exec'],
      ['1', 'exec', '2', 'exec'],
    ],
  )
  const named = setNodeValue(setNodeValue(graph, ids[0], 'id', 'save'), ids[1], 'target', 'save')
  return { graph: setNodeValue(named, ids[2], 'value', 'saved'), ids }
}

beforeEach(() => resetIds())

describe('ui schema', () => {
  it('is empty when there is no interface', () => {
    expect(schemaFromGraph({ nodes: [], connections: [] }, registry).components).toEqual([])
  })

  it('projects a button onto the universal shape', () => {
    const { graph, ids } = clickableApp()
    const [component] = schemaFromGraph(graph, registry).components
    expect(component).toMatchObject({
      id: 'save',
      type: 'button',
      properties: { text: 'Submit' },
      nodeId: ids[0],
    })
    expect(component.layout).toHaveProperty('order', 0)
  })

  it('binds a click handler to the component with that id', () => {
    const { graph, ids } = clickableApp()
    const [component] = schemaFromGraph(graph, registry).components
    expect(component.events.click).toBe(ids[1])
  })

  it('leaves events empty when no handler matches the id', () => {
    const { graph, ids } = build([['ui.button']])
    const renamed = setNodeValue(graph, ids[0], 'id', 'orphan-button')
    expect(schemaFromGraph(renamed, registry).components[0].events).toEqual({})
  })

  it('orders components the way the canvas reads', () => {
    const { graph } = build([['ui.text', 0, 300], ['ui.text', 0, 10]])
    const ordered = schemaFromGraph(graph, registry).components.map((component) => component.layout.y)
    expect(ordered).toEqual([10, 300])
  })

  it('escapes text that would otherwise be markup', () => {
    const { graph, ids } = build([['ui.button']])
    const nasty = setNodeValue(graph, ids[0], 'text', '<script>alert(1)</script>')
    const html = renderDocumentBody(schemaFromGraph(nasty, registry))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('preview sandbox', () => {
  it('inlines the interface and the program', () => {
    const { graph } = clickableApp()
    const html = previewHtml({
      document: schemaFromGraph(graph, registry),
      code: generateProgram(graph, registry).code,
    })
    expect(html).toContain('<button id="save"')
    expect(html).toContain('app.onClick')
    expect(html).toContain('sandbox' in globalThis ? '' : '')
  })

  it('stubs every backend service the blocks can call', () => {
    const html = previewHtml({ document: { components: [] }, code: '' })
    for (const service of ['db.select', 'db.insert', 'http', 'auth', 'storage.upload']) {
      expect(html).toContain(service.split('.')[0])
    }
    expect(html).toContain('no request left the sandbox')
  })

  it('knows its own preamble size, so a thrown line maps back', () => {
    expect(PREVIEW_PREAMBLE_LINES).toBeGreaterThan(0)
    const html = previewHtml({ document: { components: [] }, code: 'app.onStart(async () => {})\n' })
    expect(html).toContain(`const PREAMBLE_LINES = ${PREVIEW_PREAMBLE_LINES}`)
  })
})

describe('data schema', () => {
  const schema: DataSchema = {
    tables: [{
      name: 'posts',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'views', type: 'number' },
      ],
    }],
  }

  it('writes a migration with the columns everyone forgets', () => {
    const sql = createMigration(schema)
    expect(sql).toContain('create table if not exists posts')
    expect(sql).toContain('id bigserial primary key')
    expect(sql).toContain('title text not null')
    expect(sql).toContain('created_at timestamptz not null default now()')
  })

  it('adds a column additively rather than rewriting history', () => {
    const next: DataSchema = {
      tables: [{ ...schema.tables[0], columns: [...schema.tables[0].columns, { name: 'slug', type: 'text' }] }],
    }
    const sql = diffMigration(schema, next)
    expect(sql).toContain('alter table posts add column slug text;')
    expect(sql).not.toContain('create table')
  })

  it('refuses to drop data without being asked twice', () => {
    const next: DataSchema = { tables: [{ ...schema.tables[0], columns: [schema.tables[0].columns[0]] }] }
    expect(diffMigration(schema, next)).toContain('-- alter table posts drop column views;')
  })

  it('says nothing changed when nothing changed', () => {
    expect(diffMigration(schema, schema)).toContain('Nothing changed')
  })

  it('writes typed fetchers the query blocks line up with', () => {
    const code = createFetchers(schema)
    expect(code).toContain('export type Post = {')
    expect(code).toContain('title: string')
    expect(code).toContain('views?: number')
    expect(code).toContain("db.select('posts', where)")
    expect(code).toContain('export async function createPost')
  })

  it('reports a duplicate table and an empty one', () => {
    const problems = checkSchema({ tables: [{ name: 'a', columns: [] }, { name: 'a', columns: [] }] })
    expect(problems.map((problem) => problem.message).join(' ')).toContain('both called')
    expect(problems.some((problem) => problem.message.includes('no columns'))).toBe(true)
  })

  it('makes names safe for SQL and TypeScript', () => {
    expect(safeName('My Table!', 'table')).toBe('my_table')
    expect(safeName('9lives', 'table')).toBe('table')
    expect(typeName('blog_posts')).toBe('BlogPost')
  })
})

describe('the intermediate representation', () => {
  it('lowers an event chain into statements with their inputs', () => {
    const { graph, ids } = build(
      [['event.start'], ['data.query'], ['logic.log']],
      [['0', 'exec', '1', 'exec'], ['1', 'exec', '2', 'exec'], ['1', 'rows', '2', 'value']],
    )
    const ir = buildIr(graph, registry)
    expect(ir.events).toHaveLength(1)
    expect(ir.events[0].body.map((statement) => statement.type)).toEqual(['data.query', 'logic.log'])
    expect(ir.events[0].body[1].inputs.value).toEqual({ kind: 'reference', node: ids[1], port: 'rows' })
    expect(ir.events[0].body[0].inputs.table).toEqual({ kind: 'literal', value: 'users' })
  })

  it('keeps nested bodies nested', () => {
    const { graph } = build(
      [['event.start'], ['logic.if'], ['logic.log']],
      [['0', 'exec', '1', 'exec'], ['1', 'body', '2', 'exec']],
    )
    const [branch] = buildIr(graph, registry).events[0].body
    expect(branch.bodies.body.map((statement) => statement.type)).toEqual(['logic.log'])
  })

  it('carries the interface and the tables', () => {
    const { graph } = clickableApp()
    const ir = buildIr(graph, registry, { tables: [{ name: 'users', columns: [] }] })
    expect(ir.components).toHaveLength(1)
    expect(ir.tables).toHaveLength(1)
  })
})

describe('compilation', () => {
  it('refuses to compile a graph with errors', () => {
    const { graph } = build([['event.start'], ['storage.upload']], [['0', 'exec', '1', 'exec']])
    const result = compile({ graph, registry, target: 'web' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('block compilation')
  })

  it('refuses to compile an empty canvas', () => {
    const result = compile({ graph: { nodes: [], connections: [] }, registry, target: 'web' })
    expect(!result.ok && result.reason).toContain('nothing on the canvas')
  })

  it('emits a runnable web bundle', () => {
    const { graph } = clickableApp()
    const result = compile({ graph, registry, target: 'web' })
    expect(result.ok).toBe(true)
    const paths = result.ok ? result.files.map((file) => file.path) : []
    expect(paths).toContain('build/web/index.html')
    expect(paths).toContain('build/web/app.ts')
    expect(paths).toContain('build/web/ui.schema.json')
    const html = result.ok ? result.files.find((file) => file.path.endsWith('index.html'))!.contents : ''
    expect(html).toContain('<button id="save"')
  })

  it('includes migrations in the bundle when there is a schema', () => {
    const { graph } = clickableApp()
    const result = compile({
      graph,
      registry,
      schema: { tables: [{ name: 'users', columns: [{ name: 'email', type: 'text', required: true }] }] },
      target: 'web',
    })
    const paths = result.ok ? result.files.map((file) => file.path) : []
    expect(paths).toContain('build/web/migrations/0001_init.sql')
    expect(paths).toContain('build/web/data/fetchers.ts')
  })

  it('exports mobile source from the same graph', () => {
    const { graph } = clickableApp()
    const result = compile({ graph, registry, target: 'mobile' })
    const dart = result.ok ? result.files.find((file) => file.path.endsWith('main.dart'))!.contents : ''
    expect(dart).toContain('import \'package:flutter/material.dart\';')
    expect(dart).toContain('ElevatedButton(onPressed:')
    expect(dart).toContain('debugPrint')
    expect(result.ok && result.files.some((file) => file.path.endsWith('runtime.dart'))).toBe(true)
  })

  it('maps a loop and a branch into Dart', () => {
    const { graph } = build(
      [['event.start'], ['data.query'], ['logic.if'], ['logic.log'], ['logic.forEach'], ['logic.log']],
      [
        ['0', 'exec', '1', 'exec'],
        ['1', 'exec', '2', 'exec'],
        ['2', 'body', '3', 'exec'],
        ['2', 'exec', '4', 'exec'],
        ['1', 'rows', '4', 'list'],
        ['4', 'body', '5', 'exec'],
      ],
    )
    const result = compile({ graph, registry, target: 'mobile' })
    const dart = result.ok ? result.files[0].contents : ''
    expect(dart).toContain('if (true == true) {')
    expect(dart).toContain('for (final item in')
  })

  it('emits a dependency-free local runner', () => {
    const { graph } = clickableApp()
    const result = compile({ graph, registry, target: 'node' })
    const server = result.ok ? result.files.find((file) => file.path.endsWith('server.mjs'))!.contents : ''
    expect(server).toContain('createServer')
    expect(server).toContain('4173')
    expect(result.ok && JSON.parse(result.files.find((file) => file.path.endsWith('package.json'))!.contents).scripts.start)
      .toBe('node server.mjs')
  })
})

describe('plugin blocks', () => {
  const manifest = JSON.parse(EXAMPLE_PLUGIN) as Record<string, unknown>

  it('turns the example manifest into a usable block', () => {
    const block = blockFromManifest(manifest as never)
    expect(typeof block).not.toBe('string')
    if (typeof block === 'string') return
    expect(block.type).toBe('acme.notify')
    expect(block.inputs[0].type).toBe('Exec')
    expect(block.generate({
      node: { id: 'n1', type: 'acme.notify', position: { x: 0, y: 0 }, values: {} },
      input: (port) => (port === 'channel' ? '"general"' : '"hi"'),
      body: () => '',
      symbol: 'notify1',
      indent: '',
    })).toBe('const notify1 = await notify.send("general", "hi")')
  })

  it('registers plugin blocks alongside the built-ins', () => {
    const { blocks } = loadPluginBlocks([{ path: 'plugins/notify.block.json', content: EXAMPLE_PLUGIN }])
    const extended = createRegistry([...builtinBlocks, ...blocks])
    expect(extended.get('acme.notify')?.label).toBe('Send Notification')
    expect(extended.byCategory().find((group) => group.category === 'Network')?.blocks.length).toBe(2)
  })

  it('ignores files outside the plugins directory', () => {
    const { blocks } = loadPluginBlocks([{ path: 'src/notify.block.json', content: EXAMPLE_PLUGIN }])
    expect(blocks).toHaveLength(0)
  })

  it('names the file when a manifest is broken', () => {
    const { blocks, problems } = loadPluginBlocks([
      { path: 'plugins/bad.block.json', content: '{ not json' },
      { path: 'plugins/worse.block.json', content: '{"type":"nope"}' },
    ])
    expect(blocks).toHaveLength(0)
    expect(problems[0]).toMatchObject({ path: 'plugins/bad.block.json' })
    expect(problems[1].message).toContain('type like')
  })

  it('refuses a template that fills a port the block does not have', () => {
    const result = blockFromManifest({ ...manifest, template: 'send(${nope})' } as never)
    expect(result).toContain('has no input with that id')
  })

  it('never evaluates anything from the manifest', () => {
    const result = blockFromManifest({
      ...manifest,
      template: 'send(${message})',
      label: 'Evil',
    } as never)
    if (typeof result === 'string') throw new Error(result)
    const generated = result.generate({
      node: { id: 'n1', type: 'acme.notify', position: { x: 0, y: 0 }, values: {} },
      input: () => '"payload"',
      body: () => '',
      symbol: 'notify1',
      indent: '',
    })
    expect(generated).toBe('const notify1 = send("payload")')
  })
})

describe('traceback', () => {
  it('pulls a line number out of a stack-shaped message', () => {
    expect(lineFromMessage('TypeError: x is not a function (at <anonymous>:7:11)')).toBe(7)
    expect(lineFromMessage('Error on line 4: nope')).toBe(4)
    expect(lineFromMessage('no numbers here')).toBeUndefined()
  })

  it('names the block a failure came from', () => {
    const { graph, ids } = build([['event.start'], ['network.fetch']], [['0', 'exec', '1', 'exec']])
    const program = generateProgram(graph, registry)
    const line = program.code.split('\n').findIndex((text) => text.includes('http.request')) + 1
    const traceback = explainFailure(
      program,
      registry,
      'Failed to fetch',
      line,
      (nodeId) => graph.nodes.find((node) => node.id === nodeId)?.type,
    )
    expect(traceback.nodeId).toBe(ids[1])
    expect(traceback.message).toContain('HTTP Request')
    expect(traceback.raw).toBe('Failed to fetch')
  })

  it('passes the message through when no line maps to a block', () => {
    const program = generateProgram({ nodes: [], connections: [] }, registry)
    expect(explainFailure(program, registry, 'Something went wrong').message).toBe('Something went wrong')
  })
})
