/**
 * The PocketBase adapter.
 *
 * One Go binary, SQLite inside it, a collections API on top. It is the
 * backend for somebody who wants the whole thing on one small server
 * with no account anywhere, and unlike Tungsten's own generated
 * service it brings real auth, file handling and a schema API with it.
 *
 * Three places PocketBase does not line up with the contract, and what
 * this file does about each:
 *
 * 1. **Filters are a string DSL, not parameters.** PocketBase's REST
 *    API takes `filter=(title~'ink' && done=true)` — there is no
 *    binding on the wire, only in their SDKs. So `pocketbaseFilter`
 *    renders literals itself and escapes them properly; the escaping
 *    is tested against quotes and backslashes rather than assumed,
 *    because this is the one place in the adapter where a user's typed
 *    value becomes syntax.
 * 2. **Files belong to records, not to buckets.** There is no bucket
 *    to create. The honest mapping, and the one every PocketBase
 *    project uses, is a collection whose records hold a `file` field,
 *    so a Tungsten bucket is a collection and a path is
 *    `recordId/filename`. That convention is stated here, in the panel
 *    and in the returned `StoredFile`, not buried.
 * 3. **Realtime is Server-Sent Events.** The contract carries an HTTP
 *    sender and a WebSocket opener; it has no streaming-response
 *    transport, so PocketBase's `/api/realtime` cannot be reached
 *    through it. `capabilities.realtime` is therefore all false and
 *    the methods throw a sentence that says why rather than a
 *    connection error that does not.
 */

import {
  BackendError,
  capabilities,
  unsupported,
  type AdapterConfig,
  type AdapterInfo,
  type BackendAdapter,
  type Blueprint,
  type BlueprintColumn,
  type BucketInfo,
  type Filter,
  type HttpSend,
  type ImageTransform,
  type Page,
  type Row,
  type SchemaOperation,
  type SelectOptions,
  type SortOrder,
  type StoredFile,
  type TungstenBackend,
  type TungstenSession,
  type TungstenUser,
} from '../contract'
import { BLUEPRINT_VERSION, DEFAULT_OWNER_COLUMN, type BlueprintTable, type PolicyRule } from '../blueprint'
import { callJson, defaultSend, field, join, multipartBody, origin, toBytes } from './http'

export const POCKETBASE_INFO: AdapterInfo = {
  id: 'pocketbase',
  label: 'PocketBase',
  summary: 'One Go binary with SQLite, auth, files and a collections API.',
  status: 'ready',
  fields: [
    { key: 'url', label: 'Server URL', placeholder: 'http://127.0.0.1:8090' },
    { key: 'collection', label: 'Users collection', placeholder: 'users', optional: true },
    { key: 'adminToken', label: 'Superuser token', secret: true, optional: true },
  ],
  capabilities: capabilities({
    auth: { password: true, oauth: true, magicLink: false, roles: true },
    db: { embeds: true, cursorPaging: false, upsert: false, rpc: false, count: true },
    // Server-Sent Events, which this transport layer does not carry.
    realtime: { tables: false, rooms: false, presence: false, replay: false },
    storage: { buckets: false, signedUrls: true, transforms: true, directUpload: false },
    functions: { deploy: false, invoke: false, webhooks: false },
    // Collections are created and altered over the API, with a superuser token.
    schema: { create: true, migrate: true, policies: true },
  }),
}

/* ---------------------------------------------------------------- filters */

/**
 * A value as PocketBase filter syntax.
 *
 * Single quotes are the string delimiter, so a quote inside a value
 * has to be escaped or the expression ends early — which is both a
 * broken query and the shape of an injection. Backslashes go first,
 * for the usual reason.
 */
export function pocketbaseLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `'${text}'`
}

/** A field name PocketBase will accept, or a refusal. */
function identifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
    throw new BackendError('invalid', `“${name}” is not a field name Tungsten will put in a PocketBase filter.`)
  }
  return name
}

