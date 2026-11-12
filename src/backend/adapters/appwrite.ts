/**
 * The Appwrite adapter.
 *
 * Open source, self-hostable, and the closest thing in the catalogue to
 * PocketBase with a team behind it: databases of collections, accounts
 * and sessions, buckets, functions, and realtime over a WebSocket.
 *
 * Five places Appwrite does not line up with the contract, and what
 * this file does about each:
 *
 * 1. **A document is not a row.** Appwrite namespaces its own fields
 *    with `$` — `$id`, `$createdAt`, `$permissions` — and a write puts
 *    the user's fields inside a `data` object rather than at the top
 *    level. `rowFromDocument` and `documentData` are the two sides of
 *    that translation, so the canvas keeps saying `row.id` and the
 *    blocks never learn the convention.
 * 2. **Queries are JSON, not parameters.** A filter travels as
 *    `queries[0]={"method":"equal","attribute":"title","values":["ink"]}`.
 *    That is a structure rather than a string, which is a mercy: there
 *    is no escaping to get wrong here, unlike PocketBase's expression
 *    language. What there is instead is a vocabulary that does not
 *    cover everything — Appwrite has no `not` wrapper — so a negated
 *    test is inverted operator by operator and refuses out loud when it
 *    cannot be.
 * 3. **Two kinds of credential, and never both at once.** A session
 *    secret acts as the signed-in person; an API key acts as the
 *    server and, when both are sent, wins — which would make
 *    `GET /account` answer "missing scope" for a user who is in fact
 *    signed in. So every call picks one: `admin: true` for the handful
 *    of operations that are genuinely administrative, the session for
 *    everything else.
 * 4. **A file has an id and a name.** The id is the handle, the name is
 *    what a person typed. A Tungsten path here is `fileId/name`, the
 *    same convention the PocketBase adapter uses, and `publicUrl` reads
 *    the id off the front.
 * 5. **Realtime has no server-side filter.** Channels are per
 *    collection, so `kinds` and `where` are applied as events arrive.
 *    The rows still travel; the handler simply is not called for them.
 *    `since` would be a replay, which Appwrite does not keep, so it is
 *    refused rather than quietly ignored.
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
  type ChangeKind,
  type Filter,
  type HttpSend,
  type ImageTransform,
  type Page,
  type Row,
  type SchemaOperation,
  type SelectOptions,
  type Socket,
  type SortOrder,
  type StoredFile,
  type Subscription,
  type TableChange,
  type TableSubscribeOptions,
  type TungstenBackend,
  type TungstenSession,
  type TungstenUser,
} from '../contract'
import { BLUEPRINT_VERSION, type BlueprintTable, type PolicyRule } from '../blueprint'
import { callJson, defaultSend, defaultSocket, field, join, multipartBody, origin, toBytes } from './http'

export const APPWRITE_INFO: AdapterInfo = {
  id: 'appwrite',
  label: 'Appwrite',
  summary: 'Open source, self-hostable, with databases, auth, storage and functions.',
  status: 'ready',
  fields: [
    { key: 'url', label: 'Endpoint', placeholder: 'https://cloud.appwrite.io/v1' },
    { key: 'projectId', label: 'Project ID' },
    { key: 'databaseId', label: 'Database ID', placeholder: 'default', optional: true },
    { key: 'apiKey', label: 'API key', secret: true, optional: true },
  ],
  capabilities: capabilities({
    auth: { password: true, oauth: true, magicLink: true, roles: true },
    // Relationships come back nested when the schema declares them, but
    // an arbitrary embed is not something a query can ask for here.
    db: { embeds: false, cursorPaging: true, upsert: true, rpc: false, count: true },
    realtime: { tables: true, rooms: false, presence: false, replay: false },
    storage: { buckets: true, signedUrls: true, transforms: true, directUpload: false },
    functions: { deploy: false, invoke: true, webhooks: false },
    // Collections and attributes are created over the API, with a key.
    schema: { create: true, migrate: true, policies: true },
  }),
}

/** Appwrite's own fields, which belong to the document rather than the row. */
const RESERVED = ['$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$collectionId', '$sequence']

/* ---------------------------------------------------------------- filters */

type AppwriteQuery = { method: string; attribute?: string; values?: unknown[] }

const OPERATORS: Record<string, string> = {
  eq: 'equal',
  neq: 'notEqual',
  lt: 'lessThan',
  lte: 'lessThanEqual',
  gt: 'greaterThan',
  gte: 'greaterThanEqual',
}

/** The operator a negated test becomes, where there is one. */
const INVERSE: Record<string, string> = {
  eq: 'neq',
  neq: 'eq',
  lt: 'gte',
  lte: 'gt',
  gt: 'lte',
  gte: 'lt',
  'is-null': 'not-null',
  'not-null': 'is-null',
}

