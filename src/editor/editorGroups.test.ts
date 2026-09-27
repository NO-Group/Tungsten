import { describe, expect, it } from 'vitest'
import {
  MAX_GROUPS,
  activeEditor,
  activeGroup,
  closeEditor,
  closeOthers,
  closeToTheRight,
  createLayout,
  cycleEditorInGroup,
  focusGroup,
  focusGroupByOffset,
  joinGroups,
  moveEditor,
  moveEditorWithinGroup,
  openEditor,
  openPaths,
  revealPath,
  setActiveEditor,
  setGroupEditors,
  splitGroup,
  togglePinned,
} from './editorGroups'

describe('editor groups', () => {
  it('starts with a single group', () => {
    const layout = createLayout(['a.ts'])
    expect(layout.groups).toHaveLength(1)
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('opens editors and makes them active', () => {
    let layout = createLayout()
    layout = openEditor(layout, 'a.ts')
    layout = openEditor(layout, 'b.ts')
    expect(activeGroup(layout).editors).toHaveLength(2)
    expect(activeEditor(layout)?.path).toBe('b.ts')
  })

  it('activates an already-open editor instead of duplicating it', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = openEditor(layout, 'a.ts')
    expect(activeGroup(layout).editors).toHaveLength(2)
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('reuses the preview slot so single-clicks do not pile up tabs', () => {
    let layout = createLayout()
    layout = openEditor(layout, 'a.ts', { preview: true })
    layout = openEditor(layout, 'b.ts', { preview: true })
    expect(activeGroup(layout).editors.map((editor) => editor.path)).toEqual(['b.ts'])
  })

  it('promotes a preview editor when it is opened again for real', () => {
    let layout = createLayout()
    layout = openEditor(layout, 'a.ts', { preview: true })
    layout = openEditor(layout, 'a.ts')
    expect(activeGroup(layout).editors[0].preview).toBe(false)
    // Now a new preview open adds a tab rather than replacing it.
    layout = openEditor(layout, 'b.ts', { preview: true })
    expect(activeGroup(layout).editors).toHaveLength(2)
  })

  it('closes an editor and activates its neighbour', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = setActiveEditor(layout, 1, 2)
    layout = closeEditor(layout, 'c.ts')
    expect(activeEditor(layout)?.path).toBe('b.ts')
  })

  it('keeps the active editor stable when closing one before it', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = setActiveEditor(layout, 1, 2)
    layout = closeEditor(layout, 'a.ts')
    expect(activeEditor(layout)?.path).toBe('c.ts')
  })

  it('leaves an empty last group rather than deleting everything', () => {
    let layout = createLayout(['a.ts'])
    layout = closeEditor(layout, 'a.ts')
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0].editors).toHaveLength(0)
  })
})

