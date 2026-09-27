#!/usr/bin/env node
/**
 * Builds the Graphene theme from the design tokens.
 *
 * `src/theme/tokens.json` is the single source of truth for Tungsten's visual
 * identity. This script derives both places that identity is consumed:
 *
 *   1. src/theme/graphene.generated.ts  — a TungstenTheme the runtime theme
 *      service applies to the workbench, Monaco and xterm.
 *   2. the :root block in src/styles.css — the fallback values used for the
 *      first paint, before JavaScript has applied a theme.
 *
 * Deriving both from one file is the whole point: previously the palette
 * existed as ~50 hand-written hex literals in styles.css and again as a
 * separate generator, and the two were free to drift. Now they cannot.
 *
 * Usage:
 *   node scripts/build-graphene.mjs           # write both outputs
 *   node scripts/build-graphene.mjs --check   # verify outputs are up to date
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tokens = JSON.parse(readFileSync(resolve(root, 'src/theme/tokens.json'), 'utf8'))

const { ramp, ink, accent, signal, syntax } = tokens

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
const parse = (hex) => {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const rgb = (r, g, b) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`

/** Blend `top` over `bottom` at `amount` (0 = bottom, 1 = top). */
function mix(bottom, top, amount) {
  const [r1, g1, b1] = parse(bottom)
  const [r2, g2, b2] = parse(top)
  return rgb(r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount)
}

