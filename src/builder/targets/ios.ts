/**
 * The iOS App Target.
 *
 * Swift and SwiftUI from the same IR. The project file is generated as an
 * XcodeGen spec rather than a `.xcodeproj`: an Xcode project is a large,
 * machine-written plist whose diff is unreadable and whose merge conflicts
 * are unresolvable, and regenerating one from a twelve-line YAML file is
 * both more honest and more likely to still work in two years.
 */

import { headingLevelOf, optionsOf, type ComponentSchema } from '../uiSchema'
import { uiThemeSwift } from '../uiTokens'
import type { CompiledFile, Ir, IrEvent, IrStatement, IrValue } from '../compile'
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, objectIn, operatorOf, parseObjectLiteral, rowFields } from './expressions'
import { appIdFor, slug, type Project } from '../../project/targets'
import { DEFAULT_API_URL } from './server'
import { renderPath, wirePlan, type WirePlan } from './wire'
import type { RuntimeProfile } from '../../backend/runtimeProfile'

function handlerName(nodeId: string): string {
  return `handle_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function literal(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** One IR statement, as Swift. */
/**
 * A value, as Swift.
 *
 * Same three arms as every other target: literal, the variable a statement
 * bound, or a pure expression block lowered where it is used.
 */
function swiftValue(value: IrValue | undefined, names: Map<string, string>): string {
  if (!value || value.kind === 'empty') return 'nil'
  if (value.kind === 'literal') return literal(value.value)
  if (value.kind === 'reference') return names.get(value.node) ?? 'nil'

  const input = (id: string) => swiftValue(value.inputs[id], names)
  const key = (id: string) => (isTextual(value.inputs[id]) ? input(id) : `toText(${input(id)})`)
  switch (value.type) {
    case 'ui.value':
      return `(app.fields[${key('id')}] ?? "")`
    case 'state.get':
      return `app.state[${key('name')}]`
    case 'nav.current':
      return 'app.screen'
    case 'data.text':
    case 'data.number':
      return input('value')
    case 'data.row':
      return objectIn('swift', rowFields(value, (field) => swiftValue(field, names)))
    case 'logic.exists':
      return `(${input('value')} != nil)`
    case 'logic.compare': {
      const operator = operatorOf(value, COMPARISONS, '===')
      if (isEquality(operator)) {
        return `(toText(${input('left')}) ${operator === '===' ? '==' : '!='} toText(${input('right')}))`
      }
      return `(toNumber(${input('left')}) ${operator} toNumber(${input('right')}))`
    }
    case 'logic.math':
      return `(toNumber(${input('left')}) ${operatorOf(value, ARITHMETIC, '+')} toNumber(${input('right')}))`
    default:
      return `nil /* ${value.type} has no iOS mapping yet */`
  }
}

export function swiftStatement(
  statement: IrStatement,
  indent: string,
  names: Map<string, string>,
): string[] {
  const value = (id: string): string => swiftValue(statement.inputs[id], names)

  // Swift will not interpolate an Optional without complaining, and the
  // generated app should not be full of warnings on first open. toText is
  // in the runtime file and takes anything, optional or not.
  const text = (id: string) => (isTextual(statement.inputs[id]) ? value(id) : `toText(${value(id)})`)

  /**
   * The same value where an object is wanted.
   *
   * A typed-in `{ title: "Hello" }` is text on the canvas and has to be
   * a map by the time it reaches the backend; anything this cannot read
   * as a flat object literal is left exactly as it was.
   */
  const object = (id: string): string => {
    const input = statement.inputs[id]
    if (input && input.kind === 'literal' && typeof input.value === 'string') {
      const entries = parseObjectLiteral(input.value)
      if (entries) return objectIn('swift', entries)
    }
    return value(id)
  }

  const name = () => {
    const existing = names.get(statement.node)
    if (existing) return existing
    const base = statement.type.split('.').pop() ?? 'value'
    const assigned = `${base}${names.size + 1}`
    names.set(statement.node, assigned)
    return assigned
  }

  const body = (slot: string): string[] => (statement.bodies[slot] ?? [])
    .flatMap((child) => swiftStatement(child, `${indent}  `, names))

  switch (statement.type) {
    case 'logic.log':
      return [`${indent}print(${text('value')})`]
    case 'nav.go':
      return [`${indent}app.goTo(${text('screen')})`]
    case 'nav.back':
      return [`${indent}app.back()`]
    case 'ui.text':
      return [`${indent}app.output.append(${text('value')})`]
    case 'ui.button':
      return [`${indent}// Button ${text('text')} is declared in the view.`]
    case 'ui.input':
      return [`${indent}// Input ${text('id')} is declared in the view.`]
    case 'logic.if': {
      const inner = body('body')
      const otherwise = body('else')
      const lines = [`${indent}if (${value('condition')} as? Bool) == true {`, ...inner, `${indent}}`]
      return otherwise.length
        ? [...lines.slice(0, -1), `${indent}} else {`, ...otherwise, `${indent}}`]
        : lines
    }
    case 'logic.forEach':
      return [
        `${indent}for item in (${value('list')} as? [Any?] ?? []) {`,
        ...body('body'),
        `${indent}}`,
      ]
    case 'data.query':
      return [`${indent}let ${name()} = try await Api.select(${text('table')})`]
    case 'data.insert':
      return [`${indent}let ${name()} = try await Api.insert(${text('table')}, ${object('row')})`]
    case 'data.update':
      return [`${indent}let ${name()} = try await Api.update(${text('table')}, id: ${text('id')}, changes: ${object('changes')})`]
    case 'data.remove':
      return [`${indent}try await Api.remove(${text('table')}, id: ${text('id')})`]
    case 'network.fetch':
      return [`${indent}let ${name()} = try await Api.request(${text('url')}, method: ${text('method')})`]
    case 'auth.signUp':
      return [`${indent}let ${name()} = try await Auth.signUp(email: ${text('email')}, password: ${text('password')})`]
    case 'auth.signIn':
      return [`${indent}let ${name()} = try await Auth.signIn(email: ${text('email')}, password: ${text('password')})`]
    case 'auth.signOut':
      return [`${indent}try await Auth.signOut()`]
    case 'auth.oauth':
      return [`${indent}let ${name()} = try await Auth.oauth(${text('provider')})`]
    case 'auth.session':
      return [`${indent}let ${name()} = try await Auth.session()`]
    case 'storage.upload':
      return [`${indent}let ${name()} = try await Storage.upload(bucket: ${text('bucket')}, file: ${value('file')})`]
    case 'state.set':
      return [`${indent}app.state[${text('name')}] = ${value('value')}`]
    default:
      return [`${indent}// ${statement.type} has no iOS mapping yet.`]
  }
}

