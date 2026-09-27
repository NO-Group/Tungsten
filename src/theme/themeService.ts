/**
 * Runtime theme service.
 *
 * Applies a `TungstenTheme` to three surfaces at once:
 *   1. the workbench, via CSS custom properties on the document root
 *   2. Monaco, via `editor.defineTheme` + `setTheme`
 *   3. xterm.js, via the terminal palette exposed through `currentTerminalTheme()`
 *
 * Graphene is Tungsten's own design language and ships as the default. It is
 * generated from `src/theme/tokens.json` by `npm run graphene`, which is the
 * single source of truth for the product's visual identity.
 *
 * The remaining themes are imported from the real VS Code repository (see
 * `scripts/import-vscode-themes.mjs`), so their colours match upstream exactly.
 * They sit alongside Graphene as alternatives, never ahead of it.
 */

import { grapheneTheme } from './graphene.generated'
import { vscodeThemes } from './vscode-themes.generated'
import type { TerminalPalette, TungstenTheme, WorkbenchPalette } from './types'

export type { TungstenTheme, ThemeKind, TerminalPalette, WorkbenchPalette } from './types'

/** Graphene first: it is what the product looks like, and what the picker opens on. */
export const themes: TungstenTheme[] = [grapheneTheme, ...vscodeThemes]
export const DEFAULT_THEME_ID = 'graphene-dark'
const THEME_STORAGE_KEY = 'tungsten.theme.v1'

/** camelCase palette key -> `--tg-kebab-case` custom property. */
function cssVariableName(key: string) {
  return `--tg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export function getTheme(id: string): TungstenTheme {
  return themes.find((theme) => theme.id === id) || themes.find((theme) => theme.id === DEFAULT_THEME_ID) || themes[0]
}

export function loadThemeId(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored && themes.some((theme) => theme.id === stored)) return stored
  } catch {
    // Storage can be unavailable in locked-down embedders; fall through.
  }
  return DEFAULT_THEME_ID
}

export function saveThemeId(id: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Persisting the theme is best-effort.
  }
}

/**
 * Derive a translucent variant of a colour. Used for hover states and badges so
 * that a single imported palette can drive a full workbench.
 */
export function withAlpha(color: string, alpha: number) {
  const hex = color.replace('#', '')
  if (hex.length < 6) return color
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
  // Normalise to lower case so generated values are consistent regardless of
  // how the upstream theme happened to spell its colours.
  return `#${hex.slice(0, 6)}${value}`.toLowerCase()
}

/** Relative luminance per WCAG 2.1, used to pick readable foregrounds. */
export function luminance(color: string) {
  const hex = color.replace('#', '')
  if (hex.length < 6) return 0
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** WCAG contrast ratio between two colours (1 = identical, 21 = black on white). */
export function contrastRatio(foreground: string, background: string) {
  const a = luminance(foreground)
  const b = luminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Write the workbench palette to the document root as CSS custom properties.
 * Also sets `data-theme-kind` so stylesheets can branch on light/dark/high-contrast.
 */
export function applyWorkbenchTheme(theme: TungstenTheme, root: HTMLElement = document.documentElement) {
  const palette = theme.workbench as unknown as Record<keyof WorkbenchPalette, string>
  for (const [key, value] of Object.entries(palette)) {
    if (typeof value === 'string') root.style.setProperty(cssVariableName(key), value)
  }

  // Derived tokens the stylesheet relies on but no VS Code theme defines directly.
  root.style.setProperty('--tg-accent-soft', withAlpha(theme.workbench.accent, 0.16))
  root.style.setProperty('--tg-hover', withAlpha(theme.workbench.foreground, 0.08))
  root.style.setProperty('--tg-overlay', theme.kind === 'light' || theme.kind === 'hc-light' ? '#00000040' : '#000000a6')
  root.style.setProperty('--tg-shadow', theme.workbench.widgetShadow)
  root.style.setProperty('color-scheme', theme.kind === 'light' || theme.kind === 'hc-light' ? 'light' : 'dark')
  root.dataset.themeKind = theme.kind
  root.dataset.themeId = theme.id
}

/**
 * Register the theme with Monaco and activate it. Monaco rejects malformed colour
 * values outright, so the generated data is already filtered to valid hex strings.
 */
export function applyMonacoTheme(monaco: typeof import('monaco-editor'), theme: TungstenTheme) {
  const name = `tungsten-${theme.id}`
  monaco.editor.defineTheme(name, {
    base: theme.base,
    inherit: true,
    rules: theme.rules as { token: string; foreground?: string; background?: string; fontStyle?: string }[],
    colors: theme.editor,
  })
  monaco.editor.setTheme(name)
  return name
}

export function monacoThemeName(theme: TungstenTheme) {
  return `tungsten-${theme.id}`
}

/** xterm.js `ITheme`-compatible object for the active theme. */
export function terminalTheme(theme: TungstenTheme): TerminalPalette {
  return theme.terminal
}

/** Group themes for the picker exactly the way VS Code's theme quick-pick does. */
export function themesByKind() {
  return {
    dark: themes.filter((theme) => theme.kind === 'dark'),
    light: themes.filter((theme) => theme.kind === 'light'),
    highContrast: themes.filter((theme) => theme.kind === 'hc-dark' || theme.kind === 'hc-light'),
  }
}
