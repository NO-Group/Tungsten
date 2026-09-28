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

vi.mock('./components/ConfiguredEditor', () => ({
  ConfiguredEditor: ({ path, value }: { path: string; value: string }) => (
    <div data-testid="editor" data-path={path}>{value}</div>
  ),
  ConfiguredDiffEditor: () => <div data-testid="diff-editor" />,
  default: () => <div data-testid="editor" />,
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
    expect(container.querySelector('.settings-editor')?.textContent).toContain('Settings')
  })

  it('changes a setting, and keeps it across a restart', () => {
    run('quick settings')
    const toggles = [...container.querySelectorAll<HTMLInputElement>('.toggle-setting input')]
    const minimap = toggles.find((input) => input.closest('label')?.textContent?.toLowerCase().includes('minimap'))
    expect(minimap).toBeDefined()
    const before = minimap!.checked

    click(minimap!)
    expect(JSON.parse(localStorage.getItem('tungsten.settings.v1') || '{}').minimap).toBe(!before)

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

  it('reports a clean problem count until a server says otherwise', () => {
    expect(container.querySelector('.statusbar')?.textContent).toContain('0')
  })
})
