/**
 * The Appwrite adapter.
 *
 * Listing rows is the easy half. What these tests are for is the five
 * places Appwrite and the contract do not agree, and whether each
 * disagreement is handled or papered over:
 *
 *  - a document is not a row: `$id` and friends have to become `id`
 *    on the way out and disappear on the way back in, or a read-edit-
 *    save round trip fails on the fields the backend added itself;
 *  - queries are JSON objects, and Appwrite has no `not`, so a negated
 *    test is an inverted operator or an honest refusal — never the
 *    un-negated query, which would return exactly the rows the user
 *    asked to exclude;
 *  - a session secret and a server key must never travel together, or
 *    a signed-in person is served as the server and `GET /account`
 *    answers "missing scope";
 *  - a file has an id and a name, and a URL needs the id;
 *  - realtime channels carry no filter, so `kinds` and `where` are
 *    applied as events arrive and a replay is refused.
 */

import { describe, expect, it } from 'vitest'

import { BackendError, type HttpSend, type Socket } from './contract'
import { BLUEPRINT_VERSION, type Blueprint } from './blueprint'
import {
  appwriteAdapter,
  appwriteAttribute,
  appwriteOrder,
  appwritePermissions,
  appwriteQuery,
  changeKind,
  documentData,
  matchesFilter,
  rowFromDocument,
} from './adapters/appwrite'
import { adapterById, createBackend } from './registry'

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string | Uint8Array }

/** A fetch that records every call and replies with what the test queued. */
function recorder(replies: unknown[] = []) {
  const calls: Recorded[] = []
  let index = 0
  const send: HttpSend = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body })
    const reply = replies[index++] ?? {}
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(reply)),
      headers: { get: () => null },
    })
  }
  return { calls, send }
}

function failing(status: number, body: string): HttpSend {
  return () => Promise.resolve({ ok: false, status, text: () => Promise.resolve(body), headers: { get: () => null } })
}

function socketPair() {
  const sent: string[] = []
  const handlers = new Map<string, (event: { data?: unknown }) => void>()
  let closed = false
  const socket: Socket = {
    send: (data) => sent.push(data),
    close: () => { closed = true },
    addEventListener: (event, handler) => { handlers.set(event, handler) },
  }
  const urls: string[] = []
  return {
    urls,
    isClosed: () => closed,
    deliver: (frame: unknown) => handlers.get('message')?.({ data: JSON.stringify(frame) }),
    open: (url: string) => { urls.push(url); return socket },
    frames: () => sent.map((text) => JSON.parse(text) as Record<string, unknown>),
  }
}

const ENDPOINT = 'https://cloud.appwrite.io/v1'

function appwrite(send: HttpSend, config: Record<string, string> = {}) {
  return appwriteAdapter.create({ url: ENDPOINT, projectId: 'proj1', http: send, ...config })
}

/** The queries of a recorded call, parsed back into objects. */
function queries(call: Recorded): Array<Record<string, unknown>> {
  const search = new URL(call.url).searchParams
  const found: Array<Record<string, unknown>> = []
  for (const [key, value] of search.entries()) {
    if (key.startsWith('queries[')) found.push(JSON.parse(value) as Record<string, unknown>)
  }
  return found
}

/* ---------------------------------------------------------------- queries */

