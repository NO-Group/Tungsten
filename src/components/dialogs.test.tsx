/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for the modal surfaces.
 *
 * Dialogs are where keyboard handling goes wrong quietly, so these drive the
 * parts a click-through would miss: Escape and backdrop dismissal, list
 * navigation that wraps, and a keybinding recording that must swallow the very
 * keys the workbench is listening for.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal'
import { CommandPalette, type PaletteEntry } from './dialogs/CommandPalette'
import { ThemePicker } from './dialogs/ThemePicker'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { SettingsEditor } from './dialogs/SettingsEditor'
import { KeybindingsEditor } from './dialogs/KeybindingsEditor'
import { NewFileDialog } from './dialogs/NewFileDialog'
import { ContextMenu } from './ContextMenu'
import { configurationSchema } from '../configuration/configurationRegistry'
import { defaultSettings } from '../settings'
import { themes } from '../theme/themeService'
import { Command } from 'lucide-react'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no layout, so scrolling the active row into view is a no-op here.
Element.prototype.scrollIntoView = vi.fn()

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

function render(element: React.ReactNode) {
  act(() => root.render(element))
  return container
}

function press(key: string, target: Element | Document = document) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
}

function button(text: string) {
  const match = [...container.querySelectorAll('button')].find((node) => (
    node.textContent?.includes(text) || node.getAttribute('aria-label') === text || node.title === text
  ))
  if (!match) throw new Error(`No button matching "${text}" in: ${container.textContent}`)
  return match
}

const noop = () => {}

