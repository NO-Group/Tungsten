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
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, objectIn, operatorOf, parseObjectLiteral, rowFields } from './expressions'
import { DEFAULT_API_URL } from './server'
import { renderPath, wirePlan, type WirePlan } from './wire'
import type { RuntimeProfile } from '../../backend/runtimeProfile'


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
    case 'data.row':
      return objectIn('dart', rowFields(value, (field) => dartValue(field, names)))
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
      if (entries) return objectIn('dart', entries)
    }
    return value(id)
  }

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
      return [`${indent}final ${name()} = await api.insert(${text('table')}, ${object('row')});`]
    case 'data.update':
      return [`${indent}final ${name()} = await api.update(${text('table')}, ${text('id')}, ${object('changes')});`]
    case 'data.remove':
      return [`${indent}await api.remove(${text('table')}, ${text('id')});`]
    case 'network.fetch':
      return [`${indent}final ${name()} = await api.request(${text('url')}, ${text('method')});`]
    case 'auth.signUp':
      return [`${indent}final ${name()} = await auth.signUp(${text('email')}, ${text('password')});`]
    case 'auth.signIn':
      return [`${indent}final ${name()} = await auth.signIn(${text('email')}, ${text('password')});`]
    case 'auth.signOut':
      return [`${indent}await auth.signOut();`]
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
  /**
   * The backend this app should call.
   *
   * Absent means the project has none configured, and the emitted
   * runtime talks to the Node service Tungsten generates — which is
   * what it has always done.
   */
  profile?: RuntimeProfile
}

