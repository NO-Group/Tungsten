import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
const rendererEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const configuredEditor = readFileSync(new URL('./components/ConfiguredEditor.tsx', import.meta.url), 'utf8')
const editorGroup = readFileSync(new URL('./components/EditorGroup.tsx', import.meta.url), 'utf8')
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
      expect(renderer, option).toContain(option)
    }
    expect(renderer).toContain('Replace All')
  })

  it('scores quick access with the fuzzy scorer rather than substring matching', () => {
    expect(renderer).toContain('scoreItem(')
    expect(renderer).toContain('prepareQuery(')
    expect(renderer).not.toContain('files.filter((file) => file.path.toLowerCase().includes(')
  })
})
