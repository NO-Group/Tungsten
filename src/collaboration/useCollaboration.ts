/**
 * Live collaboration.
 *
 * Hosting and joining a room, the people in it, their cursors, the comment
 * thread, and the two streams that keep a room in sync: the active file is
 * published as it is edited, and the caret is announced as it moves. The rules
 * for folding incoming messages into a room are pure, in `collaborationModel`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { PREVIEW_PATH, type WorkspaceFile } from '../workspace'
import {
  EMPTY_ROOM, mergeSharedFiles, reduceCollaborationEvent,
  type CollaborationEvent, type CollaborationRoom, type Comment,
} from './collaborationModel'

/** How long to wait before publishing; a keystroke is not a document. */
const PUBLISH_DELAY = 220
const PRESENCE_DELAY = 90

export type CollaborationHost = {
  activeFile?: WorkspaceFile
  activePath: string
  cursor: { line: number; column: number }
  notify: (message: string) => void
  /** Applies documents the room published into the workspace. */
  applySharedFiles: (merge: (files: WorkspaceFile[]) => WorkspaceFile[]) => void
}

export function useCollaboration({ activeFile, activePath, cursor, notify, applySharedFiles }: CollaborationHost) {
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState('Developer')
  const [roomUrl, setRoomUrl] = useState('')
  const [active, setActive] = useState(false)
  const [room, setRoom] = useState<CollaborationRoom>(EMPTY_ROOM)
  const [commentInput, setCommentInput] = useState('')

  // Messages arrive outside React; the reducer needs the room as it is now.
  const roomRef = useRef(room)
  const nameRef = useRef(displayName)
  useEffect(() => {
    roomRef.current = room
    nameRef.current = displayName
  })

  const handleEvent = useCallback((message: CollaborationEvent) => {
    const result = reduceCollaborationEvent(roomRef.current, message, nameRef.current)
    roomRef.current = result.room
    setRoom(result.room)
    if (result.notice) notify(result.notice)
  }, [notify])

  const handleDocument = useCallback((shared: Record<string, string>) => {
    applySharedFiles((files) => mergeSharedFiles(files, shared))
  }, [applySharedFiles])

  const connect = useCallback(async (join: boolean) => {
    if (!window.tungsten) return notify('Live collaboration requires the desktop app')
    try {
      if (join) await window.tungsten.joinCollaboration(roomUrl, displayName)
      else setRoomUrl((await window.tungsten.hostCollaboration(displayName)).url)
      setActive(true)
      setRoom({ ...EMPTY_ROOM, participants: [displayName] })
      notify(join ? 'Joined collaboration room' : 'Collaboration room is ready')
    } catch (error) {
      notify(`Collaboration failed: ${(error as Error).message}`)
    }
  }, [displayName, notify, roomUrl])

  const leave = useCallback(() => {
    void window.tungsten?.leaveCollaboration()
    setActive(false)
    setRoom(EMPTY_ROOM)
  }, [])

  const sendComment = useCallback(() => {
    if (!commentInput.trim() || !window.tungsten) return
    void window.tungsten.sendCollaborationEvent({
      type: 'comment', name: displayName, text: commentInput.trim(), path: activeFile?.path, line: cursor.line,
    })
    setCommentInput('')
  }, [activeFile?.path, commentInput, cursor.line, displayName])

  const announceVoice = useCallback(() => {
    void window.tungsten?.sendCollaborationEvent({ type: 'signal', name: displayName, action: 'voice-ready' })
    notify('Voice-room signaling announced; media permission remains under your control')
  }, [displayName, notify])

  /** Publishes the file being edited, debounced. Diffs are not real files. */
  useEffect(() => {
    if (!window.tungsten || !active || !activeFile || activeFile.language === 'diff') return
    const timer = window.setTimeout(() => {
      void window.tungsten!.publishCollaborationFile(activeFile.path, activeFile.content)
    }, PUBLISH_DELAY)
    return () => window.clearTimeout(timer)
  }, [activeFile, active])

  /** Announces where the caret is, so others can draw it. */
  useEffect(() => {
    if (!active || !activePath || activePath === PREVIEW_PATH) return
    const timer = window.setTimeout(() => {
      void window.tungsten?.sendCollaborationEvent({
        type: 'presence', state: 'cursor', name: nameRef.current, path: activePath, line: cursor.line, column: cursor.column,
      })
    }, PRESENCE_DELAY)
    return () => window.clearTimeout(timer)
  }, [activePath, active, cursor.column, cursor.line])

  return {
    open,
    setOpen,
    displayName,
    setDisplayName,
    roomUrl,
    setRoomUrl,
    active,
    participants: room.participants,
    cursors: room.cursors,
    comments: room.comments as Comment[],
    commentInput,
    setCommentInput,
    host: () => connect(false),
    join: () => connect(true),
    leave,
    sendComment,
    announceVoice,
    handleEvent,
    handleDocument,
  }
}

export type CollaborationService = ReturnType<typeof useCollaboration>
