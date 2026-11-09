/**
 * The palette, as five languages see it.
 *
 * These tests exist because the mobile targets each used to carry their own
 * hex-to-colour conversion, and two of them had already drifted apart on
 * letter case. The value of a shared token file is only real if changing
 * `tokens.json` moves every target at once, so that is what is asserted
 * here: not the literals, but the agreement between them.
 */

import { describe, expect, it } from 'vitest'

import tokens from '../theme/tokens.json'
import {
  UI_THEME,
  uiThemeCss,
  uiThemeDart,
  uiThemeKotlin,
  uiThemeSwift,
  uiThemeVariables,
  type UiTheme,
} from './uiTokens'

/** A palette that shares nothing with Graphene, to prove nothing is hard-coded. */
const other: UiTheme = {
  surface: '#201020',
  surfaceRaised: '#2a152a',
  border: '#3c1f3c',
  text: '#f4e8f4',
  textMuted: '#a07ea0',
  accent: '#ff7755',
  accentInk: '#1a0a06',
  danger: '#ff0000',
  radius: 11,
  fontSans: 'Comic Sans MS',
  fontMono: 'Courier',
  fontSize: 19,
}

describe('the generated palette', () => {
  it('comes from tokens.json rather than a copy of it', () => {
    expect(UI_THEME.accent).toBe(tokens.accent.base)
    expect(UI_THEME.surface).toBe(tokens.ramp.base)
    expect(UI_THEME.text).toBe(tokens.ink.body)
  })

  it('declares the web variables it promises', () => {
    const css = uiThemeVariables()
    expect(css).toContain(`--app-accent: ${tokens.accent.base};`)
    expect(css).toContain(`--app-surface: ${tokens.ramp.base};`)
  })

  it('writes a stylesheet in terms of the variables, never the values', () => {
    const css = uiThemeCss()
    const body = css.slice(css.indexOf('}'))
    expect(body).not.toContain(tokens.accent.base)
    expect(body).toContain('var(--app-accent)')
  })
})

describe('the mobile emitters', () => {
  it('spells Dart and Kotlin colours the same way', () => {
    expect(uiThemeDart()).toContain('Color(0xFFC8F169)')
    expect(uiThemeKotlin()).toContain('Color(0xFFC8F169)')
  })

  it('gives Kotlin a Compose-shaped object body', () => {
    const kotlin = uiThemeKotlin()
    expect(kotlin).toContain(`    val accent = Color(0xFFC8F169)`)
    expect(kotlin).toContain(`    val radius = ${UI_THEME.radius}.dp`)
    for (const line of kotlin.split('\n')) expect(line).toMatch(/^ {4}val /)
  })

  it('gives Swift channels a Color initialiser can take', () => {
    const swift = uiThemeSwift()
    expect(swift).toContain('static let accent = Color(red: 0.784, green: 0.945, blue: 0.412)')
    expect(swift).toContain(`static let radius: CGFloat = ${UI_THEME.radius}`)
    for (const line of swift.split('\n')) expect(line).toMatch(/^ {4}static let /)
  })

  it('rounds Swift channels finely enough to survive the trip back to 8-bit', () => {
    // Three decimals is not arbitrary: consecutive 8-bit channels are
    // 1/255 apart, so an error under half a thousandth cannot reach the
    // neighbouring value.
    const swift = uiThemeSwift()
    const channels = [...swift.matchAll(/0\.\d+|1\.000/g)].map((hit) => Number(hit[0]))
    expect(channels.length).toBeGreaterThan(10)
    for (const channel of channels) {
      const eightBit = Math.round(channel * 255)
      expect(Math.abs(eightBit / 255 - channel)).toBeLessThan(0.002)
    }
  })

  it('moves every language when the palette moves', () => {
    expect(uiThemeDart(other)).toContain('Color(0xFFFF7755)')
    expect(uiThemeKotlin(other)).toContain('Color(0xFFFF7755)')
    expect(uiThemeSwift(other)).toContain('Color(red: 1.000, green: 0.467, blue: 0.333)')
    expect(uiThemeVariables(other)).toContain('--app-accent: #ff7755;')
    expect(uiThemeKotlin(other)).toContain('val radius = 11.dp')

    for (const emitted of [uiThemeDart(other), uiThemeKotlin(other), uiThemeSwift(other)]) {
      expect(emitted).not.toContain('C8F169')
      expect(emitted).not.toContain('0.784')
    }
  })

  it('exposes the same names to Kotlin and Swift', () => {
    const names = (source: string, pattern: RegExp) =>
      source.split('\n').map((line) => line.match(pattern)?.[1])
    expect(names(uiThemeKotlin(), /val (\w+)/)).toEqual(names(uiThemeSwift(), /static let (\w+)/))
  })
})
