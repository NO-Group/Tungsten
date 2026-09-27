import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TERMINAL_LAYOUT, closeTerminalTab, commandOutputLines, createTerminalTab, nextTerminalId,
  parseTerminalLayout, restartTerminalTab, serializeTerminalLayout, terminalAtOffset, type TerminalLayout,
} from './terminalSessions'

const layout: TerminalLayout = {
  tabs: [
    { id: 1, label: 'shell 1', generation: 0 },
    { id: 2, label: 'build', generation: 3 },
    { id: 5, label: 'WSL: Ubuntu', generation: 0, profile: { kind: 'wsl', id: 'Ubuntu' } },
  ],
  activeId: 2,
  split: true,
}

describe('restoring the tab strip', () => {
  it('round-trips a layout, minus the live sessions', () => {
    const restored = parseTerminalLayout(serializeTerminalLayout(layout))
    expect(restored.activeId).toBe(2)
    expect(restored.split).toBe(true)
    expect(restored.tabs.map((tab) => tab.label)).toEqual(['shell 1', 'build', 'WSL: Ubuntu'])
    // Processes do not survive a reload, so no tab claims a running session.
    expect(restored.tabs.every((tab) => tab.generation === 0)).toBe(true)
    expect(restored.tabs[2].profile).toEqual({ kind: 'wsl', id: 'Ubuntu' })
  })

  it('falls back to one shell rather than throwing', () => {
    for (const raw of [null, '', 'not json', '{}', '{"tabs":[]}', '{"tabs":"nope"}']) {
      expect(parseTerminalLayout(raw), JSON.stringify(raw)).toEqual(DEFAULT_TERMINAL_LAYOUT)
    }
  })

  it('drops malformed tabs and caps how many are trusted', () => {
    const raw = JSON.stringify({ tabs: [{ id: 'x', label: 'bad' }, { id: 4, label: 'good' }, { id: 5 }], activeId: 4 })
    expect(parseTerminalLayout(raw).tabs).toEqual([{ id: 4, label: 'good', generation: 0 }])

    const many = JSON.stringify({ tabs: Array.from({ length: 30 }, (_, index) => ({ id: index + 1, label: `shell ${index + 1}` })) })
    expect(parseTerminalLayout(many).tabs).toHaveLength(12)
  })

  it('repairs an active id that no longer exists', () => {
    const raw = JSON.stringify({ tabs: [{ id: 7, label: 'shell 7' }], activeId: 99 })
    expect(parseTerminalLayout(raw).activeId).toBe(7)
  })

  it('never reuses an id that is already on screen', () => {
    expect(nextTerminalId(layout.tabs)).toBe(6)
    expect(nextTerminalId([])).toBe(1)
  })
})

describe('moving between tabs', () => {
  it('wraps in both directions', () => {
    expect(terminalAtOffset(layout.tabs, 2, 1)).toBe(5)
    expect(terminalAtOffset(layout.tabs, 5, 1)).toBe(1)
    expect(terminalAtOffset(layout.tabs, 1, -1)).toBe(5)
  })

  it('does nothing when there is nowhere to go', () => {
    expect(terminalAtOffset([layout.tabs[0]], 1, 1)).toBeNull()
  })
})

describe('opening, closing and restarting', () => {
  it('labels a new tab after its profile, or numbers it', () => {
    expect(createTerminalTab(3)).toEqual({ id: 3, label: 'shell 3', generation: 0, profile: undefined })
    expect(createTerminalTab(4, { kind: 'container', id: 'abc', label: 'api' })).toEqual({
      id: 4, label: 'api', generation: 0, profile: { kind: 'container', id: 'abc' },
    })
    expect(createTerminalTab(5, { kind: 'wsl', id: 'Ubuntu' }, 'task · npm').label).toBe('task · npm')
  })

  it('moves focus off a closed tab', () => {
    const next = closeTerminalTab(layout, 2, 9)
    expect(next.tabs.map((tab) => tab.id)).toEqual([1, 5])
    expect(next.activeId).toBe(1)
  })

  it('leaves focus alone when another tab closes', () => {
    expect(closeTerminalTab(layout, 5, 9).activeId).toBe(2)
  })

  it('replaces the last terminal instead of emptying the panel', () => {
    const single: TerminalLayout = { tabs: [{ id: 1, label: 'shell 1', generation: 4 }], activeId: 1, split: false }
    const next = closeTerminalTab(single, 1, 9)
    expect(next.tabs).toEqual([{ id: 9, label: 'shell 1', generation: 0 }])
    expect(next.activeId).toBe(9)
  })

  it('restarts one tab in place', () => {
    const tabs = restartTerminalTab(layout.tabs, 2)
    expect(tabs[1].generation).toBe(4)
    expect(tabs[1].id).toBe(2)
    expect(tabs[0].generation).toBe(0)
  })
})

describe('command output', () => {
  it('shows stdout, and flags a non-zero exit', () => {
    expect(commandOutputLines({ stdout: 'built\n', stderr: '', code: 0 })).toEqual([{ text: 'built', kind: undefined }])
    expect(commandOutputLines({ stdout: 'oops\n', stderr: '', code: 1 })).toEqual([{ text: 'oops', kind: 'warning' }])
  })

  it('keeps stderr separate from stdout', () => {
    expect(commandOutputLines({ stdout: 'out', stderr: 'err', code: 1 })).toEqual([
      { text: 'out', kind: 'warning' },
      { text: 'err', kind: 'error' },
    ])
  })

  it('says something even when the command printed nothing', () => {
    expect(commandOutputLines({ stdout: '', stderr: '', code: 0 })).toEqual([{ text: 'Process exited with code 0', kind: 'success' }])
    expect(commandOutputLines({ stdout: ' \n', stderr: '', code: 130 })).toEqual([{ text: 'Process exited with code 130', kind: 'error' }])
  })
})