describe('the Appwrite query language', () => {
  it('writes a tree as the JSON Appwrite reads', () => {
    expect(JSON.parse(appwriteQuery({
      all: [
        { column: 'done', op: 'eq', value: false },
        { any: [{ column: 'priority', op: 'gte', value: 3 }, { column: 'pinned', op: 'eq', value: true }] },
      ],
    }))).toEqual({
      method: 'and',
      values: [
        { method: 'equal', attribute: 'done', values: [false] },
        {
          method: 'or',
          values: [
            { method: 'greaterThanEqual', attribute: 'priority', values: [3] },
            { method: 'equal', attribute: 'pinned', values: [true] },
          ],
        },
      ],
    })
  })

  it('maps the operators Appwrite spells differently', () => {
    // `equal` with several values is Appwrite's `in`.
    expect(JSON.parse(appwriteQuery({ column: 'status', op: 'in', value: ['a', 'b'] })))
      .toEqual({ method: 'equal', attribute: 'status', values: ['a', 'b'] })
    // `contains` is the substring test that works without a fulltext
    // index, and SQL's % is not punctuation here.
    expect(JSON.parse(appwriteQuery({ column: 'title', op: 'like', value: '%ink%' })))
      .toEqual({ method: 'contains', attribute: 'title', values: ['ink'] })
    expect(JSON.parse(appwriteQuery({ column: 'due', op: 'is-null' })))
      .toEqual({ method: 'isNull', attribute: 'due' })
  })

  it('inverts a negated test instead of sending the opposite rows', () => {
    // There is no `not` in Appwrite's vocabulary. Silently dropping it
    // would return every row the user asked to exclude.
    expect(JSON.parse(appwriteQuery({ not: { column: 'done', op: 'eq', value: true } })))
      .toEqual({ method: 'notEqual', attribute: 'done', values: [true] })
    expect(JSON.parse(appwriteQuery({ not: { column: 'priority', op: 'lt', value: 3 } })))
      .toEqual({ method: 'greaterThanEqual', attribute: 'priority', values: [3] })
  })

  it('refuses a negation it has no operator for', () => {
    expect(() => appwriteQuery({ not: { column: 'title', op: 'like', value: 'ink' } }))
      .toThrowError(/no “not”/)
  })

  it('writes the sort as one query entry per column', () => {
    expect(appwriteOrder(undefined)).toEqual([])
    expect(appwriteOrder([{ column: 'created', direction: 'desc' }, { column: 'title' }]).map((entry) => JSON.parse(entry)))
      .toEqual([
        { method: 'orderDesc', attribute: 'created' },
        { method: 'orderAsc', attribute: 'title' },
      ])
  })
})

/* -------------------------------------------------------------- documents */

describe('Appwrite documents', () => {
  it('turns a document into a row the canvas understands', () => {
    expect(rowFromDocument({
      $id: 'doc1',
      $createdAt: '2026-01-01T00:00:00Z',
      $updatedAt: '2026-01-02T00:00:00Z',
      $permissions: ['read("any")'],
      $collectionId: 'notes',
      $databaseId: 'default',
      title: 'One',
    })).toEqual({
      id: 'doc1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      title: 'One',
    })
  })

  it('drops the fields Appwrite keeps for itself on the way back in', () => {
    // Read a row, edit it, save it. Without this the write names
    // attributes the collection does not have and Appwrite refuses it.
    expect(documentData({ id: 'doc1', created_at: 'x', updated_at: 'y', $id: 'doc1', title: 'Two' }))
      .toEqual({ title: 'Two' })
  })

  it('reads a page and asks with the right queries', async () => {
    const { calls, send } = recorder([{
      total: 2,
      documents: [{ $id: 'a', title: 'One' }, { $id: 'b', title: 'Two' }],
    }])
    const backend = appwrite(send, { databaseId: 'main' })
    const page = await backend.db.select('notes', {
      where: { column: 'done', op: 'eq', value: false },
      order: [{ column: 'title' }],
      limit: 2,
      count: true,
    })

    expect(calls[0].url.startsWith(`${ENDPOINT}/databases/main/collections/notes/documents?`)).toBe(true)
    expect(queries(calls[0])).toEqual([
      { method: 'equal', attribute: 'done', values: [false] },
      { method: 'orderAsc', attribute: 'title' },
      { method: 'limit', values: [2] },
    ])
    expect(page.rows).toEqual([{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }])
    expect(page.total).toBe(2)
    // A full page can be continued; the cursor is the last id.
    expect(page.cursor).toBe('b')
  })

  it('does not hand back a cursor for a page that was not full', async () => {
    const { send } = recorder([{ documents: [{ $id: 'a' }] }])
    const page = await appwrite(send).db.select('notes', { limit: 10 })
    expect(page.cursor).toBeUndefined()
  })

  it('writes, changes and deletes a document', async () => {
    const { calls, send } = recorder([
      { $id: 'n1', title: 'One' },
      { $id: 'n1', title: 'Two' },
      {},
    ])
    const backend = appwrite(send)
    const [saved] = await backend.db.insert('notes', { title: 'One' })
    expect(JSON.parse(String(calls[0].body))).toEqual({ documentId: 'unique()', data: { title: 'One' } })
    expect(saved).toEqual({ id: 'n1', title: 'One' })

    await backend.db.update('notes', 'n1', { title: 'Two', id: 'n1' })
    expect(calls[1].method).toBe('PATCH')
    // The id travelled in the path, not in the data.
    expect(JSON.parse(String(calls[1].body))).toEqual({ data: { title: 'Two' } })

    await backend.db.remove('notes', 'n1')
    expect(calls[2].method).toBe('DELETE')
    expect(calls[2].url).toBe(`${ENDPOINT}/databases/default/collections/notes/documents/n1`)
  })

  it('upserts on the document id, and says so when there is not one', async () => {
    const { calls, send } = recorder([{ $id: 'n1', title: 'One' }])
    const backend = appwrite(send)
    await backend.db.upsert('notes', { id: 'n1', title: 'One' })
    expect(calls[0].method).toBe('PUT')

    await expect(backend.db.upsert('notes', { title: 'nameless' })).rejects.toThrowError(/needs the row’s id/)
    await expect(backend.db.upsert('notes', { id: 'n1' }, ['email'])).rejects.toThrowError(/not on a column of your choosing/)
  })

  it('counts without reading the rows', async () => {
    const { calls, send } = recorder([{ total: 41, documents: [] }])
    expect(await appwrite(send).db.count('notes', { column: 'done', op: 'eq', value: true })).toBe(41)
    expect(queries(calls[0])).toEqual([
      { method: 'equal', attribute: 'done', values: [true] },
      { method: 'limit', values: [1] },
    ])
  })

  it('answers “no such row” with undefined rather than an error', async () => {
    const backend = appwrite(failing(404, JSON.stringify({ message: 'Document not found' })))
    expect(await backend.db.find('notes', 'nope')).toBeUndefined()
  })
})

