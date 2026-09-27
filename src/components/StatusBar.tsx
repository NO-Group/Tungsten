/**
 * The status bar.
 *
 * Left: where the code is coming from -- remote, branch, diagnostics. Right:
 * what the editor is doing with it. Every item is a button that leads
 * somewhere, so the bar doubles as navigation rather than being a read-out.
 */

import { Bell, Box, CircleAlert, Download, Eye, GitBranch, Keyboard, Radio, RefreshCw, SquareCode, X, Zap } from 'lucide-react'

export type StatusBarProps = {
  remoteConnected: boolean
  onOpenRemote: () => void

  branch: string
  changeCount: number
  onOpenSourceControl: () => void
  onRefreshGit: () => void

  errorCount: number
  warningCount: number
  onOpenProblems: () => void

  /** Rendered prefix of a chord in progress, e.g. `Ctrl+K`. */
  pendingChord: string

  workspaceName: string
  workspaceRoot: string
  /** Platform string on the desktop; empty in the browser. */
  platform: string

  /** Hidden for non-text editors such as the preview pane. */
  showEditorStatus: boolean
  cursor: { line: number; column: number }
  language: string
  gotoLineShortcut: string
  onGotoLine: () => void

  themeLabel: string
  onPickTheme: () => void

  lsp: { running: boolean; language: string; message: string }

  updateState: string
  onUpdate: () => void
}

export function StatusBar({
  remoteConnected, onOpenRemote, branch, changeCount, onOpenSourceControl, onRefreshGit,
  errorCount, warningCount, onOpenProblems, pendingChord, workspaceName, workspaceRoot,
  platform, showEditorStatus, cursor, language, gotoLineShortcut, onGotoLine, themeLabel,
  onPickTheme, lsp, updateState, onUpdate,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div>
        <button
          title={remoteConnected ? 'Manage remote connection' : 'Open a remote workspace'}
          className={`remote-status ${remoteConnected ? 'connected' : ''}`}
          onClick={onOpenRemote}
        ><SquareCode size={13} /><span>{remoteConnected ? 'SSH' : ''}</span></button>

        <button title="Current branch" onClick={onOpenSourceControl}>
          <GitBranch size={13} /><span>{branch || 'main'}{changeCount ? '*' : ''}</span>
        </button>

        <button title="Refresh source control" onClick={onRefreshGit}>
          <RefreshCw size={11} /><span>{changeCount}</span>
        </button>

        <button title={`${errorCount + warningCount} language diagnostics`} onClick={onOpenProblems}>
          <X size={12} /><span>{errorCount}</span><CircleAlert size={12} /><span>{warningCount}</span>
        </button>

        {pendingChord && (
          <button className="chord-indicator" title="Waiting for the next key in the sequence">
            <Keyboard size={12} /><span>({pendingChord}) was pressed. Waiting for second key…</span>
          </button>
        )}
      </div>

      <div>
        <button title={workspaceRoot || 'Tungsten demo workspace'}><Radio size={11} /><span>{workspaceName}</span></button>
        <button title={platform ? `Desktop app · ${platform}` : 'Browser workspace'}>
          <Box size={11} /><span>{platform ? 'Desktop' : 'Web'}</span>
        </button>

        {showEditorStatus && <>
          <button title={`Go to line (${gotoLineShortcut})`} onClick={onGotoLine}>Ln {cursor.line}, Col {cursor.column}</button>
          <button>Spaces: 2</button>
          <button>UTF-8</button>
          <button>LF</button>
          <button>{language || 'Plain Text'}</button>
        </>}

        <button title={`Color theme: ${themeLabel} — click to change`} onClick={onPickTheme}>
          <Eye size={12} /><span>{themeLabel}</span>
        </button>

        <button title={lsp.message} className={lsp.running ? 'service-running' : ''}>
          <Zap size={12} /><span>{lsp.running ? `${lsp.language} LSP` : 'Syntax'}</span>
        </button>

        <button title={updateState} onClick={onUpdate}><Download size={12} /><span>{updateState}</span></button>
        <button title="Notifications"><Bell size={13} /></button>
      </div>
    </footer>
  )
}

export default StatusBar
