/**
 * The shell dictionary: lookup, search, suggestions and manual pages.
 *
 * The data is split across `data/` by subject; this module is the index over
 * all of it. Everything is pure and synchronous -- the dictionary is a few
 * hundred small objects, so a search is a single pass with a score, and the
 * React view can call it during render without a worker or a debounce.
 *
 * `createDictionary` takes extra entries so the workspace can contribute its
 * own commands (see `workspaceCommands.ts`) without a second code path: the
 * sidebar, the terminal and `man` all read one merged index.
 */

import type { CommandEntry, CommandGroup } from './commandModel'
import { commandGroups } from './commandModel'
import { builtinCommands } from './data/builtins'
import { developmentCommands } from './data/development'
import { extraCommands } from './data/extras'
import { fileCommands } from './data/files'
import { networkCommands } from './data/network'
import { systemCommands } from './data/system'
import { textCommands } from './data/text'
import { toolboxCommands } from './data/toolbox'

/** Every command Tungsten ships knowledge of, before workspace additions. */
export const builtinDictionary: CommandEntry[] = [
  ...builtinCommands,
  ...fileCommands,
  ...textCommands,
  ...systemCommands,
  ...networkCommands,
  ...developmentCommands,
  ...toolboxCommands,
  ...extraCommands,
]

/** A line of a rendered manual page. The tone drives colour, not layout. */
export type ManLine = { text: string; tone?: 'heading' | 'muted' | 'warning' }

export type SearchOptions = {
  /** Restrict to one shelf. */
  group?: CommandGroup | 'All'
  limit?: number
}

export type Dictionary = {
  entries: CommandEntry[]
  byName: Map<string, CommandEntry>
  lookup: (name: string) => CommandEntry | undefined
  search: (query: string, options?: SearchOptions) => CommandEntry[]
  suggest: (name: string, limit?: number) => string[]
  /** How many entries each group holds, in the order groups are declared. */
  counts: () => Array<{ group: CommandGroup; count: number }>
}

/**
 * Edit distance that counts a swap of two neighbours as one mistake.
 *
 * Plain Levenshtein scores `gti` two edits away from `git`, which pushes the
 * single most common kind of typo out of suggestion range. Damerau's extra
 * case costs one more row of state and fixes it.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length || !b.length) return Math.max(a.length, b.length)

  let twoBack: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitute = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, substitute)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], twoBack[j - 2] + 1)
      }
    }
    twoBack = previous
    previous = row
  }
  return previous[b.length]
}

/**
 * Scores one entry against one lowercase term.
 *
 * The ladder is deliberate: a name match beats a summary match beats a match
 * buried in a flag table, so typing `tar` does not surface every command whose
 * description happens to mention archives first.
 */
function scoreTerm(entry: CommandEntry, term: string): number {
  const name = entry.name.toLowerCase()
  if (name === term) return 1000
  if (name.startsWith(term)) return 800 - name.length
  if (name.includes(term)) return 600 - name.length
  if (entry.aliases?.some((alias) => alias.toLowerCase() === term)) return 560
  if (entry.aliases?.some((alias) => alias.toLowerCase().includes(term))) return 420
  if (entry.summary.toLowerCase().includes(term)) return 400
  if (entry.group.toLowerCase() === term) return 350
  if (entry.options?.some((option) => option.flag.toLowerCase().includes(term))) return 250
  if (entry.examples?.some((example) => example.command.toLowerCase().includes(term))) return 220
  if (entry.description?.toLowerCase().includes(term)) return 180
  if (entry.seeAlso?.some((other) => other.toLowerCase() === term)) return 120
  if (entry.from?.toLowerCase().includes(term)) return 100
  return 0
}

