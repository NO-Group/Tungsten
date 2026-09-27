/**
 * Pure Git helpers.
 *
 * Status-code interpretation, the merge of Git's view of a file with the
 * editor's unsaved one, and the naming of the virtual documents Tungsten opens
 * for diffs, conflicts and blame. None of it touches the desktop bridge, so it
 * is all directly testable.
 */

import { fileName } from '../workspace'

/** A file Git reports as changed, merged with the editor's dirty state. */
export type SourceChange = {
  path: string
  /** Two-letter porcelain status, e.g. `M `, ` M`, `??`, `UU`. */
  status: string
  /** Staged in the index. */
  staged?: boolean
  /** Modified in the working tree, including unsaved editor buffers. */
  workingTree?: boolean
}

/** A diff or conflict under review, and the document it is displayed in. */
export type GitComparison = {
  path: string
  /** The `.tungsten/` document the diff or conflict is shown in. */
  virtualPath: string
  before: string
  after: string
  /** The merge base; present only while resolving a conflict. */
  base?: string
  /** True when the comparison is against the index rather than the working tree. */
  staged: boolean
  hunks: Array<{ id: string; header: string; patch: string }>
  /** Absent for an ordinary diff; true only while resolving a merge conflict. */
  conflict?: boolean
}

export type BlameEntry = { hash: string; author: string; date: string; content: string }

/**
 * True when Git reports both sides of a merge for this path.
 *
 * `U` appears on either side of the status for an unmerged path; `AA` and `DD`
 * are the both-added and both-deleted cases, which carry no `U`.
 */
export function hasConflict(status: string): boolean {
  return status.includes('U') || status === 'AA' || status === 'DD'
}

/** True when a merge or rebase left at least one path unresolved. */
export function hasUnresolvedConflicts(changes: Array<{ status: string }>): boolean {
  return changes.some((change) => hasConflict(change.status))
}

/**
 * The Source Control list.
 *
 * Git only knows what is on disk, so unsaved buffers are folded in on top: a
 * file the editor has modified counts as a working-tree change even when Git
 * has not seen it yet.
 */
export function mergeSourceChanges(
  repository: { isRepository: boolean; changes: SourceChange[] },
  dirty: Iterable<string>,
): SourceChange[] {
  const changes = new Map<string, SourceChange>()
  if (repository.isRepository) repository.changes.forEach((change) => changes.set(change.path, change))
  for (const path of dirty) {
    changes.set(path, { ...(changes.get(path) || { path, status: 'M' }), workingTree: true })
  }
  return [...changes.values()]
}

/** True when staging this file would stage it, rather than unstage it. */
export function isStagedOnly(change: SourceChange): boolean {
  return Boolean(change.staged && !change.workingTree)
}

/** Virtual documents live under `.tungsten/` so they never collide with real files. */
export function diffDocumentPath(path: string, staged: boolean): string {
  return `.tungsten/diffs/${staged ? 'staged-' : ''}${fileName(path)}.diff`
}

export function conflictDocumentPath(path: string): string {
  return `.tungsten/conflicts/${fileName(path)}.merge`
}

export function blameDocumentPath(path: string): string {
  return `.tungsten/blame/${fileName(path)}.txt`
}

/** Renders blame as aligned columns, so the code still reads as code. */
export function formatBlame(entries: BlameEntry[]): string {
  return entries
    .map((entry) => `${entry.hash.slice(0, 9).padEnd(10)} ${entry.author.slice(0, 18).padEnd(19)} ${entry.date} │ ${entry.content}`)
    .join('\n')
}

/** How a conflict resolution is described back to the user. */
export function resolutionMessage(resolution: 'ours' | 'theirs' | 'both' | 'mark'): string {
  if (resolution === 'mark') return 'Working file marked as resolved'
  const side = resolution === 'ours' ? 'current' : resolution === 'theirs' ? 'incoming' : 'both'
  return `Conflict resolved using ${side} changes`
}
