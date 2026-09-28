/**
 * @vitest-environment jsdom
 *
 * The workbench itself, mounted.
 *
 * Every other suite tests a view, a dialog or a model in isolation; this one
 * renders the whole application the way the browser build does, so that the
 * wiring between them -- a command reaching the state it changes, a service
 * reaching the view that draws it -- is covered by something.
 *
 * Monaco and xterm are replaced: both want a real layout engine, and neither
 * is what is under test here.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A textarea stands in for Monaco: it is controlled the same way, so typing
// into it exercises the real change, dirty and save path.
vi.mock('./components/ConfiguredEditor', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  default: ({ path, value, onChange }: { path: string; value: string; onChange?: (value: string) => void }) => (
    <textarea data-testid="editor" data-path={path} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} />
  ),
}))

vi.mock('./components/DesktopTerminal', () => ({
  DesktopTerminal: () => <div data-testid="desktop-terminal" />,
  default: () => <div data-testid="desktop-terminal" />,
}))

const { default: App } = await import('./App')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => { root.render(<App />) })
}

function text() {
  return container.textContent ?? ''
}

function buttonsLabelled(label: string) {
  return [...container.querySelectorAll('button')]
    .filter((button) => (button.getAttribute('aria-label') || button.textContent || '').trim() === label)
}

function click(element: Element) {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** Types into the stand-in editor, which marks the file dirty. */
function typeInEditor(value: string) {
  const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(editor, value)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/**
 * Types into a controlled input.
 *
 * React tracks the last value it wrote to the node, so assigning `.value`
 * directly is invisible to it; the native setter has to be called so the
 * tracker sees a change and the onChange handler fires.
 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }))
  })
}

/** Opens the palette, filters to one command and runs it. */
function run(query: string) {
  press('p', { ctrlKey: true, shiftKey: true })
  const input = container.querySelector<HTMLInputElement>('.command-palette input')!
  type(input, query)
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = () => undefined
  window.HTMLElement.prototype.scrollTo = () => undefined
  render()
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('the workbench', () => {
  it('renders its chrome: activity bar, editor, panel and status bar', async () => {
    expect(container.querySelector('.activitybar')).not.toBeNull()
    expect(container.querySelector('.sidebar')).not.toBeNull()
    expect(container.querySelector('.bottom-panel')).not.toBeNull()
    expect(container.querySelector('.statusbar')).not.toBeNull()
    // The editor is loaded lazily, so it arrives a microtask later.
    await act(async () => undefined)
    expect(container.querySelector('[data-testid="editor"]')).not.toBeNull()
  })

  it('opens the demo workspace with a file showing', () => {
    expect(text()).toContain('README.md')
  })

  it('switches views from the activity bar, and collapses on a second click', () => {
    const [search] = buttonsLabelled('Search')
    expect(search).toBeDefined()

    click(search)
    expect(container.querySelector('.sidebar')).not.toBeNull()
    expect(text()).toContain('SEARCH')

    click(buttonsLabelled('Search')[0])
    expect(container.querySelector('.sidebar')).toBeNull()
  })

  it('remembers the side bar being hidden across a restart', () => {
    click(buttonsLabelled('Explorer')[0])
    expect(container.querySelector('.sidebar')).toBeNull()

    act(() => { root.unmount() })
    container.remove()
    render()
    expect(container.querySelector('.sidebar')).toBeNull()
  })

  it('opens the command palette on its keybinding and filters as you type', () => {
    press('p', { ctrlKey: true, shiftKey: true })
    const input = container.querySelector<HTMLInputElement>('.command-palette input')
    expect(input).not.toBeNull()

    type(input!, 'zen mode')
    const rows = [...container.querySelectorAll('.palette-list [role="option"]')]
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Zen Mode')
  })

  it('runs a command from the palette', () => {
    press('p', { ctrlKey: true, shiftKey: true })
    const input = container.querySelector<HTMLInputElement>('.command-palette input')!
    type(input, 'toggle panel')
    expect(container.querySelector('.palette-list [role="option"]')?.textContent).toContain('Toggle Panel')
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })

    expect(container.querySelector('.command-palette')).toBeNull()
    expect(container.querySelector('.bottom-panel')).toBeNull()
  })

  it('opens a file from the explorer into a tab', () => {
    const row = [...container.querySelectorAll('.file-tree .tree-row')]
      .find((element) => element.textContent?.includes('package.json'))
    expect(row).toBeDefined()

    click(row!)
    const tabs = [...container.querySelectorAll('.editor-tab')].map((tab) => tab.textContent)
    expect(tabs.some((tab) => tab?.includes('package.json'))).toBe(true)
  })

  it('runs a command in the sandbox shell', () => {
    const input = container.querySelector<HTMLInputElement>('.bottom-panel input')!
    type(input, 'pwd')
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(container.querySelector('.terminal')?.textContent).toContain('/workspace/forge')
  })

  it('hides the activity bar on request, and brings it back', () => {
    run('toggle activity bar')
    expect(container.querySelector('.activitybar')).toBeNull()
    run('toggle activity bar')
    expect(container.querySelector('.activitybar')).not.toBeNull()
  })

  it('strips the workbench back to the editor in zen mode', () => {
    run('zen mode')
    expect(container.querySelector('.ide')?.className).toContain('zen-mode')
    for (const chrome of ['.titlebar', '.activitybar', '.sidebar', '.bottom-panel', '.statusbar']) {
      expect(container.querySelector(chrome), chrome).toBeNull()
    }
    expect(container.querySelector('.editor-groups')).not.toBeNull()

    run('zen mode')
    expect(container.querySelector('.statusbar')).not.toBeNull()
  })

  it('centres the editor on request', () => {
    run('centered layout')
    expect(container.querySelector('.ide')?.className).toContain('centered-layout')
  })

  it('creates a file, and opens it', () => {
    run('new file')
    const input = container.querySelector<HTMLInputElement>('.new-file-modal input')
    expect(input).not.toBeNull()
    type(input!, 'src/notes.ts')
    click(buttonsLabelled('Create file')[0])

    expect(container.querySelector('.new-file-modal')).toBeNull()
    expect([...container.querySelectorAll('.editor-tab')].some((tab) => tab.textContent?.includes('notes.ts'))).toBe(true)
    expect(container.querySelector('.file-tree')?.textContent).toContain('notes.ts')
  })

  it('opens the settings editor', () => {
    run('preferences open settings')
    expect(container.querySelector('.settings-editor')?.textContent).toContain('editor.fontSize')
  })

  it('changes a setting, and keeps it across a restart', () => {
    run('quick settings')
    const toggles = [...container.querySelectorAll<HTMLInputElement>('.toggle-setting input')]
    const minimap = toggles.find((input) => input.closest('label')?.textContent?.toLowerCase().includes('minimap'))
    expect(minimap).toBeDefined()
    const before = minimap!.checked

    click(minimap!)
    // Preferences are stored as configuration keys, whichever dialog set them.
    expect(JSON.parse(localStorage.getItem('tungsten.settings.v1') || '{}')['editor.minimap.enabled']).toBe(!before)

    act(() => { root.unmount() })
    container.remove()
    render()
    run('quick settings')
    const restored = [...container.querySelectorAll<HTMLInputElement>('.toggle-setting input')]
      .find((input) => input.closest('label')?.textContent?.toLowerCase().includes('minimap'))
    expect(restored?.checked).toBe(!before)
  })

  it('opens the keybindings editor with the commands listed', () => {
    run('keyboard shortcuts')
    const modal = container.querySelector('.keybindings-modal')
    expect(modal?.textContent).toContain('Keyboard Shortcuts')
    // Every row carries its command id as a tooltip.
    expect([...modal!.querySelectorAll('.keybinding-command')].map((row) => row.getAttribute('title')))
      .toContain('workbench.action.showCommands')
  })

  it('changes the colour theme', () => {
    run('color theme')
    const modal = container.querySelector('.theme-picker')
    expect(modal).not.toBeNull()
    const option = [...modal!.querySelectorAll('button')].find((button) => /light/i.test(button.textContent ?? ''))
    expect(option).toBeDefined()
    click(option!)
    expect(localStorage.getItem('tungsten.theme.v1')).toBeTruthy()
  })

  it('edits the same preferences from both dialogs', () => {
    // Quick settings turns the minimap off...
    run('quick settings')
    const minimap = [...container.querySelectorAll<HTMLInputElement>('.settings-modal .toggle-setting input')]
      .find((input) => input.closest('label')?.textContent?.toLowerCase().includes('minimap'))!
    click(minimap)
    click(buttonsLabelled('Done')[0])

    // ...and the settings editor shows it off, marked as changed.
    run('preferences open settings')
    const editorInput = container.querySelector<HTMLInputElement>('input[aria-label="editor.minimap.enabled"]')
    expect(editorInput?.checked).toBe(false)
    expect(container.querySelector('.settings-row.modified')).not.toBeNull()

    // Resetting it there puts the quick settings toggle back too.
    click(container.querySelector('[aria-label="Reset editor.minimap.enabled"]')!)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="editor.minimap.enabled"]')?.checked).toBe(true)
    expect(localStorage.getItem('tungsten.settings.v1')).toBe('{}')
  })

  it('changes a setting the quick dialog does not offer', () => {
    run('preferences open settings')
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    type(search, 'tabsize')
    const tabSize = container.querySelector<HTMLInputElement>('input[aria-label="editor.tabSize"]')!
    type(tabSize, '8')
    expect(JSON.parse(localStorage.getItem('tungsten.settings.v1') || '{}')['editor.tabSize']).toBe(8)
  })

  it('marks an edited file dirty, and saves what was typed', async () => {
    await act(async () => undefined)
    const path = container.querySelector('[data-testid="editor"]')!.getAttribute('data-path')!.replace('file:///', '')

    typeInEditor('# Edited\n')
    expect(container.querySelector('.editor-tab.active .tab-dirty')).not.toBeNull()

    run('save all')
    const stored = JSON.parse(localStorage.getItem('tungsten.workspace.v1') || '[]') as Array<{ path: string; content: string }>
    expect(stored.find((file) => file.path === path)?.content).toBe('# Edited\n')
    expect(container.querySelector('.editor-tab.active .tab-dirty')).toBeNull()
  })

  it('applies the on-save settings to the file it writes', async () => {
    await act(async () => undefined)
    const path = container.querySelector('[data-testid="editor"]')!.getAttribute('data-path')!.replace('file:///', '')

    run('preferences open settings')
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    type(search, 'trimTrailing')
    click(container.querySelector('input[aria-label="files.trimTrailingWhitespace"]')!)
    click(buttonsLabelled('Close settings')[0])

    typeInEditor('const a = 1   \nconst b = 2\t\n')
    run('save all')

    const stored = JSON.parse(localStorage.getItem('tungsten.workspace.v1') || '[]') as Array<{ path: string; content: string }>
    expect(stored.find((file) => file.path === path)?.content).toBe('const a = 1\nconst b = 2\n')
  })

  it('reports a clean problem count until a server says otherwise', () => {
    expect(container.querySelector('.statusbar')?.textContent).toContain('0')
  })
})

