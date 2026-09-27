/**
 * @vitest-environment jsdom
 *
 * Render smoke tests for the workbench views.
 *
 * The source-scraping tests in `platform.test.ts` prove the workbench is
 * decomposed; these prove the pieces actually mount, show the data they are
 * given, and report clicks back to their owner. Together they are what stands
 * in for a browser here.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchView } from './sidebar/SearchView'
import { SourceControlView } from './sidebar/SourceControlView'
import { DebugView } from './sidebar/DebugView'
import { TestingView } from './sidebar/TestingView'
import { ExtensionsView } from './sidebar/ExtensionsView'
import { ExplorerView } from './sidebar/ExplorerView'
import { ProblemsPanel } from './panel/ProblemsPanel'
import { TerminalPanel } from './panel/TerminalPanel'
import { MarkerSeverity } from '../markers/markerService'

// React only allows act() when the environment declares itself a test.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Mounts a view and returns its DOM, so assertions read as user-visible facts. */
function render(element: React.ReactNode) {
  act(() => root.render(element))
  return container
}

/** Finds a button by its visible text or accessible name. */
function button(text: string) {
  const match = [...container.querySelectorAll('button')].find((node) => (
    node.textContent?.includes(text) || node.getAttribute('aria-label') === text || node.title === text
  ))
  if (!match) throw new Error(`No button matching "${text}" in: ${container.textContent}`)
  return match
}

function click(text: string) {
  act(() => { button(text).click() })
}

const noop = () => {}

describe('search view', () => {
  const props = {
    query: 'window', replace: '', showReplace: false, showDetails: false,
    includes: '', excludes: '', options: { matchCase: false, wholeWord: true, isRegex: false },
    regexError: null, searching: false, matchCount: 1, limitHit: false,
    results: [{
      file: { path: 'src/app.ts' },
      line: 'const windowTitle = 1',
      index: 4,
      column: 7,
      match: { line: 5, start: 6, end: 12, text: 'const windowTitle = 1' },
    }],
    onQueryChange: noop, onReplaceChange: noop, onToggleReplace: noop, onToggleDetails: noop,
    onIncludesChange: noop, onExcludesChange: noop, onOptionsChange: noop, onReplaceAll: noop,
    onOpenResult: noop,
  }

  it('summarises the result set and opens a hit at its line and column', () => {
    const onOpenResult = vi.fn()
    render(<SearchView {...props} onOpenResult={onOpenResult} />)
    expect(container.textContent).toContain('1 result in 1 file')
    expect(container.querySelector('mark')?.textContent).toBe('window')
    click('app.ts')
    expect(onOpenResult).toHaveBeenCalledWith('src/app.ts', 5, 7)
  })

  it('reflects the active match options and reports toggles', () => {
    const onOptionsChange = vi.fn()
    render(<SearchView {...props} onOptionsChange={onOptionsChange} />)
    expect(button('ab').getAttribute('aria-pressed')).toBe('true')
    expect(button('Aa').getAttribute('aria-pressed')).toBe('false')
    click('Aa')
    expect(onOptionsChange).toHaveBeenCalled()
  })

  it('warns about an uncompilable regular expression instead of reporting zero results', () => {
    render(<SearchView {...props} regexError="Unterminated group" results={[]} />)
    expect(container.textContent).toContain('Invalid regular expression')
  })
})

