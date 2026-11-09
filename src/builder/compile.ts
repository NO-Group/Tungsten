/**
 * Compilation: one intermediate representation, several targets.
 *
 * The graph is not transpiled directly into each platform. It is lowered once
 * into an IR -- events, statements, components, tables -- and every target
 * reads only that. A new target is a function over the IR; it never learns
 * what a block is, which is the only way the number of targets can grow
 * without the number of things that know about blocks growing with it.
 *
 * Nothing compiles while the integrity checker reports an error. A build that
 * emits known-broken output is worse than no build: it moves the failure to
 * somewhere the user has less context to understand it.
 */

import type { BlockGraph, BlockNode, BlockRegistry } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { checkIntegrity } from './integrity'
import { incoming, nodeById, outgoing } from './graph'
import { createFetchers, createMigration, type DataSchema } from './dataSchema'
import { previewHtml } from './previewRuntime'
import { uiThemeDart } from './uiTokens'
import { renderDocumentBody, schemaFromGraph, type ComponentSchema, type UiDocument } from './uiSchema'
import { DEFAULT_SCREENS, homeScreen, screenOf, type Screen } from './screens'
import type { AppVariable } from './appState'

export const IR_VERSION = 1

export type IrValue =
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'reference'; node: string; port: string }
  | { kind: 'empty' }

export type IrStatement = {
  /** The block this came from; every target keeps it for the traceback. */
  node: string
  type: string
  inputs: Record<string, IrValue>
  /** Nested statement slots, by slot port id. */
  bodies: Record<string, IrStatement[]>
  /** True when the block's result is bound to a name. */
  binds: boolean
}

export type IrEvent = {
  node: string
  type: string
  /** For a click handler: the element id it is bound to. */
  target?: string
  body: IrStatement[]
}

/** One screen, with only what belongs to it. */
export type IrScreen = {
  name: string
  components: ComponentSchema[]
  events: IrEvent[]
}

export type Ir = {
  version: number
  /** Every handler in the app, in file order. */
  events: IrEvent[]
  /** Every component in the app. A target that has screens reads those. */
  components: ComponentSchema[]
  screens: IrScreen[]
  /** Where the app starts. */
  home: string
  tables: DataSchema['tables']
}

/** Lowers the graph into the representation every target reads. */
export function buildIr(
  graph: BlockGraph,
  registry: BlockRegistry,
  schema: DataSchema = { tables: [] },
  screens: readonly Screen[] = DEFAULT_SCREENS,
): Ir {
  const ui = schemaFromGraph(graph, registry)

  const valueFor = (node: BlockNode, portId: string): IrValue => {
    const link = incoming(graph, node.id, portId)
    if (link) return { kind: 'reference', node: link.from.node, port: link.from.port }
    const definition = registry.get(node.type)
    const port = definition?.inputs.find((candidate) => candidate.id === portId)
    const value = node.values[portId] ?? port?.default
    return value === undefined ? { kind: 'empty' } : { kind: 'literal', value }
  }

  const chain = (fromNode: string, fromPort: string, seen: Set<string>): IrStatement[] => {
    const statements: IrStatement[] = []
    let link = outgoing(graph, fromNode, fromPort)[0]

    while (link) {
      const node = nodeById(graph, link.to.node)
      const definition = node && registry.get(node.type)
      if (!node || !definition || seen.has(node.id)) break
      seen.add(node.id)

      const inputs: Record<string, IrValue> = {}
      for (const port of definition.inputs) {
        if (port.type === 'Exec') continue
        inputs[port.id] = valueFor(node, port.id)
      }

      const bodies: Record<string, IrStatement[]> = {}
      for (const slot of definition.slots ?? []) {
        bodies[slot.id] = chain(node.id, slot.id, seen)
      }

      statements.push({
        node: node.id,
        type: node.type,
        inputs,
        bodies,
        binds: definition.outputs.some((port) => port.type !== 'Exec'),
      })

      link = outgoing(graph, node.id, 'exec')[0]
    }

    return statements
  }

  const events: IrEvent[] = graph.nodes
    .filter((node) => registry.get(node.type)?.isEvent)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id))
    .map((node) => ({
      node: node.id,
      type: node.type,
      target: node.type === 'event.click' ? String(node.values.target ?? 'submit') : undefined,
      body: chain(node.id, 'exec', new Set()),
    }))

  // Each screen gets its own slice of the same two lists. Targets that
  // know about screens read these; the flat lists above stay for the ones
  // that do not, and for an app that only ever has the one.
  const byScreen: IrScreen[] = screens.map((screen) => ({
    name: screen.name,
    components: schemaFromGraph(graph, registry, { screen: screen.name, screens }).components,
    events: events.filter((event) => {
      const node = nodeById(graph, event.node)
      return node ? screenOf(node, screens) === screen.name : false
    }),
  }))

  return {
    version: IR_VERSION,
    events,
    components: ui.components,
    screens: byScreen,
    home: homeScreen(screens),
    tables: schema.tables,
  }
}

export type CompileTarget = 'web' | 'mobile' | 'node'

