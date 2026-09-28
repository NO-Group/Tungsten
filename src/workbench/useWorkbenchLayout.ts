/**
 * The workbench's own state: the visible view, the side bar, the panel, and
 * the three modes that strip the chrome back.
 *
 * Only the four things worth remembering across restarts are persisted --
 * the side bar and panel's visibility and size. Zen mode, the centred
 * layout, the hidden activity bar and the live preview pane all start off,
 * because a user who left in one of them still expects the ordinary
 * workbench when they come back.
 */

import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_LAYOUT,
  WORKBENCH_LAYOUT_KEY,
  activityBarClick,
  clampPanelHeight,
  clampSidebarWidth,
  parseWorkbenchLayout,
  serializeWorkbenchLayout,
  type Activity,
} from './workbenchLayout'

/** Maximising the panel leaves the editor a sliver; toggling restores it. */
const MAXIMIZED_FRACTION = 0.62

export function useWorkbenchLayout() {
  const [restored] = useState(() => parseWorkbenchLayout(localStorage.getItem(WORKBENCH_LAYOUT_KEY), window.innerHeight))

  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarVisible, setSidebarVisible] = useState(restored.sidebarVisible)
  const [sidebarWidth, setSidebarWidth] = useState(restored.sidebarWidth)
  const [panelOpen, setPanelOpen] = useState(restored.panelOpen)
  const [panelHeight, setPanelHeight] = useState(restored.panelHeight)
  const [panelTab, setPanelTab] = useState('TERMINAL')
  const [zenMode, setZenMode] = useState(false)
  const [activityBarVisible, setActivityBarVisible] = useState(true)
  const [centeredLayout, setCenteredLayout] = useState(false)
  const [sidePreview, setSidePreview] = useState(false)

  useEffect(() => {
    localStorage.setItem(
      WORKBENCH_LAYOUT_KEY,
      serializeWorkbenchLayout({ sidebarVisible, sidebarWidth, panelOpen, panelHeight }),
    )
  }, [panelHeight, panelOpen, sidebarVisible, sidebarWidth])

  /** Bring a view forward, opening the side bar if it was hidden. */
  const showView = useCallback((next: Activity) => {
    setActivity(next)
    setSidebarVisible(true)
  }, [])

  /** The activity bar's own rule: the active icon toggles, the others switch. */
  const selectActivity = useCallback((clicked: Activity) => {
    const next = activityBarClick(activity, clicked, sidebarVisible)
    setActivity(next.activity)
    setSidebarVisible(next.sidebarVisible)
  }, [activity, sidebarVisible])

  /** Bring a panel tab forward, opening the panel if it was closed. */
  const showPanel = useCallback((tab: string) => {
    setPanelTab(tab)
    setPanelOpen(true)
  }, [])

  const togglePanelMaximized = useCallback(() => {
    setPanelHeight((height) => (height > 400
      ? DEFAULT_LAYOUT.panelHeight
      : clampPanelHeight(window.innerHeight * MAXIMIZED_FRACTION, window.innerHeight)))
  }, [])

  /** Drag the side bar's right edge. */
  const startSidebarResize = useCallback((event: { preventDefault: () => void; clientX: number }) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: MouseEvent) => setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [sidebarWidth])

  /** Drag the panel's top edge. Dragging up makes it taller. */
  const startPanelResize = useCallback((event: { preventDefault: () => void; clientY: number }) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight
    const move = (moveEvent: MouseEvent) => setPanelHeight(
      clampPanelHeight(startHeight + startY - moveEvent.clientY, window.innerHeight),
    )
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [panelHeight])

  return {
    activity, setActivity,
    sidebarVisible, setSidebarVisible,
    sidebarWidth, setSidebarWidth,
    panelOpen, setPanelOpen,
    panelHeight, setPanelHeight,
    panelTab, setPanelTab,
    zenMode, setZenMode,
    activityBarVisible, setActivityBarVisible,
    centeredLayout, setCenteredLayout,
    sidePreview, setSidePreview,
    showView, selectActivity, showPanel, togglePanelMaximized,
    startSidebarResize, startPanelResize,
  }
}
