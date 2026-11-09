import { describe, it, expect, beforeEach } from 'vitest'

import { compile, type CompileTarget, type CompiledFile } from '../compile'
import { builtinBlocks } from '../blockLibrary'
import { addNode, connect, createNode, resetIds, setNodeValue } from '../graph'
import { createRegistry, type BlockGraph } from '../blockSchema'
import { createOrganization, createProject, type Project } from '../../project/targets'
import { packagePath } from './android'
import { isDesktopKind } from './desktop'

const registry = createRegistry(builtinBlocks)

/** The same fixture shape the other builder suites use. */
function build(
  blocks: Array<[type: string, x?: number, y?: number]>,
  links: Array<[from: number, fromPort: string, to: number, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const [type, x = 0, y = 0] of blocks) {
    const node = createNode(type, { x, y })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  for (const [from, fromPort, to, toPort] of links) {
    const result = connect(
      graph,
      registry,
      { node: ids[from], port: fromPort },
      { node: ids[to], port: toPort },
    )
    if (result.rejected) throw new Error(result.rejected)
    graph = result.graph
  }
  return { graph, ids }
}

const project = (): Project => createProject(createOrganization('Acme'), 'Timer')

/** A button that logs, on one screen: enough to exercise every emitter. */
function app(): BlockGraph {
  return build(
    [['event.start', 0, 0], ['logic.log', 220, 0], ['ui.button', 0, 220]],
    [[0, 'exec', 1, 'exec']],
  ).graph
}

function run(target: CompileTarget): CompiledFile[] {
  const result = compile({ graph: app(), registry, target, project: project() })
  if (!result.ok) throw new Error(result.reason)
  return result.files
}

const at = (files: CompiledFile[], suffix: string) => {
  const file = files.find((entry) => entry.path.endsWith(suffix))
  if (!file) throw new Error(`No ${suffix} in ${files.map((entry) => entry.path).join(', ')}`)
  return file.contents
}

beforeEach(resetIds)

describe('where targets are written', () => {
  it('gives each target its own tree under the project', () => {
    expect(run('android')[0].path.startsWith('targets/timer/android/')).toBe(true)
    expect(run('ios')[0].path.startsWith('targets/timer/ios/')).toBe(true)
    expect(run('windows')[0].path.startsWith('targets/timer/windows/')).toBe(true)
    expect(run('web')[0].path.startsWith('targets/timer/web/')).toBe(true)
  })

  it('never lets two targets write the same file', () => {
    const kinds: CompileTarget[] = ['android', 'ios', 'mobile', 'windows', 'macos', 'linux', 'web', 'node']
    const paths = kinds.flatMap((kind) => run(kind).map((file) => file.path))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('falls back to a default project when the caller has none', () => {
    const result = compile({ graph: app(), registry, target: 'web' })
    expect(result.ok && result.files[0].path.startsWith('targets/my-app/web/')).toBe(true)
  })

  it('names the target in the summary the way the tree does', () => {
    const result = compile({ graph: app(), registry, target: 'macos', project: project() })
    expect(result.ok && result.summary).toContain('macOS Desktop Target')
  })
})

describe('the Android target', () => {
  const files = () => run('android')

  it('writes a Gradle project, not a folder of loose files', () => {
    const paths = files().map((file) => file.path.replace('targets/timer/android/', ''))
    expect(paths).toContain('settings.gradle.kts')
    expect(paths).toContain('app/build.gradle.kts')
    expect(paths).toContain('app/src/main/AndroidManifest.xml')
    expect(paths).toContain('app/src/main/res/values/strings.xml')
  })

  it('puts the sources where the package says they go', () => {
    expect(packagePath('com.acme.timer')).toBe('com/acme/timer')
    expect(files().some((file) => file.path.endsWith('java/com/acme/timer/MainActivity.kt'))).toBe(true)
  })

  it('uses the project identifier as the application id', () => {
    const gradle = at(files(), 'app/build.gradle.kts')
    expect(gradle).toContain('applicationId = "com.acme.timer"')
    expect(gradle).toContain('namespace = "com.acme.timer"')
    expect(gradle).toContain('versionName = "1.0.0"')
  })

  it('declares the activity as the launcher', () => {
    const manifest = at(files(), 'AndroidManifest.xml')
    expect(manifest).toContain('android.intent.category.LAUNCHER')
    expect(manifest).toContain('android:name=".MainActivity"')
  })

  it('compiles the handler into a suspend function', () => {
    const kotlin = at(files(), 'MainActivity.kt')
    expect(kotlin).toMatch(/suspend fun handle_\w+\(app: AppState\)/)
    expect(kotlin).toContain('println(')
  })

  it('starts on the home screen and runs its start handlers', () => {
    const kotlin = at(files(), 'MainActivity.kt')
    expect(kotlin).toContain('var screen by mutableStateOf("home")')
    expect(kotlin).toContain('LaunchedEffect(app.screen)')
  })

  it('renders the button as a composable, not a web view', () => {
    const kotlin = at(files(), 'MainActivity.kt')
    expect(kotlin).toContain('AppButton(')
    expect(kotlin).not.toContain('WebView')
  })

  it('carries the Graphene palette into the app', () => {
    expect(at(files(), 'MainActivity.kt')).toContain('Color(0xFF111311)')
  })

  it('keeps the backend stubs apart from the generated UI', () => {
    const runtime = at(files(), 'Runtime.kt')
    expect(runtime).toContain('object Api')
    expect(runtime).toContain('object Auth')
    expect(runtime).toContain('object Storage')
  })
})

describe('the iOS target', () => {
  const files = () => run('ios')

  it('writes a buildable Swift project', () => {
    const paths = files().map((file) => file.path.replace('targets/timer/ios/', ''))
    expect(paths).toContain('Sources/App.swift')
    expect(paths).toContain('Sources/ContentView.swift')
    expect(paths).toContain('Info.plist')
  })

  it('ships an XcodeGen spec rather than an unreviewable .xcodeproj', () => {
    expect(files().some((file) => file.path.endsWith('project.yml'))).toBe(true)
    expect(files().some((file) => file.path.includes('.xcodeproj'))).toBe(false)
    expect(at(files(), 'project.yml')).toContain('PRODUCT_BUNDLE_IDENTIFIER: com.acme.timer')
  })

  it('puts the bundle identifier in the plist', () => {
    const plist = at(files(), 'Info.plist')
    expect(plist).toContain('<string>com.acme.timer</string>')
    expect(plist).toContain('<string>1.0.0</string>')
  })

  it('has one entry point', () => {
    expect(at(files(), 'App.swift')).toContain('@main')
  })

  it('compiles the handler into an async function that cannot throw out', () => {
    const swift = at(files(), 'ContentView.swift')
    expect(swift).toMatch(/func handle_\w+\(_ app: AppState\) async/)
    expect(swift).toContain('do {')
    expect(swift).toContain('} catch {')
  })

  it('renders with SwiftUI, not a web view', () => {
    const swift = at(files(), 'ContentView.swift')
    expect(swift).toContain('struct ContentView: View')
    expect(swift).not.toContain('WKWebView')
  })

  it('converts the palette into Swift colour channels', () => {
    expect(at(files(), 'ContentView.swift')).toMatch(/static let surface = Color\(red: 0\.\d+/)
  })
})

describe('the desktop targets', () => {
  it('knows which kinds it covers', () => {
    expect(isDesktopKind('windows')).toBe(true)
    expect(isDesktopKind('macos')).toBe(true)
    expect(isDesktopKind('linux')).toBe(true)
    expect(isDesktopKind('android')).toBe(false)
    expect(isDesktopKind('nonsense')).toBe(false)
  })

  it('renders with the web output, on purpose', () => {
    const paths = run('linux').map((file) => file.path.replace('targets/timer/linux/', ''))
    expect(paths).toContain('app/index.html')
    expect(paths).toContain('app/app.ts')
    expect(paths).toContain('app/ui.schema.json')
    expect(paths).toContain('main.cjs')
  })

  it('asks electron-builder for the right installer per platform', () => {
    const read = (kind: CompileTarget) => JSON.parse(at(run(kind), 'package.json'))
    expect(JSON.stringify(read('windows').build.win)).toContain('nsis')
    expect(JSON.stringify(read('macos').build.mac)).toContain('dmg')
    expect(read('linux').build.linux.target).toEqual(['AppImage', 'deb'])
  })

  it('uses the reverse-DNS id everywhere except a Linux package name', () => {
    expect(JSON.parse(at(run('macos'), 'package.json')).build.appId).toBe('com.acme.timer')
    expect(JSON.parse(at(run('linux'), 'package.json')).name).toBe('timer')
  })

  it('opens one window with no node integration', () => {
    const main = at(run('windows'), 'main.cjs')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain("loadFile(path.join(__dirname, 'app', 'index.html'))")
  })

  it('sends outside links to the real browser', () => {
    expect(at(run('macos'), 'main.cjs')).toContain('shell.openExternal')
  })

  it('quits with the last window everywhere but macOS', () => {
    expect(at(run('linux'), 'main.cjs')).toContain("process.platform !== 'darwin'")
  })

  it('writes a package.json that is valid JSON with the project version', () => {
    const manifest = JSON.parse(at(run('windows'), 'package.json'))
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.productName).toBe('Timer')
    expect(manifest.main).toBe('main.cjs')
  })
})

describe('every target', () => {
  const kinds: CompileTarget[] = ['android', 'ios', 'mobile', 'windows', 'macos', 'linux', 'web', 'node']

  it('explains itself in a README', () => {
    for (const kind of kinds) {
      if (kind === 'node') continue
      expect(run(kind).some((file) => file.path.endsWith('README.md'))).toBe(true)
    }
  })

  it('emits something for every kind', () => {
    for (const kind of kinds) expect(run(kind).length).toBeGreaterThan(0)
  })

  it('writes no empty files', () => {
    for (const kind of kinds) {
      for (const file of run(kind)) expect(file.contents.length).toBeGreaterThan(0)
    }
  })

  it('is refused by the integrity checker on the same terms', () => {
    // A `nav.go` to a screen that does not exist is an error everywhere.
    const { graph, ids } = build([['event.start', 0, 0], ['nav.go', 220, 0]], [[0, 'exec', 1, 'exec']])
    const broken = setNodeValue(graph, ids[1], 'screen', 'nowhere')
    for (const kind of kinds) {
      const result = compile({
        graph: broken,
        registry,
        target: kind,
        project: project(),
        screens: [{ name: 'home' }, { name: 'settings' }],
      })
      expect(result.ok).toBe(false)
    }
  })
})

/**
 * Every component, on every target.
 *
 * The emitters used to render a button, a field, and a line of text, and
 * quietly turn everything else -- including a stack and everything inside
 * it -- into an empty label. These tests exist so that cannot happen
 * again silently: each control has to show up, in that language's own
 * idiom, with the children it was given.
 */
describe('the component library, compiled', () => {
  /** One of each control, with two of them inside a row. */
  function gallery(): BlockGraph {
    const { graph, ids } = build(
      [
        ['event.start', 0, 0],
        ['ui.heading', 0, 100],
        ['ui.stack', 0, 200],
        ['ui.image', 300, 200],
        ['ui.checkbox', 300, 300],
        ['ui.select', 0, 400],
        ['ui.link', 0, 500],
        ['ui.divider', 0, 600],
      ],
      [
        [0, 'exec', 1, 'exec'],
        [1, 'exec', 2, 'exec'],
        [2, 'children', 3, 'exec'],
        [3, 'exec', 4, 'exec'],
        [2, 'exec', 5, 'exec'],
        [5, 'exec', 6, 'exec'],
        [6, 'exec', 7, 'exec'],
      ],
    )
    let next = setNodeValue(graph, ids[1], 'text', 'Sign up')
    next = setNodeValue(next, ids[1], 'level', 1)
    next = setNodeValue(next, ids[2], 'direction', 'row')
    next = setNodeValue(next, ids[2], 'gap', 12)
    next = setNodeValue(next, ids[3], 'src', 'https://example.com/logo.png')
    next = setNodeValue(next, ids[3], 'alt', 'Logo')
    next = setNodeValue(next, ids[4], 'id', 'terms')
    next = setNodeValue(next, ids[4], 'label', 'I accept')
    next = setNodeValue(next, ids[5], 'id', 'plan')
    next = setNodeValue(next, ids[5], 'options', 'Free, Pro, Team')
    next = setNodeValue(next, ids[6], 'text', 'Pricing')
    next = setNodeValue(next, ids[6], 'href', 'https://example.com/pricing')
    return next
  }

  function emit(target: CompileTarget, suffix: string): string {
    const result = compile({ graph: gallery(), registry, target, project: project() })
    if (!result.ok) throw new Error(result.reason)
    return at(result.files, suffix)
  }

  it('renders every control in Compose', () => {
    const kotlin = emit('android', 'MainActivity.kt')
    expect(kotlin).toContain('AppHeading(text = "Sign up", level = 1)')
    expect(kotlin).toContain('AppImage(url = "https://example.com/logo.png", alt = "Logo")')
    expect(kotlin).toContain('checked = app.fields["terms"] == "true"')
    expect(kotlin).toContain('options = listOf("Free", "Pro", "Team")')
    expect(kotlin).toContain('AppLink(text = "Pricing", url = "https://example.com/pricing")')
    expect(kotlin).toContain('HorizontalDivider(color = AppTheme.border)')
  })

  it('renders every control in SwiftUI', () => {
    const swift = emit('ios', 'ContentView.swift')
    expect(swift).toContain('AppHeading("Sign up", level: 1)')
    expect(swift).toContain('AppImage(url: "https://example.com/logo.png", alt: "Logo")')
    expect(swift).toContain('app.fields["terms"] == "true"')
    expect(swift).toContain('options: ["Free", "Pro", "Team"]')
    expect(swift).toContain('AppLink("Pricing", url: "https://example.com/pricing")')
    expect(swift).toContain('Divider().background(AppTheme.border)')
  })

  it('renders every control in Flutter', () => {
    const dart = emit('mobile', 'main.dart')
    expect(dart).toContain('Text("Sign up", style: const TextStyle(fontSize: 30')
    expect(dart).toContain('Image.network("https://example.com/logo.png", semanticLabel: "Logo")')
    expect(dart).toContain(`_fields["terms"] == 'true'`)
    expect(dart).toContain('DropdownMenuItem(value: "Pro", child: Text("Pro"))')
    expect(dart).toContain('openUrl("https://example.com/pricing")')
    expect(dart).toContain('Divider(color: AppTheme.border)')
  })

  it('nests what is inside a stack, rather than flattening it', () => {
    // The image and the checkbox are inside the row, so each language's
    // container has to be holding them -- not listing them as siblings.
    const kotlin = emit('android', 'MainActivity.kt')
    const row = kotlin.slice(kotlin.indexOf('Row(\n'), kotlin.indexOf('AppSelect('))
    expect(row).toContain('Arrangement.spacedBy(12.dp)')
    expect(row).toContain('AppImage(')
    expect(row).toContain('AppCheckbox(')

    const swift = emit('ios', 'ContentView.swift')
    const stack = swift.slice(swift.indexOf('HStack('), swift.indexOf('AppSelect('))
    expect(stack).toContain('spacing: 12')
    expect(stack).toContain('AppImage(')
    expect(stack).toContain('AppCheckbox(')

    const dart = emit('mobile', 'main.dart')
    const flutter = dart.slice(dart.indexOf('Row(\n'), dart.indexOf('DropdownButton'))
    expect(flutter).toContain('SizedBox(width: 12)')
    expect(flutter).toContain('Image.network(')
    expect(flutter).toContain('Checkbox(')
  })

  it('marks interface blocks as the widget tree rather than leaving them unmapped', () => {
    // "No mapping yet" is what an unsupported block says. A UI block is
    // supported -- it is simply not a statement on a phone.
    const dart = emit('mobile', 'main.dart')
    expect(dart).not.toContain('has no mobile mapping yet')
    expect(dart).toContain('// ui.heading is declared in the widget tree.')
  })

  it('declares a field controller for inputs on every screen, not just the first', () => {
    const { graph, ids } = build(
      [['event.start', 0, 0], ['ui.input', 0, 120], ['ui.input', 0, 240]],
      [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec']],
    )
    const named = setNodeValue(setNodeValue(graph, ids[1], 'id', 'email'), ids[2], 'id', 'password')
    const screens = [{ name: 'home' }, { name: 'second' }]
    const result = compile({ graph: named, registry, target: 'mobile', project: project(), screens })
    if (!result.ok) throw new Error(result.reason)
    const dart = at(result.files, 'main.dart')
    expect(dart).toContain('"email": TextEditingController(),')
    expect(dart).toContain('"password": TextEditingController(),')
  })

  it('pulls in Coil, because an Image block must not mean editing Gradle', () => {
    expect(at(run('android'), 'build.gradle.kts')).toContain('io.coil-kt:coil-compose')
  })
})

/**
 * Expressions, on a phone.
 *
 * The IR could only describe values that came out of a statement, so every
 * target reading the IR rather than the generated TypeScript -- which is
 * all three native ones -- turned reading a field, comparing two things or
 * doing arithmetic into `null`. The sign-in recipe compiled to an Android
 * app that really did call signUp(null, null). These tests are the reason
 * that cannot come back.
 */
describe('expressions reach the native targets', () => {
  /** A click handler whose argument comes from a pure expression block. */
  function reading(expressionType: string, values: Record<string, string | number> = {}) {
    const { graph, ids } = build(
      [
        ['ui.button', 0, 0],
        ['event.click', 0, 120],
        ['logic.log', 220, 120],
        [expressionType, 440, 120],
      ],
      [[1, 'exec', 2, 'exec']],
    )
    const definition = registry.get(expressionType)
    const port = definition?.outputs[0].id ?? 'value'
    const result = connect(graph, registry, { node: ids[3], port }, { node: ids[2], port: 'value' })
    if (result.rejected) throw new Error(result.rejected)
    let next = result.graph
    for (const [key, value] of Object.entries(values)) next = setNodeValue(next, ids[3], key, value)
    return next
  }

  /** One variable, so the state blocks have something to refer to. */
  const state = [{ name: 'count', type: 'Number' as const, scope: 'app' as const, initial: '0' }]

  function emit(graph: BlockGraph, target: CompileTarget, suffix: string): string {
    const result = compile({ graph, registry, target, project: project(), state })
    if (!result.ok) throw new Error(result.reason)
    return at(result.files, suffix)
  }

  const everywhere = (graph: BlockGraph) => ({
    kotlin: emit(graph, 'android', 'MainActivity.kt'),
    swift: emit(graph, 'ios', 'ContentView.swift'),
    dart: emit(graph, 'mobile', 'main.dart'),
  })

  it('reads a text field instead of passing null', () => {
    const { kotlin, swift, dart } = everywhere(reading('ui.value', { id: 'email' }))
    expect(kotlin).toContain('println((app.fields["email"] ?: ""))')
    expect(swift).toContain('print((app.fields["email"] ?? ""))')
    expect(dart).toContain('debugPrint(_valueOf("email"));')
  })

  it('compares as text for equality and as numbers for ordering', () => {
    // "3" < "20" is true as text and false as arithmetic. Field maps are
    // untyped, so the emitter has to choose, and it chooses per operator.
    const { kotlin, swift, dart } = everywhere(reading('logic.compare', { operator: '<', left: 3, right: 20 }))
    for (const source of [kotlin, swift, dart]) expect(source).toContain('toNumber(')
    const equal = everywhere(reading('logic.compare', { operator: '===', left: 'a', right: 'b' }))
    expect(equal.kotlin).toContain('toText(')
    expect(equal.swift).toContain('toText(')
    expect(equal.dart).toContain('toText(')
  })

  it('refuses an operator it does not recognise', () => {
    // The operator is never interpolated from a connected block, and a
    // value the inspector should not have allowed cannot become source.
    const { kotlin } = everywhere(reading('logic.compare', { operator: '&& system(', left: 1, right: 2 }))
    expect(kotlin).not.toContain('system(')
    expect(kotlin).toContain('==')
  })

  it('does arithmetic rather than emitting null', () => {
    const { kotlin, swift, dart } = everywhere(reading('logic.math', { operator: '*' }))
    for (const source of [kotlin, swift, dart]) {
      expect(source).toMatch(/toNumber\(.*\) \* toNumber\(/)
    }
  })

  it('reads the current screen and a variable', () => {
    const current = everywhere(reading('nav.current'))
    expect(current.kotlin).toContain('app.screen')
    expect(current.swift).toContain('app.screen')
    expect(current.dart).toContain('_screen')

    const variable = everywhere(reading('state.get', { name: 'count' }))
    expect(variable.kotlin).toContain('app.state["count"]')
    expect(variable.swift).toContain('app.state["count"]')
    expect(variable.dart).toContain('_state["count"]')
  })

  it('writes a variable, with somewhere to write it to', () => {
    const { graph, ids } = build(
      [['event.start', 0, 0], ['state.set', 220, 0]],
      [[0, 'exec', 1, 'exec']],
    )
    const named = setNodeValue(setNodeValue(graph, ids[1], 'name', 'count'), ids[1], 'value', 2)
    const { kotlin, swift, dart } = everywhere(named)
    expect(kotlin).toContain('app.state["count"] = 2')
    expect(kotlin).toContain('val state = mutableStateMapOf<String, Any?>()')
    expect(swift).toContain('app.state["count"] = 2')
    expect(swift).toContain('@Published var state: [String: Any] = [:]')
    expect(dart).toContain('_state["count"] = 2')
    expect(dart).toContain('final Map<String, dynamic> _state = {};')
  })

  it('ships the two conversions the generated code calls', () => {
    const files = run('android')
    expect(at(files, 'Runtime.kt')).toContain('fun toText(value: Any?): String')
    expect(at(files, 'Runtime.kt')).toContain('fun toNumber(value: Any?): Double')
    expect(at(run('ios'), 'Runtime.swift')).toContain('func toNumber(_ value: Any?) -> Double')
    expect(at(run('mobile'), 'runtime.dart')).toContain('double toNumber(Object? value)')
  })

  it('does not wrap something that is already a string', () => {
    // Readability is the point of generating source at all: toText("x")
    // in every argument would be correct and unreadable.
    const { kotlin } = everywhere(reading('ui.value', { id: 'email' }))
    expect(kotlin).not.toContain('toText("email")')
  })

  it('still compiles a sign-in form into real arguments, on all three', () => {
    const { graph, ids } = build(
      [
        ['ui.input', 0, 0],
        ['ui.button', 0, 120],
        ['event.click', 0, 240],
        ['auth.signUp', 220, 240],
        ['ui.value', 440, 240],
      ],
      [
        [2, 'exec', 3, 'exec'],
        [4, 'value', 3, 'email'],
      ],
    )
    let wired = setNodeValue(graph, ids[0], 'id', 'email')
    wired = setNodeValue(wired, ids[4], 'id', 'email')
    wired = setNodeValue(wired, ids[3], 'password', 'hunter2')
    const { kotlin, swift, dart } = everywhere(wired)
    expect(kotlin).toContain('Auth.signUp((app.fields["email"] ?: "")')
    expect(swift).toContain('Auth.signUp(email: (app.fields["email"] ?? "")')
    expect(dart).toContain('auth.signUp(_valueOf("email")')
    for (const source of [kotlin, swift, dart]) expect(source).not.toContain('signUp(null')
  })
})
