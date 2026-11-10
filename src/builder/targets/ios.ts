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
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, objectIn, operatorOf, parseObjectLiteral } from './expressions'
import { appIdFor, slug, type Project } from '../../project/targets'
import { DEFAULT_API_URL } from './server'

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

export function iosFiles(ir: Ir, project: Project): CompiledFile[] {
  const identifier = appIdFor(project, 'ios')
  const name = slug(project.name) || 'app'
  // The simulator shares the Mac's loopback, so the backend is simply
  // localhost here -- unlike Android, which needs 10.0.2.2.
  const baseUrl = DEFAULT_API_URL

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
// Not stubs: these call the backend the builder writes alongside this app.
// Build the Backend Service target, run \`node main.js\` in it, and sign-up,
// the drawn tables and file uploads all work from here. Foundation has
// everything needed -- URLSession and JSONSerialization -- so there is no
// package to add.

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

/// Where the backend lives.
///
/// The simulator shares the Mac's loopback, so localhost is the machine
/// running \`node main.js\`. On a device, put the Mac's address here.
enum Backend {
    nonisolated(unsafe) static var baseUrl = "${baseUrl}"
    /// Set by the sign-in blocks; sent on every later request.
    nonisolated(unsafe) static var token: String?
}

struct BackendError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// One HTTP call, as JSON in and JSON out.
private func call(
    _ path: String,
    method: String = "GET",
    body: [String: Any]? = nil,
    bytes: Data? = nil,
    headers: [String: String] = [:]
) async throws -> [String: Any] {
    guard let url = URL(string: Backend.baseUrl + path) else {
        throw BackendError(message: "Bad backend URL: " + Backend.baseUrl + path)
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "accept")
    if let token = Backend.token { request.setValue("Bearer " + token, forHTTPHeaderField: "authorization") }
    for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }

    if let bytes {
        request.httpBody = bytes
        request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
    } else if let body {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
        // The service answers errors as {"error": "..."}, so what the user
        // sees is the sentence the backend chose, not a status code.
        throw BackendError(message: parsed["error"] as? String ?? "Request failed: \\(http.statusCode)")
    }
    return parsed
}

enum Api {
    /// Rows of a table you drew in the schema editor.
    static func select(_ table: String, where filters: [String: Any] = [:]) async throws -> [[String: Any]] {
        var path = "/data/" + table
        if !filters.isEmpty {
            let pairs = filters.map { key, value in
                let encoded = toText(value).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                return key + "=" + encoded
            }
            path += "?" + pairs.joined(separator: "&")
        }
        return try await call(path)["rows"] as? [[String: Any]] ?? []
    }

    static func insert(_ table: String, _ row: Any?) async throws -> [String: Any] {
        let body = row as? [String: Any] ?? ["value": toText(row)]
        return try await call("/data/" + table, method: "POST", body: body)["row"] as? [String: Any] ?? [:]
    }

    static func update(_ table: String, id: String, changes: Any?) async throws -> [String: Any] {
        let body = changes as? [String: Any] ?? ["value": toText(changes)]
        return try await call("/data/" + table + "/" + id, method: "PATCH", body: body)["row"] as? [String: Any] ?? [:]
    }

    static func remove(_ table: String, id: String) async throws {
        _ = try await call("/data/" + table + "/" + id, method: "DELETE")
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

enum Auth {
    static func signUp(email: String, password: String) async throws -> [String: Any] {
        let reply = try await call("/auth/sign-up", method: "POST", body: ["email": email, "password": password])
        if let token = reply["token"] as? String { Backend.token = token }
        return reply["user"] as? [String: Any] ?? reply
    }

    static func signIn(email: String, password: String) async throws -> [String: Any] {
        let reply = try await call("/auth/sign-in", method: "POST", body: ["email": email, "password": password])
        if let token = reply["token"] as? String { Backend.token = token }
        return reply["user"] as? [String: Any] ?? reply
    }

    /// Starts a provider round trip. The reply carries the URL to open --
    /// opening it is the app's call, not the runtime's.
    static func oauth(_ provider: String) async throws -> [String: Any] {
        try await call("/auth/oauth", method: "POST", body: ["provider": provider])
    }

    static func session() async throws -> [String: Any]? {
        guard Backend.token != nil else { return nil }
        return try await call("/auth/session")["user"] as? [String: Any]
    }

    static func signOut() async throws {
        if Backend.token != nil { _ = try await call("/auth/sign-out", method: "POST") }
        Backend.token = nil
    }
}

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
        let reply = try await call(
            "/storage/" + bucket,
            method: "POST",
            bytes: bytes,
            headers: ["x-file-name": name]
        )
        return reply["url"] as? String ?? ""
    }
}
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
- \`Sources/Runtime.swift\` calls the generated backend. Build the Backend
  Service target, run \`node main.js\` in it, and the auth, table and upload
  blocks work against it.

Bundle identifier \`${identifier}\`, version ${project.version}, both from the
project in the Targets panel. Xcode is required, and so is macOS; that is
Apple's rule, not Tungsten's.
`,
    },
  ]
}
