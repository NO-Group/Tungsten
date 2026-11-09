/**
 * The iOS App Target.
 *
 * Swift and SwiftUI from the same IR. The project file is generated as an
 * XcodeGen spec rather than a `.xcodeproj`: an Xcode project is a large,
 * machine-written plist whose diff is unreadable and whose merge conflicts
 * are unresolvable, and regenerating one from a twelve-line YAML file is
 * both more honest and more likely to still work in two years.
 */

import type { ComponentSchema } from '../uiSchema'
import { UI_THEME } from '../uiTokens'
import type { CompiledFile, Ir, IrEvent, IrStatement, IrValue } from '../compile'
import { appIdFor, slug, type Project } from '../../project/targets'

function handlerName(nodeId: string): string {
  return `handle_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function literal(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** One IR statement, as Swift. */
export function swiftStatement(
  statement: IrStatement,
  indent: string,
  names: Map<string, string>,
): string[] {
  const value = (id: string): string => {
    const input: IrValue | undefined = statement.inputs[id]
    if (!input || input.kind === 'empty') return 'nil'
    if (input.kind === 'literal') return literal(input.value)
    return names.get(input.node) ?? 'nil'
  }

  // Swift will not interpolate an Optional without complaining, and the
  // generated app should not be full of warnings on first open.
  const text = (id: string) => `String(describing: ${value(id)} ?? "")`

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
      return [`${indent}let ${name()} = try await Api.insert(${text('table')}, ${value('row')})`]
    case 'network.fetch':
      return [`${indent}let ${name()} = try await Api.request(${text('url')}, method: ${text('method')})`]
    case 'auth.signUp':
      return [`${indent}let ${name()} = try await Auth.signUp(email: ${text('email')}, password: ${text('password')})`]
    case 'auth.oauth':
      return [`${indent}let ${name()} = try await Auth.oauth(${text('provider')})`]
    case 'auth.session':
      return [`${indent}let ${name()} = try await Auth.session()`]
    case 'storage.upload':
      return [`${indent}let ${name()} = try await Storage.upload(bucket: ${text('bucket')}, file: ${value('file')})`]
    default:
      return [`${indent}// ${statement.type} has no iOS mapping yet.`]
  }
}

function view(component: ComponentSchema): string {
  const text = (key: string, fallback: string) => JSON.stringify(String(component.properties[key] ?? fallback))
  if (component.type === 'button') {
    const call = component.events.click
      ? `Task { await ${handlerName(component.events.click)}(app) }`
      : '()'
    return `                AppButton(title: ${text('text', 'Submit')}) { ${call} }`
  }
  if (component.type === 'input') {
    return `                AppInput(
                    placeholder: ${text('placeholder', '')},
                    text: Binding(
                        get: { app.fields[${JSON.stringify(component.id)}] ?? "" },
                        set: { app.fields[${JSON.stringify(component.id)}] = $0 }
                    )
                )`
  }
  return `                AppText(${text('value', '')})`
}

function screenCase(screen: { name: string; components: ComponentSchema[] }): string {
  const body = screen.components.length
    ? screen.components.map(view).join('\n')
    : '                AppText("This screen has nothing on it yet.")'
  return `            case ${JSON.stringify(screen.name)}:\n${body}`
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

  const colour = (hex: string) => {
    const value = hex.replace('#', '').slice(0, 6)
    const channel = (at: number) => (Number.parseInt(value.slice(at, at + 2), 16) / 255).toFixed(3)
    return `Color(red: ${channel(0)}, green: ${channel(2)}, blue: ${channel(4)})`
  }

  return `// Generated by the Tungsten builder for ${project.name}.
// SwiftUI, from the same graph as every other target.

import SwiftUI

/// Graphene, from src/theme/tokens.json. One palette, every target.
enum AppTheme {
    static let surface = ${colour(UI_THEME.surface)}
    static let raised = ${colour(UI_THEME.surfaceRaised)}
    static let text = ${colour(UI_THEME.text)}
    static let accent = ${colour(UI_THEME.accent)}
    static let accentInk = ${colour(UI_THEME.accentInk)}
    static let radius: CGFloat = ${UI_THEME.radius}
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

${handlers.join('\n\n') || '// No handlers yet.'}
`
}

export function iosFiles(ir: Ir, project: Project): CompiledFile[] {
  const identifier = appIdFor(project, 'ios')
  const name = slug(project.name) || 'app'

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
// Stubs on purpose: the builder knows the shape of the calls your blocks
// make, not which backend you mean to use. Replace the bodies and keep the
// signatures.

import Foundation

enum Api {
    static func select(_ table: String) async throws -> [[String: Any]] {
        print("select from \\(table)")
        return []
    }

    static func insert(_ table: String, _ row: Any?) async throws -> [String: Any] {
        print("insert into \\(table): \\(String(describing: row))")
        return [:]
    }

    static func request(_ url: String, method: String) async throws -> String {
        print("\\(method) \\(url)")
        return ""
    }
}

enum Auth {
    static func signUp(email: String, password: String) async throws -> [String: Any] {
        print("sign up \\(email) (\\(password.count) characters)")
        return ["email": email]
    }

    static func oauth(_ provider: String) async throws -> [String: Any] {
        print("oauth with \\(provider)")
        return ["provider": provider]
    }

    static func session() async throws -> [String: Any]? { nil }
}

enum Storage {
    static func upload(bucket: String, file: Any?) async throws -> String {
        print("upload to \\(bucket): \\(String(describing: file))")
        return ""
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
- \`Sources/Runtime.swift\` holds the backend stubs.

Bundle identifier \`${identifier}\`, version ${project.version}, both from the
project in the Targets panel. Xcode is required, and so is macOS; that is
Apple's rule, not Tungsten's.
`,
    },
  ]
}
