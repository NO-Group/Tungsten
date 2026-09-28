/**
 * The wire protocol between the workbench and a real shell.
 *
 * The desktop build talks to node-pty over Electron IPC. The browser build
 * has no IPC, so it talks to the same kind of process over a WebSocket served
 * by the dev server. Both ends of that socket need to agree on the messages,
 * and both need to distrust what arrives, so the shapes and their parsers live
 * here -- imported by the client in `ptyClient.ts` and by the server plugin in
 * `server/shellPlugin.ts`.
 *
 * Nothing here spawns anything or touches a socket; it is the grammar only.
 */

/** Where the shell server is mounted. One path for the socket, one for HTTP. */
export const PTY_SOCKET_PATH = '/__tungsten/pty'
export const SHELL_HTTP_PREFIX = '/__tungsten/shell'

/** Guard rails, enforced on the server and mirrored in the client. */
export const MAX_INPUT_BYTES = 65536
export const MAX_COLUMNS = 400
export const MAX_ROWS = 200
export const MIN_COLUMNS = 20
export const MIN_ROWS = 5
/** How many shells one browser session may hold open at once. */
export const MAX_SESSIONS = 12

export type ClientMessage =
  | { type: 'start'; cols: number; rows: number; cwd?: string; shell?: string }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' }

export type ServerMessage =
  | { type: 'ready'; id: string; shell: string; cwd: string; pid: number }
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }

/** What the health endpoint reports, and what the workbench decides from. */
export type ShellInfo = {
  /** True when a real process can be spawned; false when the host declined. */
  available: boolean
  shell: string
  cwd: string
  /** Why it is unavailable, when it is. */
  reason?: string
  sessions: number
  maxSessions: number
}

/** Clamps a terminal dimension into the range a PTY will accept. */
export function clampSize(value: unknown, min: number, max: number, fallback: number): number {
  const size = Math.round(Number(value))
  if (!Number.isFinite(size)) return fallback
  return Math.max(min, Math.min(max, size))
}

export function clampCols(value: unknown): number {
  return clampSize(value, MIN_COLUMNS, MAX_COLUMNS, 80)
}

export function clampRows(value: unknown): number {
  return clampSize(value, MIN_ROWS, MAX_ROWS, 24)
}

/**
 * Reads a message from the browser.
 *
 * Returns the message, or the reason it was rejected -- never throws, because
 * the caller is a socket handler and a bad frame must not take the server
 * down with it.
 */
export function parseClientMessage(raw: unknown): { message: ClientMessage } | { error: string } {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { error: 'not valid JSON' }
    }
  }
  if (!value || typeof value !== 'object') return { error: 'not an object' }
  const record = value as Record<string, unknown>

  switch (record.type) {
    case 'start':
      return {
        message: {
          type: 'start',
          cols: clampCols(record.cols),
          rows: clampRows(record.rows),
          cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
          shell: typeof record.shell === 'string' ? record.shell : undefined,
        },
      }
    case 'input': {
      if (typeof record.data !== 'string') return { error: 'input needs a string' }
      // Paste is the reason for the cap; a keystroke never comes close.
      if (record.data.length > MAX_INPUT_BYTES) return { error: 'input too large' }
      return { message: { type: 'input', data: record.data } }
    }
    case 'resize':
      return { message: { type: 'resize', cols: clampCols(record.cols), rows: clampRows(record.rows) } }
    case 'kill':
      return { message: { type: 'kill' } }
    default:
      return { error: `unknown message type ${JSON.stringify(record.type)}` }
  }
}

/** Reads a message from the server. Same contract, opposite direction. */
export function parseServerMessage(raw: unknown): { message: ServerMessage } | { error: string } {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { error: 'not valid JSON' }
    }
  }
  if (!value || typeof value !== 'object') return { error: 'not an object' }
  const record = value as Record<string, unknown>

  switch (record.type) {
    case 'ready':
      if (typeof record.id !== 'string') return { error: 'ready needs an id' }
      return {
        message: {
          type: 'ready',
          id: record.id,
          shell: typeof record.shell === 'string' ? record.shell : 'shell',
          cwd: typeof record.cwd === 'string' ? record.cwd : '',
          pid: Number(record.pid) || 0,
        },
      }
    case 'data':
      if (typeof record.data !== 'string') return { error: 'data needs a string' }
      return { message: { type: 'data', data: record.data } }
    case 'exit':
      return { message: { type: 'exit', code: Number(record.code) || 0 } }
    case 'error':
      return { message: { type: 'error', message: String(record.message || 'shell error') } }
    default:
      return { error: `unknown message type ${JSON.stringify(record.type)}` }
  }
}

/** The socket URL for the page it is running in, http(s) mapped to ws(s). */
export function socketUrlFrom(location: { protocol: string; host: string }): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${PTY_SOCKET_PATH}`
}
