/**
 * The contract, and the adapters that have to honour it.
 *
 * Two kinds of test live here. The first is a conformance suite: the
 * same scenario run against every implemented adapter, asserting on the
 * requests each one builds. An abstraction is only worth the
 * indirection if the thing underneath can actually be swapped, and the
 * only way to know that is to swap it in a test.
 *
 * The second is the blueprint: validation, the policy defaults, the
 * SQL, and the summary the approval gate shows. That one is paranoid on
 * purpose — it is the code path an AI's output walks down before
 * anything touches a database.
 */

import { describe, expect, it } from 'vitest'

import {
  BLUEPRINT_VERSION,
  blueprintFromDescription,
  blueprintFromSchema,
  describePolicies,
  parseBlueprint,
  PRIVATE_POLICIES,
  schemaFromBlueprint,
  summariseBlueprint,
  type Blueprint,
} from './blueprint'
import { orderTables, scriptFor, sqlForBlueprint } from './sql'
import { filterToSql } from './adapters/http'
import { filterToParams } from './adapters/supabase'
import { matches, splitFilter } from './adapters/selfHosted'
import {
  ADAPTERS,
  adapterById,
  backendChoices,
  createBackend,
  DEFAULT_BACKEND,
  missingFields,
  readBackendSettings,
} from './registry'
import type { HttpSend, Socket } from './contract'
import { BackendError } from './contract'

/* ----------------------------------------------------------- the fixtures */

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string }

/** A fetch that records and replies with whatever the test prepared. */
function recorder(replies: Array<unknown> = []) {
  const calls: Recorded[] = []
  let index = 0
  const send: HttpSend = (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const reply = replies[index++] ?? {}
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(reply)),
      headers: { get: (name: string) => (name === 'content-range' ? '0-1/7' : null) },
    })
  }
  return { calls, send }
}

/** A fetch that always fails, for the error-translation tests. */
function failing(status: number, body: string): HttpSend {
  return () => Promise.resolve({ ok: false, status, text: () => Promise.resolve(body), headers: { get: () => null } })
}

/** A socket that records frames and can be fed messages. */
function socketPair() {
  const sent: string[] = []
  const handlers = new Map<string, (event: { data?: unknown }) => void>()
  let closed = false
  const socket: Socket = {
    send: (data) => sent.push(data),
    close: () => { closed = true },
    addEventListener: (event, handler) => { handlers.set(event, handler) },
  }
  return {
    sent,
    isClosed: () => closed,
    deliver: (frame: unknown) => handlers.get('message')?.({ data: JSON.stringify(frame) }),
    open: () => socket,
    frames: () => sent.map((text) => JSON.parse(text) as Record<string, unknown>),
  }
}

const SUPABASE = { adapter: 'supabase', config: { url: 'https://demo.supabase.co', anonKey: 'anon-key' } }
const VORTEX = { adapter: 'vortex', config: { url: 'https://api.vortex.dev', projectKey: 'proj_1' } }
const SELF = { adapter: 'self-hosted', config: { url: 'http://localhost:8787' } }

/* -------------------------------------------------------- the catalogue */