export function flutterFiles({ root, ir, project, kind, profile }: FlutterInput): CompiledFile[] {
  const info = targetInfo(kind)
  const plan = wirePlan(profile)
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
    contents: dartRuntime(plan),
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

/* ------------------------------------------------------------- the backend */

/** `'text'` as a Dart string literal. */
function dartString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`
}

const DART = {
  quote: dartString,
  escape: (expression: string) => `Uri.encodeComponent(${expression})`,
  join: ' + ',
}

/** A wire path as a Dart expression, with the placeholders filled in. */
function dartPath(path: string, values: Record<string, string>): string {
  return renderPath(path, values, DART)
}

/**
 * Where a generated app looks for its backend.
 *
 * An address on the developer's own machine is the one case the phone
 * cannot take literally: `localhost` inside the Android emulator is the
 * emulator, which is running nothing. 10.0.2.2 is the host, and getting
 * this wrong is the most common first-run failure on Android.
 */
function dartBaseUrl(plan: WirePlan): string {
  const base = plan.base || DEFAULT_API_URL
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)
  if (!local) return `static String baseUrl = ${dartString(base)};`
  const android = base.replace(/\/\/(localhost|127\.0\.0\.1)/, '//10.0.2.2')
  return [
    'static String baseUrl = Platform.isAndroid',
    `    ? ${dartString(android)}`,
    `    : ${dartString(base)};`,
  ].join('\n  ')
}

/** The rows of a reply, wherever this backend keeps them. */
function dartRows(plan: WirePlan): string {
  if (plan.list.envelope === 'array') return '_rows(reply)'
  return `_rows(_map(reply)[${dartString(plan.list.envelope)}])`
}

/** One row of a reply, wherever this backend keeps it. */
function dartRow(step: WirePlan['create'] | WirePlan['modify']): string {
  if (step.envelope === 'self') return '_map(reply)'
  if (step.envelope === 'row') return "_map(_map(reply)['row'])"
  return 'rows.isEmpty ? <String, dynamic>{} : rows.first'
}

/** The named arguments a write needs: the body, wrapped, and any header. */
function dartWrite(step: WirePlan['create'] | WirePlan['modify'], body: string): string {
  const wrapped = step.wrap ? `{${dartString(step.wrap)}: ${body}}` : body
  const prefer = step.prefer ? `, headers: {'prefer': ${dartString(step.prefer)}}` : ''
  return `method: ${dartString(step.method)}, body: ${wrapped}${prefer}`
}

/** The filter encoder for this dialect, and nothing else. */
function dartFilter(plan: WirePlan): string {
  switch (plan.list.filter) {
    case 'postgrest':
      return `/// A filter as PostgREST parameters: column=eq.value.
String _query(Map<String, dynamic>? where) {
  var query = '?select=*';
  if (where == null) return query;
  where.forEach((key, value) {
    query += '&' + Uri.encodeQueryComponent(key) + '=eq.' + Uri.encodeQueryComponent(toText(value));
  });
  return query;
}`
    case 'pocketbase':
      return `/// A filter as a PocketBase expression.
///
/// There is no parameter binding on the wire here: the value is quoted
/// into the expression, so a quote inside it has to be escaped or it
/// ends the string early.
String _query(Map<String, dynamic>? where) {
  if (where == null || where.isEmpty) return '';
  final tests = where.entries
      .map((entry) => entry.key + "='" + toText(entry.value).replaceAll("'", "\\\\'") + "'")
      .join(' && ');
  return '?filter=' + Uri.encodeQueryComponent(tests);
}`
    case 'tree':
      return `/// A filter as the tree this backend takes in the body of a query.
Map<String, dynamic> _where(Map<String, dynamic>? where) {
  if (where == null || where.isEmpty) return <String, dynamic>{};
  return {
    'where': {
      'all': where.entries
          .map((entry) => {'column': entry.key, 'op': 'eq', 'value': entry.value})
          .toList(),
    },
  };
}`
    default:
      return `/// A filter as the query string the generated service reads.
String _query(Map<String, dynamic>? where) {
  if (where == null || where.isEmpty) return '';
  return '?' + where.entries
      .map((entry) => Uri.encodeQueryComponent(entry.key) + '=' + Uri.encodeQueryComponent(toText(entry.value)))
      .join('&');
}`
  }
}

/** The select call, which is the one operation whose shape really differs. */
function dartSelect(plan: WirePlan): string {
  const path = dartPath(plan.list.path, { table: 'table' })
  const call = plan.list.filter === 'tree'
    ? `await _call(${path}, method: 'POST', body: _where(where))`
    : `await _call(${path} + _query(where))`
  return `  /// Rows of a table you drew in the schema editor.
  Future<List<Map<String, dynamic>>> select(String table, [Map<String, dynamic>? where]) async {
    final reply = ${call};
    return ${dartRows(plan)};
  }`
}

/** Sign-up, sign-in, session and sign-out, as this backend spells them. */
function dartAuth(plan: WirePlan): string {
  const credentials = plan.signUp.body === 'record'
    ? "{'email': email, 'password': password, 'passwordConfirm': password}"
    : "{'email': email, 'password': password}"
  const signUpBody = plan.signUp.thenSignIn
    ? `    // Creating the account does not start a session here, so the app
    // signs in straight afterwards rather than handing back a user who
    // cannot read anything.
    await _call(${dartString(plan.signUp.path)}, method: 'POST', body: ${credentials});
    return signIn(email, password);`
    : `    return _accept(await _call(${dartString(plan.signUp.path)}, method: 'POST', body: ${credentials}));`

  const identity = plan.signIn.identity === 'identity'
    ? "{'identity': email, 'password': password}"
    : "{'email': email, 'password': password}"

  const oauth = plan.oauth.kind === 'url'
    ? `  /// The provider's address, built from the backend's own.
  ///
  /// Opening it is the app's business: only the app knows whether that
  /// is a browser tab, a custom tab or a web view.
  Future<Map<String, dynamic>> oauth(String provider) async =>
      {'url': Backend.baseUrl + ${dartString(plan.oauth.path)} + Uri.encodeComponent(provider), 'provider': provider};`
    : `  /// Starts a provider round trip. The reply carries the URL to open.
  Future<Map<String, dynamic>> oauth(String provider) async =>
      _map(await _call(${dartString(plan.oauth.path)}, method: 'POST', body: {'provider': provider}));`

  const signOut = plan.signOut
    ? `    if (Backend.token != null) await _call(${dartString(plan.signOut.path)}, method: ${dartString(plan.signOut.method)});
    Backend.token = null;`
    : `    // Signing out is local here: the backend keeps no session to end.
    Backend.token = null;`

  return `class Auth {
  Future<Map<String, dynamic>> signUp(String email, String password) async {
${signUpBody}
  }

  Future<Map<String, dynamic>> signIn(String email, String password) async =>
      _accept(await _call(${dartString(plan.signIn.path)}, method: 'POST', body: ${identity}));

${oauth}

  Future<Map<String, dynamic>> session() async {
    if (Backend.token == null) return {};
    try {
      return _accept(await _call(${dartString(plan.session.path)}, method: ${dartString(plan.session.method)}));
    } on BackendException {
      // An expired token is nobody being signed in, not a failure the
      // app has to handle.
      Backend.token = null;
      return {};
    }
  }

  Future<void> signOut() async {
${signOut}
  }
}`
}

/** Uploading a file, and working out what its URL is afterwards. */
function dartStorage(plan: WirePlan): string {
  const { upload } = plan
  const path = dartPath(upload.path, { bucket: 'bucket', name: 'name' })
  const send = upload.form
    ? `    final boundary = 'tungsten-' + DateTime.now().microsecondsSinceEpoch.toString();
    final reply = _map(await _call(
      ${path},
      method: 'POST',
      bytes: _multipart(boundary, name, bytes),
      headers: {'content-type': 'multipart/form-data; boundary=' + boundary},
    ));`
    : `    final reply = _map(await _call(
      ${path},
      method: 'POST',
      bytes: bytes,${upload.path.includes('{name}')
        ? ''
        : `
      // The name is not in the address, so it travels in a header.
      headers: {'x-file-name': name},`}
    ));`

  const address = upload.idInPath
    ? `    // A file belongs to a record here, so its address needs the id the
    // upload came back with.
    final stored = reply['file'] is List
        ? toText((reply['file'] as List).first)
        : toText(reply['file']);
    return Backend.baseUrl + ${dartPath(upload.publicPath ?? '', { bucket: 'bucket', id: "toText(reply['id'])", name: 'stored' })};`
    : upload.urlKey
      ? `    final url = toText(reply[${dartString(upload.urlKey)}]);
    ${upload.publicPath
      ? `return url.isNotEmpty ? url : Backend.baseUrl + ${dartPath(upload.publicPath, { bucket: 'bucket', name: 'name' })};`
      : 'return url;'}`
      : `    return Backend.baseUrl + ${dartPath(upload.publicPath ?? '', { bucket: 'bucket', name: 'name' })};`

  const multipart = upload.form
    ? `
/// A multipart body, by hand: a generated app should not need a package
/// to post one file.
List<int> _multipart(String boundary, String name, List<int> bytes) {
  final head = utf8.encode('--' + boundary + '\\r\\n'
      + 'Content-Disposition: form-data; name="file"; filename="' + name + '"\\r\\n'
      + 'Content-Type: application/octet-stream\\r\\n\\r\\n');
  final tail = utf8.encode('\\r\\n--' + boundary + '--\\r\\n');
  return <int>[...head, ...bytes, ...tail];
}
`
    : ''

  return `${multipart}
class Storage {
  /// Bytes in, a URL out. Give it a File, a list of bytes, or text.
  Future<String> upload(String bucket, Object? file) async {
    var name = 'upload';
    List<int> bytes;
    if (file is File) {
      name = file.uri.pathSegments.last;
      bytes = await file.readAsBytes();
    } else if (file is List<int>) {
      bytes = file;
    } else {
      bytes = utf8.encode(toText(file));
    }
${send}
${address}
  }
}`
}

/**
 * The whole of `lib/runtime.dart`.
 *
 * Generated against one backend rather than carrying a dialect table:
 * an app is built for a project, and a project has one backend. The
 * result is source a person could have written for that backend, which
 * is the promise the rest of the generator makes too.
 */
export function dartRuntime(plan: WirePlan): string {
  const constants = plan.headers
    .map(([key, value]) => `  request.headers.set(${dartString(key)}, ${dartString(value)});`)
    .join('\n')
  return `// The services a generated app talks to.
//
// Not stubs, and not a shim: these call ${plan.base ? `the ${plan.dialect} API this project is configured for` : 'the backend the builder writes alongside this app'}.
// Only dart:io and dart:convert are used, so the pubspec stays empty.
${plan.base ? '//\n// The address and the keys below came from the project\'s backend\n// settings. Server-only credentials are deliberately not here: a built\n// app is readable by whoever has it.\n' : ''}
import 'dart:convert';
import 'dart:io';

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

/// Where the backend lives. One line to change when you deploy.
class Backend {
  ${dartBaseUrl(plan)}

  /// Set by the sign-in blocks; sent on every later request.
  static String? token;
}

class BackendException implements Exception {
  BackendException(this.message);
  final String message;
  @override
  String toString() => message;
}

final _client = HttpClient();

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};

