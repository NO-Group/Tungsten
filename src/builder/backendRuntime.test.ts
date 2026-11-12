/**
 * The built app, talking to the project's backend.
 *
 * A generated app used to call the routes of Tungsten's own Node
 * service whatever backend the project was set to, which meant a
 * project on Supabase shipped an app calling addresses nobody served.
 * The fix is a profile: the adapter's wire protocol reduced to JSON,
 * baked into the page, with one small encoder per dialect in the
 * runtime.
 *
 * Asserting on the HTML would prove nothing, so these tests run it.
 * Each case loads the document into a real DOM with a recording
 * `fetch`, clicks nothing and waits for the start handler, then reads
 * the request that actually left: its address, its headers and its
 * body. A dialect that encodes a filter wrongly fails here rather than
 * in somebody's shipped app.
 */

import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry, type BlockGraph } from './blockSchema'
import { addNode, connect, createNode, resetIds, setNodeValue } from './graph'
import { generateProgram } from './codeGenerator'
import { schemaFromGraph } from './uiSchema'
import { previewHtml, PREVIEW_CHANNEL, type PreviewMessage } from './previewRuntime'
import { compile } from './compile'
import { describeRuntimeProfile, runtimeProfileFor, type RuntimeProfile } from '../backend/runtimeProfile'
import type { BackendSettings } from '../backend/registry'

const registry = createRegistry(builtinBlocks)

const SUPABASE: BackendSettings = {
  adapter: 'supabase',
  config: { url: 'https://demo.supabase.co', anonKey: 'anon-key', serviceKey: 'service-key' },
}
const POCKETBASE: BackendSettings = { adapter: 'pocketbase', config: { url: 'http://127.0.0.1:8090/' } }
const VORTEX: BackendSettings = { adapter: 'vortex', config: { projectKey: 'proj_1' } }
const SELF: BackendSettings = { adapter: 'self-hosted', config: { url: 'http://localhost:8787' } }

function profileOf(settings: BackendSettings): RuntimeProfile {
  const profile = runtimeProfileFor(settings)
  if (!profile) throw new Error(`no profile for ${settings.adapter}`)
  return profile
}

/* ------------------------------------------------------------- harnesses */

function build(
  nodes: string[],
  links: Array<[from: number, fromPort: string, to: number, toPort: string]> = [],
) {
  let graph: BlockGraph = { nodes: [], connections: [] }
  const ids: string[] = []
  for (const type of nodes) {
    const node = createNode(type, { x: 0, y: ids.length * 100 })
    ids.push(node.id)
    graph = addNode(graph, node)
  }
  for (const [from, fromPort, to, toPort] of links) {
    const result = connect(graph, registry, { node: ids[from], port: fromPort }, { node: ids[to], port: toPort })
    if (result.rejected) throw new Error(result.rejected)
    graph = result.graph
  }
  return { graph, ids }
}

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown }

/**
 * Runs a graph's built page in a DOM whose `fetch` records and answers.
 *
 * The reply is whatever the test queued, so each dialect's envelope —
 * PostgREST's bare array, PocketBase's `items`, Vortex's `rows` — is
 * unwrapped by the runtime rather than by the harness.
 */
async function run(graph: BlockGraph, profile: RuntimeProfile, replies: unknown[] = []) {
  const code = generateProgram(graph, registry, [], undefined).code
  const html = previewHtml({ document: schemaFromGraph(graph, registry, {}), code, api: profile.base, profile })

  const calls: Recorded[] = []
  let index = 0
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://app.example/page',
    beforeParse(window) {
      const scope = window as unknown as { fetch: unknown }
      scope.fetch = (url: string, init: Record<string, unknown> = {}) => {
        calls.push({
          url: String(url),
          method: String(init.method ?? 'GET'),
          headers: (init.headers ?? {}) as Record<string, string>,
          body: init.body,
        })
        const reply = replies[index++] ?? {}
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(reply)),
        })
      }
    },
  })

  const messages: PreviewMessage[] = []
  dom.window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as PreviewMessage & { channel?: string }
    if (data?.channel === PREVIEW_CHANNEL) messages.push(data)
  })

  await new Promise((resolve) => setTimeout(resolve, 30))
  return { calls, messages, dom }
}

