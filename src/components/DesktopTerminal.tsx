import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import { getTheme, terminalTheme } from '../theme/themeService'
import type { TerminalBackend } from '../terminal/ptyClient'

type CommandRequest = { id: number; command: string } | null
type SearchRequest = { id: number; query: string } | null

/**
 * A terminal attached to a real process.
 *
 * Which process is the caller's decision: Electron's PTY on the desktop, or
 * the dev server's PTY in the browser. Both arrive here as one `backend`, so
 * this component is the same code either way.
 */
export default function DesktopTerminal({ sessionKey, backend, command, profile, searchRequest, themeId, fontSize }: { sessionKey: number; backend: TerminalBackend; command: CommandRequest; profile?: { kind: 'wsl' | 'container'; id: string }; searchRequest?: SearchRequest; themeId?: string; fontSize?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  // Recreating the terminal on every theme change would drop scrollback, so the
  // palette is read once at construction and then patched live in a later effect.
  const initialThemeRef = useRef(themeId)
  const initialFontSizeRef = useRef(fontSize)

  useEffect(() => {
    if (!containerRef.current) return
    const api = backend
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: false,
      convertEol: true,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: initialFontSizeRef.current ?? 12,
      fontWeight: '400',
      lineHeight: 1.3,
      letterSpacing: 0,
      scrollback: 10000,
      theme: terminalTheme(getTheme(initialThemeRef.current || '')),
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    terminal.open(containerRef.current)
    terminalRef.current = terminal

    const fit = () => {
      try {
        fitAddon.fit()
        if (sessionRef.current) void api.resizeTerminal(sessionRef.current, terminal.cols, terminal.rows)
      } catch {
        // A hidden panel cannot be measured until it becomes visible.
      }
    }

    const resizeObserver = new ResizeObserver(fit)
    resizeObserver.observe(containerRef.current)
    const dataSubscription = api.onTerminalData(({ id, data }) => {
      if (id === sessionRef.current) terminal.write(data)
    })
    const exitSubscription = api.onTerminalExit(({ id, code }) => {
      if (id === sessionRef.current) terminal.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`)
    })
    const inputSubscription = terminal.onData((data) => {
      if (sessionRef.current) void api.writeTerminal(sessionRef.current, data)
    })

    requestAnimationFrame(() => {
      fit()
      api.createTerminal(terminal.cols || 80, terminal.rows || 24, profile).then(({ id }) => {
        sessionRef.current = id
        setReady(true)
        terminal.focus()
      }).catch((error: Error) => terminal.writeln(`\x1b[31m${error.message}\x1b[0m`))
    })

    return () => {
      resizeObserver.disconnect()
      dataSubscription()
      exitSubscription()
      inputSubscription.dispose()
      if (sessionRef.current) void api.killTerminal(sessionRef.current)
      terminal.dispose()
      terminalRef.current = null
      searchAddonRef.current = null
      sessionRef.current = null
    }
  }, [backend, profile, sessionKey])

  // Apply theme and font-size changes in place, preserving scrollback and the PTY.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = terminalTheme(getTheme(themeId || ''))
  }, [themeId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !fontSize) return
    terminal.options.fontSize = fontSize
  }, [fontSize])

  useEffect(() => {
    if (!ready || !command || !sessionRef.current) return
    void backend.writeTerminal(sessionRef.current, `${command.command}\r`)
    terminalRef.current?.focus()
  }, [backend, command, ready])

  useEffect(() => {
    if (!searchRequest?.query) return
    const palette = terminalTheme(getTheme(themeId || ''))
    searchAddonRef.current?.findNext(searchRequest.query, {
      caseSensitive: false,
      incremental: false,
      decorations: {
        matchBackground: palette.brightBlack,
        activeMatchBackground: palette.brightYellow,
        matchOverviewRuler: palette.brightBlack,
        activeMatchColorOverviewRuler: palette.brightYellow,
      },
    })
  }, [searchRequest, themeId])

  return <div className="desktop-terminal" ref={containerRef} onClick={() => terminalRef.current?.focus()} />
}