export type CompiledFile = { path: string; contents: string }

export type CompileResult =
  | { ok: true; target: CompileTarget; files: CompiledFile[]; summary: string }
  | { ok: false; target: CompileTarget; reason: string; files?: undefined }

export type CompileInput = {
  graph: BlockGraph
  registry: BlockRegistry
  schema?: DataSchema
  /**
   * The variables the app keeps.
   *
   * Not optional in spirit: a build without them emits a program whose
   * first line is missing, and every read of a variable in it is a
   * reference error. It stays optional only so a caller with no state can
   * leave it out.
   */
  state?: readonly AppVariable[]
  screens?: readonly Screen[]
  target: CompileTarget
}

/** Dart for one IR statement, for the mobile target. */
function dartStatement(statement: IrStatement, indent: string, names: Map<string, string>): string[] {
  const value = (id: string): string => {
    const input = statement.inputs[id]
    if (!input || input.kind === 'empty') return 'null'
    if (input.kind === 'literal') {
      if (typeof input.value === 'string') return JSON.stringify(input.value)
      if (typeof input.value === 'boolean') return String(input.value)
      return String(input.value)
    }
    return names.get(input.node) ?? 'null'
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
      return [`${indent}debugPrint('\${${value('value')}}');`]
    case 'nav.go':
      return [`${indent}_goTo(${value('screen')});`]
    case 'nav.back':
      return [`${indent}_back();`]
    case 'ui.text':
      return [`${indent}setState(() => output.add(Text('\${${value('value')}}')));`]
    case 'ui.button':
      return [`${indent}// Button "\${${value('text')}}" is declared in the widget tree.`]
    case 'ui.input':
      return [`${indent}// Input ${value('id')} is declared in the widget tree.`]
    case 'logic.if': {
      const inner = body('body')
      const otherwise = body('else')
      const lines = [`${indent}if (${value('condition')} == true) {`, ...inner, `${indent}}`]
      return otherwise.length ? [...lines.slice(0, -1), `${indent}} else {`, ...otherwise, `${indent}}`] : lines
    }
    case 'logic.forEach':
      return [`${indent}for (final item in ${value('list')} ?? []) {`, ...body('body'), `${indent}}`]
    case 'data.query':
      return [`${indent}final ${name()} = await api.select(${value('table')});`]
    case 'data.insert':
      return [`${indent}final ${name()} = await api.insert(${value('table')}, ${value('row')});`]
    case 'network.fetch':
      return [`${indent}final ${name()} = await api.request(${value('url')}, ${value('method')});`]
    case 'auth.signUp':
      return [`${indent}final ${name()} = await auth.signUp(${value('email')}, ${value('password')});`]
    case 'auth.oauth':
      return [`${indent}final ${name()} = await auth.oauth(${value('provider')});`]
    case 'auth.session':
      return [`${indent}final ${name()} = await auth.session();`]
    case 'storage.upload':
      return [`${indent}final ${name()} = await storage.upload(${value('bucket')}, ${value('file')});`]
    default:
      return [`${indent}// ${statement.type} has no mobile mapping yet.`]
  }
}

/** The Flutter widget for one component. */
function dartWidget(component: ComponentSchema): string {
  if (component.type === 'button') {
    const handler = component.events.click ? `() => _handle_${component.events.click.replace(/[^A-Za-z0-9_]/g, '_')}()` : 'null'
    return `        ElevatedButton(onPressed: ${handler}, child: Text(${JSON.stringify(String(component.properties.text ?? 'Submit'))})),`
  }
  if (component.type === 'input') {
    return `        TextField(controller: _${component.id.replace(/[^A-Za-z0-9_]/g, '_')}, decoration: InputDecoration(hintText: ${JSON.stringify(String(component.properties.placeholder ?? ''))})),`
  }
  return `        Text(${JSON.stringify(String(component.properties.value ?? ''))}),`
}

function webFiles(ir: Ir, ui: UiDocument, code: string, schema: DataSchema): CompiledFile[] {
  const files: CompiledFile[] = [
    {
      path: 'build/web/index.html',
      contents: previewHtml({ document: ui, code, screen: ir.home }),
    },
    {
      path: 'build/web/app.ts',
      contents: code,
    },
    {
      path: 'build/web/ui.schema.json',
      contents: `${JSON.stringify(
        ir.screens.length > 1
          ? { home: ir.home, screens: ir.screens.map((screen) => ({ name: screen.name, components: screen.components })) }
          : { components: ir.components },
        null,
        2,
      )}\n`,
    },
    {
      path: 'build/web/README.md',
      contents: `# Built by the Tungsten builder

- \`index.html\` runs on its own: open it, or serve the folder with any static server.
- \`app.ts\` is the program the blocks generated. It is ordinary TypeScript; nothing here depends on the builder.
- \`ui.schema.json\` is the interface, as data. Any renderer that reads it renders this app.

${ir.events.length} event handler${ir.events.length === 1 ? '' : 's'}, ${ir.components.length} component${ir.components.length === 1 ? '' : 's'}, ${ir.screens.length} screen${ir.screens.length === 1 ? '' : 's'}, ${ir.tables.length} table${ir.tables.length === 1 ? '' : 's'}.
`,
    },
  ]

  if (schema.tables.length) {
    files.push(
      { path: 'build/web/migrations/0001_init.sql', contents: createMigration(schema) },
      { path: 'build/web/data/fetchers.ts', contents: createFetchers(schema) },
    )
  }

  return files
}

