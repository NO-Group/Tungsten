/**
 * The Explorer view: workspace roots, the file tree and the outline of the
 * active file.
 */

import type React from 'react'
import {
  Box, Braces, ChevronDown, ChevronRight, Code, Ellipsis, File,
  FolderOpen, FolderPlus, Hash, List, Plus, RefreshCw, Shapes, Variable, X,
} from 'lucide-react'
import { TipButton } from '../TipButton'
import { ExplorerTree } from './ExplorerTree'
import type { WorkspaceFile } from '../../workspace'

/** Outline icons per symbol kind, mirroring VS Code's symbol iconography. */
const symbolIcons: Record<string, typeof Braces> = {
  function: Braces,
  method: Braces,
  class: Box,
  interface: Shapes,
  enum: List,
  struct: Box,
  variable: Variable,
  constant: Variable,
  property: Variable,
  html: Code,
  symbol: Hash,
}

export type OutlineSymbol = { type: string; label: string; line: number; depth: number }
export type WorkspaceRoot = { name: string; path: string; prefix: string }

export type ExplorerViewProps = {
  workspaceName: string
  /** Path of a file that changed on disk behind the editor's back, if any. */
  externalChange: string | null
  roots: WorkspaceRoot[]
  files: WorkspaceFile[]
  activePath: string
  dirty: Set<string>
  symbols: OutlineSymbol[]
  /** Highlights the symbol the cursor currently sits on. */
  cursorLine: number
  hasActiveFile: boolean
  onOpenFolder: () => void
  onAddRoot: () => void
  onRemoveRoot: (prefix: string) => void
  onRefresh: () => void
  onNewFile: () => void
  onOpenFile: (path: string) => void
  onFileContext: (event: React.MouseEvent, path: string) => void
  onRevealLine: (line: number) => void
}

export function ExplorerView({
  workspaceName, externalChange, roots, files, activePath, dirty, symbols, cursorLine,
  hasActiveFile, onOpenFolder, onAddRoot, onRemoveRoot, onRefresh, onNewFile,
  onOpenFile, onFileContext, onRevealLine,
}: ExplorerViewProps) {
  return (
    <>
      <div className="sidebar-title"><span>EXPLORER</span><Ellipsis size={16} /></div>

      <div className="project-heading">
        <ChevronDown size={13} />
        <strong>{workspaceName.toUpperCase()}</strong>
        <span>{externalChange && <i className="workspace-change-dot" title={`${externalChange} changed on disk`} />}</span>
        <TipButton label="Open folder" onClick={onOpenFolder}><FolderOpen size={14} /></TipButton>
        <TipButton label="Add workspace root" onClick={onAddRoot}><FolderPlus size={14} /></TipButton>
        <TipButton label="Refresh workspace" onClick={onRefresh}><RefreshCw size={13} /></TipButton>
        <TipButton label="New file" onClick={onNewFile}><File size={14} /><Plus size={8} className="mini-plus" /></TipButton>
      </div>

      {roots.length > 1 && (
        <div className="workspace-roots">
          {roots.map((root) => (
            <div key={root.path}>
              <span>{root.prefix || '@primary'} · {root.name}</span>
              {root.prefix && (
                <button title="Remove workspace root" onClick={() => onRemoveRoot(root.prefix)}><X size={10} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <ExplorerTree files={files} activePath={activePath} dirty={dirty} openFile={onOpenFile} onFileContext={onFileContext} />

      <div className="outline-section">
        <div className="section-heading"><ChevronDown size={13} /><span>OUTLINE</span><span /><Ellipsis size={14} /></div>
        {symbols.length ? (
          <div className="symbols-list">
            {symbols.map((symbol, index) => {
              // Each kind gets its own icon and colour, and nesting is indented,
              // so the outline reads like VS Code's rather than a flat list.
              const SymbolIcon = symbolIcons[symbol.type] ?? Braces
              return (
                <button
                  key={`${symbol.label}-${symbol.line}-${index}`}
                  className={hasActiveFile && cursorLine === symbol.line ? 'active' : ''}
                  style={{ paddingLeft: 22 + symbol.depth * 11 }}
                  title={`${symbol.type} · line ${symbol.line}`}
                  onClick={() => onRevealLine(symbol.line)}
                >
                  <SymbolIcon size={12} className={`symbol-icon symbol-${symbol.type}`} />
                  <span>{symbol.label}</span>
                  <small>{symbol.line}</small>
                </button>
              )
            })}
          </div>
        ) : <p className="outline-empty">No symbols found</p>}
      </div>

      <div className="collapsed-section"><ChevronRight size={13} /> TIMELINE</div>
    </>
  )
}

export default ExplorerView