describe('splitting', () => {
  it('splits the active editor into a new group', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right')
    expect(layout.groups).toHaveLength(2)
    expect(layout.orientation).toBe('horizontal')
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('sets a vertical orientation when splitting down', () => {
    const layout = splitGroup(createLayout(['a.ts']), 'down')
    expect(layout.orientation).toBe('vertical')
  })

  it('places the new group before the source when splitting left', () => {
    const layout = splitGroup(createLayout(['a.ts']), 'left')
    expect(layout.groups[0].id).toBe(layout.activeGroupId)
  })

  it('halves the source size and keeps sizes summing to one', () => {
    const layout = splitGroup(createLayout(['a.ts']), 'right')
    const total = layout.groups.reduce((sum, group) => sum + group.size, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('refuses to split past the group limit', () => {
    let layout = createLayout(['a.ts'])
    for (let i = 0; i < 10; i += 1) layout = splitGroup(layout, 'right')
    expect(layout.groups.length).toBe(MAX_GROUPS)
  })

  it('does nothing when there is no editor to split', () => {
    const layout = splitGroup(createLayout(), 'right')
    expect(layout.groups).toHaveLength(1)
  })

  it('collapses a group when its last editor is closed', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right')
    expect(layout.groups).toHaveLength(2)
    layout = closeEditor(layout, 'a.ts', layout.activeGroupId)
    expect(layout.groups).toHaveLength(1)
  })

  it('joins every group back into one without duplicating editors', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = splitGroup(layout, 'right')
    layout = openEditor(layout, 'c.ts')
    layout = joinGroups(layout)
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })
})

describe('moving editors', () => {
  it('moves an editor to another group', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = splitGroup(layout, 'right')
    const [first, second] = layout.groups
    layout = moveEditor(layout, 'a.ts', first.id, second.id)
    expect(layout.groups.find((group) => group.id === second.id)?.editors.map((e) => e.path)).toContain('a.ts')
  })

  it('collapses the source group when its last editor is dragged away', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right')
    const [first, second] = layout.groups
    // The source group holds only `a.ts`; moving it out empties the group.
    layout = moveEditor(layout, 'a.ts', first.id, second.id)
    expect(layout.groups).toHaveLength(1)
  })

  it('reorders tabs within a group', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = moveEditorWithinGroup(layout, 1, 0, 2)
    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['b.ts', 'c.ts', 'a.ts'])
  })

  it('keeps the moved tab active after reordering', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = moveEditorWithinGroup(layout, 1, 0, 2)
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('ignores a move of an editor that is not there', () => {
    const layout = createLayout(['a.ts'])
    expect(moveEditor(layout, 'missing.ts', 1, 1)).toBe(layout)
  })
})

describe('group focus and tab cycling', () => {
  it('focuses a group by id', () => {
    let layout = splitGroup(createLayout(['a.ts']), 'right')
    layout = focusGroup(layout, layout.groups[0].id)
    expect(layout.activeGroupId).toBe(layout.groups[0].id)
  })

  it('ignores a focus request for a group that does not exist', () => {
    const layout = createLayout(['a.ts'])
    expect(focusGroup(layout, 99)).toBe(layout)
  })

  it('cycles focus between groups and wraps', () => {
    let layout = splitGroup(createLayout(['a.ts']), 'right')
    const ids = layout.groups.map((group) => group.id)
    layout = focusGroup(layout, ids[0])
    layout = focusGroupByOffset(layout, 1)
    expect(layout.activeGroupId).toBe(ids[1])
    layout = focusGroupByOffset(layout, 1)
    expect(layout.activeGroupId).toBe(ids[0])
  })

  it('cycles tabs within the active group and wraps', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = setActiveEditor(layout, 1, 0)
    layout = cycleEditorInGroup(layout, 1)
    expect(activeEditor(layout)?.path).toBe('b.ts')
    layout = cycleEditorInGroup(layout, 1)
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('cycles backwards', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = setActiveEditor(layout, 1, 0)
    layout = cycleEditorInGroup(layout, -1)
    expect(activeEditor(layout)?.path).toBe('b.ts')
  })
})

describe('tab actions', () => {
  it('closes others but keeps pinned tabs', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = togglePinned(layout, 'c.ts')
    layout = closeOthers(layout, 'a.ts')
    expect(layout.groups[0].editors.map((editor) => editor.path).sort()).toEqual(['a.ts', 'c.ts'])
  })

  it('closes tabs to the right', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = closeToTheRight(layout, 'a.ts')
    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['a.ts'])
  })

  it('keeps a pinned tab even when it is to the right', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = togglePinned(layout, 'c.ts')
    layout = closeToTheRight(layout, 'a.ts')
    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['a.ts', 'c.ts'])
  })

  it('pinning clears preview state', () => {
    let layout = createLayout()
    layout = openEditor(layout, 'a.ts', { preview: true })
    layout = togglePinned(layout, 'a.ts')
    expect(layout.groups[0].editors[0].preview).toBe(false)
    expect(layout.groups[0].editors[0].pinned).toBe(true)
  })

  it('lists every distinct open path across groups', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right')
    layout = openEditor(layout, 'b.ts')
    expect(openPaths(layout).sort()).toEqual(['a.ts', 'b.ts'])
  })
})

