/**
 * The PocketBase adapter.
 *
 * The interesting part of this adapter is not that it can list rows —
 * every adapter can. It is the three places PocketBase disagrees with
 * the contract, and whether each disagreement is handled or papered
 * over:
 *
 *  - filters are a string DSL, so a value a user typed becomes syntax
 *    and the escaping has to be tested, not assumed;
 *  - paging is by page number, so an offset that does not land on a
 *    page boundary has to be read and sliced rather than silently
 *    returning the wrong rows;
 *  - realtime is Server-Sent Events, which these transports do not
 *    carry, so the refusal has to be a sentence that names the
 *    backends that do.
 *
 * Those three, plus the two-pass schema apply that makes forward
 * references between collections possible, are what this file is for.
 */

import { describe, expect, it } from 'vitest'

import { BackendError, type HttpSend } from './contract'
import { BLUEPRINT_VERSION, type Blueprint } from './blueprint'
import { multipartBody, toBytes } from './adapters/http'
import { pocketbaseAdapter, pocketbaseFilter, pocketbaseLiteral, pocketbaseSort } from './adapters/pocketbase'
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

const URL_BASE = 'http://127.0.0.1:8090'

function pocketbase(send: HttpSend, config: Record<string, string> = {}) {
  return pocketbaseAdapter.create({ url: URL_BASE, http: send, ...config })
}

/** The query string of a recorded call, decoded. */
function query(call: Recorded): Record<string, string> {
  const search = new URL(call.url).searchParams
  return Object.fromEntries(search.entries())
}

/* ---------------------------------------------------------------- filters */

describe('the PocketBase filter language', () => {
  it('escapes a value rather than letting it end the expression', () => {
    // The whole reason this function exists. A title containing an
    // apostrophe is ordinary; a title containing one that closes the
    // string is a broken query at best.
    expect(pocketbaseLiteral("it's")).toBe("'it\\'s'")
    expect(pocketbaseLiteral('back\\slash')).toBe("'back\\\\slash'")
    expect(pocketbaseLiteral(7)).toBe('7')
    expect(pocketbaseLiteral(true)).toBe('true')
    expect(pocketbaseLiteral(null)).toBe('null')
  })

  it('renders the tree with PocketBase operators', () => {
    expect(pocketbaseFilter({
      all: [
        { column: 'done', op: 'eq', value: false },
        { any: [{ column: 'priority', op: 'gte', value: 3 }, { column: 'pinned', op: 'eq', value: true }] },
      ],
    })).toBe('(done=false && (priority>=3 || pinned=true))')

    expect(pocketbaseFilter({ not: { column: 'title', op: 'neq', value: 'x' } })).toBe("!(title!='x')")
  })

  it('maps the operators PocketBase spells differently', () => {
    // `~` is their contains, and it is already case-insensitive, so
    // like and ilike land on the same operator instead of one of them
    // quietly doing something else. `%` is SQL punctuation, not theirs.
    expect(pocketbaseFilter({ column: 'title', op: 'like', value: '%ink%' })).toBe("title~'ink'")
    expect(pocketbaseFilter({ column: 'title', op: 'ilike', value: 'Ink' })).toBe("title~'Ink'")
    // An empty string is also "not set" in PocketBase, so a null test
    // that ignored it would miss most of the rows it is asked about.
    expect(pocketbaseFilter({ column: 'due', op: 'is-null' })).toBe("(due=null || due='')")
    expect(pocketbaseFilter({ column: 'due', op: 'not-null' })).toBe("(due!=null && due!='')")
    expect(pocketbaseFilter({ column: 'status', op: 'in', value: ['a', 'b'] })).toBe("(status='a' || status='b')")
    expect(pocketbaseFilter({ column: 'status', op: 'in', value: [] })).toBe('false')
  })

  it('refuses a column name it would have to interpolate blindly', () => {
    expect(() => pocketbaseFilter({ column: "title';drop", op: 'eq', value: 1 }))
      .toThrowError(/is not a field name/)
    expect(() => pocketbaseSort([{ column: 'name) --', direction: 'asc' }])).toThrowError(/is not a field name/)
  })

  it('writes the sort the way PocketBase wants it', () => {
    expect(pocketbaseSort(undefined)).toBeUndefined()
    expect(pocketbaseSort([{ column: 'created', direction: 'desc' }, { column: 'title' }])).toBe('-created,title')
  })
})

