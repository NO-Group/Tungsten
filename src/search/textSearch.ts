import { isExcluded, matchesGlobExpression, parseGlobList, defaultSearchExcludes, type GlobExpression } from './glob'

/**
 * Workspace text search with the option set VS Code's search view exposes:
 * case sensitivity, whole word, regular expressions, include/exclude globs,
 * and search-and-replace with capture-group support.
 */

export interface SearchQuery {
  pattern: string
  isRegex?: boolean
  matchCase?: boolean
  wholeWord?: boolean
  /** Comma-separated globs, as typed into the "files to include" box. */
  includes?: string
  excludes?: string
  useDefaultExcludes?: boolean
  maxResults?: number
}

export interface SearchMatch {
  line: number
  /** Column offsets within the line, 0-based, end-exclusive. */
  start: number
  end: number
  text: string
  /** Capture groups, when the query is a regular expression. */
  groups?: string[]
}

export interface FileSearchResult {
  path: string
  matches: SearchMatch[]
}

export interface SearchResultSet {
  results: FileSearchResult[]
  matchCount: number
  fileCount: number
  limitHit: boolean
}

export interface SearchableFile {
  path: string
  content: string
}

const MAX_RESULTS = 10_000

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compiles a query into a regex.
 *
 * Returns `null` for an empty pattern, and throws for an invalid user-supplied
 * regular expression so the caller can surface the error in the search box.
 */
export function buildSearchRegex(query: SearchQuery): RegExp | null {
  if (!query.pattern) return null
  let source = query.isRegex ? query.pattern : escapeRegExp(query.pattern)
  if (query.wholeWord) {
    // \b only works next to word characters, so only apply it where it means
    // something — matching VS Code, where whole-word on "+" is a no-op.
    const leading = /^\w/.test(query.isRegex ? query.pattern.replace(/^\\[bB]/, '') : query.pattern) ? '\\b' : ''
    const trailing = /\w$/.test(query.isRegex ? query.pattern : query.pattern) ? '\\b' : ''
    source = `${leading}${source}${trailing}`
  }
  return new RegExp(source, query.matchCase ? 'g' : 'gi')
}

function shouldSearchFile(path: string, query: SearchQuery): boolean {
  const includes = query.includes?.trim() ? parseGlobList(query.includes) : null
  if (includes && !matchesGlobExpression(includes, path)) return false

  const excludes: GlobExpression = {
    ...(query.useDefaultExcludes === false ? {} : defaultSearchExcludes),
    ...(query.excludes?.trim() ? parseGlobList(query.excludes) : {}),
  }
  // Exclude a file when the pattern matches it or any ancestor directory.
  return !isExcluded(excludes, path)
}

/** Runs a query across the given files. */
export function searchFiles(files: SearchableFile[], query: SearchQuery): SearchResultSet {
  const limit = query.maxResults ?? MAX_RESULTS
  const results: FileSearchResult[] = []
  let matchCount = 0
  let limitHit = false

  let regex: RegExp | null
  try {
    regex = buildSearchRegex(query)
  } catch {
    // An in-progress regex (e.g. "foo(") should yield nothing, not crash.
    return { results: [], matchCount: 0, fileCount: 0, limitHit: false }
  }
  if (!regex) return { results: [], matchCount: 0, fileCount: 0, limitHit: false }

  for (const file of files) {
    if (limitHit) break
    if (!shouldSearchFile(file.path, query)) continue

    const matches: SearchMatch[] = []
    const lines = file.content.split('\n')
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const text = lines[lineIndex]
      regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          line: lineIndex + 1,
          start: match.index,
          end: match.index + match[0].length,
          text,
          groups: match.length > 1 ? match.slice(1).map((group) => group ?? '') : undefined,
        })
        matchCount += 1
        if (matchCount >= limit) {
          limitHit = true
          break
        }
        // Guard against zero-width matches looping forever.
        if (match[0].length === 0) regex.lastIndex += 1
      }
      if (limitHit) break
    }

    if (matches.length > 0) results.push({ path: file.path, matches })
  }

  return { results, matchCount, fileCount: results.length, limitHit }
}

/**
 * Applies a replacement to one match, expanding `$1`-style capture references
 * when the query is a regular expression.
 */
export function applyReplacement(match: SearchMatch, replacement: string, isRegex: boolean): string {
  const expanded = isRegex && match.groups
    ? replacement.replace(/\$(\d+)/g, (_, digits: string) => match.groups?.[Number(digits) - 1] ?? '')
    : replacement
  return match.text.slice(0, match.start) + expanded + match.text.slice(match.end)
}

/** Rewrites a whole file, applying every match in one pass. */
export function replaceInFile(content: string, matches: SearchMatch[], replacement: string, isRegex: boolean): string {
  const lines = content.split('\n')
  const byLine = new Map<number, SearchMatch[]>()
  for (const match of matches) {
    byLine.set(match.line, [...(byLine.get(match.line) ?? []), match])
  }
  for (const [line, lineMatches] of byLine) {
    const index = line - 1
    if (index < 0 || index >= lines.length) continue
    // Right-to-left so earlier offsets stay valid as the line is rewritten.
    const ordered = [...lineMatches].sort((a, b) => b.start - a.start)
    let text = lines[index]
    for (const match of ordered) {
      const expanded = isRegex && match.groups
        ? replacement.replace(/\$(\d+)/g, (_, digits: string) => match.groups?.[Number(digits) - 1] ?? '')
        : replacement
      text = text.slice(0, match.start) + expanded + text.slice(match.end)
    }
    lines[index] = text
  }
  return lines.join('\n')
}
