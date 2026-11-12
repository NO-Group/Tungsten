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

/** Sentinel for "the narrow-window sheet is open", distinct from any menu name. */
export const MOBILE_MENU = '\u0000mobile'

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
  /** Opens the editor assistant. The button used to be an icon with no handler. */
  onOpenAssistant: () => void
  assistantOpen: boolean
}

export function TitleBar({
  title, menus, openMenu, onOpenMenuChange, onOpenCommandCentre, collaborationActive,
  participantCount, onOpenCollaboration, sidebarVisible, onToggleSidebar, panelOpen,
  onTogglePanel, sidePreview, onToggleSidePreview, onOpenAssistant, assistantOpen,
}: TitleBarProps) {
  // Below 820px the menu bar is hidden by the stylesheet, so the
  // hamburger cannot just open one menu inside it -- it has to carry
  // the whole bar. `MOBILE` is that state; it is never one of the real
  // menu names, so the two cannot collide.
  const mobileOpen = openMenu === MOBILE_MENU
  return (
    <header className="titlebar">
      <div className="brand-mark" title="Tungsten"><Hammer size={15} strokeWidth={2.4} /></div>
      {/*
        The narrow-window menu. It opens the same first menu the wide
        layout shows, because the alternative -- a button that is only
        visible below 900px and does nothing when pressed -- is the
        worst of both.
      */}
      <button
        className="menu-mobile"
        aria-label="Application menu"
        aria-expanded={mobileOpen}
        onClick={() => onOpenMenuChange(mobileOpen ? null : MOBILE_MENU)}
      ><Menu size={15} /></button>

      {mobileOpen && (
        <div className="menu-sheet" role="menu" aria-label="Application menu" onClick={(event) => event.stopPropagation()}>
          {menus.map((menu) => (
            <section key={menu.name}>
              <h4>{menu.name}</h4>
              {menu.entries.map((entry) => (
                <button
                  key={entry.id}
                  role="menuitem"
                  className={entry.enabled ? '' : 'disabled'}
                  disabled={!entry.enabled}
                  title={entry.detail}
                  onClick={() => { onOpenMenuChange(null); entry.run() }}
                >
                  <span>{entry.label}</span>
                  <kbd>{entry.shortcut}</kbd>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

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
        <TipButton
          label={assistantOpen ? 'Close the assistant' : 'Tungsten Copilot — ask about the selection'}
          active={assistantOpen}
          onClick={onOpenAssistant}
        ><Bot size={15} /></TipButton>
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