/* ------------------------------------------------------------------- rows */

describe('PocketBase records', () => {
  it('builds one request with the filter, sort, expand and fields in it', async () => {
    const { calls, send } = recorder([{ items: [{ id: 'r1', title: 'One', expand: { author: { id: 'u1' } } }] }])
    const page = await pocketbase(send).db.select('notes', {
      where: { column: 'done', op: 'eq', value: false },
      order: [{ column: 'created', direction: 'desc' }],
      columns: ['id', 'title'],
      embed: [{ table: 'users', foreignKey: 'author', as: 'writer' }],
    })

    const parameters = query(calls[0])
    expect(calls[0].url.startsWith(`${URL_BASE}/api/collections/notes/records?`)).toBe(true)
    expect(parameters.filter).toBe('done=false')
    expect(parameters.sort).toBe('-created')
    expect(parameters.expand).toBe('author')
    expect(parameters.fields).toBe('id,title')
    // No count was asked for, so the adapter tells PocketBase not to
    // pay for one.
    expect(parameters.skipTotal).toBe('true')
    // `expand` is flattened onto the row under the name the block asked
    // for, so the canvas never sees PocketBase's envelope.
    expect(page.rows[0]).toEqual({ id: 'r1', title: 'One', writer: { id: 'u1' } })
    expect(page.total).toBeUndefined()
  })

  it('turns an aligned offset into a page, and an unaligned one into a slice', async () => {
    const aligned = recorder([{ items: [] }])
    await pocketbase(aligned.send).db.select('notes', { limit: 20, offset: 40 })
    expect(query(aligned.calls[0])).toMatchObject({ perPage: '20', page: '3' })

    // 25 is not a multiple of 10, so there is no page containing it.
    // Reading 35 and dropping 25 is slower and correct; asking for
    // page 3.5 is neither.
    const unaligned = recorder([{ items: Array.from({ length: 35 }, (_, index) => ({ id: `r${index}` })) }])
    const page = await pocketbase(unaligned.send).db.select('notes', { limit: 10, offset: 25 })
    const parameters = query(unaligned.calls[0])
    expect(parameters.perPage).toBe('35')
    expect(parameters.page).toBeUndefined()
    expect(page.rows.map((row) => row.id)).toEqual(['r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31', 'r32', 'r33', 'r34'])
  })

  it('counts without carrying the rows back', async () => {
    const { calls, send } = recorder([{ totalItems: 94, items: [{ id: 'r1' }] }])
    expect(await pocketbase(send).db.count('notes', { column: 'done', op: 'eq', value: true })).toBe(94)
    expect(query(calls[0])).toMatchObject({ perPage: '1', fields: 'id', filter: 'done=true' })
  })

  it('reads a missing row as undefined and deletes by filter in two steps', async () => {
    const missing = pocketbase(failing(404, '{"message":"The requested resource wasn\'t found."}'))
    expect(await missing.db.find('notes', 'nope')).toBeUndefined()

    const { calls, send } = recorder([{ items: [{ id: 'r1' }, { id: 'r2' }] }, {}, {}])
    const removed = await pocketbase(send).db.removeWhere('notes', { column: 'done', op: 'eq', value: true })
    expect(removed).toBe(2)
    expect(calls.slice(1).map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'DELETE /api/collections/notes/records/r1',
      'DELETE /api/collections/notes/records/r2',
    ])
  })

  it('refuses an upsert instead of faking one', async () => {
    // PocketBase has no upsert, and a read-then-write wearing the name
    // would lose a race the contract promises it will not.
    await expect(pocketbase(recorder().send).db.upsert('notes', { id: 'r1' }))
      .rejects.toThrowError(/no upsert.*unique index/s)
    expect(adapterById('pocketbase')!.info.capabilities.db.upsert).toBe(false)
  })
})

/* ------------------------------------------------------------------- auth */

