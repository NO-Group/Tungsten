import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

type CommandRequest = { id: number; command: string } | null
type SearchRequest = { id: number; query: string } | null

export default function DesktopTerminal({ sessionKey, command, profile, searchRequest }: { sessionKey: number; command: CommandRequest; profile?: { kind: 'wsl' | 'container'; id: string }; searchRequest?: SearchRequest }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !window.tungsten) return
    const api = window.tungsten
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: false,
      convertEol: true,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 11,
      fontWeight: '400',
      lineHeight: 1.3,
      letterSpacing: 0,
      scrollback: 8000,
      theme: {
        background: '#0e100e',
        foreground: '#c8cdc8',
        cursor: '#c8f169',
        cursorAccent: '#111311',
        selectionBackground: '#4b5d3277',
        black: '#171a17',
        red: '#d66f69',
        green: '#9bc45f',
        yellow: '#d4ab61',
        blue: '#75a8d8',
        magenta: '#b08bd0',
        cyan: '#69bec1',
        white: '#d9ddd9',
        brightBlack: '#6c746d',
        brightRed: '#ed817a',
        brightGreen: '#b5df76',
        brightYellow: '#e5c17b',
        brightBlue: '#8dbbea',
        brightMagenta: '#c6a2e2',
        brightCyan: '#86d6d8',
        brightWhite: '#f4f6f4',
      },
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
  }, [profile, sessionKey])

  useEffect(() => {
    if (!ready || !command || !sessionRef.current || !window.tungsten) return
    void window.tungsten.writeTerminal(sessionRef.current, `${command.command}\r`)
    terminalRef.current?.focus()
  }, [command, ready])

  useEffect(() => {
    if (!searchRequest?.query) return
    searchAddonRef.current?.findNext(searchRequest.query, { caseSensitive: false, incremental: false, decorations: { matchBackground: '#687c3b', activeMatchBackground: '#d2ff72', matchOverviewRuler: '#687c3b', activeMatchColorOverviewRuler: '#d2ff72' } })
  }, [searchRequest])

  return <div className="desktop-terminal" ref={containerRef} onClick={() => terminalRef.current?.focus()} />
}
