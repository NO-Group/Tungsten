/**
 * Editor group model, following VS Code's editor group service.
 *
 * Tungsten previously had a single editor plus an optional "side preview".
 * This replaces that with a real group tree: groups can be split horizontally
 * or vertically, each holds an ordered list of open editors with its own
 * active editor and preview slot, and closing the last editor in a group
 * collapses it back into its sibling.
 */

export type GroupDirection = 'right' | 'down' | 'left' | 'up'
export type GroupOrientation = 'horizontal' | 'vertical'

export interface EditorInput {
  /** Workspace-relative path, or a virtual path such as `.tungsten/diffs/x.diff`. */
  path: string
  /** Preview editors are replaced by the next single-click open, as in VS Code. */
  preview?: boolean
  /** Whether the editor is pinned; pinned editors survive "close others". */
  pinned?: boolean
}

export interface EditorGroup {
  id: number
  editors: EditorInput[]
  activeIndex: number
  /** Relative size within the parent split, as a fraction of 1. */
  size: number
}

export interface EditorGroupLayout {
  groups: EditorGroup[]
  activeGroupId: number
  orientation: GroupOrientation
}

export const MAX_GROUPS = 4

export function createLayout(paths: string[] = []): EditorGroupLayout {
  return {
    groups: [{ id: 1, editors: paths.map((path) => ({ path })), activeIndex: Math.max(0, paths.length - 1), size: 1 }],
    activeGroupId: 1,
    orientation: 'horizontal',
  }
}

export function activeGroup(layout: EditorGroupLayout): EditorGroup {
  return layout.groups.find((group) => group.id === layout.activeGroupId) ?? layout.groups[0]
}

export function activeEditor(layout: EditorGroupLayout): EditorInput | undefined {
  const group = activeGroup(layout)
  return group?.editors[group.activeIndex]
}

export function groupById(layout: EditorGroupLayout, id: number): EditorGroup | undefined {
  return layout.groups.find((group) => group.id === id)
}

/** Every distinct path open anywhere in the layout. */
export function openPaths(layout: EditorGroupLayout): string[] {
  return [...new Set(layout.groups.flatMap((group) => group.editors.map((editor) => editor.path)))]
}

function normalizeSizes(groups: EditorGroup[]): EditorGroup[] {
  const total = groups.reduce((sum, group) => sum + group.size, 0)
  if (total <= 0) return groups.map((group) => ({ ...group, size: 1 / groups.length }))
  return groups.map((group) => ({ ...group, size: group.size / total }))
}

/**
 * Opens a path in a group.
 *
 * A preview editor is reused, mirroring VS Code: single-clicking file after
 * file in the explorer replaces one tab instead of piling up tabs.
 */
export function openEditor(
  layout: EditorGroupLayout,
  path: string,
  options: { groupId?: number; preview?: boolean; pinned?: boolean } = {},
): EditorGroupLayout {
  const targetId = options.groupId ?? layout.activeGroupId
  const groups = layout.groups.map((group) => {
    if (group.id !== targetId) return group

    const existing = group.editors.findIndex((editor) => editor.path === path)
    if (existing >= 0) {
      // Re-opening an existing editor promotes it out of preview.
      const editors = group.editors.map((editor, index) => (
        index === existing ? { ...editor, preview: options.preview === true ? editor.preview : false } : editor
      ))
      return { ...group, editors, activeIndex: existing }
    }

    const previewIndex = group.editors.findIndex((editor) => editor.preview)
    const next: EditorInput = { path, preview: options.preview ?? false, pinned: options.pinned }
    if (options.preview && previewIndex >= 0) {
      const editors = group.editors.slice()
      editors[previewIndex] = next
      return { ...group, editors, activeIndex: previewIndex }
    }

    return { ...group, editors: [...group.editors, next], activeIndex: group.editors.length }
  })

  return { ...layout, groups, activeGroupId: targetId }
}

/** Closes one editor, collapsing the group if it becomes empty. */
export function closeEditor(layout: EditorGroupLayout, path: string, groupId?: number): EditorGroupLayout {
  const targetId = groupId ?? layout.activeGroupId
  let groups = layout.groups.map((group) => {
    if (group.id !== targetId) return group
    const index = group.editors.findIndex((editor) => editor.path === path)
    if (index < 0) return group
    const editors = group.editors.filter((_, i) => i !== index)
    // Keep the neighbouring tab active, the way VS Code does.
    const activeIndex = Math.max(0, Math.min(group.activeIndex > index ? group.activeIndex - 1 : group.activeIndex, editors.length - 1))
    return { ...group, editors, activeIndex }
  })

  const emptied = groups.find((group) => group.id === targetId && group.editors.length === 0)
  let activeGroupId = layout.activeGroupId
  if (emptied && groups.length > 1) {
    groups = normalizeSizes(groups.filter((group) => group.id !== targetId))
    if (activeGroupId === targetId) activeGroupId = groups[0].id
  }

  return { ...layout, groups, activeGroupId }
}

