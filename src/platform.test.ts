import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
const panelSource = Object.fromEntries(['ProblemsPanel', 'TerminalPanel'].map((name) => [
  name,
  readFileSync(new URL(`./components/panel/${name}.tsx`, import.meta.url), 'utf8'),
])) as Record<string, string>
/** Strips comments so prose about an API is not mistaken for a call to it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** Everything the workbench renders, whichever file it now lives in. */
const workbench = [renderer, editorGroup, ...Object.values(sidebarSource), ...Object.values(panelSource)].join('\n')
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
    expect(renderer).toContain('searchFiles(')
    expect(renderer).toContain('groupMarkersByResource')
    expect(renderer).toContain('configurationByCategory')
  })

  it('keeps the native ripgrep path for files outside the in-memory index', () => {
    // The client-side matcher only sees indexed files, so dropping ripgrep
    // would silently lose results on large desktop workspaces.
    expect(renderer).toContain('searchWorkspace')
    expect(renderer).toContain('nativeSearchUsable')
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
    expect(renderer).toContain('scoreItem(')
    expect(renderer).toContain('prepareQuery(')
    expect(renderer).not.toContain('files.filter((file) => file.path.toLowerCase().includes(')
  })
})