/**
 * One component, as a SwiftUI view.
 *
 * Recursive, so a stack becomes a VStack or an HStack holding the same
 * children the canvas drew inside it.
 */
function view(component: ComponentSchema, indent = CASE_BODY): string {
  const text = (key: string, fallback: string) => JSON.stringify(String(component.properties[key] ?? fallback))
  const id = JSON.stringify(component.id)
  /** A two-way binding onto the field this component owns. */
  const binding = (fallback: string, inner = indent) => `Binding(
${inner}    get: { app.fields[${id}] ?? ${fallback} },
${inner}    set: { app.fields[${id}] = $0 }
${inner})`

  if (component.type === 'button') {
    const call = component.events.click
      ? `Task { await ${handlerName(component.events.click)}(app) }`
      : '()'
    return `${indent}AppButton(title: ${text('text', 'Submit')}) { ${call} }`
  }
  if (component.type === 'input') {
    return `${indent}AppInput(
${indent}    placeholder: ${text('placeholder', '')},
${indent}    text: ${binding('""', `${indent}    `)}
${indent})`
  }
  if (component.type === 'heading') {
    return `${indent}AppHeading(${text('text', '')}, level: ${headingLevelOf(component)})`
  }
  if (component.type === 'image') {
    return `${indent}AppImage(url: ${text('src', '')}, alt: ${text('alt', 'Image')})`
  }
  if (component.type === 'checkbox') {
    // "true"/"false" in the same field map every other control writes to,
    // so the Input Value block reads one kind of thing on every target.
    return `${indent}AppCheckbox(
${indent}    label: ${text('label', '')},
${indent}    isOn: Binding(
${indent}        get: { app.fields[${id}] == "true" },
${indent}        set: { app.fields[${id}] = $0 ? "true" : "false" }
${indent}    )
${indent})`
  }
  if (component.type === 'select') {
    const choices = optionsOf(component)
    const initial = String(component.properties.value ?? '') || choices[0] || ''
    return `${indent}AppSelect(
${indent}    options: [${choices.map((choice) => JSON.stringify(choice)).join(', ')}],
${indent}    selection: ${binding(JSON.stringify(initial), `${indent}    `)}
${indent})`
  }
  if (component.type === 'link') {
    return `${indent}AppLink(${text('text', '')}, url: ${text('href', '')})`
  }
  if (component.type === 'divider') {
    return `${indent}Divider().background(AppTheme.border)`
  }
  if (component.type === 'stack') {
    const row = String(component.properties.direction ?? 'column') === 'row'
    const gap = Number(component.properties.gap ?? 10)
    const children = (component.children ?? []).map((child) => view(child, `${indent}    `))
    return `${indent}${row ? 'HStack' : 'VStack'}(alignment: .${row ? 'center' : 'leading'}, spacing: ${gap}) {
${children.join('\n') || `${indent}    EmptyView()`}
${indent}}`
  }
  return `${indent}AppText(${text('value', '')})`
}