/** The contract's filter tree as one of Appwrite's query objects. */
export function appwriteQueryObject(filter: Filter): AppwriteQuery {
  if ('all' in filter) return { method: 'and', values: filter.all.map(appwriteQueryObject) }
  if ('any' in filter) return { method: 'or', values: filter.any.map(appwriteQueryObject) }
  if ('not' in filter) {
    const inner = filter.not
    // Appwrite has no `not`, so the only honest negation is an inverted
    // operator. Saying so beats sending the un-negated query and
    // returning exactly the rows the user asked to exclude.
    if ('column' in inner && INVERSE[inner.op]) {
      return appwriteQueryObject({ ...inner, op: INVERSE[inner.op] as typeof inner.op })
    }
    throw new BackendError(
      'unsupported',
      'Appwrite has no “not” in its query language, and this test has no opposite to use instead. Rewrite it as the condition you do want.',
    )
  }

  const column = filter.column
  switch (filter.op) {
    case 'is-null': return { method: 'isNull', attribute: column }
    case 'not-null': return { method: 'isNotNull', attribute: column }
    case 'in': {
      // `equal` with several values is Appwrite's `in`: it matches any
      // of them.
      const list = Array.isArray(filter.value) ? filter.value : [filter.value]
      return { method: 'equal', attribute: column, values: list }
    }
    case 'like':
    case 'ilike':
    case 'contains':
      // `contains` is Appwrite's substring test and it is the one that
      // works without a fulltext index. SQL's `%` is not syntax here,
      // so it is stripped rather than matched literally.
      return { method: 'contains', attribute: column, values: [String(filter.value ?? '').replace(/%/g, '')] }
    default:
      return { method: OPERATORS[filter.op] ?? 'equal', attribute: column, values: [filter.value] }
  }
}

/** A filter as the JSON string Appwrite reads out of `queries[n]`. */
export function appwriteQuery(filter: Filter): string {
  return JSON.stringify(appwriteQueryObject(filter))
}

/** `orderAsc`/`orderDesc` entries, one per sort column. */
export function appwriteOrder(order: SortOrder[] | undefined): string[] {
  return (order ?? []).map((entry) => JSON.stringify({
    method: entry.direction === 'desc' ? 'orderDesc' : 'orderAsc',
    attribute: entry.column,
  }))
}

/* -------------------------------------------------------------- documents */

/** An Appwrite document as a plain row: `$id` becomes `id`, and so on. */
export function rowFromDocument(document: Record<string, unknown>): Row {
  const row: Row = {}
  for (const [key, value] of Object.entries(document)) {
    if (!RESERVED.includes(key)) row[key] = value
  }
  row.id = String(document.$id ?? '')
  if (typeof document.$createdAt === 'string') row.created_at = document.$createdAt
  if (typeof document.$updatedAt === 'string') row.updated_at = document.$updatedAt
  return row
}

/**
 * A row as the `data` of a write.
 *
 * Appwrite rejects a write naming an attribute its collection does not
 * have, and `id`/`created_at` are exactly the names the rest of
 * Tungsten uses for fields Appwrite keeps itself. Dropping them here
 * means a round trip -- read a row, edit it, save it -- does not fail
 * on the fields the backend added.
 */
export function documentData(row: Row): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('$') || key === 'id' || key === 'created_at' || key === 'updated_at') continue
    data[key] = value
  }
  return data
}

/* ----------------------------------------------------------------- schema */

/** The attribute endpoint and body for one blueprint column. */
export function appwriteAttribute(column: BlueprintColumn): { kind: string; body: Record<string, unknown> } {
  const base = { key: column.name, required: Boolean(column.required) }
  switch (column.type) {
    case 'number':
      return { kind: 'float', body: base }
    case 'integer':
      return { kind: 'integer', body: base }
    case 'boolean':
      return { kind: 'boolean', body: base }
    case 'timestamp':
      return { kind: 'datetime', body: base }
    case 'reference':
      return {
        kind: 'relationship',
        body: {
          key: column.name,
          relatedCollectionId: column.references?.table ?? '',
          type: 'manyToOne',
          twoWay: false,
          onDelete: 'setNull',
        },
      }
    case 'json':
    case 'uuid':
    case 'text':
    default:
      // Appwrite sizes its strings. 255 is its own default for a short
      // attribute; JSON goes in the long one because a blob of it will
      // not fit in a varchar.
      return { kind: 'string', body: { ...base, size: column.type === 'json' ? 16_384 : 255 } }
  }
}

/** Blueprint policies as the permission strings a collection carries. */
export function appwritePermissions(table: BlueprintTable): string[] {
  const policies = table.policies
  const permissions: string[] = []
  const role = (rule: PolicyRule | undefined): string | undefined => {
    switch (rule) {
      case 'public': return 'any'
      case 'authenticated': return 'users'
      // Appwrite checks ownership per document, through the
      // permissions written onto the document itself, so a collection
      // level rule for `owner` is "signed-in people" plus document
      // security -- which `apply` turns on.
      case 'owner': return 'users'
      case 'admin': return 'team:admin'
      default: return undefined
    }
  }
  for (const [action, rule] of [
    ['read', policies?.read],
    ['create', policies?.create],
    ['update', policies?.update],
    ['delete', policies?.delete],
  ] as const) {
    const who = role(rule)
    if (who) permissions.push(`${action}("${who}")`)
  }
  return permissions
}

