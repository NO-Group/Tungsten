/**
 * What the app remembers.
 *
 * The declaration lives in the generated file, so the tests that matter
 * are the round trip — panel to code to panel, unchanged — and the rule
 * that a block cannot name a variable which does not exist.
 */

import { describe, expect, it } from 'vitest'

import {
  INITIAL_FOR, generateState, isValidName, parseState, typeOfInitial, uniqueName,
  variableByName, type AppVariable,
} from './appState'
import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { parseProgram } from './codeParser'
import { checkIntegrity } from './integrity'
import { addNode, connect, createNode, resetIds } from './graph'

const registry = createRegistry(builtinBlocks)
const empty = { nodes: [], connections: [] }

const variable = (overrides: Partial<AppVariable> = {}): AppVariable => ({
  name: 'count', scope: 'page', type: 'Number', initial: '0', ...overrides,
})

/**
 * An event, a Set Variable block, and the wire between them.
 *
 * Values are stored plain -- `greeting`, not `"greeting"` -- because the
 * generator is what adds the quotes. Storing them quoted would quote them
 * twice, which is exactly the bug these fixtures caught once already.
 */
function withSetter(name: string, value = 'hello') {
  resetIds()
  const event = createNode('event.start', { x: 0, y: 0 })
  const setter = createNode('state.set', { x: 300, y: 0 })
  setter.values = { ...setter.values, name, value }
  let graph = addNode(addNode(empty, event), setter)
  graph = connect(graph, registry, { node: event.id, port: 'exec' }, { node: setter.id, port: 'exec' }).graph
  return { graph, setter }
}

describe('declaring variables', () => {
  it('writes nothing when there are none', () => {
    expect(generateState([])).toBe('')
  })

  it('writes the two scopes as two groups', () => {
    const line = generateState([
      variable({ name: 'query', type: 'String', initial: '""' }),
      variable({ name: 'token', scope: 'app', type: 'String', initial: '""' }),
    ])
    expect(line).toBe('const state = app.state({ page: { query: "" }, app: { token: "" } })')
  })

  it('omits a group that has nothing in it', () => {
    expect(generateState([variable({ scope: 'app' })])).toBe('const state = app.state({ app: { count: 0 } })')
  })

  it('reads its own output back, exactly', () => {
    const state = [
      variable({ name: 'query', type: 'String', initial: '"a, b"' }),
      variable({ name: 'items', type: 'List', initial: '[1, 2, 3]' }),
      variable({ name: 'user', scope: 'app', type: 'Object', initial: '{ id: 1 }' }),
    ]
    const parsed = parseState(generateState(state))!
    expect(parsed).toEqual(state)
    // Including the commas inside strings, arrays and objects.
    expect(variableByName(parsed, 'items')?.initial).toBe('[1, 2, 3]')
    expect(variableByName(parsed, 'user')?.initial).toBe('{ id: 1 }')
  })

  it('is not confused by a line that is something else', () => {
    expect(parseState('app.onStart(async () => {')).toBeUndefined()
    expect(parseState('const state = somethingElse()')).toBeUndefined()
  })

  it('infers a type from what the value looks like', () => {
    expect(typeOfInitial('"x"')).toBe('String')
    expect(typeOfInitial('12.5')).toBe('Number')
    expect(typeOfInitial('false')).toBe('Boolean')
    expect(typeOfInitial('[]')).toBe('List')
    expect(typeOfInitial('{ a: 1 }')).toBe('Object')
  })

  it('keeps names legal and unique', () => {
    expect(isValidName('userName')).toBe(true)
    expect(isValidName('User')).toBe(false)
    expect(isValidName('two words')).toBe(false)
    expect(uniqueName('value', [])).toBe('value')
    expect(uniqueName('value', [variable({ name: 'value' })])).toBe('value2')
    expect(uniqueName('my name!', [])).toBe('myname')
  })

  it('starts each type at something of that type', () => {
    expect(typeOfInitial(INITIAL_FOR.String)).toBe('String')
    expect(typeOfInitial(INITIAL_FOR.List)).toBe('List')
    expect(typeOfInitial(INITIAL_FOR.Boolean)).toBe('Boolean')
  })
})

describe('variables in a program', () => {
  it('declares them above the handlers', () => {
    const { graph } = withSetter('greeting')
    const code = generateProgram(graph, registry, [variable({ name: 'greeting', type: 'String', initial: '""' })]).code
    expect(code.indexOf('app.state(')).toBeLessThan(code.indexOf('app.onStart'))
    expect(code).toContain('state.set("greeting", "hello")')
  })

  it('round-trips the whole file, variables included', () => {
    const { graph } = withSetter('greeting')
    const state = [variable({ name: 'greeting', type: 'String', initial: '""' })]
    const first = generateProgram(graph, registry, state).code

    const parsed = parseProgram(first, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.state).toEqual(state)
    expect(generateProgram(parsed.graph, registry, parsed.state).code).toBe(first)
  })

  it('reads a variable as a value another block can use', () => {
    resetIds()
    const event = createNode('event.start', { x: 0, y: 0 })
    const text = createNode('ui.text', { x: 300, y: 0 })
    const get = createNode('state.get', { x: 300, y: 200 })
    get.values = { ...get.values, name: 'greeting' }

    let graph = addNode(addNode(addNode(empty, event), text), get)
    graph = connect(graph, registry, { node: event.id, port: 'exec' }, { node: text.id, port: 'exec' }).graph
    graph = connect(graph, registry, { node: get.id, port: 'value' }, { node: text.id, port: 'value' }).graph

    const state = [variable({ name: 'greeting', type: 'String', initial: '"hi"' })]
    const code = generateProgram(graph, registry, state).code
    // The component's text is the variable, not a copy of it.
    expect(code).toContain('render.text(state.get("greeting"))')

    const parsed = parseProgram(code, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(generateProgram(parsed.graph, registry, parsed.state).code).toBe(code)
  })
})

describe('the checker and variables', () => {
  it('refuses a block that names a variable which does not exist', () => {
    const { graph, setter } = withSetter('missing')
    const report = checkIntegrity(graph, registry, [variable({ name: 'greeting' })])
    const problem = report.diagnostics.find((entry) => entry.code === 'unknown-variable')

    expect(problem?.nodeId).toBe(setter.id)
    expect(problem?.message).toContain('missing')
    expect(problem?.fix).toContain('Variables panel')
    expect(report.compilable).toBe(false)
  })

  it('refuses a block that names nothing at all', () => {
    const { graph } = withSetter('')
    const report = checkIntegrity(graph, registry, [])
    expect(report.diagnostics.some((entry) => entry.code === 'unknown-variable')).toBe(true)
  })

  it('is satisfied once the variable is declared', () => {
    const { graph } = withSetter('greeting')
    const report = checkIntegrity(graph, registry, [variable({ name: 'greeting', type: 'String', initial: '""' })])
    expect(report.diagnostics.filter((entry) => entry.code === 'unknown-variable')).toEqual([])
    expect(report.compilable).toBe(true)
  })

  it('says nothing about a graph with no state blocks in it', () => {
    resetIds()
    const graph = addNode(empty, createNode('event.start', { x: 0, y: 0 }))
    expect(checkIntegrity(graph, registry, []).diagnostics.filter((e) => e.code === 'unknown-variable')).toEqual([])
  })
})
