/**
 * The terminal sessions in the bottom panel.
 *
 * Owns the tab strip, the emulated shell's scrollback and input history, the
 * find bar, and the one-shot messages sent into a live pty. The workbench
 * supplies the workspace to run against and a way to bring the panel forward.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { supportedLanguages } from '../workspace'
import { runSandboxCommand, type ShellFile } from './sandboxShell'
import {
  closeTerminalTab, commandOutputLines, createTerminalTab, nextTerminalId, parseTerminalLayout,
  restartTerminalTab, serializeTerminalLayout, terminalAtOffset,
  type TerminalLayout, type TerminalLine, type TerminalProfile,
} from './terminalSessions'

const TERMINAL_LAYOUT_KEY = 'tungsten.terminals.v2'

export type TerminalHost = {
  workspaceRoot: string
  workspaceName: string
  files: ShellFile[]
  dirty: Set<string>
  /** Opens the panel on the terminal tab; every action here implies it. */
  revealTerminal: () => void
}

/** The banner the emulated shell opens with. */
function welcomeLines(): TerminalLine[] {
  return [
    { text: `Tungsten Shell 2.2.0  ·  ${window.tungsten ? 'desktop process runner' : 'web sandbox'}`, kind: 'muted' },
    { text: `${supportedLanguages.length} language grammars loaded. Type “help” for available commands.`, kind: 'success' },
  ]
}

export function useTerminalSessions({ workspaceRoot, workspaceName, files, dirty, revealTerminal }: TerminalHost) {
  const [layout, setLayout] = useState<TerminalLayout>(() => parseTerminalLayout(localStorage.getItem(TERMINAL_LAYOUT_KEY)))
  const nextIdRef = useRef(nextTerminalId(layout.tabs))

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchRequest, setSearchRequest] = useState<{ id: number; query: string } | null>(null)
  const [command, setCommand] = useState<{ id: number; command: string; terminalId?: number } | null>(null)

  const [lines, setLines] = useState<TerminalLine[]>(welcomeLines)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(TERMINAL_LAYOUT_KEY, serializeTerminalLayout(layout))
  }, [layout])

  const claimId = () => nextIdRef.current++

  /** Opens a session and focuses it. Returns the id, for targeted commands. */
  const open = useCallback((profile?: TerminalProfile, label?: string) => {
    const id = claimId()
    setLayout((current) => ({ ...current, tabs: [...current.tabs, createTerminalTab(id, profile, label)], activeId: id }))
    revealTerminal()
    return id
  }, [revealTerminal])

  const close = useCallback((id: number) => setLayout((current) => closeTerminalTab(current, id, claimId())), [])

  const focus = useCallback((id: number) => setLayout((current) => ({ ...current, activeId: id })), [])

  const focusByOffset = useCallback((offset: number) => {
    setLayout((current) => {
      const id = terminalAtOffset(current.tabs, current.activeId, offset)
      return id === null ? current : { ...current, activeId: id }
    })
    revealTerminal()
  }, [revealTerminal])

  /** Restarts the active session: same tab, new process. */
  const restart = useCallback(() => {
    if (!window.tungsten) return setLines([])
    setLayout((current) => ({ ...current, tabs: restartTerminalTab(current.tabs, current.activeId) }))
  }, [])

  const setSplit = useCallback((split: boolean) => setLayout((current) => ({ ...current, split })), [])

  const toggleSplit = useCallback(() => {
    setLayout((current) => {
      // Splitting with one session would show the same terminal twice.
      if (current.tabs.length > 1) return { ...current, split: !current.split }
      const id = claimId()
      return { tabs: [...current.tabs, createTerminalTab(id)], activeId: id, split: !current.split }
    })
  }, [])

  const search = useCallback((query: string) => {
    setSearchQuery(query)
    setSearchRequest((current) => ({ id: (current?.id || 0) + 1, query }))
  }, [])

  /**
   * Runs a command in the panel.
   *
   * On the desktop this is a real child process; in the browser the emulated
   * shell answers from the in-memory workspace.
   */
  const run = useCallback((raw: string) => {
    const entry = raw.trim()
    if (!entry) return
    setHistory((current) => [...current, entry])
    setHistoryIndex(-1)

    if (window.tungsten && workspaceRoot) {
      if (entry === 'clear') return setLines([])
      setLines((current) => [...current, { text: `tungsten@${workspaceName} ~/${workspaceName} $ ${entry}`, kind: 'command' }])
      window.tungsten.runCommand(entry)
        .then((result) => setLines((current) => [...current, ...commandOutputLines(result)]))
        .catch((error: Error) => setLines((current) => [...current, { text: error.message, kind: 'error' }]))
      return
    }

    const result = runSandboxCommand(entry, { workspaceName, files, dirty })
    if (result.clear) setLines([])
    else setLines((current) => [...current, ...result.lines])
  }, [dirty, files, workspaceName, workspaceRoot])

  /**
   * Runs a task command where the user can watch it.
   *
   * A real shell gets its own tab, so a long task does not take over the one
   * being typed in; the browser build has only the emulated shell.
   */
  const runTask = useCallback((entry: string) => {
    revealTerminal()
    if (window.tungsten && workspaceRoot) {
      const terminalId = open(undefined, `task · ${entry.split(/\s+/)[0]}`)
      setCommand((current) => ({ id: (current?.id || 0) + 1, command: entry, terminalId }))
      return
    }
    run(entry)
  }, [open, revealTerminal, run, workspaceRoot])

  const appendLine = useCallback((...added: TerminalLine[]) => setLines((current) => [...current, ...added]), [])

  const focusInput = useCallback(() => {
    // The input only exists once the panel has rendered the terminal tab.
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }, [])

  return {
    tabs: layout.tabs,
    activeId: layout.activeId,
    split: layout.split,
    searchOpen,
    searchQuery,
    searchRequest,
    command,
    lines,
    input,
    history,
    historyIndex,
    inputRef,
    setSearchOpen,
    setSearchQuery,
    setInput,
    setHistoryIndex,
    setLines,
    setSplit,
    appendLine,
    focusInput,
    open,
    close,
    focus,
    focusByOffset,
    restart,
    toggleSplit,
    search,
    run,
    runTask,
  }
}

export type TerminalSessions = ReturnType<typeof useTerminalSessions>