describe('the builder, from the workbench', () => {
  /** Opens the builder the way a user does: the activity bar icon. */
  function openBuilder() {
    click(buttonsLabelled('Builder')[0])
  }

  function paletteItem(label: string) {
    return [...container.querySelectorAll('.block-palette-item')]
      .find((item) => item.querySelector('.block-palette-label')?.textContent === label)!
  }

  it('is reachable from the activity bar, and shows the block library', () => {
    openBuilder()
    expect(container.querySelector('.builder-view')).not.toBeNull()
    expect(container.querySelectorAll('.block-palette-item').length).toBeGreaterThan(15)
  })

  it('replaces the editor area, and gives it back on close', () => {
    openBuilder()
    expect(container.querySelector('.editor-groups')).toBeNull()
    click(buttonsLabelled('Close the builder')[0])
    expect(container.querySelector('.builder-view')).toBeNull()
    expect(container.querySelector('.editor-groups')).not.toBeNull()
  })

  it('opens from the command palette', () => {
    run('Open Visual Builder')
    expect(container.querySelector('.builder-view')).not.toBeNull()
  })

  it('adds a block from the sidebar onto the canvas', () => {
    openBuilder()
    click(paletteItem('On App Start'))
    expect(container.querySelectorAll('.builder-node').length).toBe(1)
  })

  it('writes the generated program into the workspace as a file', () => {
    openBuilder()
    click(paletteItem('On App Start'))
    click([...container.querySelectorAll('.builder-toolbar button')]
      .find((button) => button.textContent?.includes('Write to file'))!)
    expect(container.querySelector('.builder-view')).toBeNull()
    expect(container.querySelector('[data-testid="editor"]')?.getAttribute('data-path'))
      .toContain('src/generated/blocks.ts')
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')?.value)
      .toContain('app.onStart(async () => {')
  })

  it('builds a web bundle into the workspace', () => {
    openBuilder()
    click(paletteItem('On App Start'))
    click([...container.querySelectorAll('.builder-toolbar button')]
      .find((button) => button.textContent?.includes('Build'))!)
    expect(container.querySelector('[data-testid="editor"]')?.getAttribute('data-path'))
      .toContain('build/web/index.html')
    expect(text()).toContain('Built 4 files for web')
  })

  it('refuses to build a graph the checker rejects', () => {
    openBuilder()
    click(paletteItem('On App Start'))
    click(paletteItem('Upload File'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]')!)
    click(container.querySelector('[aria-label="Input Run of Upload File"]')!)

    // Upload needs a file, and nothing is plugged into it.
    expect(container.querySelector('.builder-state')?.textContent).toContain('error')
    const build = [...container.querySelectorAll('.builder-toolbar button')]
      .find((button) => button.textContent?.includes('Build')) as HTMLButtonElement
    expect(build.disabled).toBe(true)
  })

  it('registers a plugin block written into the workspace', () => {
    run('Add an Example Block Plugin')
    expect(container.querySelector('[data-testid="editor"]')?.getAttribute('data-path'))
      .toContain('plugins/notify.block.json')
    openBuilder()
    expect([...container.querySelectorAll('.block-palette-label')].map((item) => item.textContent))
      .toContain('Send Notification')
    expect(container.querySelector('.block-palette-footer')?.textContent).toContain('1 from plugins')
  })
})

describe('the shell dictionary, from the workbench', () => {
  /** Opens the dictionary the way a user does: the activity bar icon. */
  function openDictionary() {
    click(buttonsLabelled('Shell Dictionary')[0])
  }

  function searchDictionary(value: string) {
    type(container.querySelector<HTMLInputElement>('.dictionary-search input')!, value)
  }

  function terminalText() {
    return [...container.querySelectorAll('.terminal-line')].map((line) => line.textContent).join('\n')
  }

  function runInTerminal(command: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Terminal input"]')!
    type(input, command)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }

  it('is reachable from the activity bar and lists hundreds of commands', () => {
    openDictionary()
    expect(container.querySelector('.dictionary-list')).not.toBeNull()
    expect(container.querySelector('.dictionary-footer')?.textContent).toMatch(/\d{3} commands/)
  })

  it('opens a manual page from the sidebar', () => {
    openDictionary()
    searchDictionary('rsync')
    click(container.querySelector('.dictionary-item')!)
    expect(container.querySelector('.dictionary-synopsis')?.textContent).toContain('rsync [OPTION]...')
  })

  it('runs an example straight into the terminal', () => {
    openDictionary()
    searchDictionary('tar')
    click([...container.querySelectorAll('.dictionary-item')][0])
    click(container.querySelector('.dictionary-example button')!)
    expect(terminalText()).toContain('tar czf')
  })

  it('answers man at the prompt, from the dictionary', () => {
    runInTerminal('man grep')
    const text = terminalText()
    expect(text).toContain('grep — Print lines matching a pattern')
    expect(text).toContain('SYNOPSIS')
    expect(text).toContain('-r, -R')
  })

  it('suggests the command behind a typo instead of only refusing', () => {
    runInTerminal('gti status')
    expect(terminalText()).toContain('Did you mean: git')
  })

  it('explains what is typed, under the prompt, as it is typed', () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Terminal input"]')!
    type(input, 'tar xzf release.tgz')
    expect(container.querySelector('.terminal-hint')?.textContent)
      .toContain('tar — Create and extract tar archives')
  })

  it('reads the typed line back in English from the command palette', () => {
    type(container.querySelector<HTMLInputElement>('[aria-label="Terminal input"]')!, 'rm -rf build')
    run('Explain the Terminal Command')
    const text = terminalText()
    expect(text).toContain('rm — Remove files and directories')
    expect(text).toContain('-r — Remove directories and their contents')
    expect(text).toContain('There is no undo')
  })

  it('opens from the command palette', () => {
    run('Shell Dictionary: Browse Commands')
    expect(container.querySelector('.dictionary-list')).not.toBeNull()
  })

  it('documents a workspace command, and then answers questions about it', () => {
    run('Document a Command')
    expect(text()).toContain('team.commands.json')

    openDictionary()
    expect(container.querySelector('.dictionary-footer')?.textContent).toContain('1 from this workspace')
    searchDictionary('deploy')
    expect(container.querySelector('.dictionary-item')?.textContent).toContain('Ship the current branch to staging')

    runInTerminal('whatis deploy')
    expect(terminalText()).toContain('Ship the current branch to staging')
  })
})

