#!/usr/bin/env node
// Imports the official VS Code default colour themes into Tungsten.
//
// VS Code ships its themes as JSONC files that inherit from one another through
// an "include" key. This script resolves those chains, merges the colour maps and
// TextMate token rules, and emits a single typed module the workbench can consume
// without shipping the whole vscode repository.
//
//   node scripts/import-vscode-themes.mjs --source /path/to/vscode
//
// The generated file is committed so that building Tungsten never requires a
// vscode checkout.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const argv = process.argv.slice(2)
const readFlag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

const SOURCE = path.resolve(readFlag('source', '/tmp/vscode'))
const OUTPUT = path.resolve(readFlag('out', 'src/theme/vscode-themes.generated.ts'))

/** Themes we import, in the order they should appear in the theme picker. */
const THEMES = [
  { id: 'dark-modern', label: 'Dark Modern', kind: 'dark', file: 'extensions/theme-defaults/themes/dark_modern.json' },
  { id: 'dark-plus', label: 'Dark+', kind: 'dark', file: 'extensions/theme-defaults/themes/dark_plus.json' },
  { id: 'dark-vs', label: 'Dark (Visual Studio)', kind: 'dark', file: 'extensions/theme-defaults/themes/dark_vs.json' },
  { id: 'light-modern', label: 'Light Modern', kind: 'light', file: 'extensions/theme-defaults/themes/light_modern.json' },
  { id: 'light-plus', label: 'Light+', kind: 'light', file: 'extensions/theme-defaults/themes/light_plus.json' },
  { id: 'light-vs', label: 'Light (Visual Studio)', kind: 'light', file: 'extensions/theme-defaults/themes/light_vs.json' },
  { id: 'hc-black', label: 'High Contrast Dark', kind: 'hc-dark', file: 'extensions/theme-defaults/themes/hc_black.json' },
  { id: 'hc-light', label: 'High Contrast Light', kind: 'hc-light', file: 'extensions/theme-defaults/themes/hc_light.json' },
  { id: 'monokai', label: 'Monokai', kind: 'dark', file: 'extensions/theme-monokai/themes/monokai-color-theme.json' },
  { id: 'solarized-dark', label: 'Solarized Dark', kind: 'dark', file: 'extensions/theme-solarized-dark/themes/solarized-dark-color-theme.json' },
]

/**
 * VS Code theme files are JSONC: they allow `//` comments, trailing commas and
 * raw control characters inside strings. Parse them without pulling a dependency.
 */
function parseJsonc(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      if (escaped) { out += char; escaped = false; continue }
      if (char === '\\') { out += char; escaped = true; continue }
      if (char === '"') { inString = false; out += char; continue }
      // Escape raw control characters that strict JSON rejects.
      const code = char.charCodeAt(0)
      out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : char
      continue
    }
    if (char === '"') { inString = true; out += char; continue }
    if (char === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue }
    if (char === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; continue }
    out += char
  }
  // Remove trailing commas before a closing brace or bracket.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** Resolve a theme and every theme it includes into one flat definition. */
async function resolveTheme(absoluteFile, seen = new Set()) {
  if (seen.has(absoluteFile)) throw new Error(`Circular theme include at ${absoluteFile}`)
  seen.add(absoluteFile)

  const definition = parseJsonc(await readFile(absoluteFile, 'utf8'))
  let colors = {}
  let tokenColors = []
  let semanticTokenColors = {}
  let semanticHighlighting = false

  if (definition.include) {
    const parent = await resolveTheme(path.resolve(path.dirname(absoluteFile), definition.include), seen)
    colors = { ...parent.colors }
    tokenColors = [...parent.tokenColors]
    semanticTokenColors = { ...parent.semanticTokenColors }
    semanticHighlighting = parent.semanticHighlighting
  }

  return {
    colors: { ...colors, ...(definition.colors || {}) },
    tokenColors: [...tokenColors, ...(Array.isArray(definition.tokenColors) ? definition.tokenColors : [])],
    semanticTokenColors: { ...semanticTokenColors, ...(definition.semanticTokenColors || {}) },
    semanticHighlighting: definition.semanticHighlighting ?? semanticHighlighting,
  }
}