describe('the backend catalogue', () => {
  it('offers six backends, five of them working today', () => {
    const choices = backendChoices()
    expect(choices.map((choice) => choice.id)).toEqual([
      'vortex', 'supabase', 'self-hosted', 'pocketbase', 'firebase', 'appwrite',
    ])
    const working = choices.filter((choice) => choice.status !== 'planned')
    expect(working.map((choice) => choice.id)).toEqual([
      'vortex', 'supabase', 'self-hosted', 'pocketbase', 'appwrite',
    ])
  })

  it('launches on Supabase, with Vortex waiting in preview', () => {
    expect(DEFAULT_BACKEND).toBe('supabase')
    expect(adapterById('supabase')?.info.status).toBe('default')
    expect(adapterById('vortex')?.info.status).toBe('preview')
  })

  it('refuses a planned adapter with advice instead of a stack trace', () => {
    expect(() => createBackend({ adapter: 'firebase', config: { projectId: 'x', apiKey: 'y' } }))
      .toThrowError(/not built yet.*Supabase and the self-hosted service both work today/s)
  })

  it('says what a backend is still missing', () => {
    expect(missingFields({ adapter: 'supabase', config: {} })).toEqual(['Project URL', 'Anon key'])
    expect(missingFields({ adapter: 'supabase', config: SUPABASE.config })).toEqual([])
    // Optional fields never block a connection.
    expect(missingFields({ adapter: 'vortex', config: { projectKey: 'k' } })).toEqual([])
  })

  it('reads a saved setting defensively', () => {
    expect(readBackendSettings(undefined)).toEqual({ adapter: 'supabase', config: {} })
    expect(readBackendSettings({ adapter: 'nonsense', config: { url: 'x' } }))
      .toEqual({ adapter: 'supabase', config: { url: 'x' } })
    expect(readBackendSettings({ adapter: 'vortex', config: { projectKey: 'k', bad: 7 } }))
      .toEqual({ adapter: 'vortex', config: { projectKey: 'k' } })
  })

  it('declares capabilities honestly, backend by backend', () => {
    expect(adapterById('vortex')!.info.capabilities.realtime.replay).toBe(true)
    expect(adapterById('supabase')!.info.capabilities.realtime.replay).toBe(false)
    expect(adapterById('self-hosted')!.info.capabilities.realtime.tables).toBe(false)
    expect(adapterById('supabase')!.info.capabilities.functions.deploy).toBe(false)
    expect(adapterById('vortex')!.info.capabilities.functions.deploy).toBe(true)
  })

  it('never ships an adapter without a summary and a field list', () => {
    for (const adapter of ADAPTERS) {
      expect(adapter.info.summary.length).toBeGreaterThan(20)
      expect(adapter.info.fields.length).toBeGreaterThan(0)
      for (const field of adapter.info.fields) expect(field.label.length).toBeGreaterThan(2)
    }
  })
})

/* ------------------------------------------------------- the conformance */

describe.each([
  ['supabase', SUPABASE],
  ['vortex', VORTEX],
  ['self-hosted', SELF],
] as const)('%s honours the contract', (id, settings) => {
  /** The backend, plus the calls it made. */
  function wired(replies: unknown[] = []) {
    const { calls, send } = recorder(replies)
    const backend = createBackend(settings, { http: send })
    return { backend, calls }
  }

  it('signs in, and carries the token afterwards', async () => {
    const session = { token: 'tok_1', access_token: 'tok_1', user: { id: 'u1', email: 'ada@example.com' } }
    const { backend, calls } = wired([session, { rows: [] }, { rows: [] }])

    const result = await backend.auth.signIn('ada@example.com', 'correct horse')
    expect(result.user.email).toBe('ada@example.com')
    expect(result.token).toBe('tok_1')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toMatch(/sign-in|token\?grant_type=password/)

    await backend.db.select('notes')
    expect(calls[1].headers.authorization).toBe('Bearer tok_1')
  })

  it('reads a table and hands back rows', async () => {
    const rows = [{ id: 1, title: 'From the backend' }]
    // PostgREST answers with a bare array; the other two wrap it.
    const { backend } = wired([id === 'supabase' ? rows : { rows }])
    const page = await backend.db.select('notes')
    expect(page.rows).toEqual(rows)
  })

  it('writes, changes and deletes a row', async () => {
    const saved = [{ id: 7, title: 'Hello' }]
    const { backend, calls } = wired([
      id === 'supabase' ? saved : { rows: saved, row: saved[0] },
      id === 'supabase' ? saved : { row: saved[0] },
      {},
    ])

    await backend.db.insert('notes', { title: 'Hello' })
    await backend.db.update('notes', 7, { title: 'Changed' })
    await backend.db.remove('notes', 7)

    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toContain('Hello')
    expect(calls[1].method).toBe('PATCH')
    expect(calls[2].method).toBe('DELETE')
    for (const call of calls) expect(call.url).toContain('notes')
  })

  it('turns a failure into a sentence a person can act on', async () => {
    const backend = createBackend(settings, {
      http: failing(401, JSON.stringify({ message: 'Invalid login credentials' })),
    })
    await expect(backend.auth.signIn('ada@example.com', 'wrong')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Invalid login credentials',
    })
  })

  it('reports its own health without throwing', async () => {
    const offline = createBackend(settings, { http: failing(500, 'nope') })
    const health = await offline.health()
    expect(health.ok).toBe(false)
    expect(health.detail.length).toBeGreaterThan(0)
  })

  it('refuses everything it declared it cannot do', async () => {
    const { backend } = wired()
    const can = backend.info.capabilities
    const attempts: Array<[boolean, () => Promise<unknown>]> = [
      [can.realtime.tables, () => backend.realtime.table('notes', () => undefined)],
      [can.functions.deploy, () => backend.functions.deploy({ name: 'f', runtime: 'js', source: '' })],
      [can.storage.signedUrls, () => backend.storage.signedUrl('media', 'a.png', 60)],
    ]
    for (const [allowed, attempt] of attempts) {
      if (allowed) continue
      await expect(attempt()).rejects.toBeInstanceOf(BackendError)
    }
  })

  it('plans a schema before it applies one', async () => {
    // Vortex plans on the server, so it gets a planned reply; the other
    // two ignore it and plan locally.
    const { backend, calls } = wired([{
      operations: [{ kind: 'create-table', subject: 'posts', statement: 'create table if not exists "posts" ();' }],
      problems: [],
    }])
    const blueprint = blueprintFromDescription('a blog with posts and comments', 'Blog')
    const plan = await backend.schema.plan(blueprint)
    expect(plan.operations.length).toBeGreaterThan(0)
    // Planning never writes. Vortex asks its server to plan; the others
    // do it locally — either way nothing is applied.
    for (const call of calls) expect(call.url).not.toContain('apply')
  })
})

