/**
 * Tests for Graphene, Tungsten's design language and default theme.
 *
 * These assert invariants rather than specific hex values, so the tokens stay
 * free to be retuned. What must never change is that the palette is legible,
 * internally consistent, and actually reaches every surface.
 */

import { describe, expect, it } from 'vitest'

import tokens from './tokens.json'
import { grapheneTheme } from './graphene.generated'
import { DEFAULT_THEME_ID, getTheme, themes, contrastRatio } from './themeService'

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

describe('graphene tokens', () => {
  it('defines every ramp, ink, accent and signal stop', () => {
    expect(Object.keys(tokens.ramp)).toEqual(expect.arrayContaining([
      'void', 'base', 'sidebar', 'chrome', 'raised', 'overlay', 'hover', 'selected', 'border', 'borderStrong',
    ]))
    expect(Object.keys(tokens.ink)).toEqual(expect.arrayContaining(['faint', 'muted', 'body', 'strong', 'inverse']))
    expect(Object.keys(tokens.accent)).toEqual(expect.arrayContaining(['base', 'bright', 'dim', 'border', 'wash']))
    expect(Object.keys(tokens.signal)).toEqual(expect.arrayContaining(['info', 'warning', 'danger', 'added', 'modified', 'deleted']))
  })

  it('states every colour as a valid hex literal', () => {
    for (const group of ['ramp', 'ink', 'accent', 'signal', 'syntax'] as const) {
      for (const [key, value] of Object.entries(tokens[group] as Record<string, string>)) {
        if (key === 'comment') continue // the prose annotation on each group
        expect(value, `${group}.${key}`).toMatch(HEX)
      }
    }
  })

  it('orders the neutral ramp from dark to light', () => {
    const perceived = (hex: string) => {
      const n = parseInt(hex.slice(1, 7), 16)
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
    }
    const steps = (['void', 'base', 'sidebar', 'chrome', 'raised', 'overlay', 'hover'] as const)
      .map((key) => tokens.ramp[key])
    for (let i = 1; i < steps.length; i += 1) {
      expect(perceived(steps[i]), `${steps[i]} must be lighter than ${steps[i - 1]}`)
        .toBeGreaterThan(perceived(steps[i - 1]))
    }
  })

  it('keeps body text and affordances legible on the editor surface', () => {
    // Reuses the theme service's own WCAG implementation rather than a
    // second copy, so the test cannot drift from what the app computes.
    expect(contrastRatio(tokens.ink.body, tokens.ramp.base)).toBeGreaterThan(7)
    expect(contrastRatio(tokens.ink.strong, tokens.ramp.base)).toBeGreaterThan(7)
    expect(contrastRatio(tokens.accent.base, tokens.ramp.base)).toBeGreaterThan(4.5)
    expect(contrastRatio(tokens.ink.inverse, tokens.accent.base)).toBeGreaterThan(4.5)
    expect(contrastRatio(tokens.ink.muted, tokens.ramp.base)).toBeGreaterThan(3)
  })

  it('keeps syntax colours readable on the editor background', () => {
    for (const [key, value] of Object.entries(tokens.syntax as Record<string, string>)) {
      if (key === 'comment') continue
      // Comments and deprecated tokens are deliberately recessive.
      const floor = key === 'comment_' || key === 'deprecated' ? 2.5 : 4
      expect(contrastRatio(value, tokens.ramp.base), `syntax.${key} (${value})`).toBeGreaterThan(floor)
    }
  })
})

