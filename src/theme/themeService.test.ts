/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_ID,
  applyWorkbenchTheme,
  contrastRatio,
  getTheme,
  luminance,
  monacoThemeName,
  terminalTheme,
  themes,
  themesByKind,
  withAlpha,
} from './themeService'

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

describe('imported VS Code themes', () => {
  it('imports the expected set of official themes', () => {
    expect(themes.length).toBeGreaterThanOrEqual(10)
    for (const id of ['dark-modern', 'dark-plus', 'light-modern', 'light-plus', 'hc-black', 'hc-light', 'monokai', 'solarized-dark']) {
      expect(themes.some((theme) => theme.id === id), id).toBe(true)
    }
  })

  it('gives every theme a complete workbench palette of valid colours', () => {
    for (const theme of themes) {
      const entries = Object.entries(theme.workbench)
      expect(entries.length, theme.id).toBeGreaterThan(40)
      for (const [key, value] of entries) {
        expect(value, `${theme.id}.${key}`).toMatch(/^(#[0-9a-fA-F]{3,8}|transparent)$/)
      }
    }
  })

  it('gives every theme all 16 ANSI terminal colours', () => {
    const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
    for (const theme of themes) {
      const palette = terminalTheme(theme)
      for (const key of ansi) expect(palette[key], `${theme.id}.${key}`).toMatch(HEX)
      expect(palette.background, theme.id).toMatch(HEX)
      expect(palette.foreground, theme.id).toMatch(HEX)
      expect(palette.cursor, theme.id).toMatch(HEX)
    }
  })

  it('resolves theme inheritance, so Dark Modern has more colours than its parent', () => {
    const darkModern = getTheme('dark-modern')
    const darkPlus = getTheme('dark-plus')
    expect(Object.keys(darkModern.editor).length).toBeGreaterThan(Object.keys(darkPlus.editor).length)
    // dark_modern includes dark_plus, so it must inherit its token rules.
    expect(darkModern.rules.length).toBeGreaterThanOrEqual(darkPlus.rules.length)
  })

  it('carries TextMate token rules with Monaco-formatted colours', () => {
    for (const theme of themes) {
      expect(theme.rules.length, theme.id).toBeGreaterThan(20)
      for (const rule of theme.rules) {
        expect(typeof rule.token).toBe('string')
        if (rule.foreground) expect(rule.foreground, `${theme.id} ${rule.token}`).toMatch(/^[0-9A-F]{6}$/)
        if (rule.background) expect(rule.background).toMatch(/^[0-9A-F]{6}$/)
      }
    }
  })

  it('only hands Monaco colour keys it understands', () => {
    for (const theme of themes) {
      for (const [key, value] of Object.entries(theme.editor)) {
        expect(value, `${theme.id}.${key}`).toMatch(HEX)
        expect(key).not.toContain(' ')
      }
    }
  })

  it('maps each kind to the right Monaco base theme', () => {
    for (const theme of themes) {
      const expected = { dark: 'vs-dark', light: 'vs', 'hc-dark': 'hc-black', 'hc-light': 'hc-light' }[theme.kind]
      expect(theme.base, theme.id).toBe(expected)
    }
  })

  it('keeps editor text readable against the editor background', () => {
    for (const theme of themes) {
      const ratio = contrastRatio(theme.workbench.foreground, theme.workbench.background)
      // WCAG AA for body text is 4.5; every shipped VS Code theme clears 4.
      expect(ratio, `${theme.id} contrast ${ratio.toFixed(2)}`).toBeGreaterThan(4)
    }
  })

  it('orients light and dark themes correctly by luminance', () => {
    for (const theme of themes) {
      const background = luminance(theme.workbench.background)
      if (theme.kind === 'light' || theme.kind === 'hc-light') expect(background, theme.id).toBeGreaterThan(0.5)
      else expect(background, theme.id).toBeLessThan(0.25)
    }
  })
})

describe('theme lookup', () => {
  it('returns the requested theme', () => {
    expect(getTheme('monokai').label).toBe('Monokai')
  })

  it('falls back to the default for an unknown id', () => {
    expect(getTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID)
  })

  it('namespaces Monaco theme names to avoid clashing with built-ins', () => {
    expect(monacoThemeName(getTheme('dark-plus'))).toBe('tungsten-dark-plus')
  })

  it('groups themes for the picker', () => {
    const groups = themesByKind()
    expect(groups.dark.length).toBeGreaterThan(0)
    expect(groups.light.length).toBeGreaterThan(0)
    expect(groups.highContrast.length).toBeGreaterThan(0)
    expect(groups.dark.length + groups.light.length + groups.highContrast.length).toBe(themes.length)
  })
})

describe('colour helpers', () => {
  it('appends an alpha channel', () => {
    expect(withAlpha('#1F1F1F', 1)).toBe('#1f1f1fff')
    expect(withAlpha('#1F1F1F', 0)).toBe('#1f1f1f00')
    expect(withAlpha('#FFFFFF', 0.5)).toMatch(/^#ffffff(7f|80)$/)
  })

  it('computes luminance at the extremes', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('computes the WCAG contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('applyWorkbenchTheme', () => {
  it('writes every palette entry as a --tg-* custom property', () => {
    const root = document.createElement('div')
    const theme = getTheme('dark-modern')
    applyWorkbenchTheme(theme, root)

    expect(root.style.getPropertyValue('--tg-background')).toBe(theme.workbench.background)
    expect(root.style.getPropertyValue('--tg-activity-bar')).toBe(theme.workbench.activityBar)
    expect(root.style.getPropertyValue('--tg-status-bar-remote-foreground')).toBe(theme.workbench.statusBarRemoteForeground)
    expect(root.style.getPropertyValue('--tg-accent-soft')).toMatch(HEX)
    expect(root.dataset.themeKind).toBe('dark')
    expect(root.dataset.themeId).toBe('dark-modern')
  })

  it('switches colour-scheme and kind when moving to a light theme', () => {
    const root = document.createElement('div')
    applyWorkbenchTheme(getTheme('light-modern'), root)
    expect(root.dataset.themeKind).toBe('light')
    expect(root.style.getPropertyValue('color-scheme')).toBe('light')
  })

  it('fully repaints when switching themes, leaving no stale values', () => {
    const root = document.createElement('div')
    applyWorkbenchTheme(getTheme('dark-modern'), root)
    const before = root.style.getPropertyValue('--tg-background')
    applyWorkbenchTheme(getTheme('light-modern'), root)
    const after = root.style.getPropertyValue('--tg-background')
    expect(after).not.toBe(before)
    expect(after).toBe(getTheme('light-modern').workbench.background)
  })
})