/** Monaco wants `RRGGBB` with no leading `#` for token rules. */
function monacoToken(color) {
  if (typeof color !== 'string') return undefined
  const hex = color.replace('#', '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) return undefined
  if (hex.length === 3) return hex.split('').map((c) => c + c).join('').toUpperCase()
  if (hex.length === 4) return hex.slice(0, 3).split('').map((c) => c + c).join('').toUpperCase()
  return hex.slice(0, 6).toUpperCase()
}

/** Flatten TextMate scope rules into the flat list Monaco's tokenizer expects. */
function toMonacoRules(tokenColors) {
  const rules = []
  for (const entry of tokenColors) {
    const settings = entry?.settings
    if (!settings) continue
    const scopes = typeof entry.scope === 'string'
      ? entry.scope.split(',').map((scope) => scope.trim()).filter(Boolean)
      : Array.isArray(entry.scope) ? entry.scope : ['']
    for (const scope of scopes) {
      const rule = { token: scope }
      const foreground = monacoToken(settings.foreground)
      const background = monacoToken(settings.background)
      if (foreground) rule.foreground = foreground
      if (background) rule.background = background
      if (settings.fontStyle) rule.fontStyle = settings.fontStyle
      if (rule.foreground || rule.background || rule.fontStyle) rules.push(rule)
    }
  }
  return rules
}

/**
 * Monaco validates every colour it is handed. VS Code themes contain workbench
 * keys Monaco does not know about, so keep only editor-relevant keys and make
 * sure each value is a well-formed hex colour.
 */
function toMonacoColors(colors) {
  const result = {}
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== 'string') continue
    if (!/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) continue
    // Monaco only understands editor/diff/list/scrollbar/minimap style keys.
    if (!/^(editor|diffEditor|minimap|scrollbar|peekView|widget|input|list|menu|quickInput|dropdown|badge|button|focusBorder|foreground|errorForeground|descriptionForeground|icon|textLink|breadcrumb|problems|symbolIcon|charts|selection|sash|toolbar|inputOption|inputValidation|keybindingLabel)/.test(key)) continue
    result[key] = value.length === 4 || value.length === 5
      ? `#${value.slice(1).split('').map((c) => c + c).join('')}`
      : value
  }
  return result
}

/**
 * Pick the workbench colours Tungsten's CSS custom properties are wired to.
 * Falls back through VS Code's own colour-inheritance conventions so that even
 * sparse themes (Monokai, Solarized) produce a complete workbench.
 */