/** Append an alpha channel to a 6-digit hex. */
function alpha(hex, amount) {
  return `${hex.slice(0, 7)}${clamp(amount * 255).toString(16).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 * The theme
 * ------------------------------------------------------------------ */

const selection = alpha(accent.base, 0.22)
const lineHighlight = mix(ramp.base, ink.body, 0.04)

/** Matches the WorkbenchPalette type in src/theme/types.ts. */
const workbench = {
  background: ramp.base,
  foreground: ink.body,
  border: ramp.border,
  chrome: ramp.chrome,
  chromeForeground: ink.muted,
  activityBar: ramp.chrome,
  activityBarForeground: accent.base,
  activityBarInactive: ink.faint,
  activityBarBorder: ramp.border,
  badge: accent.base,
  badgeForeground: ink.inverse,
  sidebar: ramp.sidebar,
  sidebarForeground: ink.body,
  sidebarTitle: ink.muted,
  sectionHeader: ramp.sidebar,
  statusBar: ramp.chrome,
  statusBarForeground: ink.muted,
  statusBarRemote: accent.base,
  statusBarRemoteForeground: ink.inverse,
  tabActive: ramp.base,
  tabActiveForeground: ink.strong,
  tabInactive: ramp.chrome,
  tabInactiveForeground: ink.muted,
  tabBorder: ramp.border,
  tabActiveBorderTop: accent.base,
  panel: ramp.base,
  panelBorder: ramp.border,
  listHover: ramp.hover,
  listActive: ramp.selected,
  listActiveForeground: ink.strong,
  listInactive: ramp.overlay,
  input: mix(ramp.base, ramp.void, 0.4),
  inputForeground: ink.body,
  inputBorder: ramp.border,
  button: accent.base,
  buttonForeground: ink.inverse,
  buttonHover: accent.bright,
  widget: ramp.raised,
  widgetBorder: ramp.borderStrong,
  widgetShadow: '#000000cc',
  focusBorder: accent.base,
  accent: accent.base,
  muted: ink.muted,
  error: signal.danger,
  warning: signal.warning,
  info: signal.info,
  success: signal.added,
  added: signal.added,
  modified: signal.modified,
  deleted: signal.deleted,
  terminalBackground: ramp.base,
  terminalForeground: ink.body,
  scrollbar: alpha(ramp.borderStrong, 0.5),
  scrollbarHover: alpha(ink.faint, 0.8),
  selection,
  menuBackground: ramp.raised,
  menuForeground: ink.body,
  menuSelection: ramp.selected,
}

/** xterm.js ITheme. The ANSI ramp is tuned to Graphene rather than borrowed. */
const terminal = {
  background: ramp.base,
  foreground: ink.body,
  cursor: accent.base,
  selectionBackground: selection,
  black: ramp.overlay,
  red: signal.danger,
  green: signal.added,
  yellow: signal.warning,
  blue: signal.info,
  magenta: '#b48add',
  cyan: syntax.function,
  white: ink.body,
  brightBlack: ink.faint,
  brightRed: mix(signal.danger, ink.strong, 0.25),
  brightGreen: accent.base,
  brightYellow: mix(signal.warning, ink.strong, 0.25),
  brightBlue: mix(signal.info, ink.strong, 0.25),
  brightMagenta: '#c9a6e8',
  brightCyan: mix(syntax.function, ink.strong, 0.25),
  brightWhite: ink.strong,
}

/** Monaco editor colours. */
const editor = {
  'editor.background': ramp.base,
  'editor.foreground': ink.body,
  'editorLineNumber.foreground': ink.faint,
  'editorLineNumber.activeForeground': accent.base,
  'editorCursor.foreground': accent.base,
  'editor.selectionBackground': selection,
  'editor.inactiveSelectionBackground': alpha(accent.base, 0.1),
  'editor.selectionHighlightBackground': alpha(accent.base, 0.14),
  'editor.wordHighlightBackground': alpha(accent.base, 0.12),
  'editor.wordHighlightStrongBackground': alpha(accent.base, 0.18),
  'editor.findMatchBackground': alpha(accent.base, 0.32),
  'editor.findMatchHighlightBackground': alpha(accent.base, 0.16),
  'editor.lineHighlightBackground': lineHighlight,
  'editor.lineHighlightBorder': '#00000000',
  'editorIndentGuide.background1': ramp.border,
  'editorIndentGuide.activeBackground1': accent.dim,
  'editorWhitespace.foreground': ramp.borderStrong,
  'editorRuler.foreground': ramp.border,
  'editorBracketMatch.background': alpha(accent.base, 0.16),
  'editorBracketMatch.border': accent.border,
  'editorGutter.background': ramp.base,
  'editorGutter.addedBackground': signal.added,
  'editorGutter.modifiedBackground': signal.modified,
  'editorGutter.deletedBackground': signal.deleted,
  'editorError.foreground': signal.danger,
  'editorWarning.foreground': signal.warning,
  'editorInfo.foreground': signal.info,
  'editorHoverWidget.background': ramp.raised,
  'editorHoverWidget.border': ramp.borderStrong,
  'editorSuggestWidget.background': ramp.raised,
  'editorSuggestWidget.border': ramp.borderStrong,
  'editorSuggestWidget.foreground': ink.body,
  'editorSuggestWidget.selectedBackground': ramp.selected,
  'editorSuggestWidget.highlightForeground': accent.base,
  'editorWidget.background': ramp.raised,
  'editorWidget.border': ramp.borderStrong,
  'minimap.background': ramp.base,
  'minimap.findMatchHighlight': accent.base,
  'scrollbarSlider.background': alpha(ramp.borderStrong, 0.5),
  'scrollbarSlider.hoverBackground': alpha(ink.faint, 0.7),
  'scrollbarSlider.activeBackground': alpha(ink.faint, 0.9),
  'editorOverviewRuler.border': '#00000000',
  'editorOverviewRuler.errorForeground': signal.danger,
  'editorOverviewRuler.warningForeground': signal.warning,
  'editorOverviewRuler.modifiedForeground': signal.modified,
  'editorOverviewRuler.addedForeground': signal.added,
  'editorOverviewRuler.deletedForeground': signal.deleted,
  'diffEditor.insertedTextBackground': alpha(signal.added, 0.14),
  'diffEditor.removedTextBackground': alpha(signal.deleted, 0.14),
  'editorLink.activeForeground': accent.base,
  'editorCodeLens.foreground': ink.faint,
}

/**
 * Monaco requires rule colours as bare uppercase hex with no leading `#` --
 * `defineTheme` throws on anything else. The workbench and editor palettes use
 * the normal `#rrggbb` form, so this is the one place the two diverge.
 */
const mono = (hex) => hex.replace('#', '').slice(0, 6).toUpperCase()

/**
 * Monaco TextMate rules. `token` strings are Monarch/TextMate scopes; Monaco
 * resolves the longest matching prefix, so order is not significant.
 */
const rules = [
  { token: '', foreground: mono(ink.body) },
  { token: 'comment', foreground: mono(syntax.comment_), fontStyle: 'italic' },
  { token: 'comment.doc', foreground: mono(mix(syntax.comment_, ink.body, 0.2)), fontStyle: 'italic' },
  { token: 'keyword', foreground: mono(syntax.keyword) },
  { token: 'keyword.control', foreground: mono(syntax.keyword) },
  { token: 'keyword.operator', foreground: mono(syntax.operator) },
  { token: 'storage', foreground: mono(syntax.storage) },
  { token: 'storage.type', foreground: mono(syntax.storage) },
  { token: 'string', foreground: mono(syntax.string) },
  { token: 'string.escape', foreground: mono(syntax.escape) },
  { token: 'regexp', foreground: mono(syntax.regexp) },
  { token: 'number', foreground: mono(syntax.number) },
  { token: 'constant', foreground: mono(syntax.constant) },
  { token: 'constant.language', foreground: mono(syntax.constant) },
  { token: 'variable', foreground: mono(syntax.variable) },
  { token: 'variable.parameter', foreground: mono(syntax.parameter) },
  { token: 'variable.predefined', foreground: mono(syntax.constant) },
  { token: 'identifier', foreground: mono(syntax.variable) },
  { token: 'entity.name.function', foreground: mono(syntax.function) },
  { token: 'support.function', foreground: mono(syntax.function) },
  { token: 'entity.name.type', foreground: mono(syntax.type) },
  { token: 'entity.name.class', foreground: mono(syntax.class) },
  { token: 'support.type', foreground: mono(syntax.type) },
  { token: 'support.class', foreground: mono(syntax.class) },
  { token: 'type', foreground: mono(syntax.type) },
  { token: 'type.identifier', foreground: mono(syntax.type) },
  { token: 'attribute.name', foreground: mono(syntax.attribute) },
  { token: 'attribute.value', foreground: mono(syntax.string) },
  { token: 'tag', foreground: mono(syntax.tag) },
  { token: 'metatag', foreground: mono(syntax.tag) },
  { token: 'delimiter', foreground: mono(syntax.punctuation) },
  { token: 'delimiter.bracket', foreground: mono(syntax.punctuation) },
  { token: 'operator', foreground: mono(syntax.operator) },
  { token: 'namespace', foreground: mono(syntax.type) },
  { token: 'key', foreground: mono(syntax.property) },
  { token: 'string.key', foreground: mono(syntax.property) },
  { token: 'string.value', foreground: mono(syntax.string) },
  { token: 'invalid', foreground: mono(syntax.invalid) },
  { token: 'predefined', foreground: mono(syntax.constant) },
  { token: 'annotation', foreground: mono(syntax.attribute) },
]

const theme = {
  id: 'graphene-dark',
  label: 'Graphene Dark',
  kind: 'dark',
  base: 'vs-dark',
  workbench,
  terminal,
  editor,
  rules,
  semanticHighlighting: true,
}

/* ------------------------------------------------------------------ *
 * Output 1 — the runtime theme module
 * ------------------------------------------------------------------ */

function renderThemeModule() {
  return `// Generated by scripts/build-graphene.mjs from src/theme/tokens.json.
// Do not edit by hand: re-run \`npm run graphene\` to refresh.
//
// Graphene is Tungsten's own design language and its default appearance. The
// imported VS Code themes in vscode-themes.generated.ts sit alongside it as
// alternatives; this is the one the product ships as.

import type { TungstenTheme } from './types'

export const grapheneTheme: TungstenTheme = ${JSON.stringify(theme, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : line))
    .join('\n')}
`
}

/* ------------------------------------------------------------------ *
 * Output 2 — the stylesheet fallback block
 * ------------------------------------------------------------------ */

const CSS_BEGIN = '  /* >>> GRAPHENE TOKENS — generated by scripts/build-graphene.mjs. Do not edit. <<< */'
const CSS_END = '  /* >>> GRAPHENE TOKENS END <<< */'

/**
 * The `--tg-*` properties are written at runtime by the theme service. These
 * `var(--tg-…, fallback)` defaults are what paints the very first frame, so
 * they must equal the Graphene values exactly or the window flashes.
 */
function renderCssBlock() {
  const lines = [
    ['--mono', tokens.typography.mono],
    ['--sans', tokens.typography.sans],
    null,
    ['--bg', `var(--tg-background, ${ramp.base})`],
    ['--chrome', `var(--tg-chrome, ${ramp.chrome})`],
    ['--chrome-raised', `var(--tg-widget, ${ramp.raised})`],
    ['--sidebar', `var(--tg-sidebar, ${ramp.sidebar})`],
    ['--panel', `var(--tg-panel, ${ramp.base})`],
    ['--border', `var(--tg-border, ${ramp.border})`],
    ['--border-bright', `var(--tg-widget-border, ${ramp.borderStrong})`],
    ['--text', `var(--tg-foreground, ${ink.body})`],
    ['--text-strong', `var(--tg-tab-active-foreground, ${ink.strong})`],
    ['--muted', `var(--tg-muted, ${ink.muted})`],
    ['--faint', `var(--tg-activity-bar-inactive, ${ink.faint})`],
    ['--accent', `var(--tg-accent, ${accent.base})`],
    ['--accent-soft', `var(--tg-accent-soft, ${accent.wash})`],
    ['--cyan', `var(--tg-info, ${signal.info})`],
    ['--warning', `var(--tg-warning, ${signal.warning})`],
    ['--danger', `var(--tg-error, ${signal.danger})`],
    null,
    ['--list-hover', `var(--tg-list-hover, ${ramp.hover})`],
    ['--list-active', `var(--tg-list-active, ${ramp.selected})`],
    ['--list-active-fg', `var(--tg-list-active-foreground, ${ink.strong})`],
    ['--badge-bg', 'var(--tg-badge, var(--accent))'],
    ['--badge-fg', `var(--tg-badge-foreground, ${ink.inverse})`],
    ['--button-bg', 'var(--tg-button, var(--accent))'],
    ['--button-fg', `var(--tg-button-foreground, ${ink.inverse})`],
    ['--button-hover', `var(--tg-button-hover, ${accent.bright})`],
    ['--input-bg', `var(--tg-input, ${workbench.input})`],
    ['--input-fg', 'var(--tg-input-foreground, var(--text))'],
    ['--input-border', 'var(--tg-input-border, var(--border))'],
    ['--focus-border', 'var(--tg-focus-border, var(--accent))'],
    ['--widget-bg', `var(--tg-widget, ${ramp.raised})`],
    ['--widget-shadow', 'var(--tg-shadow, #000c)'],
    ['--overlay-bg', 'var(--tg-overlay, #000c)'],
    ['--status-bg', 'var(--tg-status-bar, var(--chrome))'],
    ['--status-fg', 'var(--tg-status-bar-foreground, var(--muted))'],
    ['--tab-active-bg', 'var(--tg-tab-active, var(--bg))'],
    ['--tab-inactive-bg', 'var(--tg-tab-inactive, var(--chrome))'],
    ['--tab-active-border', 'var(--tg-tab-active-border-top, var(--accent))'],
    ['--menu-bg', 'var(--tg-menu-background, var(--widget-bg))'],
    ['--menu-fg', 'var(--tg-menu-foreground, var(--text))'],
    ['--menu-selection', 'var(--tg-menu-selection, var(--accent-soft))'],
    ['--git-added', `var(--tg-added, ${signal.added})`],
    ['--git-modified', `var(--tg-modified, ${signal.modified})`],
    ['--git-deleted', `var(--tg-deleted, ${signal.deleted})`],
    null,
    ['--radius', `${tokens.geometry.radius}px`],
    ['--radius-lg', `${tokens.geometry.radiusLarge}px`],
    ['--row-height', `${tokens.geometry.rowHeight}px`],
    ['--tab-height', `${tokens.geometry.tabHeight}px`],
    ['--status-height', `${tokens.geometry.statusBarHeight}px`],
    ['--activity-width', `${tokens.geometry.activityBarWidth}px`],
    ['--ui-size', `${tokens.typography.uiSize}px`],
    ['--dense-size', `${tokens.typography.denseSize}px`],
    ['--micro-size', `${tokens.typography.microSize}px`],
  ]

  const body = lines
    .map((entry) => (entry === null ? '' : `  ${entry[0]}: ${entry[1]};`))
    .join('\n')

  return `${CSS_BEGIN}\n${body}\n${CSS_END}`
}

/** Idempotently splice the generated block into styles.css. */
function injectCss(source, block) {
  const begin = source.indexOf(CSS_BEGIN)
  if (begin === -1) {
    // First run: insert right after the `:root {` opener.
    const opener = source.indexOf(':root {')
    if (opener === -1) throw new Error('could not find a `:root {` block in styles.css')
    const insertAt = source.indexOf('\n', opener) + 1
    return `${source.slice(0, insertAt)}${block}\n${source.slice(insertAt)}`
  }
  const end = source.indexOf(CSS_END, begin)
  if (end === -1) throw new Error('found a GRAPHENE TOKENS begin marker with no matching end marker')
  return `${source.slice(0, begin)}${block}${source.slice(end + CSS_END.length)}`
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const themePath = resolve(root, 'src/theme/graphene.generated.ts')
const cssPath = resolve(root, 'src/styles.css')

const nextTheme = renderThemeModule()
const nextCss = injectCss(readFileSync(cssPath, 'utf8'), renderCssBlock())

if (process.argv.includes('--check')) {
  const stale = []
  if (readFileSync(themePath, 'utf8') !== nextTheme) stale.push('src/theme/graphene.generated.ts')
  if (readFileSync(cssPath, 'utf8') !== nextCss) stale.push('src/styles.css')
  if (stale.length > 0) {
    console.error(`stale, re-run \`npm run graphene\`:\n${stale.map((f) => `  ${f}`).join('\n')}`)
    process.exit(1)
  }
  console.log('graphene outputs are up to date')
} else {
  writeFileSync(themePath, nextTheme)
  writeFileSync(cssPath, nextCss)
  console.log('built Graphene from src/theme/tokens.json')
  console.log(`  src/theme/graphene.generated.ts  ${Object.keys(workbench).length} workbench, ${Object.keys(editor).length} editor, ${rules.length} rules`)
  console.log(`  src/styles.css                   :root block regenerated`)
}