/* ------------------------------------------------- adapter-specific truth */

describe('the Supabase adapter', () => {
  it('spells filters the way PostgREST does', () => {
    expect(filterToParams({ column: 'status', op: 'eq', value: 'open' })).toEqual([['status', 'eq.open']])
    expect(filterToParams({ column: 'assignee', op: 'is-null' })).toEqual([['assignee', 'is.null']])
    expect(filterToParams({ column: 'id', op: 'in', value: [1, 2, 3] })).toEqual([['id', 'in.(1,2,3)']])
    expect(filterToParams({
      all: [{ column: 'done', op: 'eq', value: false }, { column: 'stars', op: 'gte', value: 4 }],
    })).toEqual([['done', 'eq.false'], ['stars', 'gte.4']])
    expect(filterToParams({
      any: [{ column: 'a', op: 'eq', value: 1 }, { column: 'b', op: 'eq', value: 2 }],
    })).toEqual([['or', '(a.eq.1,b.eq.2)']])
  })

  it('asks for embeds in the select parameter', async () => {
    const { calls, send } = recorder([[]])
    const backend = createBackend(SUPABASE, { http: send })
    await backend.db.select('posts', { columns: ['id', 'title'], embed: [{ table: 'comments', columns: ['body'] }] })
    expect(decodeURIComponent(calls[0].url)).toContain('select=id,title,comments(body)')
  })

  it('reads the total out of the content-range header', async () => {
    const { send } = recorder([[{ id: 1 }]])
    const backend = createBackend(SUPABASE, { http: send })
    const page = await backend.db.select('posts', { count: true })
    expect(page.total).toBe(7)
  })

  it('joins a Phoenix channel and decodes a change', async () => {
    const pair = socketPair()
    const backend = createBackend(SUPABASE, { http: recorder().send, openSocket: pair.open })
    const seen: string[] = []
    await backend.realtime.table('notes', (change) => seen.push(`${change.kind}:${String(change.row.title)}`))

    const join = pair.frames()[0]
    expect(join.topic).toBe('realtime:public:notes')
    expect(join.event).toBe('phx_join')

    pair.deliver({
      topic: 'realtime:public:notes',
      event: 'postgres_changes',
      payload: { data: { type: 'INSERT', record: { title: 'live' }, commit_timestamp: '2026-01-01T00:00:00Z' } },
    })
    expect(seen).toEqual(['insert:live'])
  })

  it('will not apply DDL without a service key, and says why', async () => {
    const backend = createBackend(SUPABASE, { http: recorder().send })
    const blueprint = blueprintFromDescription('tasks', 'Tasks')
    expect((await backend.schema.plan(blueprint)).mode).toBe('script')
    await expect(backend.schema.apply(blueprint)).rejects.toThrowError(/SQL editor|exec_sql/)
  })

  it('applies DDL when the project has one', async () => {
    const { calls, send } = recorder([{}, {}, {}, {}, {}, {}, {}, {}, {}, {}])
    const backend = createBackend(
      { adapter: 'supabase', config: { ...SUPABASE.config, serviceKey: 'service-key' } },
      { http: send },
    )
    const plan = await backend.schema.apply(blueprintFromDescription('tasks', 'Tasks'))
    expect(plan.mode).toBe('apply')
    expect(calls[0].url).toContain('/rest/v1/rpc/exec_sql')
    expect(calls[0].headers.apikey).toBe('service-key')
  })
})

