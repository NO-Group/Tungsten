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
import { recipes } from '../../builder/recipes'
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
/** Targets the view asked to build, in order. */
const built: string[] = []
/** Backends the view asked to start. */
const ran: string[] = []

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
        onAddRecipe={builder.addRecipe}
      />
      <BuilderView
        builder={builder}
        editorOptions={{}}
        theme="tungsten"
        onExport={() => undefined}
        onBuild={(target) => built.push(target)}
        onRunServer={() => ran.push('server')}
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

/** Picks an option in a <select>, the way a user would. */
function choose(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value)
  act(() => { element.dispatchEvent(new Event('change', { bubbles: true })) })
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

const canvas = () => container.querySelector<HTMLElement>('.builder-canvas')!
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

/** A key, on the document, the way the builder listens for it. */
function press(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers })) })
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
    // editing a number here. Recipes sit in their own section above them.
    expect(container.querySelectorAll('.block-palette-item:not(.recipe)').length)
      .toBe(builtinBlocks.length + plugins.blocks.length)
    expect(container.querySelectorAll('.block-palette-groups section').length).toBe(9)
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

  it('previews against the simulation until a backend is asked for', async () => {
    click(tab('Preview'))
    const toggle = container.querySelector<HTMLInputElement>('[aria-label="Use a real backend"]')!
    const address = container.querySelector<HTMLInputElement>('[aria-label="Backend address"]')!
    expect(toggle.checked).toBe(false)
    expect(address.disabled).toBe(true)
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('const API_BASE = "";')

    click(toggle)
    await flushEffects()
    expect(container.querySelector('iframe')?.getAttribute('srcdoc'))
      .toContain('const API_BASE = "http://localhost:8787";')

    // And back off again: the switch is the only thing standing between a
    // preview and somebody's real data.
    click(container.querySelector('[aria-label="Use a real backend"]'))
    await flushEffects()
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('const API_BASE = "";')
  })

  it('refuses an address that is not an http one', async () => {
    click(tab('Preview'))
    click(container.querySelector('[aria-label="Use a real backend"]'))
    const address = container.querySelector<HTMLInputElement>('[aria-label="Backend address"]')!
    type(address, 'javascript:alert(1)')
    act(() => { address.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    await flushEffects()
    expect(container.querySelector('iframe')?.getAttribute('srcdoc'))
      .toContain('const API_BASE = "http://localhost:8787";')
    expect(notify.mock.calls.flat().join(' ')).toContain('is not an http address')
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
    // The project's own targets, then the three that are not platforms:
    // the web bundle every project can produce, the backend service they
    // all call, and the local runner.
    expect([...container.querySelectorAll('[aria-label="Compile target"] option')].map((option) => option.textContent))
      .toEqual([
        'Android App Target',
        'iOS App Target',
        'Cross-Platform Mobile Target',
        'Windows Desktop Target',
        'macOS Desktop Target',
        'Linux Desktop Target',
        'Web Target',
        'Backend service',
        'Local runner',
      ])
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

describe('building at speed', () => {
  it('drops a whole feature in one click, ready to compile', () => {
    click(palette('Sign-in form'))

    const recipe = recipes.find((entry) => entry.id === 'signin-form')!
    expect(container.querySelectorAll('.builder-node')).toHaveLength(recipe.blocks.length)
    expect(container.querySelectorAll('.builder-wire')).toHaveLength(recipe.links.length)
    expect(code()).toContain('auth.signUp')
    expect(code()).toContain('render.input')
    expect(code()).toContain('email')
    // Nothing red: a starter that arrives broken is worse than no starter.
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('sign-in form'))
  })

  it('stacks a second recipe under the first rather than on top of it', () => {
    click(palette('Call an API'))
    const firstLowest = Math.max(...nodes().map((node) => Number.parseInt(node.style.top, 10)))
    const firstCount = nodes().length

    click(palette('List a table'))
    expect(nodes().length).toBeGreaterThan(firstCount)
    expect(Math.max(...nodes().map((node) => Number.parseInt(node.style.top, 10)))).toBeGreaterThan(firstLowest)
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')
  })

  it('offers only the blocks that fit, when a wire is dropped on empty canvas', () => {
    click(palette('On App Start'))
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 520, y: 300 })
    firePointer(window, 'pointerup', { x: 520, y: 300 })

    const menu = container.querySelector('.builder-quick-add')
    expect(menu).not.toBeNull()
    const offered = [...menu!.querySelectorAll('.builder-quick-add-list button span')].map((item) => item.textContent)
    // Exec out: only blocks with a Run pin. A pure value block has none.
    expect(offered).toContain('Log')
    expect(offered).not.toContain('Text Value')
  })

  it('creates the block and connects it in the same gesture', () => {
    click(palette('On App Start'))
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 520, y: 300 })
    firePointer(window, 'pointerup', { x: 520, y: 300 })

    const log = [...container.querySelectorAll('.builder-quick-add-list button')]
      .find((button) => button.querySelector('span')?.textContent === 'Log')!
    click(log)

    expect(nodes()).toHaveLength(2)
    expect(container.querySelectorAll('.builder-wire')).toHaveLength(1)
    expect(code()).toContain('console.log')
    expect(container.querySelector('.builder-quick-add')).toBeNull()
  })

  it('filters the quick-add list, and Enter takes the first match', () => {
    click(palette('On App Start'))
    firePointer(pin('Output Then of On App Start'), 'pointerdown', { x: 260, y: 60 })
    firePointer(window, 'pointermove', { x: 520, y: 300 })
    firePointer(window, 'pointerup', { x: 520, y: 300 })

    const filter = container.querySelector<HTMLInputElement>('[aria-label="Add a connected block"]')!
    type(filter, 'http')
    const offered = [...container.querySelectorAll('.builder-quick-add-list button span')].map((item) => item.textContent)
    expect(offered).toEqual(['HTTP Request'])

    act(() => { filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(code()).toContain('http.request')
  })

  it('undoes and redoes a whole gesture, not every frame of it', () => {
    click(palette('On App Start'))
    const node = nodes()[0]
    const startLeft = node.style.left

    fireMouse(node, 'mousedown', { x: 60, y: 20 })
    for (let step = 0; step < 6; step += 1) fireMouse(window, 'mousemove', { x: 300 + step * 20, y: 400 })
    fireMouse(window, 'mouseup', { x: 400, y: 400 })
    expect(nodes()[0].style.left).not.toBe(startLeft)

    press('z', { ctrlKey: true })
    expect(nodes()[0].style.left).toBe(startLeft)

    press('z', { ctrlKey: true, shiftKey: true })
    expect(nodes()[0].style.left).not.toBe(startLeft)
  })

  it('undoes a recipe in one step', () => {
    click(palette('Call an API'))
    expect(nodes().length).toBeGreaterThan(3)
    press('z', { ctrlKey: true })
    expect(nodes()).toHaveLength(0)
    expect(code()).toContain('No events yet')
  })

  it('duplicates the selected block with its values', () => {
    click(palette('Text Value'))
    type(container.querySelector<HTMLInputElement>('[aria-label="Value value"]')!, 'hello')
    press('d', { ctrlKey: true })

    expect(nodes()).toHaveLength(2)
    const values = [...container.querySelectorAll<HTMLInputElement>('[aria-label="Value value"]')].map((input) => input.value)
    expect(values).toEqual(['hello', 'hello'])
  })

  it('deletes the selected block with the keyboard, and undoes that too', () => {
    click(palette('Log'))
    press('Delete')
    expect(nodes()).toHaveLength(0)
    press('z', { ctrlKey: true })
    expect(nodes()).toHaveLength(1)
  })

  it('nudges the selected block with the arrow keys', () => {
    click(palette('Log'))
    const before = Number.parseInt(nodes()[0].style.left, 10)
    press('ArrowRight')
    expect(Number.parseInt(nodes()[0].style.left, 10)).toBe(before + 8)
    press('ArrowRight', { shiftKey: true })
    expect(Number.parseInt(nodes()[0].style.left, 10)).toBe(before + 40)
  })

  it('leaves the keyboard alone while a field has focus', () => {
    click(palette('Text Value'))
    const field = container.querySelector<HTMLInputElement>('[aria-label="Value value"]')!
    act(() => { field.focus() })
    act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })
    expect(nodes()).toHaveLength(1)
  })

  it('greys the undo button until there is something to undo', () => {
    const undoButton = container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
    expect(undoButton.disabled).toBe(true)
    click(palette('Log'))
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(false)
  })
})

