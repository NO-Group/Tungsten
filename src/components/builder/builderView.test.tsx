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
import { PREVIEW_CHANNEL } from '../../builder/previewRuntime'
import { EXAMPLE_PLUGIN, loadPluginBlocks } from '../../builder/pluginBlocks'
import { builtinBlocks } from '../../builder/blockLibrary'
import { BLOCK_DRAG_TYPE, GRID } from '../../builder/canvasLayout'

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

const plugins = loadPluginBlocks([{ path: 'plugins/notify.block.json', content: EXAMPLE_PLUGIN }])

/** The builder surface plus its sidebar palette, wired as App wires them. */
function Harness() {
  const builder = useBuilder({ notify, plugins: plugins.blocks })
  return (
    <>
      <BlockPalette
        registry={builder.registry}
        pluginCount={plugins.blocks.length}
        pluginProblems={plugins.problems}
        onAdd={builder.addBlock}
      />
      <BuilderView
        builder={builder}
        editorOptions={{}}
        theme="tungsten"
        onExport={() => undefined}
        onBuild={() => undefined}
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

/**
 * Lets passive effects run.
 *
 * React flushes them through the host scheduler, which these tests have
 * swapped for fake timers, so an effect's work -- persistence, in particular
 * -- has not happened yet when a click returns. An async `act` yields far
 * enough for the scheduler to drain.
 */
async function flushEffects() {
  // The scheduler that drains React's passive effects runs on a macrotask,
  // which fake timers do not advance; the test has to hand the event loop
  // back for real before an effect's work can be observed.
  vi.useRealTimers()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  vi.useFakeTimers()
}

function palette(label: string) {
  return [...container.querySelectorAll('.block-palette-item')]
    .find((item) => item.querySelector('.block-palette-label')?.textContent === label)
}

const code = () => (container.querySelector('[data-testid="code"]') as HTMLTextAreaElement).value

const canvas = () => container.querySelector('.builder-canvas')!
const nodes = () => [...container.querySelectorAll('.builder-node')] as HTMLElement[]
const pin = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!

/**
 * A drag payload.
 *
 * jsdom has no DataTransfer, and the component only ever asks it three
 * things, so the stub answers those three.
 */
function transfer(type?: string, value?: string) {
  return {
    types: type ? [type] : [],
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: (asked: string) => (asked === type ? value ?? '' : ''),
    setData: () => undefined,
  }
}

/** Dispatches a drag event React will pick up, with coordinates. */
function fireDrag(target: Element, kind: 'dragover' | 'drop' | 'dragleave', at: { x: number; y: number }, data = transfer(BLOCK_DRAG_TYPE, 'ui.button')) {
  const event = new Event(kind, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: data },
    clientX: { value: at.x },
    clientY: { value: at.y },
  })
  act(() => { target.dispatchEvent(event) })
}

/** Pointer events, which jsdom does not construct for us either. */
function firePointer(target: Element | Window, kind: string, at: { x: number; y: number }) {
  const event = new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
  act(() => { target.dispatchEvent(event) })
}

function fireMouse(target: Element | Window, kind: string, at: { x: number; y: number }) {
  const event = new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
  act(() => { target.dispatchEvent(event) })
}

beforeEach(() => {
  localStorage.clear()
  resetIds()
  notify.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
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
    expect(container.querySelector('.builder-empty')?.textContent).toContain('Drag a block')
    expect(code()).toContain('No events yet')
  })

  it('lists every built-in block plus the workspace plugins, grouped', () => {
    // Counted against the library itself, so adding a block does not mean
    // editing a number here.
    expect(container.querySelectorAll('.block-palette-item').length)
      .toBe(builtinBlocks.length + plugins.blocks.length)
    expect(container.querySelectorAll('.block-palette-groups section').length).toBe(7)
    expect(container.querySelector('.block-palette-footer')?.textContent).toContain('1 from plugins')
  })

  it('offers a plugin block that generates its own template', () => {
    click(palette('Send Notification'))
    expect(code()).toContain('// No events yet')
    expect(container.querySelectorAll('.builder-node').length).toBe(1)
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

  it('keeps the graph across a remount', async () => {
    click(palette('On App Start'))
    await flushEffects()
    act(() => root.unmount())
    container.remove()
    render()
    expect(container.querySelectorAll('.builder-node').length).toBe(1)
  })
})

