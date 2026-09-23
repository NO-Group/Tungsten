import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTheme, luminance, themes } from './themeService'

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

/**
 * The workbench chrome is painted from a neutral ramp built with
 * `color-mix()` against the active theme's background/foreground. These tests
 * pin the two properties that make the ramp correct: it must be defined purely
 * in terms of theme colours, and it must invert when a light theme is active.
 */

const rgb = (hex: string) => {
  let h = hex.replace('#', '').slice(0, 6)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/** Mirrors `color-mix(in srgb, a p%, b)` closely enough to assert ordering. */
const mix = (a: string, p: number, b: string) => {
  const A = rgb(a)
  const B = rgb(b)
  return `#${A.map((v, i) => Math.round(v * p + B[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`
}

describe('neutral ramp', () => {
  it('leaves no un-themed opaque colours in the stylesheet body', () => {
    const body = css.slice(css.indexOf('}', css.indexOf(':root {')))
    const literals = body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    // Only translucent overlays (4- and 8-digit hex with an alpha channel) may
    // remain hard-coded; everything opaque must flow from a theme variable.
    const opaque = literals.filter((hex) => hex.length !== 5 && hex.length !== 9)
    expect(opaque).toEqual([])
  })

  it('defines every ramp tier from theme colours rather than fixed greys', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    for (const tier of ['--bg-deep', '--surface-raised', '--border-subtle', '--border-strong',
      '--border-brighter', '--faint-bright', '--muted-dim', '--muted-bright', '--text-dim',
      '--text-soft', '--text-bright']) {
      const line = root.split('\n').find((l) => l.trim().startsWith(`${tier}:`))
      expect(line, tier).toBeDefined()
      expect(line, tier).toContain('color-mix')
      expect(line, tier).toMatch(/var\(--(bg|text|faint|muted|text-strong)\)/)
    }
  })

  it('keeps surfaces dark and text light under a dark theme', () => {
    const { workbench } = getTheme('dark-modern')
    const surface = luminance(mix(workbench.background, 0.88, workbench.foreground))
    const text = luminance(workbench.foreground)
    expect(surface).toBeLessThan(0.2)
    expect(text).toBeGreaterThan(surface)
  })

  it('inverts so surfaces are light and text is dark under a light theme', () => {
    const { workbench } = getTheme('light-modern')
    const surface = luminance(mix(workbench.background, 0.88, workbench.foreground))
    const text = luminance(workbench.foreground)
    expect(surface).toBeGreaterThan(0.6)
    expect(text).toBeLessThan(surface)
  })

  it('always keeps raised surfaces distinguishable from the base background', () => {
    for (const theme of themes) {
      const { background, foreground } = theme.workbench
      const raised = mix(background, 0.88, foreground)
      expect(raised.toLowerCase(), theme.id).not.toBe(background.toLowerCase())
    }
  })

  it('orders the ramp monotonically away from the background for every theme', () => {
    for (const theme of themes) {
      const { background, foreground } = theme.workbench
      const base = luminance(background)
      // Successively stronger mixes must move steadily toward the foreground.
      const steps = [0.9, 0.84, 0.78].map((p) => Math.abs(luminance(mix(background, p, foreground)) - base))
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i], `${theme.id} step ${i}`).toBeGreaterThanOrEqual(steps[i - 1])
      }
    }
  })

  it('defines the monospace stack that the chrome relies on', () => {
    // `var(--mono)` is consumed in many rules; if it is undefined those
    // elements silently fall back to the browser default font.
    expect(css).toMatch(/--mono:\s*'JetBrains Mono'/)
  })
})