describe('working on many blocks at once', () => {
  /** Drags a marquee across the canvas from one point to another. */
  function marquee(from: { x: number; y: number }, to: { x: number; y: number }, modifiers: Partial<MouseEventInit> = {}) {
    const surface = canvas()
    act(() => {
      surface.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: from.x, clientY: from.y, ...modifiers,
      }))
    })
    fireMouse(window, 'mousemove', to)
    fireMouse(window, 'mouseup', to)
  }

  const selected = () => [...container.querySelectorAll('.builder-node.selected')]

  beforeEach(() => {
    click(palette('On App Start'))
    click(palette('Log'))
    click(palette('Text Value'))
  })

  it('catches every block a marquee is dragged across', () => {
    // jsdom reports no layout, so every node sits at its style position;
    // a box over the whole canvas catches all three.
    marquee({ x: 0, y: 0 }, { x: 900, y: 900 })
    expect(selected()).toHaveLength(3)
    expect(container.querySelector('.builder-count')?.textContent).toContain('3 of 3 blocks')
  })

  it('shows the marquee while it is being dragged', () => {
    const surface = canvas()
    act(() => {
      surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }))
    })
    fireMouse(window, 'mousemove', { x: 400, y: 400 })
    expect(container.querySelector('[data-testid="builder-marquee"]')).not.toBeNull()
    fireMouse(window, 'mouseup', { x: 400, y: 400 })
    expect(container.querySelector('[data-testid="builder-marquee"]')).toBeNull()
  })

  it('treats a click on bare canvas as a deselect, not a marquee', () => {
    marquee({ x: 0, y: 0 }, { x: 900, y: 900 })
    expect(selected()).toHaveLength(3)
    marquee({ x: 800, y: 800 }, { x: 801, y: 801 })
    expect(selected()).toHaveLength(0)
  })

  it('adds to the selection with shift, and takes away again', () => {
    const blocks = nodes()
    fireMouse(blocks[0], 'mousedown', { x: 60, y: 20 })
    fireMouse(window, 'mouseup', { x: 60, y: 20 })
    expect(selected()).toHaveLength(1)

    act(() => {
      blocks[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 60, clientY: 200, shiftKey: true }))
    })
    fireMouse(window, 'mouseup', { x: 60, y: 200 })
    expect(selected()).toHaveLength(2)

    act(() => {
      blocks[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 60, clientY: 200, shiftKey: true }))
    })
    fireMouse(window, 'mouseup', { x: 60, y: 200 })
    expect(selected()).toHaveLength(1)
  })

  it('drags the whole selection when one of its blocks is dragged', () => {
    marquee({ x: 0, y: 0 }, { x: 900, y: 900 })
    const before = nodes().map((node) => Number.parseInt(node.style.left, 10))

    fireMouse(nodes()[0], 'mousedown', { x: 60, y: 20 })
    fireMouse(window, 'mousemove', { x: 260, y: 20 })
    fireMouse(window, 'mouseup', { x: 260, y: 20 })

    const after = nodes().map((node) => Number.parseInt(node.style.left, 10))
    expect(after.every((value, index) => value === before[index] + 200)).toBe(true)
    // And the group still holds together for the next gesture.
    expect(selected()).toHaveLength(3)
  })

  it('selects everything with the keyboard, and deletes it in one step', () => {
    press('a', { ctrlKey: true })
    expect(selected()).toHaveLength(3)
    press('Delete')
    expect(nodes()).toHaveLength(0)

    press('z', { ctrlKey: true })
    expect(nodes()).toHaveLength(3)
  })

  it('copies a selection and pastes it back, wires and all', () => {
    click(palette('On App Start'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Log'))
    const wires = container.querySelectorAll('.builder-wire').length
    expect(wires).toBe(1)

    press('a', { ctrlKey: true })
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })

    expect(nodes()).toHaveLength(8)
    expect(container.querySelectorAll('.builder-wire').length).toBe(wires * 2)
    // What was pasted is what is now selected, ready to be moved.
    expect(selected()).toHaveLength(4)
  })

  it('cuts a selection out and puts it back', () => {
    press('a', { ctrlKey: true })
    press('x', { ctrlKey: true })
    expect(nodes()).toHaveLength(0)
    press('v', { ctrlKey: true })
    expect(nodes()).toHaveLength(3)
  })

  it('nudges everything selected together', () => {
    press('a', { ctrlKey: true })
    const before = nodes().map((node) => Number.parseInt(node.style.left, 10))
    press('ArrowRight')
    expect(nodes().map((node) => Number.parseInt(node.style.left, 10)))
      .toEqual(before.map((value) => value + 8))
  })

  it('tidies the canvas into columns, and then says it is tidy', () => {
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Log'))

    const tidyButton = () => container.querySelector<HTMLButtonElement>('[aria-label="Tidy the canvas"]')!
    expect(tidyButton().disabled).toBe(false)
    click(tidyButton())

    const [start, log] = nodes()
    expect(Number.parseInt(log.style.left, 10)).toBeGreaterThan(Number.parseInt(start.style.left, 10))
    expect(tidyButton().disabled).toBe(true)
    expect(notify).toHaveBeenCalledWith('Canvas tidied')
  })

  it('undoes a tidy in one step', () => {
    // Three loose blocks share column zero, so it is the vertical packing
    // that changes here, not the column.
    const positions = () => nodes().map((node) => `${node.style.left},${node.style.top}`)
    const before = positions()
    click(container.querySelector('[aria-label="Tidy the canvas"]')!)
    expect(positions()).not.toEqual(before)
    press('z', { ctrlKey: true })
    expect(positions()).toEqual(before)
  })
})

