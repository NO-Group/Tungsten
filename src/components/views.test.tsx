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
import { DictionaryView } from './sidebar/DictionaryView'
import { ExplorerView } from './sidebar/ExplorerView'
import { ActivityBar } from './ActivityBar'
import { TitleBar, type Menu } from './TitleBar'
import { StatusBar } from './StatusBar'
import { PanelHeader } from './panel/PanelHeader'
import { ProblemsPanel } from './panel/ProblemsPanel'
import { TerminalPanel } from './panel/TerminalPanel'
import { MarkerSeverity } from '../markers/markerService'
import { createDictionary, shellDictionary } from '../shell/commandDictionary'

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

describe('title bar', () => {
  const menus: Menu[] = [
    {
      name: 'File',
      entries: [
        { id: 'save', label: 'Save', shortcut: 'Ctrl+S', enabled: true, run: () => {} },
        { id: 'saveAll', label: 'Save All', shortcut: '', enabled: false, divider: true, run: () => {} },
      ],
    },
    { name: 'Help', entries: [{ id: 'about', label: 'About', shortcut: '', enabled: true, run: () => {} }] },
  ]
  const props = {
    title: 'tungsten — Tungsten', menus, openMenu: null as string | null, onOpenMenuChange: noop,
    onOpenCommandCentre: noop, collaborationActive: false, participantCount: 0, onOpenCollaboration: noop,
    sidebarVisible: true, onToggleSidebar: noop, panelOpen: false, onTogglePanel: noop,
    sidePreview: false, onToggleSidePreview: noop,
  }

  it('opens a menu and runs an entry', () => {
    const onOpenMenuChange = vi.fn()
    render(<TitleBar {...props} onOpenMenuChange={onOpenMenuChange} />)
    expect(container.querySelector('.menu-dropdown')).toBeNull()
    click('File')
    expect(onOpenMenuChange).toHaveBeenCalledWith('File')

    const run = vi.fn()
    const opened: Menu[] = [{ ...menus[0], entries: [{ ...menus[0].entries[0], run }] }, menus[1]]
    render(<TitleBar {...props} menus={opened} openMenu="File" onOpenMenuChange={onOpenMenuChange} />)
    click('Save')
    expect(run).toHaveBeenCalled()
    // Running an entry also dismisses the menu.
    expect(onOpenMenuChange).toHaveBeenLastCalledWith(null)
  })

  it('disables entries whose when-clause does not hold', () => {
    render(<TitleBar {...props} openMenu="File" />)
    expect((button('Save All') as HTMLButtonElement).disabled).toBe(true)
    expect((button('Save') as HTMLButtonElement).disabled).toBe(false)
    expect(button('File').getAttribute('aria-expanded')).toBe('true')
  })

  it('switches menus on hover once one is open', () => {
    const onOpenMenuChange = vi.fn()
    render(<TitleBar {...props} openMenu="File" onOpenMenuChange={onOpenMenuChange} />)
    act(() => { button('Help').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    expect(onOpenMenuChange).toHaveBeenCalledWith('Help')
  })
})

describe('status bar', () => {
  const props = {
    remoteConnected: false, onOpenRemote: noop,
    branch: 'main', changeCount: 2, onOpenSourceControl: noop, onRefreshGit: noop,
    errorCount: 1, warningCount: 3, onOpenProblems: noop, pendingChord: '',
    workspaceName: 'tungsten', workspaceRoot: '/src/tungsten', platform: '',
    showEditorStatus: true, cursor: { line: 12, column: 4 }, language: 'typescript',
    gotoLineShortcut: 'Ctrl+G', onGotoLine: noop,
    themeLabel: 'Graphene Dark', onPickTheme: noop,
    lsp: { running: true, language: 'TypeScript', message: 'ready' },
    updateState: 'Up to date', onUpdate: noop,
  }

  it('marks a dirty branch and opens source control', () => {
    const onOpenSourceControl = vi.fn()
    render(<StatusBar {...props} onOpenSourceControl={onOpenSourceControl} />)
    expect(container.textContent).toContain('main*')
    click('Current branch')
    expect(onOpenSourceControl).toHaveBeenCalled()
  })

  it('separates errors from warnings', () => {
    const onOpenProblems = vi.fn()
    render(<StatusBar {...props} onOpenProblems={onOpenProblems} />)
    const problems = button('4 language diagnostics')
    expect(problems.textContent).toBe('13')
    act(() => { problems.click() })
    expect(onOpenProblems).toHaveBeenCalled()
  })

  it('hides the text-editor items for non-text editors', () => {
    render(<StatusBar {...props} showEditorStatus={false} />)
    expect(container.textContent).not.toContain('Ln 12')
    render(<StatusBar {...props} />)
    expect(container.textContent).toContain('Ln 12, Col 4')
    expect(container.textContent).toContain('typescript')
  })

  it('shows a chord in progress only while one is pending', () => {
    render(<StatusBar {...props} />)
    expect(container.querySelector('.chord-indicator')).toBeNull()
    render(<StatusBar {...props} pendingChord="Ctrl+K" />)
    expect(container.textContent).toContain('(Ctrl+K) was pressed. Waiting for second key…')
  })

  it('reports the browser build as Web', () => {
    render(<StatusBar {...props} />)
    expect(container.textContent).toContain('Web')
    render(<StatusBar {...props} platform="linux" />)
    expect(container.textContent).toContain('Desktop')
  })
})

describe('activity bar', () => {
  const props = { active: 'explorer' as const, sidebarVisible: true, onSelect: noop, onOpenSettings: noop }

  it('marks only the active view as pressed, and only while the sidebar shows', () => {
    render(<ActivityBar {...props} active="source" />)
    expect(button('Source Control').getAttribute('aria-pressed')).toBe('true')
    expect(button('Explorer').getAttribute('aria-pressed')).toBe('false')

    render(<ActivityBar {...props} active="source" sidebarVisible={false} />)
    expect(button('Source Control').getAttribute('aria-pressed')).toBe('false')
  })

  it('badges pending work and hides empty counts', () => {
    render(<ActivityBar {...props} badges={{ source: 7, tests: 0 }} />)
    expect(button('Source Control').textContent).toBe('7')
    expect(button('Testing').textContent).toBe('')
  })

  it('reports the view that was clicked, including the active one', () => {
    const selected: string[] = []
    render(<ActivityBar {...props} onSelect={(id) => selected.push(id)} />)
    click('Search')
    // Clicking the current view is what collapses the sidebar, so it must
    // still be reported rather than swallowed as a no-op.
    click('Explorer')
    expect(selected).toEqual(['search', 'explorer'])
  })
})

describe('panel header', () => {
  const props = {
    activeTab: 'TERMINAL', onSelectTab: noop, problemCount: 4, terminalKind: 'sandbox' as const,
    onNewTerminal: noop, splitActive: false, onToggleSplit: noop, searchActive: false,
    onToggleSearch: noop, onRestartTerminal: noop, onMaximize: noop, onClose: noop,
  }

  it('counts problems on the tab and names the terminal backing', () => {
    const dom = render(<PanelHeader {...props} />)
    expect(button('PROBLEMS').textContent).toContain('4')
    expect(dom.querySelector('.terminal-name')?.textContent).toContain('sandbox')
    expect(render(<PanelHeader {...props} terminalKind="pty" />).querySelector('.terminal-name')?.textContent).toContain('pty')
  })

  it('switches tabs and keeps the terminal actions available on every tab', () => {
    const selected: string[] = []
    let split = 0
    render(<PanelHeader {...props} activeTab="PROBLEMS" onSelectTab={(tab) => selected.push(tab)} onToggleSplit={() => { split += 1 }} />)
    click('OUTPUT')
    click('Split terminal')
    expect(selected).toEqual(['OUTPUT'])
    expect(split).toBe(1)
  })
})

describe('shell dictionary view', () => {
  const props = {
    dictionary: shellDictionary,
    contributed: 0,
    problems: [],
    onRun: noop,
    onDocumentCommand: noop,
  }

  /** Types into the search box the way a person does. */
  function search(value: string) {
    const input = container.querySelector<HTMLInputElement>('.dictionary-search input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('lists commands with their summaries and says how many it knows', () => {
    const dom = render(<DictionaryView {...props} />)
    expect(dom.querySelectorAll('.dictionary-item').length).toBeGreaterThan(50)
    expect(dom.querySelector('.dictionary-footer')?.textContent)
      .toContain(`${shellDictionary.entries.length} commands`)
  })

  it('narrows the list as the query is typed', () => {
    const dom = render(<DictionaryView {...props} />)
    const before = dom.querySelectorAll('.dictionary-item').length
    search('archive')
    const after = [...dom.querySelectorAll('.dictionary-item')]
    expect(after.length).toBeLessThan(before)
    expect(after[0].textContent).toContain('tar')
  })

  it('offers the nearest command when the query matches nothing', () => {
    const dom = render(<DictionaryView {...props} />)
    search('gerp')
    expect(dom.querySelector('.dictionary-empty')?.textContent).toContain('grep')
  })

  it('filters to one group and reports its size', () => {
    const dom = render(<DictionaryView {...props} />)
    click('Containers')
    const containers = shellDictionary.counts().find((row) => row.group === 'Containers')!.count
    expect(dom.querySelectorAll('.dictionary-item').length).toBe(containers)
  })

  it('opens the manual page for a command', () => {
    const dom = render(<DictionaryView {...props} />)
    search('rsync')
    click('rsync')
    expect(dom.querySelector('.dictionary-synopsis')?.textContent).toContain('rsync [OPTION]...')
    expect(dom.querySelectorAll('.dictionary-options dt').length).toBeGreaterThan(4)
    expect(dom.querySelector('.dictionary-warning')?.textContent).toContain('--delete removes files')
  })

  it('runs an example, and offers to read the page in the terminal', () => {
    const run: string[] = []
    const dom = render(<DictionaryView {...props} onRun={(command) => run.push(command)} />)
    search('tar')
    click('tar')
    act(() => { dom.querySelector<HTMLButtonElement>('.dictionary-example button')!.click() })
    click('man tar')
    expect(run[0]).toContain('tar czf')
    expect(run[1]).toBe('man tar')
  })

  it('walks to a related command and back to the list', () => {
    const dom = render(<DictionaryView {...props} />)
    search('gzip')
    click('gzip')
    click('tar')
    expect(dom.querySelector('.dictionary-page-head h3')?.textContent).toBe('tar')
    click('Back to the list')
    expect(dom.querySelector('.dictionary-list')).toBeTruthy()
  })

  it('shows what the workspace contributed, and what it could not read', () => {
    const dictionary = createDictionary([
      { name: 'deploy', group: 'Development', summary: 'Ship the branch', synopsis: 'deploy [SERVICE]', source: 'team.commands.json' },
    ])
    const dom = render(
      <DictionaryView {...props} dictionary={dictionary} contributed={1} problems={['old.commands.json: not valid JSON']} />,
    )
    expect(dom.querySelector('.dictionary-footer')?.textContent).toContain('1 from this workspace')
    expect(dom.querySelector('.dictionary-problems')?.textContent).toContain('not valid JSON')
    search('deploy')
    click('deploy')
    expect(dom.querySelector('.dictionary-provenance')?.textContent).toContain('team.commands.json')
  })
})
