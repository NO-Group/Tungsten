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
import {
  renderDocumentBody,
  schemaFromGraph,
  type ComponentSchema,
  type UiDocument,
} from './uiSchema'
import { DEFAULT_SCREENS, homeScreen, screenOf, type Screen } from './screens'
import type { AppVariable } from './appState'
import {
  defaultOrganization,
  slug,
  targetInfo,
  toolchainFor,
  type Project,
  type TargetKind,
} from '../project/targets'
import { androidFiles } from './targets/android'
import { iosFiles } from './targets/ios'
import { desktopFiles, isDesktopKind } from './targets/desktop'
import { flutterFiles } from './targets/flutter'
import { tauriFiles } from './targets/tauri'
import { DEFAULT_API_URL, serverFiles } from './targets/server'

export const IR_VERSION = 1

export type IrValue =
  | { kind: 'literal'; value: string | number | boolean }
  /** The result of a block that occupied a step, held in a variable. */
  | { kind: 'reference'; node: string; port: string }
  /**
   * A pure expression block, inlined where it is used.
   *
   * Without this the IR could only describe values that came out of a
   * statement, so every target that reads the IR rather than the generated
   * TypeScript -- the three native ones -- turned reading a field, comparing
   * two things or doing arithmetic into `null`. A phone app built from a
   * sign-in form really did call signUp(null, null).
   */
  | { kind: 'call'; node: string; type: string; port: string; inputs: Record<string, IrValue> }
  | { kind: 'empty' }

/** The `call` arm, named: the emitters all switch on it. */
export type IrCall = Extract<IrValue, { kind: 'call' }>

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

  const valueFor = (node: BlockNode, portId: string, seen: Set<string> = new Set()): IrValue => {
    const link = incoming(graph, node.id, portId)
    if (!link) {
      const definition = registry.get(node.type)
      const port = definition?.inputs.find((candidate) => candidate.id === portId)
      const value = node.values[portId] ?? port?.default
      return value === undefined ? { kind: 'empty' } : { kind: 'literal', value }
    }

    const source = nodeById(graph, link.from.node)
    const definition = source && registry.get(source.type)
    if (!source || !definition) return { kind: 'empty' }

    // A block that occupies a step stored its result in a variable, so it
    // is referred to by name. A pure expression has no variable to refer
    // to -- it is lowered in place, arguments and all.
    const isStatement = definition.inputs.some((port) => port.type === 'Exec')
    if (isStatement) return { kind: 'reference', node: link.from.node, port: link.from.port }
    // Expressions cannot legally form a cycle, but a corrupt file can
    // describe one, and recursing into it would be an infinite loop
    // rather than an error message.
    if (seen.has(source.id)) return { kind: 'empty' }

    const inner = new Set(seen).add(source.id)
    const inputs: Record<string, IrValue> = {}
    for (const port of definition.inputs) {
      if (port.type === 'Exec') continue
      inputs[port.id] = valueFor(source, port.id, inner)
    }
    return { kind: 'call', node: source.id, type: source.type, port: link.from.port, inputs }
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

/**
 * A target is a platform from the project tree, plus one that is not a
 * platform at all: `node`, the local runner, which exists so a build can
 * be looked at without deploying it anywhere.
 */
/**
 * What can be built.
 *
 * The seven platforms, plus two things that are not platforms: the local
 * runner, which serves a built bundle, and the backend service every one
 * of the platforms talks to.
 */
export type CompileTarget = TargetKind | 'node' | 'server'

/**
 * The project a build is for, when the caller has not said.
 *
 * The same one `useBuilder` starts a fresh workspace with, so a build from
 * a test and a build from the workbench land in the same place.
 */
export const DEFAULT_PROJECT: Project = defaultOrganization().projects[0]

/**
 * Where a target's source tree is written.
 *
 * Every target gets its own directory under the project, so building all
 * six writes six complete, independent source trees and none of them can
 * overwrite another's `README.md`.
 */
export function targetRoot(project: Project, target: CompileTarget): string {
  if (target === 'node') return `targets/${slug(project.name) || 'app'}/runner`
  if (target === 'server') return `targets/${slug(project.name) || 'app'}/server`
  const directory = targetInfo(target).directory
  return `targets/${slug(project.name) || 'app'}/${directory}`
}

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
  /**
   * Who this is being built for and what it is called.
   *
   * Optional so every existing caller and test keeps working, but not
   * cosmetic: the application id, the version and the package name all
   * come from here, and on Android and iOS they are the difference
   * between a build and an error.
   */
  project?: Project
}

/**
 * The interface, as data.
 *
 * A single-screen app writes a flat component list so the common case
 * stays readable; a multi-screen app writes the screens and which one is
 * home. Shared by the web target and the three desktop targets, which
 * render with it.
 */