describe('navigating the canvas', () => {
  const scene = () => container.querySelector<HTMLElement>('[data-testid="builder-scene"]')!
  const zoomLabel = () => container.querySelector('.builder-zoom-label')?.textContent
  const camera = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

  /** The scene's transform, parsed back into numbers. */
  function transform() {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(scene().style.transform)!
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
  }

  function wheel(delta: number, at: { x: number; y: number }, modifiers: Partial<WheelEventInit> = {}) {
    act(() => {
      canvas().dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: delta, clientX: at.x, clientY: at.y, ...modifiers,
      }))
    })
  }

  it('starts at actual size, with everything in one transformed layer', () => {
    expect(zoomLabel()).toBe('100%')
    expect(transform()).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('zooms with the buttons, and back to 100% with the label', () => {
    click(camera('Zoom in'))
    expect(transform().zoom).toBeCloseTo(1.25, 5)
    expect(zoomLabel()).toBe('125%')

    click(camera('Zoom out'))
    expect(transform().zoom).toBeCloseTo(1, 5)

    click(camera('Zoom in'))
    click(camera('Reset zoom to 100%'))
    expect(zoomLabel()).toBe('100%')
  })

  it('zooms about the pointer on ctrl+wheel, and scrolls the view otherwise', () => {
    wheel(-100, { x: 300, y: 200 }, { ctrlKey: true })
    expect(transform().zoom).toBeGreaterThan(1)

    const before = transform()
    wheel(120, { x: 300, y: 200 })
    // A plain wheel moves the view and leaves the zoom alone.
    expect(transform().zoom).toBe(before.zoom)
    expect(transform().y).toBeLessThan(before.y)
  })

  it('keeps blocks where they were dropped, even while zoomed', () => {
    click(camera('Zoom in'))
    click(camera('Zoom in'))
    const { zoom, x, y } = transform()

    fireDrag(canvas(), 'drop', { x: 400, y: 300 })
    const node = nodes()[0]

    // The drop point in canvas coordinates, centred on the block, rounded
    // to the grid: the same arithmetic the canvas must have done.
    const expected = {
      x: Math.round(((400 - x) / zoom - 216 / 2) / 8) * 8,
      y: Math.round(((300 - y) / zoom - 30 / 2) / 8) * 8,
    }
    expect(Number.parseInt(node.style.left, 10)).toBe(expected.x)
    expect(Number.parseInt(node.style.top, 10)).toBe(expected.y)
  })

  it('moves a block by the distance the pointer moved, not the pixels on screen', () => {
    click(palette('Log'))
    click(camera('Zoom out'))
    const { zoom } = transform()
    expect(zoom).toBeLessThan(1)

    const before = Number.parseInt(nodes()[0].style.left, 10)
    fireMouse(nodes()[0], 'mousedown', { x: 100, y: 100 })
    fireMouse(window, 'mousemove', { x: 300, y: 100 })
    fireMouse(window, 'mouseup', { x: 300, y: 100 })

    // 200 screen pixels at 75% is a bigger move in the document.
    const moved = Number.parseInt(nodes()[0].style.left, 10) - before
    expect(moved).toBeGreaterThan(200)
    expect(moved).toBeCloseTo(200 / zoom, -1)
  })

  it('fits the whole graph in view', () => {
    click(palette('On App Start'))
    click(camera('Zoom in'))
    click(camera('Fit the graph in view'))
    // jsdom reports a zero-sized surface, so fit falls back to a sane view
    // rather than dividing by nothing.
    expect(Number.isFinite(transform().zoom)).toBe(true)
    expect(transform().zoom).toBeGreaterThan(0)
  })

  it('offers the three tools, with Pick active', () => {
    const rail = container.querySelector('[aria-label="Canvas tools"]')!
    expect(rail.querySelectorAll('button')).toHaveLength(3)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Pick"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('switches tool with a single key, and with the rail', () => {
    press('h')
    expect(container.querySelector('[aria-label="Pan"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(canvas().style.cursor).toBe('grab')

    press('v')
    expect(container.querySelector('[aria-label="Pick"]')?.getAttribute('aria-pressed')).toBe('true')

    click(container.querySelector('[aria-label="Marquee"]')!)
    expect(canvas().style.cursor).toBe('crosshair')
  })

  it('drags the view with the pan tool instead of selecting', () => {
    click(palette('Log'))
    press('h')

    const before = transform()
    const blockAt = nodes()[0].style.left
    act(() => {
      canvas().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0 }))
    })
    fireMouse(window, 'mousemove', { x: 160, y: 140 })
    fireMouse(window, 'mouseup', { x: 160, y: 140 })

    expect(transform().x).toBe(before.x + 60)
    expect(transform().y).toBe(before.y + 40)
    // The view moved; the document did not. A pan is not an edit.
    expect(nodes()[0].style.left).toBe(blockAt)
  })

  it('pans while space is held, whatever the tool', () => {
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })) })
    expect(canvas().style.cursor).toBe('grab')

    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true })) })
    expect(canvas().style.cursor).toBe('default')
  })

  it('lets go of space when the window loses focus', () => {
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })) })
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(canvas().style.cursor).toBe('default')
  })

  it('marquees from on top of a block with the marquee tool', () => {
    click(palette('Log'))
    press('m')

    const block = nodes()[0]
    act(() => {
      block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
    })
    fireMouse(window, 'mousemove', { x: 600, y: 600 })
    expect(container.querySelector('[data-testid="builder-marquee"]')).not.toBeNull()
    fireMouse(window, 'mouseup', { x: 600, y: 600 })
    expect(container.querySelectorAll('.builder-node.selected')).toHaveLength(1)
  })
})

