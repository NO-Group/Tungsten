import { describe, expect, it } from 'vitest'

import {
  EMPTY_ROOM, cursorsInFile, mergeSharedFiles, reduceCollaborationEvent, type CollaborationRoom,
} from './collaborationModel'

const room: CollaborationRoom = {
  participants: ['Ada', 'Grace'],
  cursors: { Grace: { path: 'src/main.ts', line: 4, column: 2 } },
  comments: [],
}

/** Applies a run of events as the room would receive them. */
const play = (start: CollaborationRoom, events: Parameters<typeof reduceCollaborationEvent>[1][], self = 'Ada') =>
  events.reduce((current, event) => reduceCollaborationEvent(current, event, self).room, start)

describe('presence', () => {
  it('adds someone once, however many messages they send', () => {
    const next = play(room, [
      { type: 'presence', name: 'Linus', state: 'joined' },
      { type: 'presence', name: 'Linus', state: 'cursor', path: 'a.ts', line: 1, column: 1 },
    ])
    expect(next.participants).toEqual(['Ada', 'Grace', 'Linus'])
  })

  it('removes someone who disconnects, along with their cursor', () => {
    const next = reduceCollaborationEvent(room, { type: 'presence', name: 'Grace', state: 'disconnected' }, 'Ada').room
    expect(next.participants).toEqual(['Ada'])
    expect(next.cursors).toEqual({})
  })

  it('tracks other people\u2019s cursors but never your own', () => {
    const next = play(room, [
      { type: 'presence', name: 'Grace', state: 'cursor', path: 'src/util.ts', line: 9, column: 3 },
      { type: 'presence', name: 'Ada', state: 'cursor', path: 'src/main.ts', line: 1, column: 1 },
    ])
    expect(next.cursors).toEqual({ Grace: { path: 'src/util.ts', line: 9, column: 3 } })
  })

  it('ignores a cursor with nothing to point at', () => {
    const next = play(room, [{ type: 'presence', name: 'Linus', state: 'cursor', path: 'a.ts' }])
    expect(next.cursors.Linus).toBeUndefined()
    // The person still counts as present.
    expect(next.participants).toContain('Linus')
  })

  it('surfaces connection trouble to the user', () => {
    expect(reduceCollaborationEvent(room, { type: 'presence', name: 'Grace', state: 'reconnecting' }, 'Ada').notice)
      .toBe('Collaboration connection lost; reconnecting…')
    expect(reduceCollaborationEvent(room, { type: 'presence', name: 'Grace', state: 'reconnected' }, 'Ada').notice)
      .toBe('Collaboration reconnected')
    expect(reduceCollaborationEvent(room, { type: 'presence', name: 'Grace', state: 'cursor' }, 'Ada').notice)
      .toBeUndefined()
  })

  it('ignores anonymous or unknown traffic', () => {
    expect(reduceCollaborationEvent(room, { type: 'presence' }, 'Ada').room).toBe(room)
    expect(reduceCollaborationEvent(room, { type: 'signal', action: 'voice-ready' }, 'Ada').room).toBe(room)
  })
})

describe('comments', () => {
  it('keeps the file and line a comment was made against', () => {
    const next = reduceCollaborationEvent(room, { type: 'comment', name: 'Grace', text: 'why?', path: 'a.ts', line: 12 }, 'Ada').room
    expect(next.comments).toEqual([{ name: 'Grace', text: 'why?', path: 'a.ts', line: 12 }])
  })

  it('attributes an unsigned comment rather than dropping it', () => {
    expect(reduceCollaborationEvent(EMPTY_ROOM, { type: 'comment', text: 'hi' }, 'Ada').room.comments[0].name).toBe('Collaborator')
  })

  it('ignores an empty comment', () => {
    expect(reduceCollaborationEvent(EMPTY_ROOM, { type: 'comment', text: '' }, 'Ada').room.comments).toEqual([])
  })
})

describe('shared documents', () => {
  const files = [
    { path: 'src/main.ts', content: 'old', language: 'typescript' },
    { path: 'README.md', content: '# Forge', language: 'markdown' },
  ]

  it('updates a known file in place', () => {
    const merged = mergeSharedFiles(files, { 'src/main.ts': 'new' })
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual({ path: 'src/main.ts', content: 'new', language: 'typescript' })
  })

  it('adds a file nobody here had open, with a language guessed from the path', () => {
    const merged = mergeSharedFiles(files, { 'src/new.py': 'print(1)' })
    expect(merged).toHaveLength(3)
    expect(merged[2]).toEqual({ path: 'src/new.py', content: 'print(1)', language: 'python' })
  })

  it('leaves the workspace alone when the room shares nothing', () => {
    expect(mergeSharedFiles(files, {})).toEqual(files)
  })
})

describe('drawing cursors', () => {
  it('returns only the cursors in the file being rendered', () => {
    const cursors = {
      Grace: { path: 'a.ts', line: 1, column: 1 },
      Linus: { path: 'b.ts', line: 2, column: 2 },
    }
    expect(cursorsInFile(cursors, 'a.ts')).toEqual([['Grace', cursors.Grace]])
    expect(cursorsInFile(cursors, 'c.ts')).toEqual([])
  })
})