describe('PocketBase accounts', () => {
  it('signs a new account in, because creating the record does not', async () => {
    const { calls, send } = recorder([
      { id: 'u1', email: 'a@b.c' },
      { token: 'tok', record: { id: 'u1', email: 'a@b.c', name: 'Ada', created: '2026-01-01 00:00:00Z' } },
    ])
    const backend = pocketbase(send)
    const session = await backend.auth.signUp({ email: 'a@b.c', password: 'hunter2hunter2', name: 'Ada' })

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/collections/users/records',
      '/api/collections/users/auth-with-password',
    ])
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ passwordConfirm: 'hunter2hunter2' })
    expect(session.token).toBe('tok')
    expect(session.user).toEqual({
      id: 'u1', email: 'a@b.c', name: 'Ada', metadata: {}, roles: undefined, createdAt: '2026-01-01 00:00:00Z',
    })

    // The token from the sign-in is carried on the next call without
    // the caller having to hand it back.
    await backend.db.select('notes')
    expect(calls[2].headers.authorization).toBe('tok')
  })

  it('reads an expired session as nobody, then stops sending the dead token', async () => {
    const { calls, send } = recorder([{ items: [] }])
    const refusing: HttpSend = (url, init) => (
      calls.length === 0 && String(url).includes('auth-refresh')
        ? failing(401, '{"message":"The request requires valid record authorization token."}')(url, init)
        : send(url, init)
    )
    const backend = pocketbase(refusing, { token: 'stale' })

    // An expired token is a fact about the world, not an error: the
    // contract says `session` never throws for "nobody is signed in".
    await expect(backend.auth.session()).resolves.toBeUndefined()
    await backend.db.select('notes')
    expect(calls[0].headers.authorization).toBeUndefined()
  })

  it('will not finish an OAuth round trip it did not start', async () => {
    // PocketBase's exchange needs the code verifier from the same
    // handshake. Inventing one would fail at the server with a worse
    // message than this.
    await expect(pocketbase(recorder().send).auth.exchange('code-123'))
      .rejects.toThrowError(/Start the sign-in with the OAuth block first/)
  })

  it('names the providers the server actually has', async () => {
    const { send } = recorder([{ oauth2: { providers: [{ name: 'github', authURL: 'https://pb/oauth?x=1', codeVerifier: 'v' }] } }])
    await expect(pocketbase(send).auth.oauthUrl('google', 'http://localhost/cb'))
      .rejects.toThrowError(/no “google” provider configured. It offers github/)
  })

  it('needs a superuser token to change somebody else’s roles', async () => {
    await expect(pocketbase(recorder().send).auth.setRoles('u2', ['admin']))
      .rejects.toThrowError(/only lets a superuser change another user’s roles/)

    const { calls, send } = recorder([{ id: 'u2', roles: ['admin'] }])
    const user = await pocketbase(send, { adminToken: 'super' }).auth.setRoles('u2', ['admin'])
    expect(calls[0].headers.authorization).toBe('super')
    expect(user.roles).toEqual(['admin'])
  })
})

/* ---------------------------------------------------------------- storage */

