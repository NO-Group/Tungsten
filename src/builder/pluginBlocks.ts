/**
 * Third-party blocks, loaded from the workspace.
 *
 * A plugin is a JSON file under `plugins/` ending in `.block.json`. It is
 * data, not code: the generator is a template with `${port}` holes, and the
 * only thing ever substituted into a hole is an expression the builder itself
 * produced. Nothing from the file is evaluated.
 *
 * That constraint is the point. A block library that loads executable modules
 * from the workspace is a supply-chain hole wearing a friendly name, and the
 * templates cover what blocks actually do: call something, with arguments.
 */

import { defineBlock, type BlockCategory, type BlockDefinition, type Port, type PortType } from './blockSchema'

export const PLUGIN_DIRECTORY = 'plugins'
export const PLUGIN_SUFFIX = '.block.json'

const PORT_TYPES: PortType[] = ['Exec', 'String', 'Number', 'Boolean', 'List', 'Object', 'Any']
const CATEGORIES: BlockCategory[] = ['Events', 'UI', 'Logic', 'Data', 'Network', 'Auth', 'Storage']

export type PluginManifest = {
  type: string
  label: string
  category: string
  description?: string
  isAsync?: boolean
  inputs?: Array<Partial<Port>>
  outputs?: Array<Partial<Port>>
  /** `await slack.send(${text})` -- holes are port ids, nothing else. */
  template: string
}

export type PluginLoad = {
  blocks: BlockDefinition[]
  /**
   * The manifests the blocks came from.
   *
   * A block carries functions and cannot be sent to a worker; its manifest
   * is data and can, so the integrity worker rebuilds the same registry.
   */
  manifests: PluginManifest[]
  /** One line per file that could not be loaded, shown in the palette. */
  problems: Array<{ path: string; message: string }>
}

function readPorts(ports: Array<Partial<Port>> | undefined, fallbackExec: boolean): Port[] {
  const declared = (ports ?? [])
    .filter((port): port is Port => Boolean(port?.id && port.label))
    .map((port) => ({
      id: String(port.id),
      label: String(port.label),
      type: PORT_TYPES.includes(port.type as PortType) ? (port.type as PortType) : 'Any',
      default: port.default,
      required: Boolean(port.required),
    }))

  // A plugin that forgets its execution ports would float off the chain and
  // never run, so the common case is filled in rather than rejected.
  if (fallbackExec && !declared.some((port) => port.type === 'Exec')) {
    return [{ id: 'exec', label: 'Run', type: 'Exec' }, ...declared]
  }
  return declared
}

/** Turns one manifest into a block, or explains why it cannot. */
export function blockFromManifest(manifest: PluginManifest): BlockDefinition | string {
  if (!manifest || typeof manifest !== 'object') return 'The file is not a block manifest.'
  if (!manifest.type || !/^[a-z][a-z0-9]*\.[a-zA-Z0-9_]+$/.test(manifest.type)) {
    return 'A block needs a type like “acme.sendEmail”.'
  }
  if (!manifest.label) return `“${manifest.type}” has no label.`
  if (typeof manifest.template !== 'string' || !manifest.template.trim()) {
    return `“${manifest.type}” has no code template.`
  }

  const inputs = readPorts(manifest.inputs, true)
  const outputs = readPorts(manifest.outputs, false)
  const known = new Set(inputs.map((port) => port.id))

  for (const hole of manifest.template.matchAll(/\$\{([^}]*)\}/g)) {
    if (!known.has(hole[1])) {
      return `“${manifest.type}” fills “${hole[1]}” but has no input with that id.`
    }
  }

  const category = CATEGORIES.includes(manifest.category as BlockCategory)
    ? (manifest.category as BlockCategory)
    : 'Data'

  const binds = outputs.some((port) => port.type !== 'Exec')
  const hasExecOutput = outputs.some((port) => port.type === 'Exec')

  return defineBlock({
    type: manifest.type,
    label: manifest.label,
    category,
    description: manifest.description ?? 'Contributed by a workspace plugin.',
    isAsync: Boolean(manifest.isAsync),
    inputs,
    outputs: hasExecOutput ? outputs : [{ id: 'exec', label: 'Then', type: 'Exec' }, ...outputs],
    generate: ({ input, symbol }) => {
      const body = manifest.template.replace(/\$\{([^}]*)\}/g, (_, port: string) => input(port))
      return binds ? `const ${symbol} = ${body}` : body
    },
  })
}

/**
 * Loads every plugin in the workspace.
 *
 * Called with whatever the workbench already has in memory, so it works the
 * same in the browser and on the desktop, and a plugin appears in the sidebar
 * the moment its file is saved rather than at the next restart.
 */
export function loadPluginBlocks(files: Array<{ path: string; content: string }>): PluginLoad {
  const blocks: BlockDefinition[] = []
  const manifests: PluginManifest[] = []
  const problems: PluginLoad['problems'] = []

  const candidates = files
    .filter((file) => file.path.endsWith(PLUGIN_SUFFIX) && file.path.split('/').includes(PLUGIN_DIRECTORY))
    .sort((a, b) => a.path.localeCompare(b.path))

  for (const file of candidates) {
    let manifest: PluginManifest
    try {
      manifest = JSON.parse(file.content) as PluginManifest
    } catch {
      problems.push({ path: file.path, message: 'The file is not valid JSON.' })
      continue
    }

    const result = blockFromManifest(manifest)
    if (typeof result === 'string') {
      problems.push({ path: file.path, message: result })
      continue
    }
    blocks.push(result)
    manifests.push(manifest)
  }

  return { blocks, manifests, problems }
}

/** A starter manifest, written when the user asks for an example plugin. */
export const EXAMPLE_PLUGIN = `{
  "type": "acme.notify",
  "label": "Send Notification",
  "category": "Network",
  "description": "Posts a message to the team channel.",
  "isAsync": true,
  "inputs": [
    { "id": "channel", "label": "Channel", "type": "String", "default": "general", "required": true },
    { "id": "message", "label": "Message", "type": "String", "required": true }
  ],
  "outputs": [
    { "id": "sent", "label": "Sent", "type": "Boolean" }
  ],
  "template": "await notify.send(\${channel}, \${message})"
}
`
