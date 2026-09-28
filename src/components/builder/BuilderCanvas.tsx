/**
 * The puzzle canvas.
 *
 * Blocks are plain elements positioned absolutely; the wires are one SVG
 * layer behind them. There is no graph library here on purpose -- a
 * dependency that brings its own state model would put a second source of
 * truth next to the one the rest of the builder is built on.
 *
 * Three ways to build, because different hands reach for different ones:
 *
 *  - Drag a block out of the library and drop it where you want it.
 *  - Drag a wire from an output pin and let go on an input pin.
 *  - Or click the two pins in turn, which is easier to hit on a trackpad and
 *    can be cancelled with Escape rather than by guessing where to let go.
 *
 * And the puzzle part: drag a block so its Run pin is near another block's
 * Then pin and it snaps into place, connected, the way two pieces do.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'

import type { BlockGraph, BlockRegistry, Connection, Port } from '../../builder/blockSchema'
import type { BuilderDiagnostic, IntegrityReport } from '../../builder/integrity'
import { incoming } from '../../builder/graph'
import {
  BLOCK_DRAG_TYPE, HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT, portPosition, round, snapCandidate,
  type Snap,
} from '../../builder/canvasLayout'

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
  /** A block dragged out of the library and dropped on the canvas. */
  onDropBlock: (type: string, position: { x: number; y: number }) => void
}

type Pending = { node: string; port: string; type: Port['type'] }
type Linking = Pending & { side: 'in' | 'out'; x: number; y: number }