describe('PocketBase files', () => {
  it('uploads as multipart and returns the record-scoped path', async () => {
    const { calls, send } = recorder([{ id: 'rec1', file: 'note.txt' }])
    const stored = await pocketbase(send).storage.upload({
      bucket: 'attachments',
      path: 'folder/note.txt',
      data: 'hello',
      contentType: 'text/plain',
    })

    const body = new TextDecoder().decode(calls[0].body as Uint8Array)
    expect(calls[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(body).toContain('Content-Disposition: form-data; name="file"; filename="note.txt"')
    expect(body).toContain('Content-Type: text/plain')
    expect(body).toContain('hello')
    // A file here belongs to a record, so the path says so rather than
    // pretending there is a folder tree.
    expect(stored).toMatchObject({
      bucket: 'attachments',
      path: 'rec1/note.txt',
      url: `${URL_BASE}/api/files/attachments/rec1/note.txt`,
      size: 5,
    })
  })

  it('asks for a thumbnail only when a transform wants a size', () => {
    const storage = pocketbase(recorder().send).storage
    expect(storage.publicUrl('attachments', 'rec1/note.png'))
      .toBe(`${URL_BASE}/api/files/attachments/rec1/note.png`)
    expect(storage.publicUrl('attachments', 'rec1/note.png', { width: 100, height: 80 }))
      .toBe(`${URL_BASE}/api/files/attachments/rec1/note.png?thumb=100x80`)
    // `f` is PocketBase's "fit inside", which is what `contain` means.
    expect(storage.publicUrl('attachments', 'rec1/note.png', { width: 100, height: 80, fit: 'contain' }))
      .toBe(`${URL_BASE}/api/files/attachments/rec1/note.png?thumb=100x80f`)
    // A quality-only transform resizes nothing, so no thumb is asked for.
    expect(storage.publicUrl('attachments', 'rec1/note.png', { quality: 50 }))
      .toBe(`${URL_BASE}/api/files/attachments/rec1/note.png`)
  })

  it('refuses to create or delete a bucket, because a bucket is a collection', async () => {
    const storage = pocketbase(recorder().send).storage
    await expect(storage.createBucket({ name: 'x', public: false }))
      .rejects.toThrowError(/a bucket is a collection with a file field/)
    await expect(storage.removeBucket('x')).rejects.toThrowError(/delete a whole collection and its rows/)
  })
})

/* ---------------------------------------------------------------- realtime */

describe('PocketBase realtime', () => {
  it('says why it cannot stream, and what can', async () => {
    const backend = pocketbase(recorder().send)
    await expect(backend.realtime.table('notes', () => undefined))
      .rejects.toThrowError(/Server-Sent Events.*Vortex and Supabase both stream over WebSockets/s)
    await expect(backend.realtime.room('lobby', {})).rejects.toThrowError(/cannot host broadcast rooms/)
    // Declared, so the canvas greys the blocks out before anybody runs them.
    expect(adapterById('pocketbase')!.info.capabilities.realtime).toEqual({
      tables: false, rooms: false, presence: false, replay: false,
    })
    // Closing channels that were never opened is not an error.
    await expect(backend.realtime.disconnect()).resolves.toBeUndefined()
  })
})

/* ------------------------------------------------------------------ schema */

const BLUEPRINT: Blueprint = {
  version: BLUEPRINT_VERSION,
  name: 'Notes',
  tables: [
    {
      name: 'notes',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'author', type: 'reference', references: { table: 'people' } },
      ],
      policies: { read: 'owner', create: 'authenticated', update: 'owner', delete: 'nobody' },
    },
    { name: 'people', columns: [{ name: 'email', type: 'text', unique: true }] },
  ],
}

describe('PocketBase collections', () => {
  it('plans a script when there is no superuser token, and an apply when there is', async () => {
    const withoutToken = await pocketbase(recorder().send).schema.plan(BLUEPRINT)
    expect(withoutToken.mode).toBe('script')
    expect(withoutToken.problems[0]).toMatch(/only lets a superuser create collections/)

    const withToken = await pocketbase(recorder().send, { adminToken: 'super' }).schema.plan(BLUEPRINT)
    expect(withToken.mode).toBe('apply')
    expect(withToken.problems).toEqual([])
    expect(withToken.operations.map((operation) => operation.subject))
      .toEqual(['notes', 'notes rules', 'people', 'people rules'])
  })

  it('creates every collection before wiring the relations between them', async () => {
    // `notes.author` points at `people`, which is declared after it. A
    // single pass would have nothing to put in `collectionId`.
    const { calls, send } = recorder([
      { items: [] },
      { id: 'c-notes' },
      { id: 'c-people' },
      {},
      {},
    ])
    await pocketbase(send, { adminToken: 'super' }).schema.apply(BLUEPRINT)

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /api/collections',
      'POST /api/collections',
      'POST /api/collections',
      'PATCH /api/collections/c-notes',
      'PATCH /api/collections/c-people',
    ])
    const notes = JSON.parse(String(calls[3].body)) as Record<string, unknown>
    expect(notes.fields).toEqual([
      { name: 'title', type: 'text', required: true },
      { name: 'author', type: 'relation', required: false, collectionId: 'c-people', maxSelect: 1 },
    ])
    // The five rules, in PocketBase's vocabulary: null is superusers
    // only, and an expression is everybody else.
    expect(notes).toMatchObject({
      listRule: '@request.auth.id != "" && owner_id = @request.auth.id',
      createRule: '@request.auth.id != ""',
      deleteRule: null,
    })
  })

  it('does not touch a collection that already exists', async () => {
    const { calls, send } = recorder([{ items: [{ id: 'c-notes', name: 'notes' }, { id: 'c-people', name: 'people' }] }, {}, {}])
    const plan = await pocketbase(send, { adminToken: 'super' }).schema.apply(BLUEPRINT)
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
    expect(plan.operations.every((operation) => operation.kind === 'add-column')).toBe(true)
  })

  it('reads the live collections back as a blueprint', async () => {
    const { send } = recorder([{
      items: [{
        id: 'c-notes',
        name: 'notes',
        type: 'base',
        listRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: null,
        deleteRule: null,
        // v0.23 renamed `schema` to `fields`; both shapes are read.
        schema: [{ name: 'title', type: 'text', required: true }, { name: 'done', type: 'bool' }],
      }, { id: 'v1', name: 'a_view', type: 'view', fields: [] }],
    }])
    const blueprint = await pocketbase(send, { adminToken: 'super' }).schema.inspect()

    expect(blueprint.tables.map((table) => table.name)).toEqual(['notes'])
    expect(blueprint.tables[0].columns).toEqual([
      { name: 'title', type: 'text', required: true, unique: false },
      { name: 'done', type: 'boolean', required: false, unique: false },
    ])
    expect(blueprint.tables[0].policies).toEqual({
      read: 'public', create: 'authenticated', update: 'nobody', delete: 'nobody',
    })
  })

  it('refuses to apply at all without a superuser token', async () => {
    await expect(pocketbase(recorder().send).schema.apply(BLUEPRINT))
      .rejects.toThrowError(/only lets a superuser create or change collections/)
  })
})

