import { describe, it, expect, beforeEach } from 'vitest'

import { compile, type CompileTarget, type CompiledFile } from '../compile'
import { builtinBlocks } from '../blockLibrary'
import { addNode, connect, createNode, resetIds, setNodeValue } from '../graph'
import { createRegistry, type BlockGraph } from '../blockSchema'
import {
  createOrganization,
  createProject,
  type Project,
  type TargetKind,
  type Toolchain,
} from '../../project/targets'
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

type Toolchains = Partial<Record<TargetKind, Toolchain>>

const project = (toolchains: Toolchains = {}): Project => ({
  ...createProject(createOrganization('Acme'), 'Timer'),
  toolchains,
})

/**
 * The other toolchain for every platform that has one.
 *
 * The defaults are Flutter and Tauri, so the suites that assert on Kotlin,
 * Swift or Electron output have to ask for them -- which is the point:
 * both halves of every choice stay covered.
 */
const NATIVE: Toolchains = {
  android: 'kotlin',
  ios: 'swift',
  windows: 'electron',
  macos: 'electron',
  linux: 'electron',
}

/** A button that logs, on one screen: enough to exercise every emitter. */
function app(): BlockGraph {
  return build(
    [['event.start', 0, 0], ['logic.log', 220, 0], ['ui.button', 0, 220]],
    [[0, 'exec', 1, 'exec']],
  ).graph
}