export function createDictionary(extra: CommandEntry[] = []): Dictionary {
  // Workspace entries win, so a project can correct or extend a built-in.
  const byName = new Map<string, CommandEntry>()
  for (const entry of [...builtinDictionary, ...extra]) byName.set(entry.name, entry)
  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))

  // Aliases resolve to the same entry but do not appear in the list, so
  // `magick` is documented once and `imagemagick` still finds it.
  const byAlias = new Map<string, CommandEntry>()
  for (const entry of entries) {
    for (const alias of entry.aliases || []) if (!byName.has(alias)) byAlias.set(alias, entry)
  }

  const lookup = (name: string) => {
    const key = name.trim()
    return byName.get(key) || byAlias.get(key)
  }

  const search = (query: string, options: SearchOptions = {}) => {
    const { group = 'All', limit = 200 } = options
    const pool = group === 'All' ? entries : entries.filter((entry) => entry.group === group)
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return pool.slice(0, limit)

    const scored: Array<{ entry: CommandEntry; score: number }> = []
    for (const entry of pool) {
      let total = 0
      // Every term has to land somewhere, so two words narrow rather than widen.
      for (const term of terms) {
        const score = scoreTerm(entry, term)
        if (!score) { total = 0; break }
        total += score
      }
      // On equal textual merit, prefer the command that is documented in
      // depth: searching "archive" should land on tar, not on a one-line stub
      // that happens to use the same word.
      if (total) scored.push({ entry, score: total + (entry.options ? 30 : 0) + (entry.examples ? 20 : 0) })
    }
    scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    return scored.slice(0, limit).map((hit) => hit.entry)
  }

  const suggest = (name: string, limit = 3) => {
    const typed = name.trim().toLowerCase()
    if (!typed) return []
    const near = entries
      .map((entry) => ({ name: entry.name, distance: editDistance(typed, entry.name.toLowerCase()) }))
      .filter((hit) => hit.distance <= (typed.length <= 3 ? 1 : 2) || hit.name.startsWith(typed))
      .sort((a, b) => a.distance - b.distance || a.name.length - b.name.length)
    return near.slice(0, limit).map((hit) => hit.name)
  }

  const counts = () =>
    commandGroups
      .map((group) => ({ group, count: entries.filter((entry) => entry.group === group).length }))
      .filter((row) => row.count > 0)

  return { entries, byName, lookup, search, suggest, counts }
}

/** The dictionary with no workspace contributions -- the common case. */
export const shellDictionary = createDictionary()

/**
 * Renders an entry the way `man` would, as lines a terminal can print.
 *
 * Kept here rather than in the terminal so the same text is available to any
 * surface that wants it -- the panel, a hover, or a generated file.
 */
export function manPage(entry: CommandEntry): ManLine[] {
  const lines: ManLine[] = []
  const heading = (text: string) => lines.push({ text, tone: 'heading' })

  heading('NAME')
  lines.push({ text: `    ${entry.name} — ${entry.summary}` })
  heading('SYNOPSIS')
  lines.push({ text: `    ${entry.synopsis}` })

  if (entry.description) {
    heading('DESCRIPTION')
    for (const line of wrap(entry.description, 76)) lines.push({ text: `    ${line}` })
  }

  if (entry.danger) {
    heading('WARNING')
    for (const line of wrap(entry.danger, 76)) lines.push({ text: `    ${line}`, tone: 'warning' })
  }

  if (entry.options?.length) {
    heading('OPTIONS')
    for (const option of entry.options) {
      lines.push({ text: `    ${option.flag}` })
      for (const line of wrap(option.summary, 68)) lines.push({ text: `        ${line}`, tone: 'muted' })
    }
  }

  if (entry.examples?.length) {
    heading('EXAMPLES')
    for (const example of entry.examples) {
      lines.push({ text: `    $ ${example.command}` })
      lines.push({ text: `        ${example.summary}`, tone: 'muted' })
    }
  }

  if (entry.seeAlso?.length) {
    heading('SEE ALSO')
    lines.push({ text: `    ${entry.seeAlso.join(', ')}` })
  }

  const provenance = [
    entry.builtin ? 'shell builtin' : entry.from ? `from ${entry.from}` : '',
    entry.source ? `contributed by ${entry.source}` : '',
    `Tungsten dictionary · ${entry.group}`,
  ].filter(Boolean)
  lines.push({ text: `    ${provenance.join(' · ')}`, tone: 'muted' })
  return lines
}

/** Greedy word wrap, so a long description does not run off a narrow panel. */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!line.length) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}