/* ----------------------------------------------------------------- auth */

describe('Appwrite accounts', () => {
  it('creates an account, signs it in, and carries the secret afterwards', async () => {
    const { calls, send } = recorder([
      { $id: 'u1' },
      { $id: 's1', secret: 'sess-secret', expire: '2026-02-01T00:00:00Z' },
      { $id: 'u1', email: 'ada@example.com', name: 'Ada' },
      { total: 0, documents: [] },
    ])
    const backend = appwrite(send)
    const session = await backend.auth.signUp({ email: 'ada@example.com', password: 'hunter22' })

    expect(calls[0].url).toBe(`${ENDPOINT}/account`)
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ userId: 'unique()', email: 'ada@example.com' })
    // Creating an account does not start a session, so the adapter
    // signs in rather than returning half of one.
    expect(calls[1].url).toBe(`${ENDPOINT}/account/sessions/email`)
    expect(session.token).toBe('sess-secret')
    expect(session.user).toMatchObject({ id: 'u1', email: 'ada@example.com', name: 'Ada' })
    expect(session.expiresAt).toBe('2026-02-01T00:00:00Z')

    await backend.db.select('notes')
    expect(calls[3].headers['x-appwrite-session']).toBe('sess-secret')
  })

  it('never sends a server key beside a session', async () => {
    const { calls, send } = recorder([
      { $id: 's1', secret: 'sess-secret' },
      { $id: 'u1' },
      { total: 0, documents: [] },
    ])
    const backend = appwrite(send, { apiKey: 'server-key' })
    await backend.auth.signIn('ada@example.com', 'hunter22')
    await backend.db.select('notes')

    // A key beside a session makes the call the server rather than the
    // person, and `GET /account` then answers "missing scope".
    for (const call of calls) expect(call.headers['x-appwrite-key']).toBeUndefined()
    expect(calls[2].headers['x-appwrite-session']).toBe('sess-secret')
  })

  it('uses the key, and only the key, for the administrative calls', async () => {
    const { calls, send } = recorder([{ collections: [] }])
    const backend = appwrite(send, { apiKey: 'server-key' })
    await backend.schema.inspect()
    expect(calls[0].headers['x-appwrite-key']).toBe('server-key')
    expect(calls[0].headers['x-appwrite-session']).toBeUndefined()
  })

  it('treats an expired session as nobody being signed in', async () => {
    const backend = appwrite(failing(401, JSON.stringify({ message: 'User (role: guests) missing scope' })))
    backend.auth.useToken('stale')
    expect(await backend.auth.session()).toBeUndefined()
  })

  it('builds the provider URL rather than redirecting', async () => {
    const backend = appwrite(recorder().send)
    const target = await backend.auth.oauthUrl('github', 'https://app.example.com/done')
    const parsed = new URL(target)
    expect(parsed.pathname).toBe('/v1/account/sessions/oauth2/github')
    expect(parsed.searchParams.get('project')).toBe('proj1')
    expect(parsed.searchParams.get('success')).toBe('https://app.example.com/done')
  })

  it('finishes a magic link with the user id from the same round trip', async () => {
    const { calls, send } = recorder([
      { userId: 'u9' },
      { $id: 's2', secret: 'from-link' },
      { $id: 'u9', email: 'ada@example.com' },
    ])
    const backend = appwrite(send)
    await backend.auth.magicLink('ada@example.com', 'https://app.example.com/back')
    const session = await backend.auth.exchange('link-secret')

    expect(calls[1].url).toBe(`${ENDPOINT}/account/sessions/token`)
    expect(JSON.parse(String(calls[1].body))).toEqual({ userId: 'u9', secret: 'link-secret' })
    expect(session.token).toBe('from-link')
  })

  it('refuses an exchange that was never started', async () => {
    await expect(appwrite(recorder().send).auth.exchange('secret'))
      .rejects.toThrowError(/Send the magic link with the email block first/)
  })

  it('needs a key to label another user', async () => {
    await expect(appwrite(recorder().send).auth.setRoles('u1', ['admin']))
      .rejects.toThrowError(/only lets a server key/)
    const { calls, send } = recorder([{ $id: 'u1', labels: ['admin'] }])
    const user = await appwrite(send, { apiKey: 'server-key' }).auth.setRoles('u1', ['admin'])
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(`${ENDPOINT}/users/u1/labels`)
    expect(user.roles).toEqual(['admin'])
  })
})

