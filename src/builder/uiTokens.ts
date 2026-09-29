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
      .empty { color: var(--app-muted); }`
}

/** The same palette for the mobile target, as Dart constants. */
export function uiThemeDart(theme: UiTheme = UI_THEME): string {
  const dartColour = (hex: string) => `Color(0xFF${hex.replace('#', '').slice(0, 6).toUpperCase()})`
  return [
    `  static const surface = ${dartColour(theme.surface)};`,
    `  static const text = ${dartColour(theme.text)};`,
    `  static const accent = ${dartColour(theme.accent)};`,
    `  static const accentInk = ${dartColour(theme.accentInk)};`,
    `  static const radius = ${theme.radius}.0;`,
  ].join('\n')
}