describe('modal shell', () => {
  it('names the dialog and dismisses on Escape or a backdrop click', () => {
    const onClose = vi.fn()
    render(<Modal label="Example" className="example-modal" onClose={onClose}>body</Modal>)
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-label')).toBe('Example')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => { container.querySelector<HTMLElement>('.overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves clicks inside the card alone', () => {
    const onClose = vi.fn()
    render(<Modal label="Example" className="example-modal" onClose={onClose}>body</Modal>)
    act(() => { container.querySelector<HTMLElement>('.example-modal')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('only closes the topmost dialog', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <Modal label="Outer" className="outer" onClose={outer}>outer</Modal>
        <Modal label="Inner" className="inner" onClose={inner}>inner</Modal>
      </>,
    )
    press('Escape')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('command palette', () => {
  const entry = (id: string, label: string): PaletteEntry => ({
    id, label, detail: `runs ${label}`, icon: Command, action: noop, labelMatch: [], detailMatch: [],
  })
  const items = [entry('a', 'Save'), entry('b', 'Save All'), entry('c', 'Close')]
  const props = {
    query: 'sa', onQueryChange: noop, items, index: 0, onIndexChange: noop,
    modeLabel: 'COMMANDS', placeholder: 'Type a command', onRun: noop, onClose: noop,
  }

  it('wraps around the list and announces the active row', () => {
    const onIndexChange = vi.fn()
    render(<CommandPalette {...props} index={2} onIndexChange={onIndexChange} />)
    const input = container.querySelector('input')!
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-item-2')
    expect(document.activeElement).toBe(input)

    press('ArrowDown', input)
    expect(onIndexChange).toHaveBeenLastCalledWith(0)
    press('ArrowUp', input)
    expect(onIndexChange).toHaveBeenLastCalledWith(1)
    press('Home', input)
    expect(onIndexChange).toHaveBeenLastCalledWith(0)
    press('End', input)
    expect(onIndexChange).toHaveBeenLastCalledWith(2)
  })

  it('runs the highlighted entry on Enter', () => {
    const onRun = vi.fn()
    render(<CommandPalette {...props} index={1} onRun={onRun} />)
    press('Enter', container.querySelector('input')!)
    expect(onRun).toHaveBeenCalledWith(items[1])
  })

  it('says so when nothing matches', () => {
    render(<CommandPalette {...props} items={[]} />)
    expect(container.textContent).toContain('No matching commands')
    expect(container.textContent).toContain('COMMANDS · 0 results')
  })
})

describe('theme picker', () => {
  const list = themes.slice(0, 3)

  it('previews as the selection moves and only applies on Enter', () => {
    const onPreview = vi.fn()
    const onApply = vi.fn()
    render(
      <ThemePicker themes={list} activeId={list[0].id} query="" onQueryChange={noop} onPreview={onPreview} onApply={onApply} onCancel={noop} />,
    )
    const input = container.querySelector('input')!
    press('ArrowDown', input)
    expect(onPreview).toHaveBeenCalledWith(list[1].id)
    expect(onApply).not.toHaveBeenCalled()
    press('Enter', input)
    expect(onApply).toHaveBeenCalledWith(list[0])
  })

  it('cancels rather than applying when dismissed', () => {
    const onCancel = vi.fn()
    render(
      <ThemePicker themes={list} activeId={list[0].id} query="" onQueryChange={noop} onPreview={noop} onApply={noop} onCancel={onCancel} />,
    )
    press('Escape')
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('settings', () => {
  it('edits a toggle and a range without touching the rest', () => {
    const onChange = vi.fn()
    render(
      <SettingsDialog settings={defaultSettings} onChange={onChange} keybindingShortcut="Ctrl+K Ctrl+S" onOpenKeybindings={noop} onClose={noop} />,
    )
    const minimap = [...container.querySelectorAll('label.toggle-setting')]
      .find((node) => node.textContent?.includes('Minimap'))!
      .querySelector('input')!
    expect(minimap.checked).toBe(true)
    act(() => { minimap.click() })
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, minimap: false })
  })

  it('applies a profile wholesale', () => {
    const onChange = vi.fn()
    render(
      <SettingsDialog settings={defaultSettings} onChange={onChange} keybindingShortcut="" onOpenKeybindings={noop} onClose={noop} />,
    )
    act(() => { button('Accessible').click() })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ highContrast: true, reducedMotion: true, screenReaderOptimized: true }))
  })

  const settingsEditorProps = {
    query: '',
    onQueryChange: noop,
    schema: configurationSchema,
    values: Object.fromEntries(Object.entries(configurationSchema).map(([key, schema]) => [key, schema.default])),
    modified: new Set<string>(),
    onChange: noop,
    onReset: noop,
    onClose: noop,
  }

  it('browses the configuration registry and reports an empty search', () => {
    const key = Object.keys(configurationSchema)[0]
    render(<SettingsEditor {...settingsEditorProps} groups={[{ category: 'Editor', keys: [key] }]} />)
    expect(container.textContent).toContain(key)
    expect(container.textContent).toContain('1 setting')

    render(<SettingsEditor {...settingsEditorProps} query="zzz" groups={[]} />)
    expect(container.textContent).toContain('No settings match')
  })

  it('edits a setting with the control its schema calls for', () => {
    const onChange = vi.fn()
    render(
      <SettingsEditor
        {...settingsEditorProps}
        onChange={onChange}
        groups={[{ category: 'Editor', keys: ['editor.minimap.enabled', 'editor.fontSize', 'editor.wordWrap'] }]}
      />,
    )

    const minimap = container.querySelector<HTMLInputElement>('input[aria-label="editor.minimap.enabled"]')!
    expect(minimap.type).toBe('checkbox')
    act(() => { minimap.click() })
    expect(onChange).toHaveBeenCalledWith('editor.minimap.enabled', false)

    expect(container.querySelector<HTMLInputElement>('input[aria-label="editor.fontSize"]')?.type).toBe('number')
    // An enum is a menu of exactly the values the schema allows.
    const wordWrap = container.querySelector<HTMLSelectElement>('select[aria-label="editor.wordWrap"]')!
    expect([...wordWrap.options].map((option) => option.value)).toEqual(['off', 'on', 'wordWrapColumn', 'bounded'])
  })

  it('marks a changed setting and offers to put it back', () => {
    const onReset = vi.fn()
    render(
      <SettingsEditor
        {...settingsEditorProps}
        modified={new Set(['editor.fontSize'])}
        onReset={onReset}
        groups={[{ category: 'Editor', keys: ['editor.fontSize'] }]}
      />,
    )
    expect(container.querySelector('.settings-row.modified')).not.toBeNull()
    expect(container.textContent).toContain('1 changed')

    act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Reset editor.fontSize"]')!.click() })
    expect(onReset).toHaveBeenCalledWith('editor.fontSize')
  })
})

describe('keybindings editor', () => {
  const rows = [{ command: { id: 'workbench.action.files.save', label: 'File: Save' } }]
  const props = {
    rows, filter: '', onFilterChange: noop, recording: null as string | null, onRecordingChange: noop,
    customised: [], activeBindingCount: 42, onBind: noop, onUnbind: noop, onReset: noop,
    onResetAll: noop, onClose: noop,
  }

  it('arms a row, then records the next chord', () => {
    const onRecordingChange = vi.fn()
    const onBind = vi.fn()
    render(<KeybindingsEditor {...props} onRecordingChange={onRecordingChange} />)
    expect(container.textContent).toContain('Unassigned')
    act(() => { container.querySelector<HTMLElement>('.keybinding-input')!.click() })
    expect(onRecordingChange).toHaveBeenCalledWith('workbench.action.files.save')

    render(<KeybindingsEditor {...props} recording="workbench.action.files.save" onBind={onBind} />)
    expect(container.textContent).toContain('Press keys…')
    const input = container.querySelector('.keybinding-input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })) })
    expect(onBind).toHaveBeenCalledWith('workbench.action.files.save', 'ctrl+k')
  })

  it('unbinds with Backspace and cancels with Escape instead of closing', () => {
    const onUnbind = vi.fn()
    const onRecordingChange = vi.fn()
    const onClose = vi.fn()
    render(
      <KeybindingsEditor {...props} recording="workbench.action.files.save" onUnbind={onUnbind} onRecordingChange={onRecordingChange} onClose={onClose} />,
    )
    const input = container.querySelector('.keybinding-input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })) })
    expect(onUnbind).toHaveBeenCalledWith('workbench.action.files.save')

    press('Escape')
    expect(onRecordingChange).toHaveBeenCalledWith(null)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers a reset only for commands the user changed', () => {
    render(<KeybindingsEditor {...props} />)
    expect(container.querySelector('.keybinding-actions button')).toBeNull()
    render(<KeybindingsEditor {...props} customised={['workbench.action.files.save']} />)
    expect(container.querySelector('.keybinding-actions button')).toBeTruthy()
    expect(container.textContent).toContain('1 customised · 42 active bindings')
  })
})

describe('new file dialog', () => {
  const ref = { current: null }

  it('creates on Enter and refuses an empty path', () => {
    const onSubmit = vi.fn()
    render(<NewFileDialog renameTarget={null} value="" onChange={noop} onSubmit={onSubmit} onCancel={noop} inputRef={ref} />)
    expect((button('Create file') as HTMLButtonElement).disabled).toBe(true)

    render(<NewFileDialog renameTarget={null} value="src/a.ts" onChange={noop} onSubmit={onSubmit} onCancel={noop} inputRef={ref} />)
    press('Enter', container.querySelector('input')!)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('becomes a rename dialog when given a target', () => {
    render(<NewFileDialog renameTarget="src/a.ts" value="src/a.ts" onChange={noop} onSubmit={noop} onCancel={noop} inputRef={ref} />)
    expect(container.textContent).toContain('Rename file')
    expect(container.textContent).toContain('Change the file name or move it to another folder.')
  })
})

describe('context menu', () => {
  const props = {
    x: 10, y: 10, path: 'src/app.ts', canReveal: false,
    onOpen: noop, onRename: noop, onCopyPath: noop, onReveal: noop, onDelete: noop,
  }

  it('hides the desktop-only action in the browser', () => {
    render(<ContextMenu {...props} />)
    expect(container.textContent).not.toContain('Reveal in file manager')
    render(<ContextMenu {...props} canReveal />)
    expect(container.textContent).toContain('Reveal in file manager')
  })

  it('stays on screen when opened near an edge', () => {
    render(<ContextMenu {...props} x={window.innerWidth} y={window.innerHeight} />)
    const menu = container.querySelector<HTMLElement>('.context-menu')!
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThan(window.innerWidth)
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(window.innerHeight)
  })
})