/* -------------------------------------------------------------- storage */

describe('Appwrite storage', () => {
  it('posts a file as form data and hands back a URL with the project on it', async () => {
    const { calls, send } = recorder([{ $id: 'f1', name: 'cover.png', sizeOriginal: 12, mimeType: 'image/png' }])
    const stored = await appwrite(send).storage.upload({
      bucket: 'media',
      path: 'cover.png',
      data: 'bytes',
      contentType: 'image/png',
    })

    expect(calls[0].url).toBe(`${ENDPOINT}/storage/buckets/media/files`)
    const body = new TextDecoder().decode(calls[0].body as Uint8Array)
    expect(body).toContain('name="fileId"')
    expect(body).toContain('unique()')
    expect(body).toContain('filename="cover.png"')
    // The id is the handle and the name is what a person typed, so the
    // path carries both and the URL is built from the id.
    expect(stored.path).toBe('f1/cover.png')
    expect(stored.url).toBe(`${ENDPOINT}/storage/buckets/media/files/f1/view?project=proj1`)
    expect(stored.size).toBe(12)
  })

  it('reads the id off a path for every URL it builds', () => {
    const backend = appwrite(recorder().send)
    expect(backend.storage.publicUrl('media', 'f1/cover.png'))
      .toBe(`${ENDPOINT}/storage/buckets/media/files/f1/view?project=proj1`)
    const preview = new URL(backend.storage.publicUrl('media', 'f1/cover.png', { width: 400, format: 'webp' }))
    expect(preview.pathname.endsWith('/preview')).toBe(true)
    expect(preview.searchParams.get('width')).toBe('400')
    expect(preview.searchParams.get('output')).toBe('webp')
  })

  it('issues a time-limited link with a file token, and needs a key for it', async () => {
    await expect(appwrite(recorder().send).storage.signedUrl('media', 'f1/cover.png', 60))
      .rejects.toThrowError(/only lets a server key/)

    const { calls, send } = recorder([{ secret: 'tok' }])
    const link = await appwrite(send, { apiKey: 'server-key' }).storage.signedUrl('media', 'f1/cover.png', 60)
    expect(calls[0].url).toBe(`${ENDPOINT}/tokens/buckets/media/files/f1`)
    expect(typeof JSON.parse(String(calls[0].body)).expire).toBe('string')
    expect(new URL(link).searchParams.get('token')).toBe('tok')
  })

  it('lists files as id-and-name paths', async () => {
    const { send } = recorder([{ files: [{ $id: 'f1', name: 'a.png' }, { $id: 'f2', name: 'b.png' }] }])
    const files = await appwrite(send).storage.list('media', 'b')
    expect(files.map((file) => file.path)).toEqual(['f2/b.png'])
  })
})