function run(target: CompileTarget, toolchains: Toolchains = {}): CompiledFile[] {
  const result = compile({ graph: app(), registry, target, project: project(toolchains) })
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
    const kinds: CompileTarget[] = ['android', 'ios', 'mobile', 'windows', 'macos', 'linux', 'web', 'node', 'server']
    // Checked for each set of toolchains in turn. Two toolchains of the
    // same platform share a directory on purpose -- that is why the
    // generated README says to delete it before switching -- but no two
    // *targets* may ever collide, whichever way they are built.
    for (const toolchains of [{}, NATIVE]) {
      const paths = kinds.flatMap((kind) => run(kind, toolchains).map((file) => file.path))
      expect(new Set(paths).size).toBe(paths.length)
    }
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

describe('the Android target, built with Kotlin', () => {
  const files = () => run('android', NATIVE)

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

describe('the iOS target, built with Swift', () => {
  const files = () => run('ios', NATIVE)

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

describe('the desktop targets, built with Electron', () => {
  it('knows which kinds it covers', () => {
    expect(isDesktopKind('windows')).toBe(true)
    expect(isDesktopKind('macos')).toBe(true)
    expect(isDesktopKind('linux')).toBe(true)
    expect(isDesktopKind('android')).toBe(false)
    expect(isDesktopKind('nonsense')).toBe(false)
  })

  it('renders with the web output, on purpose', () => {
    const paths = run('linux', NATIVE).map((file) => file.path.replace('targets/timer/linux/', ''))
    expect(paths).toContain('app/index.html')
    expect(paths).toContain('app/app.ts')
    expect(paths).toContain('app/ui.schema.json')
    expect(paths).toContain('main.cjs')
  })

  it('asks electron-builder for the right installer per platform', () => {
    const read = (kind: CompileTarget) => JSON.parse(at(run(kind, NATIVE), 'package.json'))
    expect(JSON.stringify(read('windows').build.win)).toContain('nsis')
    expect(JSON.stringify(read('macos').build.mac)).toContain('dmg')
    expect(read('linux').build.linux.target).toEqual(['AppImage', 'deb'])
  })

  it('uses the reverse-DNS id everywhere except a Linux package name', () => {
    expect(JSON.parse(at(run('macos', NATIVE), 'package.json')).build.appId).toBe('com.acme.timer')
    expect(JSON.parse(at(run('linux', NATIVE), 'package.json')).name).toBe('timer')
  })

  it('opens one window with no node integration', () => {
    const main = at(run('windows', NATIVE), 'main.cjs')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain("loadFile(path.join(__dirname, 'app', 'index.html'))")
  })

  it('sends outside links to the real browser', () => {
    expect(at(run('macos', NATIVE), 'main.cjs')).toContain('shell.openExternal')
  })

  it('quits with the last window everywhere but macOS', () => {
    expect(at(run('linux', NATIVE), 'main.cjs')).toContain("process.platform !== 'darwin'")
  })

  it('writes a package.json that is valid JSON with the project version', () => {
    const manifest = JSON.parse(at(run('windows', NATIVE), 'package.json'))
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.productName).toBe('Timer')
    expect(manifest.main).toBe('main.cjs')
  })
})

describe('every target', () => {
  const kinds: CompileTarget[] = ['android', 'ios', 'mobile', 'windows', 'macos', 'linux', 'web', 'node', 'server']

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
    const result = compile({ graph: gallery(), registry, target, project: project(NATIVE) })
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
    expect(at(run('android', NATIVE), 'build.gradle.kts')).toContain('io.coil-kt:coil-compose')
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
    const result = compile({ graph, registry, target, project: project(NATIVE), state })
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
    const files = run('android', NATIVE)
    expect(at(files, 'Runtime.kt')).toContain('fun toText(value: Any?): String')
    expect(at(files, 'Runtime.kt')).toContain('fun toNumber(value: Any?): Double')
    expect(at(run('ios', NATIVE), 'Runtime.swift')).toContain('func toNumber(_ value: Any?) -> Double')
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

/**
 * The toolchain is a second dimension, not a rename of the target.
 *
 * A target says where the app runs; a toolchain says what it is made of.
 * These tests pin both halves: the defaults, and the fact that choosing
 * the other one actually changes what is written.
 */
describe('toolchains, compiled', () => {
  const names = (files: CompiledFile[], kind: string) => (
    files.map((file) => file.path.replace(`targets/timer/${kind}/`, ''))
  )

  it('builds Android with Flutter by default', () => {
    const files = names(run('android'), 'android')
    expect(files).toContain('lib/main.dart')
    expect(files).not.toContain('app/build.gradle.kts')
  })

  it('builds iOS with Flutter by default', () => {
    const files = names(run('ios'), 'ios')
    expect(files).toContain('lib/main.dart')
    expect(files).not.toContain('Sources/ContentView.swift')
  })

  it('writes Kotlin into the Android tree when Kotlin is chosen', () => {
    const files = names(run('android', { android: 'kotlin' }), 'android')
    expect(files).toContain('app/src/main/java/com/acme/timer/MainActivity.kt')
    expect(files).not.toContain('lib/main.dart')
  })

  it('writes Swift into the iOS tree when Swift is chosen', () => {
    const files = names(run('ios', { ios: 'swift' }), 'ios')
    expect(files.some((path) => path.endsWith('ContentView.swift'))).toBe(true)
    expect(files).not.toContain('lib/main.dart')
  })

  it('tells each Flutter target what to run, and that the folder is Flutter', () => {
    expect(at(run('android'), 'README.md')).toContain('flutter run -d android')
    expect(at(run('ios'), 'README.md')).toContain('flutter run -d ios')
    for (const kind of ['android', 'ios', 'mobile'] as const) {
      expect(at(run(kind), 'README.md')).toContain('Flutter toolchain')
    }
  })

  it('leaves the Cross-Platform Mobile Target on Flutter whatever is asked for', () => {
    // There is no second toolchain for it, and a request for one is a
    // saved file being wrong rather than a choice to honour.
    const files = names(run('mobile', { mobile: 'kotlin' as Toolchain }), 'mobile')
    expect(files).toContain('lib/main.dart')
  })

  it('builds the desktop with Tauri by default', () => {
    const files = names(run('macos'), 'macos')
    expect(files).toEqual([
      'app/index.html',
      'app/app.ts',
      'app/ui.schema.json',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'src-tauri/build.rs',
      'src-tauri/src/main.rs',
      'package.json',
      'README.md',
    ])
  })

  it('renders the Tauri window with the web output, like Electron does', () => {
    const html = at(run('windows'), 'index.html')
    expect(html).toContain('<!doctype html>')
    expect(JSON.parse(at(run('windows'), 'tauri.conf.json')).build.frontendDist).toBe('../app')
  })

  it('asks the bundler for the right installer per platform', () => {
    const targets = (kind: CompileTarget) => JSON.parse(at(run(kind), 'tauri.conf.json')).bundle.targets
    expect(targets('windows')).toEqual(['nsis', 'msi'])
    expect(targets('macos')).toEqual(['dmg', 'app'])
    expect(targets('linux')).toEqual(['appimage', 'deb'])
  })

  it('uses the project identifier and version in the Rust shell', () => {
    const config = JSON.parse(at(run('linux'), 'tauri.conf.json'))
    expect(config.identifier).toBe('com.acme.timer')
    expect(config.version).toBe('1.0.0')
    expect(at(run('linux'), 'Cargo.toml')).toContain('name = "timer"')
  })

  it('grants the page nothing from the machine', () => {
    const main = at(run('macos'), 'main.rs')
    expect(main).toContain('tauri::Builder::default()')
    expect(main).not.toContain('.invoke_handler(')
    expect(main).toContain('generate_context!()')
  })

  it('switches the desktop to Electron when Electron is chosen', () => {
    const files = names(run('windows', { windows: 'electron' }), 'windows')
    expect(files).toContain('main.cjs')
    expect(files).not.toContain('src-tauri/Cargo.toml')
  })

  it('warns that the folder belongs to the toolchain that wrote it', () => {
    expect(at(run('macos'), 'README.md')).toContain('delete')
    expect(at(run('macos', NATIVE), 'README.md')).toContain('delete')
    expect(at(run('android'), 'README.md')).toContain('delete')
  })
})

/**
 * The stubs are gone.
 *
 * Every target used to ship an `Api`/`Auth`/`Storage` that printed what it
 * would have done. They now call the backend the Backend Service target
 * writes, which is only worth anything if all five runtimes agree on the
 * same URLs -- so this checks them against each other, not one at a time.
 */
describe('the generated runtimes call the generated backend', () => {
  const kotlin = () => at(run('android', NATIVE), 'Runtime.kt')
  const swift = () => at(run('ios', NATIVE), 'Runtime.swift')
  const dart = () => at(run('mobile'), 'runtime.dart')
  const web = () => at(run('web'), 'index.html')

  it('no longer prints instead of asking', () => {
    expect(kotlin()).not.toContain('println("select from "')
    expect(swift()).not.toContain('print("select from')
    expect(dart()).not.toContain("debugPrint('select")
  })

  it('agrees on every route', () => {
    for (const source of [kotlin(), swift(), dart(), web()]) {
      expect(source).toContain('/auth/sign-up')
      expect(source).toContain('/auth/session')
      expect(source).toContain('/auth/oauth')
      expect(source).toContain('/data/')
      expect(source).toContain('/storage/')
    }
  })

  it('sends the session as a bearer token once there is one', () => {
    expect(kotlin()).toContain('"Bearer " + it')
    expect(swift()).toContain('"Bearer " + token')
    expect(dart()).toContain("'Bearer ' + token")
    expect(web()).toContain("'Bearer ' + AUTH_TOKEN")
  })

  it('knows that an emulator cannot see localhost', () => {
    // 10.0.2.2 is the host machine from inside the Android emulator, and
    // getting this wrong is the most common first-run failure there.
    expect(kotlin()).toContain('http://10.0.2.2:8787')
    expect(dart()).toContain('http://10.0.2.2:8787')
    expect(swift()).toContain('http://localhost:8787')
  })

  it('asks for the permissions plain HTTP to a local service needs', () => {
    expect(at(run('android', NATIVE), 'AndroidManifest.xml')).toContain('android:usesCleartextTraffic="true"')
    expect(at(run('ios', NATIVE), 'Info.plist')).toContain('NSAllowsLocalNetworking')
  })

  it('leaves the in-IDE preview talking to nobody', async () => {
    const { previewHtml } = await import('../previewRuntime')
    const preview = previewHtml({ document: { components: [] }, code: '' })
    expect(preview).toContain('const API_BASE = "";')
    expect(web()).toContain('const API_BASE = "http://localhost:8787";')
  })

  it('surfaces the backend\u2019s own words when a call fails', () => {
    for (const source of [kotlin(), swift(), dart(), web()]) {
      expect(source).toContain('error')
      expect(source).toMatch(/Request failed/)
    }
  })
})

/**
 * Update, delete, sign in, sign out — on the phones too.
 *
 * A block that works on the web and compiles to a comment on Android is
 * not a block, it is a trap. The four blocks added once the backend could
 * answer them are checked in all three native languages at once.
 */
describe('the newest backend blocks reach the native targets', () => {
  /** One chain with all four, filled in. */
  function chain(): BlockGraph {
    const { graph, ids } = build(
      [
        ['event.start', 0, 0],
        ['data.update', 220, 0],
        ['data.remove', 440, 0],
        ['auth.signIn', 660, 0],
        ['auth.signOut', 880, 0],
      ],
      [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'], [2, 'exec', 3, 'exec'], [3, 'exec', 4, 'exec']],
    )
    let next = setNodeValue(graph, ids[1], 'table', 'notes')
    next = setNodeValue(next, ids[1], 'id', '7')
    next = setNodeValue(next, ids[1], 'changes', '{ done: true }')
    next = setNodeValue(next, ids[2], 'table', 'notes')
    next = setNodeValue(next, ids[2], 'id', '7')
    next = setNodeValue(next, ids[3], 'email', 'ada@example.com')
    next = setNodeValue(next, ids[3], 'password', 'correct horse')
    return next
  }

  function emit(target: CompileTarget, suffix: string, toolchains: Toolchains = NATIVE): string {
    const result = compile({ graph: chain(), registry, target, project: project(toolchains) })
    if (!result.ok) throw new Error(result.reason)
    return at(result.files, suffix)
  }

  it('compiles all four, in every language', () => {
    const kotlin = emit('android', 'MainActivity.kt')
    expect(kotlin).toContain('Api.update("notes", "7"')
    expect(kotlin).toContain('Api.remove("notes", "7")')
    expect(kotlin).toContain('Auth.signIn("ada@example.com", "correct horse")')
    expect(kotlin).toContain('Auth.signOut()')

    const swift = emit('ios', 'ContentView.swift')
    expect(swift).toContain('Api.update("notes", id: "7"')
    expect(swift).toContain('try await Api.remove("notes", id: "7")')
    expect(swift).toContain('Auth.signIn(email: "ada@example.com", password: "correct horse")')
    expect(swift).toContain('try await Auth.signOut()')

    const dart = emit('mobile', 'main.dart', {})
    expect(dart).toContain("api.update(\"notes\", \"7\"")
    expect(dart).toContain("await api.remove(\"notes\", \"7\");")
    expect(dart).toContain('auth.signIn("ada@example.com", "correct horse")')
    expect(dart).toContain('await auth.signOut();')
  })

  it('leaves no block as a comment saying it has no mapping', () => {
    for (const source of [
      emit('android', 'MainActivity.kt'),
      emit('ios', 'ContentView.swift'),
      emit('mobile', 'main.dart', {}),
    ]) {
      expect(source).not.toMatch(/has no (Android|iOS|Flutter) mapping yet/)
    }
  })

  it('ships the runtime methods those calls land on', () => {
    expect(at(run('android', NATIVE), 'Runtime.kt')).toContain('suspend fun update(table: String, id: String')
    expect(at(run('ios', NATIVE), 'Runtime.swift')).toContain('static func update(_ table: String, id: String')
    expect(at(run('mobile'), 'runtime.dart')).toContain('Future<void> remove(String table, String id)')
  })

  it('sends them to the routes the generated backend serves', () => {
    const server = at(run('server'), 'main.js')
    for (const source of [
      at(run('android', NATIVE), 'Runtime.kt'),
      at(run('ios', NATIVE), 'Runtime.swift'),
      at(run('mobile'), 'runtime.dart'),
      at(run('web'), 'index.html'),
    ]) {
      expect(source).toContain('/auth/sign-in')
      expect(source).toContain('/auth/sign-out')
      expect(source).toContain('PATCH')
      expect(source).toContain('DELETE')
    }
    expect(server).toContain("path === '/auth/sign-in'")
    expect(server).toContain("path === '/auth/sign-out'")
  })
})