/** Where a `switch app.screen` case and its body sit, in the file. */
const CASE = ' '.repeat(20)
const CASE_BODY = ' '.repeat(24)

function screenCase(screen: { name: string; components: ComponentSchema[] }): string {
  const body = screen.components.length
    ? screen.components.map((component) => view(component, CASE_BODY)).join('\n')
    : `${CASE_BODY}AppText("This screen has nothing on it yet.")`
  return `${CASE}case ${JSON.stringify(screen.name)}:\n${body}`
}

function startCase(screen: { name: string; events: IrEvent[] }): string {
  const starts = screen.events
    .filter((event) => event.type === 'event.start')
    .map((event) => `            await ${handlerName(event.node)}(app)`)
  return `        case ${JSON.stringify(screen.name)}:\n${
    starts.length ? starts.join('\n') : '            break // No start event on this screen.'
  }`
}

function contentView(ir: Ir, project: Project): string {
  const names = new Map<string, string>()
  const handlers = ir.events.map((event) => {
    const body = event.body.flatMap((statement) => swiftStatement(statement, '    ', names))
    return `@MainActor
func ${handlerName(event.node)}(_ app: AppState) async {
    do {
${body.join('\n') || '        // Nothing connected yet.'}
    } catch {
        print("handler failed: \\(error)")
    }
}`
  })

  return `// Generated by the Tungsten builder for ${project.name}.
// SwiftUI, from the same graph as every other target.

import SwiftUI

/// Graphene, from src/theme/tokens.json. One palette, every target.
enum AppTheme {
${uiThemeSwift()}
}

/// Everything the app remembers.
///
/// Navigation is state, not a NavigationStack: the app is one view tree,
/// so going back pops a string. That keeps the generated Swift short
/// enough to read, which is the whole point of generating it.
@MainActor
final class AppState: ObservableObject {
    @Published var output: [String] = []
    @Published var fields: [String: String] = [:]

    /// The app's variables, under the name the web target uses for them.
    @Published var state: [String: Any] = [:]
    @Published private(set) var screen: String = ${JSON.stringify(ir.home)}
    private var trail: [String] = []

    func goTo(_ next: String) {
        guard next != screen else { return }
        trail.append(screen)
        output.removeAll()
        screen = next
    }

    func back() {
        guard let previous = trail.popLast() else { return }
        output.removeAll()
        screen = previous
    }
}

struct ContentView: View {
    @StateObject private var app = AppState()

    var body: some View {
        ZStack {
            AppTheme.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    switch app.screen {
${ir.screens.map(screenCase).join('\n')}
                    default:
                        AppText("Unknown screen \\(app.screen)")
                    }
                    ForEach(Array(app.output.enumerated()), id: \\.offset) { _, line in
                        AppText(line)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
            }
        }
        // Entering a screen runs that screen's start handlers, as on every
        // other target.
        .task(id: app.screen) {
            switch app.screen {
${ir.screens.map(startCase).join('\n')}
            default:
                break
            }
        }
    }
}

struct AppText: View {
    let value: String
    init(_ value: String) { self.value = value }
    var body: some View { Text(value).foregroundStyle(AppTheme.text) }
}

struct AppButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .foregroundStyle(AppTheme.accentInk)
                .background(AppTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.radius))
        }
        .buttonStyle(.plain)
    }
}

struct AppInput: View {
    let placeholder: String
    @Binding var text: String
    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .padding(8)
            .background(AppTheme.raised)
            .foregroundStyle(AppTheme.text)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.radius))
    }
}

/// A heading. The level picks a font role rather than a point size.
struct AppHeading: View {
    let value: String
    let level: Int
    init(_ value: String, level: Int) {
        self.value = value
        self.level = level
    }
    var body: some View {
        Text(value)
            .font(level == 1 ? .largeTitle : level == 2 ? .title : level == 3 ? .title2 : .headline)
            .fontWeight(.semibold)
            .foregroundStyle(AppTheme.text)
    }
}

/// A remote image, or a labelled box while there is no URL to load.
struct AppImage: View {
    let url: String
    let alt: String
    var body: some View {
        if let link = URL(string: url), !url.isEmpty {
            AsyncImage(url: link) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                AppText(alt)
            }
            .accessibilityLabel(alt)
        } else {
            Text(alt)
                .foregroundStyle(AppTheme.textMuted)
                .padding(12)
                .frame(minWidth: 180, minHeight: 110)
                .background(AppTheme.raised)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.radius))
        }
    }
}

struct AppCheckbox: View {
    let label: String
    @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) {
            Text(label).foregroundStyle(AppTheme.text)
        }
        .toggleStyle(.switch)
        .tint(AppTheme.accent)
    }
}

struct AppSelect: View {
    let options: [String]
    @Binding var selection: String
    var body: some View {
        Picker("", selection: $selection) {
            ForEach(options, id: \\.self) { option in
                Text(option).tag(option)
            }
        }
        .pickerStyle(.menu)
        .tint(AppTheme.accent)
    }
}

/// A link out of the app. Going to another screen is a handler, not this.
struct AppLink: View {
    let value: String
    let url: String
    init(_ value: String, url: String) {
        self.value = value
        self.url = url
    }
    var body: some View {
        if let link = URL(string: url) {
            Link(value, destination: link).foregroundStyle(AppTheme.accent)
        } else {
            AppText(value)
        }
    }
}

${handlers.join('\n\n') || '// No handlers yet.'}
`
}

