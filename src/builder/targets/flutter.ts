/**
 * The Flutter toolchain.
 *
 * One Dart source tree, three targets. Flutter is the default for Android
 * and iOS as well as the Cross-Platform Mobile Target, so the same emitter
 * answers for all three and the only thing that varies is the README --
 * what you are told to run, and what the folder next door contains.
 *
 * The Kotlin and Swift emitters are not a fallback for this one. They are
 * the other choice: a team that wants native source picks the toolchain in
 * the Targets panel and gets it, from the same graph.
 */

import {
  slug,
  targetInfo,
  toolchainInfo,
  type Project,
  type TargetKind,
} from '../../project/targets'
import type { CompiledFile, Ir, IrStatement, IrValue } from '../compile'
import { flattenComponents, headingLevelOf, optionsOf, type ComponentSchema } from '../uiSchema'
import { uiThemeDart } from '../uiTokens'
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, operatorOf } from './expressions'

/** The platforms Flutter can be chosen for. */
export type FlutterKind = Extract<TargetKind, 'android' | 'ios' | 'mobile'>

/** What `flutter run` is pointed at, per target. */
const RUNS: Record<FlutterKind, string> = {
  android: 'flutter run -d android',
  ios: 'flutter run -d ios',
  mobile: 'flutter run',
}

/**
 * A value, as Dart.
 *
 * Literal, the variable a statement bound, or -- the arm that was missing
 * until the IR grew one -- a pure expression block lowered in place.
 */
function dartValue(value: IrValue | undefined, names: Map<string, string>): string {
  if (!value || value.kind === 'empty') return 'null'
  if (value.kind === 'literal') {
    if (typeof value.value === 'string') return JSON.stringify(value.value)
    return String(value.value)
  }
  if (value.kind === 'reference') return names.get(value.node) ?? 'null'

  const input = (id: string) => dartValue(value.inputs[id], names)
  const key = (id: string) => (isTextual(value.inputs[id]) ? input(id) : `toText(${input(id)})`)
  switch (value.type) {
    case 'ui.value':
      return `_valueOf(${key('id')})`
    case 'state.get':
      return `_state[${key('name')}]`
    case 'nav.current':
      return '_screen'
    case 'data.text':
    case 'data.number':
      return input('value')
    case 'logic.exists':
      return `(${input('value')} != null)`
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
      return `null /* ${value.type} has no Flutter mapping yet */`
  }
}

function dartStatement(statement: IrStatement, indent: string, names: Map<string, string>): string[] {
  const value = (id: string): string => dartValue(statement.inputs[id], names)
  /** The same value where a String is wanted, without a pointless cast. */
  const text = (id: string): string => (
    isTextual(statement.inputs[id]) ? value(id) : `toText(${value(id)})`
  )

  const name = () => {
    const base = statement.type.split('.').pop() ?? 'value'
    const existing = names.get(statement.node)
    if (existing) return existing
    const assigned = `${base}${names.size + 1}`
    names.set(statement.node, assigned)
    return assigned
  }

  const body = (slot: string): string[] => (statement.bodies[slot] ?? [])
    .flatMap((child) => dartStatement(child, `${indent}  `, names))

  switch (statement.type) {
    case 'logic.log':
      return [`${indent}debugPrint(${text('value')});`]
    case 'nav.go':
      return [`${indent}_goTo(${text('screen')});`]
    case 'nav.back':
      return [`${indent}_back();`]
    case 'ui.text':
      return [`${indent}setState(() => output.add(Text(${text('value')})));`]
    case 'ui.button':
      return [`${indent}// Button ${value('text')} is declared in the widget tree.`]
    case 'ui.input':
    case 'ui.heading':
    case 'ui.image':
    case 'ui.checkbox':
    case 'ui.select':
    case 'ui.link':
    case 'ui.divider':
    case 'ui.stack':
      // Interface blocks are the widget tree, not statements: the handler
      // that "draws" one on the web is, here, a widget that already exists.
      return [`${indent}// ${statement.type} is declared in the widget tree.`]
    case 'logic.if': {
      const inner = body('body')
      const otherwise = body('else')
      const lines = [`${indent}if (${value('condition')} == true) {`, ...inner, `${indent}}`]
      return otherwise.length ? [...lines.slice(0, -1), `${indent}} else {`, ...otherwise, `${indent}}`] : lines
    }
    case 'logic.forEach':
      return [`${indent}for (final item in (${value('list')} as List<dynamic>? ?? [])) {`, ...body('body'), `${indent}}`]
    case 'data.query':
      return [`${indent}final ${name()} = await api.select(${text('table')});`]
    case 'data.insert':
      return [`${indent}final ${name()} = await api.insert(${text('table')}, ${value('row')});`]
    case 'network.fetch':
      return [`${indent}final ${name()} = await api.request(${text('url')}, ${text('method')});`]
    case 'auth.signUp':
      return [`${indent}final ${name()} = await auth.signUp(${text('email')}, ${text('password')});`]
    case 'auth.oauth':
      return [`${indent}final ${name()} = await auth.oauth(${text('provider')});`]
    case 'auth.session':
      return [`${indent}final ${name()} = await auth.session();`]
    case 'storage.upload':
      return [`${indent}final ${name()} = await storage.upload(${text('bucket')}, ${value('file')});`]
    case 'state.set':
      return [`${indent}setState(() => _state[${value('name')}] = ${value('value')});`]
    default:
      return [`${indent}// ${statement.type} has no Flutter mapping yet.`]
  }
}