describe('the terminal, when a real shell is behind it', () => {
  /**
   * Answers the health probe the way the dev server does.
   *
   * The workbench decides between a real PTY and the emulated shell from that
   * one answer, so faking it here exercises the same branch a browser takes.
   */
  function withShellServer(available: boolean) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/__tungsten/shell/health')) {
        return new Response(
          JSON.stringify({ available, shell: '/bin/bash', cwd: '/w', sessions: 0, maxSessions: 12 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchImpl)
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('uses the emulated shell when nothing is hosting a process', async () => {
    withShellServer(false)
    act(() => { root.unmount() })
    render()
    await act(async () => undefined)
    expect(container.querySelector('[aria-label="Terminal input"]')).not.toBeNull()
    expect(container.querySelector('.terminal-name')?.textContent).toContain('sandbox')
  })

  it('attaches xterm to the real shell when the server offers one', async () => {
    withShellServer(true)
    act(() => { root.unmount() })
    render()
    await act(async () => undefined)
    expect(container.querySelector('[data-testid="desktop-terminal"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Terminal input"]')).toBeNull()
    expect(container.querySelector('.terminal-name')?.textContent).toContain('pty')
  })

  it('sends a dictionary example to the real shell rather than emulating it', async () => {
    withShellServer(true)
    act(() => { root.unmount() })
    render()
    await act(async () => undefined)

    click(buttonsLabelled('Shell Dictionary')[0])
    type(container.querySelector<HTMLInputElement>('.dictionary-search input')!, 'tar')
    click([...container.querySelectorAll('.dictionary-item')][0])
    click(container.querySelector('.dictionary-example button')!)

    // Nothing is echoed into an emulated scrollback: the command went to the
    // process, which is what the xterm view is showing.
    expect(container.querySelector('[data-testid="desktop-terminal"]')).not.toBeNull()
    expect(container.querySelectorAll('.terminal-line').length).toBe(0)
  })
})
