import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAYOUT,
  MAX_SIDEBAR_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  activityBarClick,
  clampPanelHeight,
  clampSidebarWidth,
  parseWorkbenchLayout,
  serializeWorkbenchLayout,
} from './workbenchLayout'

describe('clampSidebarWidth', () => {
  it('keeps a reasonable width', () => {
    expect(clampSidebarWidth(300)).toBe(300)
  })

  it('refuses to collapse or swallow the editor', () => {
    expect(clampSidebarWidth(20)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(4000)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('falls back when handed nonsense', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_LAYOUT.sidebarWidth)
  })
})

describe('clampPanelHeight', () => {
  it('leaves the editor at least a third of the window', () => {
    expect(clampPanelHeight(5000, 1000)).toBe(650)
  })

  it('keeps the terminal tall enough to use', () => {
    expect(clampPanelHeight(10, 1000)).toBe(MIN_PANEL_HEIGHT)
  })

  it('never returns a height below the minimum, even in a tiny window', () => {
    expect(clampPanelHeight(400, 100)).toBe(MIN_PANEL_HEIGHT)
  })
})

describe('parseWorkbenchLayout', () => {
  it('restores what was stored', () => {
    const stored = { sidebarVisible: false, sidebarWidth: 320, panelOpen: false, panelHeight: 300 }
    expect(parseWorkbenchLayout(JSON.stringify(stored), 1000)).toEqual(stored)
  })

  it('falls back to defaults for missing fields', () => {
    expect(parseWorkbenchLayout('{"sidebarWidth":300}', 1000))
      .toEqual({ ...DEFAULT_LAYOUT, sidebarWidth: 300 })
  })

  it('survives a corrupt entry', () => {
    for (const raw of [null, '', 'not json', '[]', 'null', '"text"']) {
      expect(parseWorkbenchLayout(raw, 1000), raw ?? 'null').toEqual(DEFAULT_LAYOUT)
    }
  })

  it('clamps a layout saved on a bigger screen', () => {
    // 900px of panel is fine on a 1440px display and absurd on a 700px one.
    const stored = JSON.stringify({ ...DEFAULT_LAYOUT, panelHeight: 900, sidebarWidth: 900 })
    const layout = parseWorkbenchLayout(stored, 700)
    expect(layout.panelHeight).toBe(455)
    expect(layout.sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('ignores fields of the wrong type instead of trusting them', () => {
    const layout = parseWorkbenchLayout('{"sidebarVisible":"yes","panelHeight":"tall"}', 1000)
    expect(layout).toEqual(DEFAULT_LAYOUT)
  })

  it('round-trips through serialize', () => {
    const layout = { sidebarVisible: false, sidebarWidth: 210, panelOpen: true, panelHeight: 240 }
    expect(parseWorkbenchLayout(serializeWorkbenchLayout(layout), 1000)).toEqual(layout)
  })
})

describe('activityBarClick', () => {
  it('switches to another view and shows the side bar', () => {
    expect(activityBarClick('explorer', 'search', false)).toEqual({ activity: 'search', sidebarVisible: true })
  })

  it('collapses the side bar when the active view is clicked again', () => {
    expect(activityBarClick('search', 'search', true)).toEqual({ activity: 'search', sidebarVisible: false })
  })

  it('reopens the side bar on a second click of the active view', () => {
    expect(activityBarClick('search', 'search', false)).toEqual({ activity: 'search', sidebarVisible: true })
  })
})