describe('source control view', () => {
  const props = {
    desktop: true, view: 'changes' as const, branch: 'main', branches: ['main', 'next'],
    isRepository: true, operation: { operation: null, conflicts: [] },
    integrateBranch: '', commitMessage: 'wip', stashes: [], history: [],
    github: { pullRequests: [], issues: [] },
    changes: [{ path: 'src/app.ts', status: 'M', workingTree: true }],
    onViewChange: noop, onCheckoutBranch: noop, onOpenConflict: noop, onFinishOperation: noop,
    onIntegrateBranchChange: noop, onIntegrate: noop, onCommitMessageChange: noop, onCommit: noop,
    onRefresh: noop, onOpenChange: noop, onStageChange: noop, onStash: noop, onPopStash: noop,
    onOpenExternal: noop,
  }

  it('stages a modified file and opens its diff', () => {
    const onStageChange = vi.fn()
    const onOpenChange = vi.fn()
    render(<SourceControlView {...props} onStageChange={onStageChange} onOpenChange={onOpenChange} />)
    click('app.ts')
    expect(onOpenChange).toHaveBeenCalledWith(props.changes[0])
    click('Stage file')
    expect(onStageChange).toHaveBeenCalledWith(props.changes[0])
  })

  it('blocks continuing a merge while conflicts remain', () => {
    render(<SourceControlView {...props} operation={{ operation: 'merge', conflicts: ['src/app.ts'] }} />)
    expect(container.textContent).toContain('MERGE IN PROGRESS')
    expect(container.textContent).toContain('1 conflict must be resolved')
    expect((button('Continue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains an empty working tree rather than showing a bare list', () => {
    render(<SourceControlView {...props} changes={[]} />)
    expect(container.textContent).toContain('Working tree is clean')
  })
})

describe('debug view', () => {
  const props = {
    running: true, sessionId: 'session-1', output: ['ready'], hasLaunchConfig: true,
    threads: [{ id: 1, name: 'main' }],
    frames: [{ id: 9, name: 'handler', line: 12, source: { name: 'app.ts' } }],
    scopes: [], variables: [], watches: [], watchInput: '', watchValues: {},
    breakpoints: [{ path: 'src/app.ts', line: 12, condition: 'count > 2' }],
    canAddBreakpoint: true, shortcutFor: () => 'F10',
    onStart: noop, onStop: noop, onControl: noop, onSelectThread: noop, onSelectFrame: noop,
    onWatchInputChange: noop, onAddWatch: noop, onRemoveWatch: noop, onAddBreakpoint: noop,
    onEditBreakpointCondition: noop, onRemoveBreakpoint: noop, onRevealBreakpoint: noop,
  }

  it('shows the live session and steps through it', () => {
    const onControl = vi.fn()
    const onSelectFrame = vi.fn()
    render(<DebugView {...props} onControl={onControl} onSelectFrame={onSelectFrame} />)
    expect(container.textContent).toContain('Stop session')
    expect(button('Step over (F10)')).toBeTruthy()
    click('Step over (F10)')
    expect(onControl).toHaveBeenCalledWith('next')
    click('handler')
    expect(onSelectFrame).toHaveBeenCalledWith(props.frames[0])
  })

  it('lists conditional breakpoints even when no session is running', () => {
    render(<DebugView {...props} running={false} sessionId={undefined} />)
    expect(container.textContent).toContain('Start debugging')
    expect(container.textContent).toContain('line 12 · count > 2')
  })
})

describe('testing view', () => {
  const test = { id: 't1', name: 'adds numbers', path: 'src/sum.test.ts', line: 3, command: 'npm test' }
  const props = {
    frameworks: ['Vitest'], testProfiles: [{ label: 'npm: test', command: 'npm test' }],
    tasks: [], discovered: [test],
    results: { t1: { status: 'failed' as const, durationMs: 4, failures: ['expected 2'] } },
    activeResult: 't1', coverageFileCount: 0,
    onRefresh: noop, onRunTask: noop, onOpenTest: noop, onRunTest: noop, onDebugTest: noop,
  }

  it('reports the last failure beside the test that produced it', () => {
    const onRunTest = vi.fn()
    render(<TestingView {...props} onRunTest={onRunTest} />)
    expect(container.textContent).toContain('adds numbers')
    expect(container.textContent).toContain('src/sum.test.ts:3 · 4 ms')
    expect(container.textContent).toContain('FAILED')
    expect(container.textContent).toContain('expected 2')
    click('Run this test')
    expect(onRunTest).toHaveBeenCalledWith('t1')
  })
})

describe('extensions view', () => {
  const extension = {
    id: 'acme.tools', name: 'Acme Tools', description: 'Adds acme commands',
    publisher: 'acme', version: '1.0.0', enabled: false, scope: 'user' as const,
    permissions: ['commands'],
  } as unknown as ExtensionManifest

  it('offers to re-enable a disabled extension', () => {
    const onToggleEnabled = vi.fn()
    render(<ExtensionsView extensions={[extension]} languageCount={21} onInstall={noop} onToggleEnabled={onToggleEnabled} onUninstall={noop} />)
    expect(container.textContent).toContain('21 bundled language grammars')
    expect(container.textContent).toContain('Permissions: commands')
    expect(container.querySelector('.extension-card.managed')?.className).toContain('disabled')
    click('Enable extension')
    expect(onToggleEnabled).toHaveBeenCalledWith(extension)
  })
})

describe('explorer view', () => {
  const files = [
    { path: 'src/app.ts', content: '', language: 'typescript' },
    { path: 'README.md', content: '', language: 'markdown' },
  ]
  const props = {
    workspaceName: 'tungsten', externalChange: null, roots: [], files,
    activePath: 'src/app.ts', dirty: new Set(['src/app.ts']),
    symbols: [{ type: 'function', label: 'main', line: 3, depth: 0 }],
    cursorLine: 3, hasActiveFile: true,
    onOpenFolder: noop, onAddRoot: noop, onRemoveRoot: noop, onRefresh: noop, onNewFile: noop,
    onOpenFile: noop, onFileContext: noop, onRevealLine: noop,
  }

  it('expands a folder to reach the file inside it', () => {
    const onOpenFile = vi.fn()
    render(<ExplorerView {...props} onOpenFile={onOpenFile} />)
    // `src` starts expanded, `README.md` sits at the root.
    click('README.md')
    expect(onOpenFile).toHaveBeenCalledWith('README.md')
    click('app.ts')
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts')
    expect(container.querySelector('.file-row.selected')?.textContent).toContain('app.ts')
    expect(container.querySelector('.dirty-dot')).toBeTruthy()
  })

  it('jumps to a symbol from the outline', () => {
    const onRevealLine = vi.fn()
    render(<ExplorerView {...props} onRevealLine={onRevealLine} />)
    click('main')
    expect(onRevealLine).toHaveBeenCalledWith(3)
  })
})

describe('problems panel', () => {
  const marker = {
    resource: 'src/app.ts', owner: 'tungsten', severity: MarkerSeverity.Error,
    message: 'Cannot find name foo', startLineNumber: 7, startColumn: 3,
    endLineNumber: 7, endColumn: 6,
  }

  it('reveals the exact position of a diagnostic', () => {
    const onReveal = vi.fn()
    render(
      <ProblemsPanel
        groups={[{ resource: 'src/app.ts', markers: [marker] }]}
        totalCount={1}
        filter=""
        onFilterChange={noop}
        severities={MarkerSeverity.Error}
        onToggleSeverity={noop}
        onReveal={onReveal}
      />,
    )
    expect(container.textContent).toContain('Cannot find name foo')
    expect(container.textContent).toContain('Error · 7:3')
    click('Cannot find name foo')
    expect(onReveal).toHaveBeenCalledWith('src/app.ts', 7, 3)
  })

  it('distinguishes a clean workspace from an over-eager filter', () => {
    const shared = { groups: [], filter: 'nope', onFilterChange: noop, severities: MarkerSeverity.Error, onToggleSeverity: noop, onReveal: noop }
    render(<ProblemsPanel {...shared} totalCount={0} />)
    expect(container.textContent).toContain('No problems detected')
    render(<ProblemsPanel {...shared} totalCount={3} />)
    expect(container.textContent).toContain('No matching problems')
  })
})

describe('terminal panel', () => {
  const props = {
    desktop: false, tabs: [], activeId: 1, split: false,
    profiles: { wsl: [], containers: [] }, command: null,
    searchOpen: false, searchQuery: '', searchRequest: null,
    themeId: 'graphene-dark', fontSize: 12,
    onSelectTab: noop, onCloseTab: noop, onNewTerminal: noop, onSearchQueryChange: noop,
    onSearchSubmit: noop, onCloseSearch: noop, onFocusChange: noop,
    lines: [{ text: 'Tungsten shell' }], input: '', onInputChange: noop, onRun: noop,
    history: ['npm run dev'], historyIndex: -1, onHistoryIndexChange: noop,
    workspaceName: 'tungsten',
    inputRef: { current: null }, endRef: { current: null },
  }

  it('runs a command in the sandbox shell and clears the prompt', () => {
    const onRun = vi.fn()
    const onInputChange = vi.fn()
    render(<TerminalPanel {...props} input="ls" onRun={onRun} onInputChange={onInputChange} />)
    expect(container.textContent).toContain('Tungsten shell')
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onRun).toHaveBeenCalledWith('ls')
    expect(onInputChange).toHaveBeenCalledWith('')
  })

  it('walks backwards through history on arrow up', () => {
    const onHistoryIndexChange = vi.fn()
    const onInputChange = vi.fn()
    render(<TerminalPanel {...props} onHistoryIndexChange={onHistoryIndexChange} onInputChange={onInputChange} />)
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(onHistoryIndexChange).toHaveBeenCalledWith(0)
    expect(onInputChange).toHaveBeenCalledWith('npm run dev')
  })
})
