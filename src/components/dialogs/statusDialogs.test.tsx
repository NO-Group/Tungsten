/**
 * @vitest-environment jsdom
 *
 * The three dialogs behind the status bar's right-hand end.
 *
 * Each of these replaced a control that did nothing, so the tests are
 * about the thing being done: the picker returns the id it was asked
 * for, the notification list shows what the toast lost, and the
 * runtime screen states a capability rather than implying one.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickPick } from './QuickPick'
import { NotificationCentre } from './NotificationCentre'
import { RuntimeDialog } from './RuntimeDialog'
import { describeRuntime } from '../../web/runtimeFacts'
import { addNotification, EMPTY_NOTIFICATIONS } from '../../notifications/notifications'

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

function render(node: React.ReactElement) {
  act(() => root.render(node))
}

function rows(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.quick-pick-list button')]
}

function press(key: string) {
  act(() => {
    container.querySelector('.quick-pick-head')?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    )
  })
}

const ITEMS = [
  { id: 'lf', label: 'LF', detail: 'Unix', current: true },
  { id: 'crlf', label: 'CRLF', detail: 'Windows' },
]

describe('the quick pick', () => {
  it('starts on the current value and returns the one you choose', () => {
    const onPick = vi.fn()
    render(<QuickPick title="Line endings" subtitle="app.ts" items={ITEMS} onPick={onPick} onClose={() => {}} />)

    expect(container.textContent).toContain('app.ts')
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    act(() => { rows()[1].click() })
    expect(onPick).toHaveBeenCalledWith('crlf')
  })

  it('is usable from the keyboard, and wraps', () => {
    const onPick = vi.fn()
    render(<QuickPick title="Line endings" items={ITEMS} onPick={onPick} onClose={() => {}} />)

    press('ArrowDown')
    expect(rows()[1].getAttribute('aria-selected')).toBe('true')
    press('ArrowDown')
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    press('Enter')
    expect(onPick).toHaveBeenCalledWith('lf')
  })

  it('ticks the current row and groups the destructive half', () => {
    render(
      <QuickPick
        title="Indentation"
        items={[
          { id: 'spaces-2', label: 'Indent using spaces (2)', current: true, group: 'What new indentation uses' },
          { id: 'convert-tabs', label: 'Convert this file to tabs', note: 'Leading whitespace only.', group: 'Rewrite the file' },
        ]}
        onPick={() => {}}
        onClose={() => {}}
      />,
    )
    expect(container.querySelectorAll('.palette-label')).toHaveLength(2)
    expect(container.textContent).toContain('Rewrite the file')
    expect(container.textContent).toContain('Leading whitespace only.')
    expect(rows()[0].querySelector('.quick-pick-tick svg')).not.toBeNull()
    expect(rows()[1].querySelector('.quick-pick-tick svg')).toBeNull()
  })
})

describe('the notification centre', () => {
  const T0 = Date.UTC(2026, 8, 23, 9, 0, 0)
  const state = [
    { message: 'Saved src/app.ts', at: T0 },
    { message: 'The Android build failed', severity: 'error' as const, at: T0 + 60_000, source: 'Builder' },
  ].reduce((current, input) => addNotification(current, input), EMPTY_NOTIFICATIONS)

  it('shows what the toast threw away, with a time and a source', () => {
    render(<NotificationCentre entries={state.entries} now={T0 + 120_000} onDismiss={() => {}} onClear={() => {}} onClose={() => {}} />)
    expect(container.textContent).toContain('The Android build failed')
    expect(container.textContent).toContain('Builder · 1 minute ago')
    expect(container.textContent).toContain('Saved src/app.ts')
    expect(container.querySelector('.notification.error')).not.toBeNull()
  })

  it('dismisses one and clears the lot', () => {
    const onDismiss = vi.fn()
    const onClear = vi.fn()
    render(<NotificationCentre entries={state.entries} now={T0} onDismiss={onDismiss} onClear={onClear} onClose={() => {}} />)

    const dismiss = [...container.querySelectorAll('button')].find((node) => node.getAttribute('aria-label')?.startsWith('Dismiss'))
    act(() => { dismiss?.click() })
    expect(onDismiss).toHaveBeenCalledWith(state.entries[0].id)

    const clear = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('Clear'))
    act(() => { clear?.click() })
    expect(onClear).toHaveBeenCalled()
  })

  it('says what will land here when nothing has', () => {
    render(<NotificationCentre entries={[]} now={T0} onDismiss={() => {}} onClear={() => {}} onClose={() => {}} />)
    expect(container.querySelector('.notification-empty')?.textContent).toContain('Nothing yet')
    const clear = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('Clear'))
    expect((clear as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the runtime dialog', () => {
  it('states what a browser tab cannot do instead of leaving it blank', () => {
    const facts = describeRuntime({
      protocol: 'https:',
      serviceWorker: true,
      pty: false,
      persistence: true,
      aiGateway: false,
    })
    render(<RuntimeDialog facts={facts} onClose={() => {}} />)

    expect(container.textContent).toContain('Web · https')
    expect(container.querySelector('.runtime-capability.no')?.textContent).toContain('Real file system')
    expect(container.textContent).toContain('Works offline')
    // No gateway means the AI row is a "no" with a reason, not a sales pitch.
    expect(container.textContent).toContain('Nothing is billed.')
  })

  it('reports the desktop shell and its versions', () => {
    const facts = describeRuntime({
      desktop: { platform: 'linux', versions: { electron: '34.0.0', chromium: '132', node: '22.22.3' } },
      protocol: 'file:',
      serviceWorker: false,
      pty: true,
      persistence: true,
      aiGateway: true,
    })
    render(<RuntimeDialog facts={facts} onClose={() => {}} />)

    expect(container.textContent).toContain('Desktop · linux')
    expect(container.textContent).toContain('22.22.3')
    expect(container.querySelectorAll('.runtime-capability.no')).toHaveLength(0)
  })
})