/** A start handler that queries one table, with an optional filter. */
function queryGraph(table: string, where?: string) {
  const { graph, ids } = build(
    ['event.start', 'data.query', 'logic.log'],
    [[0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'], [1, 'rows', 2, 'value']],
  )
  let next = setNodeValue(graph, ids[1], 'table', table)
  if (where !== undefined) next = setNodeValue(next, ids[1], 'where', where)
  return next
}

const logs = (messages: PreviewMessage[]) =>
  messages.filter((message) => message.kind === 'log').map((message) => (message as { text: string }).text)

beforeEach(() => resetIds())

/* -------------------------------------------------------------- profiles */

describe('the backend profile', () => {
  it('never ships a credential that bypasses row-level security', () => {
    const profile = profileOf(SUPABASE)
    const baked = JSON.stringify(profile)
    // The anon key is meant to be in the page; the service key is the
    // one that ignores every policy, and a built app is readable by
    // whoever downloads it.
    expect(baked).toContain('anon-key')
    expect(baked).not.toContain('service-key')
    expect(profile.withheld).toEqual(['Service role key (for provisioning)'])
  })

  it('says nothing about a backend that is not configured yet', () => {
    expect(runtimeProfileFor({ adapter: 'supabase', config: { url: 'https://x.supabase.co' } })).toBeUndefined()
    expect(runtimeProfileFor({ adapter: 'firebase', config: { projectId: 'p', apiKey: 'k' } })).toBeUndefined()
  })

  it('separates a backend it cannot emit from one that is half filled in', () => {
    // Appwrite's adapter is built and nothing is missing from the
    // settings, but no runtime speaks its dialect yet, so a build
    // falls back to the generated service rather than calling routes
    // that do not exist.
    const appwrite = { adapter: 'appwrite', config: { url: 'https://cloud.appwrite.io/v1', projectId: 'proj1' } }
    expect(runtimeProfileFor(appwrite)).toBeUndefined()

    const told = describeRuntimeProfile(undefined, appwrite)
    expect(told).toContain('cannot speak Appwrite yet')
    expect(told).toContain('local Node service')
    // The other nothing: a field is genuinely missing.
    const half = { adapter: 'supabase', config: { url: 'https://x.supabase.co' } }
    expect(describeRuntimeProfile(undefined, half)).toContain('no complete backend yet')
  })

  it('normalises the address and fills in the defaults each backend has', () => {
    expect(profileOf(POCKETBASE).base).toBe('http://127.0.0.1:8090')
    expect(profileOf(POCKETBASE).users).toBe('users')
    // Vortex's region URL is optional, and its default is not a blank.
    expect(profileOf(VORTEX).base).toBe('https://api.vortex.dev')
    expect(profileOf(VORTEX).headers['x-vortex-project']).toBe('proj_1')
  })

  it('puts the token where each backend reads it', () => {
    expect(profileOf(SUPABASE).token).toEqual({ header: 'authorization', prefix: 'Bearer ' })
    // PocketBase takes the raw token, with no scheme in front of it.
    expect(profileOf(POCKETBASE).token).toEqual({ header: 'authorization', prefix: '' })
  })
})

/* ------------------------------------------------------------ the dialects */

describe('a built app reading rows', () => {
  it('speaks PostgREST to Supabase, and unwraps its bare array', async () => {
    const { calls, messages } = await run(
      queryGraph('notes', '{ done: false }'),
      profileOf(SUPABASE),
      [[{ id: 1, title: 'One' }]],
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/notes?select=*&done=eq.false')
    expect(calls[0].headers.apikey).toBe('anon-key')
    expect(logs(messages).join(' ')).toContain('"title":"One"')
  })

  it('speaks the collections API to PocketBase, filter expression and all', async () => {
    const { calls, messages } = await run(
      queryGraph('notes', '{ title: "ink" }'),
      profileOf(POCKETBASE),
      [{ items: [{ id: 'r1', title: 'ink' }] }],
    )

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/api/collections/notes/records')
    // PocketBase has no parameter binding, so the value is quoted into
    // the expression — and therefore escaped where it is built.
    expect(url.searchParams.get('filter')).toBe("title='ink'")
    expect(logs(messages).join(' ')).toContain('r1')
  })

  it('posts a filter tree to Vortex instead of a query string', async () => {
    const { calls } = await run(queryGraph('notes', '{ done: true }'), profileOf(VORTEX), [{ rows: [] }])

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://api.vortex.dev/v1/data/notes/query')
    expect(JSON.parse(String(calls[0].body))).toEqual({
      where: { all: [{ column: 'done', op: 'eq', value: true }] },
    })
  })

  it('still calls the generated service when that is the backend', async () => {
    const { calls } = await run(queryGraph('notes', '{ done: true }'), profileOf(SELF), [{ rows: [] }])
    expect(calls[0].url).toBe('http://localhost:8787/data/notes?done=true')
    expect(calls[0].method).toBe('GET')
  })

  it('asks for every row when there is no filter', async () => {
    const { calls } = await run(queryGraph('notes'), profileOf(SUPABASE), [[]])
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/notes?select=*')
  })
})

describe('a built app writing a row', () => {
  function insertGraph() {
    const { graph, ids } = build(
      ['event.start', 'data.insert'],
      [[0, 'exec', 1, 'exec']],
    )
    return setNodeValue(setNodeValue(graph, ids[1], 'table', 'notes'), ids[1], 'row', '{ title: "Note" }')
  }

  it('asks PostgREST to hand the saved row back', async () => {
    const { calls } = await run(insertGraph(), profileOf(SUPABASE), [[{ id: 7, title: 'Note' }]])
    expect(calls[0].method).toBe('POST')
    // Without this header PostgREST answers 201 with an empty body, and
    // the "saved row" output of the block would be nothing at all.
    expect(calls[0].headers.prefer).toBe('return=representation')
    expect(JSON.parse(String(calls[0].body))).toEqual({ title: 'Note' })
  })

  it('wraps the row the way Vortex expects', async () => {
    const { calls } = await run(insertGraph(), profileOf(VORTEX), [{ row: { id: 7 } }])
    expect(JSON.parse(String(calls[0].body))).toEqual({ row: { title: 'Note' } })
  })
})

describe('a built app signing somebody in', () => {
  function signInGraph() {
    const { graph, ids } = build(['event.start', 'auth.signIn', 'data.query'], [
      [0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'],
    ])
    const withEmail = setNodeValue(setNodeValue(graph, ids[1], 'email', 'ada@example.com'), ids[1], 'password', 'hunter2')
    return setNodeValue(withEmail, ids[2], 'table', 'notes')
  }

  it('carries the session token on the next call, in Supabase’s slot', async () => {
    const { calls } = await run(signInGraph(), profileOf(SUPABASE), [
      { access_token: 'session-token', user: { id: 'u1' } },
      [],
    ])

    expect(calls[0].url).toBe('https://demo.supabase.co/auth/v1/token?grant_type=password')
    // The signed-in user's token replaces the publishable key rather
    // than being sent beside it.
    expect(calls[1].headers.authorization).toBe('Bearer session-token')
    expect(calls[1].headers.apikey).toBe('anon-key')
  })

  it('sends PocketBase its identity field, and a bare token afterwards', async () => {
    const { calls } = await run(signInGraph(), profileOf(POCKETBASE), [
      { token: 'pb-token', record: { id: 'u1' } },
      { items: [] },
    ])

    expect(calls[0].url).toBe('http://127.0.0.1:8090/api/collections/users/auth-with-password')
    expect(JSON.parse(String(calls[0].body))).toEqual({ identity: 'ada@example.com', password: 'hunter2' })
    expect(calls[1].headers.authorization).toBe('pb-token')
  })

  it('signs a new PocketBase account in, because creating it does not', async () => {
    const { graph, ids } = build(['event.start', 'auth.signUp'], [[0, 'exec', 1, 'exec']])
    const named = setNodeValue(setNodeValue(graph, ids[1], 'email', 'ada@example.com'), ids[1], 'password', 'hunter2')
    const { calls } = await run(named, profileOf(POCKETBASE), [{ id: 'u1' }, { token: 'pb-token', record: { id: 'u1' } }])

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/collections/users/records',
      '/api/collections/users/auth-with-password',
    ])
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ passwordConfirm: 'hunter2' })
  })
})

