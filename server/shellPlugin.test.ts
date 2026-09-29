/**
 * The shell server, proved by running one.
 *
 * A Vite dev server is started in process with the plugin attached, and then
 * driven the way the browser drives it: probe the health endpoint, open the
 * socket, start a shell, type a command, read the output. Anything less would
 * only be testing my description of a PTY.
 *
 * If node-pty cannot load on this machine the suite reports that the server
 * says so, and skips the parts that need a process.
 */

import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import WebSocket from 'ws'

import { tungstenShell } from './shellPlugin.ts'
import { PTY_SOCKET_PATH, SHELL_HTTP_PREFIX, type ServerMessage, type ShellInfo } from '../src/terminal/ptyProtocol.ts'

const require = createRequire(import.meta.url)
const hasPty = (() => {
  try {
    require('@homebridge/node-pty-prebuilt-multiarch')
    return true
  } catch {
    return false
  }
})()

let server: ViteDevServer
let port: number

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    root: new URL('..', import.meta.url).pathname,
    plugins: [tungstenShell()],
    server: { port: 0, host: '127.0.0.1' },
  })
  await server.listen()
  const address = server.httpServer?.address()
  port = typeof address === 'object' && address ? address.port : 0

  // The dictionary is loaded through Vite on first use. Warming it here
  // keeps that one-off transform out of the shell tests, which would
  // otherwise time out on a cold module graph rather than on a real fault.
  await fetch(`http://127.0.0.1:${port}${SHELL_HTTP_PREFIX}/man?name=ls`)
}, 120_000)

afterAll(async () => { await server?.close() })

const base = () => `http://127.0.0.1:${port}`

/** Opens a shell and collects its output until `until` matches or time runs out. */
function runInShell(input: string[], until: RegExp, timeout = 8000) {
  return new Promise<{ output: string; ready: ServerMessage & { type: 'ready' } }>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${PTY_SOCKET_PATH}`, {
      headers: { origin: base() },
    })
    let output = ''
    let ready: (ServerMessage & { type: 'ready' }) | null = null
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve({ output, ready: ready! })
    }
    const timer = setTimeout(() => finish(new Error(`timed out waiting for ${until}\nsaw: ${output}`)), timeout)

    socket.on('open', () => socket.send(JSON.stringify({ type: 'start', cols: 100, rows: 30 })))
    socket.on('error', (error) => finish(error as Error))
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage
      if (message.type === 'ready') {
        ready = message
        for (const line of input) socket.send(JSON.stringify({ type: 'input', data: `${line}\r` }))
        return
      }
      if (message.type === 'data') {
        output += message.data
        if (until.test(strip(output))) finish()
      }
      if (message.type === 'error') finish(new Error(message.message))
    })
  })
}

/**
 * Terminal output is full of escapes; assertions want the text.
 *
 * The escape and bell characters are built rather than written literally --
 * a control character in a regular expression is a lint error, and rightly so
 * everywhere except here.
 */
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const OSC = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g')
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, 'g')

function strip(value: string): string {
  return value.replaceAll(OSC, '').replaceAll(CSI, '')
}

describe('the shell server', () => {
  it('reports what it can offer', async () => {
    const info = (await (await fetch(`${base()}${SHELL_HTTP_PREFIX}/health`)).json()) as ShellInfo
    expect(info.available).toBe(hasPty)
    expect(info.maxSessions).toBe(12)
    if (!hasPty) expect(info.reason).toContain('node-pty')
  })

  it('answers a manual page over HTTP, for the shell functions to curl', async () => {
    const page = await (await fetch(`${base()}${SHELL_HTTP_PREFIX}/man?name=tar`)).text()
    expect(strip(page)).toContain('tar — Create and extract tar archives')
    expect(strip(page)).toContain('SYNOPSIS')
  })

  it('explains a command line over HTTP, warnings included', async () => {
    const text = strip(await (await fetch(`${base()}${SHELL_HTTP_PREFIX}/explain?line=rm+-rf+build`)).text())
    expect(text).toContain('rm — Remove files and directories')
    expect(text).toContain('-r — Remove directories')
    expect(text).toContain('! rm: There is no undo')
  })

  it('says so, rather than guessing, for a page it does not have', async () => {
    const text = await (await fetch(`${base()}${SHELL_HTTP_PREFIX}/man?name=gerp`)).text()
    expect(text).toContain('No manual entry for gerp')
    expect(text).toContain('Did you mean: grep')
  })

  it.runIf(hasPty)('runs a real command in a real shell', async () => {
    const { output, ready } = await runInShell(['echo "answer:$((6*7))"'], /answer:42/)
    expect(strip(output)).toContain('answer:42')
    expect(ready.pid).toBeGreaterThan(0)
    expect(ready.shell).toMatch(/sh$/)
  }, 20_000)

  it.runIf(hasPty)('runs the commands the emulated shell never could', async () => {
    const { output } = await runInShell(
      ["node -e \"console.log('node:' + (1 + 1))\"", 'git rev-parse --abbrev-ref HEAD'],
      /arena\/|main|master/,
    )
    const text = strip(output)
    expect(text).toContain('node:2')
  }, 20_000)

  it.runIf(hasPty)('keeps state between commands, because it is one process', async () => {
    const { output } = await runInShell(
      ['cd /tmp', 'export TUNGSTEN_PROOF=kept', 'echo "$PWD $TUNGSTEN_PROOF"'],
      /\/tmp kept/,
    )
    expect(strip(output)).toContain('/tmp kept')
  }, 20_000)

  it.runIf(hasPty)('gives the shell Tungsten’s dictionary, so man works without man pages', async () => {
    const { output } = await runInShell(['man rsync | head -4'], /Sync files locally/)
    expect(strip(output)).toContain('rsync — Sync files locally or over SSH')
  }, 20_000)

  it.runIf(hasPty)('explains a command line from inside the shell', async () => {
    const { output } = await runInShell(['explain tar czf site.tgz site/'], /Create an archive/)
    const text = strip(output)
    expect(text).toContain('tar — Create and extract tar archives')
    expect(text).toContain('-z — Compress with gzip')
  }, 20_000)

  it.runIf(hasPty)('accepts the origin a hosted preview arrives with', async () => {
    // Behind a proxy the page's origin is the proxy's hostname, forwarded in
    // x-forwarded-host; refusing that would mean no shell in a hosted preview.
    const result = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${PTY_SOCKET_PATH}`, {
        headers: { origin: 'https://5173-sandbox.e2b.app', 'x-forwarded-host': '5173-sandbox.e2b.app' },
      })
      socket.on('open', () => { socket.close(); resolve('opened') })
      socket.on('error', () => resolve('refused'))
    })
    expect(result).toBe('opened')
  }, 20_000)

  it.runIf(hasPty)('refuses a socket from another origin', async () => {
    const refused = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${PTY_SOCKET_PATH}`, {
        headers: { origin: 'http://evil.example' },
      })
      socket.on('open', () => { socket.close(); resolve('opened') })
      socket.on('error', () => resolve('refused'))
      socket.on('close', () => resolve('refused'))
    })
    expect(refused).toBe('refused')
  }, 20_000)
})