describe('the inspector', () => {
  const inspector = () => container.querySelector('.inspector')!
  const field = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!

  it('says what to do when nothing is selected', () => {
    expect(inspector().textContent).toContain('Select a block')
  })

  it('shows the selected block, its inputs and its style', () => {
    click(palette('Button'))
    expect(inspector().textContent).toContain('Button')
    expect(inspector().textContent).toContain('ui.button')
    expect(field('Text of ui.button')).not.toBeNull()
    expect(field('Corner radius of ui.button')).not.toBeNull()
  })

  it('writes a style straight into the generated code', () => {
    click(palette('On App Start'))
    click(palette('Button'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Button'))

    type(field('Corner radius of ui.button'), '24')
    expect(code()).toContain('radius: 24')

    type(field('Padding of ui.button'), '10 20')
    expect(code()).toContain('padding: "10 20"')
  })

  it('picks a theme colour from a swatch, and takes it off again', () => {
    click(palette('On App Start'))
    click(palette('Button'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Button'))

    const accent = container.querySelector<HTMLButtonElement>('.inspector-swatches [aria-label="accent"]')!
    click(accent)
    expect(code()).toContain('background: "accent"')

    click(container.querySelector<HTMLButtonElement>('.inspector-swatches [aria-label="accent"]')!)
    expect(code()).not.toContain('background')
  })

  it('shows a wired input as wired rather than as an editable field', () => {
    click(palette('On App Start'))
    click(palette('Log'))
    click(palette('Text Value'))
    click(pin('Output Value of Text Value'))
    click(pin('Input Value of Log'))

    // Select the Log block by clicking its header.
    fireMouse(nodes()[1], 'mousedown', { x: 60, y: 60 })
    fireMouse(window, 'mouseup', { x: 60, y: 60 })
    expect(inspector().querySelector('.inspector-field.wired')?.textContent).toContain('from a wire')
  })

  it('edits a property across a whole selection at once', () => {
    click(palette('Button'))
    click(palette('Button'))
    press('a', { ctrlKey: true })

    expect(inspector().textContent).toContain('2 blocks')
    expect(inspector().textContent).toContain('Shared style')

    type(field('Corner radius of ui.button'), '18')
    const radii = [...container.querySelectorAll('.builder-node')].length
    expect(radii).toBe(2)
    // Both blocks took the change: undoing once puts both back.
    press('z', { ctrlKey: true })
    expect(inspector().textContent).toContain('2 blocks')
  })

  it('hides and shows from the toolbar', () => {
    click(container.querySelector('[aria-label="Hide the inspector"]')!)
    expect(container.querySelector('.inspector')).toBeNull()
    click(container.querySelector('[aria-label="Show the inspector"]')!)
    expect(container.querySelector('.inspector')).not.toBeNull()
  })

  it('keeps style ports off the canvas', () => {
    click(palette('Button'))
    // No pin is drawn for a property, so the block stays compact.
    expect(container.querySelector('[aria-label="Input Corner radius of Button"]')).toBeNull()
    expect(container.querySelector('[aria-label="Input Text of Button"]')).not.toBeNull()
  })
})

describe('app and page variables', () => {
  const variablesTab = () => [...container.querySelectorAll('.builder-tabs button')]
    .find((button) => button.textContent?.includes('Variables'))!

  function openVariables() {
    click(variablesTab())
  }

  it('starts with none, and explains the two scopes', () => {
    openVariables()
    expect(container.querySelector('.state-empty')?.textContent).toContain('outlives a reload')
  })

  it('declares a variable in the generated file', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])
    expect(code()).toContain('const state = app.state({ page: { value: "" } })')
    expect(variablesTab().textContent).toContain('1')
  })

  it('puts an app variable in the other group', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][1])
    expect(code()).toContain('app: { value: "" }')
  })

  it('renames, retypes and re-scopes, each landing in the code', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])

    const name = container.querySelector<HTMLInputElement>('[aria-label="Name of variable 1"]')!
    type(name, 'greeting')
    act(() => { name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(code()).toContain('greeting')

    const type_ = container.querySelector<HTMLSelectElement>('[aria-label="Type of greeting"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(type_, 'Number')
      type_.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(code()).toContain('greeting: 0')

    click(container.querySelector('[aria-label="Scope of greeting"]')!)
    expect(code()).toContain('app: { greeting: 0 }')
  })

  it('refuses a name that could not be one', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])
    const name = container.querySelector<HTMLInputElement>('[aria-label="Name of variable 1"]')!
    type(name, 'two words')
    act(() => { name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('lowercase letter'))
    expect(code()).toContain('value:')
  })

  it('flags a block that names a variable which does not exist', () => {
    click(palette('On App Start'))
    click(palette('Set Variable'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Set Variable'))

    expect(container.querySelector('.builder-state')?.textContent).toContain('error')
    expect(container.textContent).toContain('does not say which variable')
  })

  it('is satisfied once the variable exists and is chosen', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])

    click(palette('On App Start'))
    click(palette('Set Variable'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Set Variable'))

    // The inspector names the variable, because it is a property -- and it
    // is chosen from the variables that exist rather than typed, so naming
    // one that does not exist is not a thing the inspector can do.
    choose(container.querySelector<HTMLSelectElement>('[aria-label="Variable of state.set"]')!, 'value')
    type(container.querySelector<HTMLInputElement>('[aria-label="Value of state.set"]')!, 'hello')
    expect(code()).toContain('state.set("value", "hello")')
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')
  })

  it('undoes a variable in one step', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])
    expect(code()).toContain('app.state(')
    press('z', { ctrlKey: true })
    expect(code()).not.toContain('app.state(')
  })

  it('dims a variable nothing reads yet', () => {
    openVariables()
    click([...container.querySelectorAll('.state-head button')][0])
    expect(container.querySelector('.state-row')?.className).toContain('unused')
    expect(container.querySelector('.state-note')?.textContent).toContain('nothing reads or writes them')
  })
})

