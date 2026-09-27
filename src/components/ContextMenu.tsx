/**
 * The explorer context menu.
 *
 * Positioned at the pointer but clamped to the viewport, so a right-click near
 * the bottom or right edge still shows the whole menu.
 */

import { Braces, Copy, FileCode2, FolderOpen, Trash2 } from 'lucide-react'

/** Roughly the menu's size; used to keep it on screen. */
const MENU_WIDTH = 190
const MENU_HEIGHT = 220

export type ContextMenuProps = {
  x: number
  y: number
  path: string
  /** Only the desktop build can show a file in the OS file manager. */
  canReveal: boolean
  onOpen: () => void
  onRename: () => void
  onCopyPath: () => void
  onReveal: () => void
  onDelete: () => void
}

export function ContextMenu({ x, y, path, canReveal, onOpen, onRename, onCopyPath, onReveal, onDelete }: ContextMenuProps) {
  return (
    <div
      className="context-menu"
      aria-label={`Actions for ${path}`}
      style={{ left: Math.min(x, window.innerWidth - MENU_WIDTH), top: Math.min(y, window.innerHeight - MENU_HEIGHT) }}
      onClick={(event) => event.stopPropagation()}
    >
      <button onClick={onOpen}><FileCode2 size={14} /><span>Open</span><kbd>Enter</kbd></button>
      <button onClick={onRename}><Braces size={14} /><span>Rename…</span><kbd>F2</kbd></button>
      <button onClick={onCopyPath}><Copy size={14} /><span>Copy relative path</span></button>
      {canReveal && <button onClick={onReveal}><FolderOpen size={14} /><span>Reveal in file manager</span></button>}
      <button className="danger" onClick={onDelete}><Trash2 size={14} /><span>Delete</span></button>
    </div>
  )
}

export default ContextMenu