function workbenchPalette(colors, kind) {
  const dark = kind === 'dark' || kind === 'hc-dark'
  const pick = (...keys) => {
    for (const key of keys) {
      const value = colors[key]
      if (typeof value === 'string' && value.startsWith('#')) return value
    }
    return undefined
  }
  const fallback = (value, alternative) => value ?? alternative

  const background = fallback(pick('editor.background'), dark ? '#1e1e1e' : '#ffffff')
  const foreground = fallback(pick('foreground', 'editor.foreground'), dark ? '#cccccc' : '#333333')
  const border = fallback(pick('panel.border', 'editorGroup.border', 'contrastBorder'), dark ? '#2b2b2b' : '#e5e5e5')

  return {
    background,
    foreground,
    border,
    chrome: fallback(pick('titleBar.activeBackground', 'editorGroupHeader.tabsBackground'), background),
    chromeForeground: fallback(pick('titleBar.activeForeground'), foreground),
    activityBar: fallback(pick('activityBar.background'), background),
    activityBarForeground: fallback(pick('activityBar.foreground'), foreground),
    activityBarInactive: fallback(pick('activityBar.inactiveForeground'), dark ? '#868686' : '#616161'),
    activityBarBorder: fallback(pick('activityBar.activeBorder', 'focusBorder'), foreground),
    badge: fallback(pick('activityBarBadge.background', 'badge.background'), '#0078d4'),
    badgeForeground: fallback(pick('activityBarBadge.foreground', 'badge.foreground'), '#ffffff'),
    sidebar: fallback(pick('sideBar.background'), background),
    sidebarForeground: fallback(pick('sideBar.foreground'), foreground),
    sidebarTitle: fallback(pick('sideBarTitle.foreground'), foreground),
    sectionHeader: fallback(pick('sideBarSectionHeader.background'), 'transparent'),
    statusBar: fallback(pick('statusBar.background'), dark ? '#181818' : '#f8f8f8'),
    statusBarForeground: fallback(pick('statusBar.foreground'), foreground),
    statusBarRemote: fallback(pick('statusBarItem.remoteBackground'), '#0078d4'),
    statusBarRemoteForeground: fallback(pick('statusBarItem.remoteForeground'), '#ffffff'),
    tabActive: fallback(pick('tab.activeBackground'), background),
    tabActiveForeground: fallback(pick('tab.activeForeground'), foreground),
    tabInactive: fallback(pick('tab.inactiveBackground'), dark ? '#181818' : '#f8f8f8'),
    tabInactiveForeground: fallback(pick('tab.inactiveForeground'), dark ? '#9d9d9d' : '#333333'),
    tabBorder: fallback(pick('tab.border'), border),
    tabActiveBorderTop: fallback(pick('tab.activeBorderTop', 'tab.activeBorder'), 'transparent'),
    panel: fallback(pick('panel.background'), background),
    panelBorder: fallback(pick('panel.border'), border),
    listHover: fallback(pick('list.hoverBackground'), dark ? '#2a2d2e' : '#e8e8e8'),
    listActive: fallback(pick('list.activeSelectionBackground'), dark ? '#04395e' : '#0060c0'),
    listActiveForeground: fallback(pick('list.activeSelectionForeground'), '#ffffff'),
    listInactive: fallback(pick('list.inactiveSelectionBackground'), dark ? '#37373d' : '#e4e6f1'),
    input: fallback(pick('input.background'), dark ? '#313131' : '#ffffff'),
    inputForeground: fallback(pick('input.foreground'), foreground),
    inputBorder: fallback(pick('input.border', 'contrastBorder'), border),
    button: fallback(pick('button.background'), '#0078d4'),
    buttonForeground: fallback(pick('button.foreground'), '#ffffff'),
    buttonHover: fallback(pick('button.hoverBackground'), '#026ec1'),
    widget: fallback(pick('editorWidget.background', 'quickInput.background'), dark ? '#202020' : '#f3f3f3'),
    widgetBorder: fallback(pick('editorWidget.border', 'contrastBorder'), border),
    widgetShadow: fallback(pick('widget.shadow'), dark ? '#0000005c' : '#00000029'),
    focusBorder: fallback(pick('focusBorder'), '#0078d4'),
    accent: fallback(pick('focusBorder', 'button.background'), '#0078d4'),
    muted: fallback(pick('descriptionForeground'), dark ? '#9d9d9d' : '#717171'),
    error: fallback(pick('errorForeground', 'editorError.foreground'), '#f85149'),
    warning: fallback(pick('editorWarning.foreground', 'list.warningForeground'), '#cca700'),
    info: fallback(pick('editorInfo.foreground'), '#3794ff'),
    success: fallback(pick('gitDecoration.addedResourceForeground', 'editorGutter.addedBackground'), '#2ea043'),
    added: fallback(pick('editorGutter.addedBackground', 'gitDecoration.addedResourceForeground'), '#2ea043'),
    modified: fallback(pick('editorGutter.modifiedBackground', 'gitDecoration.modifiedResourceForeground'), '#0078d4'),
    deleted: fallback(pick('editorGutter.deletedBackground', 'gitDecoration.deletedResourceForeground'), '#f85149'),
    terminalBackground: fallback(pick('terminal.background', 'panel.background'), background),
    terminalForeground: fallback(pick('terminal.foreground'), foreground),
    scrollbar: fallback(pick('scrollbarSlider.background'), dark ? '#79797966' : '#64646466'),
    scrollbarHover: fallback(pick('scrollbarSlider.hoverBackground'), dark ? '#646464b3' : '#646464b3'),
    selection: fallback(pick('editor.selectionBackground'), dark ? '#264f78' : '#add6ff'),
    menuBackground: fallback(pick('menu.background', 'dropdown.background'), dark ? '#1f1f1f' : '#ffffff'),
    menuForeground: fallback(pick('menu.foreground', 'dropdown.foreground'), foreground),
    menuSelection: fallback(pick('menu.selectionBackground'), '#0078d4'),
  }
}