describe('setGroupEditors', () => {
  it('replaces a group\'s tabs while preserving pinned and preview flags', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = togglePinned(layout, 'b.ts')
    layout = setGroupEditors(layout, 1, ['c.ts', 'b.ts'])

    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['c.ts', 'b.ts'])
    expect(layout.groups[0].editors.find((editor) => editor.path === 'b.ts')?.pinned).toBe(true)
  })

  it('keeps the active editor active when it survives', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = setActiveEditor(layout, 1, 1) // b.ts
    layout = setGroupEditors(layout, 1, ['c.ts', 'b.ts', 'a.ts'])
    expect(activeEditor(layout)?.path).toBe('b.ts')
  })

  it('clamps the active index when the active editor is removed', () => {
    let layout = createLayout(['a.ts', 'b.ts', 'c.ts'])
    layout = setActiveEditor(layout, 1, 2) // c.ts
    layout = setGroupEditors(layout, 1, ['a.ts'])
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })

  it('drops duplicate paths', () => {
    const layout = setGroupEditors(createLayout(['a.ts']), 1, ['a.ts', 'b.ts', 'a.ts'])
    expect(layout.groups[0].editors.map((editor) => editor.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('collapses an emptied group into its sibling', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right', 'b.ts')
    expect(layout.groups).toHaveLength(2)

    const emptied = setGroupEditors(layout, layout.activeGroupId, [])
    expect(emptied.groups).toHaveLength(1)
    expect(emptied.groups[0].editors.map((editor) => editor.path)).toEqual(['a.ts'])
  })

  it('never deletes the last group, even when emptied', () => {
    const layout = setGroupEditors(createLayout(['a.ts', 'b.ts']), 1, [])
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0].editors).toEqual([])
    expect(activeEditor(layout)).toBeUndefined()
  })

  it('renormalises sizes after collapsing', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right', 'b.ts')
    layout = splitGroup(layout, 'right', 'c.ts')
    const collapsed = setGroupEditors(layout, layout.activeGroupId, [])
    const total = collapsed.groups.reduce((sum, group) => sum + group.size, 0)
    expect(total).toBeCloseTo(1)
  })
})

describe('revealPath', () => {
  it('focuses an existing editor rather than opening a second copy', () => {
    let layout = createLayout(['a.ts'])
    layout = splitGroup(layout, 'right', 'b.ts')
    const rightGroupId = layout.activeGroupId

    layout = revealPath(layout, 'a.ts')
    expect(layout.activeGroupId).not.toBe(rightGroupId)
    expect(activeEditor(layout)?.path).toBe('a.ts')
    expect(openPaths(layout)).toEqual(['a.ts', 'b.ts'])
  })

  it('prefers the active group when the path is open in more than one', () => {
    let layout = createLayout(['shared.ts'])
    layout = splitGroup(layout, 'right', 'shared.ts')
    const rightGroupId = layout.activeGroupId

    layout = revealPath(layout, 'shared.ts')
    expect(layout.activeGroupId).toBe(rightGroupId)
  })

  it('opens the path in the active group when it is nowhere', () => {
    const layout = revealPath(createLayout(['a.ts']), 'new.ts')
    expect(activeEditor(layout)?.path).toBe('new.ts')
    expect(openPaths(layout)).toEqual(['a.ts', 'new.ts'])
  })

  it('clears the selection without closing anything when given an empty path', () => {
    let layout = createLayout(['a.ts', 'b.ts'])
    layout = revealPath(layout, '')
    expect(activeEditor(layout)).toBeUndefined()
    expect(openPaths(layout)).toEqual(['a.ts', 'b.ts'])
  })

  it('can restore a selection after clearing it', () => {
    let layout = revealPath(createLayout(['a.ts', 'b.ts']), '')
    layout = revealPath(layout, 'a.ts')
    expect(activeEditor(layout)?.path).toBe('a.ts')
  })
})
