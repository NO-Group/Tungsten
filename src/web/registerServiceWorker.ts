/**
 * Registering the offline worker, and telling the user when a new build is
 * waiting.
 *
 * The desktop app already has somewhere to say this: the status bar item
 * that reads "Up to date" and becomes "Restart to update" when the updater
 * has downloaded something. The web has exactly the same situation -- a
 * new version exists, the running one is still fine, the user decides when
 * to take it -- so it uses the same slot rather than inventing a banner.
 *
 * Everything here is written against the smallest structural types it
 * needs instead of lib.dom's `ServiceWorkerContainer`, so the logic can be
 * tested with a stub in a few lines, which is the only way a code path
 * that only runs on a second deploy ever gets tested at all.
 */

export const WAITING_LABEL = 'Reload to update'
export const SKIP_WAITING = 'tungsten:skip-waiting'

type Listener = (event?: { target?: unknown }) => void

export type WorkerLike = {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', listener: Listener): void
  removeEventListener?(type: 'statechange', listener: Listener): void
}

export type RegistrationLike = {
  installing: WorkerLike | null
  waiting: WorkerLike | null
  addEventListener(type: 'updatefound', listener: Listener): void
  removeEventListener?(type: 'updatefound', listener: Listener): void
  update?(): Promise<unknown>
}

export type ContainerLike = {
  controller: WorkerLike | null
  register(url: string, options?: { scope?: string }): Promise<RegistrationLike>
  addEventListener(type: 'controllerchange', listener: Listener): void
  removeEventListener?(type: 'controllerchange', listener: Listener): void
}

export type RegisterOptions = {
  url?: string
  scope?: string
  /** Called with the worker that is installed and waiting its turn. */
  onWaiting: (worker: WorkerLike) => void
}

export type Registration = {
  /** Checks for a new build; safe to call at any time. */
  check: () => void
  dispose: () => void
}

/**
 * True only when the new worker is replacing a running one.
 *
 * On a first visit a worker also reaches `installed`, but there is nothing
 * to update *from* -- the page is already the newest thing there is.
 * Prompting then is the classic service-worker bug that teaches people to
 * ignore the prompt.
 */
export function isUpdate(container: ContainerLike, worker: WorkerLike): boolean {
  return worker.state === 'installed' && container.controller !== null
}

export function registerServiceWorker(
  container: ContainerLike | undefined,
  options: RegisterOptions,
): Registration {
  const noop: Registration = { check: () => {}, dispose: () => {} }
  if (!container) return noop

  let disposed = false
  let registration: RegistrationLike | undefined
  const cleanups: Array<() => void> = []

  const watch = (worker: WorkerLike | null) => {
    if (!worker || disposed) return
    if (isUpdate(container, worker)) {
      options.onWaiting(worker)
      return
    }
    const listener: Listener = () => {
      if (disposed) return
      if (isUpdate(container, worker)) {
        options.onWaiting(worker)
        worker.removeEventListener?.('statechange', listener)
      }
    }
    worker.addEventListener('statechange', listener)
    cleanups.push(() => worker.removeEventListener?.('statechange', listener))
  }

  void container
    .register(options.url ?? './sw.js', options.scope ? { scope: options.scope } : undefined)
    .then((result) => {
      if (disposed) return
      registration = result
      // A worker can already be waiting from a previous visit, in which
      // case `updatefound` has long since fired and will not fire again.
      if (result.waiting) watch(result.waiting)
      watch(result.installing)
      const found: Listener = () => watch(result.installing)
      result.addEventListener('updatefound', found)
      cleanups.push(() => result.removeEventListener?.('updatefound', found))
    })
    .catch((error) => {
      // An unregistrable worker is not a reason to break the editor; it
      // just means this session is online-only.
      console.warn('[tungsten] offline support unavailable', error)
    })

  return {
    check: () => { void registration?.update?.() },
    dispose: () => {
      disposed = true
      cleanups.forEach((off) => off())
      cleanups.length = 0
    },
  }
}

/**
 * Takes the waiting build.
 *
 * The worker is told to activate, and the page reloads once it has -- not
 * before, or the reload would just load the old build again. The guard
 * matters: `controllerchange` can fire more than once, and a reload loop
 * is indistinguishable from a crash.
 */
export function applyUpdate(
  container: ContainerLike | undefined,
  worker: WorkerLike | null | undefined,
  reload: () => void,
): void {
  if (!container) {
    reload()
    return
  }
  let reloaded = false
  const listener: Listener = () => {
    if (reloaded) return
    reloaded = true
    container.removeEventListener?.('controllerchange', listener)
    reload()
  }
  container.addEventListener('controllerchange', listener)
  if (worker) worker.postMessage({ type: SKIP_WAITING })
  else listener()
}
