/**
 * Screens: the model, the file, and the round trip between them.
 *
 * The property that matters most here is the one about absence. A project
 * with one screen must produce exactly the file it produced before screens
 * existed -- otherwise every saved canvas in the world changes the first
 * time it is opened, and the diff says something happened when nothing did.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, type BlockGraph } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { parseProgram } from './codeParser'
import { checkIntegrity } from './integrity'
import { compile } from './compile'
import { schemaFromGraph } from './uiSchema'
import { previewHtml } from './previewRuntime'
import { addNode, canConnect, connect, createNode, normaliseScreens, resetIds, setNodeScreens, setNodeValue } from './graph'
import {
  DEFAULT_SCREENS, addScreen, generateScreens, hasScreen, homeScreen, isDefaultScreens,
  isValidScreenName, moveScreen, parseScreens, removeScreen, renameScreen, screenOf,
  undeclaredScreens, uniqueScreenName, type Screen,
} from './screens'

const registry = createRegistry(builtinBlocks)

/** Builds a graph whose blocks are stamped with the screen they sit on. */
function build(
  nodes: Array<[type: string, screen?: string]>,
  links: Array<[from: number, fromPort: string, to: number, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const [type, screen] of nodes) {
    const node = createNode(type, { x: 0, y: ids.length * 100 }, screen)
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

const TWO: Screen[] = [{ name: 'home' }, { name: 'settings' }]

beforeEach(() => resetIds())

describe('the screen list', () => {
  it('starts as one screen that costs nothing', () => {
    expect(isDefaultScreens(DEFAULT_SCREENS)).toBe(true)
    expect(generateScreens(DEFAULT_SCREENS)).toBe('')
    expect(homeScreen(DEFAULT_SCREENS)).toBe('home')
    // An empty list is still a home screen rather than an error.
    expect(homeScreen([])).toBe('home')
  })

  it('accepts names a route could use, and refuses the rest', () => {
    expect(isValidScreenName('home')).toBe(true)
    expect(isValidScreenName('sign-up')).toBe(true)
    expect(isValidScreenName('Home')).toBe(false)
    expect(isValidScreenName('two words')).toBe(false)
    expect(isValidScreenName('2nd')).toBe(false)
  })

  it('makes a requested name legal and unique', () => {
    expect(uniqueScreenName('Sign Up', [])).toBe('sign-up')
    expect(uniqueScreenName('home', DEFAULT_SCREENS)).toBe('home-2')
    expect(uniqueScreenName('home', [{ name: 'home' }, { name: 'home-2' }])).toBe('home-3')
    expect(uniqueScreenName('', [])).toBe('screen')
  })

  it('adds, renames, reorders and removes', () => {
    const added = addScreen(DEFAULT_SCREENS, 'settings')
    expect(added.map((screen) => screen.name)).toEqual(['home', 'settings'])

    const renamed = renameScreen(added, 1, 'preferences')
    expect(renamed?.screens.map((screen) => screen.name)).toEqual(['home', 'preferences'])
    expect(renamed?.from).toBe('settings')

    // Reordering chooses where the app starts.
    expect(moveScreen(added, 1, 0).map((screen) => screen.name)).toEqual(['settings', 'home'])
    expect(homeScreen(moveScreen(added, 1, 0))).toBe('settings')

    expect(removeScreen(added, 1).map((screen) => screen.name)).toEqual(['home'])
  })

  it('refuses a rename that would collide or that is not a name', () => {
    expect(renameScreen(TWO, 1, 'home')).toBeUndefined()
    expect(renameScreen(TWO, 1, 'Not A Name')).toBeUndefined()
    expect(renameScreen(TWO, 9, 'anything')).toBeUndefined()
    // Renaming a screen to what it is already called is allowed and is a
    // no-op, so a field that blurs unchanged does not report an error.
    expect(renameScreen(TWO, 1, 'settings')?.to).toBe('settings')
  })

  it('will not remove the last screen', () => {
    expect(removeScreen(DEFAULT_SCREENS, 0)).toEqual(DEFAULT_SCREENS)
  })

  it('resolves a block with no screen to the first one', () => {
    expect(screenOf({}, TWO)).toBe('home')
    expect(screenOf({ screen: 'settings' }, TWO)).toBe('settings')
    expect(hasScreen(TWO, 'nope')).toBe(false)
  })

  it('reports the screens blocks name but the list does not declare', () => {
    expect(undeclaredScreens([{ screen: 'home' }, { screen: 'gone' }], TWO)).toEqual(['gone'])
    expect(undeclaredScreens([{}], TWO)).toEqual([])
  })
})

describe('screens in the generated file', () => {
  it('writes nothing at all for a single-screen project', () => {
    const { graph } = build([['event.start'], ['logic.log']], [[0, 'exec', 1, 'exec']])
    const without = generateProgram(graph, registry).code
    const with1 = generateProgram(graph, registry, [], DEFAULT_SCREENS).code
    expect(with1).toBe(without)
    expect(without).toContain('app.onStart(async () => {')
    expect(without).not.toContain('app.screens')
  })

  it('declares them, and names the screen each handler belongs to', () => {
    const { graph } = build(
      [['event.start', 'home'], ['logic.log', 'home'], ['event.start', 'settings'], ['logic.log', 'settings']],
      [[0, 'exec', 1, 'exec'], [2, 'exec', 3, 'exec']],
    )
    const { code } = generateProgram(graph, registry, [], TWO)
    expect(code).toContain('const screens = app.screens(["home", "settings"])')
    expect(code).toContain('app.screen("home").onStart(async () => {')
    expect(code).toContain('app.screen("settings").onStart(async () => {')
  })

  it('emits the screens in declared order, whatever order the blocks are in', () => {
    const { graph } = build([['event.start', 'settings'], ['event.start', 'home']])
    const { code } = generateProgram(graph, registry, [], TWO)
    expect(code.indexOf('app.screen("home")')).toBeLessThan(code.indexOf('app.screen("settings")'))
  })

  it('still emits a handler on a screen nobody declared, rather than dropping it', () => {
    const { graph } = build([['event.start', 'ghost']])
    const { code } = generateProgram(graph, registry, [], TWO)
    expect(code).toContain('app.screen("ghost").onStart')
  })

  it('round-trips two screens, byte for byte', () => {
    const { graph, ids } = build(
      [
        ['event.start', 'home'], ['ui.button', 'home'], ['event.click', 'home'], ['nav.go', 'home'],
        ['event.start', 'settings'], ['ui.text', 'settings'],
      ],
      [[0, 'exec', 1, 'exec'], [2, 'exec', 3, 'exec'], [4, 'exec', 5, 'exec']],
    )
    const wired = setNodeValue(
      setNodeValue(setNodeValue(graph, ids[1], 'id', 'open'), ids[2], 'target', 'open'),
      ids[3],
      'screen',
      'settings',
    )

    const first = generateProgram(wired, registry, [], TWO).code
    const parsed = parseProgram(first, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.screens.map((screen) => screen.name)).toEqual(['home', 'settings'])
    expect(generateProgram(parsed.graph, registry, parsed.state, parsed.screens).code).toBe(first)
  })

  it('puts every block it reads back on the screen its handler named', () => {
    const code = [
      '// Generated by the Tungsten builder. Edit the blocks or this file; they stay in step.',
      '',
      'const screens = app.screens(["home", "settings"])',
      '',
      'app.screen("home").onStart(async () => {',
      '  console.log("one")',
      '})',
      '',
      'app.screen("settings").onStart(async () => {',
      '  console.log("two")',
      '})',
      '',
    ].join('\n')

    const parsed = parseProgram(code, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const screens = parsed.graph.nodes.map((node) => node.screen)
    expect(screens).toEqual(['home', 'home', 'settings', 'settings'])
    // Each screen is laid out from the top of its own canvas.
    expect(parsed.graph.nodes[2].position.y).toBe(0)
  })

  it('leaves the screen off every block when the file declares none', () => {
    const { graph } = build([['event.start'], ['logic.log']], [[0, 'exec', 1, 'exec']])
    const parsed = parseProgram(generateProgram(graph, registry).code, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.graph.nodes.every((node) => node.screen === undefined)).toBe(true)
    expect(parsed.screens).toEqual(DEFAULT_SCREENS)
  })

  it('refuses a declaration that arrives after the handlers', () => {
    const code = [
      'app.onStart(async () => {',
      '})',
      'const screens = app.screens(["home", "settings"])',
    ].join('\n')
    const parsed = parseProgram(code, registry)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('before the handlers')
  })

  it('reads a declaration back, and ignores junk inside it', () => {
    expect(parseScreens('const screens = app.screens(["a", "b"])')).toEqual([{ name: 'a' }, { name: 'b' }])
    expect(parseScreens('const screens = app.screens(["a", "a"])')).toEqual([{ name: 'a' }])
    expect(parseScreens('const screens = app.screens([])')).toEqual(DEFAULT_SCREENS)
    expect(parseScreens('const x = 1')).toBeUndefined()
  })
})

describe('the navigation blocks', () => {
  it('generates and reads back a jump to another screen', () => {
    const { graph, ids } = build([['event.start', 'home'], ['nav.go', 'home']], [[0, 'exec', 1, 'exec']])
    const { code } = generateProgram(setNodeValue(graph, ids[1], 'screen', 'settings'), registry, [], TWO)
    expect(code).toContain('app.goTo("settings")')

    const parsed = parseProgram(code, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.graph.nodes.some((node) => node.type === 'nav.go' && node.values.screen === 'settings')).toBe(true)
  })

  it('generates going back, and reading where you are', () => {
    const { graph, ids } = build(
      [['event.start', 'home'], ['nav.back', 'home'], ['logic.log', 'home'], ['nav.current', 'home']],
      [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'], [3, 'name', 2, 'value']],
    )
    const { code } = generateProgram(graph, registry, [], TWO)
    expect(code).toContain('app.back()')
    expect(code).toContain('console.log(app.currentScreen())')
    expect(generateProgram(
      (parseProgram(code, registry) as { graph: BlockGraph }).graph,
      registry,
      [],
      TWO,
    ).code).toBe(code)
    expect(ids.length).toBe(4)
  })
})

describe('what the checker knows about screens', () => {
  it('refuses to compile a jump to a screen that does not exist', () => {
    const { graph, ids } = build([['event.start', 'home'], ['nav.go', 'home']], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(graph, ids[1], 'screen', 'nowhere')
    const report = checkIntegrity(named, registry, [], TWO)
    const problem = report.diagnostics.find((entry) => entry.code === 'unknown-screen')
    expect(problem?.severity).toBe('error')
    expect(problem?.message).toContain('nowhere')
    expect(report.compilable).toBe(false)
  })

  it('says so when a navigation block names nothing at all', () => {
    const { graph } = build([['event.start', 'home'], ['nav.go', 'home']], [[0, 'exec', 1, 'exec']])
    const problem = checkIntegrity(graph, registry, [], TWO)
      .diagnostics.find((entry) => entry.code === 'unknown-screen')
    expect(problem?.message).toContain('does not say which screen')
  })

  it('is quiet once the screen exists', () => {
    const { graph, ids } = build([['event.start', 'home'], ['nav.go', 'home']], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(graph, ids[1], 'screen', 'settings')
    expect(checkIntegrity(named, registry, [], TWO).diagnostics
      .filter((entry) => entry.code === 'unknown-screen')).toEqual([])
  })

  it('says nothing about navigation when it was not told the screens', () => {
    const { graph, ids } = build([['event.start'], ['nav.go']], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(graph, ids[1], 'screen', 'nowhere')
    expect(checkIntegrity(named, registry).diagnostics
      .filter((entry) => entry.code === 'unknown-screen')).toEqual([])
  })

  it('refuses a wire drawn between two screens', () => {
    const { graph, ids } = build([['event.start', 'home'], ['logic.log', 'settings']])
    const check = canConnect(graph, registry, { node: ids[0], port: 'exec' }, { node: ids[1], port: 'exec' })
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.reason).toContain('different screens')
  })

  it('reports one that arrived some other way', () => {
    const { graph, ids } = build([['event.start', 'home'], ['logic.log', 'home']], [[0, 'exec', 1, 'exec']])
    // A graph edited by hand, or pasted: the link survives the move here.
    const split: BlockGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === ids[1] ? { ...node, screen: 'settings' } : node)),
    }
    const problem = checkIntegrity(split, registry, [], TWO)
      .diagnostics.find((entry) => entry.code === 'cross-screen')
    expect(problem?.severity).toBe('error')
    expect(problem?.message).toContain('“home” screen')
  })
})

describe('moving blocks between screens', () => {
  it('takes the wiring that stays on one screen and drops what does not', () => {
    const { graph, ids } = build(
      [['event.start', 'home'], ['logic.log', 'home'], ['logic.log', 'home']],
      [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec']],
    )
    const moved = setNodeScreens(graph, [ids[1], ids[2]], 'settings')
    expect(moved.nodes.map((node) => node.screen)).toEqual(['home', 'settings', 'settings'])
    // The link inside the moved pair survives; the one that now crosses
    // screens does not.
    expect(moved.connections.length).toBe(1)
    expect(moved.connections[0].from.node).toBe(ids[1])
  })

  it('stamps or strips the screen to match whether the project has any', () => {
    const { graph } = build([['event.start'], ['logic.log']])
    const stamped = normaliseScreens(graph, 'home', true)
    expect(stamped.nodes.every((node) => node.screen === 'home')).toBe(true)
    const stripped = normaliseScreens(stamped, 'home', false)
    expect(stripped.nodes.every((node) => node.screen === undefined)).toBe(true)
    // Nothing to do means the same object, so React does not re-render.
    expect(normaliseScreens(stripped, 'home', false)).toBe(stripped)
  })
})

describe('screens downstream', () => {
  it('gives the interface of one screen at a time', () => {
    const { graph, ids } = build(
      [['event.start', 'home'], ['ui.button', 'home'], ['event.start', 'settings'], ['ui.button', 'settings']],
      [[0, 'exec', 1, 'exec'], [2, 'exec', 3, 'exec']],
    )
    const named = setNodeValue(setNodeValue(graph, ids[1], 'id', 'one'), ids[3], 'id', 'two')

    expect(schemaFromGraph(named, registry, { screen: 'home', screens: TWO }).components.map((c) => c.id))
      .toEqual(['one'])
    expect(schemaFromGraph(named, registry, { screen: 'settings', screens: TWO }).components.map((c) => c.id))
      .toEqual(['two'])
    // Asked for no screen in particular, it still answers with everything.
    expect(schemaFromGraph(named, registry).components.length).toBe(2)
  })

  it('opens the preview on the screen being drawn', () => {
    const html = previewHtml({ document: { components: [] }, code: '', screen: 'settings' })
    expect(html).toContain('const INITIAL_SCREEN = "settings"')
  })

  it('compiles the screens into the web target', () => {
    const { graph, ids } = build(
      [['event.start', 'home'], ['ui.button', 'home'], ['event.start', 'settings'], ['ui.text', 'settings']],
      [[0, 'exec', 1, 'exec'], [2, 'exec', 3, 'exec']],
    )
    const named = setNodeValue(graph, ids[1], 'id', 'open')
    const result = compile({ graph: named, registry, screens: TWO, target: 'web' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = JSON.parse(result.files.find((file) => file.path.endsWith('ui.schema.json'))!.contents)
    expect(schema.home).toBe('home')
    expect(schema.screens.map((screen: { name: string }) => screen.name)).toEqual(['home', 'settings'])
    // The page it opens on is the home screen's, not every screen at once.
    const html = result.files.find((file) => file.path.endsWith('index.html'))!.contents
    expect(html).toContain('id="open"')
    expect(result.summary).toContain('2 screens')
  })

  it('compiles the screens into the mobile target', () => {
    const { graph, ids } = build(
      [['event.start', 'home'], ['nav.go', 'home'], ['event.start', 'settings']],
      [[0, 'exec', 1, 'exec']],
    )
    const named = setNodeValue(graph, ids[1], 'screen', 'settings')
    const result = compile({ graph: named, registry, screens: TWO, target: 'mobile' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dart = result.files[0].contents
    expect(dart).toContain("String _screen = \"home\"")
    expect(dart).toContain('_goTo("settings");')
    expect(dart).toContain('List<Widget> _widgetsFor(String screen)')
    expect(dart).toContain('case "settings":')
  })

  it('compiles the variables it was given, instead of losing them', () => {
    const { graph, ids } = build([['event.start'], ['state.set']], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(setNodeValue(graph, ids[1], 'name', 'count'), ids[1], 'value', 1)
    const state = [{ name: 'count', type: 'Number' as const, scope: 'app' as const, initial: '0' }]
    const result = compile({ graph: named, registry, state, target: 'web' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files.find((file) => file.path.endsWith('app.ts'))!.contents)
      .toContain('const state = app.state({ app: { count: 0 } })')
  })

  it('will not compile a graph whose navigation points nowhere', () => {
    const { graph, ids } = build([['event.start', 'home'], ['nav.go', 'home']], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(graph, ids[1], 'screen', 'nowhere')
    const result = compile({ graph: named, registry, screens: TWO, target: 'web' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('nowhere')
  })
})
