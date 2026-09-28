/**
 * The protocol and the client that speaks it.
 *
 * The socket is faked here so every branch -- a clean start, a refusal before
 * `ready`, a server that closes mid-session -- can be driven deterministically.
 * `server/shellPlugin.test.ts` does the other half: a real server, a real
 * bash, over a real socket.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_INPUT_BYTES, PTY_SOCKET_PATH, clampCols, clampRows, parseClientMessage, parseServerMessage,
  socketUrlFrom,
} from './ptyProtocol'
import { chooseBackend, createSocketBackend, ipcBackend, probeShellServer, type SocketLike } from './ptyClient'

/** A WebSocket stand-in that records what was sent and can be driven. */
function fakeSocket() {
  const sent: string[] = []
  const socket: SocketLike & { sent: string[]; closed: boolean } = {
    sent,
    closed: false,
    readyState: 1,
    send: (data: string) => { sent.push(data) },
    close: () => { socket.closed = true; socket.onclose?.({}) },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  }
  return socket
}

/** Opens a backend against a fake socket and answers the start handshake. */
async function connected() {
  const socket = fakeSocket()
  const backend = createSocketBackend({ url: 'ws://test/pty', createSocket: () => socket })
  const pending = backend.createTerminal(120, 40)
  socket.onopen?.({})
  socket.onmessage?.({ data: JSON.stringify({ type: 'ready', id: 'web-2', shell: '/bin/bash', cwd: '/w', pid: 99 }) })
  const { id } = await pending
  return { backend, socket, id }
}

describe('the pty protocol', () => {
  it('clamps sizes into what a pty accepts', () => {
    expect(clampCols(0)).toBe(20)
    expect(clampCols(10_000)).toBe(400)
    expect(clampRows(NaN)).toBe(24)
    expect(clampRows(40.4)).toBe(40)
  })

  it('reads the messages a browser sends', () => {
    expect(parseClientMessage('{"type":"input","data":"ls\\r"}'))
      .toEqual({ message: { type: 'input', data: 'ls\r' } })
    expect(parseClientMessage({ type: 'resize', cols: 100, rows: 30 }))
      .toEqual({ message: { type: 'resize', cols: 100, rows: 30 } })
    expect(parseClientMessage({ type: 'kill' })).toEqual({ message: { type: 'kill' } })
  })

  it('refuses a frame instead of throwing on one', () => {
    expect(parseClientMessage('{oops')).toEqual({ error: 'not valid JSON' })
    expect(parseClientMessage({ type: 'input' })).toEqual({ error: 'input needs a string' })
    expect(parseClientMessage({ type: 'launch-missiles' })).toEqual({ error: 'unknown message type "launch-missiles"' })
    expect(parseClientMessage(null)).toEqual({ error: 'not an object' })
  })

  it('caps a paste rather than forwarding it', () => {
    const huge = { type: 'input', data: 'x'.repeat(MAX_INPUT_BYTES + 1) }
    expect(parseClientMessage(huge)).toEqual({ error: 'input too large' })
  })

  it('reads the messages a server sends', () => {
    expect(parseServerMessage({ type: 'ready', id: 'web-1', shell: 'bash', cwd: '/w', pid: 3 }))
      .toEqual({ message: { type: 'ready', id: 'web-1', shell: 'bash', cwd: '/w', pid: 3 } })
    expect(parseServerMessage({ type: 'exit', code: '2' })).toEqual({ message: { type: 'exit', code: 2 } })
    expect(parseServerMessage({ type: 'ready' })).toEqual({ error: 'ready needs an id' })
  })

  it('maps the page URL onto a socket URL', () => {
    expect(socketUrlFrom({ protocol: 'https:', host: 'x.e2b.app' })).toBe(`wss://x.e2b.app${PTY_SOCKET_PATH}`)
    expect(socketUrlFrom({ protocol: 'http:', host: 'localhost:5173' })).toBe(`ws://localhost:5173${PTY_SOCKET_PATH}`)
  })
})