describe('the Vortex adapter', () => {
  it('sends the filter tree as it stands, because it can', async () => {
    const { calls, send } = recorder([{ rows: [] }])
    const backend = createBackend(VORTEX, { http: send })
    await backend.db.select('orders', {
      where: { all: [{ column: 'status', op: 'eq', value: 'open' }, { column: 'total', op: 'gt', value: 100 }] },
      cursor: 'c_42',
      count: true,
    })
    const body = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>
    expect(body.where).toEqual({
      all: [{ column: 'status', op: 'eq', value: 'open' }, { column: 'total', op: 'gt', value: 100 }],
    })
    expect(body.cursor).toBe('c_42')
  })

  it('resumes a subscription from a cursor, which is the whole point', async () => {
    const pair = socketPair()
    const backend = createBackend(VORTEX, { http: recorder().send, openSocket: pair.open })
    const subscription = await backend.realtime.table('orders', () => undefined, { since: 'c_7', kinds: ['insert'] })

    const frame = pair.frames()[0]
    expect(frame).toMatchObject({ type: 'subscribe', table: 'orders', since: 'c_7', kinds: ['insert'] })
    expect(subscription.cursor()).toBe('c_7')

    pair.deliver({ table: 'orders', change: 'insert', row: { id: 1 }, cursor: 'c_8' })
    expect(subscription.cursor()).toBe('c_8')
  })

  it('broadcasts and tracks presence in a room', async () => {
    const pair = socketPair()
    const backend = createBackend(VORTEX, { http: recorder().send, openSocket: pair.open })
    const seen: unknown[] = []
    const room = await backend.realtime.room('lobby', { onMessage: (message) => seen.push(message.payload) })

    await room.broadcast('cursor', { x: 1 })
    await room.track({ name: 'Ada' })
    expect(pair.frames().map((frame) => frame.type)).toEqual(['join', 'broadcast', 'presence'])

    pair.deliver({ room: 'lobby', type: 'broadcast', event: 'cursor', payload: { x: 2 } })
    expect(seen).toEqual([{ x: 2 }])
  })

  it('hands uploads straight to storage, so the bytes never touch us', async () => {
    const { calls, send } = recorder([{ url: 'https://r2.example.com/signed', method: 'PUT' }])
    const backend = createBackend(VORTEX, { http: send })
    const signed = await backend.storage.signedUpload!('media', 'clip.mp4', 600)
    expect(signed).toEqual({ url: 'https://r2.example.com/signed', method: 'PUT' })
    expect(calls[0].url).toContain('/v1/storage/sign-upload')
  })

  it('uses the admin key only for the calls that provision', async () => {
    const { calls, send } = recorder([{ operations: [], problems: [] }, { rows: [] }])
    const backend = createBackend(
      { adapter: 'vortex', config: { ...VORTEX.config, adminKey: 'admin-key' } },
      { http: send },
    )
    await backend.schema.apply({ version: BLUEPRINT_VERSION, name: 'App', tables: [] })
    await backend.db.select('notes')
    expect(calls[0].headers.authorization).toBe('Bearer admin-key')
    expect(calls[1].headers.authorization).toBe('Bearer proj_1')
  })
})