function uiSchemaJson(ir: Ir): string {
  return `${JSON.stringify(
    ir.screens.length > 1
      ? { home: ir.home, screens: ir.screens.map((screen) => ({ name: screen.name, components: screen.components })) }
      : { components: ir.components },
    null,
    2,
  )}\n`
}

function webFiles(root: string, ir: Ir, ui: UiDocument, code: string, schema: DataSchema): CompiledFile[] {
  const files: CompiledFile[] = [
    {
      path: `${root}/index.html`,
      contents: previewHtml({ document: ui, code, screen: ir.home, api: DEFAULT_API_URL }),
    },
    {
      path: `${root}/app.ts`,
      contents: code,
    },
    {
      path: `${root}/ui.schema.json`,
      contents: uiSchemaJson(ir),
    },
    {
      path: `${root}/README.md`,
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
      { path: `${root}/migrations/0001_init.sql`, contents: createMigration(schema) },
      { path: `${root}/data/fetchers.ts`, contents: createFetchers(schema) },
    )
  }

  return files
}

function nodeFiles(root: string, ir: Ir, code: string, schema: DataSchema): CompiledFile[] {
  const files: CompiledFile[] = [
    {
      path: `${root}/server.mjs`,
      contents: `// A local runner: serves the built web target on http://localhost:4173.
// No dependencies, so \`node server.mjs\` in this folder is the whole setup.

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
      path: `${root}/package.json`,
      contents: `${JSON.stringify({
        name: 'tungsten-build',
        private: true,
        type: 'module',
        scripts: { start: 'node server.mjs' },
      }, null, 2)}\n`,
    },
    { path: `${root}/app.ts`, contents: code },
  ]

  if (schema.tables.length) {
    files.push({ path: `${root}/migrations/0001_init.sql`, contents: createMigration(schema) })
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
  project = DEFAULT_PROJECT,
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

  const root = targetRoot(project, target)
  const files = filesFor({ target, root, ir, ui, code, schema, project })

  return {
    ok: true,
    target,
    files,
    summary: `${files.length} file${files.length === 1 ? '' : 's'} for ${
      target === 'node' ? 'the local runner'
        : target === 'server' ? 'the backend service'
        : targetInfo(target).label
    }${screens.length > 1 ? ` (${screens.length} screens)` : ''}: ${
      files.map((file) => file.path.split('/').pop()).join(', ')
    }`,
  }
}

type EmitInput = {
  target: CompileTarget
  root: string
  ir: Ir
  ui: UiDocument
  code: string
  schema: DataSchema
  project: Project
}

/**
 * The one place that knows which emitter belongs to which target.
 *
 * Desktop targets render with the web output rather than a renderer of
 * their own, so they are built from the web files; the phones get real
 * native source. Everything is prefixed with the target's own root here,
 * so no emitter has to remember where it is being written.
 */
function filesFor({ target, root, ir, ui, code, schema, project }: EmitInput): CompiledFile[] {
  const at = (files: CompiledFile[]) => files.map((file) => ({ ...file, path: `${root}/${file.path}` }))

  // Which emitter runs is the target *and* the toolchain chosen for it:
  // an Android build is Flutter or Kotlin depending on what the project
  // asked for, and both are first-class.
  if (target === 'server') return at(serverFiles({ schema, project }))
  const toolchain = target === 'node' ? 'web' : toolchainFor(project, target)

  if (target === 'android') {
    return toolchain === 'kotlin' ? at(androidFiles(ir, project)) : flutterFiles({ root, ir, project, kind: 'android' })
  }
  if (target === 'ios') {
    return toolchain === 'swift' ? at(iosFiles(ir, project)) : flutterFiles({ root, ir, project, kind: 'ios' })
  }
  if (isDesktopKind(target)) {
    const shell = {
      html: previewHtml({ document: ui, code, screen: ir.home, api: DEFAULT_API_URL }),
      code,
      schema: uiSchemaJson(ir),
      project,
      kind: target,
    }
    return at(toolchain === 'electron' ? desktopFiles(shell) : tauriFiles(shell))
  }
  if (target === 'mobile') return flutterFiles({ root, ir, project, kind: 'mobile' })
  if (target === 'node') return nodeFiles(root, ir, code, schema)
  return webFiles(root, ir, ui, code, schema)
}

/** The static markup of the current interface, for a quick look. */
export function previewMarkup(
  graph: BlockGraph,
  registry: BlockRegistry,
  options: { screen?: string; screens?: readonly Screen[] } = {},
): string {
  return renderDocumentBody(schemaFromGraph(graph, registry, options))
}
