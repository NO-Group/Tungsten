/**
 * Diagnostics: what the language servers say is wrong, per file.
 *
 * Servers publish one file at a time and re-publish the whole file every
 * time, including an empty list when the last problem is fixed. Keeping that
 * straight -- replacing a file's problems without disturbing any other
 * file's -- is the whole job, and it is pure.
 */

import { MarkerSeverity, MarkerService, type Marker } from '../markers/markerService'

export type Diagnostic = {
  message: string
  path: string
  line: number
  /** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
  severity: number
}

export type LanguageStatus = { language: string; running: boolean; message: string }

export const IDLE_LANGUAGE_STATUS: LanguageStatus = {
  language: '',
  running: false,
  message: 'Built-in syntax highlighting',
}

/**
 * Replaces one file's diagnostics, leaving every other file's alone.
 *
 * Order is kept stable so the Problems panel does not reshuffle while a
 * server republishes: the file keeps its position and new files append.
 */
export function mergeDiagnostics(current: Diagnostic[], path: string, incoming: Diagnostic[]): Diagnostic[] {
  const known = current.some((problem) => problem.path === path)
  if (!known) return incoming.length ? [...current, ...incoming] : current
  const merged: Diagnostic[] = []
  let inserted = false
  for (const problem of current) {
    if (problem.path !== path) {
      merged.push(problem)
      continue
    }
    if (!inserted) {
      merged.push(...incoming)
      inserted = true
    }
  }
  return merged
}

const MARKER_SEVERITY: Record<number, MarkerSeverity> = {
  1: MarkerSeverity.Error,
  2: MarkerSeverity.Warning,
  3: MarkerSeverity.Info,
  4: MarkerSeverity.Hint,
}

/**
 * Projects diagnostics into the marker model, which is what gives the panel
 * VS Code's filtering, severity toggles and per-file grouping.
 */
export function diagnosticsToMarkers(problems: Diagnostic[]): Marker[] {
  const service = new MarkerService()
  const byPath = new Map<string, Diagnostic[]>()
  for (const problem of problems) {
    byPath.set(problem.path, [...(byPath.get(problem.path) ?? []), problem])
  }
  for (const [path, items] of byPath) {
    service.changeOne('tungsten', path, items.map((problem) => ({
      severity: MARKER_SEVERITY[problem.severity] ?? MarkerSeverity.Info,
      message: problem.message,
      startLineNumber: problem.line,
      startColumn: 1,
      endLineNumber: problem.line,
      endColumn: 1,
    })))
  }
  return service.read()
}

/** Status bar counts: everything that is not an error reads as a warning. */
export function countDiagnostics(problems: Diagnostic[]) {
  const errors = problems.filter((problem) => problem.severity === 1).length
  return { errors, warnings: problems.length - errors }
}
