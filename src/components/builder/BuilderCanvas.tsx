/**
 * The puzzle canvas.
 *
 * Blocks are plain elements positioned absolutely; the wires are one SVG
 * layer behind them. There is no graph library here on purpose -- the whole
 * interaction is "drag a block, click two ports", and a dependency that
 * brings its own state model would put a second source of truth next to the
 * one the rest of the builder is built on.
 *
 * Connecting is two clicks rather than a drag: click an output, click an
 * input. It is easier to hit, it works the same on a trackpad, and a
 * half-made connection can be cancelled with Escape instead of by guessing
 * where to let go.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'

import type { BlockGraph, BlockRegistry, Connection, Port } from '../../builder/blockSchema'
import type { BuilderDiagnostic, IntegrityReport } from '../../builder/integrity'
import { incoming } from '../../builder/graph'

export const NODE_WIDTH = 216
const HEADER_HEIGHT = 30
const ROW_HEIGHT = 26

export type BuilderCanvasProps = {
  graph: BlockGraph
  registry: BlockRegistry
  report: IntegrityReport
  diagnostics: Map<string, BuilderDiagnostic[]>
  selected?: string
  revealed?: string
  /** Blocks cannot be edited while the text does not parse. */
  readOnly?: boolean
  onSelect: (id?: string) => void
  onMove: (id: string, position: { x: number; y: number }) => void
  onRemove: (id: string) => void
  onValue: (id: string, portId: string, value: string | number | boolean) => void
  onLink: (from: Connection['from'], to: Connection['to']) => void
  onUnlink: (connectionId: string) => void
}

type Pending = { node: string; port: string; type: Port['type'] }

/** Where a port sits, relative to the canvas. */
function portPosition(
  graph: BlockGraph,
  registry: BlockRegistry,
  nodeId: string,
  portId: string,
  side: 'in' | 'out',
) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const definition = node && registry.get(node.type)
  if (!node || !definition) return undefined
  const ports = side === 'in'
    ? definition.inputs
    : [...definition.outputs, ...(definition.slots ?? [])]
  const index = ports.findIndex((port) => port.id === portId)
  if (index < 0) return undefined
  return {
    x: node.position.x + (side === 'in' ? 0 : NODE_WIDTH),
    y: node.position.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2,
  }
}

