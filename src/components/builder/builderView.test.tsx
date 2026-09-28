/**
 * @vitest-environment jsdom
 *
 * The builder as the user meets it: add a block from the library, see the
 * code appear, break the code and watch the canvas protect itself.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetIds } from '../../builder/graph'
import { PARSE_DEBOUNCE } from '../../builder/useBuilder'

// Monaco cannot run in jsdom; the code pane becomes a textarea that behaves
// the same way from the outside: it shows `value` and reports edits.
vi.mock('../ConfiguredEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea data-testid="code" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  DiffEditor: () => null,
}))

const { BuilderView } = await import('./BuilderView')
const { BlockPalette } = await import('./BlockPalette')
const { useBuilder } = await import('../../builder/useBuilder')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const notify = vi.fn()

/** The builder surface plus its sidebar palette, wired as App wires them. */
function Harness() {
  const builder = useBuilder({ notify })
  return (
    <>
      <BlockPalette registry={builder.registry} onAdd={builder.addBlock} />
      <BuilderView
        builder={builder}
        editorOptions={{}}
        theme="tungsten"
        onExport={() => undefined}
        onClose={() => undefined}
      />
    </>
  )
}

function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
}

/** Sets a controlled input the way a user would, through React's onChange. */
function type(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  act(() => { element.dispatchEvent(new Event('input', { bubbles: true })) })
}

function click(element: Element | null | undefined) {
  act(() => { (element as HTMLElement).click() })
}

function palette(label: string) {
  return [...container.querySelectorAll('.block-palette-item')]
    .find((item) => item.querySelector('.block-palette-label')?.textContent === label)
}

const code = () => (container.querySelector('[data-testid="code"]') as HTMLTextAreaElement).value

beforeEach(() => {
  localStorage.clear()
  resetIds()
  notify.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers()
  render()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('the builder surface', () => {
  it('starts empty and says so in both panes', () => {
    expect(container.querySelector('.builder-empty')?.textContent).toContain('Pick a block')
    expect(code()).toContain('No events yet')
  })

  it('lists every built-in block, grouped', () => {
    expect(container.querySelectorAll('.block-palette-item').length).toBe(18)
    expect(container.querySelectorAll('.block-palette-groups section').length).toBe(7)
  })

  it('filters the library', () => {
    type(container.querySelector('.block-palette-filter') as HTMLInputElement, 'upload')
    expect(container.querySelectorAll('.block-palette-item').length).toBe(1)
  })

  it('adds a block and writes the code for it', () => {
    click(palette('On App Start'))
    expect(container.querySelectorAll('.builder-node').length).toBe(1)
    expect(code()).toContain('app.onStart(async () => {')
  })

  it('links two blocks by clicking a port on each', () => {
    click(palette('On App Start'))
    click(palette('Log'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Log"]'))
    expect(code()).toContain('console.log("Hello")')
  })

  it('refuses a link between mismatched ports and says why', () => {
    click(palette('Text Value'))
    click(palette('Math'))
    click(container.querySelector('[aria-label="Output Value of Text Value"]'))
    click(container.querySelector('[aria-label="Input Left of Math"]'))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('does not fit'))
  })

  it('dims a block nothing leads to, and warns without blocking', () => {
    click(palette('Log'))
    expect(container.querySelector('.builder-node')?.className).toContain('orphan')
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')
    expect(container.querySelector('.builder-problem.warning')?.textContent).toContain('not connected')
  })

  it('blocks compilation when a required input is empty', () => {
    click(palette('On App Start'))
    click(palette('Upload File'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Upload File"]'))
    expect(container.querySelector('.builder-state')?.textContent).toContain('error')
    expect(container.querySelector('.builder-problem.error')?.textContent).toContain('needs an object')
  })

  it('types a value into a port and puts it in the code', () => {
    click(palette('On App Start'))
    click(palette('Log'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Log"]'))
    type(container.querySelector('[aria-label="Value value"]') as HTMLInputElement, 'shipped')
    expect(code()).toContain('console.log("shipped")')
  })

  it('follows an edit in the code pane back onto the canvas, after a pause', () => {
    type(
      container.querySelector('[data-testid="code"]') as HTMLTextAreaElement,
      'app.onStart(async () => {\n  console.log("typed")\n})\n',
    )
    expect(container.querySelectorAll('.builder-node').length).toBe(0)
    act(() => { vi.advanceTimersByTime(PARSE_DEBOUNCE) })
    expect(container.querySelectorAll('.builder-node').length).toBe(2)
  })

  it('does not rewrite the text the user is typing', () => {
    const editor = container.querySelector('[data-testid="code"]') as HTMLTextAreaElement
    const text = 'app.onStart(async () => {\n  console.log("mine")\n})\n'
    type(editor, text)
    act(() => { vi.advanceTimersByTime(PARSE_DEBOUNCE) })
    expect(code()).toBe(text)
  })

  it('falls into a read-only state when the code cannot be read as blocks', () => {
    type(
      container.querySelector('[data-testid="code"]') as HTMLTextAreaElement,
      'app.onStart(async () => {\n  launchMissiles()\n})\n',
    )
    act(() => { vi.advanceTimersByTime(PARSE_DEBOUNCE) })
    expect(container.querySelector('.builder-banner')?.textContent).toContain('Line 2')
    expect(container.querySelector('.builder-canvas')?.className).toContain('read-only')
    expect(container.querySelector('.builder-state')?.textContent).toContain('Read-only')
  })

  it('recovers from the read-only state when the code parses again', () => {
    const editor = container.querySelector('[data-testid="code"]') as HTMLTextAreaElement
    type(editor, 'app.onStart(async () => {\n  launchMissiles()\n})\n')
    act(() => { vi.advanceTimersByTime(PARSE_DEBOUNCE) })
    type(editor, 'app.onStart(async () => {\n  console.log("fixed")\n})\n')
    act(() => { vi.advanceTimersByTime(PARSE_DEBOUNCE) })
    expect(container.querySelector('.builder-banner')).toBeNull()
    expect(code()).toContain('console.log("fixed")')
  })

  it('selects the faulty block when a problem is clicked', () => {
    click(palette('On App Start'))
    click(palette('Upload File'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Upload File"]'))
    click(container.querySelector('.builder-problem.error'))
    expect(container.querySelector('.builder-node.selected .builder-node-title')?.textContent).toBe('Upload File')
  })

  it('deletes a block from its own header', () => {
    click(palette('Log'))
    click(container.querySelector('[aria-label="Delete Log"]'))
    expect(container.querySelectorAll('.builder-node').length).toBe(0)
  })

  it('keeps the graph across a remount', () => {
    click(palette('On App Start'))
    act(() => root.unmount())
    container.remove()
    render()
    expect(container.querySelectorAll('.builder-node').length).toBe(1)
  })
})
