import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { APP_VERSION } from './version'

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
const rendererEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const configuredEditor = readFileSync(new URL('./components/ConfiguredEditor.tsx', import.meta.url), 'utf8')
const editorGroup = readFileSync(new URL('./components/EditorGroup.tsx', import.meta.url), 'utf8')
const sidebarViews = ['SearchView', 'SourceControlView', 'DebugView', 'TestingView', 'ExtensionsView', 'ExplorerView']
const sidebarSource = Object.fromEntries(sidebarViews.map((name) => [
  name,
  readFileSync(new URL(`./components/sidebar/${name}.tsx`, import.meta.url), 'utf8'),
])) as Record<string, string>
const dialogNames = [
  'CommandPalette', 'ThemePicker', 'SettingsEditor', 'SettingsDialog', 'SnippetsDialog',
  'KeybindingsEditor', 'CollaborationDialog', 'RemoteDialog', 'NewProjectDialog', 'NewFileDialog',
]
const dialogSource = Object.fromEntries(dialogNames.map((name) => [
  name,
  readFileSync(new URL(`./components/dialogs/${name}.tsx`, import.meta.url), 'utf8'),
])) as Record<string, string>
const panelSource = Object.fromEntries(['ProblemsPanel', 'TerminalPanel'].map((name) => [
  name,
  readFileSync(new URL(`./components/panel/${name}.tsx`, import.meta.url), 'utf8'),
])) as Record<string, string>
/** Strips comments so prose about an API is not mistaken for a call to it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** Everything the workbench renders, whichever file it now lives in. */
const workbench = [
  renderer,
  editorGroup,
  ...Object.values(sidebarSource),
  ...Object.values(panelSource),
  ...Object.values(dialogSource),
].join('\n')
const workspaceSearch = readFileSync(new URL('./search/useWorkspaceSearch.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('desktop bridge contract', () => {
  it('registers every renderer-invoked IPC channel in the main process', () => {
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1])
    const handled = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]))
    expect(invoked.filter((channel) => !handled.has(channel))).toEqual([])
    expect(invoked.length).toBeGreaterThan(35)
  })

  it('keeps privileged APIs behind the context-isolated preload', () => {
    expect(preload).toContain("contextBridge.exposeInMainWorld('tungsten'")
    expect(preload).not.toMatch(/require\(['"](?:node:)?(?:fs|child_process|net|ssh2)['"]\)/)
    expect(main).toContain('sandbox: true')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
  })

  it('ships isolated extension, remote, and collaboration services', () => {
    expect(main).toContain("fork(path.join(__dirname, 'extension-host.cjs')")
    expect(main).toContain("ipcMain.handle('remote:ssh-connect'")
    expect(main).toContain("ipcMain.handle('collaboration:host'")
    expect(main).toContain("ipcMain.handle('workspace:search'")
  })

  it('ships multi-root, hunk staging, and structured test contracts', () => {
    expect(main).toContain("ipcMain.handle('desktop:add-workspace-folder'")
    expect(main).toContain("ipcMain.handle('desktop:git-stage-hunk'")
    expect(main).toContain("ipcMain.handle('project:run-test'")
    expect(main).toContain('workspace/didChangeWorkspaceFolders')
  })

  it('loads Monaco and its tested workers outside the renderer entry chunk', () => {
    expect(rendererEntry).not.toContain("from 'monaco-editor'")
    expect(configuredEditor).toContain("from 'monaco-editor'")
    expect(configuredEditor).toContain('editor.worker.js?worker')
    expect(configuredEditor).toContain('typescript/ts.worker.js?worker')
  })

  it('supports remote language, debug, command, and test services over the SSH transport', () => {
    expect(main).toContain('spawnRemoteLanguageServer')
    expect(main).toContain("typescript-language-server', args: ['--stdio']")
    expect(main).toContain('executeWorkspaceCommand')
    expect(main).toContain("remoteWorkspace ? remoteFileUri")
  })

  it('registers conflict workflows and managed extension state', () => {
    expect(main).toContain("ipcMain.handle('desktop:git-operation-status'")
    expect(main).toContain("ipcMain.handle('desktop:git-resolve-conflict'")
    expect(main).toContain("ipcMain.handle('extensions:set-enabled'")
    expect(main).toContain("ipcMain.handle('extensions:uninstall'")
  })

  it('persists editable shortcuts and renders inline debugger values', () => {
    expect(renderer).toContain("KEYBINDINGS_KEY = 'tungsten.keybindings.v2'")
    // Keystrokes are dispatched through the chord-aware resolver.
    expect(renderer).toContain('keybindingResolver.resolve')
    expect(renderer).toContain('chordFromEvent')
    expect(renderer).toContain("inlineClassName: 'debug-inline-value'")
  })

  it('drives the workbench from the theme service', () => {
    // The workbench applies the palette; the editor groups apply it to Monaco.
    expect(renderer).toContain('applyWorkbenchTheme')
    expect(renderer).toContain('applyMonacoTheme')
    expect(editorGroup).toContain('monacoThemeName(theme)')
    // The stylesheet must consume the runtime custom properties rather than
    // hard-coding Tungsten's original palette.
    expect(styles).toContain('var(--tg-background')
    expect(styles).toContain("data-theme-kind='hc-dark'")
  })

  it('renders editor groups from the group model rather than a flat tab list', () => {
    // The renderer must not reintroduce standalone tab state: the layout is the
    // single source of truth, and openTabs/activePath are derived from it.
    expect(renderer).toContain('layout.groups.map')
    expect(renderer).toContain('<EditorGroup')
    expect(renderer).not.toMatch(/useState\(\['README\.md'/)
    expect(renderer).toContain('createLayout(')

    // The group itself stays presentational: it reports intent upward and
    // never reaches for application state directly.
    expect(editorGroup).toContain('actions.setLayout')
    expect(editorGroup).not.toContain('useState')
    expect(editorGroup).not.toContain('localStorage')
    expect(editorGroup).not.toContain('window.tungsten')
  })

  it('routes commands through a single id-keyed table', () => {
    // Every command carries a stable id so the palette, menus, keybinding editor
    // and keystroke dispatch all agree on what exists.
    expect(renderer).toContain('const commandsById = useMemo')
    expect(renderer).toContain('runCommandById')
    expect(renderer).toContain('parseWhenClause')
  })

  it('wires snippets, search, markers, and configuration into the workbench', () => {
    // Each engine must actually be consumed by the UI, not merely exist.
    expect(renderer).toContain('registerSnippetProvider')
    expect(renderer).toContain('useWorkspaceSearch({')
    expect(workspaceSearch).toContain('searchFiles(')
    expect(readFileSync(new URL('./languages/useDiagnostics.ts', import.meta.url), 'utf8')).toContain('groupMarkersByResource')
    expect(renderer).toContain('configurationByCategory')
  })

  it('keeps the native ripgrep path for files outside the in-memory index', () => {
    // The client-side matcher only sees indexed files, so dropping ripgrep
    // would silently lose results on large desktop workspaces.
    expect(workspaceSearch).toContain('searchWorkspace')
    expect(workspaceSearch).toContain('nativeUsable')
    // Native hits are only merged for files the in-memory index never loaded.
    expect(readFileSync(new URL('./search/textSearch.ts', import.meta.url), 'utf8')).toContain('!indexed.has(hit.path)')
  })

  it('exposes the search options VS Code offers', () => {
    for (const option of ['matchCase', 'wholeWord', 'isRegex']) {
      expect(workbench, option).toContain(option)
    }
    expect(sidebarSource.SearchView).toContain('Replace All')
  })

  it('splits the sidebar into one presentational view per activity', () => {
    // The workbench routes to a view per activity instead of inlining six
    // screens' worth of JSX in one function.
    for (const name of sidebarViews) {
      expect(renderer, name).toContain(`<${name}`)
      expect(renderer, name).toContain(`from './components/sidebar/${name}'`)
    }
    // Views take their data and callbacks as props: no workbench state, no
    // storage, and no direct calls into the desktop bridge.
    for (const [name, source] of Object.entries(sidebarSource)) {
      expect(code(source), name).not.toContain('window.tungsten')
      expect(code(source), name).not.toContain('localStorage')
    }
    // The one exception is the file tree, which owns its own expansion state.
    expect(sidebarSource.ExplorerView).not.toContain('useState')
    expect(sidebarSource.SourceControlView).not.toContain('useState')
  })

  it('renders its chrome from components rather than inline markup', () => {
    // The title bar resolves menus from the command table, so a menu entry
    // cannot disagree with the command it invokes about labels or keystrokes.
    expect(renderer).toContain('<TitleBar')
    expect(renderer).toContain('<StatusBar')
    expect(renderer).toContain('const menuBar: AppMenu[]')
    const titleBar = readFileSync(new URL('./components/TitleBar.tsx', import.meta.url), 'utf8')
    const statusBar = readFileSync(new URL('./components/StatusBar.tsx', import.meta.url), 'utf8')
    for (const source of [titleBar, statusBar]) {
      expect(code(source)).not.toContain('window.tungsten')
      expect(code(source)).not.toContain('useState')
    }
    expect(code(titleBar)).not.toContain('parseWhenClause')
  })

  it('keeps every Git call in the Git service', () => {
    const service = readFileSync(new URL('./git/useGitService.ts', import.meta.url), 'utf8')
    // One file owns the Git bridge, so the workbench cannot drift into
    // half-refreshed state by calling it from a handler that forgot to.
    expect(code(renderer)).not.toMatch(/tungsten[?!]?\.git[A-Z]/)
    expect(code(service)).toMatch(/api\.gitStatus\(\)/)
    expect(renderer).toContain('const git = useGitService({')
    // Status interpretation and document naming are pure, and tested as such.
    const model = readFileSync(new URL('./git/gitModel.ts', import.meta.url), 'utf8')
    expect(code(model)).not.toContain('window.tungsten')
    expect(code(model)).not.toContain('useState')
    expect(code(renderer)).not.toContain(".tungsten/diffs/")
  })

  it('runs terminals through one service, on either platform', () => {
    const shell = readFileSync(new URL('./terminal/sandboxShell.ts', import.meta.url), 'utf8')
    const sessions = readFileSync(new URL('./terminal/useTerminalSessions.ts', import.meta.url), 'utf8')
    const model = readFileSync(new URL('./terminal/terminalSessions.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const terminal = useTerminalSessions({')
    // One place decides between a real child process and the emulated shell.
    expect(code(sessions)).toContain('window.tungsten.runCommand(entry)')
    expect(code(sessions)).toContain('runSandboxCommand(entry')
    expect(code(renderer)).not.toContain('runCommand(')
    expect(code(renderer)).not.toContain('runSandboxCommand')
    // Tab bookkeeping and the emulated shell are pure, and tested as such.
    for (const source of [shell, model]) {
      expect(code(source)).not.toContain('window.tungsten')
      expect(code(source)).not.toContain('useState')
    }
    expect(code(renderer)).not.toContain('localStorage.setItem(TERMINAL_LAYOUT_KEY')
  })

  it('keeps the debug adapter conversation in the debug service', () => {
    const model = readFileSync(new URL('./debug/debugModel.ts', import.meta.url), 'utf8')
    const session = readFileSync(new URL('./debug/useDebugSession.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const debug = useDebugSession({')
    // The protocol state machine is pure: message in, next session and the
    // requests it implies out.
    expect(code(model)).not.toContain('window.tungsten')
    expect(code(model)).not.toContain('useState')
    expect(code(session)).toContain('reduceDebugMessage(sessionRef.current')
    expect(code(renderer)).not.toContain('sendDebug')
    expect(code(renderer)).not.toContain('startDebug(')
  })

  it('keeps room traffic in the collaboration service', () => {
    const model = readFileSync(new URL('./collaboration/collaborationModel.ts', import.meta.url), 'utf8')
    const service = readFileSync(new URL('./collaboration/useCollaboration.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const collaboration = useCollaboration({')
    expect(code(renderer)).not.toContain('sendCollaborationEvent')
    expect(code(renderer)).not.toContain('publishCollaborationFile')
    expect(code(service)).toContain('reduceCollaborationEvent(roomRef.current')
    // Presence, cursors and comments fold into the room by pure rules.
    expect(code(model)).not.toContain('window.tungsten')
    expect(code(model)).not.toContain('useState')
  })

  it('keeps the workbench layout, and its persistence, in one place', () => {
    const hook = readFileSync(new URL('./workbench/useWorkbenchLayout.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const workbench = useWorkbenchLayout()')
    expect(code(hook)).toContain('WORKBENCH_LAYOUT_KEY')
    // Sizes are clamped on the way in, so a layout from a bigger screen
    // cannot restore a panel taller than the window.
    expect(code(hook)).toContain('clampPanelHeight(')
    for (const call of ['tungsten.workbench.v2', 'setSidebarWidth(Math', 'setPanelHeight(Math']) {
      expect(code(renderer), call).not.toContain(call)
    }
  })

  it('writes the product version down in exactly one place', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(APP_VERSION).toBe(manifest.version)
    // The About dialog and the shell banner both read it rather than restate it.
    expect(renderer).toContain('APP_VERSION')
    expect(readFileSync(new URL('./terminal/useTerminalSessions.ts', import.meta.url), 'utf8'))
      .toContain('Tungsten Shell ${APP_VERSION}')
  })

  it('keeps diagnostics in a service that merges per file', () => {
    const hook = readFileSync(new URL('./languages/useDiagnostics.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const diagnostics = useDiagnostics({')
    expect(code(hook)).toContain('mergeDiagnostics(current, path,')
    expect(code(hook)).toContain('setModelMarkers')
    for (const call of ['setModelMarkers', 'startLanguageServer', 'publishDiagnostics']) {
      expect(code(renderer), call).not.toContain(call)
    }
  })

  it('registers Monaco language and snippet providers from their own modules', () => {
    const client = readFileSync(new URL('./languages/monacoLanguageClient.ts', import.meta.url), 'utf8')
    const snippets = readFileSync(new URL('./languages/monacoSnippetProvider.ts', import.meta.url), 'utf8')
    expect(renderer).toContain("from './languages/monacoLanguageClient'")
    expect(renderer).toContain("from './languages/monacoSnippetProvider'")
    for (const provider of ['registerHoverProvider', 'registerDefinitionProvider', 'registerRenameProvider', 'registerCodeActionProvider']) {
      expect(client, provider).toContain(provider)
      expect(code(renderer), provider).not.toContain(provider)
    }
    // Snippets work with no server, so they are registered separately.
    expect(snippets).toContain('registerCompletionItemProvider')
    expect(snippets).not.toContain('window.tungsten')
  })

  it('builds quick-open rows outside the component', () => {
    expect(renderer).toContain("from './quickopen/paletteItems'")
    expect(renderer).toContain('buildPaletteItems(paletteMode, paletteSearch, {')
    // Scoring and mode prefixes belong to the module, not the workbench.
    for (const call of ['scoreItem(', 'prepareQuery(', "startsWith('>')"]) {
      expect(code(renderer), call).not.toContain(call)
    }
  })

  it('reads the project and its extensions through one service', () => {
    const service = readFileSync(new URL('./project/useProjectService.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const project = useProjectService({')
    // Detection follows the workspace, so no caller has to remember to refresh.
    expect(code(service)).toContain('api.detectProject()')
    expect(code(service)).toContain('api.discoverTests()')
    for (const call of ['detectProject', 'discoverTests', 'readCoverage', 'scanExtensions', 'tungsten.runTest', 'installExtensionFolder']) {
      expect(code(renderer), call).not.toContain(call)
    }
  })

  it('keeps SSH, WSL and container connections in the remote service', () => {
    const service = readFileSync(new URL('./remote/useRemoteWorkspace.ts', import.meta.url), 'utf8')
    expect(renderer).toContain('const remote = useRemoteWorkspace({')
    expect(code(service)).toContain('connectSsh(')
    // A password is used once and never kept.
    expect(code(service)).toContain("password: ''")
    for (const call of ['connectSsh', 'disconnectRemote', 'remoteProfiles']) {
      expect(code(renderer), call).not.toContain(call)
    }
  })

  it('draws the activity bar and panel header from components', () => {
    expect(renderer).toContain('<ActivityBar')
    expect(renderer).toContain('<PanelHeader')
    for (const name of ['ActivityBar', 'panel/PanelHeader']) {
      const source = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url), 'utf8')
      expect(code(source), name).not.toContain('window.tungsten')
      expect(code(source), name).not.toContain('useState')
    }
  })

  it('builds every dialog on one modal shell', () => {
    // Backdrop dismissal, Escape, the dialog role and the accessible name are
    // implemented once, so no dialog can be missing one of them.
    for (const [name, source] of Object.entries(dialogSource)) {
      expect(renderer, name).toContain(`<${name}`)
      expect(source, name).toContain('<Modal')
      expect(code(source), name).not.toContain('className="overlay"')
    }
    const modal = readFileSync(new URL('./components/Modal.tsx', import.meta.url), 'utf8')
    expect(modal).toContain("role=\"dialog\"")
    expect(modal).toContain('aria-modal')
    expect(modal).toContain("event.key !== 'Escape'")
    // The workbench no longer needs to know which dialogs are open to close
    // them; only the non-modal surfaces are left in the global handler.
    expect(renderer).not.toContain('setKeybindingsOpen(false); setNewFileOpen(false)')
  })

  it('splits the panel into problems and terminal components', () => {
    expect(renderer).toContain('<ProblemsPanel')
    expect(renderer).toContain('<TerminalPanel')
    expect(code(panelSource.ProblemsPanel)).not.toContain('window.tungsten')
    // The terminal decides between a PTY and the emulated shell from a prop,
    // so both paths stay renderable in a test.
    expect(code(panelSource.TerminalPanel)).not.toContain('window.tungsten')
    expect(panelSource.TerminalPanel).toContain('desktop ?')
  })

  it('scores quick access with the fuzzy scorer rather than substring matching', () => {
    const builder = readFileSync(new URL('./quickopen/paletteItems.ts', import.meta.url), 'utf8')
    expect(builder).toContain('scoreItem(')
    expect(builder).toContain('prepareQuery(')
    expect(builder).not.toContain('files.filter((file) => file.path.toLowerCase().includes(')
  })
})