List<Map<String, dynamic>> _rows(Object? value) =>
    value is List ? value.whereType<Map<String, dynamic>>().toList() : <Map<String, dynamic>>[];

/// One HTTP call: JSON in, decoded JSON out.
Future<dynamic> _call(
  String path, {
  String method = 'GET',
  Object? body,
  List<int>? bytes,
  Map<String, String> headers = const {},
}) async {
  final request = await _client.openUrl(method, Uri.parse(Backend.baseUrl + path));
  request.headers.set('accept', 'application/json');
${constants}
  final token = Backend.token;
  // A signed-in user's token replaces the publishable key rather than
  // being sent beside it.
  if (token != null) request.headers.set(${dartString(plan.token.header)}, ${plan.token.prefix ? `${dartString(plan.token.prefix)} + token` : 'token'});
  headers.forEach(request.headers.set);

  if (bytes != null) {
    if (!headers.containsKey('content-type')) {
      request.headers.contentType = ContentType('application', 'octet-stream');
    }
    request.add(bytes);
  } else if (body != null) {
    request.headers.contentType = ContentType('application', 'json', charset: 'utf-8');
    request.add(utf8.encode(jsonEncode(body)));
  }

  final response = await request.close();
  final text = await response.transform(utf8.decoder).join();
  final parsed = text.isEmpty ? null : jsonDecode(text);
  if (response.statusCode >= 400) {
    // Every backend puts its sentence somewhere else, and a status code
    // on its own tells the user nothing they can act on.
    final map = _map(parsed);
    final said = map['error'] ?? map['message'] ?? map['msg'];
    throw BackendException(said is String && said.isNotEmpty
        ? said
        : 'Request failed: ' + response.statusCode.toString());
  }
  return parsed;
}

