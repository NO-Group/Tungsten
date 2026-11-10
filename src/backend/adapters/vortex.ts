/**
 * The Vortex adapter — our own backend, waiting for its servers.
 *
 * Written now, shipped `preview`, switched to `default` the day the
 * fleet goes live. Writing it before launch is not speculation: it is
 * the proof that the Universal Data Contract is actually universal. An
 * abstraction with one implementation is a wrapper; this is the second
 * implementation, and every place where Vortex and Supabase disagree
 * had to be settled in the contract rather than in a caller.
 *
 * What Vortex does that the launch backend cannot, and why the contract
 * has the shape it does:
 *
 * - **`/v1/sql` is a first-class endpoint.** Schema provisioning is an
 *   API call, so `schema.apply` runs in `apply` mode with no service
 *   key dance and no copy-pasting into a console.
 * - **Policies are compiled, not interpreted.** `/v1/policies` takes
 *   the five policy words directly, so Tungsten sends `owner` and
 *   Vortex compiles the predicate — no string of SQL crosses the wire
 *   for a security rule.
 * - **Realtime is durable.** Every change carries a cursor and the
 *   server keeps a replay window, so `since` resumes instead of
 *   pretending. This is the one capability no other adapter has, and
 *   the reason `TableSubscribeOptions.since` exists at all.
 * - **Storage is R2 behind a gateway**, so `signedUpload` hands the
 *   browser a URL and the bytes never touch Tungsten — which is what
 *   makes the paid media tier cost what it should.
 */

import {
  BackendError,
  capabilities,
  type AdapterConfig,
  type AdapterInfo,
  type BackendAdapter,
  type Blueprint,
  type BroadcastMessage,
  type Filter,
  type HttpSend,
  type ImageTransform,
  type Page,
  type PresenceState,
  type Room,
  type RoomHandlers,
  type Row,
  type SchemaPlan,
  type SelectOptions,
  type Socket,
  type Subscription,
  type TableChange,
  type TableSubscribeOptions,
  type TungstenBackend,
  type TungstenSession,
  type TungstenUser,
} from '../contract'
import { sqlForBlueprint } from '../sql'
import { callJson, defaultSend, field, join } from './http'

/** Where a Vortex project lives until the user says otherwise. */
export const VORTEX_DEFAULT_URL = 'https://api.vortex.dev'

export const VORTEX_INFO: AdapterInfo = {
  id: 'vortex',
  label: 'Vortex',
  summary: 'Tungsten’s own backend: SQL, compiled row policies, durable realtime and R2 storage.',
  status: 'preview',
  fields: [
    { key: 'url', label: 'Region URL', placeholder: VORTEX_DEFAULT_URL, optional: true },
    { key: 'projectKey', label: 'Project key', secret: true },
    { key: 'adminKey', label: 'Admin key (for provisioning)', secret: true, optional: true },
  ],
  capabilities: capabilities({
    auth: { password: true, oauth: true, magicLink: true, roles: true },
    db: { embeds: true, cursorPaging: true, upsert: true, rpc: true, count: true },
    realtime: { tables: true, rooms: true, presence: true, replay: true },
    storage: { buckets: true, signedUrls: true, transforms: true, directUpload: true },
    functions: { deploy: true, invoke: true, webhooks: true },
    schema: { create: true, migrate: true, policies: true },
  }),
}

/**
 * Filters go over the wire as the tree they already are.
 *
 * Supabase needs them flattened into query parameters because PostgREST
 * has its own grammar. Vortex takes the contract's JSON unchanged,
 * which is the whole argument for having made filters data in the first
 * place.
 */
function filterBody(filter: Filter | undefined): Filter | undefined {
  return filter
}

