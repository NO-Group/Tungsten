/**
 * @vitest-environment jsdom
 *
 * The builder and a workspace file, running against each other for real.
 *
 * The harness is the part of the workbench that matters here: a `files` list
 * and the builder, joined by the sync hook. Nothing is mocked, so a change
 * made on either side has to travel the whole way round -- generate, write,
 * read, parse, re-render -- exactly as it does in the app.
 */

import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBuilder, PARSE_DEBOUNCE } from './useBuilder'
import { useBuilderFileSync } from './useBuilderFileSync'
import { BUILDER_SYNC_PATH } from './fileSync'
import { resetIds } from './graph'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notify = vi.fn()

/** What the harness exposes to the test, refreshed on every render. */
type Handle = {
  addBlock: (type: string) => void
  file?: string
  blocks: number
  code: string
  parseError: boolean
  setFile: (content: string) => void
  setSync: (enabled: boolean) => void
}

let handle: Handle
let container: HTMLDivElement
let root: Root

function Harness() {
  const [files, setFiles] = useState<Array<{ path: string; content: string }>>([])
  const builder = useBuilder({ notify })

  useBuilderFileSync({
    code: builder.code,
    hasBlocks: builder.graph.nodes.length > 0,
    enabled: builder.syncEnabled,
    file: files.find((file) => file.path === BUILDER_SYNC_PATH)?.content,
    writeFile: (path, content) => setFiles((current) => (current.some((file) => file.path === path)
      ? current.map((file) => (file.path === path ? { ...file, content } : file))
      : [...current, { path, content }])),
    adoptCode: builder.adoptCode,
    notify,
  })

  const current: Handle = {
    addBlock: builder.addBlock,
    file: files.find((file) => file.path === BUILDER_SYNC_PATH)?.content,
    blocks: builder.graph.nodes.length,
    code: builder.code,
    parseError: Boolean(builder.parseError),
    setFile: (content) => setFiles((current) => (current.some((file) => file.path === BUILDER_SYNC_PATH)
      ? current.map((file) => (file.path === BUILDER_SYNC_PATH ? { ...file, content } : file))
      : [...current, { path: BUILDER_SYNC_PATH, content }])),
    setSync: builder.setSyncEnabled,
  }
  // Published after the commit rather than during render: reading it in a
  // test is then reading what is actually on screen.
  useEffect(() => { handle = current })
  return null
}

/** Runs effects and the debounce, without pretending time is fake. */
async function settle(ms = PARSE_DEBOUNCE + 60) {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms) }) })
}

beforeEach(async () => {
  localStorage.clear()
  resetIds()
  notify.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
  await settle(0)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('the builder and its file', () => {
  it('writes nothing while the canvas is empty', async () => {
    await settle(0)
    expect(handle.file).toBeUndefined()
  })

  it('creates the file as soon as there is a block', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    expect(handle.file).toContain('app.onStart')
  })

  it('keeps the file in step as the canvas changes', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    // A second entry point, rather than a loose Log: an unconnected block is
    // an orphan and is deliberately left out of the program.
    act(() => handle.addBlock('event.click'))
    await settle(0)
    expect(handle.file).toContain('app.onStart')
    expect(handle.file).toContain('app.onClick')
    expect(handle.file).toBe(handle.code)
  })

  it('moves the blocks when the file is edited', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    const withLog = handle.file!.replace('app.onStart(async () => {', 'app.onStart(async () => {\n  console.log("from the file")')

    act(() => handle.setFile(withLog))
    await settle()

    expect(handle.blocks).toBe(2)
    expect(handle.code).toContain('from the file')
  })

  it('settles: a change does not bounce back and forth', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)

    const edited = handle.file!.replace('app.onStart(async () => {', 'app.onStart(async () => {\n  console.log("once")')
    act(() => handle.setFile(edited))
    await settle()

    // The graph took the edit, the file was left exactly as written, and a
    // second pass changes nothing.
    const afterFirst = handle.file
    await settle()
    expect(handle.file).toBe(afterFirst)
    expect(handle.blocks).toBe(2)
  })

  it('goes read-only instead of guessing at text it cannot parse', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    act(() => handle.setFile('this is not the generated dialect'))
    await settle()

    expect(handle.parseError).toBe(true)
    // The file is left alone; nothing is written over what was typed.
    expect(handle.file).toBe('this is not the generated dialect')
  })

  it('recovers when the file is made valid again', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    const good = handle.file!
    act(() => handle.setFile('broken('))
    await settle()
    expect(handle.parseError).toBe(true)

    act(() => handle.setFile(good))
    await settle()
    expect(handle.parseError).toBe(false)
    expect(handle.blocks).toBe(1)
  })

  it('stops writing when sync is turned off, and catches up when it is turned back on', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    const before = handle.file

    act(() => handle.setSync(false))
    act(() => handle.addBlock('event.click'))
    await settle(0)
    expect(handle.file).toBe(before)

    act(() => handle.setSync(true))
    await settle(0)
    expect(handle.file).toContain('app.onClick')
  })

  it('does not discard canvas work when sync is switched back on', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    act(() => handle.setSync(false))
    act(() => handle.addBlock('event.click'))
    await settle(0)
    act(() => handle.setSync(true))
    await settle(0)
    expect(handle.file).toContain('app.onClick')
    expect(handle.blocks).toBe(2)
  })

  it('lets the file win when both moved while sync was off', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    act(() => handle.setSync(false))
    act(() => handle.addBlock('event.click'))
    act(() => handle.setFile('app.onStart(async () => {\n  console.log("theirs")\n})'))
    await settle(0)

    act(() => handle.setSync(true))
    await settle()
    expect(handle.code).toContain('theirs')
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('changed outside the builder'))
  })

  it('undoes a change that arrived from the file', async () => {
    act(() => handle.addBlock('event.start'))
    await settle(0)
    const edited = handle.file!.replace('app.onStart(async () => {', 'app.onStart(async () => {\n  console.log("typed")')
    act(() => handle.setFile(edited))
    await settle()
    expect(handle.blocks).toBe(2)
  })
})