describe('the self-hosted adapter', () => {
  it('sends what the generated service understands, and filters the rest here', async () => {
    const { calls, send } = recorder([{ rows: [{ id: 1, stars: 5 }, { id: 2, stars: 2 }] }])
    const backend = createBackend(SELF, { http: send })
    const page = await backend.db.select('reviews', {
      where: { all: [{ column: 'post_id', op: 'eq', value: 3 }, { column: 'stars', op: 'gte', value: 4 }] },
    })
    // Equality goes over the wire; the comparison is applied to the reply.
    expect(calls[0].url).toContain('post_id=3')
    expect(calls[0].url).not.toContain('stars')
    expect(page.rows).toEqual([{ id: 1, stars: 5 }])
  })

  it('splits a filter into what the server can do and what it cannot', () => {
    const split = splitFilter({
      all: [{ column: 'a', op: 'eq', value: 1 }, { column: 'b', op: 'gt', value: 2 }],
    })
    expect(split.params).toEqual([['a', '1']])
    expect(split.rest).toEqual({ all: [{ column: 'b', op: 'gt', value: 2 }] })
  })

  it('evaluates every operator it claims to', () => {
    const row = { title: 'Hello world', stars: 4, done: null }
    expect(matches(row, { column: 'title', op: 'ilike', value: '%HELLO%' })).toBe(true)
    expect(matches(row, { column: 'stars', op: 'lt', value: 4 })).toBe(false)
    expect(matches(row, { column: 'done', op: 'is-null' })).toBe(true)
    expect(matches(row, { column: 'stars', op: 'in', value: [1, 4] })).toBe(true)
    expect(matches(row, { not: { column: 'stars', op: 'eq', value: 4 } })).toBe(false)
  })

  it('uploads through the x-file-name header the service reads', async () => {
    const { calls, send } = recorder([{ url: '/storage/media/abc.png', name: 'abc.png', size: 12 }])
    const backend = createBackend(SELF, { http: send })
    const file = await backend.storage.upload({ bucket: 'media', path: 'shot.png', data: new Uint8Array([1, 2]) })
    expect(calls[0].headers['x-file-name']).toBe('shot.png')
    expect(file.path).toBe('abc.png')
  })

  it('points at the schema.sql the service already applies', async () => {
    const backend = createBackend(SELF, { http: recorder().send })
    const plan = await backend.schema.plan(blueprintFromDescription('notes', 'Notes'))
    expect(plan.mode).toBe('script')
    expect(plan.operations.some((operation) => operation.statement.includes('create table if not exists'))).toBe(true)
    await expect(backend.schema.apply(plan as unknown as Blueprint)).rejects.toThrowError(/schema\.sql/)
  })
})

/* -------------------------------------------------------- the blueprint */

