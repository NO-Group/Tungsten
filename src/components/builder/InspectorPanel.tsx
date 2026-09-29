/**
 * The inspector.
 *
 * CorelDRAW's right-hand docker, doing the job it does there: whatever is
 * selected, and everything you can change about it, in one place. The
 * canvas stays about structure -- what connects to what -- and this is
 * about the thing itself.
 *
 * It renders whatever ports the block declares, so a plugin's properties
 * appear here with no change to this file. There is no list of known
 * blocks in it, and there must never be one.
 */

import { Palette, SlidersHorizontal } from 'lucide-react'

import type { BlockGraph, BlockNode, BlockRegistry, Port } from '../../builder/blockSchema'
import { propertiesOf } from '../../builder/canvasLayout'
import { incoming } from '../../builder/graph'
import { TOKEN_NAMES } from '../../builder/uiSchema'

export type InspectorPanelProps = {
  graph: BlockGraph
  registry: BlockRegistry
  selection: string[]
  readOnly?: boolean
  onValue: (nodeId: string, portId: string, value: string | number | boolean) => void
}

/** Colour properties get swatches; the rest get a field. */
const COLOUR_PORTS = ['background', 'color']

function ColourField({ value, onPick }: { value: string; onPick: (next: string) => void }) {
  return (
    <div className="inspector-swatches">
      {TOKEN_NAMES.map((token) => (
        <button
          key={token}
          className={value === token ? 'active' : ''}
          style={{ background: `var(--app-${token}, var(--${token === 'accent-ink' ? 'inverse' : token}))` }}
          aria-label={token}
          title={token}
          onClick={() => onPick(value === token ? '' : token)}
        />
      ))}
    </div>
  )
}

function PropertyField({
  node, port, readOnly, onValue,
}: {
  node: BlockNode
  port: Port
  readOnly?: boolean
  onValue: InspectorPanelProps['onValue']
}) {
  const raw = node.values[port.id]
  const value = raw === undefined ? port.default ?? '' : raw

  if (COLOUR_PORTS.includes(port.id)) {
    return (
      <label className="inspector-field">
        <span>{port.label}</span>
        <ColourField value={String(value)} onPick={(next) => onValue(node.id, port.id, next)} />
      </label>
    )
  }

  return (
    <label className="inspector-field">
      <span>{port.label}</span>
      <input
        type={port.type === 'Number' ? 'number' : 'text'}
        value={String(value)}
        disabled={readOnly}
        aria-label={`${port.label} of ${node.type}`}
        placeholder={port.default === undefined ? '' : String(port.default)}
        onChange={(event) => onValue(
          node.id,
          port.id,
          port.type === 'Number' ? Number(event.target.value) || 0 : event.target.value,
        )}
      />
    </label>
  )
}

export function InspectorPanel({ graph, registry, selection, readOnly, onValue }: InspectorPanelProps) {
  const nodes = graph.nodes.filter((node) => selection.includes(node.id))

  if (!nodes.length) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-head"><SlidersHorizontal size={12} /> <strong>Inspector</strong></div>
        <p className="inspector-empty">Select a block to see what can be changed about it.</p>
      </aside>
    )
  }

  // With several blocks selected, only the properties they all share can be
  // edited, and editing one writes it to every one of them.
  if (nodes.length > 1) {
    const shared = propertiesOf(registry, nodes[0].type)
      .filter((port) => nodes.every((node) => propertiesOf(registry, node.type).some((entry) => entry.id === port.id)))

    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-head">
          <SlidersHorizontal size={12} /> <strong>{nodes.length} blocks</strong>
        </div>
        {shared.length === 0
          ? <p className="inspector-empty">These blocks have no properties in common.</p>
          : (
            <section>
              <h4><Palette size={11} /> Shared style</h4>
              {shared.map((port) => (
                <PropertyField
                  key={port.id}
                  node={nodes[0]}
                  port={port}
                  readOnly={readOnly}
                  onValue={(_, portId, value) => nodes.forEach((node) => onValue(node.id, portId, value))}
                />
              ))}
            </section>
          )}
      </aside>
    )
  }

  const node = nodes[0]
  const definition = registry.get(node.type)
  const properties = propertiesOf(registry, node.type)
  // A wired input is shown, but not edited here: the wire is the value, and
  // a field that silently does nothing is worse than no field.
  const inputs = (definition?.inputs ?? []).filter((port) => !port.property && port.type !== 'Exec')

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-head">
        <SlidersHorizontal size={12} />
        <strong>{definition?.label ?? node.type}</strong>
        <span className="inspector-type">{node.type}</span>
      </div>

      <p className="inspector-note">{definition?.description}</p>

      {Boolean(inputs.length) && (
        <section>
          <h4>Inputs</h4>
          {inputs.map((port) => {
            const wired = incoming(graph, node.id, port.id)
            return wired
              ? (
                <div className="inspector-field wired" key={port.id}>
                  <span>{port.label}</span>
                  <em>from a wire</em>
                </div>
              )
              : (
                <PropertyField key={port.id} node={node} port={port} readOnly={readOnly} onValue={onValue} />
              )
          })}
        </section>
      )}

      {Boolean(properties.length) && (
        <section>
          <h4><Palette size={11} /> Style</h4>
          {properties.map((port) => (
            <PropertyField key={port.id} node={node} port={port} readOnly={readOnly} onValue={onValue} />
          ))}
        </section>
      )}

      <section>
        <h4>Position</h4>
        <p className="inspector-position">
          x {Math.round(node.position.x)} · y {Math.round(node.position.y)}
        </p>
      </section>
    </aside>
  )
}

export default InspectorPanel