describe('graphene theme', () => {
  it('is the default the product ships with', () => {
    expect(DEFAULT_THEME_ID).toBe('graphene-dark')
    expect(getTheme(DEFAULT_THEME_ID)).toBe(grapheneTheme)
    // First in the list, so the theme picker opens on it.
    expect(themes[0]).toBe(grapheneTheme)
  })

  it('fills in every key the workbench palette declares', () => {
    // A missing key means an unset --tg-* property and a surface that silently
    // falls back to a stale literal.
    for (const [key, value] of Object.entries(grapheneTheme.workbench)) {
      expect(typeof value, `workbench.${key}`).toBe('string')
      expect(value, `workbench.${key}`).toMatch(HEX)
    }
    expect(Object.keys(grapheneTheme.workbench).length).toBeGreaterThan(50)
  })

  it('matches the shape of the imported VS Code themes exactly', () => {
    // Graphene has to be interchangeable with any imported theme, or the
    // picker would produce half-painted windows.
    const reference = themes.find((theme) => theme.id === 'dark-modern')!
    expect(Object.keys(grapheneTheme.workbench).sort()).toEqual(Object.keys(reference.workbench).sort())
    expect(Object.keys(grapheneTheme.terminal).sort()).toEqual(Object.keys(reference.terminal).sort())
  })

  it('formats Monaco rule colours the way Monaco demands', () => {
    // defineTheme throws on a leading '#'. This is the one place the theme
    // deviates from normal hex, and it is easy to regress.
    for (const rule of grapheneTheme.rules) {
      if (rule.foreground) expect(rule.foreground, rule.token).toMatch(/^[0-9A-F]{6}$/)
      if (rule.background) expect(rule.background, rule.token).toMatch(/^[0-9A-F]{6}$/)
    }
  })

  it('uses hash-prefixed colours everywhere Monaco expects them', () => {
    for (const [key, value] of Object.entries(grapheneTheme.editor)) {
      expect(value, key).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
    }
  })

  it('traces its colours back to the tokens', () => {
    expect(grapheneTheme.workbench.background).toBe(tokens.ramp.base)
    expect(grapheneTheme.workbench.sidebar).toBe(tokens.ramp.sidebar)
    expect(grapheneTheme.workbench.accent).toBe(tokens.accent.base)
    expect(grapheneTheme.editor['editor.background']).toBe(tokens.ramp.base)
    expect(grapheneTheme.terminal.cursor).toBe(tokens.accent.base)
  })

  it('uses exactly one accent hue for primary affordances', () => {
    // The first Graphene principle is "one accent". Enforce it.
    const accent = tokens.accent.base
    expect(grapheneTheme.workbench.focusBorder).toBe(accent)
    expect(grapheneTheme.workbench.badge).toBe(accent)
    expect(grapheneTheme.workbench.button).toBe(accent)
    expect(grapheneTheme.workbench.activityBarForeground).toBe(accent)
    expect(grapheneTheme.workbench.tabActiveBorderTop).toBe(accent)
    // …and the ink on top of it is the inverse, never white.
    expect(grapheneTheme.workbench.badgeForeground).toBe(tokens.ink.inverse)
    expect(grapheneTheme.workbench.buttonForeground).toBe(tokens.ink.inverse)
  })

  it('keeps no trace of VS Code default blue', () => {
    // The stock palette's signature blues. If any survive, a surface was
    // missed and will look grafted on.
    const stock = ['#007acc', '#0078d4', '#0e639c', '#1f6feb', '#569cd6', '#264f78', '#04395e']
    const surfaces = { ...grapheneTheme.workbench, ...grapheneTheme.editor } as Record<string, string>
    const offenders = Object.entries(surfaces)
      .filter(([, value]) => stock.includes(String(value).toLowerCase().slice(0, 7)))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('declares a terminal palette with all sixteen ANSI colours', () => {
    const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const
    for (const name of ansi) {
      expect(grapheneTheme.terminal[name], name).toMatch(HEX)
      const bright = `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof typeof grapheneTheme.terminal
      expect(grapheneTheme.terminal[bright], String(bright)).toMatch(HEX)
    }
  })

  it('gives every Monaco rule a distinct token scope', () => {
    const scopes = grapheneTheme.rules.map((rule) => rule.token)
    expect(new Set(scopes).size).toBe(scopes.length)
  })
})
