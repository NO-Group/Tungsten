// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'

import {
  OFFLINE_LABEL,
  WAITING_LABEL,
  statusLabel,
  statusTitle,
  useWebRuntime,
  type WebRuntime,
} from './useWebRuntime'
import type { ContainerLike, RegistrationLike, WorkerLike } from './registerServiceWorker'

function makeWorker(state = 'installed'): WorkerLike & { messages: unknown[] } {
  return {
    state,
    messages: [] as unknown[],
    postMessage(message: unknown) { this.messages.push(message) },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

function makeContainer(waiting: WorkerLike | null = null) {
  const controllers: Array<() => void> = []
  const registration: RegistrationLike = {
    installing: null,
    waiting,
    update: vi.fn(async () => undefined),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const container: ContainerLike = {
    controller: makeWorker('activated'),
    register: vi.fn(async () => registration),
    addEventListener: (_type: 'controllerchange', listener: () => void) => { controllers.push(listener) },
    removeEventListener: (_type: 'controllerchange', listener: () => void) => {
      const at = controllers.indexOf(listener)
      if (at >= 0) controllers.splice(at, 1)
    },
  }
  return { container, registration, fireControllerChange: () => controllers.slice().forEach((l) => l()) }
}

/** Renders the hook and keeps the latest value to hand. */
async function mount(options: Parameters<typeof useWebRuntime>[0]) {
  const seen: WebRuntime[] = []
  const host = document.createElement('div')
  document.body.append(host)
  let root: Root | undefined
  function Probe() {
    seen.push(useWebRuntime(options))
    return null
  }
  await act(async () => {
    root = createRoot(host)
    root.render(createElement(Probe))
  })
  return {
    latest: () => seen[seen.length - 1],
    unmount: async () => { await act(async () => { root?.unmount() }) },
  }
}

const online = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

describe('useWebRuntime', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    online(true)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('stays out of the way when it is disabled', async () => {
    const { container, registration } = makeContainer()
    const probe = await mount({ container, enabled: false })
    expect(container.register).not.toHaveBeenCalled()
    expect(probe.latest().active).toBe(false)
    expect(registration.update).not.toHaveBeenCalled()
    await probe.unmount()
  })

  it('is inactive where there is no service worker at all', async () => {
    const probe = await mount({ container: undefined, enabled: true })
    expect(probe.latest().active).toBe(false)
    await probe.unmount()
  })

  it('registers the worker when it is serving the web', async () => {
    const { container } = makeContainer()
    const probe = await mount({ container, enabled: true })
    expect(container.register).toHaveBeenCalled()
    expect(probe.latest().active).toBe(true)
    await probe.unmount()
  })

  it('reports a build that is already waiting', async () => {
    const waiting = makeWorker('installed')
    const { container } = makeContainer(waiting)
    const probe = await mount({ container, enabled: true })
    await act(async () => { await Promise.resolve() })
    expect(probe.latest().waiting).toBe(true)
    await probe.unmount()
  })

  it('takes the waiting build when asked', async () => {
    const waiting = makeWorker('installed')
    const harness = makeContainer(waiting)
    const probe = await mount({ container: harness.container, enabled: true })
    await act(async () => { await Promise.resolve() })
    act(() => { probe.latest().apply() })
    expect(waiting.messages).toHaveLength(1)
    await probe.unmount()
  })

  it('follows the browser on and off the network', async () => {
    const { container } = makeContainer()
    const probe = await mount({ container, enabled: true })
    expect(probe.latest().online).toBe(true)

    online(false)
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(probe.latest().online).toBe(false)

    online(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(probe.latest().online).toBe(true)
    await probe.unmount()
  })

  it('starts offline if that is how the page was opened', async () => {
    online(false)
    const { container } = makeContainer()
    const probe = await mount({ container, enabled: true })
    expect(probe.latest().online).toBe(false)
    await probe.unmount()
  })

  it('checks for a newer build on demand', async () => {
    const harness = makeContainer()
    const probe = await mount({ container: harness.container, enabled: true })
    await act(async () => { await Promise.resolve() })
    act(() => { probe.latest().check() })
    expect(harness.registration.update).toHaveBeenCalled()
    await probe.unmount()
  })

  it('stops checking once unmounted', async () => {
    const harness = makeContainer()
    const probe = await mount({ container: harness.container, enabled: true })
    await act(async () => { await Promise.resolve() })
    const runtime = probe.latest()
    await probe.unmount()
    runtime.check()
    expect(harness.registration.update).not.toHaveBeenCalled()
  })
})

describe('statusLabel', () => {
  const runtime = (overrides: Partial<WebRuntime>): WebRuntime => ({
    online: true, waiting: false, active: true, apply: () => {}, check: () => {}, ...overrides,
  })

  it('leaves the desktop updater alone', () => {
    expect(statusLabel(runtime({ active: false, online: false }), 'Restart to update'))
      .toBe('Restart to update')
  })

  it('says so when there is no network', () => {
    expect(statusLabel(runtime({ online: false }), 'Up to date')).toBe(OFFLINE_LABEL)
  })

  it('offers the new build once one is waiting', () => {
    expect(statusLabel(runtime({ waiting: true }), 'Up to date')).toBe(WAITING_LABEL)
  })

  it('prefers the offline news over the update news', () => {
    expect(statusLabel(runtime({ online: false, waiting: true }), 'Up to date')).toBe(OFFLINE_LABEL)
  })

  it('falls through to whatever it was told otherwise', () => {
    expect(statusLabel(runtime({}), 'Up to date')).toBe('Up to date')
  })
})

describe('statusTitle', () => {
  const runtime = (overrides: Partial<WebRuntime>): WebRuntime => ({
    online: true, waiting: false, active: true, apply: () => {}, check: () => {}, ...overrides,
  })

  it('explains that work is safe while offline', () => {
    expect(statusTitle(runtime({ online: false }), OFFLINE_LABEL)).toContain('saved locally')
  })

  it('explains what clicking will do about an update', () => {
    expect(statusTitle(runtime({ waiting: true }), WAITING_LABEL)).toContain('reload')
  })

  it('is just the label on the desktop', () => {
    expect(statusTitle(runtime({ active: false }), 'Up to date')).toBe('Up to date')
  })
})