/** The 16 ANSI colours xterm.js needs, plus cursor and selection. */
function terminalPalette(colors, kind) {
  const dark = kind === 'dark' || kind === 'hc-dark'
  const defaults = dark
    ? ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
       '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5']
    : ['#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555',
       '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5']
  const names = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
                 'BrightBlack', 'BrightRed', 'BrightGreen', 'BrightYellow', 'BrightBlue', 'BrightMagenta', 'BrightCyan', 'BrightWhite']
  const ansi = {}
  names.forEach((name, index) => {
    const key = `terminal.ansi${name}`
    const value = colors[key]
    ansi[name[0].toLowerCase() + name.slice(1)] = typeof value === 'string' ? value : defaults[index]
  })
  return {
    ...ansi,
    background: colors['terminal.background'] || colors['panel.background'] || colors['editor.background'] || (dark ? '#1e1e1e' : '#ffffff'),
    foreground: colors['terminal.foreground'] || colors['editor.foreground'] || (dark ? '#cccccc' : '#333333'),
    cursor: colors['terminalCursor.foreground'] || colors['editorCursor.foreground'] || (dark ? '#ffffff' : '#000000'),
    selectionBackground: colors['terminal.selectionBackground'] || colors['editor.selectionBackground'] || (dark ? '#264f78' : '#add6ff'),
  }
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`vscode source not found at ${SOURCE}.`)
    console.error('Clone it first:  git clone --depth 1 https://github.com/microsoft/vscode.git /tmp/vscode')
    process.exit(1)
  }

  const imported = []
  for (const theme of THEMES) {
    const absolute = path.join(SOURCE, theme.file)
    if (!existsSync(absolute)) {
      console.warn(`skip ${theme.id}: ${theme.file} not present`)
      continue
    }
    const resolved = await resolveTheme(absolute)
    imported.push({
      id: theme.id,
      label: theme.label,
      kind: theme.kind,
      base: theme.kind === 'light' ? 'vs' : theme.kind === 'hc-light' ? 'hc-light' : theme.kind === 'hc-dark' ? 'hc-black' : 'vs-dark',
      workbench: workbenchPalette(resolved.colors, theme.kind),
      terminal: terminalPalette(resolved.colors, theme.kind),
      editor: toMonacoColors(resolved.colors),
      rules: toMonacoRules(resolved.tokenColors),
      semanticHighlighting: Boolean(resolved.semanticHighlighting),
    })
    console.log(`imported ${theme.label.padEnd(24)} ${Object.keys(resolved.colors).length} colours, ${resolved.tokenColors.length} token rules`)
  }

  const revision = process.env.VSCODE_REVISION || 'microsoft/vscode@main'
  const banner = `// Generated by scripts/import-vscode-themes.mjs from ${revision}.
// Do not edit by hand: re-run \`npm run themes:import\` to refresh.
`
  const body = `${banner}
import type { TungstenTheme } from './types'

export const vscodeThemes: TungstenTheme[] = ${JSON.stringify(imported, null, 2)}

export default vscodeThemes
`
  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, body, 'utf8')
  const kb = Math.round(Buffer.byteLength(body) / 1024)
  console.log(`\nwrote ${path.relative(process.cwd(), OUTPUT)} — ${imported.length} themes, ${kb} kB`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