/* -------------------------------------------------------------- realtime */

describe('Appwrite realtime', () => {
  it('names the channel in the URL and authenticates with the session', async () => {
    const pair = socketPair()
    const backend = createBackend(
      { adapter: 'appwrite', config: { url: ENDPOINT, projectId: 'proj1', databaseId: 'main' } },
      { http: recorder([{ $id: 's1', secret: 'sess' }, { $id: 'u1' }]).send, openSocket: pair.open },
    )
    await backend.auth.signIn('ada@example.com', 'pw')

    const seen: string[] = []
    const subscription = await backend.realtime.table('notes', (change) => seen.push(`${change.kind}:${String(change.row.title)}`))

    expect(pair.urls[0]).toBe(
      'wss://cloud.appwrite.io/v1/realtime?project=proj1&channels[]=databases.main.collections.notes.documents',
    )
    // Without the authentication frame the server only sends what a
    // guest may read, which for most projects is nothing at all.
    pair.deliver({ type: 'connected', data: { channels: [] } })
    expect(pair.frames()[0]).toEqual({ type: 'authentication', data: { session: 'sess' } })

    pair.deliver({
      type: 'event',
      data: {
        events: ['databases.main.collections.notes.documents.n1.create'],
        timestamp: '2026-01-01T00:00:00Z',
        payload: { $id: 'n1', title: 'live' },
      },
    })
    expect(seen).toEqual(['insert:live'])
    expect(subscription.cursor()).toBe('2026-01-01T00:00:00Z')

    await subscription.unsubscribe()
    expect(pair.isClosed()).toBe(true)
  })

  it('applies the kinds and the filter the subscriber asked for', async () => {
    const pair = socketPair()
    const backend = appwriteAdapter.create({
      url: ENDPOINT,
      projectId: 'proj1',
      http: recorder().send,
      openSocket: pair.open,
    })
    const seen: string[] = []
    await backend.realtime.table('notes', (change) => seen.push(String(change.row.title)), {
      kinds: ['insert'],
      where: { column: 'pinned', op: 'eq', value: true },
    })

    const event = (events: string[], payload: Record<string, unknown>) =>
      pair.deliver({ type: 'event', data: { events, payload } })

    event(['databases.default.collections.notes.documents.a.update'], { $id: 'a', title: 'edited', pinned: true })
    event(['databases.default.collections.notes.documents.b.create'], { $id: 'b', title: 'ignored', pinned: false })
    event(['databases.default.collections.notes.documents.c.create'], { $id: 'c', title: 'kept', pinned: true })

    // A channel carries no filter, so both of these are the adapter's
    // doing rather than the server's.
    expect(seen).toEqual(['kept'])
  })

  it('refuses a replay rather than pretending to resume', async () => {
    const pair = socketPair()
    const backend = appwriteAdapter.create({
      url: ENDPOINT,
      projectId: 'proj1',
      http: recorder().send,
      openSocket: pair.open,
    })
    await expect(backend.realtime.table('notes', () => undefined, { since: '2026-01-01T00:00:00Z' }))
      .rejects.toThrowError(/does not keep a change log/)
  })

  it('reads the kind out of the event names', () => {
    expect(changeKind(['databases.d.collections.c.documents.x.create'])).toBe('insert')
    expect(changeKind(['databases.d.collections.c.documents.x.update'])).toBe('update')
    expect(changeKind(['databases.d.collections.c.documents.x.delete'])).toBe('delete')
    expect(changeKind(['something.else'])).toBeUndefined()
    expect(changeKind(undefined)).toBeUndefined()
  })

  it('matches a filter tree against a row the way the server would', () => {
    const row = { id: 'a', title: 'Ink and paper', priority: 4, due: null }
    expect(matchesFilter(row, { column: 'priority', op: 'gte', value: 4 })).toBe(true)
    expect(matchesFilter(row, { column: 'priority', op: 'gt', value: 4 })).toBe(false)
    expect(matchesFilter(row, { column: 'title', op: 'ilike', value: '%INK%' })).toBe(true)
    expect(matchesFilter(row, { column: 'due', op: 'is-null' })).toBe(true)
    expect(matchesFilter(row, { not: { column: 'id', op: 'eq', value: 'a' } })).toBe(false)
    expect(matchesFilter(row, { any: [{ column: 'id', op: 'eq', value: 'z' }, { column: 'id', op: 'in', value: ['a'] }] }))
      .toBe(true)
  })
})