/* ------------------------------------------------------------- the plumbing */

describe('PocketBase in the catalogue', () => {
  it('is built now, and reachable from the project settings', () => {
    const info = adapterById('pocketbase')!.info
    expect(info.status).toBe('ready')
    const backend = createBackend({ adapter: 'pocketbase', config: { url: URL_BASE } }, { http: recorder().send })
    expect(backend.info.label).toBe('PocketBase')
  })

  it('asks for the address before anything else', () => {
    expect(() => pocketbaseAdapter.create({})).toThrowError(BackendError)
    expect(() => pocketbaseAdapter.create({})).toThrowError(/needs the address it is served from/)
  })

  it('answers the connection test with the server’s own words', async () => {
    const { calls, send } = recorder([{ code: 200, message: 'API is healthy.' }])
    expect(await pocketbase(send).health()).toEqual({ ok: true, detail: '127.0.0.1:8090: API is healthy.' })
    expect(new URL(calls[0].url).pathname).toBe('/api/health')

    const down = await pocketbase(() => Promise.reject(new Error('ECONNREFUSED'))).health()
    expect(down.ok).toBe(false)
    expect(down.detail).toMatch(/Could not reach 127\.0\.0\.1:8090/)
  })

  it('refuses functions with the reason, not a 404', async () => {
    const backend = pocketbase(recorder().send)
    await expect(backend.functions.list()).rejects.toThrowError(/pb_hooks/)
    await expect(backend.functions.webhooks.register({ name: 'n', table: 't', on: ['insert'], url: 'u' }))
      .rejects.toThrowError(/nothing to deploy over the API/)
  })
})

/* ------------------------------------------------------------- the helpers */

describe('multipart bodies', () => {
  it('builds a body a server can parse, with the parts in order', async () => {
    const { body, contentType } = multipartBody(
      [{ name: 'title', value: 'Note' }, { name: 'file', filename: 'a.txt', data: await toBytes('hi') }],
      'BOUND',
    )
    expect(contentType).toBe('multipart/form-data; boundary=BOUND')
    expect(new TextDecoder().decode(body)).toBe(
      '--BOUND\r\nContent-Disposition: form-data; name="title"\r\n\r\nNote\r\n'
      + '--BOUND\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
      + 'Content-Type: application/octet-stream\r\n\r\nhi\r\n'
      + '--BOUND--\r\n',
    )
  })

  it('takes bytes, text or a blob', async () => {
    expect(await toBytes('ab')).toEqual(new Uint8Array([97, 98]))
    expect(await toBytes(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]))
    expect(await toBytes(new Blob(['xy']))).toEqual(new Uint8Array([120, 121]))
  })
})
