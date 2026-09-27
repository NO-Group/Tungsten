/**
 * The file tree.
 *
 * Folder expansion is the one piece of state a tree genuinely owns -- it is
 * view state, not workspace state, and nothing outside the tree needs to read
 * it -- so it stays here rather than being lifted into the workbench.
 */

import { useMemo, useState } from 'react'
import type React from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { buildTree, type TreeNode, type WorkspaceFile } from '../../workspace'
import { folderIconFor } from '../../theme/fileIcons'
import { FileGlyph } from '../FileGlyph'

export type ExplorerTreeProps = {
  files: WorkspaceFile[]
  activePath: string
  dirty: Set<string>
  openFile: (path: string) => void
  onFileContext: (event: React.MouseEvent, path: string) => void
}

export function ExplorerTree({ files, activePath, dirty, openFile, onFileContext }: ExplorerTreeProps) {
  const [expanded, setExpanded] = useState(() => new Set(['src', 'src/utils']))
  const tree = useMemo(() => buildTree(files), [files])

  const renderNode = (node: TreeNode, depth = 0) => {
    if (node.folder) {
      const isOpen = expanded.has(node.path)
      return (
        <div key={node.path}>
          <button
            className="tree-row folder-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (isOpen) next.delete(node.path)
              else next.add(node.path)
              return next
            })}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {isOpen
              ? <FolderOpen size={15} className="folder-icon" style={{ color: folderIconFor(node.name, true).color }} />
              : <Folder size={15} className="folder-icon" style={{ color: folderIconFor(node.name).color }} />}
            <span>{node.name}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <button
        key={node.path}
        className={`tree-row file-row ${activePath === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: 26 + depth * 14 }}
        onClick={() => openFile(node.path)}
        onContextMenu={(event) => onFileContext(event, node.path)}
      >
        <FileGlyph path={node.path} />
        <span className="tree-label">{node.name}</span>
        {dirty.has(node.path) && <span className="dirty-dot" />}
      </button>
    )
  }

  return <div className="file-tree">{tree.map((node) => renderNode(node))}</div>
}

export default ExplorerTree