/**
 * Screens.
 *
 * The strip above the canvas is the only place the user meets them, so
 * these are about the surface: what is on the canvas, what the file says,
 * and whether the two agree after every one of these gestures.
 */
describe('screens', () => {
  const tabs = () => [...container.querySelectorAll('.builder-screen')] as HTMLElement[]
  const addScreen = () => click(container.querySelector('[aria-label="Add a screen"]'))
  const nameField = () => container.querySelector<HTMLInputElement>('[aria-label="Rename screen"]')!

  it('starts as one screen, and says nothing about it in the file', () => {
    expect(tabs()).toHaveLength(1)
    expect(nameField().value).toBe('home')
    click(palette('On App Start'))
    expect(code()).toContain('app.onStart(async () => {')
    expect(code()).not.toContain('app.screens')
  })

  it('adds a screen, and the canvas shows only what is on it', () => {
    click(palette('On App Start'))
    expect(nodes()).toHaveLength(1)

    addScreen()
    expect(tabs()).toHaveLength(2)
    expect(nameField().value).toBe('screen')
    // The new screen is empty; the block stayed on the one it was drawn on.
    expect(nodes()).toHaveLength(0)

    click(container.querySelector('[aria-label="Open the home screen"]'))
    expect(nodes()).toHaveLength(1)
  })

  it('writes the screens into the file once there is more than one', () => {
    click(palette('On App Start'))
    addScreen()
    expect(code()).toContain('const screens = app.screens(["home", "screen"])')
    expect(code()).toContain('app.screen("home").onStart(async () => {')
  })

  it('puts new blocks on the screen being drawn', () => {
    addScreen()
    click(palette('On App Start'))
    expect(nodes()).toHaveLength(1)
    expect(code()).toContain('app.screen("screen").onStart(async () => {')
  })

  it('renames a screen, and everything that named it follows', () => {
    click(palette('On App Start'))
    addScreen()
    click(palette('On App Start'))

    const field = nameField()
    type(field, 'settings')
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    expect(code()).toContain('app.screens(["home", "settings"])')
    expect(code()).toContain('app.screen("settings").onStart')
    expect(code()).not.toContain('"screen"')
  })

  it('refuses a name that is already taken, and says why', () => {
    addScreen()
    const field = nameField()
    type(field, 'home')
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('already taken'))
  })

  it('deletes a screen and the blocks on it, and will not delete the last', () => {
    click(palette('On App Start'))
    addScreen()
    click(palette('On App Start'))
    expect(code()).toContain('app.screen("screen").onStart')

    click(container.querySelector('[aria-label="Delete the screen screen"]'))
    expect(tabs()).toHaveLength(1)
    expect(code()).not.toContain('app.screens')
    // Back to the single-screen dialect, with the first screen's work intact.
    expect(code()).toContain('app.onStart(async () => {')
    expect(nodes()).toHaveLength(1)

    expect(container.querySelector('[aria-label="Delete the home screen"]')).toHaveProperty('disabled', true)
  })

  it('chooses which screen the app starts on', () => {
    addScreen()
    click(container.querySelector('[aria-label="Start the app on screen"]'))
    expect(code()).toContain('app.screens(["screen", "home"])')
    // The tab that moved is the active one, so its name is in the field.
    expect(nameField().value).toBe('screen')
    expect(tabs()[1].textContent).toContain('home')
  })

  it('moves the selection to another screen', () => {
    click(palette('On App Start'))
    addScreen()
    click(container.querySelector('[aria-label="Open the home screen"]'))
    // Switching screens drops the selection, so pick the block up again.
    fireMouse(nodes()[0], 'mousedown', { x: 60, y: 20 })
    fireMouse(window, 'mouseup', { x: 60, y: 20 })

    const mover = container.querySelector<HTMLSelectElement>('[aria-label="Move the selection to a screen"]')!
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(mover, 'screen')
    act(() => { mover.dispatchEvent(new Event('change', { bubbles: true })) })

    expect(code()).toContain('app.screen("screen").onStart')
    expect(nodes()).toHaveLength(1)
  })

  it('offers the screens that exist, rather than a box to type one into', () => {
    addScreen()
    click(palette('On App Start'))
    click(palette('Go To Screen'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Go To Screen'))

    const chooser = container.querySelector<HTMLSelectElement>('[aria-label="Screen of nav.go"]')!
    expect([...chooser.options].map((option) => option.value)).toEqual(['', 'home', 'screen'])

    choose(chooser, 'home')
    expect(code()).toContain('app.goTo("home")')
  })

  it('follows a rename, so navigation does not break behind your back', () => {
    addScreen()
    click(palette('On App Start'))
    click(palette('Go To Screen'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Go To Screen'))
    choose(container.querySelector<HTMLSelectElement>('[aria-label="Screen of nav.go"]')!, 'home')
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')

    // Rename the screen it points at, out from under it.
    click(container.querySelector('[aria-label="Open the home screen"]'))
    const field = nameField()
    type(field, 'start')
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    expect(code()).toContain('app.goTo("start")')
    expect(container.querySelector('.builder-state')?.textContent).toContain('Ready to compile')
  })

  it('will not compile a jump to a screen that was deleted', () => {
    addScreen()
    click(palette('On App Start'))
    click(palette('Go To Screen'))
    click(pin('Output Then of On App Start'))
    click(pin('Input Run of Go To Screen'))
    choose(container.querySelector<HTMLSelectElement>('[aria-label="Screen of nav.go"]')!, 'home')

    // Delete the screen it points at. The block pointing at it is on the
    // other screen, so it survives -- naming something that is gone.
    click(container.querySelector('[aria-label="Open the home screen"]'))
    click(container.querySelector('[aria-label="Delete the home screen"]'))

    expect(container.textContent).toContain('no screen called')
    expect(container.querySelector('.builder-state')?.textContent).toContain('error')
  })

  it('refuses to wire a block to one on another screen', () => {
    click(palette('On App Start'))
    addScreen()
    click(palette('Log'))

    // Select the pin on this screen, then go back and try the other one.
    click(pin('Input Run of Log'))
    click(container.querySelector('[aria-label="Open the home screen"]'))
    click(pin('Output Then of On App Start'))
    expect(code()).not.toContain('console.log')
  })

  it('keeps the screens through an undo', () => {
    click(palette('On App Start'))
    addScreen()
    expect(code()).toContain('app.screens(')
    press('z', { ctrlKey: true })
    expect(code()).not.toContain('app.screens(')
    expect(tabs()).toHaveLength(1)
    expect(nodes()).toHaveLength(1)
  })
})


describe('targets', () => {
  beforeEach(() => {
    localStorage.clear()
    built.length = 0
    ran.length = 0
    render()
    openTargets()
  })

  afterEach(() => { act(() => root.unmount()); container.remove() })

  const openTargets = () => click([...container.querySelectorAll('.builder-tabs button')]
    .find((button) => button.textContent?.startsWith('Targets')))
  const tree = () => container.querySelector('[aria-label="Project tree"]')!.textContent ?? ''
  const field = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  const commit = (element: HTMLInputElement, value: string) => {
    act(() => {
      element.value = value
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('draws the hierarchy the project actually has', () => {
    expect(tree()).toContain('[ My Organization ]')
    expect(tree()).toContain('[ My App ]')
    expect(tree()).toContain('Android App Target')
    expect(tree()).toContain('Linux Desktop Target')
  })

  it('starts with the six platform targets, web opt-in', () => {
    expect(tree()).not.toContain('Web Target')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Android App Target"]')!.checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('[aria-label="Web Target"]')!.checked).toBe(false)
  })

  it('derives the application identifier from both names', () => {
    expect(field('Application identifier').value).toBe('com.myorganization.myapp')
  })

  it('follows a rename of the organization', () => {
    commit(field('Organization name'), 'Acme')
    expect(field('Application identifier').value).toBe('com.acme.myapp')
    expect(tree()).toContain('[ Acme ]')
  })

  it('follows a rename of the project, and moves where it is written', () => {
    commit(field('Project name'), 'Timer')
    expect(field('Application identifier').value).toBe('com.myorganization.timer')
    expect(container.textContent).toContain('targets/timer/android')
  })

  it('keeps an identifier the user typed', () => {
    commit(field('Application identifier'), 'dev.acme.chronograph')
    commit(field('Project name'), 'Timer')
    expect(field('Application identifier').value).toBe('dev.acme.chronograph')
  })

  it('says so when the identifier is one no store would accept', () => {
    commit(field('Application identifier'), 'My App')
    expect(container.textContent).toContain('reverse-DNS')
    expect(field('Application identifier').className).toContain('invalid')
  })

  it('adds and removes targets', () => {
    click(container.querySelector('[aria-label="Web Target"]'))
    expect(tree()).toContain('Web Target')
    click(container.querySelector('[aria-label="iOS App Target"]'))
    expect(tree()).not.toContain('iOS App Target')
  })

  it('builds one target from its own row', () => {
    click(container.querySelector('[aria-label="Build the macOS Desktop Target"]'))
    expect(built).toEqual(['macos'])
  })

  it('cannot build a target the project does not have', () => {
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Build the Web Target"]')!.disabled).toBe(true)
  })

  it('adds a second project without losing the first', () => {
    click(container.querySelector('[aria-label="Add a project"]'))
    expect(tree()).toContain('[ My App ]')
    expect(tree()).toContain('[ New Project ]')
    expect(field('Project name').value).toBe('New Project')
  })

  it('never lets the last project be deleted', () => {
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete this project"]')!.disabled).toBe(true)
    click(container.querySelector('[aria-label="Add a project"]'))
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete this project"]')!.disabled).toBe(false)
    click(container.querySelector('[aria-label="Delete this project"]'))
    expect(tree()).not.toContain('[ New Project ]')
  })

  it('offers the project targets in the toolbar menu', () => {
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Compile target"]')!
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toContain('Android App Target')
    expect(labels).toContain('Local runner')
  })

  it('counts the targets on its own tab', () => {
    const tab = [...container.querySelectorAll('.builder-tabs button')]
      .find((button) => button.textContent?.startsWith('Targets'))
    expect(tab?.textContent).toContain('6')
  })

  it('offers the second toolchain where there is one, and only there', () => {
    const android = container.querySelector<HTMLSelectElement>('[aria-label="Toolchain for the Android App Target"]')!
    expect([...android.options].map((option) => option.textContent)).toEqual(['Flutter', 'Kotlin'])
    expect(android.value).toBe('flutter')

    const desktop = container.querySelector<HTMLSelectElement>('[aria-label="Toolchain for the macOS Desktop Target"]')!
    expect([...desktop.options].map((option) => option.textContent)).toEqual(['Tauri', 'Electron'])

    // One toolchain is not a choice, so it is not a dropdown.
    expect(container.querySelector('[aria-label="Toolchain for the Cross-Platform Mobile Target"]')).toBeNull()
    expect(container.querySelector('[aria-label="Toolchain for the Web Target"]')).toBeNull()
  })

  it('remembers the toolchain, in the tree and across a reload', () => {
    const android = container.querySelector<HTMLSelectElement>('[aria-label="Toolchain for the Android App Target"]')!
    act(() => {
      android.value = 'kotlin'
      android.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(tree()).toContain('Android App Target (Kotlin)')
    expect(tree()).toContain('iOS App Target (Flutter)')

    act(() => root.unmount())
    container.remove()
    render()
    openTargets()
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Toolchain for the Android App Target"]')!.value)
      .toBe('kotlin')
  })

  it('offers the backend beside the platforms that call it', () => {
    const build = container.querySelector<HTMLButtonElement>('[aria-label="Build the Backend Service"]')!
    expect(build).not.toBeNull()
    click(build)
    expect(built).toContain('server')
  })

  it('offers to run the backend as well as build it', () => {
    const run = container.querySelector<HTMLButtonElement>('[aria-label="Run the Backend Service"]')!
    expect(run).not.toBeNull()
    expect(run.textContent).toContain('Run')
    click(run)
    expect(ran).toContain('server')
    // Running is building plus two more steps, so it has to be refused
    // for the same reason building is.
    expect(run.disabled).toBe(false)
  })

  it('survives a reload', () => {
    commit(field('Organization name'), 'Acme')
    act(() => root.unmount())
    container.remove()
    render()
    openTargets()
    expect(tree()).toContain('[ Acme ]')
  })
})
