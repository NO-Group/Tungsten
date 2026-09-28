/**
 * A real shell for the browser build.
 *
 * On the desktop, Tungsten spawns a PTY in the Electron main process and the
 * terminal talks to it over IPC. In a browser there is no main process -- so
 * the dev server hosts the same PTY behind a WebSocket, and this module
 * presents it to the workbench through exactly the API the IPC bridge
 * exposes. `DesktopTerminal` therefore does not know or care which one it is
 * driving: same xterm, same resize, same scrollback, same bash.
 *
 * The WebSocket constructor and `fetch` are injectable so the whole thing can
 * be driven by a fake in tests.
 */

import {
  PTY_SOCKET_PATH, SHELL_HTTP_PREFIX, parseServerMessage, socketUrlFrom,
  type ShellInfo,
} from './ptyProtocol'

/** The slice of `window.tungsten` a terminal needs. Implemented twice. */
/** A remote shell flavour the desktop build can open instead of a local one. */
export type TerminalProfileRef = { kind: 'wsl' | 'container'; id: string }

export type TerminalBackend = {
  /** 'ipc' is the desktop's main process; 'socket' is the dev server's shell. */
  kind: 'ipc' | 'socket'
  createTerminal: (cols: number, rows: number, profile?: TerminalProfileRef) => Promise<{ id: string }>
  writeTerminal: (id: string, data: string) => Promise<unknown>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<unknown>
  killTerminal: (id: string) => Promise<unknown>
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => () => void
}

/** The minimum of the WebSocket interface this client uses. */
export type SocketLike = {
  readyState: number
  send: (data: string) => void
  close: () => void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type SocketFactory = (url: string) => SocketLike

export type SocketBackendOptions = {
  url?: string
  createSocket?: SocketFactory
}

const OPEN = 1

/**
 * Asks the dev server whether it will give us a shell.
 *
 * A miss is the normal case -- a production bundle on static hosting has no
 * shell server -- so a failure resolves to null rather than rejecting.
 */
export async function probeShellServer(
  fetchImpl: typeof fetch = globalThis.fetch,
  prefix: string = SHELL_HTTP_PREFIX,
): Promise<ShellInfo | null> {
  if (!fetchImpl) return null
  try {
    const response = await fetchImpl(`${prefix}/health`, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const info = (await response.json()) as ShellInfo
    return info && typeof info === 'object' && info.available ? info : null
  } catch {
    return null
  }
}

/**
 * Builds the backend.
 *
 * One socket per terminal: the session's lifetime is the socket's lifetime,
 * so a closed tab cannot leave a process running, and a dropped connection
 * surfaces as the exit it really is.
 */
export function createSocketBackend(options: SocketBackendOptions = {}): TerminalBackend {
  const {
    url = typeof window === 'undefined' ? PTY_SOCKET_PATH : socketUrlFrom(window.location),
    createSocket = ((target: string) => new WebSocket(target) as unknown as SocketLike) as SocketFactory,
  } = options

  const sockets = new Map<string, SocketLike>()
  const dataListeners = new Set<(payload: { id: string; data: string }) => void>()
  const exitListeners = new Set<(payload: { id: string; code: number }) => void>()

  const emitData = (id: string, data: string) => { for (const listener of dataListeners) listener({ id, data }) }
  const emitExit = (id: string, code: number) => { for (const listener of exitListeners) listener({ id, code }) }

  const send = (id: string, payload: unknown) => {
    const socket = sockets.get(id)
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(payload))
  }

  const createTerminal = (cols: number, rows: number) => new Promise<{ id: string }>((resolve, reject) => {
    const socket = createSocket(url)
    let id: string | null = null
    let settled = false

    socket.onopen = () => socket.send(JSON.stringify({ type: 'start', cols, rows }))

    socket.onmessage = (event) => {
      const parsed = parseServerMessage(event.data)
      if ('error' in parsed) return
      const message = parsed.message

      if (message.type === 'ready') {
        id = message.id
        sockets.set(id, socket)
        settled = true
        resolve({ id })
        return
      }
      if (!id) {
        // Anything before `ready` that is not `ready` is a failure to start.
        if (message.type === 'error' && !settled) { settled = true; reject(new Error(message.message)) }
        return
      }
      if (message.type === 'data') emitData(id, message.data)
      if (message.type === 'error') emitData(id, `\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
      if (message.type === 'exit') emitExit(id, message.code)
    }

    socket.onerror = () => {
      if (!settled) { settled = true; reject(new Error('The shell server is not reachable.')) }
    }

    socket.onclose = () => {
      if (!settled) { settled = true; reject(new Error('The shell server closed the connection.')) }
      if (id) { sockets.delete(id); emitExit(id, 0) }
    }
  })

  return {
    kind: 'socket',
    createTerminal,
    writeTerminal: async (id, data) => { send(id, { type: 'input', data }) },
    resizeTerminal: async (id, cols, rows) => { send(id, { type: 'resize', cols, rows }) },
    killTerminal: async (id) => {
      send(id, { type: 'kill' })
      sockets.get(id)?.close()
      sockets.delete(id)
    },
    onTerminalData: (callback) => { dataListeners.add(callback); return () => dataListeners.delete(callback) },
    onTerminalExit: (callback) => { exitListeners.add(callback); return () => exitListeners.delete(callback) },
  }
}

/** Wraps the Electron bridge in the same shape, so callers see one type. */
export function ipcBackend(api: {
  createTerminal: (cols: number, rows: number, profile?: TerminalProfileRef) => Promise<{ id: string }>
  writeTerminal: (id: string, data: string) => Promise<unknown>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<unknown>
  killTerminal: (id: string) => Promise<unknown>
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => () => void
}): TerminalBackend {
  return {
    kind: 'ipc',
    createTerminal: (cols, rows, profile) => api.createTerminal(cols, rows, profile),
    writeTerminal: (id, data) => api.writeTerminal(id, data),
    resizeTerminal: (id, cols, rows) => api.resizeTerminal(id, cols, rows),
    killTerminal: (id) => api.killTerminal(id),
    onTerminalData: (callback) => api.onTerminalData(callback),
    onTerminalExit: (callback) => api.onTerminalExit(callback),
  }
}

/**
 * Picks the backend for this build.
 *
 * Electron's bridge wins when it is there -- it is a local process with no
 * socket in between. Otherwise the dev server's shell is used, if the probe
 * found one. Neither means the emulated sandbox shell, which is always there.
 */
export function chooseBackend(
  ipc: TerminalBackend | null | undefined,
  socket: TerminalBackend | null | undefined,
): TerminalBackend | null {
  return ipc || socket || null
}
