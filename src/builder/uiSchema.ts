/**
 * The universal component schema.
 *
 * Every UI block projects onto one shape -- id, type, properties, layout,
 * events -- and that shape is the only thing the preview, the web target and
 * the mobile target read. None of them knows what a block is. Adding a
 * renderer is writing something that consumes this, not something that walks
 * the graph again.
 *
 * The schema is derived, never stored. It cannot drift from the graph
 * because it is recomputed from it.
 */

import type { BlockDefinition, BlockGraph, BlockNode, BlockRegistry } from './blockSchema'

export type ComponentType = 'button' | 'text' | 'input' | 'unknown'

export type ComponentSchema = {
  /** The element id in the rendered output, and what an event block targets. */
  id: string
  type: ComponentType
  properties: Record<string, string | number | boolean>
  layout: {
    x: number
    y: number
    /** Reading order, taken from the canvas: top to bottom, left to right. */
    order: number
  }
  /** Event name to the id of the block that runs, for the traceback. */
  events: Record<string, string>
  /** The block this came from, so a preview error can point at it. */
  nodeId: string
}

export type UiDocument = { components: ComponentSchema[] }

/**
 * The value a port will have at runtime.
 *
 * A port the user has not touched still has its declared default, and the
 * generated code uses it -- so the schema has to read it from the same place,
 * or the preview would render `button-1` for a button the program calls
 * `submit` and the click handler would find nothing to bind to.
 */
function staticValue(
  node: BlockNode,
  definition: BlockDefinition | undefined,
  portId: string,
  fallback = '',
): string {
  const declared = definition?.inputs.find((port) => port.id === portId)?.default
  const value = node.values[portId] ?? declared
  return value === undefined || value === '' ? fallback : String(value)
}

const TYPE_BY_BLOCK: Record<string, ComponentType> = {
  'ui.button': 'button',
  'ui.text': 'text',
  'ui.input': 'input',
}

/**
 * Projects the graph's UI blocks into the component schema.
 *
 * Click handlers are matched by element id, which is the same thing the
 * generated code does -- `app.onClick("save", ...)` finds the button whose
 * id is `save` -- so the preview and the program agree on what is wired to
 * what without either one consulting the other.
 */
export function schemaFromGraph(graph: BlockGraph, registry: BlockRegistry): UiDocument {
  const ordered = [...graph.nodes].sort((a, b) => (
    a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id)
  ))

  const clickHandlers = new Map<string, string>()
  for (const node of ordered) {
    if (node.type !== 'event.click') continue
    clickHandlers.set(staticValue(node, registry.get(node.type), 'target', 'submit'), node.id)
  }

  const components: ComponentSchema[] = []

  ordered.forEach((node) => {
    const definition = registry.get(node.type)
    if (!definition || definition.category !== 'UI') return

    const type = TYPE_BY_BLOCK[node.type] ?? 'unknown'
    const id = type === 'text'
      ? `text-${components.length + 1}`
      : staticValue(node, definition, 'id', `${type}-${components.length + 1}`)

    const properties: Record<string, string | number | boolean> = {}
    if (type === 'button') properties.text = staticValue(node, definition, 'text', 'Submit')
    if (type === 'text') properties.value = staticValue(node, definition, 'value', '')
    if (type === 'input') properties.placeholder = staticValue(node, definition, 'placeholder', '')

    // Style properties travel with the component rather than being applied
    // by whoever renders it: the preview, the web bundle and the mobile
    // export then agree by construction instead of by convention.
    for (const port of definition.inputs.filter((entry) => entry.property)) {
      const value = node.values[port.id]
      if (value === undefined || value === '' || value === port.default) continue
      properties[port.id] = value
    }

    const handler = clickHandlers.get(id)

    components.push({
      id,
      type,
      properties,
      layout: { x: node.position.x, y: node.position.y, order: components.length },
      events: handler ? { click: handler } : {},
      nodeId: node.id,
    })
  })

  return { components }
}

/** Escapes text for HTML, since component text is user input. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The markup for one component, shared by the preview and the web target. */
/**
 * The inline style for a component, from its style properties.
 *
 * Colours name Graphene tokens (`accent`, `raised`, `danger`) and resolve
 * to the custom properties the generated document declares, so a themed
 * app stays themed. Anything that is not a token name is passed through --
 * a hex value or a CSS colour still works, it simply stops tracking the
 * design system.
 */
export function styleOf(component: ComponentSchema): string {
  const { properties } = component
  const colour = (value: string) => (TOKEN_NAMES.includes(value) ? `var(--app-${value})` : value)
  const rules: string[] = []

  if (typeof properties.radius === 'number') rules.push(`border-radius:${properties.radius}px`)
  if (properties.padding) rules.push(`padding:${String(properties.padding)}`)
  if (properties.background) rules.push(`background:${colour(String(properties.background))}`)
  if (properties.color) rules.push(`color:${colour(String(properties.color))}`)
  if (properties.width) rules.push(`width:${String(properties.width)}`)
  if (properties.align) rules.push(`text-align:${String(properties.align)}`)

  return rules.length ? ` style="${escapeHtml(rules.join(';'))}"` : ''
}

/** The token names `styleOf` resolves. Mirrors the variables in uiTokens. */
export const TOKEN_NAMES = [
  'surface', 'raised', 'border', 'text', 'muted', 'accent', 'accent-ink', 'danger',
]

export function renderComponent(component: ComponentSchema): string {
  const id = escapeHtml(component.id)
  const style = styleOf(component)
  if (component.type === 'button') {
    return `<button id="${id}" data-node="${escapeHtml(component.nodeId)}"${style}>${
      escapeHtml(String(component.properties.text ?? 'Submit'))
    }</button>`
  }
  if (component.type === 'input') {
    return `<input id="${id}" data-node="${escapeHtml(component.nodeId)}"${style} placeholder="${
      escapeHtml(String(component.properties.placeholder ?? ''))
    }" />`
  }
  if (component.type === 'text') {
    return `<p id="${id}" data-node="${escapeHtml(component.nodeId)}"${style}>${
      escapeHtml(String(component.properties.value ?? ''))
    }</p>`
  }
  return `<div id="${id}"></div>`
}

export function renderDocumentBody(document: UiDocument): string {
  if (!document.components.length) {
    return '<p class="empty">No interface yet. Add a Button, Text or Text Input block.</p>'
  }
  return document.components.map(renderComponent).join('\n      ')
}