export function iosFiles(ir: Ir, project: Project, profile?: RuntimeProfile): CompiledFile[] {
  const identifier = appIdFor(project, 'ios')
  const name = slug(project.name) || 'app'
  // The simulator shares the Mac's loopback, so a backend on the
  // developer's machine is simply localhost here -- unlike Android,
  // which needs 10.0.2.2.
  const plan = wirePlan(profile)

  return [
    {
      path: 'Sources/App.swift',
      contents: `// The entry point. Everything else is in ContentView.swift.

import SwiftUI

@main
struct GeneratedApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
`,
    },
    { path: 'Sources/ContentView.swift', contents: contentView(ir, project) },
    {
      path: 'Sources/Runtime.swift',
      contents: `// The services a generated app talks to.
//
${plan.base
    ? `// Not stubs: these call the ${plan.dialect} API this project is configured
// for. The address and the keys below came from the project's backend
// settings; server-only credentials are deliberately not here, because an
// installed app is readable by whoever has it.`
    : `// Not stubs: these call the backend the builder writes alongside this app.
// Build the Backend Service target, run \`node main.js\` in it, and sign-up,
// the drawn tables and file uploads all work from here.`}
//
// Foundation has everything needed -- URLSession and JSONSerialization --
// so there is no package to add.

import Foundation

/// Values out of a field map have no static type, so the two conversions
/// every generated comparison needs live here. Equality compares text and
/// ordering compares numbers, because "3" < "20" being true is a bug that
/// takes an hour to find in code you did not write.
func toText(_ value: Any?) -> String {
    guard let value else { return "" }
    return String(describing: value)
}

func toNumber(_ value: Any?) -> Double {
    switch value {
    case let number as Double: return number
    case let number as Int: return Double(number)
    case let flag as Bool: return flag ? 1 : 0
    case let text as String: return Double(text) ?? 0
    default: return 0
    }
}

${swiftBackend(plan)}
`,
    },
    {
      path: 'Info.plist',
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>${project.name.replace(/[<&]/g, '')}</string>
    <key>CFBundleIdentifier</key>
    <string>${identifier}</string>
    <key>CFBundleShortVersionString</key>
    <string>${project.version}</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>UILaunchScreen</key>
    <dict/>
    <key>UIUserInterfaceStyle</key>
    <string>Dark</string>
    <!-- The generated backend runs on plain HTTP while it is on your
         machine, and App Transport Security blocks that by default. This
         exception covers local addresses only; delete it once the backend
         is on a real host with TLS. -->
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
</dict>
</plist>
`,
    },
    {
      path: 'project.yml',
      contents: `# An XcodeGen spec, not an .xcodeproj.
#
# Run \`xcodegen generate\` to produce the project. Keeping the spec in
# source control instead of the generated project is what makes this
# folder reviewable and mergeable.

name: ${name}
options:
  bundleIdPrefix: ${identifier.split('.').slice(0, -1).join('.')}
  deploymentTarget:
    iOS: "16.0"
targets:
  ${name}:
    type: application
    platform: iOS
    sources: [Sources]
    info:
      path: Info.plist
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${identifier}
        MARKETING_VERSION: "${project.version}"
        SWIFT_VERSION: "5.9"
`,
    },
    {
      path: 'README.md',
      contents: `# ${project.name} — iOS

Generated by the Tungsten builder. SwiftUI; no web view.

\`\`\`bash
brew install xcodegen   # once
xcodegen generate       # writes ${name}.xcodeproj from project.yml
open ${name}.xcodeproj
\`\`\`

- \`Sources/ContentView.swift\` is the interface and the handlers your blocks
  became.
- \`Sources/Runtime.swift\` is the backend this project is configured for,
  written out as Swift: ${plan.base
    ? `calls to \`${plan.base}\`. Server-only keys are deliberately absent,
  because an installed app can be read.`
    : `calls to the generated service. Build the Backend Service target, run
  \`node main.js\` in it, and the auth, table and upload blocks work against
  it.`}

Bundle identifier \`${identifier}\`, version ${project.version}, both from the
project in the Targets panel. Xcode is required, and so is macOS; that is
Apple's rule, not Tungsten's.
`,
    },
  ]
}

