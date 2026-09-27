/**
 * The bottom panel's header: the tab strip and the terminal controls.
 *
 * The terminal actions stay visible on every tab, matching VS Code, so
 * starting a shell never costs a detour through the terminal tab first.
 */

import { ChevronDown, Columns2, Maximize2, Plus, Search, TerminalSquare, Trash2, X } from 'lucide-react'
import { TipButton } from '../TipButton'

const panelTabs = ['PROBLEMS', 'OUTPUT', 'DEBUG CONSOLE', 'TERMINAL'] as const

export type PanelTab = typeof panelTabs[number]

export type PanelHeaderProps = {
  activeTab: string
  onSelectTab: (tab: string) => void
  problemCount: number
  /** What backs the terminal here: a real pty, or the emulated shell. */
  terminalKind: 'pty' | 'sandbox'
  onNewTerminal: () => void
  splitActive: boolean
  onToggleSplit: () => void
  searchActive: boolean
  onToggleSearch: () => void
  onRestartTerminal: () => void
  onMaximize: () => void
  onClose: () => void
}

export function PanelHeader({
  activeTab, onSelectTab, problemCount, terminalKind, onNewTerminal, splitActive,
  onToggleSplit, searchActive, onToggleSearch, onRestartTerminal, onMaximize, onClose,
}: PanelHeaderProps) {
  return (
    <header className="panel-header">
      <nav>
        {panelTabs.map((tab) => (
          <button key={tab} className={tab === activeTab ? 'active' : ''} onClick={() => onSelectTab(tab)}>
            {tab}
            {tab === 'PROBLEMS' && <span className="tab-count">{problemCount}</span>}
          </button>
        ))}
      </nav>

      <div>
        <span className="terminal-name"><TerminalSquare size={13} /> {terminalKind} <ChevronDown size={11} /></span>
        <TipButton label="New terminal" onClick={onNewTerminal}><Plus size={14} /></TipButton>
        <TipButton label="Split terminal" active={splitActive} onClick={onToggleSplit}><Columns2 size={13} /></TipButton>
        <TipButton label="Find in terminal" active={searchActive} onClick={onToggleSearch}><Search size={13} /></TipButton>
        <TipButton label="Restart terminal" onClick={onRestartTerminal}><Trash2 size={13} /></TipButton>
        <TipButton label="Maximize panel" onClick={onMaximize}><Maximize2 size={13} /></TipButton>
        <TipButton label="Close panel" onClick={onClose}><X size={14} /></TipButton>
      </div>
    </header>
  )
}

export default PanelHeader