export function BuilderCanvas(props: BuilderCanvasProps) {
  const { graph, registry, report, diagnostics, selected, revealed, readOnly } = props
  const { onSelect, onMove, onRemove, onValue, onLink, onUnlink } = props

  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const surface = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | undefined>(undefined)

  useEffect(() => {
    if (!revealed) return
    const element = surface.current?.querySelector(`[data-node="${revealed}"]`)
    element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [revealed])

  const startDrag = useCallback((event: React.MouseEvent, id: string) => {
    if (readOnly) return
    const node = graph.nodes.find((candidate) => candidate.id === id)
    const bounds = surface.current?.getBoundingClientRect()
    if (!node || !bounds) return
    drag.current = {
      id,
      dx: event.clientX - bounds.left + (surface.current?.scrollLeft ?? 0) - node.position.x,
      dy: event.clientY - bounds.top + (surface.current?.scrollTop ?? 0) - node.position.y,
    }
    onSelect(id)
  }, [graph.nodes, onSelect, readOnly])

  useEffect(() => {
    if (readOnly) return undefined
    const move = (event: MouseEvent) => {
      const current = drag.current
      const bounds = surface.current?.getBoundingClientRect()
      if (!current || !bounds) return
      onMove(current.id, {
        x: Math.max(0, Math.round(event.clientX - bounds.left + (surface.current?.scrollLeft ?? 0) - current.dx)),
        y: Math.max(0, Math.round(event.clientY - bounds.top + (surface.current?.scrollTop ?? 0) - current.dy)),
      })
    }
    const up = () => { drag.current = undefined }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onMove, readOnly])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPending(undefined) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  const clickPort = useCallback((nodeId: string, port: Port, side: 'in' | 'out') => {
    if (readOnly) return
    if (side === 'out') {
      setPending({ node: nodeId, port: port.id, type: port.type })
      return
    }
    if (!pending) return
    onLink({ node: pending.node, port: pending.port }, { node: nodeId, port: port.id })
    setPending(undefined)
  }, [onLink, pending, readOnly])

  return (
    <div
      className={`builder-canvas${readOnly ? ' read-only' : ''}`}
      ref={surface}
      onMouseDown={(event) => { if (event.target === surface.current) onSelect(undefined) }}
    >
      <svg className="builder-wires">
        {graph.connections.map((connection) => {
          const from = portPosition(graph, registry, connection.from.node, connection.from.port, 'out')
          const to = portPosition(graph, registry, connection.to.node, connection.to.port, 'in')
          if (!from || !to) return null
          const faulty = report.diagnostics.some((entry) => entry.connectionId === connection.id)
          const bend = Math.max(36, Math.abs(to.x - from.x) / 2)
          return (
            <path
              key={connection.id}
              className={`builder-wire${faulty ? ' faulty' : ''}`}
              d={`M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`}
              onClick={() => !readOnly && onUnlink(connection.id)}
            />
          )
        })}
      </svg>

      {graph.nodes.map((node) => {
        const definition = registry.get(node.type)
        const issues = diagnostics.get(node.id) ?? []
        const errors = issues.filter((issue) => issue.severity === 'error')
        const outputs = definition ? [...definition.outputs, ...(definition.slots ?? [])] : []
        const classes = [
          'builder-node',
          selected === node.id ? 'selected' : '',
          report.orphans.has(node.id) ? 'orphan' : '',
          errors.length ? 'faulty' : '',
        ].filter(Boolean).join(' ')

        return (
          <article
            key={node.id}
            data-node={node.id}
            className={classes}
            style={{ left: node.position.x, top: node.position.y, width: NODE_WIDTH }}
            onMouseDown={(event) => startDrag(event, node.id)}
          >
            <header className={`builder-node-header ${definition?.category.toLowerCase() ?? 'unknown'}`}>
              <span className="builder-node-title">{definition?.label ?? node.type}</span>
              {Boolean(errors.length) && <AlertTriangle size={12} aria-label="Has errors" />}
              <button
                className="builder-node-remove"
                aria-label={`Delete ${definition?.label ?? node.type}`}
                disabled={readOnly}
                onClick={(event) => { event.stopPropagation(); onRemove(node.id) }}
              >
                <Trash2 size={12} />
              </button>
            </header>

            <div className="builder-node-body">
              {(definition?.inputs ?? []).map((port) => {
                const linked = incoming(graph, node.id, port.id)
                const isExec = port.type === 'Exec'
                return (
                  <div className="builder-port in" key={port.id} style={{ height: ROW_HEIGHT }}>
                    <button
                      className={`builder-pin ${isExec ? 'exec' : 'data'}${linked ? ' linked' : ''}`}
                      aria-label={`Input ${port.label} of ${definition?.label ?? node.type}`}
                      disabled={readOnly}
                      onClick={(event) => { event.stopPropagation(); clickPort(node.id, port, 'in') }}
                    />
                    <span className="builder-port-label">{port.label}</span>
                    {!isExec && !linked && (
                      <input
                        className="builder-port-value"
                        aria-label={`${port.label} value`}
                        value={String(node.values[port.id] ?? port.default ?? '')}
                        disabled={readOnly}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => onValue(node.id, port.id, event.target.value)}
                      />
                    )}
                  </div>
                )
              })}

              {outputs.map((port) => (
                <div className="builder-port out" key={port.id} style={{ height: ROW_HEIGHT }}>
                  <span className="builder-port-label">{port.label}</span>
                  <button
                    className={`builder-pin ${port.type === 'Exec' ? 'exec' : 'data'}${
                      pending?.node === node.id && pending.port === port.id ? ' pending' : ''
                    }`}
                    aria-label={`Output ${port.label} of ${definition?.label ?? node.type}`}
                    disabled={readOnly}
                    onClick={(event) => { event.stopPropagation(); clickPort(node.id, port, 'out') }}
                  />
                </div>
              ))}
            </div>
          </article>
        )
      })}

      {!graph.nodes.length && (
        <p className="builder-empty">
          Pick a block from the library to start. Events go first; everything else hangs off one.
        </p>
      )}

      {pending && (
        <p className="builder-hint" role="status">
          Click an input to finish the link, or press Escape to cancel.
        </p>
      )}
    </div>
  )
}