/* ------------------------------------------------------------- the backend */

/** `"text"` as a Swift string literal. */
function swiftString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const SWIFT = {
  quote: swiftString,
  escape: (expression: string) => `encode(${expression})`,
  join: ' + ',
}

/** A wire path as a Swift expression, with the placeholders filled in. */
function swiftPath(path: string, values: Record<string, string>): string {
  return renderPath(path, values, SWIFT)
}

/** The rows of a reply, wherever this backend keeps them. */
function swiftRows(plan: WirePlan): string {
  const found = plan.list.envelope === 'array'
    ? 'rowsOf(reply)'
    : `rowsOf(asMap(reply)[${swiftString(plan.list.envelope)}])`
  return plan.renames.length ? `${found}.map(document)` : found
}

/** One row of a reply, wherever this backend keeps it. */
function swiftRow(plan: WirePlan, step: WirePlan['create'] | WirePlan['modify']): string {
  const found = step.envelope === 'self'
    ? 'asMap(reply)'
    : step.envelope === 'row'
      ? 'asMap(asMap(reply)["row"])'
      : 'rowsOf(reply).first ?? [:]'
  return plan.renames.length ? `document(${found})` : found
}

/** The arguments a write needs: the body, wrapped, and any extra header. */
function swiftWrite(step: WirePlan['create'] | WirePlan['modify'], body: string): string {
  let wrapped = step.wrap ? `[${swiftString(step.wrap)}: ${body}]` : body
  if (step.idField) {
    const id = `${swiftString(step.idField.key)}: ${swiftString(step.idField.value)}`
    wrapped = step.wrap
      ? `[${id}, ${swiftString(step.wrap)}: ${body}]`
      : `${body}.merging([${id}]) { current, _ in current }`
  }
  const prefer = step.prefer ? `, headers: ["prefer": ${swiftString(step.prefer)}]` : ''
  return `method: ${swiftString(step.method)}, body: ${wrapped}${prefer}`
}

/**
 * Translating this backend's own field names, where it has them.
 *
 * Nothing at all for most backends: the generated file does not carry
 * a function it would never call.
 */
function swiftRenames(plan: WirePlan): string {
  if (!plan.renames.length) return ''
  const copies = plan.renames
    .map(([wire, local]) => `    if let value = document[${swiftString(wire)}] { row[${swiftString(local)}] = value }`)
    .join('\n')
  const owned = plan.renames.map(([, local]) => swiftString(local)).join(', ')
  return `
/// This backend's own fields, under the names the blocks use.
///
/// A block drawn against a table says row.id whatever is underneath it,
/// so the fields this backend prefixes are copied across and the
/// prefixed originals left behind.
private func document(_ document: [String: Any]) -> [String: Any] {
    var row: [String: Any] = [:]
    for (key, value) in document where !key.hasPrefix("$") { row[key] = value }
${copies}
    return row
}

/// The other direction. The fields the backend owns cannot be written
/// back to it: sending them is an error, not a no-op.
private func data(_ row: [String: Any]) -> [String: Any] {
    let owned: Set<String> = [${owned}]
    var body: [String: Any] = [:]
    for (key, value) in row where !key.hasPrefix("$") && !owned.contains(key) { body[key] = value }
    return body
}
`
}

