import { describe, expect, it } from 'vitest'

import {
  blameDocumentPath, conflictDocumentPath, diffDocumentPath, formatBlame, hasConflict,
  hasUnresolvedConflicts, isStagedOnly, mergeSourceChanges, resolutionMessage,
} from './gitModel'

describe('status codes', () => {
  it('recognises every unmerged shape Git reports', () => {
    for (const status of ['UU', 'AU', 'UA', 'DU', 'UD', 'AA', 'DD']) {
      expect(hasConflict(status), status).toBe(true)
    }
    for (const status of ['M ', ' M', 'A ', '??', 'R ', 'MM']) {
      expect(hasConflict(status), status).toBe(false)
    }
  })

  it('reports whether an integration still needs attention', () => {
    expect(hasUnresolvedConflicts([{ status: 'M ' }, { status: 'UU' }])).toBe(true)
    expect(hasUnresolvedConflicts([{ status: 'M ' }, { status: '??' }])).toBe(false)
    expect(hasUnresolvedConflicts([])).toBe(false)
  })

  it('distinguishes a fully staged file from a partially staged one', () => {
    expect(isStagedOnly({ path: 'a', status: 'M ', staged: true })).toBe(true)
    expect(isStagedOnly({ path: 'a', status: 'MM', staged: true, workingTree: true })).toBe(false)
    expect(isStagedOnly({ path: 'a', status: ' M', workingTree: true })).toBe(false)
  })
})

describe('source control list', () => {
  const repository = {
    isRepository: true,
    changes: [
      { path: 'src/a.ts', status: 'M ', staged: true },
      { path: 'src/b.ts', status: '??' },
    ],
  }

  it('marks a tracked file the editor has modified as a working-tree change', () => {
    const changes = mergeSourceChanges(repository, ['src/a.ts'])
    expect(changes).toHaveLength(2)
    expect(changes[0]).toEqual({ path: 'src/a.ts', status: 'M ', staged: true, workingTree: true })
  })

  it('adds unsaved files Git has never seen', () => {
    const changes = mergeSourceChanges(repository, ['src/new.ts'])
    expect(changes.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/new.ts'])
    expect(changes[2]).toEqual({ path: 'src/new.ts', status: 'M', workingTree: true })
  })

  it('still lists unsaved buffers outside a repository', () => {
    const changes = mergeSourceChanges({ isRepository: false, changes: repository.changes }, ['README.md'])
    expect(changes).toEqual([{ path: 'README.md', status: 'M', workingTree: true }])
  })
})

describe('virtual documents', () => {
  it('names diffs by file and staging state', () => {
    expect(diffDocumentPath('src/deep/app.ts', false)).toBe('.tungsten/diffs/app.ts.diff')
    expect(diffDocumentPath('src/deep/app.ts', true)).toBe('.tungsten/diffs/staged-app.ts.diff')
    // Staged and unstaged diffs of the same file must not share a document.
    expect(diffDocumentPath('a.ts', true)).not.toBe(diffDocumentPath('a.ts', false))
  })

  it('keeps conflicts and blame in their own folders', () => {
    expect(conflictDocumentPath('src/app.ts')).toBe('.tungsten/conflicts/app.ts.merge')
    expect(blameDocumentPath('src/app.ts')).toBe('.tungsten/blame/app.ts.txt')
  })
})

describe('presentation', () => {
  it('aligns blame columns and truncates long identities', () => {
    const [line] = formatBlame([
      { hash: '0123456789abcdef', author: 'A Very Long Author Name Indeed', date: '2026-09-27', content: 'const x = 1' },
    ]).split('\n')
    expect(line).toBe('012345678  A Very Long Author  2026-09-27 │ const x = 1')
  })

  it('names the side a conflict was resolved with', () => {
    expect(resolutionMessage('ours')).toBe('Conflict resolved using current changes')
    expect(resolutionMessage('theirs')).toBe('Conflict resolved using incoming changes')
    expect(resolutionMessage('both')).toBe('Conflict resolved using both changes')
    expect(resolutionMessage('mark')).toBe('Working file marked as resolved')
  })
})
