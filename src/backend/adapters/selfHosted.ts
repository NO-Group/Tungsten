/**
 * The self-hosted adapter — Tungsten's own generated service.
 *
 * This is the "Custom / Self-Hosted" option in the dropdown, and it is
 * not a stub: it speaks exactly the routes `src/builder/targets/server.ts`
 * emits, which is the Node + SQLite service the Build the Backend
 * Service command writes and the Run command starts. Point it at
 * `http://localhost:8787` and the canvas is talking to a database on
 * the user's own machine, with no account anywhere.
 *
 * It is also the proof that the contract is not shaped around any
 * vendor. This backend is the least capable of the three implemented
 * ones — no realtime, no edge functions, no row-level security because
 * SQLite has none — and it says so in `capabilities` rather than
 * failing at runtime. A user who needs presence will see presence
 * greyed out with a sentence naming the backends that have it.
 *
 * The same adapter serves a VPS: the field is a URL, so "my own box" and
 * "localhost" are the same case. What it will not do is pretend to be a
 * generic REST mapper — guessing somebody's bespoke endpoints from a
 * dropdown is how you get an adapter that works for nobody.
 */

import {
  BackendError,
  capabilities,
  unsupported,
  type AdapterConfig,
  type AdapterInfo,
  type BackendAdapter,
  type Filter,
  type HttpSend,
  type Page,
  type Row,
  type SelectOptions,
  type TungstenBackend,
  type TungstenSession,
  type TungstenUser,
} from '../contract'
import { sqlForBlueprint } from '../sql'
import { callJson, defaultSend, field, isTest, join } from './http'

export const SELF_HOSTED_INFO: AdapterInfo = {
  id: 'self-hosted',
  label: 'Custom / Self-hosted',
  summary: 'The Node + SQLite service Tungsten generates, on your machine or your own server.',
  status: 'ready',
  fields: [
    { key: 'url', label: 'Server URL', placeholder: 'http://localhost:8787' },
    { key: 'token', label: 'Session token', secret: true, optional: true },
  ],
  capabilities: capabilities({
    auth: { password: true, oauth: true, magicLink: false, roles: false },
    db: { embeds: false, cursorPaging: false, upsert: false, rpc: false, count: false },
    realtime: { tables: false, rooms: false, presence: false, replay: false },
    storage: { buckets: false, signedUrls: false, transforms: false, directUpload: false },
    functions: { deploy: false, invoke: false, webhooks: false },
    schema: { create: true, migrate: false, policies: false },
  }),
}

/**
 * Filters, client-side.
 *
 * The generated service takes `?column=value` equality and nothing
 * else, by design — it is 700 lines of zero-dependency Node, and a
 * query language was never the point. Rather than refuse everything
 * else, equality tests go to the server and the rest is applied to the
 * rows that come back, which is honest for the row counts this backend
 * is for and documented here so nobody is surprised by it at a million
 * rows.
 */
export function splitFilter(filter: Filter | undefined): {
  params: Array<[string, string]>
  rest?: Filter
} {
  if (!filter) return { params: [] }
  if (isTest(filter)) {
    return filter.op === 'eq' && filter.value !== undefined && !Array.isArray(filter.value)
      ? { params: [[filter.column, String(filter.value)]] }
      : { params: [], rest: filter }
  }
  if ('all' in filter) {
    const params: Array<[string, string]> = []
    const rest: Filter[] = []
    for (const part of filter.all) {
      const split = splitFilter(part)
      params.push(...split.params)
      if (split.rest) rest.push(split.rest)
    }
    return rest.length ? { params, rest: { all: rest } } : { params }
  }
  return { params: [], rest: filter }
}

/** Applies what the server could not. */
export function matches(row: Row, filter: Filter): boolean {
  if ('all' in filter) return filter.all.every((part) => matches(row, part))
  if ('any' in filter) return filter.any.some((part) => matches(row, part))
  if ('not' in filter) return !matches(row, filter.not)

  const value = row[filter.column]
  switch (filter.op) {
    case 'eq': return String(value) === String(filter.value)
    case 'neq': return String(value) !== String(filter.value)
    case 'lt': return Number(value) < Number(filter.value)
    case 'lte': return Number(value) <= Number(filter.value)
    case 'gt': return Number(value) > Number(filter.value)
    case 'gte': return Number(value) >= Number(filter.value)
    case 'like': return String(value).includes(String(filter.value).replace(/%/g, ''))
    case 'ilike': return String(value).toLowerCase().includes(String(filter.value).replace(/%/g, '').toLowerCase())
    case 'in': return (Array.isArray(filter.value) ? filter.value : []).some((entry) => String(entry) === String(value))
    case 'contains': return String(value).includes(String(filter.value))
    case 'is-null': return value === null || value === undefined
    case 'not-null': return value !== null && value !== undefined
  }
}

