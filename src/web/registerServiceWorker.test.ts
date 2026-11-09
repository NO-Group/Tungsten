import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SKIP_WAITING,
  applyUpdate,
  isUpdate,
  registerServiceWorker,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from './registerServiceWorker'

function makeWorker(state = 'installing'): WorkerLike & { fire: () => void; messages: unknown[] } {
  const listeners: Array<() => void> = []
  return {
    state,
    messages: [] as unknown[],
    postMessage(message: unknown) { this.messages.push(message) },
    addEventListener: (_type: 'statechange', listener: () => void) => { listeners.push(listener) },
    removeEventListener: (_type: 'statechange', listener: () => void) => {
      const at = listeners.indexOf(listener)
      if (at >= 0) listeners.splice(at, 1)
    },
    fire: () => listeners.slice().forEach((listener) => listener()),
  }
}

function makeContainer(registration: Partial<RegistrationLike> = {}) {
  const found: Array<() => void> = []
  const controllers: Array<() => void> = []
  const update = vi.fn(async () => undefined)
  const full: RegistrationLike = {
    installing: null,
    waiting: null,
    update,
    addEventListener: (_type: 'updatefound', listener: () => void) => { found.push(listener) },
    removeEventListener: (_type: 'updatefound', listener: () => void) => {
      const at = found.indexOf(listener)
      if (at >= 0) found.splice(at, 1)
    },
    ...registration,
  }
  const register = vi.fn(async () => full)
  const container: ContainerLike = {
    controller: null,
    register,
    addEventListener: (_type: 'controllerchange', listener: () => void) => { controllers.push(listener) },
    removeEventListener: (_type: 'controllerchange', listener: () => void) => {
      const at = controllers.indexOf(listener)
      if (at >= 0) controllers.splice(at, 1)
    },
  }
  return {
    container,
    registration: full,
    register,
    update,
    fireUpdateFound: () => found.slice().forEach((listener) => listener()),
    fireControllerChange: () => controllers.slice().forEach((listener) => listener()),
    controllerCount: () => controllers.length,
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('isUpdate', () => {
  it('is false while installing', () => {
    const harness = makeContainer()
    expect(isUpdate(harness.container, makeWorker('installing'))).toBe(false)
  })

  it('is false on a first visit, when nothing is being replaced', () => {
    const harness = makeContainer()
    expect(isUpdate(harness.container, makeWorker('installed'))).toBe(false)
  })

  it('is true once an installed worker is queued behind a running one', () => {
    const harness = makeContainer()
    harness.container.controller = makeWorker('activated')
    expect(isUpdate(harness.container, makeWorker('installed'))).toBe(true)
  })
})

describe('registerServiceWorker', () => {
  it('does nothing without support, and does not throw', () => {
    const onWaiting = vi.fn()
    const handle = registerServiceWorker(undefined, { onWaiting })
    expect(() => { handle.check(); handle.dispose() }).not.toThrow()
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('registers the worker beside the page', async () => {
    const harness = makeContainer()
    registerServiceWorker(harness.container, { onWaiting: vi.fn() })
    await settle()
    expect(harness.register).toHaveBeenCalledWith('./sw.js', undefined)
  })

  it('honours an explicit url and scope', async () => {
    const harness = makeContainer()
    registerServiceWorker(harness.container, { url: '/worker.js', scope: '/', onWaiting: vi.fn() })
    await settle()
    expect(harness.register).toHaveBeenCalledWith('/worker.js', { scope: '/' })
  })

  it('reports a worker that was already waiting from a previous visit', async () => {
    const onWaiting = vi.fn()
    const waiting = makeWorker('installed')
    const harness = makeContainer({ waiting })
    harness.container.controller = makeWorker('activated')
    registerServiceWorker(harness.container, { onWaiting })
    await settle()
    expect(onWaiting).toHaveBeenCalledWith(waiting)
  })

  it('stays quiet on a first install', async () => {
    const onWaiting = vi.fn()
    const installing = makeWorker('installing')
    const harness = makeContainer({ installing })
    registerServiceWorker(harness.container, { onWaiting })
    await settle()
    installing.state = 'installed'
    installing.fire()
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('reports an update that arrives while the page is open', async () => {
    const onWaiting = vi.fn()
    const harness = makeContainer()
    harness.container.controller = makeWorker('activated')
    registerServiceWorker(harness.container, { onWaiting })
    await settle()

    const installing = makeWorker('installing')
    harness.registration.installing = installing
    harness.fireUpdateFound()
    expect(onWaiting).not.toHaveBeenCalled()

    installing.state = 'installed'
    installing.fire()
    expect(onWaiting).toHaveBeenCalledWith(installing)
  })

  it('reports once, not on every later state change', async () => {
    const onWaiting = vi.fn()
    const harness = makeContainer()
    harness.container.controller = makeWorker('activated')
    registerServiceWorker(harness.container, { onWaiting })
    await settle()

    const installing = makeWorker('installing')
    harness.registration.installing = installing
    harness.fireUpdateFound()
    installing.state = 'installed'
    installing.fire()
    installing.fire()
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  it('says nothing after dispose', async () => {
    const onWaiting = vi.fn()
    const harness = makeContainer()
    harness.container.controller = makeWorker('activated')
    const handle = registerServiceWorker(harness.container, { onWaiting })
    await settle()
    const installing = makeWorker('installing')
    harness.registration.installing = installing
    harness.fireUpdateFound()
    handle.dispose()
    installing.state = 'installed'
    installing.fire()
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('checks for a new build on demand', async () => {
    const harness = makeContainer()
    const handle = registerServiceWorker(harness.container, { onWaiting: vi.fn() })
    await settle()
    handle.check()
    expect(harness.update).toHaveBeenCalled()
  })

  it('survives a registration that is refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = makeContainer()
    harness.container.register = vi.fn(async () => { throw new Error('insecure origin') })
    const handle = registerServiceWorker(harness.container, { onWaiting: vi.fn() })
    await settle()
    expect(warn).toHaveBeenCalled()
    expect(() => handle.check()).not.toThrow()
    warn.mockRestore()
  })
})

describe('applyUpdate', () => {
  const makeReload = () => vi.fn(() => {})
  let reload = makeReload()

  beforeEach(() => { reload = makeReload() })
  afterEach(() => { vi.restoreAllMocks() })

  it('reloads immediately with no worker layer at all', () => {
    applyUpdate(undefined, null, reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('tells the waiting worker to take over, then reloads', () => {
    const harness = makeContainer()
    const waiting = makeWorker('installed')
    applyUpdate(harness.container, waiting, reload)
    expect(waiting.messages).toEqual([{ type: SKIP_WAITING }])
    expect(reload).not.toHaveBeenCalled()
    harness.fireControllerChange()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads once however many times the controller changes', () => {
    const harness = makeContainer()
    applyUpdate(harness.container, makeWorker('installed'), reload)
    harness.fireControllerChange()
    harness.fireControllerChange()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(harness.controllerCount()).toBe(0)
  })

  it('falls back to a plain reload when there is nothing waiting', () => {
    const harness = makeContainer()
    applyUpdate(harness.container, null, reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
