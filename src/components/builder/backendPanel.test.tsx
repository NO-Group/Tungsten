/**
 * @vitest-environment jsdom
 *
 * The backend picker.
 *
 * This is the panel that finally connects `src/backend/` to the
 * product, so the tests are about the join: credentials reach the
 * adapter, Test Connection reports what actually came back, an
 * adapter that is not built cannot be selected by accident, and the
 * capability grid states what a backend cannot do as plainly as what
 * it can.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackendPanel } from './BackendPanel'
import { backendChoices, type BackendSettings } from '../../backend/registry'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const CHOICES = backendChoices()

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label))
}

function field(label: string): HTMLInputElement {
  const node = [...container.querySelectorAll('label')].find((entry) => entry.textContent?.includes(label))
  return node?.querySelector('input') as HTMLInputElement
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Renders the panel as a controlled component the test drives. */
function mount(initial: BackendSettings, onTest = async () => ({ ok: true, detail: 'ok' })) {
  let settings = initial
  const changes: BackendSettings[] = []
  const draw = () => act(() => {
    root.render(
      <BackendPanel
        choices={CHOICES}
        settings={settings}
        onChange={(next) => { settings = next; changes.push(next); draw() }}
        onTest={onTest}
      />,
    )
  })
  draw()
  return { changes, current: () => settings }
}

describe('the backend picker', () => {
  it('lists the planned adapters and refuses to select one', () => {
    mount({ adapter: 'supabase', config: {} })

    const firebase = button('Firebase')
    expect(firebase).toBeDefined()
    expect(firebase?.disabled).toBe(true)

    // Selecting it from the saved settings still explains rather than
    // throwing, and names what works today.
    mount({ adapter: 'firebase', config: {} })
    const note = container.querySelector('.backend-planned')?.textContent ?? ''
    expect(note).toContain('Not built yet')
    expect(note).toContain('Project ID')
    // The list of what works is read off the registry, so shipping an
    // adapter updates this sentence instead of leaving it lying.
    for (const choice of CHOICES.filter((entry) => entry.status !== 'planned')) {
      expect(note).toContain(choice.label)
    }
    expect(note).not.toContain('Firebase ')
  })

  it('collects credentials and will not test until it has them', () => {
    const harness = mount({ adapter: 'self-hosted', config: {} })

    expect(button('Test connection')?.disabled).toBe(true)
    expect(container.querySelector('.backend-missing')?.textContent).toContain('Server URL')

    type(field('Server URL'), 'http://localhost:8787')
    expect(harness.current().config.url).toBe('http://localhost:8787')
    expect(button('Test connection')?.disabled).toBe(false)
    expect(container.querySelector('.backend-missing')).toBeNull()
  })

  it('reports what the round trip actually said', async () => {
    const onTest = vi.fn(async () => ({ ok: false, detail: 'The server answered 502.' }))
    mount({ adapter: 'self-hosted', config: { url: 'http://localhost:8787' } }, onTest)

    await act(async () => { button('Test connection')?.click() })
    expect(onTest).toHaveBeenCalled()
    const health = container.querySelector('.backend-health')
    expect(health?.className).toContain('failed')
    expect(health?.textContent).toContain('502')
  })

  it('turns a thrown error into a sentence rather than a blank panel', async () => {
    const onTest = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND db.example') })
    mount({ adapter: 'self-hosted', config: { url: 'http://localhost:8787' } }, onTest)

    await act(async () => { button('Test connection')?.click() })
    expect(container.querySelector('.backend-health.failed')?.textContent).toContain('ENOTFOUND')
  })

  it('drops the credentials when the backend changes', () => {
    const harness = mount({ adapter: 'supabase', config: { url: 'https://p.supabase.co', anonKey: 'secret' } })
    act(() => { button('Vortex')?.click() })
    // Carrying a Supabase service key into another vendor's field is
    // both useless and a way to paste it somewhere it does not belong.
    expect(harness.current()).toEqual({ adapter: 'vortex', config: {} })
  })

  it('states what a backend cannot do, not only what it can', () => {
    mount({ adapter: 'supabase', config: {} })
    const realtime = [...container.querySelectorAll('.backend-capabilities tr')]
      .find((row) => row.textContent?.startsWith('Realtime'))
    expect(realtime?.querySelector('.backend-has')?.textContent).toContain('tables')
    expect(realtime?.querySelector('.backend-lacks')?.textContent).toContain('no replay')
  })

  it('says what a built app will call, and what it will not carry', () => {
    mount({
      adapter: 'supabase',
      config: { url: 'https://demo.supabase.co', anonKey: 'anon', serviceKey: 'service' },
    })
    const shipped = container.querySelector('.backend-shipped')?.textContent ?? ''
    expect(shipped).toContain('Built apps call Supabase at demo.supabase.co')
    // The thing worth saying out loud: the key that bypasses every
    // policy is not going into a page anyone can view-source.
    expect(shipped).toContain('Service role key')
    expect(shipped).toContain('stays in the IDE')
  })

  it('distinguishes “not configured” from “the runtimes cannot speak it yet”', () => {
    // Appwrite works in the IDE and has nothing missing, so telling the
    // user the project “has no complete backend yet” would send them
    // looking for a field they already filled in.
    mount({ adapter: 'appwrite', config: { url: 'https://cloud.appwrite.io/v1', projectId: 'proj1' } })
    const shipped = container.querySelector('.backend-shipped')?.textContent ?? ''
    expect(shipped).toContain('cannot speak Appwrite yet')
    expect(shipped).toContain('The IDE talks to Appwrite either way')
    expect(shipped).not.toContain('no complete backend yet')
  })

  it('does not promise a built app an address that is half typed in', () => {
    mount({ adapter: 'supabase', config: { url: 'https://demo.supabase.co' } })
    const shipped = container.querySelector('.backend-shipped')?.textContent ?? ''
    expect(shipped).toContain('local Node service')
    expect(shipped).not.toContain('demo.supabase.co')
  })

  it('clears a stale result when the settings change under it', async () => {
    mount({ adapter: 'self-hosted', config: { url: 'http://localhost:8787' } })
    await act(async () => { button('Test connection')?.click() })
    expect(container.querySelector('.backend-health')).not.toBeNull()

    type(field('Server URL'), 'http://localhost:9999')
    // A green tick next to an address that was never tested is the
    // single most misleading thing this panel could show.
    expect(container.querySelector('.backend-health')).toBeNull()
  })
})
