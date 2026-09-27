/**
 * The Search view's state.
 *
 * The matching itself is pure (`textSearch.ts`); this holds the query and its
 * options, runs the desktop's native pass alongside the in-memory one, and
 * performs replace-all. Keeping it together means the view is given results
 * rather than the means to compute them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { languageForPath, type WorkspaceFile } from '../workspace'
import {
  buildSearchRegex, replaceInFile, searchFiles, toSearchRows, type NativeSearchHit,
} from './textSearch'

/** Caps, chosen so a pathological query cannot lock the view up. */
const MAX_RESULTS = 2000
const MAX_NATIVE_RESULTS = 500
/** Typing pause before the native search runs. */
const NATIVE_DEBOUNCE = 180

export type SearchOptions = { matchCase: boolean; wholeWord: boolean; isRegex: boolean }

export type SearchHost = {
  files: WorkspaceFile[]
  workspaceRoot: string
  notify: (message: string) => void
  /** Writes a replacement back into the workspace buffer. */
  updateFile: (path: string, content: string) => void
}

export function useWorkspaceSearch({ files, workspaceRoot, notify, updateFile }: SearchHost) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [includes, setIncludes] = useState('')
  const [excludes, setExcludes] = useState('')
  const [options, setOptions] = useState<SearchOptions>({ matchCase: false, wholeWord: false, isRegex: false })
  /**
   * Native hits, tagged with the query they answered. Tagging is what keeps a
   * slow reply for an old query from showing up under a new one.
   */
  const [native, setNative] = useState<{ query: string; hits: NativeSearchHit[] }>({ query: '', hits: [] })
  const [pending, setPending] = useState(false)

  const resultSet = useMemo(() => searchFiles(
    files.map((file) => ({ path: file.path, content: file.content })),
    { pattern: query, ...options, includes, excludes, maxResults: MAX_RESULTS },
  ), [excludes, files, includes, options, query])

  /** True when the user has typed a regex that does not compile yet. */
  const regexError = useMemo(() => {
    if (!options.isRegex || !query) return null
    try {
      buildSearchRegex({ pattern: query, isRegex: true })
      return null
    } catch (error) {
      return (error as Error).message
    }
  }, [options.isRegex, query])

  /**
   * Whether the desktop's ripgrep pass can be trusted for this query.
   *
   * It does not understand our regex, whole-word or case options, so using it
   * there would report matches that disagree with the options chosen.
   */
  const nativeUsable = Boolean(window.tungsten) && Boolean(workspaceRoot)
    && !options.isRegex && !options.wholeWord && !options.matchCase

  useEffect(() => {
    if (!nativeUsable || !query.trim()) return
    let canceled = false
    const timer = window.setTimeout(() => {
      setPending(true)
      window.tungsten!.searchWorkspace(query, MAX_NATIVE_RESULTS)
        .then((hits) => { if (!canceled) setNative({ query, hits }) })
        .catch(() => { if (!canceled) setNative({ query, hits: [] }) })
        .finally(() => { if (!canceled) setPending(false) })
    }, NATIVE_DEBOUNCE)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [nativeUsable, query])

  /** Hits only count while they still answer the query in the box. */
  const nativeResults = useMemo(
    () => (nativeUsable && native.query === query ? native.hits : []),
    [native, nativeUsable, query],
  )
  const searching = pending && nativeUsable && Boolean(query.trim())

  const results = useMemo(
    () => toSearchRows(resultSet, files, nativeResults, languageForPath, query),
    [files, nativeResults, query, resultSet],
  )

  /** Replaces every current match across the workspace. */
  const replaceAll = useCallback(async () => {
    if (!query || resultSet.matchCount === 0) return
    let changed = 0
    for (const result of resultSet.results) {
      const file = files.find((item) => item.path === result.path)
      if (!file) continue
      const next = replaceInFile(file.content, result.matches, replace, Boolean(options.isRegex))
      if (next === file.content) continue
      changed += 1
      updateFile(file.path, next)
      if (window.tungsten && workspaceRoot) {
        try {
          await window.tungsten.writeFile(file.path, next)
        } catch (error) {
          notify((error as Error).message)
        }
      }
    }
    const { matchCount } = resultSet
    notify(`Replaced ${matchCount} occurrence${matchCount === 1 ? '' : 's'} in ${changed} file${changed === 1 ? '' : 's'}`)
  }, [files, notify, options.isRegex, query, replace, resultSet, updateFile, workspaceRoot])

  const toggleOption = useCallback((option: keyof SearchOptions) => {
    setOptions((current) => ({ ...current, [option]: !current[option] }))
  }, [])

  return {
    query,
    setQuery,
    replace,
    setReplace,
    showReplace,
    setShowReplace,
    showDetails,
    setShowDetails,
    includes,
    setIncludes,
    excludes,
    setExcludes,
    options,
    setOptions,
    toggleOption,
    regexError,
    searching,
    results,
    matchCount: resultSet.matchCount,
    limitHit: resultSet.limitHit,
    replaceAll,
  }
}

export type WorkspaceSearch = ReturnType<typeof useWorkspaceSearch>