${dartFilter(plan)}

/// Keeps the token from a sign-in reply, and hands back the user.
Map<String, dynamic> _accept(Object? reply) {
  final map = _map(reply);
  final token = map[${dartString(plan.tokenKey)}];
  if (token is String && token.isNotEmpty) Backend.token = token;
  final user = map[${dartString(plan.userKey)}];
  return user is Map<String, dynamic> ? user : map;
}

class Api {
${dartSelect(plan)}

  Future<Map<String, dynamic>> insert(String table, Object? row) async {
    final body = row is Map ? Map<String, dynamic>.from(row) : {'value': toText(row)};
    final reply = await _call(${dartPath(plan.create.path, { table: 'table' })}, ${dartWrite(plan.create, 'body')});
${plan.create.envelope === 'first' ? '    final rows = _rows(reply);\n' : ''}    return ${dartRow(plan.create)};
  }

  Future<Map<String, dynamic>> update(String table, String id, Object? changes) async {
    final body = changes is Map ? Map<String, dynamic>.from(changes) : {'value': toText(changes)};
    final reply = await _call(${dartPath(plan.modify.path, { table: 'table', id: 'id' })}, ${dartWrite(plan.modify, 'body')});
${plan.modify.envelope === 'first' ? '    final rows = _rows(reply);\n' : ''}    return ${dartRow(plan.modify)};
  }

  Future<void> remove(String table, String id) async {
    await _call(${dartPath(plan.destroy.path, { table: 'table', id: 'id' })}, method: ${dartString(plan.destroy.method)});
  }

  /// Anything else, including URLs that are not this backend.
  Future<Map<String, dynamic>> request(String url, String method) async {
    if (url.startsWith('/')) return _map(await _call(url, method: method));
    final outgoing = await _client.openUrl(method, Uri.parse(url));
    final response = await outgoing.close();
    final text = await response.transform(utf8.decoder).join();
    final parsed = text.isEmpty ? null : jsonDecode(text);
    return parsed is Map<String, dynamic> ? parsed : {'body': text};
  }
}

${dartAuth(plan)}

${dartStorage(plan)}

/// Opening a link.
///
/// Still a stub, and the only one left. Add url_launcher to the pubspec
/// and the body becomes launchUrl(Uri.parse(url)) -- not done for you,
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
`
}