describe('a built app uploading a file', () => {
  function uploadGraph() {
    const { graph, ids } = build(['event.start', 'storage.upload', 'logic.log'], [
      [0, 'exec', 1, 'exec'], [1, 'exec', 2, 'exec'], [1, 'url', 2, 'value'],
    ])
    return setNodeValue(setNodeValue(graph, ids[1], 'bucket', 'shots'), ids[1], 'file', "'hello'")
  }

  it('reports a public URL for Supabase storage', async () => {
    const { calls, messages } = await run(uploadGraph(), profileOf(SUPABASE), [{ Key: 'shots/upload' }])
    expect(calls[0].url).toBe('https://demo.supabase.co/storage/v1/object/shots/upload')
    expect(logs(messages)).toContain('https://demo.supabase.co/storage/v1/object/public/shots/upload')
  })

  it('reports a record-scoped URL for PocketBase', async () => {
    const { calls, messages } = await run(uploadGraph(), profileOf(POCKETBASE), [{ id: 'rec1', file: 'upload' }])
    expect(calls[0].url).toBe('http://127.0.0.1:8090/api/collections/shots/records')
    // A file belongs to a record there, so its URL needs the id that
    // came back from the upload.
    expect(logs(messages)).toContain('http://127.0.0.1:8090/api/files/shots/rec1/upload')
  })
})