function create(config: AdapterConfig): TungstenBackend {
  const url = (field(config, 'url') ?? '').replace(/\/+$/, '')
  if (!url) throw new BackendError('invalid', 'This backend needs the address of your server, such as http://localhost:8787.')
  const send: HttpSend = config.http ?? defaultSend()
  let token = field(config, 'token')

  const headers = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

  const call = <T>(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array | string; headers?: Record<string, string> } = {}) =>
    callJson<T>(send, {
      url: join(url, path),
      method: init.method,
      headers: { ...headers(), ...init.headers },
      body: init.body,
      raw: init.raw,
    })

  const userFrom = (raw: Record<string, unknown>): TungstenUser => ({
    id: String(raw.id ?? ''),
    email: typeof raw.email === 'string' ? raw.email : undefined,
    metadata: {},
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  })

  const sessionFrom = (payload: Record<string, unknown>): TungstenSession => {
    const access = payload.token
    const user = payload.user as Record<string, unknown> | undefined
    if (typeof access !== 'string' || !user) {
      throw new BackendError('unknown', 'The server answered a sign-in without a session in it.')
    }
    token = access
    return { token: access, user: userFrom(user) }
  }

  const select = async (table: string, options?: SelectOptions): Promise<Page> => {
    const { params, rest } = splitFilter(options?.where)
    const search = new URLSearchParams(params)
    const suffix = search.toString() ? `?${search.toString()}` : ''
    const reply = await call<{ rows?: Row[] }>(`data/${encodeURIComponent(table)}${suffix}`)
    let rows = reply.rows ?? []
    if (rest) rows = rows.filter((row) => matches(row, rest))
    if (options?.order?.length) {
      const [first] = options.order
      const direction = first.direction === 'desc' ? -1 : 1
      rows = [...rows].sort((left, right) => (
        String(left[first.column] ?? '').localeCompare(String(right[first.column] ?? '')) * direction
      ))
    }
    const offset = options?.offset ?? 0
    const limited = options?.limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + options.limit)
    return options?.count ? { rows: limited, total: rows.length } : { rows: limited }
  }

  return {
    info: SELF_HOSTED_INFO,

    auth: {
      useToken: (next) => { token = next },
      signUp: async (input) => sessionFrom(await call<Record<string, unknown>>('auth/sign-up', {
        method: 'POST',
        body: { email: input.email, password: input.password },
      })),
      signIn: async (email, password) => sessionFrom(await call<Record<string, unknown>>('auth/sign-in', {
        method: 'POST',
        body: { email, password },
      })),
      signOut: async () => {
        await call('auth/sign-out', { method: 'POST' })
        token = undefined
      },
      session: async () => {
        if (!token) return undefined
        const reply = await call<{ user?: Record<string, unknown> }>('auth/session')
        return reply.user ? { token, user: userFrom(reply.user) } : undefined
      },
      refresh: async () => { throw unsupported('refresh a session', 'This server') },
      oauthUrl: async (provider, redirectTo) => (
        `${join(url, 'auth/oauth')}?provider=${encodeURIComponent(provider)}&redirect=${encodeURIComponent(redirectTo)}`
      ),
      magicLink: async () => { throw unsupported('send magic links', 'This server') },
      exchange: async (code) => sessionFrom(await call<Record<string, unknown>>('auth/oauth', {
        method: 'POST',
        body: { code },
      })),
      updateUser: async () => { throw unsupported('edit a user', 'This server') },
      setRoles: async () => { throw unsupported('store roles', 'This server') },
    },

    db: {
      select,
      find: async (table, id) => {
        try {
          const reply = await call<{ row?: Row }>(`data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`)
          return reply.row
        } catch (error) {
          if (error instanceof BackendError && error.code === 'not-found') return undefined
          throw error
        }
      },
      insert: async (table, row) => {
        const rows = Array.isArray(row) ? row : [row]
        const saved: Row[] = []
        for (const entry of rows) {
          const reply = await call<{ row?: Row }>(`data/${encodeURIComponent(table)}`, { method: 'POST', body: entry })
          if (reply.row) saved.push(reply.row)
        }
        return saved
      },
      update: async (table, id, changes) => {
        const reply = await call<{ row?: Row }>(`data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, {
          method: 'PATCH',
          body: changes,
        })
        if (!reply.row) throw new BackendError('not-found', `No row with id ${id} in ${table}.`)
        return reply.row
      },
      updateWhere: async (table, where, changes) => {
        // No bulk endpoint, so it is a read and a loop — correct, slow,
        // and only ever pointed at a SQLite file on one machine.
        const page = await select(table, { where })
        for (const row of page.rows) {
          await call(`data/${encodeURIComponent(table)}/${encodeURIComponent(String(row.id))}`, {
            method: 'PATCH',
            body: changes,
          })
        }
        return page.rows.length
      },
      remove: async (table, id) => {
        await call(`data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      },
      removeWhere: async (table, where) => {
        const page = await select(table, { where })
        for (const row of page.rows) {
          await call(`data/${encodeURIComponent(table)}/${encodeURIComponent(String(row.id))}`, { method: 'DELETE' })
        }
        return page.rows.length
      },
      upsert: async () => { throw unsupported('upsert', 'This server') },
      count: async (table, where) => (await select(table, { where })).rows.length,
    },

    realtime: {
      table: async () => { throw unsupported('stream row changes', 'This server') },
      room: async () => { throw unsupported('host realtime rooms', 'This server') },
      disconnect: async () => undefined,
    },

    storage: {
      buckets: async () => { throw unsupported('list buckets', 'This server') },
      createBucket: async (bucket) => bucket,
      removeBucket: async () => { throw unsupported('delete a bucket', 'This server') },
      upload: async (input) => {
        const reply = await call<{ url?: string; name?: string; size?: number }>(
          `storage/${encodeURIComponent(input.bucket)}`,
          {
            method: 'POST',
            raw: typeof input.data === 'string' || input.data instanceof Uint8Array
              ? input.data
              : new Uint8Array(await input.data.arrayBuffer()),
            headers: {
              'content-type': input.contentType ?? 'application/octet-stream',
              'x-file-name': input.path,
            },
          },
        )
        return {
          bucket: input.bucket,
          path: reply.name ?? input.path,
          url: reply.url ?? join(url, `storage/${input.bucket}/${reply.name ?? input.path}`),
          size: reply.size,
          contentType: input.contentType,
        }
      },
      remove: async () => { throw unsupported('delete a stored file', 'This server') },
      list: async () => { throw unsupported('list stored files', 'This server') },
      publicUrl: (bucket, path) => join(url, `storage/${bucket}/${path.replace(/^\/+/, '')}`),
      signedUrl: async () => { throw unsupported('sign a URL', 'This server') },
    },

    functions: {
      list: async () => { throw unsupported('host functions', 'This server') },
      deploy: async () => { throw unsupported('host functions', 'This server') },
      invoke: async () => { throw unsupported('host functions', 'This server') },
      remove: async () => { throw unsupported('host functions', 'This server') },
      webhooks: {
        list: async () => { throw unsupported('host webhooks', 'This server') },
        register: async () => { throw unsupported('host webhooks', 'This server') },
        remove: async () => { throw unsupported('host webhooks', 'This server') },
      },
    },

    schema: {
      inspect: async () => { throw unsupported('report its own schema', 'This server') },
      // The service applies `schema.sql` at every boot, so the plan is
      // the file Tungsten already writes next to it.
      plan: async (blueprint) => ({
        operations: sqlForBlueprint(blueprint, 'sqlite'),
        problems: [],
        mode: 'script',
      }),
      apply: async () => {
        throw new BackendError(
          'unsupported',
          'This server applies schema.sql when it starts. Rebuild the Backend Service target and restart it to pick up the new tables.',
        )
      },
      policies: async () => [],
    },

    health: async () => {
      try {
        await call('health')
        return { ok: true, detail: `Reached ${url}.` }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export const selfHostedAdapter: BackendAdapter = { info: SELF_HOSTED_INFO, create }
