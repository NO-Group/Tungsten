/**
 * Graphene, for the apps the builder generates.
 *
 * `src/theme/tokens.json` is the single source of truth for how Tungsten
 * looks. Until now that stopped at the IDE's own chrome: the live preview and
 * the compiled web bundle carried their own copies of the same hex values,
 * which is exactly the kind of duplication tokens.json exists to prevent --
 * change the accent and generated apps would quietly keep the old one.
 *
 * So the UI blocks map onto these names, and every renderer (preview, web
 * target, mobile target) reads them from here. One accent, everywhere,
 * including in what users build.
 */

import tokens from '../theme/tokens.json'

/** The contract a renderer needs. Deliberately small. */
export type UiTheme = {
  surface: string
  surfaceRaised: string
  border: string
  text: string
  textMuted: string
  accent: string
  accentInk: string
  danger: string
  radius: number
  fontSans: string
  fontMono: string
  fontSize: number
}

export const UI_THEME: UiTheme = {
  surface: tokens.ramp.base,
  surfaceRaised: tokens.ramp.raised,
  border: tokens.ramp.border,
  text: tokens.ink.body,
  textMuted: tokens.ink.muted,
  accent: tokens.accent.base,
  accentInk: tokens.ink.inverse,
  danger: tokens.signal.danger,
  radius: tokens.geometry.radiusLarge,
  fontSans: tokens.typography.sans,
  fontMono: tokens.typography.mono,
  fontSize: tokens.typography.editorSize,
}

/** The custom properties a generated document declares. */
export function uiThemeVariables(theme: UiTheme = UI_THEME): string {
  return [
    `--app-surface: ${theme.surface};`,
    `--app-raised: ${theme.surfaceRaised};`,
    `--app-border: ${theme.border};`,
    `--app-text: ${theme.text};`,
    `--app-muted: ${theme.textMuted};`,
    `--app-accent: ${theme.accent};`,
    `--app-accent-ink: ${theme.accentInk};`,
    `--app-danger: ${theme.danger};`,
    `--app-radius: ${theme.radius}px;`,
    `--app-font: ${theme.fontSans};`,
    `--app-mono: ${theme.fontMono};`,
  ].join('\n        ')
}

/**
 * The stylesheet every generated UI starts from.
 *
 * Written in terms of the variables above rather than the values, so a
 * generated app can be re-themed by overriding `:root` and nothing else.
 */
export function uiThemeCss(theme: UiTheme = UI_THEME): string {
  return `:root {
        color-scheme: dark;
        ${uiThemeVariables(theme)}
      }
      body {
        margin: 0; padding: 18px;
        font: ${theme.fontSize}px/1.5 var(--app-font);
        color: var(--app-text); background: var(--app-surface);
      }
      #app { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
      button {
        padding: 6px 14px; font: inherit;
        color: var(--app-accent-ink); background: var(--app-accent);
        border: 0; border-radius: var(--app-radius); cursor: pointer;
      }
      button:active { transform: translateY(1px); }
      input {
        padding: 6px 9px; font: inherit;
        color: var(--app-text); background: var(--app-raised);
        border: 1px solid var(--app-border); border-radius: var(--app-radius);
        min-width: 200px;
      }
      p { margin: 0; }
      h1, h2, h3, h4, h5, h6 { margin: 0; line-height: 1.25; color: var(--app-text); }
      h1 { font-size: 2em; } h2 { font-size: 1.6em; } h3 { font-size: 1.3em; }
      h4, h5, h6 { font-size: 1.1em; }
      a { color: var(--app-accent); }
      hr {
        width: 100%; margin: 4px 0;
        border: 0; border-top: 1px solid var(--app-border);
      }
      img { max-width: 100%; border-radius: var(--app-radius); }
      select {
        padding: 6px 9px; font: inherit;
        color: var(--app-text); background: var(--app-raised);
        border: 1px solid var(--app-border); border-radius: var(--app-radius);
      }
      label.checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
      /* An image with no source yet: the box it will occupy, labelled. */
      .placeholder {
        display: flex; align-items: center; justify-content: center;
        min-width: 180px; min-height: 110px; padding: 12px;
        color: var(--app-muted); background: var(--app-raised);
        border: 1px dashed var(--app-border); border-radius: var(--app-radius);
      }
      .empty { color: var(--app-muted); }`
}

/**
 * `0xFFRRGGBB`, which is how both Dart and Kotlin spell a colour.
 *
 * Shared rather than written twice because the two targets were already
 * drifting apart on whether the digits were upper case.
 */
function argb(hex: string): string {
  return `0xFF${hex.replace('#', '').slice(0, 6).toUpperCase()}`
}

/** The same palette for the mobile target, as Dart constants. */
export function uiThemeDart(theme: UiTheme = UI_THEME): string {
  return [
    `  static const surface = Color(${argb(theme.surface)});`,
    `  static const raised = Color(${argb(theme.surfaceRaised)});`,
    `  static const border = Color(${argb(theme.border)});`,
    `  static const text = Color(${argb(theme.text)});`,
    `  static const textMuted = Color(${argb(theme.textMuted)});`,
    `  static const accent = Color(${argb(theme.accent)});`,
    `  static const accentInk = Color(${argb(theme.accentInk)});`,
    `  static const danger = Color(${argb(theme.danger)});`,
    `  static const radius = ${theme.radius}.0;`,
  ].join('\n')
}

/**
 * The same palette for the Android target, as the body of a Kotlin object.
 *
 * Compose takes an ARGB literal directly, so this is the Dart emitter with
 * different punctuation -- which is the argument for both of them living
 * here instead of inside their generators.
 */
export function uiThemeKotlin(theme: UiTheme = UI_THEME): string {
  return [
    `    val surface = Color(${argb(theme.surface)})`,
    `    val raised = Color(${argb(theme.surfaceRaised)})`,
    `    val border = Color(${argb(theme.border)})`,
    `    val text = Color(${argb(theme.text)})`,
    `    val textMuted = Color(${argb(theme.textMuted)})`,
    `    val accent = Color(${argb(theme.accent)})`,
    `    val accentInk = Color(${argb(theme.accentInk)})`,
    `    val danger = Color(${argb(theme.danger)})`,
    `    val radius = ${theme.radius}.dp`,
  ].join('\n')
}

/**
 * The same palette for the iOS target, as the body of a Swift enum.
 *
 * SwiftUI has no hex initialiser in the standard library, so the channels
 * are divided out here. Three decimal places is the point at which the
 * round trip back to 8-bit is exact for every value in the ramp.
 */
export function uiThemeSwift(theme: UiTheme = UI_THEME): string {
  const swiftColour = (hex: string) => {
    const value = hex.replace('#', '').slice(0, 6)
    const channel = (at: number) => (Number.parseInt(value.slice(at, at + 2), 16) / 255).toFixed(3)
    return `Color(red: ${channel(0)}, green: ${channel(2)}, blue: ${channel(4)})`
  }
  return [
    `    static let surface = ${swiftColour(theme.surface)}`,
    `    static let raised = ${swiftColour(theme.surfaceRaised)}`,
    `    static let border = ${swiftColour(theme.border)}`,
    `    static let text = ${swiftColour(theme.text)}`,
    `    static let textMuted = ${swiftColour(theme.textMuted)}`,
    `    static let accent = ${swiftColour(theme.accent)}`,
    `    static let accentInk = ${swiftColour(theme.accentInk)}`,
    `    static let danger = ${swiftColour(theme.danger)}`,
    `    static let radius: CGFloat = ${theme.radius}`,
  ].join('\n')
}