/** Closes every editor in a group except the pinned ones and, optionally, one to keep. */
export function closeOthers(layout: EditorGroupLayout, keepPath: string, groupId?: number): EditorGroupLayout {
  const targetId = groupId ?? layout.activeGroupId
  const groups = layout.groups.map((group) => {
    if (group.id !== targetId) return group
    const editors = group.editors.filter((editor) => editor.path === keepPath || editor.pinned)
    const activeIndex = Math.max(0, editors.findIndex((editor) => editor.path === keepPath))
    return { ...group, editors, activeIndex }
  })
  return { ...layout, groups }
}

/** Closes the editors to the right of a path, as in the tab context menu. */
export function closeToTheRight(layout: EditorGroupLayout, path: string, groupId?: number): EditorGroupLayout {
  const targetId = groupId ?? layout.activeGroupId
  const groups = layout.groups.map((group) => {
    if (group.id !== targetId) return group
    const index = group.editors.findIndex((editor) => editor.path === path)
    if (index < 0) return group
    const editors = group.editors.filter((editor, i) => i <= index || editor.pinned)
    return { ...group, editors, activeIndex: Math.min(group.activeIndex, editors.length - 1) }
  })
  return { ...layout, groups }
}

/** Splits the active group, moving the given path into the new group. */
export function splitGroup(
  layout: EditorGroupLayout,
  direction: GroupDirection = 'right',
  path?: string,
): EditorGroupLayout {
  if (layout.groups.length >= MAX_GROUPS) return layout

  const source = activeGroup(layout)
  const movePath = path ?? source?.editors[source.activeIndex]?.path
  if (!movePath) return layout

  const id = Math.max(0, ...layout.groups.map((group) => group.id)) + 1
  const orientation: GroupOrientation = direction === 'right' || direction === 'left' ? 'horizontal' : 'vertical'
  const newGroup: EditorGroup = { id, editors: [{ path: movePath }], activeIndex: 0, size: source.size / 2 }

  const groups: EditorGroup[] = []
  for (const group of layout.groups) {
    if (group.id !== source.id) {
      groups.push(group)
      continue
    }
    const shrunk = { ...group, size: group.size / 2 }
    // `left` and `up` place the new group before the source.
    if (direction === 'left' || direction === 'up') groups.push(newGroup, shrunk)
    else groups.push(shrunk, newGroup)
  }

  return { groups: normalizeSizes(groups), activeGroupId: id, orientation }
}

/** Moves an editor between groups, e.g. by dragging a tab. */
export function moveEditor(
  layout: EditorGroupLayout,
  path: string,
  fromGroupId: number,
  toGroupId: number,
  toIndex?: number,
): EditorGroupLayout {
  if (fromGroupId === toGroupId && toIndex === undefined) return layout
  const from = groupById(layout, fromGroupId)
  const editor = from?.editors.find((item) => item.path === path)
  if (!from || !editor) return layout

  let groups = layout.groups.map((group) => {
    if (group.id === fromGroupId) {
      const editors = group.editors.filter((item) => item.path !== path)
      return { ...group, editors, activeIndex: Math.max(0, Math.min(group.activeIndex, editors.length - 1)) }
    }
    return group
  })

  groups = groups.map((group) => {
    if (group.id !== toGroupId) return group
    const editors = group.editors.slice()
    const index = toIndex === undefined ? editors.length : Math.max(0, Math.min(toIndex, editors.length))
    editors.splice(index, 0, { ...editor, preview: false })
    return { ...group, editors, activeIndex: index }
  })

  // Dragging the last editor out of a group collapses it.
  const emptied = groups.find((group) => group.id === fromGroupId && group.editors.length === 0)
  let activeGroupId = toGroupId
  if (emptied && groups.length > 1) {
    groups = normalizeSizes(groups.filter((group) => group.id !== fromGroupId))
    activeGroupId = toGroupId
  }

  return { ...layout, groups, activeGroupId }
}

/** Reorders a tab within its own group. */
export function moveEditorWithinGroup(layout: EditorGroupLayout, groupId: number, from: number, to: number): EditorGroupLayout {
  const groups = layout.groups.map((group) => {
    if (group.id !== groupId) return group
    const editors = group.editors.slice()
    if (from < 0 || from >= editors.length) return group
    const [moved] = editors.splice(from, 1)
    editors.splice(Math.max(0, Math.min(to, editors.length)), 0, moved)
    return { ...group, editors, activeIndex: editors.indexOf(moved) }
  })
  return { ...layout, groups }
}

export function focusGroup(layout: EditorGroupLayout, id: number): EditorGroupLayout {
  return groupById(layout, id) ? { ...layout, activeGroupId: id } : layout
}