/** The font size a heading level gets in Flutter. */
const DART_HEADING_SIZES = [30.0, 24.0, 20.0, 18.0, 17.0, 16.0]

/**
 * The Flutter widget for one component.
 *
 * Recursive, because a stack has children: the same component tree the
 * preview nests is nested here, rather than flattened into a list that
 * happens to be in the right order.
 */
function dartWidget(component: ComponentSchema, indent = '          '): string {
  const text = (key: string, fallback: string) => JSON.stringify(String(component.properties[key] ?? fallback))

  if (component.type === 'button') {
    const handler = component.events.click ? `() => ${dartName(component.events.click)}()` : 'null'
    return `${indent}ElevatedButton(onPressed: ${handler}, child: Text(${text('text', 'Submit')})),`
  }
  if (component.type === 'input') {
    return `${indent}TextField(controller: _controllers[${JSON.stringify(component.id)}], decoration: InputDecoration(hintText: ${text('placeholder', '')})),`
  }
  if (component.type === 'heading') {
    const size = DART_HEADING_SIZES[headingLevelOf(component) - 1]
    return `${indent}Text(${text('text', '')}, style: const TextStyle(fontSize: ${size}, fontWeight: FontWeight.w600, color: AppTheme.text)),`
  }
  if (component.type === 'image') {
    const source = String(component.properties.src ?? '')
    if (!source) {
      return `${indent}Container(
${indent}  padding: const EdgeInsets.all(12),
${indent}  alignment: Alignment.center,
${indent}  constraints: const BoxConstraints(minWidth: 180, minHeight: 110),
${indent}  decoration: BoxDecoration(border: Border.all(color: AppTheme.text.withValues(alpha: 0.3))),
${indent}  child: Text(${text('alt', 'Image')}),
${indent}),`
    }
    return `${indent}Image.network(${JSON.stringify(source)}, semanticLabel: ${text('alt', 'Image')}),`
  }
  if (component.type === 'checkbox') {
    return `${indent}Row(children: [
${indent}  Checkbox(
${indent}    value: _fields[${JSON.stringify(component.id)}] == 'true',
${indent}    onChanged: (value) => setState(() => _fields[${JSON.stringify(component.id)}] = value == true ? 'true' : 'false'),
${indent}  ),
${indent}  Text(${text('label', '')}),
${indent}]),`
  }
  if (component.type === 'select') {
    const choices = optionsOf(component)
    const items = choices
      .map((choice) => `${indent}    DropdownMenuItem(value: ${JSON.stringify(choice)}, child: Text(${JSON.stringify(choice)})),`)
      .join('\n')
    const initial = String(component.properties.value ?? '') || choices[0] || ''
    return `${indent}DropdownButton<String>(
${indent}  value: _fields[${JSON.stringify(component.id)}] ?? ${JSON.stringify(initial)},
${indent}  items: [
${items || `${indent}    // No choices yet.`}
${indent}  ],
${indent}  onChanged: (value) => setState(() => _fields[${JSON.stringify(component.id)}] = value ?? ''),
${indent}),`
  }
  if (component.type === 'link') {
    return `${indent}TextButton(
${indent}  onPressed: () => openUrl(${text('href', '')}),
${indent}  child: Text(${text('text', '')}),
${indent}),`
  }
  if (component.type === 'divider') {
    return `${indent}Divider(color: AppTheme.border),`
  }
  if (component.type === 'stack') {
    const row = String(component.properties.direction ?? 'column') === 'row'
    const gap = Number(component.properties.gap ?? 10)
    // Separators rather than the `spacing` argument: that landed in
    // Flutter 3.27, and the generated pubspec asks only for 3.4.
    const inner = `${indent}    `
    const children = (component.children ?? []).flatMap((child, index) => (
      index === 0
        ? [dartWidget(child, inner)]
        : [`${inner}${row ? `SizedBox(width: ${gap})` : `SizedBox(height: ${gap})`},`, dartWidget(child, inner)]
    ))
    return `${indent}${row ? 'Row' : 'Column'}(
${indent}  crossAxisAlignment: CrossAxisAlignment.${row ? 'center' : 'start'},
${indent}  mainAxisSize: MainAxisSize.min,
${indent}  children: [
${children.join('\n') || `${indent}    // Nothing inside this stack yet.`}
${indent}  ],
${indent}),`
  }
  return `${indent}Text(${text('value', '')}),`
}

/** A Dart identifier for a node id, used for handler names. */
function dartName(nodeId: string): string {
  return `_handle_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