/* ----------------------------------------------------------------- schema */

describe('the Appwrite schema', () => {
  const BLUEPRINT: Blueprint = {
    version: BLUEPRINT_VERSION,
    name: 'Notes',
    tables: [
      {
        name: 'notes',
        columns: [
          { name: 'title', type: 'text', required: true },
          { name: 'priority', type: 'integer' },
          { name: 'body', type: 'json' },
          { name: 'author', type: 'reference', references: { table: 'people', column: 'id' } },
        ],
        policies: { read: 'public', create: 'authenticated', update: 'owner', delete: 'nobody' },
      },
      { name: 'people', columns: [{ name: 'name', type: 'text' }] },
    ],
    buckets: [],
    functions: [],
  }

  it('turns a column into the attribute endpoint it needs', () => {
    expect(appwriteAttribute({ name: 'title', type: 'text', required: true }))
      .toEqual({ kind: 'string', body: { key: 'title', required: true, size: 255 } })
    expect(appwriteAttribute({ name: 'count', type: 'integer' }).kind).toBe('integer')
    expect(appwriteAttribute({ name: 'score', type: 'number' }).kind).toBe('float')
    expect(appwriteAttribute({ name: 'at', type: 'timestamp' }).kind).toBe('datetime')
    // JSON goes in the long string: a blob of it does not fit in 255.
    expect(appwriteAttribute({ name: 'body', type: 'json' }).body.size).toBe(16_384)
    expect(appwriteAttribute({ name: 'author', type: 'reference', references: { table: 'people', column: 'id' } }).body)
      .toMatchObject({ relatedCollectionId: 'people', type: 'manyToOne' })
  })

  it('writes the policies as permission strings', () => {
    expect(appwritePermissions(BLUEPRINT.tables[0]))
      .toEqual(['read("any")', 'create("users")', 'update("users")'])
    // No rule is nobody, which is Appwrite's default: a server key only.
    expect(appwritePermissions(BLUEPRINT.tables[1])).toEqual([])
  })

  it('plans before it applies, and says what is missing', async () => {
    const plan = await appwrite(recorder().send).schema.plan(BLUEPRINT)
    expect(plan.mode).toBe('script')
    expect(plan.problems[0]).toMatch(/only lets a server key/)
    expect(plan.operations.filter((operation) => operation.kind === 'create-table').map((operation) => operation.subject))
      .toEqual(['notes', 'people'])
    expect(plan.operations.some((operation) => operation.subject === 'notes.title')).toBe(true)

    const keyed = await appwrite(recorder().send, { apiKey: 'server-key' }).schema.plan(BLUEPRINT)
    expect(keyed.mode).toBe('apply')
    expect(keyed.problems).toEqual([])
  })

  it('creates every collection before any relationship points at one', async () => {
    const { calls, send } = recorder([
      { collections: [] },
      { $id: 'notes' },
      { $id: 'people' },
      { attributes: [] },
      {}, {}, {}, {},
      { attributes: [] },
      {},
    ])
    const result = await appwrite(send, { apiKey: 'server-key' }).schema.apply(BLUEPRINT)

    const paths = calls.map((call) => `${call.method} ${call.url.replace(`${ENDPOINT}/databases/default/`, '')}`)
    expect(paths.slice(0, 3)).toEqual(['GET collections', 'POST collections', 'POST collections'])
    // The relationship is written after both collections exist; one
    // pass would fail on the forward reference.
    const relationship = paths.findIndex((path) => path.endsWith('attributes/relationship'))
    expect(relationship).toBeGreaterThan(paths.lastIndexOf('POST collections'))
    expect(result.mode).toBe('apply')
    expect(result.operations.some((operation) => operation.subject === 'notes.author')).toBe(true)
  })

  it('does not write an attribute the collection already has', async () => {
    const { calls, send } = recorder([
      { collections: [{ $id: 'people' }] },
      { attributes: [{ key: 'name' }] },
    ])
    await appwrite(send, { apiKey: 'server-key' }).schema.apply({
      ...BLUEPRINT,
      tables: [BLUEPRINT.tables[1]],
    })
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET'])
  })

  it('reads a blueprint back out of the collections', async () => {
    const { send } = recorder([{
      collections: [{
        $id: 'notes',
        $permissions: ['read("any")', 'create("users")'],
        attributes: [
          { key: 'title', type: 'string', required: true },
          { key: 'priority', type: 'integer' },
          { key: 'author', type: 'relationship' },
        ],
      }],
    }])
    const blueprint = await appwrite(send, { apiKey: 'server-key' }).schema.inspect()
    expect(blueprint.tables[0].name).toBe('notes')
    expect(blueprint.tables[0].columns.map((column) => column.type)).toEqual(['text', 'integer', 'reference'])
    expect(blueprint.tables[0].policies).toEqual({
      read: 'public', create: 'authenticated', update: 'nobody', delete: 'nobody',
    })
  })
})