describe('the Tungsten Schema blueprint', () => {
  const good = {
    version: 1,
    name: 'Delivery',
    tables: [
      {
        name: 'drivers',
        columns: [{ name: 'name', type: 'text', required: true }],
        policies: { read: 'authenticated', create: 'admin', update: 'owner', delete: 'admin' },
        realtime: true,
      },
      {
        name: 'orders',
        columns: [
          { name: 'total', type: 'number' },
          { name: 'driver_id', type: 'reference', references: { table: 'drivers', onDelete: 'cascade' } },
        ],
      },
    ],
    buckets: [{ name: 'receipts', public: false }],
    functions: [{ name: 'notify_driver', trigger: 'insert', table: 'orders', summary: 'Pings the driver.' }],
  }

  it('reads a well-formed blueprint', () => {
    const parsed = parseBlueprint(good)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.blueprint.tables.map((table) => table.name)).toEqual(['drivers', 'orders'])
    expect(parsed.blueprint.buckets).toHaveLength(1)
    expect(parsed.blueprint.functions).toHaveLength(1)
  })

  it('refuses the things an AI gets wrong', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not an object', /JSON object/],
      [{ name: 'x' }, /needs a "tables" array/],
      [{ tables: [{ name: 'Orders', columns: [] }] }, /not a usable table name/],
      [{ tables: [{ name: 'orders', columns: [{ name: 'total', type: 'varchar(255)' }] }] }, /not one of/],
      [{ tables: [{ name: 'orders', columns: [] }, { name: 'orders', columns: [] }] }, /Two tables are called/],
      [
        { tables: [{ name: 'orders', columns: [{ name: 'driver_id', type: 'reference', references: { table: 'drivers' } }] }] },
        /points at drivers, which this blueprint does not create/,
      ],
      [
        { tables: [{ name: 'orders', columns: [], policies: { read: 'everyone' } }] },
        /read policy is “everyone”/,
      ],
      [{ version: 99, tables: [] }, /version 99/],
    ]
    for (const [input, expected] of cases) {
      const parsed = parseBlueprint(input)
      expect(parsed.ok, JSON.stringify(input)).toBe(false)
      if (parsed.ok) continue
      expect(parsed.problems.join(' ')).toMatch(expected)
    }
  })

  it('locks a table down by default', () => {
    const parsed = parseBlueprint({ tables: [{ name: 'notes', columns: [{ name: 'body', type: 'text' }] }] })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.blueprint.tables[0].policies).toEqual(PRIVATE_POLICIES)
  })

  it('adds the owner column an owner-scoped table forgot', () => {
    const parsed = parseBlueprint({ tables: [{ name: 'notes', columns: [{ name: 'body', type: 'text' }] }] })
    if (!parsed.ok) throw new Error(parsed.problems.join(' '))
    const table = parsed.blueprint.tables[0]
    expect(table.ownerColumn).toBe('owner_id')
    expect(table.columns.map((column) => column.name)).toEqual(['body', 'owner_id'])
    expect(parsed.warnings.join(' ')).toContain('owner-scoped')
  })

  it('ignores the columns every table gets anyway, with a word about it', () => {
    const parsed = parseBlueprint({
      tables: [{ name: 'notes', columns: [{ name: 'id', type: 'integer' }, { name: 'body', type: 'text' }] }],
    })
    if (!parsed.ok) throw new Error(parsed.problems.join(' '))
    expect(parsed.blueprint.tables[0].columns.map((column) => column.name)).toEqual(['body', 'owner_id'])
    expect(parsed.warnings.join(' ')).toContain('added automatically')
  })

  it('comes from a sentence, through the planner the canvas uses', () => {
    const blueprint = blueprintFromDescription('a blog with posts and comments', 'Blog')
    expect(blueprint.name).toBe('Blog')
    expect(blueprint.tables.map((table) => table.name)).toEqual(['posts', 'comments'])
    const comments = blueprint.tables.find((table) => table.name === 'comments')!
    expect(comments.columns.find((column) => column.name === 'post_id')?.references?.table).toBe('posts')
    expect(comments.realtime).toBe(true)
  })

  it('round trips through the visual schema', () => {
    const blueprint = blueprintFromDescription('tasks and projects', 'Work')
    const drawn = schemaFromBlueprint(blueprint)
    expect(drawn.tables.map((table) => table.name)).toEqual(blueprint.tables.map((table) => table.name))
    const again = blueprintFromSchema(drawn, { name: 'Work' })
    expect(again.tables.map((table) => table.name)).toEqual(blueprint.tables.map((table) => table.name))
  })

  it('drops a foreign key to a table nobody drew', () => {
    const blueprint = blueprintFromSchema({
      tables: [{ name: 'orders', columns: [{ name: 'alien_id', type: 'number' }] }],
    })
    const column = blueprint.tables[0].columns.find((entry) => entry.name === 'alien_id')!
    expect(column.type).toBe('number')
    expect(column.references).toBeUndefined()
  })
})