describe('the preview, the database and the build', () => {
  const tab = (label: string) => [...container.querySelectorAll('.builder-tabs button')]
    .find((button) => button.textContent?.trim().startsWith(label))

  /** Wires a button to a click handler that logs, the whole app in four clicks. */
  function clickableApp() {
    click(palette('Button'))
    click(palette('On Click'))
    click(palette('Log'))
    click(container.querySelector('[aria-label="Output Then of On Click"]'))
    click(container.querySelector('[aria-label="Input Run of Log"]'))
  }

  it('runs the interface in a sandboxed frame', () => {
    clickableApp()
    click(tab('Preview'))
    const frame = container.querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<button id="submit"')
    expect(frame.getAttribute('srcdoc')).toContain('app.onClick')
  })

  it('shows what the running app logs', () => {
    click(tab('Preview'))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { channel: PREVIEW_CHANNEL, kind: 'log', text: 'saved' },
      }))
    })
    expect(container.querySelector('.builder-console-lines')?.textContent).toContain('saved')
  })

  it('ignores messages that are not the preview talking', () => {
    click(tab('Preview'))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { kind: 'log', text: 'from somewhere else' } }))
    })
    expect(container.querySelector('.builder-console-lines')?.textContent).toContain('Nothing logged yet')
  })

  it('traces a runtime failure back to the block that threw', () => {
    click(palette('On App Start'))
    click(palette('Log'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Log"]'))
    const line = code().split('\n').findIndex((text) => text.includes('console.log')) + 1
    click(tab('Preview'))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { channel: PREVIEW_CHANNEL, kind: 'error', text: 'x is not defined', line },
      }))
    })
    expect(container.querySelector('.builder-preview-failure')?.textContent).toContain('“Log” failed while running')
    expect(container.querySelector('.builder-node.selected .builder-node-title')?.textContent).toBe('Log')
  })

  it('draws a table and shows the migration it will write', () => {
    click(tab('Data'))
    click(container.querySelector('.builder-schema header button'))
    type(container.querySelector('[aria-label="Table 1 name"]') as HTMLInputElement, 'posts')
    expect(container.querySelector('.builder-migration')?.textContent).toContain('create table if not exists posts')
    expect(container.querySelector('.builder-migration')?.textContent).toContain('id bigserial primary key')
  })

  it('adds and removes columns', () => {
    click(tab('Data'))
    click(container.querySelector('.builder-schema header button'))
    click(container.querySelector('.builder-add-column'))
    expect(container.querySelectorAll('.builder-table li').length).toBe(2)
    click(container.querySelector('[aria-label="Delete column column_2"]'))
    expect(container.querySelectorAll('.builder-table li').length).toBe(1)
  })

  it('keeps the schema across a remount', async () => {
    click(tab('Data'))
    click(container.querySelector('.builder-schema header button'))
    await flushEffects()
    act(() => root.unmount())
    container.remove()
    render()
    click(tab('Data'))
    expect(container.querySelectorAll('.builder-table').length).toBe(1)
  })

  it('will not build while the graph has errors', () => {
    click(palette('On App Start'))
    click(palette('Upload File'))
    click(container.querySelector('[aria-label="Output Then of On App Start"]'))
    click(container.querySelector('[aria-label="Input Run of Upload File"]'))
    const build = [...container.querySelectorAll('.builder-toolbar button')]
      .find((button) => button.textContent?.includes('Build')) as HTMLButtonElement
    expect(build.disabled).toBe(true)
  })

  it('builds once the graph is sound', () => {
    clickableApp()
    const build = [...container.querySelectorAll('.builder-toolbar button')]
      .find((button) => button.textContent?.includes('Build')) as HTMLButtonElement
    expect(build.disabled).toBe(false)
    expect([...container.querySelectorAll('[aria-label="Compile target"] option')].map((option) => option.textContent))
      .toEqual(['Web bundle', 'Mobile source', 'Local runner'])
  })

  it('tells the user how to fix each problem, not just what is wrong', () => {
    click(palette('Log'))
    expect(container.querySelector('.builder-problem-fix')?.textContent)
      .toContain('Link its Run port to the step before it')
  })
})