export function BuilderCanvas(props: BuilderCanvasProps) {
  const { graph, registry, report, diagnostics, selected, revealed, readOnly } = props
  const { onSelect, onMove, onRemove, onValue, onLink, onUnlink, onDropBlock } = props

  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const [linking, setLinking] = useState<Linking | undefined>(undefined)
  const [snap, setSnap] = useState<Snap | undefined>(undefined)
  const [dropHint, setDropHint] = useState<{ x: number; y: number } | undefined>(undefined)

  const surface = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | undefined>(undefined)
  const snapRef = useRef<Snap | undefined>(undefined)
  const draggedWire = useRef(false)

  /** Client coordinates to canvas coordinates, scroll included. */
  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const bounds = surface.current?.getBoundingClientRect()
    if (!bounds) return undefined
    return {
      x: clientX - bounds.left + (surface.current?.scrollLeft ?? 0),
      y: clientY - bounds.top + (surface.current?.scrollTop ?? 0),
    }
  }, [])

  useEffect(() => {
    if (!revealed) return
    const element = surface.current?.querySelector(`[data-node="${revealed}"]`)
    element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [revealed])

  const startDrag = useCallback((event: React.MouseEvent, id: string) => {
    if (readOnly) return
    const node = graph.nodes.find((candidate) => candidate.id === id)
    const point = toCanvas(event.clientX, event.clientY)
    if (!node || !point) return
    drag.current = { id, dx: point.x - node.position.x, dy: point.y - node.position.y, moved: false }
    onSelect(id)
  }, [graph.nodes, onSelect, readOnly, toCanvas])

  // Moving a block: the grid keeps layouts tidy, and the snap check runs on
  // every frame so the join is previewed before the mouse is released.
  useEffect(() => {
    if (readOnly) return undefined
    const move = (event: MouseEvent) => {
      const current = drag.current
      const point = current && toCanvas(event.clientX, event.clientY)
      if (!current || !point) return
      current.moved = true
      const position = { x: round(point.x - current.dx), y: round(point.y - current.dy) }
      const candidate = snapCandidate(graph, registry, current.id, position)
      snapRef.current = candidate
      setSnap(candidate)
      onMove(current.id, candidate ? candidate.position : position)
    }
    const up = () => {
      const current = drag.current
      const candidate = snapRef.current
      drag.current = undefined
      snapRef.current = undefined
      setSnap(undefined)
      if (current?.moved && candidate) onLink(candidate.from, candidate.to)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [graph, onLink, onMove, readOnly, registry, toCanvas])

  // Dragging a wire out of a pin.
  useEffect(() => {
    if (!linking) return undefined
    const move = (event: PointerEvent) => {
      const point = toCanvas(event.clientX, event.clientY)
      if (!point) return
      draggedWire.current = true
      setLinking((current) => (current ? { ...current, x: point.x, y: point.y } : current))
    }
    const up = () => setLinking(undefined)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [linking, toCanvas])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPending(undefined)
      setLinking(undefined)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  /** Click-to-link: arm on an output, complete on an input. */
  const clickPort = useCallback((nodeId: string, port: Port, side: 'in' | 'out') => {
    if (readOnly) return
    // A click that was really the end of a wire drag has already linked.
    if (draggedWire.current) { draggedWire.current = false; return }
    if (side === 'out') {
      setPending({ node: nodeId, port: port.id, type: port.type })
      return
    }
    if (!pending) return
    onLink({ node: pending.node, port: pending.port }, { node: nodeId, port: port.id })
    setPending(undefined)
  }, [onLink, pending, readOnly])

  const startWire = useCallback((event: React.PointerEvent, nodeId: string, port: Port, side: 'in' | 'out') => {
    if (readOnly) return
    const point = toCanvas(event.clientX, event.clientY)
    if (!point) return
    event.stopPropagation()
    draggedWire.current = false
    setLinking({ node: nodeId, port: port.id, type: port.type, side, x: point.x, y: point.y })
  }, [readOnly, toCanvas])

  /** Finishing a wire drag on the opposite kind of pin. */
  const finishWire = useCallback((nodeId: string, port: Port, side: 'in' | 'out') => {
    if (!linking || linking.side === side) return
    if (linking.node === nodeId) { setLinking(undefined); return }
    const from = side === 'in' ? { node: linking.node, port: linking.port } : { node: nodeId, port: port.id }
    const to = side === 'in' ? { node: nodeId, port: port.id } : { node: linking.node, port: linking.port }
    onLink(from, to)
    setLinking(undefined)
    setPending(undefined)
  }, [linking, onLink])

  const linkSource = linking
    ? portPosition(graph, registry, linking.node, linking.port, linking.side)
    : undefined

  return (
    <div
      className={`builder-canvas${readOnly ? ' read-only' : ''}${dropHint ? ' dropping' : ''}`}
      ref={surface}
      onMouseDown={(event) => { if (event.target === surface.current) onSelect(undefined) }}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return
        // Without this the browser refuses the drop.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        const point = toCanvas(event.clientX, event.clientY)
        if (point) setDropHint({ x: round(point.x - NODE_WIDTH / 2), y: round(point.y - HEADER_HEIGHT / 2) })
      }}
      onDragLeave={(event) => { if (event.target === surface.current) setDropHint(undefined) }}
      onDrop={(event) => {
        const type = event.dataTransfer.getData(BLOCK_DRAG_TYPE)
        setDropHint(undefined)
        if (readOnly || !type) return
        event.preventDefault()
        const point = toCanvas(event.clientX, event.clientY)
        onDropBlock(type, {
          x: round((point?.x ?? 40) - NODE_WIDTH / 2),
          y: round((point?.y ?? 40) - HEADER_HEIGHT / 2),
        })
      }}
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

        {linking && linkSource && (
          <path
            className="builder-wire dragging"
            data-testid="builder-wire-preview"
            d={`M ${linkSource.x} ${linkSource.y} L ${linking.x} ${linking.y}`}
          />
        )}
      </svg>

      {dropHint && (
        <div
          className="builder-drop-ghost"
          data-testid="builder-drop-ghost"
          style={{ left: dropHint.x, top: dropHint.y, width: NODE_WIDTH }}
        />
      )}

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
          snap && (snap.to.node === node.id || snap.from.node === node.id) ? 'snapping' : '',
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
                const target = linking && linking.side === 'out'
                const snapping = snap?.to.node === node.id && snap.to.port === port.id
                return (
                  <div className="builder-port in" key={port.id} style={{ height: ROW_HEIGHT }}>
                    <button
                      className={`builder-pin ${isExec ? 'exec' : 'data'}${linked ? ' linked' : ''}${
                        target ? ' targetable' : ''}${snapping ? ' snapping' : ''}`}
                      aria-label={`Input ${port.label} of ${definition?.label ?? node.type}`}
                      disabled={readOnly}
                      onPointerDown={(event) => startWire(event, node.id, port, 'in')}
                      onPointerUp={() => finishWire(node.id, port, 'in')}
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

              {outputs.map((port) => {
                const target = linking && linking.side === 'in'
                const snapping = snap?.from.node === node.id && snap.from.port === port.id
                return (
                  <div className="builder-port out" key={port.id} style={{ height: ROW_HEIGHT }}>
                    <span className="builder-port-label">{port.label}</span>
                    <button
                      className={`builder-pin ${port.type === 'Exec' ? 'exec' : 'data'}${
                        pending?.node === node.id && pending.port === port.id ? ' pending' : ''
                      }${target ? ' targetable' : ''}${snapping ? ' snapping' : ''}`}
                      aria-label={`Output ${port.label} of ${definition?.label ?? node.type}`}
                      disabled={readOnly}
                      onPointerDown={(event) => startWire(event, node.id, port, 'out')}
                      onPointerUp={() => finishWire(node.id, port, 'out')}
                      onClick={(event) => { event.stopPropagation(); clickPort(node.id, port, 'out') }}
                    />
                  </div>
                )
              })}
            </div>
          </article>
        )
      })}

      {!graph.nodes.length && (
        <p className="builder-empty">
          Drag a block out of the library and drop it here. Events go first; everything else hangs off one.
        </p>
      )}

      {(pending || linking) && (
        <p className="builder-hint" role="status">
          {linking
            ? 'Let go on a pin to connect.'
            : 'Click an input to finish the link, or press Escape to cancel.'}
        </p>
      )}
    </div>
  )
}
