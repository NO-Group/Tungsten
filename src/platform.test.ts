import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
const rendererEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const configuredEditor = readFileSync(new URL('./components/ConfiguredEditor.tsx', import.meta.url), 'utf8')

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
    expect(renderer).toContain("KEYBINDINGS_KEY = 'tungsten.keybindings.v1'")
    expect(renderer).toContain('shortcutFromEvent')
    expect(renderer).toContain("inlineClassName: 'debug-inline-value'")
  })
})
