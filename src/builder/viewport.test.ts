/**
 * The camera.
 *
 * The property that matters most is the one people notice instantly when
 * it is wrong: zooming about a point must leave that point still. Almost
 * every other bug in a canvas camera is a consequence of getting that one
 * equation backwards.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEWPORT, MAX_ZOOM, MIN_ZOOM, ZOOM_STOPS, centreOn, clampZoom, contentBounds, fitTo,
  isVisible, nextZoomStop, pan, toCanvas, toScreen, transformOf, zoomAt, zoomLabel, zoomTo,
} from './viewport'
import { TOOLS, cursorFor, effectiveTool, toolById, toolForKey } from './tools'

const view = { width: 800, height: 600 }

describe('the transform', () => {
  it('round-trips a point at any zoom', () => {
    for (const viewport of [DEFAULT_VIEWPORT, { zoom: 0.35, x: -120, y: 44 }, { zoom: 3.5, x: 900, y: -700 }]) {
      const canvas = { x: 137, y: -42 }
      const back = toCanvas(viewport, toScreen(viewport, canvas))
      expect(back.x).toBeCloseTo(canvas.x, 6)
      expect(back.y).toBeCloseTo(canvas.y, 6)
    }
  })

  it('places the origin where the offset says', () => {
    expect(toScreen({ zoom: 2, x: 50, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 50, y: 20 })
    expect(toScreen({ zoom: 2, x: 50, y: 20 }, { x: 10, y: 10 })).toEqual({ x: 70, y: 40 })
  })

  it('writes one CSS transform, and one label', () => {
    expect(transformOf({ zoom: 1.5, x: 12, y: -8 })).toBe('translate(12px, -8px) scale(1.5)')
    expect(zoomLabel(0.335)).toBe('34%')
  })
})

describe('zooming', () => {
  it('leaves the point under the cursor exactly where it was', () => {
    const anchor = { x: 512, y: 333 }
    let viewport = { zoom: 1, x: 0, y: 0 }
    const target = toCanvas(viewport, anchor)

    for (const factor of [1.2, 1.2, 0.8, 3, 0.5]) {
      viewport = zoomAt(viewport, factor, anchor)
      const still = toScreen(viewport, target)
      expect(still.x).toBeCloseTo(anchor.x, 6)
      expect(still.y).toBeCloseTo(anchor.y, 6)
    }
  })

  it('stops at the limits rather than inverting or vanishing', () => {
    let viewport = DEFAULT_VIEWPORT
    for (let step = 0; step < 40; step += 1) viewport = zoomAt(viewport, 0.5, { x: 100, y: 100 })
    expect(viewport.zoom).toBe(MIN_ZOOM)

    for (let step = 0; step < 40; step += 1) viewport = zoomAt(viewport, 2, { x: 100, y: 100 })
    expect(viewport.zoom).toBe(MAX_ZOOM)
  })

  it('refuses nonsense, and saturates rather than resetting', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(-4)).toBe(MIN_ZOOM)
    expect(clampZoom(Infinity)).toBe(MAX_ZOOM)
    expect(clampZoom(-Infinity)).toBe(MIN_ZOOM)
  })

  it('does nothing when already at the limit', () => {
    const at = { zoom: MAX_ZOOM, x: 3, y: 4 }
    expect(zoomAt(at, 2, { x: 0, y: 0 })).toBe(at)
  })

  it('sets an exact zoom about a point', () => {
    const anchor = { x: 400, y: 300 }
    const zoomed = zoomTo({ zoom: 1, x: 0, y: 0 }, 2.5, anchor)
    expect(zoomed.zoom).toBe(2.5)
    expect(toScreen(zoomed, toCanvas({ zoom: 1, x: 0, y: 0 }, anchor)).x).toBeCloseTo(anchor.x, 6)
  })

  it('steps between stops, and stays put at the ends', () => {
    expect(nextZoomStop(1, 1)).toBe(1.25)
    expect(nextZoomStop(1, -1)).toBe(0.75)
    expect(nextZoomStop(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(nextZoomStop(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
    // Off a stop, it lands on the next real one rather than nudging.
    expect(nextZoomStop(0.9, 1)).toBe(1)
    expect(ZOOM_STOPS[0]).toBe(MIN_ZOOM)
  })
})

describe('panning and framing', () => {
  it('moves the view without touching the zoom', () => {
    expect(pan({ zoom: 2, x: 10, y: 10 }, { x: -30, y: 5 })).toEqual({ zoom: 2, x: -20, y: 15 })
  })

  it('measures what there is to show', () => {
    expect(contentBounds([
      { x: 10, y: 10, width: 100, height: 40 },
      { x: 200, y: 300, width: 50, height: 50 },
    ])).toEqual({ x: 10, y: 10, width: 240, height: 340 })
    expect(contentBounds([])).toBeUndefined()
  })

  it('fits the content in view, centred', () => {
    const bounds = { x: 0, y: 0, width: 1600, height: 1200 }
    const viewport = fitTo(bounds, view)
    expect(viewport.zoom).toBeLessThan(1)

    const topLeft = toScreen(viewport, bounds)
    const bottomRight = toScreen(viewport, { x: bounds.width, y: bounds.height })
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(bottomRight.x).toBeLessThanOrEqual(view.width)
    // Centred: the margins match on both sides.
    expect(topLeft.x).toBeCloseTo(view.width - bottomRight.x, 6)
  })

  it('does not blow small content up to fill the screen', () => {
    expect(fitTo({ x: 0, y: 0, width: 100, height: 80 }, view).zoom).toBe(1)
  })

  it('has something sensible to do with nothing', () => {
    expect(fitTo(undefined, view)).toEqual(DEFAULT_VIEWPORT)
    expect(fitTo({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual(DEFAULT_VIEWPORT)
  })

  it('centres on a point, keeping the zoom', () => {
    const viewport = centreOn({ zoom: 2, x: 0, y: 0 }, { x: 500, y: 250 }, view)
    expect(viewport.zoom).toBe(2)
    expect(toScreen(viewport, { x: 500, y: 250 })).toEqual({ x: 400, y: 300 })
  })

  it('knows what is worth drawing', () => {
    const viewport = DEFAULT_VIEWPORT
    expect(isVisible(viewport, view, { x: 100, y: 100, width: 200, height: 60 })).toBe(true)
    expect(isVisible(viewport, view, { x: 5000, y: 0, width: 200, height: 60 })).toBe(false)
    // Just off-screen still counts: it is about to be scrolled into view.
    expect(isVisible(viewport, view, { x: 850, y: 0, width: 100, height: 60 })).toBe(true)
  })
})

describe('the tools', () => {
  it('names a tool for each single key', () => {
    expect(toolForKey('v')).toBe('pick')
    expect(toolForKey('H')).toBe('pan')
    expect(toolForKey('m')).toBe('marquee')
    expect(toolForKey('q')).toBeUndefined()
  })

  it('lets space and the middle button pan, whatever tool is active', () => {
    expect(effectiveTool('pick')).toBe('pick')
    expect(effectiveTool('marquee', { space: true })).toBe('pan')
    expect(effectiveTool('pick', { middleButton: true })).toBe('pan')
    expect(effectiveTool('pan')).toBe('pan')
  })

  it('shows the hand closing while the view is being dragged', () => {
    expect(cursorFor('pan')).toBe('grab')
    expect(cursorFor('pan', { panning: true })).toBe('grabbing')
    expect(cursorFor('marquee')).toBe('crosshair')
  })

  it('describes every tool it offers', () => {
    for (const tool of TOOLS) {
      expect(tool.label.length).toBeGreaterThan(2)
      expect(tool.hint.length).toBeGreaterThan(20)
      expect(tool.shortcut).toHaveLength(1)
    }
    expect(toolById('pan').id).toBe('pan')
    // An id that does not exist falls back rather than throwing.
    expect(toolById('nope' as never).id).toBe('pick')
  })
})