/* ------------------------------------------------------------- the build */

describe('the compiler', () => {
  const { graph } = build(['event.start', 'data.query'], [[0, 'exec', 1, 'exec']])

  function page(settings?: BackendSettings) {
    const result = compile({ graph, registry, target: 'web', backend: settings })
    if (!result.ok) throw new Error(result.reason)
    return result.files.find((file) => file.path.endsWith('index.html'))!.contents
  }

  it('bakes the project’s backend into the page it emits', () => {
    const html = page(SUPABASE)
    expect(html).toContain('"dialect":"postgrest"')
    expect(html).toContain('"base":"https://demo.supabase.co"')
    expect(html).toContain('anon-key')
    // The withheld credential is named in the page as a note to whoever
    // reads it, but its value is not in there.
    expect(html).not.toContain('service-key')
  })

  it('falls back to the local service when no backend is configured', () => {
    const html = page()
    expect(html).toContain('const BAKED_PROFILE = null;')
    expect(html).toContain('http://localhost:8787')
  })

  it('leaves the profile out when the credentials are half filled in', () => {
    const html = page({ adapter: 'supabase', config: { url: 'https://demo.supabase.co' } })
    expect(html).toContain('const BAKED_PROFILE = null;')
    expect(html).not.toContain('demo.supabase.co')
  })

  it('gives the desktop shells the same page, backend and all', () => {
    const result = compile({ graph, registry, target: 'linux', backend: POCKETBASE })
    if (!result.ok) throw new Error(result.reason)
    const html = result.files.find((file) => file.path.endsWith('.html'))!.contents
    expect(html).toContain('"dialect":"pocketbase"')
  })
})