/* ------------------------------------------------------------- the rest */

describe('the Appwrite adapter in the catalogue', () => {
  it('is offered as ready, with the fields it needs', () => {
    const info = adapterById('appwrite')!.info
    expect(info.status).toBe('ready')
    expect(info.fields.map((entry) => entry.key)).toEqual(['url', 'projectId', 'databaseId', 'apiKey'])
    expect(info.fields.find((entry) => entry.key === 'apiKey')?.secret).toBe(true)
    expect(info.capabilities.realtime.tables).toBe(true)
    expect(info.capabilities.db.embeds).toBe(false)
  })

  it('refuses to be created without an endpoint and a project', () => {
    // The registry stops first, naming the field; the adapter refuses
    // too, for anyone holding it directly.
    expect(() => createBackend({ adapter: 'appwrite', config: { url: ENDPOINT } }))
      .toThrowError(/still needs Project ID/)
    expect(() => appwriteAdapter.create({ url: ENDPOINT }))
      .toThrowError(/needs its endpoint and a project id/)
  })

  it('turns a failure into a sentence a person can act on', async () => {
    const backend = appwrite(failing(401, JSON.stringify({ message: 'User (role: guests) missing scope (account)' })))
    await expect(backend.db.select('notes')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'User (role: guests) missing scope (account)',
    })
  })

  it('reports its own health without throwing', async () => {
    const { calls, send } = recorder([{ country: 'NG' }])
    expect(await appwrite(send).health()).toMatchObject({ ok: true })
    // Without a key `/health` is out of reach, so the check is one any
    // client may make.
    expect(calls[0].url).toBe(`${ENDPOINT}/locale`)

    const keyed = recorder([{ version: '1.8.2' }])
    expect(await appwrite(keyed.send, { apiKey: 'server-key' }).health())
      .toEqual({ ok: true, detail: 'Appwrite 1.8.2 at cloud.appwrite.io.' })

    const broken = await appwrite(failing(500, 'boom')).health()
    expect(broken.ok).toBe(false)
  })

  it('refuses everything it declared it cannot do', async () => {
    const backend = appwrite(recorder().send)
    await expect(backend.realtime.room('lobby', {})).rejects.toBeInstanceOf(BackendError)
    await expect(backend.functions.deploy({ name: 'f', runtime: 'node', source: '' }))
      .rejects.toThrowError(/CLI/)
    await expect(backend.functions.webhooks.list()).rejects.toThrowError(/project setting/)
  })

  it('invokes a function and parses what it answered', async () => {
    const { calls, send } = recorder([{ responseBody: JSON.stringify({ ok: true }) }])
    const answer = await appwrite(send).functions.invoke('resize', { width: 10 })
    expect(calls[0].url).toBe(`${ENDPOINT}/functions/resize/executions`)
    expect(JSON.parse(String(calls[0].body))).toEqual({ body: JSON.stringify({ width: 10 }), async: false })
    expect(answer).toEqual({ ok: true })

    const text = recorder([{ responseBody: 'plain' }])
    expect(await appwrite(text.send).functions.invoke('resize')).toBe('plain')
  })
})
