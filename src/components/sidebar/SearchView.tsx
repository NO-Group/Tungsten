/**
 * The Search view.
 *
 * Purely presentational: the actual searching (in-memory index merged with
 * ripgrep on the desktop) stays in the workbench, and this renders the query
 * surface and the result list it produces.
 */

import { Replace, Search } from 'lucide-react'
import { FileGlyph } from '../FileGlyph'
import { TipButton } from '../TipButton'
import { fileName } from '../../workspace'
import type { SearchMatch } from '../../search/textSearch'

export type SearchOptions = { matchCase: boolean; wholeWord: boolean; isRegex: boolean }

/** One rendered hit: a match plus enough of its file to label the row. */
export type SearchHit = {
  file: { path: string }
  line: string
  index: number
  column: number
  match: SearchMatch
}

export type SearchViewProps = {
  query: string
  replace: string
  showReplace: boolean
  showDetails: boolean
  includes: string
  excludes: string
  options: SearchOptions
  regexError: string | null
  searching: boolean
  results: SearchHit[]
  matchCount: number
  limitHit: boolean
  onQueryChange: (value: string) => void
  onReplaceChange: (value: string) => void
  onToggleReplace: () => void
  onToggleDetails: () => void
  onIncludesChange: (value: string) => void
  onExcludesChange: (value: string) => void
  onOptionsChange: (update: (current: SearchOptions) => SearchOptions) => void
  onReplaceAll: () => void
  onOpenResult: (path: string, line: number, column: number) => void
}

export function SearchView({
  query, replace, showReplace, showDetails, includes, excludes, options, regexError,
  searching, results, matchCount, limitHit, onQueryChange, onReplaceChange, onToggleReplace,
  onToggleDetails, onIncludesChange, onExcludesChange, onOptionsChange, onReplaceAll, onOpenResult,
}: SearchViewProps) {
  const fileCount = new Set(results.map((item) => item.file.path)).size

  return (
    <>
      <div className="sidebar-title">
        <span>SEARCH</span>
        <TipButton label={showReplace ? 'Hide replace' : 'Show replace'} active={showReplace} onClick={onToggleReplace}>
          <Replace size={14} />
        </TipButton>
      </div>

      <div className="search-input-row">
        <div className={`search-box-wrap ${regexError ? 'invalid' : ''}`}>
          <Search size={13} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search" aria-label="Search workspace" />
          <div className="search-toggles">
            <button className={options.matchCase ? 'active' : ''} title="Match Case (Alt+C)" aria-pressed={options.matchCase} onClick={() => onOptionsChange((value) => ({ ...value, matchCase: !value.matchCase }))}>Aa</button>
            <button className={options.wholeWord ? 'active' : ''} title="Match Whole Word (Alt+W)" aria-pressed={options.wholeWord} onClick={() => onOptionsChange((value) => ({ ...value, wholeWord: !value.wholeWord }))}>ab</button>
            <button className={options.isRegex ? 'active' : ''} title="Use Regular Expression (Alt+R)" aria-pressed={options.isRegex} onClick={() => onOptionsChange((value) => ({ ...value, isRegex: !value.isRegex }))}>.*</button>
          </div>
        </div>
      </div>

      {showReplace && (
        <div className="search-input-row">
          <div className="search-box-wrap">
            <Replace size={13} />
            <input value={replace} onChange={(event) => onReplaceChange(event.target.value)} placeholder="Replace" aria-label="Replace with" />
          </div>
          <button className="search-replace-all" disabled={matchCount === 0} title="Replace All" onClick={onReplaceAll}>Replace All</button>
        </div>
      )}

      <button className="search-toggle-details" onClick={onToggleDetails}>{showDetails ? '▾' : '▸'} files to include / exclude</button>
      {showDetails && (
        <div className="search-globs">
          <label>include<input value={includes} onChange={(event) => onIncludesChange(event.target.value)} placeholder="e.g. src/**, *.ts" /></label>
          <label>exclude<input value={excludes} onChange={(event) => onExcludesChange(event.target.value)} placeholder="e.g. **/*.test.ts" /></label>
        </div>
      )}

      <div className="search-meta">
        {regexError
          ? <span className="search-error">Invalid regular expression</span>
          : searching
            ? 'Searching with ripgrep…'
            : query
              ? `${results.length} result${results.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}${limitHit ? ' (truncated)' : ''}`
              : 'Type to search across files'}
      </div>

      <div className="search-results">
        {results.map((result, index) => (
          <button
            key={`${result.file.path}-${result.index}-${result.column}-${index}`}
            onClick={() => onOpenResult(result.file.path, result.index + 1, result.column)}
          >
            <div><FileGlyph path={result.file.path} /><strong>{fileName(result.file.path)}</strong><span>:{result.index + 1}</span></div>
            <p>
              {result.line.slice(Math.max(0, result.match.start - 24), result.match.start).trimStart()}
              <mark>{result.line.slice(result.match.start, result.match.end)}</mark>
              {result.line.slice(result.match.end, result.match.end + 60)}
            </p>
          </button>
        ))}
      </div>
    </>
  )
}

export default SearchView