export type FlutterInput = {
  /** Where this target's tree is written, already prefixed. */
  root: string
  ir: Ir
  project: Project
  kind: FlutterKind
}

export function flutterFiles({ root, ir, project, kind }: FlutterInput): CompiledFile[] {
  const info = targetInfo(kind)
  const names = new Map<string, string>()
  const handlers = ir.events.map((event) => {
    const body = event.body.flatMap((statement) => dartStatement(statement, '    ', names))
    return `  Future<void> ${dartName(event.node)}() async {\n${body.join('\n') || '    // Nothing connected yet.'}\n  }`
  })

  // Every input on every screen, not only the home one: the controllers
  // live for as long as the app does, and a field on the second screen
  // still has to keep what was typed into it.
  const inputs = new Map<string, ComponentSchema>()
  for (const component of ir.screens.flatMap((screen) => flattenComponents(screen.components))) {
    if (component.type === 'input') inputs.set(component.id, component)
  }
  const controllers = [...inputs.keys()].map((id) => `    ${JSON.stringify(id)}: TextEditingController(),`)

  /** The widgets of one screen, and the start handlers it runs on entry. */
  const widgetsFor = ir.screens.map((screen) => [
    `      case ${JSON.stringify(screen.name)}:`,
    '        return [',
    ...screen.components.map((component) => dartWidget(component)),
    '        ];',
  ].join('\n'))

  const startsFor = ir.screens.map((screen) => {
    const calls = screen.events
      .filter((event) => event.type === 'event.start')
      .map((event) => `        ${dartName(event.node)}();`)
    return [
      `      case ${JSON.stringify(screen.name)}:`,
      ...(calls.length ? calls : ['        // No start event on this screen.']),
      '        break;',
    ].join('\n')
  })

  return [{
    path: `${root}/lib/main.dart`,
    contents: `// Generated by the Tungsten builder. Flutter source, not a wrapper:
// the widgets below are the interface, and the handlers are the blocks.

import 'package:flutter/material.dart';

import 'runtime.dart';

void main() => runApp(const BuilderApp());

/// Graphene, from src/theme/tokens.json. The same palette the web target and
/// the IDE itself use, so a generated app is not a different product.
class AppTheme {
${uiThemeDart()}
}

class BuilderApp extends StatelessWidget {
  const BuilderApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        theme: ThemeData.dark(useMaterial3: true).copyWith(
          scaffoldBackgroundColor: AppTheme.surface,
          colorScheme: ColorScheme.fromSeed(
            seedColor: AppTheme.accent,
            brightness: Brightness.dark,
          ).copyWith(primary: AppTheme.accent, onPrimary: AppTheme.accentInk),
        ),
        home: const BuilderScreen(),
      );
}

class BuilderScreen extends StatefulWidget {
  const BuilderScreen({super.key});

  @override
  State<BuilderScreen> createState() => _BuilderScreenState();
}

class _BuilderScreenState extends State<BuilderScreen> {
  /// One controller per text field, by element id. A map rather than a
  /// field apiece so that reading a value by id -- which is what the
  /// Input Value block does -- is a lookup instead of a generated switch.
  final Map<String, TextEditingController> _controllers = {
${controllers.join('\n')}
  };

  /// What the non-text controls hold, by element id. Checkboxes keep
  /// "true"/"false" here so the Input Value block reads one kind of thing
  /// whatever drew it, exactly as on the web.
  final Map<String, String> _fields = {};

  /// The app's variables, under the name the web target uses for them.
  final Map<String, dynamic> _state = {};

  final List<Widget> output = [];

  /// What a control holds right now, whichever kind of control it is.
  String _valueOf(String id) => _controllers[id]?.text ?? _fields[id] ?? '';

  /// Which screen is showing, and the ones behind it. Navigation is state,
  /// not a route stack: the whole app is one widget, so going back is
  /// popping a string rather than unwinding a Navigator.
  String _screen = ${JSON.stringify(ir.home)};
  final List<String> _trail = [];

  void _goTo(String screen) {
    if (screen == _screen) return;
    _trail.add(_screen);
    _enter(screen);
  }

  void _back() {
    if (_trail.isEmpty) return;
    _enter(_trail.removeLast());
  }

  void _enter(String screen) {
    setState(() {
      _screen = screen;
      output.clear();
    });
    _runStarts(screen);
  }

  void _runStarts(String screen) {
    switch (screen) {
${startsFor.join('\n')}
      default:
        break;
    }
  }

  List<Widget> _widgetsFor(String screen) {
    switch (screen) {
${widgetsFor.join('\n')}
      default:
        return const [];
    }
  }

  @override
  void initState() {
    super.initState();
    _runStarts(_screen);
  }

${handlers.join('\n\n')}

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ..._widgetsFor(_screen),
                ...output,
              ],
            ),
          ),
        ),
      );
}
`,
  }, {
    path: `${root}/lib/runtime.dart`,
    contents: `// The three services the generated handlers call. Point them at your
// backend; nothing above this line needs to change when you do.

/// Values out of a field map have no static type, so the two conversions
/// every generated comparison needs live here. Equality compares text and
/// ordering compares numbers: "3" < "20" being true is a bug that takes an
/// hour to find in code you did not write.
String toText(Object? value) => value?.toString() ?? '';

double toNumber(Object? value) {
  if (value is num) return value.toDouble();
  if (value is bool) return value ? 1 : 0;
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

class Api {
  Future<List<Map<String, dynamic>>> select(String table, [Map<String, dynamic>? where]) async => [];
  Future<Map<String, dynamic>> insert(String table, Object? row) async => {'table': table};
  Future<Map<String, dynamic>> request(String url, String method) async => {'ok': true};
}

class Auth {
  Future<Map<String, dynamic>> signUp(String email, String password) async => {'email': email};
  Future<Map<String, dynamic>> oauth(String provider) async => {'provider': provider};
  Future<Map<String, dynamic>> session() async => {};
}

class Storage {
  Future<String> upload(String bucket, Object? file) async => 'https://example.com/' + bucket;
}

/// Opening a link.
///
/// A stub like the services above. Add url_launcher to the pubspec and the
/// body becomes launchUrl(Uri.parse(url)) -- not done for you,
/// because that package needs per-platform set-up this generator cannot
/// perform, and a link that silently did nothing would be worse than one
/// that says what it would have opened.
void openUrl(String url) {
  // ignore: avoid_print
  print('open ' + url);
}

final api = Api();
final auth = Auth();
final storage = Storage();
`,
  }, {
    // Without this the folder is Dart source rather than a Flutter project,
    // and `flutter run` has nothing to read.
    path: `${root}/pubspec.yaml`,
    contents: `name: ${(slug(project.name) || 'app').replace(/-/g, '_')}
description: ${project.name}, built by the Tungsten builder.
publish_to: none
version: ${project.version}+1

environment:
  sdk: ">=3.4.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter

flutter:
  uses-material-design: true
`,
  }, {
    path: `${root}/README.md`,
    contents: `# ${project.name} — ${info.label}

Generated by the Tungsten builder with the ${toolchainInfo('flutter').label}
toolchain: one Dart source tree, ${kind === 'mobile' ? 'building for both phones' : `building for ${kind === 'android' ? 'Android' : 'iOS'}`}.

\`\`\`bash
flutter create . --project-name ${(slug(project.name) || 'app').replace(/-/g, '_')}  # once, to add the native shells
${RUNS[kind]}
\`\`\`

- \`lib/main.dart\` is the interface and the handlers your blocks became.
- \`lib/runtime.dart\` talks to the generated backend over HTTP. Point
  \`baseUrl\` at wherever you run \`server/\`.

This folder was written by the Flutter toolchain. Switching this target to
${kind === 'mobile' ? 'another toolchain is not offered — the Cross-Platform Mobile Target is Flutter by definition' : `${kind === 'android' ? 'Kotlin' : 'Swift'} writes a different kind of project into the same folder`}, so delete it first rather
than building over the top.
`,
  }]
}
