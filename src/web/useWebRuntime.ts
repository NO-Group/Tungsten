import { useCallback, useEffect, useRef, useState } from 'react'

import {
  WAITING_LABEL,
  applyUpdate,
  registerServiceWorker,
  type ContainerLike,
  type WorkerLike,
} from './registerServiceWorker'

export { WAITING_LABEL }

export const OFFLINE_LABEL = 'Offline'

export type WebRuntime = {
  /** False when the browser says there is no network. */
  online: boolean
  /** A newer build is installed and waiting for permission to take over. */
  waiting: boolean
  /** Take the waiting build. Reloads the page. */
  apply: () => void
  /** Ask whether a newer build exists. */
  check: () => void
  /** True when this process is actually being served over the web. */
  active: boolean
}

export type WebRuntimeOptions = {
  /** Injected in tests; defaults to the real `navigator.serviceWorker`. */
  container?: ContainerLike
  /** Defaults to "a production build that is not the desktop shell". */
  enabled?: boolean
}

function defaultContainer(): ContainerLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  const container = (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker
  return container as ContainerLike | undefined
}

/**
 * Being a website.
 *
 * Two things are true in a browser that are not true in the desktop shell:
 * the network can disappear mid-sentence, and a new version can be
 * published while the old one is still open. This hook watches for both
 * and hands the answers to the status bar, which already has a slot for
 * exactly this kind of news.
 *
 * It does nothing at all in the desktop app, where `window.tungsten`
 * exists and the real updater is in charge, and nothing in development,
 * where a cached shell would quietly serve a stale build over the dev
 * server and cost someone an afternoon.
 */
export function useWebRuntime(options: WebRuntimeOptions = {}): WebRuntime {
  const container = 'container' in options ? options.container : defaultContainer()
  const enabled = options.enabled ?? (
    import.meta.env.PROD
    && typeof window !== 'undefined'
    && !(window as { tungsten?: unknown }).tungsten
  )

  const [online, setOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  ))
  const [waiting, setWaiting] = useState<WorkerLike | null>(null)
  const check = useRef<() => void>(() => {})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => { setOnline(navigator.onLine !== false) }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !container) return
    const registration = registerServiceWorker(container, {
      onWaiting: (worker) => { setWaiting(worker) },
    })
    check.current = registration.check
    return () => {
      check.current = () => {}
      registration.dispose()
    }
  }, [container, enabled])

  const apply = useCallback(() => {
    applyUpdate(container, waiting, () => { window.location.reload() })
  }, [container, waiting])

  return {
    online,
    waiting: waiting !== null,
    apply,
    check: useCallback(() => { check.current() }, []),
    active: Boolean(enabled && container),
  }
}

/**
 * What the status bar should say.
 *
 * The desktop updater owns this slot when it is running, so its label wins
 * whenever it has something more specific to report than "Up to date".
 */
export function statusLabel(runtime: WebRuntime, desktopLabel: string): string {
  if (!runtime.active) return desktopLabel
  if (!runtime.online) return OFFLINE_LABEL
  if (runtime.waiting) return WAITING_LABEL
  return desktopLabel
}

export function statusTitle(runtime: WebRuntime, label: string): string {
  if (!runtime.active) return label
  if (!runtime.online) return 'You are offline. Tungsten is running from its own cache; your work is saved locally.'
  if (runtime.waiting) return 'A new version of Tungsten is ready. Click to reload into it.'
  return 'Tungsten is up to date. Click to check again.'
}
