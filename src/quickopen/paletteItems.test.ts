import { describe, expect, it, vi } from 'vitest'
import { Braces, CornerDownRight, FileCode2, Terminal } from 'lucide-react'

import {
  buildPaletteItems,
  parsePaletteQuery,
  type PaletteCommand,
  type PaletteFile,
  type PaletteSources,
} from './paletteItems'

const icons = { file: FileCode2, symbol: Braces, line: CornerDownRight }

function file(path: string, content = 'one\ntwo\nthree', language = 'typescript'): PaletteFile {
  return { path, content, language }
}

function command(id: string, label: string, when?: string): PaletteCommand {
  return { id, label, detail: 'Tungsten', icon: Terminal, when, action: () => undefined }
}

function sources(overrides: Partial<PaletteSources> = {}): PaletteSources {
  return {
    commands: [],
    files: [],
    openTabs: [],
    symbols: [],
    activeFile: undefined,
    whenContext: {},
    shortcutFor: () => '',
    icons,
    actions: { openFile: () => undefined, revealLine: () => undefined, gotoLine: () => undefined },
    ...overrides,
  }
}

describe('parsePaletteQuery', () => {
  it('reads the mode off the prefix', () => {
    expect(parsePaletteQuery('>save', 'files')).toEqual({ mode: 'commands', search: 'save' })
    expect(parsePaletteQuery('@render', 'files')).toEqual({ mode: 'symbols', search: 'render' })
    expect(parsePaletteQuery('#render', 'files')).toEqual({ mode: 'symbols', search: 'render' })
    expect(parsePaletteQuery(':42', 'files')).toEqual({ mode: 'line', search: '42' })
  })

  it('keeps the mode the palette was opened with when there is no prefix', () => {
    expect(parsePaletteQuery('app', 'files')).toEqual({ mode: 'files', search: 'app' })
    expect(parsePaletteQuery('', 'commands')).toEqual({ mode: 'commands', search: '' })
  })

  it('treats a lone prefix as an empty query, not as text', () => {
    expect(parsePaletteQuery('>', 'files')).toEqual({ mode: 'commands', search: '' })
  })
})

describe('go to line', () => {
  const activeFile = { path: 'src/App.tsx', content: 'a\nb\nc\nd' }

  it('explains itself until a number is typed', () => {
    const [item] = buildPaletteItems('line', '', sources({ activeFile }))
    expect(item.label).toBe('Go to line')
    expect(item.detail).toBe('Type a line number between 1 and 4')
  })

  it('offers the line and reveals it', () => {
    const gotoLine = vi.fn()
    const [item] = buildPaletteItems('line', '3', sources({
      activeFile, actions: { openFile: () => undefined, revealLine: () => undefined, gotoLine },
    }))
    expect(item.label).toBe('Go to line 3')
    expect(item.detail).toBe('App.tsx')
    void item.action()
    expect(gotoLine).toHaveBeenCalledWith(3)
  })

  it('clamps past the end of the file rather than failing', () => {
    const [item] = buildPaletteItems('line', '900', sources({ activeFile }))
    expect(item.label).toBe('Go to line 4')
  })

  it('rejects zero, negatives and words', () => {
    for (const query of ['0', '-3', 'ten']) {
      expect(buildPaletteItems('line', query, sources({ activeFile }))[0].label).toBe('Go to line')
    }
  })
})

describe('symbols', () => {
  const symbols = [{ label: 'renderTree', line: 12 }, { label: 'openFile', line: 40 }]

  it('lists every symbol in file order before filtering', () => {
    const items = buildPaletteItems('symbols', '', sources({ symbols }))
    expect(items.map((item) => item.label)).toEqual(['renderTree', 'openFile'])
  })

  it('filters fuzzily and jumps to the symbol line', () => {
    const revealLine = vi.fn()
    const items = buildPaletteItems('symbols', 'opfl', sources({
      symbols, actions: { openFile: () => undefined, revealLine, gotoLine: () => undefined },
    }))
    expect(items.map((item) => item.label)).toEqual(['openFile'])
    expect(items[0].labelMatch.length).toBeGreaterThan(0)
    void items[0].action()
    expect(revealLine).toHaveBeenCalledWith(40)
  })
})

describe('files', () => {
  const files = [file('src/App.tsx'), file('src/workspace.ts'), file('README.md')]

  it('shows the most recently opened editors first when nothing is typed', () => {
    const items = buildPaletteItems('files', '', sources({ files, openTabs: ['README.md', 'src/workspace.ts'] }))
    expect(items.map((item) => item.detail)).toEqual(['src/workspace.ts', 'README.md', 'src/App.tsx'])
  })

  it('hides generated diffs', () => {
    const items = buildPaletteItems('files', '', sources({ files: [...files, file('App.tsx ↔ HEAD', '', 'diff')] }))
    expect(items.map((item) => item.detail)).not.toContain('App.tsx ↔ HEAD')
  })

  it('matches on the file name and opens it', () => {
    const openFile = vi.fn()
    const items = buildPaletteItems('files', 'app', sources({
      files, actions: { openFile, revealLine: () => undefined, gotoLine: () => undefined },
    }))
    expect(items[0].label).toBe('App.tsx')
    void items[0].action()
    expect(openFile).toHaveBeenCalledWith('src/App.tsx')
  })

  it('breaks a tie on the shorter name', () => {
    const items = buildPaletteItems('files', 'index', sources({
      files: [file('src/components/indexFactory.ts'), file('src/index.ts')],
    }))
    expect(items[0].detail).toBe('src/index.ts')
  })
})

describe('commands', () => {
  const commands = [
    command('workbench.action.files.save', 'File: Save'),
    command('editor.action.formatDocument', 'Format Document', 'editorFocus'),
  ]

  it('hides commands whose when clause fails', () => {
    const hidden = buildPaletteItems('commands', '', sources({ commands, whenContext: { editorFocus: false } }))
    expect(hidden.map((item) => item.id)).toEqual(['workbench.action.files.save'])

    const shown = buildPaletteItems('commands', '', sources({ commands, whenContext: { editorFocus: true } }))
    expect(shown).toHaveLength(2)
  })

  it('carries the current keybinding on every row', () => {
    const items = buildPaletteItems('commands', 'save', sources({
      commands, shortcutFor: (id) => (id === 'workbench.action.files.save' ? 'Ctrl+S' : ''),
    }))
    expect(items[0].keybinding).toBe('Ctrl+S')
  })

  it('drops rows the query does not match at all', () => {
    const items = buildPaletteItems('commands', 'zzzz', sources({ commands, whenContext: { editorFocus: true } }))
    expect(items).toEqual([])
  })
})
