/**
 * The status bar.
 *
 * Left: where the code is coming from -- remote, branch, diagnostics. Right:
 * what the editor is doing with it. Every item is a button that leads
 * somewhere, so the bar doubles as navigation rather than being a read-out.
 *
 * "Every item" is meant literally, and for a while it was not true: the
 * indentation, encoding, line-ending and language slots were hard-coded
 * words with no handler, and the workspace, runtime, language-server and
 * notification slots did nothing when clicked. A status bar that reports
 * `Spaces: 2` at a tab-indented file is worse than one that reports
 * nothing, so each of those now reads the real file and opens something
 * that can change it.
 */

import { Bell, Box, CircleAlert, Coins, Download, Eye, GitBranch, Keyboard, Radio, RefreshCw, SquareCode, X, Zap } from 'lucide-react'

import { formatCredits } from '../ai/pricing'

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
  /** Reveals the workspace in the explorer. */
  onOpenWorkspace: () => void
  /** Platform string on the desktop; empty in the browser. */
  platform: string
  /** Opens the runtime detail -- which shell, which updater, which storage. */
  onOpenRuntime: () => void

  /** Hidden for non-text editors such as the preview pane. */
  showEditorStatus: boolean
  cursor: { line: number; column: number }
  language: string
  gotoLineShortcut: string
  onGotoLine: () => void

  /**
   * The three readings taken from the file itself, each with the
   * sentence that explains it and the picker that changes it.
   */
  indentation: { label: string; title: string }
  onPickIndentation: () => void
  encoding: { label: string; title: string }
  onPickEncoding: () => void
  eol: { label: string; title: string }
  onPickEol: () => void
  onPickLanguage: () => void

  themeLabel: string
  onPickTheme: () => void

  lsp: { running: boolean; language: string; message: string }
  /** Opens the problems panel, which is where a language server's output lands. */
  onOpenLsp: () => void

  updateState: string
  /** Longer explanation for the hover; defaults to the label itself. */
  updateTitle?: string
  onUpdate: () => void

  /**
   * Spendable AI credits.
   *
   * In the bar rather than only in the panel because the number people
   * need is the one they can see without going to look for it. A
   * balance you have to open a tab to find is a balance you discover
   * at zero.
   */
  credits?: number
  planLabel?: string
  onOpenCredits?: () => void

  /** Unread notifications, and the bell that opens the history. */
  unreadNotifications: number
  notificationsTitle: string
  /** `warning` or `error` tints the bell; undefined leaves it quiet. */
  notificationSeverity?: 'info' | 'warning' | 'error'
  onOpenNotifications: () => void
}

export function StatusBar({
  remoteConnected, onOpenRemote, branch, changeCount, onOpenSourceControl, onRefreshGit,
  errorCount, warningCount, onOpenProblems, pendingChord, workspaceName, workspaceRoot,
  onOpenWorkspace, platform, onOpenRuntime, showEditorStatus, cursor, language,
  gotoLineShortcut, onGotoLine, indentation, onPickIndentation, encoding, onPickEncoding,
  eol, onPickEol, onPickLanguage, themeLabel, onPickTheme, lsp, onOpenLsp, updateState,
  updateTitle, onUpdate, credits, planLabel, onOpenCredits, unreadNotifications,
  notificationsTitle, notificationSeverity, onOpenNotifications,
}: StatusBarProps) {
  // Low is a tenth of a Core month: enough warning to act, not so much
  // that the bar nags from the day the plan renews.
  const low = credits !== undefined && credits < 300
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
        <button title={workspaceRoot ? `${workspaceRoot} — show it in the explorer` : 'Tungsten demo workspace — show it in the explorer'} onClick={onOpenWorkspace}>
          <Radio size={11} /><span>{workspaceName}</span>
        </button>
        <button
          title={platform ? `Desktop app · ${platform} — what this build can reach` : 'Browser workspace — what this build can reach'}
          onClick={onOpenRuntime}
        >
          <Box size={11} /><span>{platform ? 'Desktop' : 'Web'}</span>
        </button>

        {showEditorStatus && <>
          <button title={`Go to line (${gotoLineShortcut})`} onClick={onGotoLine}>Ln {cursor.line}, Col {cursor.column}</button>
          <button title={indentation.title} onClick={onPickIndentation}>{indentation.label}</button>
          <button title={encoding.title} onClick={onPickEncoding}>{encoding.label}</button>
          <button title={eol.title} onClick={onPickEol}>{eol.label}</button>
          <button title="Select the language mode for this file" onClick={onPickLanguage}>{language || 'Plain Text'}</button>
        </>}

        <button title={`Color theme: ${themeLabel} — click to change`} onClick={onPickTheme}>
          <Eye size={12} /><span>{themeLabel}</span>
        </button>

        <button title={`${lsp.message} — open the problems panel`} className={lsp.running ? 'service-running' : ''} onClick={onOpenLsp}>
          <Zap size={12} /><span>{lsp.running ? `${lsp.language} LSP` : 'Syntax'}</span>
        </button>

        {credits !== undefined && (
          <button
            className={`credit-status ${low ? 'low' : ''}`}
            title={`${formatCredits(credits)} AI credits${planLabel ? ` on ${planLabel}` : ''} — click for plans and top-ups`}
            onClick={onOpenCredits}
          >
            <Coins size={12} /><span>{formatCredits(credits)}</span>
          </button>
        )}

        <button title={updateTitle ?? updateState} onClick={onUpdate}><Download size={12} /><span>{updateState}</span></button>
        <button
          className={`notification-bell ${unreadNotifications ? `unread ${notificationSeverity ?? 'info'}` : ''}`.trim()}
          title={notificationsTitle}
          aria-label={notificationsTitle}
          onClick={onOpenNotifications}
        >
          <Bell size={13} />{unreadNotifications > 0 && <span>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
        </button>
      </div>
    </footer>
  )
}

export default StatusBar
