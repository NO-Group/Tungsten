/**
 * What the quick-open palette shows.
 *
 * One input box serves four pickers -- commands, files, symbols and go-to-line
 * -- chosen by a prefix, exactly as VS Code does. Deciding which picker is
 * active and which rows it contains is pure, so every rule here (what is
 * hidden by a `when` clause, how ties are broken, what an empty query shows)
 * is directly testable.
 */

import type { File } from 'lucide-react'

import { prepareQuery, scoreItem, type Match } from './fuzzyScorer'
import { parseWhenClause, type Context } from '../keybinding/contextkey'
import { fileName } from '../workspace'

export type PaletteMode = 'commands' | 'files' | 'symbols' | 'line'

export type PaletteItem = {
  id: string
  label: string
  detail: string
  icon: typeof File
  action: () => void | Promise<void>
  labelMatch: Match[]
  detailMatch: Match[]
  keybinding?: string
}

export type PaletteCommand = {
  id: string
  label: string
  detail: string
  icon: typeof File
  when?: string
  action: () => void | Promise<void>
}

export type PaletteFile = { path: string; content: string; language: string }

export type PaletteSymbol = { label: string; line: number }

/** Rows past this are unreachable in practice; the cap keeps typing smooth. */
const MAX_FILTERED = 300
const MAX_UNFILTERED = 200

/**
 * Splits the raw input into a picker and its query.
 *
 * `>` commands, `@` or `#` symbols, `:` a line number. With no prefix the
 * picker is whatever the palette was opened as.
 */
export function parsePaletteQuery(raw: string, fallback: PaletteMode): { mode: PaletteMode; search: string } {
  if (raw.startsWith('>')) return { mode: 'commands', search: raw.slice(1) }
  if (raw.startsWith('@') || raw.startsWith('#')) return { mode: 'symbols', search: raw.slice(1) }
  if (raw.startsWith(':')) return { mode: 'line', search: raw.slice(1) }
  return { mode: fallback, search: raw }
}

export type PaletteSources = {
  commands: PaletteCommand[]
  files: PaletteFile[]
  /** Open editors, oldest first; used to order files before anything is typed. */
  openTabs: string[]
  symbols: PaletteSymbol[]
  activeFile?: { path: string; content: string }
  whenContext: Context
  shortcutFor: (commandId: string) => string
  /** Commands bring their own icon; the other pickers get these. */
  icons: { file: typeof File; symbol: typeof File; line: typeof File }
  actions: {
    openFile: (path: string) => void
    revealLine: (line: number) => void
    gotoLine: (line: number) => void
  }
}

/** Go to line: one row, which is either the destination or an explanation. */
function lineItems(search: string, sources: PaletteSources): PaletteItem[] {
  const { activeFile, icons, actions } = sources
  const maxLine = activeFile ? activeFile.content.split('\n').length : 0
  const line = Number.parseInt(search, 10)
  if (!Number.isFinite(line) || line < 1) {
    return [{
      id: 'goto.line.hint',
      label: 'Go to line',
      detail: `Type a line number between 1 and ${maxLine || 1}`,
      icon: icons.line,
      action: () => undefined,
      labelMatch: [],
      detailMatch: [],
    }]
  }
  // Past the end of the file means the end of the file, not nothing.
  const target = Math.min(Math.max(1, line), Math.max(1, maxLine))
  return [{
    id: `goto.line.${target}`,
    label: `Go to line ${target}`,
    detail: activeFile ? fileName(activeFile.path) : '',
    icon: icons.line,
    action: () => actions.gotoLine(target),
    labelMatch: [],
    detailMatch: [],
  }]
}

function symbolItems(search: string, sources: PaletteSources): PaletteItem[] {
  const { symbols, activeFile, icons, actions } = sources
  const detail = activeFile ? fileName(activeFile.path) : ''
  const entries = symbols.map((symbol, index) => ({
    id: `symbol.${index}.${symbol.label}`,
    label: symbol.label,
    detail,
    icon: icons.symbol,
    action: () => actions.revealLine(symbol.line),
  }))
  const query = prepareQuery(search)
  if (!query.normalized) return entries.map((entry) => ({ ...entry, labelMatch: [], detailMatch: [] }))
  return entries
    .map((entry) => ({ entry, score: scoreItem(entry.label, entry.detail, query) }))
    .filter(({ score }) => score.score > 0)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, MAX_FILTERED)
    .map(({ entry, score }) => ({ ...entry, labelMatch: score.labelMatch, detailMatch: score.descriptionMatch }))
}

function fileItems(search: string, sources: PaletteSources): PaletteItem[] {
  const { files, openTabs, icons, actions } = sources
  // Generated diffs are not files anyone wants to open from here.
  const candidates = files.filter((file) => file.language !== 'diff')
  const row = (file: PaletteFile, labelMatch: Match[] = []) => ({
    id: `file.${file.path}`,
    label: fileName(file.path),
    detail: file.path,
    icon: icons.file,
    action: () => actions.openFile(file.path),
    labelMatch,
    detailMatch: [] as Match[],
  })

  const query = prepareQuery(search)
  if (!query.normalized) {
    // With no query, the most recently opened editors come first.
    const recent = [...openTabs].reverse()
    const rank = (path: string) => {
      const index = recent.indexOf(path)
      return index < 0 ? Number.MAX_SAFE_INTEGER : index
    }
    return [...candidates]
      .sort((a, b) => rank(a.path) - rank(b.path))
      .slice(0, MAX_UNFILTERED)
      .map((file) => row(file))
  }

  return candidates
    .map((file) => {
      const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      return { file, score: scoreItem(fileName(file.path), directory, query) }
    })
    .filter(({ score }) => score.score > 0)
    // Equal scores: the shorter name is the more likely target.
    .sort((a, b) => b.score.score - a.score.score || fileName(a.file.path).length - fileName(b.file.path).length)
    .slice(0, MAX_FILTERED)
    .map(({ file, score }) => row(file, score.labelMatch))
}

function commandItems(search: string, sources: PaletteSources): PaletteItem[] {
  const { commands, whenContext, shortcutFor } = sources
  // A command whose `when` clause fails cannot run, so it is not offered.
  const available = commands.filter((command) => !command.when || parseWhenClause(command.when).evaluate(whenContext))
  const query = prepareQuery(search)
  if (!query.normalized) {
    return available.slice(0, MAX_UNFILTERED).map((command) => ({
      ...command, labelMatch: [], detailMatch: [], keybinding: shortcutFor(command.id),
    }))
  }
  return available
    .map((command) => ({ command, score: scoreItem(command.label, command.detail, query) }))
    .filter(({ score }) => score.score > 0)
    .sort((a, b) => b.score.score - a.score.score || a.command.label.length - b.command.label.length)
    .slice(0, MAX_FILTERED)
    .map(({ command, score }) => ({
      ...command,
      labelMatch: score.labelMatch,
      detailMatch: score.descriptionMatch,
      keybinding: shortcutFor(command.id),
    }))
}

export function buildPaletteItems(mode: PaletteMode, search: string, sources: PaletteSources): PaletteItem[] {
  if (mode === 'line') return lineItems(search, sources)
  if (mode === 'symbols') return symbolItems(search, sources)
  if (mode === 'files') return fileItems(search, sources)
  return commandItems(search, sources)
}
