/**
 * The shape of the workbench: which view is showing, how wide the side bar
 * is, how tall the panel is, and which of those survive a restart.
 *
 * Sizes are clamped on the way in as well as on the way out. A layout read
 * back from storage has been through a different window on a different
 * screen -- and can have been hand-edited -- so a panel taller than the
 * window or a side bar wider than the editor is a state the workbench must
 * never be able to restore into.
 */

export const WORKBENCH_LAYOUT_KEY = 'tungsten.workbench.v2'

/** The six things the activity bar can show. */
export type Activity = 'explorer' | 'search' | 'source' | 'debug' | 'tests' | 'extensions' | 'builder'

export type PersistedLayout = {
  sidebarVisible: boolean
  sidebarWidth: number
  panelOpen: boolean
  panelHeight: number
}

export const DEFAULT_LAYOUT: PersistedLayout = {
  sidebarVisible: true,
  sidebarWidth: 248,
  panelOpen: true,
  panelHeight: 225,
}

/** Narrower than this and the file tree is unreadable; wider and it crowds the editor. */
export const MIN_SIDEBAR_WIDTH = 190
export const MAX_SIDEBAR_WIDTH = 420
/** Shorter than this and the terminal cannot show a prompt and its output. */
export const MIN_PANEL_HEIGHT = 120
/** The editor always keeps at least a third of the window. */
export const MAX_PANEL_FRACTION = 0.65

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_LAYOUT.sidebarWidth
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)))
}

export function clampPanelHeight(height: number, viewportHeight: number): number {
  if (!Number.isFinite(height)) return DEFAULT_LAYOUT.panelHeight
  const ceiling = Math.max(MIN_PANEL_HEIGHT, Math.round(viewportHeight * MAX_PANEL_FRACTION))
  return Math.max(MIN_PANEL_HEIGHT, Math.min(ceiling, Math.round(height)))
}

/**
 * Reads a stored layout, falling back field by field.
 *
 * Anything unparseable, missing or out of range is replaced rather than
 * rejected, so a corrupt entry costs the user their layout and nothing else.
 */
export function parseWorkbenchLayout(raw: string | null, viewportHeight = 900): PersistedLayout {
  let stored: Partial<PersistedLayout> = {}
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object') stored = parsed as Partial<PersistedLayout>
  } catch {
    stored = {}
  }
  return {
    sidebarVisible: typeof stored.sidebarVisible === 'boolean' ? stored.sidebarVisible : DEFAULT_LAYOUT.sidebarVisible,
    panelOpen: typeof stored.panelOpen === 'boolean' ? stored.panelOpen : DEFAULT_LAYOUT.panelOpen,
    sidebarWidth: typeof stored.sidebarWidth === 'number'
      ? clampSidebarWidth(stored.sidebarWidth)
      : DEFAULT_LAYOUT.sidebarWidth,
    panelHeight: typeof stored.panelHeight === 'number'
      ? clampPanelHeight(stored.panelHeight, viewportHeight)
      : DEFAULT_LAYOUT.panelHeight,
  }
}

export function serializeWorkbenchLayout(layout: PersistedLayout): string {
  return JSON.stringify({
    sidebarVisible: layout.sidebarVisible,
    sidebarWidth: layout.sidebarWidth,
    panelOpen: layout.panelOpen,
    panelHeight: layout.panelHeight,
  })
}

/**
 * Clicking the activity that is already showing hides the side bar; clicking
 * any other one shows it. This is how VS Code's activity bar behaves.
 */
export function activityBarClick(
  current: Activity,
  clicked: Activity,
  sidebarVisible: boolean,
): { activity: Activity; sidebarVisible: boolean } {
  if (clicked !== current) return { activity: clicked, sidebarVisible: true }
  return { activity: current, sidebarVisible: !sidebarVisible }
}