function blueprintType(attribute: Record<string, unknown>): BlueprintColumn['type'] {
  switch (String(attribute.type)) {
    case 'integer': return 'integer'
    case 'double': case 'float': return 'number'
    case 'boolean': return 'boolean'
    case 'datetime': return 'timestamp'
    case 'relationship': return 'reference'
    default: return 'text'
  }
}

/* ------------------------------------------------------------------ live */

/** Does this change match the filter the subscriber asked for? */
export function matchesFilter(row: Row, filter: Filter): boolean {
  if ('all' in filter) return filter.all.every((entry) => matchesFilter(row, entry))
  if ('any' in filter) return filter.any.some((entry) => matchesFilter(row, entry))
  if ('not' in filter) return !matchesFilter(row, filter.not)

  const value = row[filter.column]
  const wanted = filter.value
  switch (filter.op) {
    case 'is-null': return value === null || value === undefined
    case 'not-null': return value !== null && value !== undefined
    case 'in': return (Array.isArray(wanted) ? wanted : [wanted]).some((entry) => String(entry) === String(value))
    case 'like':
    case 'ilike':
    case 'contains':
      return String(value ?? '').toLowerCase().includes(String(wanted ?? '').replace(/%/g, '').toLowerCase())
    case 'neq': return String(value) !== String(wanted)
    case 'lt': return Number(value) < Number(wanted)
    case 'lte': return Number(value) <= Number(wanted)
    case 'gt': return Number(value) > Number(wanted)
    case 'gte': return Number(value) >= Number(wanted)
    default: return String(value) === String(wanted)
  }
}

/** `databases.x.collections.y.documents.z.create` → `insert`. */
export function changeKind(events: unknown): ChangeKind | undefined {
  const list = Array.isArray(events) ? events.map(String) : []
  if (list.some((event) => event.endsWith('.create'))) return 'insert'
  if (list.some((event) => event.endsWith('.update'))) return 'update'
  if (list.some((event) => event.endsWith('.delete'))) return 'delete'
  return undefined
}

/* ------------------------------------------------------------- the adapter */