/** The filter encoder for this dialect, and nothing else. */
function swiftFilter(plan: WirePlan): string {
  switch (plan.list.filter) {
    case 'postgrest':
      return `/// A filter as PostgREST parameters: column=eq.value.
private func query(_ filters: [String: Any]) -> String {
    var query = "?select=*"
    for (key, value) in filters { query += "&" + encode(key) + "=eq." + encode(toText(value)) }
    return query
}`
    case 'pocketbase':
      return `/// A filter as a PocketBase expression.
///
/// There is no parameter binding on the wire here: the value is quoted
/// into the expression, so a quote inside it has to be escaped or it
/// ends the string early.
private func query(_ filters: [String: Any]) -> String {
    if filters.isEmpty { return "" }
    let tests = filters.map { key, value in
        key + "='" + toText(value).replacingOccurrences(of: "'", with: "\\\\'") + "'"
    }
    return "?filter=" + encode(tests.joined(separator: " && "))
}`
    case 'queries':
      return `/// A filter as Appwrite queries.
///
/// Each test is a JSON document of its own, in its own queries[]
/// parameter: there is no column=value form to fall back on.
private func query(_ filters: [String: Any]) -> String {
    if filters.isEmpty { return "" }
    var parts: [String] = []
    for (index, entry) in filters.enumerated() {
        let test: [String: Any] = ["method": "equal", "attribute": entry.key, "values": [entry.value]]
        let encoded = (try? JSONSerialization.data(withJSONObject: test)) ?? Data()
        parts.append("queries[\\(index)]=" + encode(String(data: encoded, encoding: .utf8) ?? ""))
    }
    return "?" + parts.joined(separator: "&")
}`
    case 'tree':
      return `/// A filter as the tree this backend takes in the body of a query.
private func whereBody(_ filters: [String: Any]) -> [String: Any] {
    if filters.isEmpty { return [:] }
    let tests = filters.map { key, value in ["column": key, "op": "eq", "value": value] }
    return ["where": ["all": tests]]
}`
    default:
      return `/// A filter as the query string the generated service reads.
private func query(_ filters: [String: Any]) -> String {
    if filters.isEmpty { return "" }
    return "?" + filters.map { key, value in encode(key) + "=" + encode(toText(value)) }.joined(separator: "&")
}`
  }
}

/** Sign-up, sign-in, session and sign-out, as this backend spells them. */
function swiftAuth(plan: WirePlan): string {
  const credentials = plan.signUp.body === 'record'
    ? '["email": email, "password": password, "passwordConfirm": password]'
    : plan.signUp.body === 'account'
      // "unique()" is this backend's way of saying the server picks.
      ? '["userId": "unique()", "email": email, "password": password]'
      : '["email": email, "password": password]'

  const signUp = plan.signUp.thenSignIn
    ? `        // Creating the account does not start a session here, so the app
        // signs in straight afterwards rather than handing back a user who
        // cannot read anything.
        _ = try await call(${swiftString(plan.signUp.path)}, method: "POST", body: ${credentials})
        return try await signIn(email: email, password: password)`
    : `        return accept(try await call(${swiftString(plan.signUp.path)}, method: "POST", body: ${credentials}))`

  const identity = plan.signIn.identity === 'identity'
    ? '["identity": email, "password": password]'
    : '["email": email, "password": password]'

  const suffix = plan.oauth.suffix ? ` + ${swiftString(plan.oauth.suffix)}` : ''
  const oauth = plan.oauth.kind === 'url'
    ? `    /// The provider's address, built from the backend's own. Opening it
    /// is the app's call: only it knows whether that is a sheet, a tab or
    /// an ASWebAuthenticationSession.
    static func oauth(_ provider: String) async throws -> [String: Any] {
        ["url": Backend.baseUrl + ${swiftString(plan.oauth.path)} + encode(provider)${suffix}, "provider": provider]
    }`
    : `    /// Starts a provider round trip. The reply carries the URL to open --
    /// opening it is the app's call, not the runtime's.
    static func oauth(_ provider: String) async throws -> [String: Any] {
        asMap(try await call(${swiftString(plan.oauth.path)}, method: "POST", body: ["provider": provider]))
    }`

  const signOut = plan.signOut
    ? `        if Backend.token != nil { _ = try await call(${swiftString(plan.signOut.path)}, method: ${swiftString(plan.signOut.method)}) }
        Backend.token = nil`
    : `        // Signing out is local here: the backend keeps no session to end.
        Backend.token = nil`

  return `enum Auth {
    static func signUp(email: String, password: String) async throws -> [String: Any] {
${signUp}
    }

    static func signIn(email: String, password: String) async throws -> [String: Any] {
${plan.signIn.then === 'session'
    ? `        // The reply to this is a session: it carries the secret and
        // nothing a screen can show, so the account is read next.
        _ = accept(try await call(${swiftString(plan.signIn.path)}, method: "POST", body: ${identity}))
        return accept(try await call(${swiftString(plan.session.path)}, method: ${swiftString(plan.session.method)}))`
    : `        accept(try await call(${swiftString(plan.signIn.path)}, method: "POST", body: ${identity}))`}
    }

${oauth}

    static func session() async throws -> [String: Any]? {
        guard Backend.token != nil else { return nil }
        do {
            return accept(try await call(${swiftString(plan.session.path)}, method: ${swiftString(plan.session.method)}))
        } catch {
            // An expired token is nobody being signed in, not a failure
            // the app has to handle.
            Backend.token = nil
            return nil
        }
    }

    static func signOut() async throws {
${signOut}
    }
}`
}