describe('the approval gate', () => {
  it('summarises a blueprint in words a person can check', () => {
    const parsed = parseBlueprint({
      tables: [
        { name: 'posts', columns: [{ name: 'title', type: 'text', required: true }], policies: { read: 'public', create: 'authenticated', update: 'owner', delete: 'owner' } },
      ],
      buckets: [{ name: 'avatars', public: true }],
    })
    if (!parsed.ok) throw new Error(parsed.problems.join(' '))
    const summary = summariseBlueprint(parsed.blueprint)

    expect(summary.tables[0].columns).toContain('title (text, required)')
    expect(summary.tables[0].policies).toContain('read: anyone')
    expect(summary.buckets).toEqual(['avatars (public)'])
    expect(summary.cautions).toContain('Anyone on the internet can read posts.')
    expect(summary.cautions.join(' ')).toContain('avatars bucket is public')
  })

  it('says nothing alarming about a locked-down blueprint', () => {
    const summary = summariseBlueprint(blueprintFromDescription('private notes', 'Notes'))
    expect(summary.cautions).toEqual([])
  })

  it('spells every policy word out', () => {
    expect(describePolicies(PRIVATE_POLICIES))
      .toBe('read: the row’s owner; create: any signed-in user; update: the row’s owner; delete: the row’s owner')
  })
})

/* --------------------------------------------------------------- the SQL */

describe('the SQL a blueprint turns into', () => {
  const blueprint: Blueprint = {
    version: BLUEPRINT_VERSION,
    name: 'Shop',
    tables: [
      {
        name: 'orders',
        columns: [
          { name: 'total', type: 'number' },
          { name: 'product_id', type: 'reference', references: { table: 'products', onDelete: 'cascade' } },
          { name: 'owner_id', type: 'reference', references: { table: 'users' } },
        ],
        ownerColumn: 'owner_id',
        indexes: [['owner_id']],
      },
      { name: 'products', columns: [{ name: 'name', type: 'text', required: true, unique: true }] },
    ],
  }

  it('creates a table before the table that references it', () => {
    expect(orderTables(blueprint.tables).map((table) => table.name)).toEqual(['products', 'orders'])
  })

  it('writes Postgres with row-level security on every table', () => {
    const operations = sqlForBlueprint(blueprint, 'postgres')
    const script = scriptFor(operations)
    expect(script).toContain('create table if not exists "products"')
    expect(script).toContain('"name" text not null unique')
    expect(script).toContain('references "products"("id") on delete cascade')
    expect(script).toContain('alter table "orders" enable row level security;')
    expect(script).toContain('create policy "orders_select_owner" on "orders" for select to authenticated using (auth.uid() = "owner_id");')
    expect(script).toContain('create index if not exists "orders_owner_id_idx"')
    // Re-runnable: applying a blueprint twice must not be an error.
    expect(script).toContain('drop policy if exists "orders_select_owner"')
  })

  it('writes SQLite, and admits it has no row-level security', () => {
    const script = scriptFor(sqlForBlueprint(blueprint, 'sqlite'))
    expect(script).toContain('id integer primary key autoincrement')
    expect(script).toContain('SQLite has no row-level security')
    expect(script).not.toContain('enable row level security')
  })

  it('refuses to put anything but an identifier in a statement', () => {
    expect(() => sqlForBlueprint({
      version: BLUEPRINT_VERSION,
      name: 'Bad',
      tables: [{ name: 'orders', columns: [{ name: 'drop table users; --', type: 'text' }] }],
    }, 'postgres')).toThrowError(/is not a column or table name/)
  })

  it('renders a filter as SQL with its values bound, never inlined', () => {
    const { text, values } = filterToSql({
      all: [
        { column: 'status', op: 'eq', value: "o'brien" },
        { any: [{ column: 'total', op: 'gt', value: 100 }, { column: 'rush', op: 'eq', value: true }] },
      ],
    })
    expect(text).toBe('("status" = $1 and ("total" > $2 or "rush" = $3))')
    expect(values).toEqual(["o'brien", 100, true])
  })
})