function create(config: AdapterConfig): TungstenBackend {
  const url = (field(config, 'url') ?? VORTEX_DEFAULT_URL).replace(/\/+$/, '')
  const projectKey = field(config, 'projectKey') ?? ''
  if (!projectKey) {
    throw new BackendError('invalid', 'Vortex needs a project key before it can be used.')
  }
  const send: HttpSend = config.http ?? defaultSend()
  const adminKey = field(config, 'adminKey')
  let token: string | undefined

  const headers = (admin = false): Record<string, string> => ({
    'x-vortex-project': projectKey,
    authorization: `Bearer ${admin && adminKey ? adminKey : (token ?? projectKey)}`,
  })

  const call = <T>(path: string, init: { method?: string; body?: unknown; admin?: boolean; raw?: Uint8Array | string; headers?: Record<string, string> } = {}) =>
    callJson<T>(send, {
      url: join(url, path),
      method: init.method,
      headers: { ...headers(init.admin), ...init.headers },
      body: init.body,
      raw: init.raw,
    })

  const sessionFrom = (payload: Record<string, unknown>): TungstenSession => {
    const access = payload.token ?? payload.access_token
    const user = payload.user as Record<string, unknown> | undefined
    if (typeof access !== 'string' || !user) {
      throw new BackendError('unknown', 'Vortex answered a sign-in without a session in it.')
    }
    token = access
    return {
      token: access,
      refreshToken: typeof payload.refresh === 'string' ? payload.refresh : undefined,
      expiresAt: typeof payload.expires_at === 'string' ? payload.expires_at : undefined,
      user: userFrom(user),
    }
  }

  const userFrom = (raw: Record<string, unknown>): TungstenUser => ({
    id: String(raw.id ?? ''),
    email: typeof raw.email === 'string' ? raw.email : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    metadata: (raw.metadata as Record<string, unknown> | undefined) ?? {},
    roles: Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === 'string') : undefined,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  })

  const channels = new Set<VortexChannel>()

  return {
    info: VORTEX_INFO,

    auth: {
      useToken: (next) => { token = next },

      signUp: async (input) => sessionFrom(await call<Record<string, unknown>>('v1/auth/sign-up', {
        method: 'POST',
        body: { email: input.email, password: input.password, name: input.name, metadata: input.metadata },
      })),

      signIn: async (email, password) => sessionFrom(await call<Record<string, unknown>>('v1/auth/sign-in', {
        method: 'POST',
        body: { email, password },
      })),

      signOut: async () => {
        await call('v1/auth/sign-out', { method: 'POST' })
        token = undefined
      },

      session: async () => {
        if (!token) return undefined
        try {
          const reply = await call<Record<string, unknown>>('v1/auth/session')
          const user = reply.user as Record<string, unknown> | undefined
          return user ? { token, user: userFrom(user) } : undefined
        } catch (error) {
          if (error instanceof BackendError && error.code === 'unauthorized') return undefined
          throw error
        }
      },

      refresh: async (refreshToken) => sessionFrom(await call<Record<string, unknown>>('v1/auth/refresh', {
        method: 'POST',
        body: { refresh: refreshToken },
      })),

      oauthUrl: async (provider, redirectTo) => (
        `${join(url, 'v1/auth/oauth')}/${encodeURIComponent(provider)}?project=${encodeURIComponent(projectKey)}&redirect=${encodeURIComponent(redirectTo)}`
      ),

      magicLink: async (email, redirectTo) => {
        await call('v1/auth/magic-link', { method: 'POST', body: { email, redirect: redirectTo } })
      },

      exchange: async (code) => sessionFrom(await call<Record<string, unknown>>('v1/auth/exchange', {
        method: 'POST',
        body: { code },
      })),

      updateUser: async (patch) => userFrom(await call<Record<string, unknown>>('v1/auth/user', {
        method: 'PATCH',
        body: patch,
      })),

      setRoles: async (userId, roles) => userFrom(await call<Record<string, unknown>>(
        `v1/auth/users/${encodeURIComponent(userId)}/roles`,
        { method: 'PUT', body: { roles }, admin: true },
      )),
    },

    db: {
      select: async (table, options) => {
        const reply = await call<{ rows?: Row[]; total?: number; cursor?: string }>(
          `v1/data/${encodeURIComponent(table)}/query`,
          { method: 'POST', body: queryBody(options) },
        )
        const page: Page = { rows: reply.rows ?? [] }
        if (reply.total !== undefined) page.total = reply.total
        if (reply.cursor) page.cursor = reply.cursor
        return page
      },

      find: async (table, id, options) => {
        const params = new URLSearchParams()
        if (options?.columns?.length) params.set('columns', options.columns.join(','))
        if (options?.embed?.length) params.set('embed', options.embed.map((embed) => embed.table).join(','))
        const suffix = params.toString() ? `?${params.toString()}` : ''
        try {
          const reply = await call<{ row?: Row }>(`v1/data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}${suffix}`)
          return reply.row
        } catch (error) {
          if (error instanceof BackendError && error.code === 'not-found') return undefined
          throw error
        }
      },

      insert: async (table, row) => {
        const reply = await call<{ rows?: Row[]; row?: Row }>(`v1/data/${encodeURIComponent(table)}`, {
          method: 'POST',
          body: Array.isArray(row) ? { rows: row } : { row },
        })
        return reply.rows ?? (reply.row ? [reply.row] : [])
      },

      update: async (table, id, changes) => {
        const reply = await call<{ row?: Row }>(`v1/data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, {
          method: 'PATCH',
          body: { changes },
        })
        if (!reply.row) throw new BackendError('not-found', `No row with id ${id} in ${table}.`)
        return reply.row
      },

      updateWhere: async (table, where, changes) => {
        const reply = await call<{ changed?: number }>(`v1/data/${encodeURIComponent(table)}`, {
          method: 'PATCH',
          body: { where: filterBody(where), changes },
        })
        return reply.changed ?? 0
      },

      remove: async (table, id) => {
        await call(`v1/data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      },

      removeWhere: async (table, where) => {
        const reply = await call<{ removed?: number }>(`v1/data/${encodeURIComponent(table)}`, {
          method: 'DELETE',
          body: { where: filterBody(where) },
        })
        return reply.removed ?? 0
      },

      upsert: async (table, row, onConflict) => {
        const reply = await call<{ rows?: Row[] }>(`v1/data/${encodeURIComponent(table)}/upsert`, {
          method: 'POST',
          body: { rows: Array.isArray(row) ? row : [row], onConflict },
        })
        return reply.rows ?? []
      },

      count: async (table, where) => {
        const reply = await call<{ total?: number }>(`v1/data/${encodeURIComponent(table)}/count`, {
          method: 'POST',
          body: { where: filterBody(where) },
        })
        return reply.total ?? 0
      },

      rpc: async (name, args) => call(`v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: args ?? {} }),
    },

    realtime: {
      table: async (table, handler, options) => {
        const channel = openVortexChannel(config, url, projectKey, () => token)
        channels.add(channel)
        return channel.subscribeTable(table, handler, options)
      },
      room: async (name, handlers) => {
        const channel = openVortexChannel(config, url, projectKey, () => token)
        channels.add(channel)
        return channel.joinRoom(name, handlers)
      },
      disconnect: async () => {
        for (const channel of channels) channel.close()
        channels.clear()
      },
    },

    storage: {
      buckets: async () => {
        const reply = await call<{ buckets?: Array<{ name: string; public?: boolean; maxBytes?: number }> }>('v1/storage/buckets')
        return (reply.buckets ?? []).map((bucket) => ({
          name: bucket.name,
          public: Boolean(bucket.public),
          maxBytes: bucket.maxBytes,
        }))
      },

      createBucket: async (bucket) => {
        await call('v1/storage/buckets', { method: 'POST', body: bucket, admin: true })
        return bucket
      },

      removeBucket: async (name) => {
        await call(`v1/storage/buckets/${encodeURIComponent(name)}`, { method: 'DELETE', admin: true })
      },

      upload: async (input) => {
        const reply = await call<{ url?: string; size?: number }>(
          `v1/storage/${encodeURIComponent(input.bucket)}/${encodeURIComponent(input.path)}`,
          {
            method: input.overwrite ? 'PUT' : 'POST',
            raw: typeof input.data === 'string' || input.data instanceof Uint8Array
              ? input.data
              : new Uint8Array(await input.data.arrayBuffer()),
            headers: { 'content-type': input.contentType ?? 'application/octet-stream' },
          },
        )
        return {
          bucket: input.bucket,
          path: input.path,
          url: reply.url ?? join(url, `v1/storage/${input.bucket}/${input.path}`),
          size: reply.size,
          contentType: input.contentType,
        }
      },

      remove: async (bucket, path) => {
        await call(`v1/storage/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`, { method: 'DELETE' })
      },

      list: async (bucket, prefix) => {
        const reply = await call<{ files?: Array<{ path: string; url?: string; size?: number; contentType?: string }> }>(
          `v1/storage/${encodeURIComponent(bucket)}?prefix=${encodeURIComponent(prefix ?? '')}`,
        )
        return (reply.files ?? []).map((file) => ({
          bucket,
          path: file.path,
          url: file.url ?? join(url, `v1/storage/${bucket}/${file.path}`),
          size: file.size,
          contentType: file.contentType,
        }))
      },

      publicUrl: (bucket, path, transform) => {
        const base = join(url, `v1/storage/${bucket}/${path.replace(/^\/+/, '')}`)
        const params = transformParams(transform)
        return params ? `${base}?${params}` : base
      },

      signedUrl: async (bucket, path, seconds, transform) => {
        const reply = await call<{ url?: string }>('v1/storage/sign', {
          method: 'POST',
          body: { bucket, path, seconds, transform },
        })
        if (!reply.url) throw new BackendError('unknown', 'Vortex signed the file but did not return a URL.')
        return reply.url
      },

      // The bytes go straight to R2. This is the difference between a
      // media tier that costs pennies and one that pays for a CDN twice.
      signedUpload: async (bucket, path, seconds) => {
        const reply = await call<{ url?: string; method?: 'PUT' | 'POST' }>('v1/storage/sign-upload', {
          method: 'POST',
          body: { bucket, path, seconds },
        })
        if (!reply.url) throw new BackendError('unknown', 'Vortex did not return an upload URL.')
        return { url: reply.url, method: reply.method ?? 'PUT' }
      },
    },

    functions: {
      list: async () => {
        const reply = await call<{ functions?: Array<{ name: string; runtime: 'js' | 'ts' | 'deno' | 'node' | 'edge'; updatedAt?: string }> }>('v1/functions')
        return reply.functions ?? []
      },
      deploy: async (spec) => {
        await call('v1/functions', { method: 'POST', body: spec, admin: true })
      },
      invoke: async (name, payload) => call(`v1/functions/${encodeURIComponent(name)}/invoke`, {
        method: 'POST',
        body: payload ?? {},
      }),
      remove: async (name) => {
        await call(`v1/functions/${encodeURIComponent(name)}`, { method: 'DELETE', admin: true })
      },
      webhooks: {
        list: async () => {
          const reply = await call<{ webhooks?: Array<{ name: string; table: string; on: Array<'insert' | 'update' | 'delete'>; url: string }> }>('v1/webhooks')
          return reply.webhooks ?? []
        },
        register: async (spec) => {
          await call('v1/webhooks', { method: 'POST', body: spec, admin: true })
        },
        remove: async (name) => {
          await call(`v1/webhooks/${encodeURIComponent(name)}`, { method: 'DELETE', admin: true })
        },
      },
    },

    schema: {
      inspect: async () => {
        const reply = await call<{ blueprint?: Blueprint }>('v1/schema')
        if (!reply.blueprint) throw new BackendError('unknown', 'Vortex returned no schema.')
        return reply.blueprint
      },

      // Vortex plans server-side so the plan accounts for what is
      // already there; the local SQL is the fallback when it cannot.
      plan: async (blueprint) => {
        try {
          const reply = await call<SchemaPlan>('v1/schema/plan', { method: 'POST', body: { blueprint }, admin: true })
          return { operations: reply.operations ?? [], problems: reply.problems ?? [], mode: 'apply' }
        } catch (error) {
          if (!(error instanceof BackendError) || error.code === 'unauthorized') throw error
          return { operations: sqlForBlueprint(blueprint, 'postgres'), problems: [], mode: 'apply' }
        }
      },

      apply: async (blueprint) => {
        const reply = await call<SchemaPlan>('v1/schema/apply', { method: 'POST', body: { blueprint }, admin: true })
        return { operations: reply.operations ?? [], problems: reply.problems ?? [], mode: 'apply' }
      },

      policies: async (table) => {
        const reply = await call<{ policies?: string[] }>(`v1/policies/${encodeURIComponent(table)}`)
        return reply.policies ?? []
      },
    },

    health: async () => {
      try {
        await call('v1/health')
        return { ok: true, detail: `Reached ${new URL(url).host}.` }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/** The contract's select options, as Vortex's query document. */
function queryBody(options: SelectOptions | undefined): Record<string, unknown> {
  return {
    columns: options?.columns,
    where: filterBody(options?.where),
    embed: options?.embed,
    order: options?.order,
    limit: options?.limit,
    offset: options?.offset,
    cursor: options?.cursor,
    count: options?.count,
  }
}

function transformParams(transform: ImageTransform | undefined): string | undefined {
  if (!transform) return undefined
  const params = new URLSearchParams()
  if (transform.width) params.set('w', String(transform.width))
  if (transform.height) params.set('h', String(transform.height))
  if (transform.quality) params.set('q', String(transform.quality))
  if (transform.fit) params.set('fit', transform.fit)
  if (transform.format && transform.format !== 'origin') params.set('f', transform.format)
  return params.toString() || undefined
}

/* --------------------------------------------------------------- realtime */

type VortexChannel = {
  subscribeTable: (table: string, handler: (change: TableChange) => void, options?: TableSubscribeOptions) => Subscription
  joinRoom: (name: string, handlers: RoomHandlers) => Room
  close: () => void
}

/**
 * Vortex's socket, which is a JSON protocol and nothing more.
 *
 * The frames are `{type, …}` rather than Phoenix's four-field envelope,
 * and every change carries a cursor. That cursor is the feature: a
 * client that has been asleep sends `since` on resubscribe and gets the
 * gap replayed, which is why `Subscription.cursor()` exists in the
 * contract even though Supabase can only ever return undefined.
 */
function openVortexChannel(
  config: AdapterConfig,
  url: string,
  projectKey: string,
  tokenOf: () => string | undefined,
): VortexChannel {
  const open = config.openSocket ?? defaultSocket()
  const socket = open(`${url.replace(/^http/, 'ws')}/v1/realtime?project=${encodeURIComponent(projectKey)}`)
  const tableHandlers = new Map<string, (frame: Record<string, unknown>) => void>()
  const roomHandlers = new Map<string, (frame: Record<string, unknown>) => void>()

  const push = (frame: Record<string, unknown>) => socket.send(JSON.stringify({
    ...frame,
    token: tokenOf() ?? projectKey,
  }))

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(event.data) as Record<string, unknown>
    } catch {
      return
    }
    const table = typeof frame.table === 'string' ? frame.table : undefined
    const room = typeof frame.room === 'string' ? frame.room : undefined
    if (table) tableHandlers.get(table)?.(frame)
    if (room) roomHandlers.get(room)?.(frame)
  })

  return {
    close: () => socket.close(),

    subscribeTable(table, handler, options) {
      let cursor = options?.since
      tableHandlers.set(table, (frame) => {
        const kind = frame.change
        if (kind !== 'insert' && kind !== 'update' && kind !== 'delete') return
        if (options?.kinds && !options.kinds.includes(kind)) return
        if (typeof frame.cursor === 'string') cursor = frame.cursor
        handler({
          kind,
          table,
          row: (frame.row ?? {}) as Row,
          previous: frame.previous as Row | undefined,
          cursor: typeof frame.cursor === 'string' ? frame.cursor : undefined,
          at: typeof frame.at === 'string' ? frame.at : undefined,
        })
      })

      push({
        type: 'subscribe',
        table,
        kinds: options?.kinds,
        where: filterBody(options?.where),
        since: options?.since,
      })

      return {
        cursor: () => cursor,
        unsubscribe: async () => {
          push({ type: 'unsubscribe', table })
          tableHandlers.delete(table)
        },
      }
    },

    joinRoom(name, handlers) {
      roomHandlers.set(name, (frame) => {
        if (frame.type === 'broadcast') {
          handlers.onMessage?.({
            event: String(frame.event ?? ''),
            payload: frame.payload,
            from: typeof frame.from === 'string' ? frame.from : undefined,
          } satisfies BroadcastMessage)
          return
        }
        if (frame.type === 'presence') handlers.onPresence?.((frame.state ?? {}) as PresenceState)
        if (frame.type === 'error') {
          handlers.onError?.(new BackendError('unknown', String(frame.message ?? 'The realtime channel reported an error.')))
        }
      })

      push({ type: 'join', room: name })

      return {
        cursor: () => undefined,
        unsubscribe: async () => {
          push({ type: 'leave', room: name })
          roomHandlers.delete(name)
        },
        broadcast: async (event, payload) => push({ type: 'broadcast', room: name, event, payload }),
        track: async (state) => push({ type: 'presence', room: name, action: 'track', state }),
        untrack: async () => push({ type: 'presence', room: name, action: 'untrack' }),
      }
    },
  }
}

function defaultSocket() {
  const Constructor = (globalThis as unknown as { WebSocket?: new (url: string) => Socket }).WebSocket
  if (!Constructor) {
    return () => { throw new BackendError('offline', 'This build has no WebSocket, so realtime is unavailable.') }
  }
  return (endpoint: string) => new Constructor(endpoint)
}

export const vortexAdapter: BackendAdapter = { info: VORTEX_INFO, create }
