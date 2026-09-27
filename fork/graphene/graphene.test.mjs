/**
 * Tests for the Graphene design layer.
 *
 * These guard the two generated artefacts that define how the Tungsten fork of
 * VS Code looks: the colour theme and the workbench stylesheet. Both are
 * derived from tokens.json, so the tests are mostly about invariants that must
 * hold no matter how the tokens are retuned — not about specific hex values,
 * which are allowed to change.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildGrapheneTheme, validateTheme } from './buildTheme.mjs'
import { buildWorkbenchCss, injectInto, validateCss, BEGIN_MARKER, END_MARKER } from './buildWorkbenchCss.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = JSON.parse(readFileSync(resolve(here, 'tokens.json'), 'utf8'))

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

describe('tokens', () => {
  it('defines every ramp, ink, accent and signal stop', () => {
    expect(Object.keys(tokens.ramp)).toEqual(expect.arrayContaining([
      'void', 'base', 'sidebar', 'chrome', 'raised', 'overlay', 'hover', 'selected', 'border', 'borderStrong',
    ]))
    expect(Object.keys(tokens.ink)).toEqual(expect.arrayContaining(['faint', 'muted', 'body', 'strong', 'inverse']))
    expect(Object.keys(tokens.accent)).toEqual(expect.arrayContaining(['base', 'bright', 'dim', 'border', 'wash']))
    expect(Object.keys(tokens.signal)).toEqual(expect.arrayContaining(['info', 'warning', 'danger', 'added', 'modified', 'deleted']))
  })

  it('states every colour as a valid hex literal', () => {
    for (const group of ['ramp', 'ink', 'accent', 'signal', 'syntax']) {
      for (const [key, value] of Object.entries(tokens[group])) {
        if (key === 'comment') continue // the prose annotation on each group
        expect(value, `${group}.${key}`).toMatch(HEX)
      }
    }
  })

  it('orders the neutral ramp from dark to light', () => {
    const luminance = (hex) => {
      const n = parseInt(hex.slice(1, 7), 16)
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
    }
    const steps = ['void', 'base', 'sidebar', 'chrome', 'raised', 'overlay', 'hover'].map((k) => tokens.ramp[k])
    for (let i = 1; i < steps.length; i += 1) {
      expect(luminance(steps[i]), `${steps[i]} must be lighter than ${steps[i - 1]}`)
        .toBeGreaterThan(luminance(steps[i - 1]))
    }
  })

  it('keeps body text legible against the editor surface', () => {
    // WCAG relative luminance, then the standard contrast ratio.
    const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const relative = (hex) => {
      const n = parseInt(hex.slice(1, 7), 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a, b) => {
      const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    // AA body text.
    expect(ratio(tokens.ink.body, tokens.ramp.base)).toBeGreaterThan(7)
    expect(ratio(tokens.ink.strong, tokens.ramp.base)).toBeGreaterThan(7)
    // The accent is an affordance, so it must also clear AA on the base surface.
    expect(ratio(tokens.accent.base, tokens.ramp.base)).toBeGreaterThan(4.5)
    // Inverse ink is what sits on the accent (badges, buttons).
    expect(ratio(tokens.ink.inverse, tokens.accent.base)).toBeGreaterThan(4.5)
    // Muted text is secondary, but must still be readable.
    expect(ratio(tokens.ink.muted, tokens.ramp.base)).toBeGreaterThan(3)
  })

  it('keeps syntax colours readable on the editor background', () => {
    const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const relative = (hex) => {
      const n = parseInt(hex.slice(1, 7), 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a, b) => {
      const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    for (const [key, value] of Object.entries(tokens.syntax)) {
      if (key === 'comment') continue
      // Comments and deprecated tokens are intentionally recessive.
      const floor = key === 'comment_' || key === 'deprecated' ? 2.5 : 4
      expect(ratio(value, tokens.ramp.base), `syntax.${key} (${value})`).toBeGreaterThan(floor)
    }
  })
})

describe('colour theme', () => {
  const theme = buildGrapheneTheme()

  it('passes its own validator', () => {
    expect(validateTheme(theme)).toEqual([])
  })

  it('declares itself a dark theme with semantic highlighting', () => {
    expect(theme.type).toBe('dark')
    expect(theme.name).toBe('Graphene Dark')
    expect(theme.semanticHighlighting).toBe(true)
  })

  it('covers the workbench, not just the editor', () => {
    // A theme that only styles the editor leaves the shell looking like
    // stock VS Code. Assert real coverage of every major part.
    const prefixes = [
      'editor', 'sideBar', 'activityBar', 'statusBar', 'titleBar', 'tab',
      'panel', 'terminal', 'list', 'input', 'button', 'badge', 'dropdown',
      'quickInput', 'notifications', 'scrollbarSlider', 'gitDecoration',
      'editorGutter', 'editorWidget', 'peekView', 'diffEditor', 'menu',
      'breadcrumb', 'minimap', 'editorBracketHighlight', 'debugToolBar',
    ]
    for (const prefix of prefixes) {
      const matches = Object.keys(theme.colors).filter((key) => key.startsWith(prefix))
      expect(matches.length, `no colours defined for "${prefix}"`).toBeGreaterThan(0)
    }
    expect(Object.keys(theme.colors).length).toBeGreaterThan(300)
  })

  it('states every colour as a valid hex literal', () => {
    for (const [key, value] of Object.entries(theme.colors)) {
      expect(value, key).toMatch(/^(#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent)$/)
    }
  })

  it('gives every TextMate rule a non-empty scope and a foreground', () => {
    expect(theme.tokenColors.length).toBeGreaterThan(20)
    for (const rule of theme.tokenColors) {
      const scope = Array.isArray(rule.scope) ? rule.scope : [rule.scope]
      expect(scope.length, `rule "${rule.name}" has no scope`).toBeGreaterThan(0)
      for (const entry of scope) expect(entry.trim()).not.toBe('')
      expect(rule.settings).toBeTruthy()
      expect(Object.keys(rule.settings).length).toBeGreaterThan(0)
    }
  })

  it('never assigns the same scope twice', () => {
    const seen = new Map()
    for (const rule of theme.tokenColors) {
      const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope]
      for (const scope of scopes) {
        expect(seen.has(scope), `scope "${scope}" is claimed by both "${seen.get(scope)}" and "${rule.name}"`).toBe(false)
        seen.set(scope, rule.name)
      }
    }
  })

  it('traces its colours back to the tokens', () => {
    expect(theme.colors['editor.background']).toBe(tokens.ramp.base)
    expect(theme.colors['sideBar.background']).toBe(tokens.ramp.sidebar)
    expect(theme.colors['focusBorder']).toBe(tokens.accent.base)
  })

  it('uses exactly one accent hue for primary affordances', () => {
    // The first Graphene principle is "one accent". Enforce it: the badge,
    // the primary button and the focus ring must all be the same colour.
    const accent = tokens.accent.base
    expect(theme.colors['focusBorder']).toBe(accent)
    expect(theme.colors['badge.background']).toBe(accent)
    expect(theme.colors['button.background']).toBe(accent)
    expect(theme.colors['progressBar.background']).toBe(accent)
    // …and the text on top of it must be the inverse ink, never white.
    expect(theme.colors['badge.foreground']).toBe(tokens.ink.inverse)
    expect(theme.colors['button.foreground']).toBe(tokens.ink.inverse)
  })

  it('keeps no trace of VS Code default blue', () => {
    // The stock palette's signature blues. If any survive, a surface was
    // missed and will look grafted on.
    const stock = ['#007acc', '#0078d4', '#0e639c', '#1f6feb', '#569cd6', '#264f78', '#04395e']
    const offenders = Object.entries(theme.colors)
      .filter(([, value]) => stock.includes(String(value).toLowerCase().slice(0, 7)))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('is deterministic', () => {
    expect(JSON.stringify(buildGrapheneTheme())).toBe(JSON.stringify(buildGrapheneTheme()))
  })
})

describe('workbench stylesheet', () => {
  const css = buildWorkbenchCss()

  it('passes its own validator', () => {
    expect(validateCss(css)).toEqual([])
  })

  it('is wrapped in matched sentinel markers', () => {
    expect(css.indexOf(BEGIN_MARKER)).toBe(0)
    expect(css.trimEnd().endsWith(END_MARKER)).toBe(true)
  })

  it('balances its braces', () => {
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length)
  })

  it('leaves no unresolved template values', () => {
    expect(css).not.toMatch(/undefined|NaN|\[object Object\]/)
  })

  it('scopes every rule to the workbench', () => {
    // A selector that escapes `.monaco-workbench` would leak Graphene into
    // webviews and the issue reporter, which upstream styles separately.
    const body = css.slice(BEGIN_MARKER.length, css.indexOf(END_MARKER))
    const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = withoutComments
      .split('}')
      .map((block) => block.split('{')[0].trim())
      .filter((selector) => selector && !selector.startsWith('@') && !selector.includes(':'))
      .flatMap((selector) => selector.split(',').map((part) => part.trim()))
      .filter(Boolean)

    expect(selectors.length).toBeGreaterThan(20)
    for (const selector of selectors) {
      expect(selector.includes('.monaco-workbench'), `unscoped selector: ${selector}`).toBe(true)
    }
  })

  it('redesigns structure, not just colour', () => {
    // The point of the stylesheet is the things a colour theme cannot do.
    for (const property of ['font-family', 'font-size', 'letter-spacing', 'border-radius', 'box-shadow', 'text-transform', 'height']) {
      expect(css, `stylesheet never sets ${property}`).toContain(`${property}:`)
    }
  })

  it('exposes the tokens as custom properties', () => {
    expect(css).toContain(`--graphene-accent: ${tokens.accent.base}`)
    expect(css).toContain(`--graphene-base: ${tokens.ramp.base}`)
    expect(css).toContain(`--graphene-mono: ${tokens.typography.mono}`)
  })

  it('respects prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)')
    // No animation or transition may be declared outside that guard.
    const guardStart = css.indexOf('@media (prefers-reduced-motion')
    const unguarded = css.slice(0, guardStart)
    expect(unguarded).not.toMatch(/^\s*(animation|transition):/m)
  })

  it('is deterministic', () => {
    expect(buildWorkbenchCss()).toBe(buildWorkbenchCss())
  })
})

describe('stylesheet injection', () => {
  const upstream = '.monaco-workbench { color: red; }\n'
  const css = buildWorkbenchCss()

  it('appends to a clean upstream file without deleting anything', () => {
    const result = injectInto(upstream, css)
    expect(result).toContain('.monaco-workbench { color: red; }')
    expect(result).toContain(BEGIN_MARKER)
    expect(result.indexOf('color: red')).toBeLessThan(result.indexOf(BEGIN_MARKER))
  })

  it('replaces an existing block rather than stacking copies', () => {
    const once = injectInto(upstream, css)
    const twice = injectInto(once, css)
    const thrice = injectInto(twice, css)
    expect(thrice.split(BEGIN_MARKER).length - 1).toBe(1)
    expect(thrice).toBe(once)
  })

  it('survives the tokens being retuned between runs', () => {
    const first = injectInto(upstream, css)
    const changed = css.replace(tokens.accent.base, '#ff00ff')
    const second = injectInto(first, changed)
    expect(second.split(BEGIN_MARKER).length - 1).toBe(1)
    expect(second).toContain('#ff00ff')
    expect(second).not.toContain(`--graphene-accent: ${tokens.accent.base}`)
    expect(second).toContain('color: red')
  })

  it('refuses a file with a begin marker but no end marker', () => {
    expect(() => injectInto(`${upstream}${BEGIN_MARKER}\n.x{}`, css)).toThrow(/no matching end marker/)
  })
})

describe('branding overlay', () => {
  const overlay = JSON.parse(readFileSync(resolve(here, '../branding/product.overlay.json'), 'utf8'))

  it('renames every user-visible product identifier', () => {
    expect(overlay.nameShort).toBe('Tungsten')
    expect(overlay.nameLong).toBe('Tungsten')
    expect(overlay.applicationName).toBe('tungsten')
    expect(overlay.dataFolderName).toBe('.tungsten')
    expect(overlay.urlProtocol).toBe('tungsten')
  })

  it('leaves no Microsoft or Visual Studio Code string behind', () => {
    const serialised = JSON.stringify(
      Object.fromEntries(Object.entries(overlay).filter(([key]) => !key.startsWith('_comment'))),
    )
    expect(serialised).not.toMatch(/Visual Studio Code/i)
    expect(serialised).not.toMatch(/microsoft/i)
    expect(serialised).not.toMatch(/vscode-unpkg|marketplace\.visualstudio/i)
  })

  it('disables telemetry and every reporting endpoint', () => {
    expect(overlay.enableTelemetry).toBe(false)
    // `null` is the overlay's "delete this key" sentinel.
    expect(overlay.aiConfig).toBeNull()
    expect(overlay.appCenter).toBeNull()
    expect(overlay.crashReporter).toBeNull()
    expect(overlay.surveys).toEqual([])
    expect(overlay.experimentsUrl).toBe('')
  })

  it('points the gallery at Open VSX', () => {
    expect(overlay.extensionsGallery.serviceUrl).toContain('open-vsx.org')
    expect(overlay.extensionsGallery.itemUrl).toContain('open-vsx.org')
  })

  it('seeds the splash screen from the Graphene ramp so first paint matches', () => {
    // VS Code paints initialColorTheme before the theme extension loads. If
    // these drift from the tokens the window flashes stock grey on launch.
    expect(overlay.initialColorTheme.colors['editor.background']).toBe(tokens.ramp.base)
    expect(overlay.initialColorTheme.colors['sideBar.background']).toBe(tokens.ramp.sidebar)
    expect(overlay.initialColorTheme.colors['activityBar.background']).toBe(tokens.ramp.chrome)
    expect(overlay.initialColorTheme.colors['statusBar.background']).toBe(tokens.ramp.chrome)
    expect(overlay.initialColorTheme.themeType).toBe('dark')
  })
})

describe('upstream pin', () => {
  const pin = JSON.parse(readFileSync(resolve(here, '../upstream.json'), 'utf8'))

  it('pins a full 40-character commit, never a moving ref', () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(pin.repository).toBe('https://github.com/microsoft/vscode.git')
  })

  it('records the expectations the fork verifier asserts against', () => {
    expect(pin.expect.editorBackground).toBe(tokens.ramp.base)
    expect(pin.expect.accent).toBe(tokens.accent.base)
  })
})