/** Uploading a file, and working out what its URL is afterwards. */
function swiftStorage(plan: WirePlan): string {
  const { upload } = plan
  const path = swiftPath(upload.path, { bucket: 'bucket', name: 'name' })

  // A reply nobody reads is a warning in the generated app, so the
  // binding only appears when the address below is built from it.
  const keeps = upload.idInPath || Boolean(upload.urlKey)
  const open = keeps ? 'let reply = asMap(try await call(' : '_ = try await call('
  const close = keeps ? '))' : ')'

  const send = upload.form
    ? `        let boundary = "tungsten-" + String(Int(Date().timeIntervalSince1970 * 1000))
        ${open}
            ${path},
            method: "POST",
            bytes: multipart(boundary: boundary, name: name, bytes: bytes),
            headers: ["content-type": "multipart/form-data; boundary=" + boundary]
        ${close}`
    : `        ${open}
            ${path},
            method: "POST",
            bytes: bytes${upload.path.includes('{name}')
      ? ''
      : `,
            // The name is not in the address, so it travels in a header.
            headers: ["x-file-name": name]`}
        ${close}`

  const address = upload.idInPath
    ? `        // The stored file's address is built from what came back, not
        // from the name that went up.
${upload.nameKey
      ? `        let stored = (reply[${swiftString(upload.nameKey)}] as? [Any]).map { toText($0.first) } ?? toText(reply[${swiftString(upload.nameKey)}])\n`
      : ''}        return Backend.baseUrl + ${swiftPath(upload.publicPath ?? '', {
        bucket: 'bucket',
        id: `toText(reply[${swiftString(upload.idKey)}])`,
        name: upload.nameKey ? 'stored' : 'name',
      })}`
    : upload.urlKey
      ? `        let url = reply[${swiftString(upload.urlKey)}] as? String ?? ""
        ${upload.publicPath
        ? `return url.isEmpty ? Backend.baseUrl + ${swiftPath(upload.publicPath, { bucket: 'bucket', name: 'name' })} : url`
        : 'return url'}`
      : `        return Backend.baseUrl + ${swiftPath(upload.publicPath ?? '', { bucket: 'bucket', name: 'name' })}`

  // Text parts some backends want beside the file -- an id they expect
  // the client to invent, usually.
  const parts = upload.fields
    .map(([key, value]) => `    body.append(Data(("--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"${key}\\"\\r\\n\\r\\n"
        + "${value}" + "\\r\\n").utf8))\n`)
    .join('')

  const multipart = upload.form
    ? `
/// A multipart body, by hand: a generated app should not need a package
/// to post one file.
private func multipart(boundary: String, name: String, bytes: Data) -> Data {
    var body = Data()
${parts}    body.append(Data(("--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"file\\"; filename=\\"" + name + "\\"\\r\\n"
        + "Content-Type: application/octet-stream\\r\\n\\r\\n").utf8))
    body.append(bytes)
    body.append(Data(("\\r\\n--" + boundary + "--\\r\\n").utf8))
    return body
}
`
    : ''

  return `${multipart}
enum Storage {
    /// Bytes in, a URL out. Give it Data, a file URL, or text.
    static func upload(bucket: String, file: Any?) async throws -> String {
        var bytes = Data()
        var name = "upload"
        switch file {
        case let data as Data: bytes = data
        case let url as URL:
            bytes = (try? Data(contentsOf: url)) ?? Data()
            name = url.lastPathComponent
        case .none: break
        default: bytes = Data(toText(file).utf8)
        }
${send}
${address}
    }
}`
}

/**
 * The backend half of `Runtime.swift`.
 *
 * Written for the one backend this project is configured for, rather
 * than carrying a dialect table into the app. An iPhone build for a
 * Supabase project contains PostgREST paths and nothing else, which is
 * the code a person would have written for it.
 */
function swiftBackend(plan: WirePlan): string {
  // Where a backend owns some of a row's fields, the body of a write
  // has to have them taken back out before it goes.
  const written = plan.renames.length ? 'data' : ''
  const constants = plan.headers
    .map(([key, value]) => `    request.setValue(${swiftString(value)}, forHTTPHeaderField: ${swiftString(key)})`)
    .join('\n')

  return `/// Where the backend lives.
///
${plan.base
    ? `/// The address and the keys below came from the project's backend
/// settings. Server-only credentials are deliberately not here: an
/// installed app is readable by whoever has it.`
    : `/// The simulator shares the Mac's loopback, so localhost is the machine
/// running the generated service. On a device, put the Mac's address here.`}
enum Backend {
    nonisolated(unsafe) static var baseUrl = ${swiftString(plan.base || DEFAULT_API_URL)}
    /// Set by the sign-in blocks; sent on every later request.
    nonisolated(unsafe) static var token: String?
}