describe('the socket backend', () => {
  it('starts a session with the size it was given, and resolves on ready', async () => {
    const { socket, id } = await connected()
    expect(id).toBe('web-2')
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'start', cols: 120, rows: 40 })
  })

  it('delivers output to the listeners, tagged with the session', async () => {
    const { backend, socket, id } = await connected()
    const seen: Array<{ id: string; data: string }> = []
    backend.onTerminalData((payload) => seen.push(payload))
    socket.onmessage?.({ data: JSON.stringify({ type: 'data', data: 'hello\r\n' }) })
    expect(seen).toEqual([{ id, data: 'hello\r\n' }])
  })

  it('sends input, resizes and kills', async () => {
    const { backend, socket, id } = await connected()
    await backend.writeTerminal(id, 'ls -la\r')
    await backend.resizeTerminal(id, 90, 25)
    await backend.killTerminal(id)
    expect(socket.sent.slice(1).map((raw) => JSON.parse(raw))).toEqual([
      { type: 'input', data: 'ls -la\r' },
      { type: 'resize', cols: 90, rows: 25 },
      { type: 'kill' },
    ])
    expect(socket.closed).toBe(true)
  })

  it('reports the exit code the shell finished with', async () => {
    const { backend, socket, id } = await connected()
    const exits: Array<{ id: string; code: number }> = []
    backend.onTerminalExit((payload) => exits.push(payload))
    socket.onmessage?.({ data: JSON.stringify({ type: 'exit', code: 130 }) })
    expect(exits).toEqual([{ id, code: 130 }])
  })

  it('treats a dropped connection as an exit', async () => {
    const { backend, socket, id } = await connected()
    const exits: Array<{ id: string; code: number }> = []
    backend.onTerminalExit((payload) => exits.push(payload))
    socket.onclose?.({})
    expect(exits).toEqual([{ id, code: 0 }])
  })

  it('rejects when the server refuses before it is ready', async () => {
    const socket = fakeSocket()
    const backend = createSocketBackend({ url: 'ws://test/pty', createSocket: () => socket })
    const pending = backend.createTerminal(80, 24)
    socket.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'Too many shells open (12).' }) })
    await expect(pending).rejects.toThrow('Too many shells open (12).')
  })

  it('rejects when the socket never opens', async () => {
    const socket = fakeSocket()
    const backend = createSocketBackend({ url: 'ws://test/pty', createSocket: () => socket })
    const pending = backend.createTerminal(80, 24)
    socket.onerror?.({})
    await expect(pending).rejects.toThrow('not reachable')
  })

  it('ignores a frame it cannot read rather than dying on it', async () => {
    const { backend, socket } = await connected()
    const seen: unknown[] = []
    backend.onTerminalData((payload) => seen.push(payload))
    socket.onmessage?.({ data: 'not json at all' })
    expect(seen).toEqual([])
  })

  it('stops listening once a subscriber unsubscribes', async () => {
    const { backend, socket } = await connected()
    const seen: unknown[] = []
    const stop = backend.onTerminalData((payload) => seen.push(payload))
    stop()
    socket.onmessage?.({ data: JSON.stringify({ type: 'data', data: 'x' }) })
    expect(seen).toEqual([])
  })
})

describe('finding a shell to attach to', () => {
  it('reports the server when one answers', async () => {
    const asked: string[] = []
    const fetchImpl = async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return new Response(
        JSON.stringify({ available: true, shell: '/bin/bash', cwd: '/w', sessions: 0, maxSessions: 12 }),
        { status: 200 },
      )
    }
    const info = await probeShellServer(fetchImpl as unknown as typeof fetch)
    expect(info?.shell).toBe('/bin/bash')
    expect(asked).toEqual(['/__tungsten/shell/health'])
  })

  it('reports nothing when the host declines, 404s, or is not there', async () => {
    const declined = async () => new Response(JSON.stringify({ available: false, reason: 'TUNGSTEN_SHELL=off' }), { status: 200 })
    const missing = async () => new Response('', { status: 404 })
    const offline = async () => { throw new Error('connection refused') }
    expect(await probeShellServer(declined as unknown as typeof fetch)).toBeNull()
    expect(await probeShellServer(missing as unknown as typeof fetch)).toBeNull()
    expect(await probeShellServer(offline as unknown as typeof fetch)).toBeNull()
  })

  it('prefers the desktop bridge, then the socket, then nothing', () => {
    const socket = createSocketBackend({ url: 'ws://test', createSocket: () => fakeSocket() })
    const ipc = ipcBackend({
      createTerminal: async () => ({ id: '1' }),
      writeTerminal: async () => undefined,
      resizeTerminal: async () => undefined,
      killTerminal: async () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
    })
    expect(chooseBackend(ipc, socket)?.kind).toBe('ipc')
    expect(chooseBackend(null, socket)?.kind).toBe('socket')
    expect(chooseBackend(null, null)).toBeNull()
  })
})