/** Focuses the next or previous group, wrapping around. */
export function focusGroupByOffset(layout: EditorGroupLayout, offset: number): EditorGroupLayout {
  const index = layout.groups.findIndex((group) => group.id === layout.activeGroupId)
  if (index < 0) return layout
  const next = (((index + offset) % layout.groups.length) + layout.groups.length) % layout.groups.length
  return { ...layout, activeGroupId: layout.groups[next].id }
}

/** Activates a tab within the active group, wrapping around. */
export function cycleEditorInGroup(layout: EditorGroupLayout, offset: number): EditorGroupLayout {
  const groups = layout.groups.map((group) => {
    if (group.id !== layout.activeGroupId || group.editors.length === 0) return group
    const next = (((group.activeIndex + offset) % group.editors.length) + group.editors.length) % group.editors.length
    return { ...group, activeIndex: next }
  })
  return { ...layout, groups }
}

export function setActiveEditor(layout: EditorGroupLayout, groupId: number, index: number): EditorGroupLayout {
  const groups = layout.groups.map((group) => (
    group.id === groupId ? { ...group, activeIndex: Math.max(0, Math.min(index, group.editors.length - 1)) } : group
  ))
  return { ...layout, groups, activeGroupId: groupId }
}

/** Pins or unpins a tab. */
export function togglePinned(layout: EditorGroupLayout, path: string, groupId?: number): EditorGroupLayout {
  const targetId = groupId ?? layout.activeGroupId
  const groups = layout.groups.map((group) => {
    if (group.id !== targetId) return group
    return {
      ...group,
      editors: group.editors.map((editor) => (
        editor.path === path ? { ...editor, pinned: !editor.pinned, preview: false } : editor
      )),
    }
  })
  return { ...layout, groups }
}

/** Collapses every group back into one, preserving editor order. */
export function joinGroups(layout: EditorGroupLayout): EditorGroupLayout {
  if (layout.groups.length <= 1) return layout
  const seen = new Set<string>()
  const editors: EditorInput[] = []
  for (const group of layout.groups) {
    for (const editor of group.editors) {
      if (seen.has(editor.path)) continue
      seen.add(editor.path)
      editors.push(editor)
    }
  }
  const active = activeEditor(layout)
  const activeIndex = Math.max(0, editors.findIndex((editor) => editor.path === active?.path))
  return { groups: [{ id: 1, editors, activeIndex, size: 1 }], activeGroupId: 1, orientation: layout.orientation }
}

/**
 * Replaces a group's editor list wholesale, given the paths it should now hold.
 *
 * Existing editors keep their pinned/preview flags and their relative order is
 * taken from `paths`, so this is safe to drive from array-level operations such
 * as "close all" or "keep only the files that still exist on disk". The active
 * editor is preserved when it survives, and clamped into range when it does not.
 */
export function setGroupEditors(layout: EditorGroupLayout, groupId: number, paths: string[]): EditorGroupLayout {
  const unique = [...new Set(paths)]
  let groups = layout.groups.map((group) => {
    if (group.id !== groupId) return group
    const previous = new Map(group.editors.map((editor) => [editor.path, editor]))
    const activePath = group.editors[group.activeIndex]?.path
    const editors = unique.map((path) => previous.get(path) ?? { path })
    const kept = editors.findIndex((editor) => editor.path === activePath)
    const activeIndex = kept >= 0 ? kept : Math.min(group.activeIndex, editors.length - 1)
    return { ...group, editors, activeIndex: Math.max(editors.length === 0 ? -1 : 0, activeIndex) }
  })

  // An emptied group collapses into its sibling, exactly as closeEditor does.
  const emptied = groups.find((group) => group.id === groupId && group.editors.length === 0)
  let activeGroupId = layout.activeGroupId
  if (emptied && groups.length > 1) {
    groups = normalizeSizes(groups.filter((group) => group.id !== groupId))
    if (activeGroupId === groupId) activeGroupId = groups[0].id
  }

  return { ...layout, groups, activeGroupId }
}

/**
 * Focuses `path` wherever it already is, and only opens it if it is nowhere.
 *
 * This is what the explorer, quick open and "go to definition" all want: if a
 * file is already showing in a split, jump to that split rather than opening a
 * second copy beside the first. The active group wins ties so that repeatedly
 * opening the same file does not drag focus across the window.
 *
 * Passing an empty path clears the active group's selection, which is how the
 * welcome screen is shown without closing anything.
 */
export function revealPath(layout: EditorGroupLayout, path: string): EditorGroupLayout {
  if (!path) {
    const groups = layout.groups.map((group) => (
      group.id === layout.activeGroupId ? { ...group, activeIndex: -1 } : group
    ))
    return { ...layout, groups }
  }

  const ordered = [
    ...layout.groups.filter((group) => group.id === layout.activeGroupId),
    ...layout.groups.filter((group) => group.id !== layout.activeGroupId),
  ]
  for (const group of ordered) {
    const index = group.editors.findIndex((editor) => editor.path === path)
    if (index >= 0) return setActiveEditor(layout, group.id, index)
  }
  return openEditor(layout, path)
}