describe('building by dragging', () => {
  it('offers every palette item as a drag source', () => {
    expect(palette('On App Start')?.getAttribute('draggable')).toBe('true')
    expect(container.querySelector('.block-palette-help')?.textContent).toContain('Drag a block onto the canvas')
  })

  it('shows where a dragged block would land', () => {
    fireDrag(canvas(), 'dragover', { x: 300, y: 180 })
    const ghost = container.querySelector<HTMLElement>('[data-testid="builder-drop-ghost"]')
    expect(ghost).not.toBeNull()
    expect(canvas().className).toContain('dropping')
    // Centred on the cursor and landed on the grid.
    expect(Number.parseInt(ghost!.style.top, 10) % GRID).toBe(0)
  })

  it('ignores a drag that is not carrying a block', () => {
    fireDrag(canvas(), 'dragover', { x: 300, y: 180 }, transfer('text/plain', 'hello'))
    expect(container.querySelector('[data-testid="builder-drop-ghost"]')).toBeNull()
  })

  it('creates the block where it was dropped', () => {
    fireDrag(canvas(), 'dragover', { x: 400, y: 240 })
    fireDrag(canvas(), 'drop', { x: 400, y: 240 })
    const node = nodes()[0]
    expect(node.textContent).toContain('Button')
    // Half a block left of the cursor, so the pointer holds the middle.
    expect(node.style.left).toBe('296px')
    expect(node.style.top).toBe('224px')
    expect(container.querySelector('[data-testid="builder-drop-ghost"]')).toBeNull()
  })

  it('drops a plugin block just like a built-in one', () => {
    fireDrag(canvas(), 'drop', { x: 200, y: 120 }, transfer(BLOCK_DRAG_TYPE, 'acme.notify'))
    expect(nodes()[0].textContent).toContain('Send Notification')
  })

  it('still places a block on a plain click, for the impatient', () => {
    click(palette('On App Start'))
    expect(nodes()).toHaveLength(1)
  })
})

describe('wiring by dragging', () => {
  beforeEach(() => {
    click(palette('On App Start'))
    click(palette('Log'))
  })

  it('draws a wire that follows the pointer, and connects where it is dropped', () => {
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 300, y: 140 })
    expect(container.querySelector('[data-testid="builder-wire-preview"]')).not.toBeNull()
    expect(container.querySelector('.builder-hint')?.textContent).toContain('Let go on a pin')

    firePointer(pin('Input Run of Log'), 'pointerup', { x: 320, y: 150 })
    expect(container.querySelectorAll('.builder-wire').length).toBe(1)
    expect(code()).toContain('console.log')
  })

  it('marks the pins that the dragged wire could land on', () => {
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 280, y: 100 })
    expect(pin('Input Run of Log').className).toContain('targetable')
    // An output pin is not a target for a wire that started at an output.
    expect(pin('Output Then of Log').className).not.toContain('targetable')
  })

  it('drops the wire harmlessly when it lands on nothing', () => {
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 500, y: 400 })
    firePointer(window, 'pointerup', { x: 500, y: 400 })
    expect(container.querySelector('[data-testid="builder-wire-preview"]')).toBeNull()
    expect(container.querySelectorAll('.builder-wire').length).toBe(0)
  })

  it('cancels a dragged wire on Escape', () => {
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 300, y: 140 })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelector('[data-testid="builder-wire-preview"]')).toBeNull()
  })

  it('still connects with two clicks', () => {
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Log'))
    expect(container.querySelectorAll('.builder-wire').length).toBe(1)
  })
})

describe('pieces that snap together', () => {
  beforeEach(() => {
    click(palette('On App Start'))
    click(palette('Log'))
  })

  it('snaps onto the chain when dropped near a free Then pin, and connects', () => {
    const [start, log] = nodes()
    const startTop = Number.parseInt(start.style.top, 10)

    // Pick the Log block up and let it go just below On Start's Then pin.
    fireMouse(log, 'mousedown', { x: 60, y: startTop + 200 })
    fireMouse(window, 'mousemove', { x: 234, y: startTop + 60 })

    expect(nodes()[1].className).toContain('snapping')
    fireMouse(window, 'mouseup', { x: 234, y: startTop + 60 })

    expect(container.querySelectorAll('.builder-wire').length).toBe(1)
    expect(code()).toContain('console.log')
    // Lined up, not merely near.
    expect(nodes()[1].style.top).toBe(`${startTop}px`)
  })

  it('does not snap to a pin that is already driving something', () => {
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Log'))
    click(palette('Log'))

    const [start, , second] = nodes()
    const startTop = Number.parseInt(start.style.top, 10)
    fireMouse(second, 'mousedown', { x: 60, y: startTop + 400 })
    fireMouse(window, 'mousemove', { x: 234, y: startTop + 60 })

    expect(nodes()[2].className).not.toContain('snapping')
    fireMouse(window, 'mouseup', { x: 234, y: startTop + 60 })
    expect(container.querySelectorAll('.builder-wire').length).toBe(1)
  })

  it('leaves a block where it was dropped when nothing is near', () => {
    const log = nodes()[1]
    // Grabbed 20px in from the block's left edge, which sits at x=40.
    fireMouse(log, 'mousedown', { x: 60, y: 20 })
    fireMouse(window, 'mousemove', { x: 620, y: 500 })
    fireMouse(window, 'mouseup', { x: 620, y: 500 })
    expect(container.querySelectorAll('.builder-wire').length).toBe(0)
    expect(nodes()[1].style.left).toBe('600px')
  })
})