/** The contract's filter tree as PocketBase's expression language. */
export function pocketbaseFilter(filter: Filter): string {
  if ('all' in filter) {
    return filter.all.length ? `(${filter.all.map(pocketbaseFilter).join(' && ')})` : 'true'
  }
  if ('any' in filter) {
    return filter.any.length ? `(${filter.any.map(pocketbaseFilter).join(' || ')})` : 'false'
  }
  if ('not' in filter) return `!(${pocketbaseFilter(filter.not)})`

  const column = identifier(filter.column)
  switch (filter.op) {
    case 'is-null': return `(${column}=null || ${column}='')`
    case 'not-null': return `(${column}!=null && ${column}!='')`
    case 'in': {
      const list = Array.isArray(filter.value) ? filter.value : [filter.value]
      if (!list.length) return 'false'
      return `(${list.map((entry) => `${column}=${pocketbaseLiteral(entry)}`).join(' || ')})`
    }
    // `~` is PocketBase's contains, and it is case-insensitive, so
    // `like` and `ilike` land on the same operator rather than one of
    // them quietly doing something else. The `%` of SQL is not syntax
    // here, so it is stripped instead of being matched literally.
    case 'like':
    case 'ilike':
    case 'contains':
      return `${column}~${pocketbaseLiteral(String(filter.value ?? '').replace(/%/g, ''))}`
    default: {
      const operators: Record<string, string> = { eq: '=', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' }
      return `${column}${operators[filter.op] ?? '='}${pocketbaseLiteral(filter.value)}`
    }
  }
}

/** `-created,title` — PocketBase's sort parameter. */
export function pocketbaseSort(order: SortOrder[] | undefined): string | undefined {
  if (!order?.length) return undefined
  return order.map((entry) => `${entry.direction === 'desc' ? '-' : ''}${identifier(entry.column)}`).join(',')
}

/* ----------------------------------------------------------------- schema */

const FIELD_TYPE: Record<BlueprintColumn['type'], string> = {
  text: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'bool',
  timestamp: 'date',
  json: 'json',
  uuid: 'text',
  reference: 'relation',
}

/** One blueprint column as a PocketBase field definition. */
export function pocketbaseField(column: BlueprintColumn, collectionIds: Record<string, string>) {
  const base: Record<string, unknown> = {
    name: column.name,
    type: FIELD_TYPE[column.type],
    required: Boolean(column.required),
  }
  if (column.unique) base.unique = true
  if (column.type === 'reference') {
    // A relation needs the id of the collection it points at. When the
    // target has not been created yet the caller fills this in on the
    // second pass rather than this function inventing an id.
    base.collectionId = column.references ? collectionIds[column.references.table] : undefined
    base.maxSelect = 1
  }
  return base
}

/* ------------------------------------------------------------------ rows */

/** PocketBase's `$`-free record, with `expand` flattened onto the row. */
function rowFrom(record: Record<string, unknown>, embedNames: Record<string, string> = {}): Row {
  const { expand, ...rest } = record
  const row: Row = { ...rest }
  if (expand && typeof expand === 'object') {
    for (const [key, value] of Object.entries(expand as Record<string, unknown>)) {
      row[embedNames[key] ?? key] = value
    }
  }
  return row
}

function create(config: AdapterConfig): TungstenBackend {
  const url = (field(config, 'url') ?? '').replace(/\/+$/, '')
  if (!url) {
    throw new BackendError('invalid', 'PocketBase needs the address it is served from, such as http://127.0.0.1:8090.')
  }
  const users = field(config, 'collection') || 'users'
  const adminToken = field(config, 'adminToken')
  const send: HttpSend = config.http ?? defaultSend()
  let token = field(config, 'token')

  /** The last OAuth round trip this adapter started, so `exchange` can finish it. */
  let pendingOauth: { provider: string; codeVerifier: string; redirectTo: string } | undefined

  const call = <T>(path: string, init: {
    method?: string
    body?: unknown
    raw?: Uint8Array | string
    headers?: Record<string, string>
    admin?: boolean
    query?: Record<string, string | undefined>
  } = {}) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) search.set(key, value)
    }
    const bearer = init.admin ? adminToken ?? token : token
    return callJson<T>(send, {
      url: `${join(url, path)}${search.toString() ? `?${search}` : ''}`,
      method: init.method,
      headers: { ...(bearer ? { authorization: bearer } : {}), ...init.headers },
      body: init.body,
      raw: init.raw,
    })
  }

  const records = (collection: string) => `api/collections/${encodeURIComponent(collection)}/records`

  const userFrom = (record: Record<string, unknown>): TungstenUser => ({
    id: String(record.id ?? ''),
    email: typeof record.email === 'string' ? record.email : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    metadata: typeof record.metadata === 'object' && record.metadata ? record.metadata as Record<string, unknown> : {},
    roles: Array.isArray(record.roles) ? record.roles.map(String) : undefined,
    createdAt: typeof record.created === 'string' ? record.created : undefined,
  })

  const sessionFrom = (payload: Record<string, unknown>): TungstenSession => {
    const access = payload.token
    const record = payload.record as Record<string, unknown> | undefined
    if (typeof access !== 'string' || !record) {
      throw new BackendError('unknown', 'PocketBase answered a sign-in without a token and record in it.')
    }
    token = access
    return { token: access, user: userFrom(record) }
  }

  const requireAdmin = (what: string) => {
    if (!adminToken) {
      throw new BackendError(
        'unauthorized',
        `PocketBase only lets a superuser ${what}. Add a superuser token in the backend settings.`,
      )
    }
  }

  const select = async (table: string, options?: SelectOptions): Promise<Page> => {
    const embedNames: Record<string, string> = {}
    for (const embed of options?.embed ?? []) {
      embedNames[embed.foreignKey ?? embed.table] = embed.as ?? embed.table
    }

    // PocketBase pages rather than offsets. A limit that divides the
    // offset exactly is a page; anything else is read from the top and
    // sliced, which is honest about the cost instead of silently
    // returning the wrong rows.
    const limit = options?.limit
    const offset = options?.offset ?? 0
    const aligned = limit !== undefined && offset % limit === 0
    const perPage = limit === undefined ? undefined : aligned ? limit : limit + offset

    const reply = await call<{ items?: Array<Record<string, unknown>>; totalItems?: number }>(records(table), {
      query: {
        filter: options?.where ? pocketbaseFilter(options.where) : undefined,
        sort: pocketbaseSort(options?.order),
        expand: Object.keys(embedNames).join(',') || undefined,
        fields: options?.columns?.length ? options.columns.join(',') : undefined,
        perPage: perPage === undefined ? undefined : String(perPage),
        page: aligned ? String(offset / (limit ?? 1) + 1) : undefined,
        skipTotal: options?.count ? undefined : 'true',
      },
    })

    const all = (reply.items ?? []).map((item) => rowFrom(item, embedNames))
    const rows = aligned ? all : all.slice(offset)
    return options?.count ? { rows, total: reply.totalItems ?? rows.length } : { rows }
  }

  return {
    info: POCKETBASE_INFO,

    auth: {
      useToken: (next) => { token = next },

      signUp: async (input) => {
        await call<Record<string, unknown>>(records(users), {
          method: 'POST',
          body: {
            email: input.email,
            password: input.password,
            passwordConfirm: input.password,
            ...(input.name ? { name: input.name } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          },
        })
        // PocketBase creates the record without signing it in, so the
        // contract's "sign-up returns a session" is honoured by logging
        // straight in rather than by handing back half a session.
        return sessionFrom(await call<Record<string, unknown>>(
          `api/collections/${encodeURIComponent(users)}/auth-with-password`,
          { method: 'POST', body: { identity: input.email, password: input.password } },
        ))
      },

      signIn: async (email, password) => sessionFrom(await call<Record<string, unknown>>(
        `api/collections/${encodeURIComponent(users)}/auth-with-password`,
        { method: 'POST', body: { identity: email, password } },
      )),

      signOut: async () => { token = undefined },

      session: async () => {
        if (!token) return undefined
        try {
          return sessionFrom(await call<Record<string, unknown>>(
            `api/collections/${encodeURIComponent(users)}/auth-refresh`,
            { method: 'POST' },
          ))
        } catch (error) {
          // An expired token is "nobody is signed in", not a failure.
          if (error instanceof BackendError && (error.code === 'unauthorized' || error.code === 'forbidden')) {
            token = undefined
            return undefined
          }
          throw error
        }
      },

      refresh: async (refreshToken) => {
        token = refreshToken
        return sessionFrom(await call<Record<string, unknown>>(
          `api/collections/${encodeURIComponent(users)}/auth-refresh`,
          { method: 'POST' },
        ))
      },

      oauthUrl: async (provider, redirectTo) => {
        const reply = await call<{ authProviders?: Array<Record<string, unknown>>; oauth2?: { providers?: Array<Record<string, unknown>> } }>(
          `api/collections/${encodeURIComponent(users)}/auth-methods`,
        )
        const list = reply.oauth2?.providers ?? reply.authProviders ?? []
        const match = list.find((entry) => entry.name === provider)
        if (!match) {
          const names = list.map((entry) => String(entry.name)).join(', ')
          throw new BackendError(
            'invalid',
            names
              ? `This PocketBase has no “${provider}” provider configured. It offers ${names}.`
              : `This PocketBase has no OAuth providers configured yet.`,
          )
        }
        // The code verifier belongs to this round trip and is needed to
        // finish it, so it is held until `exchange` rather than thrown
        // away and asked for again.
        pendingOauth = {
          provider: String(match.name),
          codeVerifier: String(match.codeVerifier ?? ''),
          redirectTo,
        }
        const separator = String(match.authURL ?? match.authUrl ?? '').includes('?') ? '' : '?'
        return `${match.authURL ?? match.authUrl}${separator}${encodeURIComponent(redirectTo)}`
      },

      magicLink: async () => {
        throw new BackendError(
          'unsupported',
          'PocketBase emails a one-time code rather than a link, which is a different flow from the one this block performs.',
        )
      },

      exchange: async (code) => {
        if (!pendingOauth) {
          throw new BackendError(
            'invalid',
            'Start the sign-in with the OAuth block first: PocketBase needs the code verifier from the same round trip.',
          )
        }
        return sessionFrom(await call<Record<string, unknown>>(
          `api/collections/${encodeURIComponent(users)}/auth-with-oauth2`,
          {
            method: 'POST',
            body: {
              provider: pendingOauth.provider,
              code,
              codeVerifier: pendingOauth.codeVerifier,
              redirectUrl: pendingOauth.redirectTo,
            },
          },
        ))
      },

      updateUser: async (patch) => {
        const session = await call<{ record?: Record<string, unknown> }>(
          `api/collections/${encodeURIComponent(users)}/auth-refresh`,
          { method: 'POST' },
        )
        const id = session.record?.id
        if (!id) throw new BackendError('unauthorized', 'Nobody is signed in, so there is no user to edit.')
        const record = await call<Record<string, unknown>>(`${records(users)}/${encodeURIComponent(String(id))}`, {
          method: 'PATCH',
          body: {
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
            ...(patch.password === undefined ? {} : { password: patch.password, passwordConfirm: patch.password }),
          },
        })
        return userFrom(record)
      },

      setRoles: async (userId, roles) => {
        requireAdmin('change another user’s roles')
        const record = await call<Record<string, unknown>>(`${records(users)}/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          body: { roles },
          admin: true,
        })
        return userFrom(record)
      },
    },

    db: {
      select,

      find: async (table, id, options) => {
        const embedNames: Record<string, string> = {}
        for (const embed of options?.embed ?? []) embedNames[embed.foreignKey ?? embed.table] = embed.as ?? embed.table
        try {
          const record = await call<Record<string, unknown>>(`${records(table)}/${encodeURIComponent(String(id))}`, {
            query: {
              expand: Object.keys(embedNames).join(',') || undefined,
              fields: options?.columns?.length ? options.columns.join(',') : undefined,
            },
          })
          return rowFrom(record, embedNames)
        } catch (error) {
          if (error instanceof BackendError && error.code === 'not-found') return undefined
          throw error
        }
      },

      insert: async (table, row) => {
        const rows = Array.isArray(row) ? row : [row]
        const saved: Row[] = []
        for (const entry of rows) {
          saved.push(rowFrom(await call<Record<string, unknown>>(records(table), { method: 'POST', body: entry })))
        }
        return saved
      },

      update: async (table, id, changes) => rowFrom(await call<Record<string, unknown>>(
        `${records(table)}/${encodeURIComponent(String(id))}`,
        { method: 'PATCH', body: changes },
      )),

      updateWhere: async (table, where, changes) => {
        const page = await select(table, { where, columns: ['id'] })
        for (const row of page.rows) {
          await call(`${records(table)}/${encodeURIComponent(String(row.id))}`, { method: 'PATCH', body: changes })
        }
        return page.rows.length
      },

      remove: async (table, id) => {
        await call(`${records(table)}/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      },

      removeWhere: async (table, where) => {
        const page = await select(table, { where, columns: ['id'] })
        for (const row of page.rows) {
          await call(`${records(table)}/${encodeURIComponent(String(row.id))}`, { method: 'DELETE' })
        }
        return page.rows.length
      },

      upsert: async () => {
        throw new BackendError(
          'unsupported',
          'PocketBase has no upsert. Read the row first, then insert or update — or add a unique index and handle the 400.',
        )
      },

      count: async (table, where) => {
        const reply = await call<{ totalItems?: number }>(records(table), {
          query: {
            filter: where ? pocketbaseFilter(where) : undefined,
            perPage: '1',
            fields: 'id',
          },
        })
        return reply.totalItems ?? 0
      },
    },

    realtime: {
      table: async () => {
        throw new BackendError(
          'unsupported',
          'PocketBase streams changes over Server-Sent Events, which Tungsten’s backend transports do not carry yet. Vortex and Supabase both stream over WebSockets.',
        )
      },
      room: async () => {
        throw unsupported('host broadcast rooms', 'PocketBase')
      },
      disconnect: async () => undefined,
    },

    storage: {
      // A bucket is a collection here, and collections are schema, so
      // listing and creating them is the schema API's job rather than
      // something storage invents at runtime.
      buckets: async () => {
        requireAdmin('list collections')
        const reply = await call<{ items?: Array<Record<string, unknown>> }>('api/collections', {
          admin: true,
          query: { perPage: '200' },
        })
        return (reply.items ?? [])
          .filter((item) => item.type !== 'view')
          .map((item): BucketInfo => ({ name: String(item.name), public: false }))
      },
      createBucket: async () => {
        throw new BackendError(
          'unsupported',
          'In PocketBase a bucket is a collection with a file field. Create it in the Data tab and apply the schema, rather than at run time.',
        )
      },
      removeBucket: async () => {
        throw new BackendError(
          'unsupported',
          'Deleting a bucket here would delete a whole collection and its rows. Do that in the PocketBase admin UI, deliberately.',
        )
      },

      upload: async (input) => {
        const bytes = await toBytes(input.data)
        const name = input.path.split('/').pop() || input.path
        const { body, contentType } = multipartBody([
          { name: 'file', filename: name, data: bytes, contentType: input.contentType },
        ])
        const record = await call<Record<string, unknown>>(records(input.bucket), {
          method: 'POST',
          raw: body,
          headers: { 'content-type': contentType },
        })
        const stored = Array.isArray(record.file) ? String(record.file[0]) : String(record.file ?? name)
        return {
          bucket: input.bucket,
          path: `${record.id}/${stored}`,
          url: join(url, `api/files/${input.bucket}/${record.id}/${stored}`),
          size: bytes.length,
          contentType: input.contentType,
        }
      },

      remove: async (bucket, path) => {
        const [recordId] = path.split('/')
        if (!recordId) throw new BackendError('invalid', 'A PocketBase file path is “recordId/filename”.')
        await call(`${records(bucket)}/${encodeURIComponent(recordId)}`, { method: 'DELETE' })
      },

      list: async (bucket, prefix) => {
        const reply = await call<{ items?: Array<Record<string, unknown>> }>(records(bucket), {
          query: { perPage: '200' },
        })
        return (reply.items ?? []).flatMap((item): StoredFile[] => {
          const names = Array.isArray(item.file) ? item.file.map(String) : item.file ? [String(item.file)] : []
          return names
            .filter((name) => !prefix || `${item.id}/${name}`.startsWith(prefix) || name.startsWith(prefix))
            .map((name) => ({
              bucket,
              path: `${item.id}/${name}`,
              url: join(url, `api/files/${bucket}/${item.id}/${name}`),
            }))
        })
      },

      publicUrl: (bucket, path, transform) => {
        const base = join(url, `api/files/${bucket}/${path.replace(/^\/+/, '')}`)
        const thumb = thumbParam(transform)
        return thumb ? `${base}?thumb=${thumb}` : base
      },

      signedUrl: async (bucket, path, seconds, transform) => {
        // PocketBase issues one short-lived token for the caller rather
        // than a URL per object; its lifetime is a server setting, so
        // the requested seconds cannot be honoured and saying so beats
        // returning a URL that outlives what the caller asked for.
        const reply = await call<{ token?: string }>('api/files/token', { method: 'POST' })
        if (!reply.token) throw new BackendError('unauthorized', 'PocketBase refused a file token; sign in first.')
        const thumb = thumbParam(transform)
        const query = new URLSearchParams({ token: reply.token, ...(thumb ? { thumb } : {}) })
        void seconds
        return `${join(url, `api/files/${bucket}/${path.replace(/^\/+/, '')}`)}?${query}`
      },
    },

    functions: {
      list: async () => { throw pocketbaseFunctions() },
      deploy: async () => { throw pocketbaseFunctions() },
      invoke: async () => { throw pocketbaseFunctions() },
      remove: async () => { throw pocketbaseFunctions() },
      webhooks: {
        list: async () => { throw pocketbaseFunctions() },
        register: async () => { throw pocketbaseFunctions() },
        remove: async () => { throw pocketbaseFunctions() },
      },
    },

    schema: {
      inspect: async () => {
        requireAdmin('read the collection list')
        const reply = await call<{ items?: Array<Record<string, unknown>> }>('api/collections', {
          admin: true,
          query: { perPage: '200' },
        })
        return {
          version: BLUEPRINT_VERSION,
          name: 'PocketBase',
          tables: (reply.items ?? [])
            .filter((item) => item.type === 'base' || item.type === 'auth')
            .map((item) => ({
              name: String(item.name),
              columns: fieldsOf(item).map((entry) => ({
                name: String(entry.name),
                type: blueprintType(String(entry.type)),
                required: Boolean(entry.required),
                unique: Boolean(entry.unique),
              })),
              policies: {
                read: item.listRule === null ? 'nobody' : item.listRule === '' ? 'public' : 'authenticated',
                create: item.createRule === null ? 'nobody' : item.createRule === '' ? 'public' : 'authenticated',
                update: item.updateRule === null ? 'nobody' : item.updateRule === '' ? 'public' : 'authenticated',
                delete: item.deleteRule === null ? 'nobody' : item.deleteRule === '' ? 'public' : 'authenticated',
              },
            })),
          buckets: [],
          functions: [],
        } satisfies Blueprint
      },

      plan: async (blueprint) => {
        const operations: SchemaOperation[] = []
        for (const table of blueprint.tables) {
          operations.push({
            kind: 'create-table',
            subject: table.name,
            statement: `POST /api/collections  {"name":"${table.name}","type":"base","fields":[${
              table.columns.map((column) => `"${column.name}:${FIELD_TYPE[column.type]}"`).join(',')
            }]}`,
          })
          operations.push({
            kind: 'policy',
            subject: `${table.name} rules`,
            statement: `listRule/viewRule/createRule/updateRule/deleteRule from the blueprint’s policies`,
          })
        }
        return {
          operations,
          problems: adminToken ? [] : ['PocketBase only lets a superuser create collections. Add a superuser token in the Backend tab.'],
          mode: adminToken ? 'apply' : 'script',
        }
      },

      apply: async (blueprint) => {
        requireAdmin('create or change collections')
        const existing = await call<{ items?: Array<Record<string, unknown>> }>('api/collections', {
          admin: true,
          query: { perPage: '200' },
        })
        const ids: Record<string, string> = {}
        for (const item of existing.items ?? []) ids[String(item.name)] = String(item.id)

        const operations: SchemaOperation[] = []
        // Two passes: every collection is created first, so a relation
        // field in the second pass always has an id to point at. A
        // single pass would fail on the first forward reference.
        for (const table of blueprint.tables) {
          if (ids[table.name]) continue
          const created = await call<Record<string, unknown>>('api/collections', {
            method: 'POST',
            admin: true,
            body: { name: table.name, type: 'base', fields: [] },
          })
          ids[table.name] = String(created.id)
          operations.push({ kind: 'create-table', subject: table.name, statement: `created collection ${table.name}` })
        }

        for (const table of blueprint.tables) {
          await call(`api/collections/${encodeURIComponent(ids[table.name])}`, {
            method: 'PATCH',
            admin: true,
            body: {
              fields: table.columns.map((column) => pocketbaseField(column, ids)),
              ...ruleSet(table),
            },
          })
          for (const column of table.columns) {
            operations.push({ kind: 'add-column', subject: `${table.name}.${column.name}`, statement: `field ${column.name}` })
          }
        }

        return { operations, problems: [], mode: 'apply' }
      },

      policies: async (table) => {
        requireAdmin('read collection rules')
        const reply = await call<{ items?: Array<Record<string, unknown>> }>('api/collections', {
          admin: true,
          query: { filter: `name='${table}'`, perPage: '1' },
        })
        const item = reply.items?.[0]
        if (!item) return []
        return (['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const)
          .map((rule) => `${rule}: ${item[rule] === null ? 'superusers only' : item[rule] === '' ? 'anyone' : String(item[rule])}`)
      },
    },

    health: async () => {
      try {
        const reply = await call<{ message?: string; code?: number }>('api/health')
        return { ok: true, detail: reply.message ? `${origin(url)}: ${reply.message}` : `Reached ${origin(url)}.` }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

function pocketbaseFunctions(): BackendError {
  return new BackendError(
    'unsupported',
    'PocketBase runs JavaScript hooks from files next to the binary, so there is nothing to deploy over the API. Put a hook in pb_hooks and restart it.',
  )
}

/** `100x100` for the `thumb` parameter, when a transform asks for a size. */
function thumbParam(transform: ImageTransform | undefined): string | undefined {
  if (!transform?.width && !transform?.height) return undefined
  const width = transform.width ?? 0
  const height = transform.height ?? 0
  // PocketBase spells the fit in the suffix: `f` fits inside, `t` crops
  // from the top, and a bare `WxH` crops centred.
  return transform.fit === 'contain' ? `${width}x${height}f` : `${width}x${height}`
}

/** v0.23 renamed `schema` to `fields`; both shapes are read. */
function fieldsOf(collection: Record<string, unknown>): Array<Record<string, unknown>> {
  const fields = collection.fields ?? collection.schema
  return Array.isArray(fields) ? fields as Array<Record<string, unknown>> : []
}

function blueprintType(type: string): BlueprintColumn['type'] {
  switch (type) {
    case 'number': return 'number'
    case 'bool': return 'boolean'
    case 'date': case 'autodate': return 'timestamp'
    case 'json': return 'json'
    case 'relation': return 'reference'
    default: return 'text'
  }
}

/**
 * Blueprint policies as PocketBase rules.
 *
 * PocketBase's vocabulary is a filter expression or one of two special
 * values: `null` means superusers only, and an empty string means
 * anyone. `owner` becomes the expression PocketBase documents for it.
 */
function ruleSet(table: BlueprintTable) {
  const policies = table.policies
  const owner = table.ownerColumn ?? DEFAULT_OWNER_COLUMN
  const rule = (value: PolicyRule | undefined) => {
    switch (value) {
      case 'public': return ''
      case 'authenticated': return '@request.auth.id != ""'
      case 'owner': return `@request.auth.id != "" && ${owner} = @request.auth.id`
      case 'admin': return '@request.auth.roles ~ "admin"'
      default: return null
    }
  }
  return {
    listRule: rule(policies?.read),
    viewRule: rule(policies?.read),
    createRule: rule(policies?.create),
    updateRule: rule(policies?.update),
    deleteRule: rule(policies?.delete),
  }
}

export const pocketbaseAdapter: BackendAdapter = { info: POCKETBASE_INFO, create }