struct BackendError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private func encode(_ value: Any?) -> String {
    toText(value).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
}

private func asMap(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }

private func rowsOf(_ value: Any?) -> [[String: Any]] { value as? [[String: Any]] ?? [] }

/// One HTTP call: JSON in, decoded JSON out.
private func call(
    _ path: String,
    method: String = "GET",
    body: [String: Any]? = nil,
    bytes: Data? = nil,
    headers: [String: String] = [:]
) async throws -> Any {
    guard let url = URL(string: Backend.baseUrl + path) else {
        throw BackendError(message: "Bad backend URL: " + Backend.baseUrl + path)
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "accept")
${constants}
    // A signed-in user's token replaces the publishable key rather than
    // being sent beside it.
    if let token = Backend.token {
        request.setValue(${plan.token.prefix ? `${swiftString(plan.token.prefix)} + token` : 'token'}, forHTTPHeaderField: ${swiftString(plan.token.header)})
    }
    for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }

    if let bytes {
        request.httpBody = bytes
        if headers["content-type"] == nil {
            request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        }
    } else if let body {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    let parsed = try? JSONSerialization.jsonObject(with: data)
    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
        // Every backend puts its sentence somewhere else, and a status
        // code on its own tells the user nothing they can act on.
        let map = asMap(parsed)
        let said = map["error"] ?? map["message"] ?? map["msg"]
        throw BackendError(message: said as? String ?? "Request failed: \\(http.statusCode)")
    }
    return parsed ?? [:]
}

${swiftFilter(plan)}
${swiftRenames(plan)}
/// Keeps the token from a sign-in reply, and hands back the user.
private func accept(_ reply: Any?) -> [String: Any] {
    let map = asMap(reply)
    if let token = map[${swiftString(plan.tokenKey)}] as? String, !token.isEmpty { Backend.token = token }
${plan.userKey
    ? `    let found = map[${swiftString(plan.userKey)}] as? [String: Any] ?? map
    return ${plan.renames.length ? 'document(found)' : 'found'}`
    : `    // The reply is the account itself here: there is nothing to dig out.
    return ${plan.renames.length ? 'document(map)' : 'map'}`}
}

enum Api {
    /// Rows of a table you drew in the schema editor.
    static func select(_ table: String, where filters: [String: Any] = [:]) async throws -> [[String: Any]] {
        let reply = ${plan.list.filter === 'tree'
      ? `try await call(${swiftPath(plan.list.path, { table: 'table' })}, method: "POST", body: whereBody(filters))`
      : `try await call(${swiftPath(plan.list.path, { table: 'table' })} + query(filters))`}
        return ${swiftRows(plan)}
    }

    static func insert(_ table: String, _ row: Any?) async throws -> [String: Any] {
        let body = ${written}(row as? [String: Any] ?? ["value": toText(row)])
        let reply = try await call(${swiftPath(plan.create.path, { table: 'table' })}, ${swiftWrite(plan.create, 'body')})
        return ${swiftRow(plan, plan.create)}
    }

    static func update(_ table: String, id: String, changes: Any?) async throws -> [String: Any] {
        let body = ${written}(changes as? [String: Any] ?? ["value": toText(changes)])
        let reply = try await call(${swiftPath(plan.modify.path, { table: 'table', id: 'id' })}, ${swiftWrite(plan.modify, 'body')})
        return ${swiftRow(plan, plan.modify)}
    }

    static func remove(_ table: String, id: String) async throws {
        _ = try await call(${swiftPath(plan.destroy.path, { table: 'table', id: 'id' })}, method: ${swiftString(plan.destroy.method)})
    }

    /// Anything else, including URLs that are not this backend.
    static func request(_ url: String, method: String) async throws -> String {
        if url.hasPrefix("/") {
            let reply = try await call(url, method: method)
            let data = try JSONSerialization.data(withJSONObject: reply)
            return String(data: data, encoding: .utf8) ?? ""
        }
        guard let target = URL(string: url) else { return "" }
        var request = URLRequest(url: target)
        request.httpMethod = method
        let (data, _) = try await URLSession.shared.data(for: request)
        return String(data: data, encoding: .utf8) ?? ""
    }
}

${swiftAuth(plan)}

${swiftStorage(plan)}`
}