/** A Dart identifier for a node id, used for handler names. */
function dartName(nodeId: string): string {
  return `_handle_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function mobileFiles(ir: Ir): CompiledFile[] {
  const names = new Map<string, string>()
  const handlers = ir.events.map((event) => {
    const body = event.body.flatMap((statement) => dartStatement(statement, '    ', names))
    return `  Future<void> ${dartName(event.node)}() async {\n${body.join('\n') || '    // Nothing connected yet.'}\n  }`
  })

  const controllers = ir.components
    .filter((component) => component.type === 'input')
    .map((component) => `  final _${component.id.replace(/[^A-Za-z0-9_]/g, '_')} = TextEditingController();`)

  /** The widgets of one screen, and the start handlers it runs on entry. */
  const widgetsFor = ir.screens.map((screen) => [
    `      case ${JSON.stringify(screen.name)}:`,
    '        return [',
    ...screen.components.map((component) => `    ${dartWidget(component)}`),
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
    path: 'build/mobile/lib/main.dart',
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
${controllers.join('\n')}
  final List<Widget> output = [];

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
    path: 'build/mobile/lib/runtime.dart',
    contents: `// The three services the generated handlers call. Point them at your
// backend; nothing above this line needs to change when you do.

class Api {
  Future<List<Map<String, dynamic>>> select(String table, [Map<String, dynamic>? where]) async => [];
  Future<Map<String, dynamic>> insert(String table, Map<String, dynamic> row) async => row;
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

final api = Api();
final auth = Auth();
final storage = Storage();
`,
  }]
}

function nodeFiles(ir: Ir, code: string, schema: DataSchema): CompiledFile[] {
  const files: CompiledFile[] = [
    {
      path: 'build/node/server.mjs',
      contents: `// A local runner: serves the built web target on http://localhost:4173.
// No dependencies, so \`node build/node/server.mjs\` is the whole setup.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' }

createServer(async (request, response) => {
  const path = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  try {
    const body = await readFile(join(root, path))
    const extension = path.slice(path.lastIndexOf('.'))
    response.writeHead(200, { 'content-type': types[extension] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(4173, () => console.log('Tungsten build running on http://localhost:4173'))
`,
    },
    {
      path: 'build/node/package.json',
      contents: `${JSON.stringify({
        name: 'tungsten-build',
        private: true,
        type: 'module',
        scripts: { start: 'node server.mjs' },
      }, null, 2)}\n`,
    },
    { path: 'build/node/app.ts', contents: code },
  ]

  if (schema.tables.length) {
    files.push({ path: 'build/node/migrations/0001_init.sql', contents: createMigration(schema) })
  }

  return files
}

/**
 * Compiles the graph for one target.
 *
 * The integrity report gates this, not the caller: every path into
 * compilation gets the same refusal, with the same wording.
 */
export function compile({
  graph,
  registry,
  schema = { tables: [] },
  state = [],
  screens = DEFAULT_SCREENS,
  target,
}: CompileInput): CompileResult {
  const report = checkIntegrity(graph, registry, state, screens)
  const errors = report.diagnostics.filter((entry) => entry.severity === 'error')
  if (errors.length) {
    return {
      ok: false,
      target,
      reason: `${errors.length} integrity error${errors.length === 1 ? '' : 's'} block compilation. First: ${errors[0].message}`,
    }
  }
  if (!graph.nodes.length) {
    return { ok: false, target, reason: 'There is nothing on the canvas to compile.' }
  }

  const ir = buildIr(graph, registry, schema, screens)
  // The first paint is the home screen's, because that is the screen the
  // program opens on. Handing it every component would paint the whole app
  // at once and then let the first render delete most of it.
  const ui: UiDocument = { components: ir.screens.find((screen) => screen.name === ir.home)?.components ?? ir.components }
  const { code } = generateProgram(graph, registry, state, screens)

  const files = target === 'mobile'
    ? mobileFiles(ir)
    : target === 'node'
      ? nodeFiles(ir, code, schema)
      : webFiles(ir, ui, code, schema)

  return {
    ok: true,
    target,
    files,
    summary: `${files.length} file${files.length === 1 ? '' : 's'} for ${target}${
      screens.length > 1 ? ` (${screens.length} screens)` : ''
    }: ${files.map((file) => file.path.split('/').pop()).join(', ')}`,
  }
}

/** The static markup of the current interface, for a quick look. */
export function previewMarkup(
  graph: BlockGraph,
  registry: BlockRegistry,
  options: { screen?: string; screens?: readonly Screen[] } = {},
): string {
  return renderDocumentBody(schemaFromGraph(graph, registry, options))
}
