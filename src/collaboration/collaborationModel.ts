/**
 * What a collaboration room looks like, and how one message changes it.
 *
 * Presence, cursors and comments all arrive on the same channel, so the rules
 * for folding them into the room -- who is here, whose cursor to draw, what to
 * tell the user -- are written once, here, rather than inside a subscription
 * callback where they cannot be tested.
 */

import { languageForPath, type WorkspaceFile } from '../workspace'

export type CollaboratorCursor = { path: string; line: number; column: number }

export type Comment = { name: string; text: string; path?: string; line?: number }

export type CollaborationEvent = {
  type: string
  name?: string
  state?: string
  path?: string
  line?: number
  column?: number
  text?: string
  action?: string
}

export type CollaborationRoom = {
  participants: string[]
  /** Other people's cursors, by display name. Never contains your own. */
  cursors: Record<string, CollaboratorCursor>
  comments: Comment[]
}

export const EMPTY_ROOM: CollaborationRoom = { participants: [], cursors: {}, comments: [] }

/** A connection message the user should be told about. */
const NOTICES: Record<string, string> = {
  reconnecting: 'Collaboration connection lost; reconnecting…',
  reconnected: 'Collaboration reconnected',
}

export function reduceCollaborationEvent(
  room: CollaborationRoom,
  message: CollaborationEvent,
  selfName: string,
): { room: CollaborationRoom; notice?: string } {
  if (message.type === 'comment' && message.text) {
    const comment = { name: message.name || 'Collaborator', text: message.text, path: message.path, line: message.line }
    return { room: { ...room, comments: [...room.comments, comment] } }
  }

  if (message.type !== 'presence' || !message.name) return { room }
  const name = message.name
  const leaving = message.state === 'disconnected'

  const participants = leaving
    ? room.participants.filter((participant) => participant !== name)
    : room.participants.includes(name) ? room.participants : [...room.participants, name]

  const cursors = { ...room.cursors }
  if (leaving) delete cursors[name]
  // Your own cursor is already on screen; drawing it twice would fight the
  // editor's own caret.
  if (message.state === 'cursor' && name !== selfName && message.path && message.line && message.column) {
    cursors[name] = { path: message.path, line: message.line, column: message.column }
  }

  return { room: { ...room, participants, cursors }, notice: NOTICES[message.state || ''] }
}

/**
 * Folds documents published by the room into the workspace.
 *
 * A shared file may be one nobody here has opened, so an unknown path becomes
 * a new file rather than being dropped.
 */
export function mergeSharedFiles(current: WorkspaceFile[], shared: Record<string, string>): WorkspaceFile[] {
  const known = new Map(current.map((file) => [file.path, file]))
  Object.entries(shared).forEach(([path, content]) => {
    known.set(path, { ...(known.get(path) || { path, language: languageForPath(path) }), content })
  })
  return [...known.values()]
}

/** The cursors to draw in one file. */
export function cursorsInFile(cursors: Record<string, CollaboratorCursor>, path: string): Array<[string, CollaboratorCursor]> {
  return Object.entries(cursors).filter(([, cursor]) => cursor.path === path)
}
