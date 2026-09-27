/**
 * The title bar: application menus, the command centre, and the layout
 * toggles.
 *
 * The menus arrive already resolved -- label, keystroke and enabled state
 * worked out by the workbench from the command table and the current context
 * -- so this file contains no knowledge of what any command does.
 */

import { Bot, Columns2, Hammer, Menu, PanelBottomClose, PanelLeftClose, Search, UsersRound } from 'lucide-react'
import { TipButton } from './TipButton'

export type MenuEntry = {
  id: string
  label: string
  /** Rendered keystroke, empty when the command has no binding. */
  shortcut: string
  detail?: string
  /** False when the command's when-clause does not hold right now. */
  enabled: boolean
  /** Draw a separator above this entry. */
  divider?: boolean
  run: () => void
}

export type Menu = { name: string; entries: MenuEntry[] }

export type TitleBarProps = {
  title: string
  menus: Menu[]
  /** Name of the open menu, or null. Owned by the workbench so Escape can close it. */
  openMenu: string | null
  onOpenMenuChange: (name: string | null) => void
  onOpenCommandCentre: () => void
  collaborationActive: boolean
  participantCount: number
  onOpenCollaboration: () => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  sidePreview: boolean
  onToggleSidePreview: () => void
}

export function TitleBar({
  title, menus, openMenu, onOpenMenuChange, onOpenCommandCentre, collaborationActive,
  participantCount, onOpenCollaboration, sidebarVisible, onToggleSidebar, panelOpen,
  onTogglePanel, sidePreview, onToggleSidePreview,
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="brand-mark" title="Tungsten"><Hammer size={15} strokeWidth={2.4} /></div>
      <button className="menu-mobile" aria-label="Application menu"><Menu size={15} /></button>

      <nav className="app-menu" aria-label="Application menu">
        {menus.map((menu) => (
          <div className="menu-wrap" key={menu.name}>
            <button
              aria-expanded={openMenu === menu.name}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation()
                onOpenMenuChange(openMenu === menu.name ? null : menu.name)
              }}
              // Dragging across an open menu bar switches menus, the way every
              // desktop menu behaves.
              onMouseEnter={() => { if (openMenu) onOpenMenuChange(menu.name) }}
            >{menu.name}</button>

            {openMenu === menu.name && (
              <div className="menu-dropdown" role="menu" onClick={(event) => event.stopPropagation()}>
                {menu.entries.map((entry, index) => (
                  <button
                    key={entry.id}
                    role="menuitem"
                    className={`${entry.divider && index ? 'with-divider' : ''} ${entry.enabled ? '' : 'disabled'}`}
                    disabled={!entry.enabled}
                    title={entry.detail}
                    onClick={() => { onOpenMenuChange(null); entry.run() }}
                  >
                    <span>{entry.label}</span>
                    <kbd>{entry.shortcut}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <button className="command-center" onClick={onOpenCommandCentre}>
        <Search size={12} /><span>{title}</span><kbd>⌘ K</kbd>
      </button>

      <div className="title-actions">
        <TipButton
          label={collaborationActive ? `${participantCount} collaborators connected` : 'Live collaboration'}
          active={collaborationActive}
          onClick={onOpenCollaboration}
        ><UsersRound size={15} /></TipButton>
        <TipButton label="Tungsten Copilot"><Bot size={15} /></TipButton>
        <TipButton
          label={sidebarVisible ? 'Hide primary sidebar' : 'Show primary sidebar'}
          active={sidebarVisible}
          onClick={onToggleSidebar}
        ><PanelLeftClose size={15} /></TipButton>
        <TipButton label={panelOpen ? 'Hide panel' : 'Show panel'} active={panelOpen} onClick={onTogglePanel}>
          <PanelBottomClose size={15} />
        </TipButton>
        <TipButton label="Toggle side preview" active={sidePreview} onClick={onToggleSidePreview}>
          <Columns2 size={15} />
        </TipButton>
      </div>
    </header>
  )
}

export default TitleBar