function create(config: AdapterConfig): TungstenBackend {
  const url = (field(config, 'url') ?? '').replace(/\/+$/, '')
  const projectId = field(config, 'projectId') ?? ''
  if (!url || !projectId) {
    throw new BackendError(
      'invalid',
      'Appwrite needs its endpoint and a project id, such as https://cloud.appwrite.io/v1 and 65f0c2a1b3d4.',
    )
  }
  const databaseId = field(config, 'databaseId') || 'default'
  const apiKey = field(config, 'apiKey')
  const send: HttpSend = config.http ?? defaultSend()
  let token = field(config, 'token')

  /** The account a magic link was sent to, so `exchange` can finish it. */
  let pendingUser: string | undefined
  const sockets = new Set<Socket>()

  const call = <T>(path: string, init: {
    method?: string
    body?: unknown
    raw?: Uint8Array | string
    headers?: Record<string, string>
    admin?: boolean
    queries?: string[]
    query?: Record<string, string | undefined>
  } = {}) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) search.set(key, value)
    }
    // Appwrite reads an array parameter as queries[0], queries[1], …
    ;(init.queries ?? []).forEach((entry, index) => search.set(`queries[${index}]`, entry))

    return callJson<T>(send, {
      url: `${join(url, path)}${search.toString() ? `?${search}` : ''}`,
      method: init.method,
      headers: {
        'x-appwrite-project': projectId,
        // One credential or the other, never both: a key beside a
        // session makes the call the server rather than the person.
        ...(init.admin && apiKey ? { 'x-appwrite-key': apiKey } : token ? { 'x-appwrite-session': token } : {}),
        ...init.headers,
      },
      body: init.body,
      raw: init.raw,
    })
  }

  const documents = (table: string) =>
    `databases/${encodeURIComponent(databaseId)}/collections/${encodeURIComponent(table)}/documents`

  const collections = `databases/${encodeURIComponent(databaseId)}/collections`

  const requireKey = (what: string) => {
    if (!apiKey) {
      throw new BackendError(
        'unauthorized',
        `Appwrite only lets a server key ${what}. Add an API key in the backend settings; it stays in the project and never reaches a built app.`,
      )
    }
  }

  const userFrom = (account: Record<string, unknown>): TungstenUser => ({
    id: String(account.$id ?? ''),
    email: typeof account.email === 'string' ? account.email : undefined,
    name: typeof account.name === 'string' ? account.name : undefined,
    metadata: typeof account.prefs === 'object' && account.prefs ? account.prefs as Record<string, unknown> : {},
    roles: Array.isArray(account.labels) ? account.labels.map(String) : undefined,
    createdAt: typeof account.$createdAt === 'string' ? account.$createdAt : undefined,
  })

  /** Keeps the session secret, then reads the account it belongs to. */
  const sessionFrom = async (session: Record<string, unknown>): Promise<TungstenSession> => {
    const secret = session.secret
    if (typeof secret !== 'string' || !secret) {
      throw new BackendError(
        'unknown',
        'Appwrite answered a sign-in without a session secret. A browser SDK would have taken the cookie instead; Tungsten needs the secret, which means the project must allow it.',
      )
    }
    token = secret
    const account = await call<Record<string, unknown>>('account')
    return {
      token: secret,
      user: userFrom(account),
      expiresAt: typeof session.expire === 'string' ? session.expire : undefined,
    }
  }

  const select = async (table: string, options?: SelectOptions): Promise<Page> => {
    const queries: string[] = []
    if (options?.columns?.length) queries.push(JSON.stringify({ method: 'select', values: options.columns }))
    if (options?.where) queries.push(appwriteQuery(options.where))
    queries.push(...appwriteOrder(options?.order))
    if (options?.limit !== undefined) queries.push(JSON.stringify({ method: 'limit', values: [options.limit] }))
    if (options?.offset) queries.push(JSON.stringify({ method: 'offset', values: [options.offset] }))
    // A cursor is cheaper than an offset on a long table, and Appwrite
    // has one, so a caller that passes both gets the cursor.
    if (options?.cursor) queries.push(JSON.stringify({ method: 'cursorAfter', values: [options.cursor] }))

    const reply = await call<{ documents?: Array<Record<string, unknown>>; total?: number }>(documents(table), { queries })
    const rows = (reply.documents ?? []).map(rowFromDocument)
    const last = reply.documents?.[reply.documents.length - 1]
    return {
      rows,
      ...(options?.count ? { total: reply.total ?? rows.length } : {}),
      // Only when the page was full: a short page is the last one, and a
      // cursor on it would ask for rows that do not exist.
      ...(options?.limit !== undefined && rows.length === options.limit && last
        ? { cursor: String(last.$id) }
        : {}),
    }
  }

  return {
    info: APPWRITE_INFO,

    auth: {
      useToken: (next) => { token = next },

      signUp: async (input) => {
        // `unique()` asks Appwrite for the id rather than inventing one
        // here, which is also how its own SDKs spell it.
        await call<Record<string, unknown>>('account', {
          method: 'POST',
          body: {
            userId: 'unique()',
            email: input.email,
            password: input.password,
            ...(input.name ? { name: input.name } : {}),
          },
        })
        // Creating an account does not start a session, so the
        // contract's "sign-up hands back a session" is honoured by
        // signing in rather than by returning half of one.
        const session = await sessionFrom(await call<Record<string, unknown>>('account/sessions/email', {
          method: 'POST',
          body: { email: input.email, password: input.password },
        }))
        if (input.metadata) {
          const account = await call<Record<string, unknown>>('account/prefs', {
            method: 'PATCH',
            body: { prefs: input.metadata },
          })
          return { ...session, user: userFrom(account) }
        }
        return session
      },

      signIn: async (email, password) => sessionFrom(await call<Record<string, unknown>>('account/sessions/email', {
        method: 'POST',
        body: { email, password },
      })),

      signOut: async () => {
        if (token) {
          try {
            await call('account/sessions/current', { method: 'DELETE' })
          } catch (error) {
            // A session the server has already dropped is still a
            // signed-out user, not a failure to report.
            if (!(error instanceof BackendError) || error.code !== 'unauthorized') throw error
          }
        }
        token = undefined
      },

      session: async () => {
        if (!token) return undefined
        try {
          const account = await call<Record<string, unknown>>('account')
          return { token, user: userFrom(account) }
        } catch (error) {
          if (error instanceof BackendError && (error.code === 'unauthorized' || error.code === 'forbidden')) {
            token = undefined
            return undefined
          }
          throw error
        }
      },

      refresh: async (refreshToken) => {
        // Appwrite extends a session rather than exchanging a refresh
        // token for a new one, so the secret that comes back may be the
        // same string. The caller does not have to care.
        token = refreshToken
        return sessionFrom(await call<Record<string, unknown>>('account/sessions/current', { method: 'PATCH' }))
      },

      oauthUrl: async (provider, redirectTo) => {
        const search = new URLSearchParams({
          project: projectId,
          success: redirectTo,
          failure: redirectTo,
        })
        return `${join(url, `account/sessions/oauth2/${encodeURIComponent(provider)}`)}?${search}`
      },

      magicLink: async (email, redirectTo) => {
        const reply = await call<{ userId?: string }>('account/tokens/magic-url', {
          method: 'POST',
          body: { userId: 'unique()', email, url: redirectTo },
        })
        // The reply names the account the link belongs to, and
        // `exchange` needs it alongside the secret from the URL.
        pendingUser = reply.userId
      },

      exchange: async (code) => {
        if (!pendingUser) {
          throw new BackendError(
            'invalid',
            'Send the magic link with the email block first: Appwrite needs the user id from that round trip as well as the secret in the link.',
          )
        }
        return sessionFrom(await call<Record<string, unknown>>('account/sessions/token', {
          method: 'POST',
          body: { userId: pendingUser, secret: code },
        }))
      },

      updateUser: async (patch) => {
        let account: Record<string, unknown> | undefined
        if (patch.name !== undefined) {
          account = await call<Record<string, unknown>>('account/name', { method: 'PATCH', body: { name: patch.name } })
        }
        if (patch.metadata !== undefined) {
          account = await call<Record<string, unknown>>('account/prefs', {
            method: 'PATCH',
            body: { prefs: patch.metadata },
          })
        }
        if (patch.password !== undefined) {
          // Appwrite wants the old password too for an account that has
          // one; its refusal says so, and passing it through is more
          // use than a sentence invented here.
          account = await call<Record<string, unknown>>('account/password', {
            method: 'PATCH',
            body: { password: patch.password },
          })
        }
        return userFrom(account ?? await call<Record<string, unknown>>('account'))
      },

      setRoles: async (userId, roles) => {
        requireKey('change another user’s labels')
        const account = await call<Record<string, unknown>>(`users/${encodeURIComponent(userId)}/labels`, {
          method: 'PUT',
          admin: true,
          body: { labels: roles },
        })
        return userFrom(account)
      },
    },

    db: {
      select,

      find: async (table, id) => {
        try {
          return rowFromDocument(await call<Record<string, unknown>>(
            `${documents(table)}/${encodeURIComponent(String(id))}`,
          ))
        } catch (error) {
          if (error instanceof BackendError && error.code === 'not-found') return undefined
          throw error
        }
      },

      insert: async (table, row) => {
        const rows = Array.isArray(row) ? row : [row]
        const saved: Row[] = []
        for (const entry of rows) {
          saved.push(rowFromDocument(await call<Record<string, unknown>>(documents(table), {
            method: 'POST',
            body: { documentId: typeof entry.id === 'string' && entry.id ? entry.id : 'unique()', data: documentData(entry) },
          })))
        }
        return saved
      },

      update: async (table, id, changes) => rowFromDocument(await call<Record<string, unknown>>(
        `${documents(table)}/${encodeURIComponent(String(id))}`,
        { method: 'PATCH', body: { data: documentData(changes) } },
      )),

      updateWhere: async (table, where, changes) => {
        const page = await select(table, { where, columns: ['$id'] })
        for (const row of page.rows) {
          await call(`${documents(table)}/${encodeURIComponent(String(row.id))}`, {
            method: 'PATCH',
            body: { data: documentData(changes) },
          })
        }
        return page.rows.length
      },

      remove: async (table, id) => {
        await call(`${documents(table)}/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      },

      removeWhere: async (table, where) => {
        const page = await select(table, { where, columns: ['$id'] })
        for (const row of page.rows) {
          await call(`${documents(table)}/${encodeURIComponent(String(row.id))}`, { method: 'DELETE' })
        }
        return page.rows.length
      },

      upsert: async (table, row, onConflict) => {
        if (onConflict?.length) {
          throw new BackendError(
            'unsupported',
            'Appwrite upserts on the document id, not on a column of your choosing. Read the row first if the match is on something else.',
          )
        }
        const rows = Array.isArray(row) ? row : [row]
        const saved: Row[] = []
        for (const entry of rows) {
          const id = entry.id
          if (typeof id !== 'string' || !id) {
            throw new BackendError(
              'invalid',
              'An Appwrite upsert needs the row’s id: that is what it matches on. A row without one is an insert.',
            )
          }
          saved.push(rowFromDocument(await call<Record<string, unknown>>(
            `${documents(table)}/${encodeURIComponent(id)}`,
            { method: 'PUT', body: { data: documentData(entry) } },
          )))
        }
        return saved
      },

      count: async (table, where) => {
        const reply = await call<{ total?: number }>(documents(table), {
          queries: [
            ...(where ? [appwriteQuery(where)] : []),
            JSON.stringify({ method: 'limit', values: [1] }),
          ],
        })
        return reply.total ?? 0
      },
    },

    realtime: {
      table: async (table, handler, options) => appwriteChannel(config, {
        url,
        projectId,
        databaseId,
        tokenOf: () => token,
        remember: (socket) => sockets.add(socket),
      }).watch(table, handler, options),

      room: async () => {
        throw unsupported('host broadcast rooms', 'Appwrite')
      },

      disconnect: async () => {
        for (const socket of sockets) socket.close()
        sockets.clear()
      },
    },

    storage: {
      buckets: async () => {
        requireKey('list buckets')
        const reply = await call<{ buckets?: Array<Record<string, unknown>> }>('storage/buckets', { admin: true })
        return (reply.buckets ?? []).map((bucket): BucketInfo => ({
          name: String(bucket.$id ?? bucket.name ?? ''),
          public: Array.isArray(bucket.$permissions)
            ? bucket.$permissions.some((entry) => String(entry) === 'read("any")')
            : false,
          maxBytes: typeof bucket.maximumFileSize === 'number' ? bucket.maximumFileSize : undefined,
          allow: Array.isArray(bucket.allowedFileExtensions) ? bucket.allowedFileExtensions.map(String) : undefined,
        }))
      },

      createBucket: async (bucket) => {
        requireKey('create a bucket')
        const created = await call<Record<string, unknown>>('storage/buckets', {
          method: 'POST',
          admin: true,
          body: {
            bucketId: bucket.name,
            name: bucket.name,
            permissions: bucket.public ? ['read("any")', 'create("users")'] : ['read("users")', 'create("users")'],
            ...(bucket.maxBytes ? { maximumFileSize: bucket.maxBytes } : {}),
            ...(bucket.allow?.length ? { allowedFileExtensions: bucket.allow } : {}),
          },
        })
        return { name: String(created.$id ?? bucket.name), public: bucket.public }
      },

      removeBucket: async (name) => {
        requireKey('delete a bucket')
        await call(`storage/buckets/${encodeURIComponent(name)}`, { method: 'DELETE', admin: true })
      },

      upload: async (input) => {
        const bytes = await toBytes(input.data)
        const name = input.path.split('/').pop() || input.path
        const { body, contentType } = multipartBody([
          { name: 'fileId', value: 'unique()' },
          { name: 'file', filename: name, data: bytes, contentType: input.contentType },
        ])
        const file = await call<Record<string, unknown>>(
          `storage/buckets/${encodeURIComponent(input.bucket)}/files`,
          { method: 'POST', raw: body, headers: { 'content-type': contentType } },
        )
        const id = String(file.$id ?? '')
        return {
          bucket: input.bucket,
          path: `${id}/${String(file.name ?? name)}`,
          url: `${join(url, `storage/buckets/${encodeURIComponent(input.bucket)}/files/${encodeURIComponent(id)}/view`)}?project=${encodeURIComponent(projectId)}`,
          size: typeof file.sizeOriginal === 'number' ? file.sizeOriginal : bytes.length,
          contentType: typeof file.mimeType === 'string' ? file.mimeType : input.contentType,
        }
      },

      remove: async (bucket, path) => {
        await call(
          `storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileIdOf(path))}`,
          { method: 'DELETE' },
        )
      },

      list: async (bucket, prefix) => {
        const reply = await call<{ files?: Array<Record<string, unknown>> }>(
          `storage/buckets/${encodeURIComponent(bucket)}/files`,
        )
        return (reply.files ?? [])
          .map((file): StoredFile => ({
            bucket,
            path: `${String(file.$id ?? '')}/${String(file.name ?? '')}`,
            url: `${join(url, `storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(String(file.$id ?? ''))}/view`)}?project=${encodeURIComponent(projectId)}`,
            size: typeof file.sizeOriginal === 'number' ? file.sizeOriginal : undefined,
            contentType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
          }))
          .filter((file) => !prefix || file.path.startsWith(prefix) || file.path.split('/')[1]?.startsWith(prefix))
      },

      publicUrl: (bucket, path, transform) => {
        const id = encodeURIComponent(fileIdOf(path))
        const search = new URLSearchParams({ project: projectId, ...previewParams(transform) })
        const kind = transform ? 'preview' : 'view'
        return `${join(url, `storage/buckets/${encodeURIComponent(bucket)}/files/${id}/${kind}`)}?${search}`
      },

      signedUrl: async (bucket, path, seconds, transform) => {
        requireKey('issue a link to a private file')
        const expire = new Date(Date.now() + seconds * 1000).toISOString()
        const reply = await call<{ secret?: string }>(
          `tokens/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileIdOf(path))}`,
          { method: 'POST', admin: true, body: { expire } },
        )
        if (!reply.secret) {
          throw new BackendError('unknown', 'Appwrite issued a file token without a secret in it.')
        }
        const search = new URLSearchParams({
          project: projectId,
          token: reply.secret,
          ...previewParams(transform),
        })
        const kind = transform ? 'preview' : 'view'
        return `${join(url, `storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileIdOf(path))}/${kind}`)}?${search}`
      },
    },

    functions: {
      list: async () => {
        requireKey('list functions')
        const reply = await call<{ functions?: Array<Record<string, unknown>> }>('functions', { admin: true })
        return (reply.functions ?? []).map((entry) => ({
          name: String(entry.$id ?? entry.name ?? ''),
          runtime: String(entry.runtime ?? '').startsWith('node') ? 'node' as const : 'js' as const,
          updatedAt: typeof entry.$updatedAt === 'string' ? entry.$updatedAt : undefined,
        }))
      },

      deploy: async () => {
        throw new BackendError(
          'unsupported',
          'Appwrite deploys a function from a tarball through its CLI, which is a build step rather than an API call. Write the function here and deploy it with `appwrite deploy function`.',
        )
      },

      invoke: async (name, payload) => {
        const execution = await call<Record<string, unknown>>(
          `functions/${encodeURIComponent(name)}/executions`,
          {
            method: 'POST',
            body: {
              ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
              async: false,
            },
          },
        )
        const answer = execution.responseBody
        if (typeof answer !== 'string' || !answer) return undefined
        try {
          return JSON.parse(answer) as unknown
        } catch {
          // A function is allowed to answer with plain text.
          return answer
        }
      },

      remove: async (name) => {
        requireKey('delete a function')
        await call(`functions/${encodeURIComponent(name)}`, { method: 'DELETE', admin: true })
      },

      webhooks: {
        list: async () => { throw appwriteWebhooks() },
        register: async () => { throw appwriteWebhooks() },
        remove: async () => { throw appwriteWebhooks() },
      },
    },

    schema: {
      inspect: async () => {
        requireKey('read the collection list')
        const reply = await call<{ collections?: Array<Record<string, unknown>> }>(collections, { admin: true })
        return {
          version: BLUEPRINT_VERSION,
          name: 'Appwrite',
          tables: (reply.collections ?? []).map((collection) => ({
            name: String(collection.$id ?? collection.name ?? ''),
            columns: (Array.isArray(collection.attributes) ? collection.attributes : [])
              .map((raw) => raw as Record<string, unknown>)
              .map((attribute) => ({
                name: String(attribute.key ?? ''),
                type: blueprintType(attribute),
                required: Boolean(attribute.required),
              })),
            policies: policiesFrom(Array.isArray(collection.$permissions) ? collection.$permissions.map(String) : []),
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
            statement: `POST /databases/${databaseId}/collections  {"collectionId":"${table.name}","name":"${table.name}"}`,
          })
          for (const column of table.columns) {
            const attribute = appwriteAttribute(column)
            operations.push({
              kind: 'add-column',
              subject: `${table.name}.${column.name}`,
              statement: `POST …/collections/${table.name}/attributes/${attribute.kind}  ${JSON.stringify(attribute.body)}`,
            })
          }
          operations.push({
            kind: 'policy',
            subject: `${table.name} permissions`,
            statement: appwritePermissions(table).join(', ') || 'nobody but a server key',
          })
        }
        return {
          operations,
          problems: apiKey
            ? []
            : ['Appwrite only lets a server key create collections. Add an API key in the Backend tab.'],
          mode: apiKey ? 'apply' : 'script',
        }
      },

      apply: async (blueprint) => {
        requireKey('create or change collections')
        const existing = await call<{ collections?: Array<Record<string, unknown>> }>(collections, { admin: true })
        const known = new Set((existing.collections ?? []).map((entry) => String(entry.$id ?? entry.name ?? '')))
        const operations: SchemaOperation[] = []

        // Collections first, every one of them, so a relationship in
        // the second pass always has something to point at. One pass
        // would fail on the first forward reference.
        for (const table of blueprint.tables) {
          if (known.has(table.name)) continue
          await call(collections, {
            method: 'POST',
            admin: true,
            body: {
              collectionId: table.name,
              name: table.name,
              permissions: appwritePermissions(table),
              // Per-document permissions are what makes an `owner`
              // policy mean anything here.
              documentSecurity: table.policies?.read === 'owner'
                || table.policies?.update === 'owner'
                || table.policies?.delete === 'owner',
            },
          })
          known.add(table.name)
          operations.push({ kind: 'create-table', subject: table.name, statement: `created collection ${table.name}` })
        }

        for (const table of blueprint.tables) {
          const current = await call<{ attributes?: Array<Record<string, unknown>> }>(
            `${collections}/${encodeURIComponent(table.name)}/attributes`,
            { admin: true },
          )
          const have = new Set((current.attributes ?? []).map((attribute) => String(attribute.key ?? '')))
          for (const column of table.columns) {
            if (have.has(column.name)) continue
            const attribute = appwriteAttribute(column)
            await call(`${collections}/${encodeURIComponent(table.name)}/attributes/${attribute.kind}`, {
              method: 'POST',
              admin: true,
              body: attribute.body,
            })
            operations.push({
              kind: 'add-column',
              subject: `${table.name}.${column.name}`,
              statement: `${attribute.kind} attribute ${column.name}`,
            })
          }
        }

        return { operations, problems: [], mode: 'apply' }
      },

      policies: async (table) => {
        requireKey('read collection permissions')
        const collection = await call<Record<string, unknown>>(
          `${collections}/${encodeURIComponent(table)}`,
          { admin: true },
        )
        const permissions = Array.isArray(collection.$permissions) ? collection.$permissions.map(String) : []
        const security = collection.documentSecurity
          ? ['documentSecurity: on — each document also carries its own permissions']
          : []
        return [...(permissions.length ? permissions : ['no collection permissions: a server key only']), ...security]
      },
    },

    health: async () => {
      try {
        // `/health` belongs to the server API, so a project without a
        // key is checked with `/locale`, which any client may call.
        const reply = await call<{ version?: string; country?: string }>(apiKey ? 'health/version' : 'locale', {
          admin: Boolean(apiKey),
        })
        return {
          ok: true,
          detail: reply.version ? `Appwrite ${reply.version} at ${origin(url)}.` : `Reached ${origin(url)}.`,
        }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/* ------------------------------------------------------------ the socket */

type ChannelContext = {
  url: string
  projectId: string
  databaseId: string
  tokenOf: () => string | undefined
  remember: (socket: Socket) => void
}

/**
 * One collection's changes, over Appwrite's realtime socket.
 *
 * The channel is named in the URL — there is no join frame — so a
 * subscription is a socket, and closing it is unsubscribing. The one
 * frame worth sending is the authentication one: without it the server
 * only sends what a guest may read, which for most projects is nothing.
 */
function appwriteChannel(config: AdapterConfig, context: ChannelContext) {
  const open = config.openSocket ?? defaultSocket()

  return {
    watch(
      table: string,
      handler: (change: TableChange) => void,
      options?: TableSubscribeOptions,
    ): Subscription {
      if (options?.since) {
        throw new BackendError(
          'unsupported',
          'Appwrite does not keep a change log, so a subscription cannot replay from a cursor. It starts from now.',
        )
      }

      const channel = `databases.${context.databaseId}.collections.${table}.documents`
      const endpoint = `${context.url.replace(/^http/, 'ws')}/realtime?project=${
        encodeURIComponent(context.projectId)
      }&channels[]=${encodeURIComponent(channel)}`
      const socket = open(endpoint)
      context.remember(socket)
      let cursor: string | undefined

      socket.addEventListener('message', (event) => {
        const frame = parseFrame(event.data)
        if (!frame) return
        const data = (frame.data ?? {}) as Record<string, unknown>

        if (frame.type === 'connected') {
          const session = context.tokenOf()
          if (session) socket.send(JSON.stringify({ type: 'authentication', data: { session } }))
          return
        }
        if (frame.type !== 'event') return

        const kind = changeKind(data.events)
        if (!kind) return
        if (options?.kinds && !options.kinds.includes(kind)) return

        const row = rowFromDocument((data.payload ?? {}) as Record<string, unknown>)
        // There is no server-side filter on a channel, so a `where` is
        // honoured here. The row still travelled; the handler is simply
        // not called for it.
        if (options?.where && !matchesFilter(row, options.where)) return

        cursor = typeof data.timestamp === 'string' ? data.timestamp : cursor
        handler({ kind, table, row, cursor, at: cursor })
      })

      return {
        unsubscribe: async () => { socket.close() },
        cursor: () => cursor,
      }
    },
  }
}

/** One realtime frame, or undefined when it is not one. */
function parseFrame(raw: unknown): { type: string; data?: unknown } | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown }
    return typeof parsed.type === 'string' ? { type: parsed.type, data: parsed.data } : undefined
  } catch {
    return undefined
  }
}

/* ----------------------------------------------------------------- bits */

function appwriteWebhooks(): BackendError {
  return new BackendError(
    'unsupported',
    'Appwrite webhooks are a project setting rather than an API, so they are created in its console. Point one at your endpoint there.',
  )
}

/** `fileId/name` → `fileId`. A bare id is accepted too. */
function fileIdOf(path: string): string {
  const trimmed = path.replace(/^\/+/, '')
  return trimmed.split('/')[0] || trimmed
}

/** A transform as Appwrite's preview parameters. */
function previewParams(transform: ImageTransform | undefined): Record<string, string> {
  if (!transform) return {}
  const params: Record<string, string> = {}
  if (transform.width) params.width = String(transform.width)
  if (transform.height) params.height = String(transform.height)
  if (transform.quality) params.quality = String(transform.quality)
  if (transform.format && transform.format !== 'origin') params.output = transform.format
  // Appwrite crops from a gravity point; `contain` is its only
  // non-cropping fit, and it spells that as no gravity at all.
  if (transform.fit === 'cover') params.gravity = 'center'
  return params
}

/** Collection permissions as the blueprint's four rules. */
function policiesFrom(permissions: string[]): BlueprintTable['policies'] {
  const rule = (action: string): PolicyRule => {
    const match = permissions.find((entry) => entry.startsWith(`${action}(`))
    if (!match) return 'nobody'
    if (match.includes('"any"')) return 'public'
    if (match.includes('team:admin')) return 'admin'
    return 'authenticated'
  }
  return { read: rule('read'), create: rule('create'), update: rule('update'), delete: rule('delete') }
}

export const appwriteAdapter: BackendAdapter = { info: APPWRITE_INFO, create }
