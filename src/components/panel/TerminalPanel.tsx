/**
 * The Terminal panel.
 *
 * Two very different things share this surface. On the desktop there are real
 * PTYs, rendered by xterm through `DesktopTerminal`, with tabs, profiles,
 * splitting and search. In the browser there is no PTY to attach to, so a
 * small emulated shell stands in -- enough to demonstrate the workbench
 * without pretending to be a terminal.
 *
 * Which one renders is decided by the caller passing `desktop`, rather than
 * this component reaching for `window.tungsten`, so it stays testable.
 */

import { Suspense, lazy } from 'react'
import type React from 'react'
import { Plus, Search, TerminalSquare, X } from 'lucide-react'

import type { TerminalLine, TerminalProfile, TerminalTab } from '../../terminal/terminalSessions'

const DesktopTerminal = lazy(() => import('../DesktopTerminal'))

export type { TerminalLine, TerminalProfile, TerminalTab }

export type RemoteProfiles = {
  wsl: string[]
  containers: Array<{ id: string; name: string; image: string }>
}

export type TerminalPanelProps = {
  /** True when real PTYs are available; false in the browser sandbox. */
  desktop: boolean

  // -- desktop --------------------------------------------------------
  tabs: TerminalTab[]
  activeId: number
  split: boolean
  profiles: RemoteProfiles
  command: { id: number; command: string; terminalId?: number } | null
  searchOpen: boolean
  searchQuery: string
  searchRequest: { id: number; query: string } | null
  themeId: string
  fontSize: number
  onSelectTab: (id: number) => void
  onCloseTab: (id: number) => void
  onNewTerminal: (profile?: TerminalProfile) => void
  onSearchQueryChange: (value: string) => void
  onSearchSubmit: (query: string) => void
  onCloseSearch: () => void
  onFocusChange: (focused: boolean) => void

  // -- browser fallback -----------------------------------------------
  lines: TerminalLine[]
  input: string
  onInputChange: (value: string) => void
  onRun: (command: string) => void
  history: string[]
  historyIndex: number
  onHistoryIndexChange: (index: number) => void
  workspaceName: string
  inputRef: React.RefObject<HTMLInputElement | null>
  endRef: React.RefObject<HTMLDivElement | null>
}

export function TerminalPanel(props: TerminalPanelProps) {
  return props.desktop ? <DesktopTerminals {...props} /> : <SandboxTerminal {...props} />
}

function DesktopTerminals({
  tabs, activeId, split, profiles, command, searchOpen, searchQuery, searchRequest,
  themeId, fontSize, onSelectTab, onCloseTab, onNewTerminal, onSearchQueryChange,
  onSearchSubmit, onCloseSearch, onFocusChange,
}: TerminalPanelProps) {
  // With a split panel the second visible terminal is the first one that is
  // not active, so splitting never shows the same session twice.
  const secondary = tabs.find((terminal) => terminal.id !== activeId)
  const visible = tabs.filter((terminal) => terminal.id === activeId || (split && terminal.id === secondary?.id))

  return (
    <div className="terminal-workspace">
      <div className="terminal-tab-strip">
        {tabs.map((terminal) => (
          <button
            key={terminal.id}
            className={terminal.id === activeId ? 'active' : ''}
            onClick={() => onSelectTab(terminal.id)}
          >
            <TerminalSquare size={11} />
            <span>{terminal.label}</span>
            <X size={10} onClick={(event) => { event.stopPropagation(); onCloseTab(terminal.id) }} />
          </button>
        ))}
        <button className="terminal-add" title="New local terminal" onClick={() => onNewTerminal()}>
          <Plus size={12} />
        </button>
        <select
          title="Terminal profile"
          defaultValue=""
          onChange={(event) => {
            const [kind, id] = event.target.value.split(':')
            if (kind === 'wsl') onNewTerminal({ kind, id, label: `WSL · ${id}` })
            if (kind === 'container') {
              const container = profiles.containers.find((item) => item.id === id)
              onNewTerminal({ kind, id, label: `Docker · ${container?.name || id}` })
            }
            event.target.value = ''
          }}
        >
          <option value="">Profiles…</option>
          {profiles.wsl.map((name) => <option key={`wsl:${name}`} value={`wsl:${name}`}>WSL · {name}</option>)}
          {profiles.containers.map((container) => (
            <option key={`container:${container.id}`} value={`container:${container.id}`}>Docker · {container.name}</option>
          ))}
        </select>
      </div>

      {searchOpen && (
        <form
          className="terminal-search"
          onSubmit={(event) => { event.preventDefault(); if (searchQuery) onSearchSubmit(searchQuery) }}
        >
          <Search size={12} />
          <input autoFocus value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder="Find in terminal" />
          <button type="submit">Next</button>
          <button type="button" onClick={onCloseSearch}><X size={12} /></button>
        </form>
      )}

      <div
        className={`terminal-grid ${split && visible.length > 1 ? 'split' : ''}`}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      >
        {visible.map((terminal) => (
          <div key={`${terminal.id}-${terminal.generation}`} className="terminal-cell">
            <Suspense fallback={<div className="terminal-loading">Starting PTY…</div>}>
              <DesktopTerminal
                sessionKey={terminal.id * 1000 + terminal.generation}
                command={terminal.id === (command?.terminalId || activeId) ? command : null}
                profile={terminal.profile}
                searchRequest={terminal.id === activeId ? searchRequest : null}
                themeId={themeId}
                fontSize={fontSize}
              />
            </Suspense>
          </div>
        ))}
      </div>
    </div>
  )
}

function SandboxTerminal({
  lines, input, onInputChange, onRun, history, historyIndex,
  onHistoryIndexChange, workspaceName, inputRef, endRef,
}: TerminalPanelProps) {
  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-scroll">
        {lines.map((line, index) => (
          <div key={index} className={`terminal-line ${line.kind || ''}`}>{line.text}</div>
        ))}
        <div className="terminal-prompt">
          <span className="prompt-user">tungsten@{workspaceName}</span>
          <span className="prompt-path"> ~/{workspaceName} </span>
          <span>$</span>
          <input
            ref={inputRef}
            value={input}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal input"
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRun(input)
                onInputChange('')
                return
              }
              // Arrow history walks backwards from the most recent entry;
              // index -1 means "the line the user was typing".
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                const next = Math.min(history.length - 1, historyIndex + 1)
                onHistoryIndexChange(next)
                onInputChange(history[history.length - 1 - next] || '')
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                const next = Math.max(-1, historyIndex - 1)
                onHistoryIndexChange(next)
                onInputChange(next === -1 ? '' : history[history.length - 1 - next] || '')
              }
            }}
          />
        </div>
        <div ref={endRef} />
      </div>
    </div>
  )
}

export default TerminalPanel
