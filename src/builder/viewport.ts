/**
 * The camera over the canvas.
 *
 * Until now the canvas was a scrolling box: blocks lived at fixed pixel
 * positions and you found them by scrolling. That is fine for nine blocks
 * and useless for ninety. A viewport separates *where a block is* from
 * *where it is drawn*, which is what makes zoom, pan, fit-to-content and
 * "show me that block" all the same operation.
 *
 * One transform, in one direction, defined once:
 *
 *     screen = canvas * zoom + offset
 *     canvas = (screen - offset) / zoom
 *
 * Everything else here is that equation with a purpose attached. Node
 * positions never change when the view does -- a zoom must not edit the
 * document -- so the graph is untouched by any of this.
 */

export type Viewport = {
  /** 1 is actual size. */
  zoom: number
  /** Where canvas origin lands on screen, in screen pixels. */
  x: number
  y: number
}

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Bounds = Point & Size

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 5
export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, x: 0, y: 0 }

/** The stops the zoom buttons and the keyboard step through. */
export const ZOOM_STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]

export function clampZoom(zoom: number): number {
  // NaN means "we do not know", and the honest answer to that is actual
  // size. An infinity means a multiply ran away, and the honest answer to
  // that is the limit it was heading for -- resetting the view to 100%
  // because a gesture overshot would be the more surprising of the two.
  if (Number.isNaN(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** A point in the view, in canvas coordinates. */
export function toCanvas(viewport: Viewport, screen: Point): Point {
  return { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom }
}

/** …and back again. */
export function toScreen(viewport: Viewport, canvas: Point): Point {
  return { x: canvas.x * viewport.zoom + viewport.x, y: canvas.y * viewport.zoom + viewport.y }
}

/**
 * Zooms about a point, leaving whatever is under that point where it is.
 *
 * This is the whole difference between zoom that feels like a camera and
 * zoom that feels like the document jumping away from you: the pixel under
 * the cursor must not move.
 */
export function zoomAt(viewport: Viewport, factor: number, anchor: Point): Viewport {
  const zoom = clampZoom(viewport.zoom * factor)
  if (zoom === viewport.zoom) return viewport
  const before = toCanvas(viewport, anchor)
  // Solve offset so that `before` still maps to `anchor` at the new zoom.
  return { zoom, x: anchor.x - before.x * zoom, y: anchor.y - before.y * zoom }
}

/** Sets an exact zoom about a point -- what the percentage box does. */
export function zoomTo(viewport: Viewport, zoom: number, anchor: Point): Viewport {
  return zoomAt(viewport, clampZoom(zoom) / viewport.zoom, anchor)
}

/** The next stop up or down, for the buttons and for Ctrl+plus / Ctrl+minus. */
export function nextZoomStop(zoom: number, direction: 1 | -1): number {
  const stops = direction === 1 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse()
  const next = stops.find((stop) => (direction === 1 ? stop > zoom + 0.001 : stop < zoom - 0.001))
  return clampZoom(next ?? zoom)
}

export function pan(viewport: Viewport, delta: Point): Viewport {
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y }
}

/** The box that contains everything, in canvas coordinates. */
export function contentBounds(boxes: readonly Bounds[]): Bounds | undefined {
  if (!boxes.length) return undefined
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  }
}

/**
 * The view that shows all of `bounds`, centred, with room around it.
 *
 * Never zooms past 1: filling the screen with four enormous blocks because
 * that is all there is reads as broken, not as helpful.
 */
export function fitTo(bounds: Bounds | undefined, view: Size, padding = 48): Viewport {
  if (!bounds || !view.width || !view.height) return DEFAULT_VIEWPORT
  const usable = { width: Math.max(1, view.width - padding * 2), height: Math.max(1, view.height - padding * 2) }
  const zoom = clampZoom(Math.min(
    usable.width / Math.max(1, bounds.width),
    usable.height / Math.max(1, bounds.height),
    1,
  ))
  return {
    zoom,
    x: (view.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (view.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  }
}

/** Moves the view so a canvas point sits in the middle, keeping the zoom. */
export function centreOn(viewport: Viewport, point: Point, view: Size): Viewport {
  return {
    ...viewport,
    x: view.width / 2 - point.x * viewport.zoom,
    y: view.height / 2 - point.y * viewport.zoom,
  }
}

/** True when a canvas box is at least partly in view: worth drawing. */
export function isVisible(viewport: Viewport, view: Size, box: Bounds, margin = 200): boolean {
  const topLeft = toScreen(viewport, box)
  const bottomRight = toScreen(viewport, { x: box.x + box.width, y: box.y + box.height })
  return bottomRight.x > -margin && topLeft.x < view.width + margin
    && bottomRight.y > -margin && topLeft.y < view.height + margin
}

/** The CSS for the transformed layer. One place, so nothing disagrees. */
export function transformOf(viewport: Viewport): string {
  return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
}

/** What the zoom control shows. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
