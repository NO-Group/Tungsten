/**
 * Terminal tabs: the shape of a session, how the strip changes as sessions
 * open and close, and how the layout survives a reload.
 *
 * All pure. The hook in `useTerminalSessions.ts` adds React state and the
 * desktop bridge on top.
 */

export type TerminalProfile = { kind: 'wsl' | 'container'; id: string; label?: string }

export type TerminalTab = {
  id: number
  label: string
  /**
   * Bumped to remount the terminal, which starts a fresh pty. The id stays
   * the same so the tab keeps its place in the strip.
   */
  generation: number
  profile?: Omit<TerminalProfile, 'label'>
}

export type TerminalLayout = { tabs: TerminalTab[]; activeId: number; split: boolean }

export type TerminalLine = { text: string; kind?: string }

/** How many restored tabs are trusted; beyond this the file is nonsense. */
const MAX_RESTORED_TABS = 12

export const DEFAULT_TERMINAL_LAYOUT: TerminalLayout = {
  tabs: [{ id: 1, label: 'shell 1', generation: 0 }], activeId: 1, split: false,
}

/**
 * Restores a saved tab strip.
 *
 * Anything malformed falls back to a single shell rather than throwing: a
 * corrupt layout must never stop the workbench from starting.
 */
export function parseTerminalLayout(raw: string | null): TerminalLayout {
  try {
    const stored = JSON.parse(raw || '{}')
    const tabs: TerminalTab[] = Array.isArray(stored.tabs)
      ? stored.tabs
        .filter((tab: TerminalTab) => Number.isInteger(tab.id) && typeof tab.label === 'string')
        .slice(0, MAX_RESTORED_TABS)
        // Sessions do not survive a reload, so every restored tab starts fresh.
        .map((tab: TerminalTab) => ({ ...tab, generation: 0 }))
      : []
    if (!tabs.length) return DEFAULT_TERMINAL_LAYOUT
    return {
      tabs,
      activeId: tabs.some((tab) => tab.id === stored.activeId) ? stored.activeId : tabs[0].id,
      split: Boolean(stored.split),
    }
  } catch {
    return DEFAULT_TERMINAL_LAYOUT
  }
}

export function serializeTerminalLayout(layout: TerminalLayout): string {
  return JSON.stringify({
    tabs: layout.tabs.map(({ id, label, profile }) => ({ id, label, profile, generation: 0 })),
    activeId: layout.activeId,
    split: layout.split,
  })
}

/** The next tab id, given the ones already restored. */
export function nextTerminalId(tabs: TerminalTab[]): number {
  return Math.max(0, ...tabs.map((tab) => tab.id)) + 1
}

/** The tab `offset` places away from the active one, wrapping at both ends. */
export function terminalAtOffset(tabs: TerminalTab[], activeId: number, offset: number): number | null {
  if (tabs.length < 2) return null
  const index = tabs.findIndex((tab) => tab.id === activeId)
  const next = ((index + offset) % tabs.length + tabs.length) % tabs.length
  return tabs[next].id
}

/**
 * Closes a tab.
 *
 * The panel always has a terminal in it, so closing the last one replaces it
 * with a new shell instead of leaving an empty strip.
 */
export function closeTerminalTab(layout: TerminalLayout, id: number, replacementId: number): TerminalLayout {
  if (layout.tabs.length === 1) {
    return { ...layout, tabs: [{ id: replacementId, label: 'shell 1', generation: 0 }], activeId: replacementId }
  }
  const tabs = layout.tabs.filter((tab) => tab.id !== id)
  return { ...layout, tabs, activeId: layout.activeId === id ? tabs[0].id : layout.activeId }
}

/** Restarting keeps the tab and its place, but starts a new process in it. */
export function restartTerminalTab(tabs: TerminalTab[], id: number): TerminalTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, generation: tab.generation + 1 } : tab))
}

export function createTerminalTab(id: number, profile?: TerminalProfile, label?: string): TerminalTab {
  return {
    id,
    label: label || profile?.label || `shell ${id}`,
    generation: 0,
    profile: profile ? { kind: profile.kind, id: profile.id } : undefined,
  }
}

/**
 * Turns a finished command into console lines.
 *
 * A command that printed nothing still has to say something, or the terminal
 * looks like it ignored the input.
 */
export function commandOutputLines(result: { stdout: string; stderr: string; code: number }): TerminalLine[] {
  const lines: TerminalLine[] = []
  if (result.stdout.trimEnd()) lines.push({ text: result.stdout.trimEnd(), kind: result.code === 0 ? undefined : 'warning' })
  if (result.stderr.trimEnd()) lines.push({ text: result.stderr.trimEnd(), kind: 'error' })
  if (!lines.length) lines.push({ text: `Process exited with code ${result.code}`, kind: result.code === 0 ? 'success' : 'error' })
  return lines
}
