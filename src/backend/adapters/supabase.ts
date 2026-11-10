/**
 * The Supabase adapter — the one Tungsten launches on.
 *
 * Free tier, Postgres underneath, and an HTTP surface good enough that
 * none of `@supabase/supabase-js` is needed: PostgREST for data, GoTrue
 * for accounts, the storage API for files, Phoenix channels for
 * realtime, and `/functions/v1` for edge functions. Writing it against
 * the wire rather than the SDK keeps Tungsten dependency-free and keeps
 * every call in this file inspectable in a test.
 *
 * The honest parts, stated once rather than discovered later:
 *
 * - **DDL is not in the public API.** `schema.apply` therefore runs in
 *   `script` mode by default: it produces the SQL, and the user runs it
 *   in the SQL editor. Projects that have installed Tungsten's
 *   `exec_sql` function get `apply` mode automatically.
 * - **Realtime has no replay.** Supabase's channels deliver what
 *   happens while you are connected. `capabilities.realtime.replay` is
 *   false, and `since` is ignored rather than silently dropped --
 *   Vortex is the adapter that resumes.
 * - **Deploying functions needs the Management API and a personal
 *   access token**, which is not something a project should hold, so
 *   `functions.deploy` refuses with a sentence pointing at the CLI.
 */

import {
  BackendError,
  capabilities,
  unsupported,
  type AdapterConfig,
  type AdapterInfo,
  type BackendAdapter,
  type Blueprint,
  type BroadcastMessage,
  type Filter,
  type FilterTest,
  type HttpSend,
  type ImageTransform,
  type Page,
  type PresenceState,
  type Room,
  type RoomHandlers,
  type Row,
  type SchemaOperation,
  type SchemaPlan,
  type SelectOptions,
  type Socket,
  type Subscription,
  type TableChange,
  type TableSubscribeOptions,
  type TungstenBackend,
  type TungstenSession,
  type TungstenUser,
  type UploadInput,
} from '../contract'
import { sqlForBlueprint } from '../sql'
import { callJson, defaultSend, field, isTest, join, orderToParam } from './http'

export const SUPABASE_INFO: AdapterInfo = {
  id: 'supabase',
  label: 'Supabase',
  summary: 'Postgres, auth, storage and edge functions on a generous free tier.',
  status: 'default',
  fields: [
    { key: 'url', label: 'Project URL', placeholder: 'https://abcdefgh.supabase.co' },
    { key: 'anonKey', label: 'Anon key', secret: true },
    { key: 'serviceKey', label: 'Service role key (for provisioning)', secret: true, optional: true },
  ],
  capabilities: capabilities({
    auth: { password: true, oauth: true, magicLink: true, roles: true },
    db: { embeds: true, cursorPaging: false, upsert: true, rpc: true, count: true },
    realtime: { tables: true, rooms: true, presence: true, replay: false },
    storage: { buckets: true, signedUrls: true, transforms: true, directUpload: true },
    functions: { deploy: false, invoke: true, webhooks: false },
    schema: { create: true, migrate: true, policies: true },
  }),
}

/* ---------------------------------------------------------------- filters */

/**
 * A filter as PostgREST query parameters.
 *
 * PostgREST spells groups as `or=(a.eq.1,b.eq.2)`, which is why this
 * returns a list of `[key, value]` pairs rather than a string: a tree
 * with two top-level tests is two parameters, and one with an `any` is
 * a single `or=`.
 */
export function filterToParams(filter: Filter): Array<[string, string]> {
  if (isTest(filter)) return [[filter.column, testToParam(filter)]]
  if ('all' in filter) return filter.all.flatMap(filterToParams)
  if ('any' in filter) return [['or', `(${filter.any.map(inlineFilter).join(',')})`]]
  return [['not.and', `(${inlineFilter(filter.not)})`]]
}

function testToParam(test: FilterTest): string {
  switch (test.op) {
    case 'is-null': return 'is.null'
    case 'not-null': return 'not.is.null'
    case 'in': {
      const list = Array.isArray(test.value) ? test.value : [test.value]
      return `in.(${list.map((value) => String(value)).join(',')})`
    }
    case 'contains': return `cs.${JSON.stringify(test.value)}`
    default: return `${test.op}.${String(test.value)}`
  }
}

/** The `a.eq.1` form used inside an `or=(…)`. */
function inlineFilter(filter: Filter): string {
  if (isTest(filter)) return `${filter.column}.${testToParam(filter)}`
  if ('all' in filter) return `and(${filter.all.map(inlineFilter).join(',')})`
  if ('any' in filter) return `or(${filter.any.map(inlineFilter).join(',')})`
  return `not.and(${inlineFilter(filter.not)})`
}

/** `title,author:users(name)` — PostgREST's embed syntax. */
function selectParam(options: SelectOptions | undefined): string {
  const columns = options?.columns?.length ? [...options.columns] : ['*']
  for (const embed of options?.embed ?? []) {
    const inner = embed.columns?.length ? embed.columns.join(',') : '*'
    const alias = embed.as && embed.as !== embed.table ? `${embed.as}:` : ''
    columns.push(`${alias}${embed.table}(${inner})`)
  }
  return columns.join(',')
}

/* ---------------------------------------------------------------- adapter */

function create(config: AdapterConfig): TungstenBackend {
  const url = (field(config, 'url') ?? '').replace(/\/+$/, '')
  const anonKey = field(config, 'anonKey') ?? ''
  if (!url || !anonKey) {
    throw new BackendError('invalid', 'Supabase needs a project URL and an anon key before it can be used.')
  }
  const send: HttpSend = config.http ?? defaultSend()
  const serviceKey = field(config, 'serviceKey')
  let token: string | undefined

  /** Every request carries the project key; a signed-in one carries both. */
  const headers = (extra: Record<string, string> = {}, service = false): Record<string, string> => ({
    apikey: service && serviceKey ? serviceKey : anonKey,
    authorization: `Bearer ${service && serviceKey ? serviceKey : (token ?? anonKey)}`,
    ...extra,
  })

  const rest = (table: string) => join(url, `rest/v1/${encodeURIComponent(table)}`)

  const sessionFrom = (payload: Record<string, unknown>): TungstenSession => {
    const user = payload.user as Record<string, unknown> | undefined
    const access = payload.access_token
    if (typeof access !== 'string' || !user) {
      throw new BackendError('unknown', 'Supabase answered a sign-in without a session in it.')
    }
    token = access
    return {
      token: access,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
      expiresAt: typeof payload.expires_at === 'number'
        ? new Date(payload.expires_at * 1000).toISOString()
        : undefined,
      user: userFrom(user),
    }
  }

  const userFrom = (raw: Record<string, unknown>): TungstenUser => {
    const metadata = (raw.user_metadata as Record<string, unknown> | undefined) ?? {}
    const appMetadata = (raw.app_metadata as Record<string, unknown> | undefined) ?? {}
    const roles = Array.isArray(appMetadata.roles)
      ? appMetadata.roles.filter((role): role is string => typeof role === 'string')
      : undefined
    return {
      id: String(raw.id ?? ''),
      email: typeof raw.email === 'string' ? raw.email : undefined,
      name: typeof metadata.name === 'string' ? metadata.name : undefined,
      metadata,
      roles,
      createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    }
  }

  /** The row count out of a `content-range: 0-24/137` header. */
  const totalFrom = (reply: { headers?: { get: (name: string) => string | null } }): number | undefined => {
    const range = reply.headers?.get('content-range')
    const total = range?.split('/')[1]
    return total && total !== '*' ? Number(total) : undefined
  }

  /**
   * A select, including the count that only comes back in a header.
   *
   * This is the one call that needs the reply rather than its body, so
   * it is the one call that does not go through the shared helper.
   */
  const query = async (table: string, options: SelectOptions | undefined): Promise<Page> => {
    const params = new URLSearchParams()
    params.set('select', selectParam(options))
    for (const [key, value] of options?.where ? filterToParams(options.where) : []) params.append(key, value)
    const order = orderToParam(options?.order)
    if (order) params.set('order', order)
    if (options?.limit !== undefined) params.set('limit', String(options.limit))
    if (options?.offset !== undefined) params.set('offset', String(options.offset))

    // Counting costs a second pass in Postgres, so it is asked for only
    // when the caller said they wanted it.
    const extra: Record<string, string> = {}
    if (options?.count) extra.prefer = 'count=exact'

    const reply = await send(`${rest(table)}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers(extra) },
    })
    const text = await reply.text()
    if (!reply.ok) {
      throw new BackendError(
        reply.status === 401 ? 'unauthorized' : reply.status === 403 ? 'forbidden' : 'unknown',
        safeParse(text) ?? `Supabase answered ${reply.status}.`,
        text,
      )
    }
    const rows = (text ? JSON.parse(text) : []) as Row[]
    const total = totalFrom(reply)
    return total === undefined ? { rows } : { rows, total }
  }

  const sockets = new Set<SupabaseChannel>()

  const backend: TungstenBackend = {
    info: SUPABASE_INFO,

    auth: {
      useToken: (next) => { token = next },

      signUp: async (input) => sessionFrom(await supabaseCall<Record<string, unknown>>(send, {
        url: join(url, 'auth/v1/signup'),
        method: 'POST',
        headers: headers(),
        body: {
          email: input.email,
          password: input.password,
          data: { ...(input.metadata ?? {}), ...(input.name ? { name: input.name } : {}) },
        },
      })),

      signIn: async (email, password) => sessionFrom(await supabaseCall<Record<string, unknown>>(send, {
        url: join(url, 'auth/v1/token?grant_type=password'),
        method: 'POST',
        headers: headers(),
        body: { email, password },
      })),

      signOut: async () => {
        await supabaseCall(send, { url: join(url, 'auth/v1/logout'), method: 'POST', headers: headers() })
        token = undefined
      },

      session: async () => {
        if (!token) return undefined
        try {
          const user = await supabaseCall<Record<string, unknown>>(send, {
            url: join(url, 'auth/v1/user'),
            headers: headers(),
          })
          return { token, user: userFrom(user) }
        } catch (error) {
          // An expired token is not an error the canvas should see: it
          // means nobody is signed in.
          if (error instanceof BackendError && error.code === 'unauthorized') return undefined
          throw error
        }
      },

      refresh: async (refreshToken) => sessionFrom(await supabaseCall<Record<string, unknown>>(send, {
        url: join(url, 'auth/v1/token?grant_type=refresh_token'),
        method: 'POST',
        headers: headers(),
        body: { refresh_token: refreshToken },
      })),

      oauthUrl: async (provider, redirectTo) => (
        `${join(url, 'auth/v1/authorize')}?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`
      ),

      magicLink: async (email, redirectTo) => {
        await supabaseCall(send, {
          url: `${join(url, 'auth/v1/otp')}?redirect_to=${encodeURIComponent(redirectTo)}`,
          method: 'POST',
          headers: headers(),
          body: { email, create_user: true },
        })
      },

      exchange: async (code) => sessionFrom(await supabaseCall<Record<string, unknown>>(send, {
        url: join(url, 'auth/v1/token?grant_type=pkce'),
        method: 'POST',
        headers: headers(),
        body: { auth_code: code },
      })),

      updateUser: async (patch) => userFrom(await supabaseCall<Record<string, unknown>>(send, {
        url: join(url, 'auth/v1/user'),
        method: 'PUT',
        headers: headers(),
        body: {
          ...(patch.password ? { password: patch.password } : {}),
          data: { ...(patch.metadata ?? {}), ...(patch.name ? { name: patch.name } : {}) },
        },
      })),

      setRoles: async (userId, roles) => {
        if (!serviceKey) {
          throw new BackendError('forbidden', 'Changing roles needs the service role key, which this project has not been given.')
        }
        return userFrom(await supabaseCall<Record<string, unknown>>(send, {
          url: join(url, `auth/v1/admin/users/${encodeURIComponent(userId)}`),
          method: 'PUT',
          headers: headers({}, true),
          body: { app_metadata: { roles } },
        }))
      },
    },

    db: {
      select: (table, options) => query(table, options),

      find: async (table, id, options) => {
        const page = await query(table, { ...options, where: { column: 'id', op: 'eq', value: id as string }, limit: 1 })
        return page.rows[0]
      },

      insert: async (table, row) => supabaseCall<Row[]>(send, {
        url: rest(table),
        method: 'POST',
        headers: headers({ prefer: 'return=representation' }),
        body: row,
      }),

      update: async (table, id, changes) => {
        const rows = await supabaseCall<Row[]>(send, {
          url: `${rest(table)}?id=eq.${encodeURIComponent(String(id))}`,
          method: 'PATCH',
          headers: headers({ prefer: 'return=representation' }),
          body: changes,
        })
        if (!rows?.length) throw new BackendError('not-found', `No row with id ${id} in ${table}.`)
        return rows[0]
      },

      updateWhere: async (table, where, changes) => {
        const params = new URLSearchParams()
        for (const [key, value] of filterToParams(where)) params.append(key, value)
        const rows = await supabaseCall<Row[]>(send, {
          url: `${rest(table)}?${params.toString()}`,
          method: 'PATCH',
          headers: headers({ prefer: 'return=representation' }),
          body: changes,
        })
        return rows?.length ?? 0
      },

      remove: async (table, id) => {
        await supabaseCall(send, {
          url: `${rest(table)}?id=eq.${encodeURIComponent(String(id))}`,
          method: 'DELETE',
          headers: headers(),
        })
      },

      removeWhere: async (table, where) => {
        const params = new URLSearchParams()
        for (const [key, value] of filterToParams(where)) params.append(key, value)
        const rows = await supabaseCall<Row[]>(send, {
          url: `${rest(table)}?${params.toString()}`,
          method: 'DELETE',
          headers: headers({ prefer: 'return=representation' }),
        })
        return rows?.length ?? 0
      },

      upsert: async (table, row, onConflict) => supabaseCall<Row[]>(send, {
        url: onConflict?.length ? `${rest(table)}?on_conflict=${onConflict.join(',')}` : rest(table),
        method: 'POST',
        headers: headers({ prefer: 'resolution=merge-duplicates,return=representation' }),
        body: row,
      }),

      count: async (table, where) => {
        const page = await query(table, { where, limit: 1, count: true, columns: ['id'] })
        return page.total ?? page.rows.length
      },

      rpc: (name, args) => supabaseCall(send, {
        url: join(url, `rest/v1/rpc/${encodeURIComponent(name)}`),
        method: 'POST',
        headers: headers(),
        body: args ?? {},
      }),
    },

    realtime: {
      table: async (table, handler, options) => {
        const channel = openChannel(config, url, anonKey, () => token)
        sockets.add(channel)
        return channel.subscribeTable(table, handler, options)
      },
      room: async (name, handlers) => {
        const channel = openChannel(config, url, anonKey, () => token)
        sockets.add(channel)
        return channel.joinRoom(name, handlers)
      },
      disconnect: async () => {
        for (const channel of sockets) channel.close()
        sockets.clear()
      },
    },

    storage: {
      buckets: async () => {
        const raw = await supabaseCall<Array<Record<string, unknown>>>(send, {
          url: join(url, 'storage/v1/bucket'),
          headers: headers(),
        })
        return (raw ?? []).map((bucket) => ({
          name: String(bucket.name ?? bucket.id ?? ''),
          public: bucket.public === true,
          maxBytes: typeof bucket.file_size_limit === 'number' ? bucket.file_size_limit : undefined,
        }))
      },

      createBucket: async (bucket) => {
        await supabaseCall(send, {
          url: join(url, 'storage/v1/bucket'),
          method: 'POST',
          headers: headers({}, true),
          body: {
            id: bucket.name,
            name: bucket.name,
            public: bucket.public,
            file_size_limit: bucket.maxBytes,
            allowed_mime_types: bucket.allow,
          },
        })
        return bucket
      },

      removeBucket: async (name) => {
        await supabaseCall(send, {
          url: join(url, `storage/v1/bucket/${encodeURIComponent(name)}`),
          method: 'DELETE',
          headers: headers({}, true),
        })
      },

      upload: async (input: UploadInput) => {
        const path = `${input.bucket}/${input.path.replace(/^\/+/, '')}`
        await supabaseCall(send, {
          url: join(url, `storage/v1/object/${path}`),
          method: input.overwrite ? 'PUT' : 'POST',
          headers: headers({
            'content-type': input.contentType ?? 'application/octet-stream',
            'x-upsert': input.overwrite ? 'true' : 'false',
          }),
          raw: typeof input.data === 'string' || input.data instanceof Uint8Array
            ? input.data
            : await bytesOf(input.data),
        })
        return {
          bucket: input.bucket,
          path: input.path,
          url: join(url, `storage/v1/object/public/${path}`),
          contentType: input.contentType,
        }
      },

      remove: async (bucket, path) => {
        await supabaseCall(send, {
          url: join(url, `storage/v1/object/${bucket}/${path.replace(/^\/+/, '')}`),
          method: 'DELETE',
          headers: headers(),
        })
      },

      list: async (bucket, prefix) => {
        const raw = await supabaseCall<Array<Record<string, unknown>>>(send, {
          url: join(url, `storage/v1/object/list/${encodeURIComponent(bucket)}`),
          method: 'POST',
          headers: headers(),
          body: { prefix: prefix ?? '', limit: 100 },
        })
        return (raw ?? []).map((file) => ({
          bucket,
          path: String(file.name ?? ''),
          url: join(url, `storage/v1/object/public/${bucket}/${String(file.name ?? '')}`),
          size: typeof file.metadata === 'object' && file.metadata
            ? Number((file.metadata as Record<string, unknown>).size ?? 0) || undefined
            : undefined,
        }))
      },

      publicUrl: (bucket, path, transform) => {
        const clean = path.replace(/^\/+/, '')
        const base = transform
          ? join(url, `storage/v1/render/image/public/${bucket}/${clean}`)
          : join(url, `storage/v1/object/public/${bucket}/${clean}`)
        const params = transformParams(transform)
        return params ? `${base}?${params}` : base
      },

      signedUrl: async (bucket, path, seconds, transform) => {
        const clean = path.replace(/^\/+/, '')
        const reply = await supabaseCall<{ signedURL?: string; signedUrl?: string }>(send, {
          url: join(url, `storage/v1/object/sign/${bucket}/${clean}`),
          method: 'POST',
          headers: headers(),
          body: { expiresIn: seconds, ...(transform ? { transform: supabaseTransform(transform) } : {}) },
        })
        const signed = reply.signedURL ?? reply.signedUrl
        if (!signed) throw new BackendError('unknown', 'Supabase signed the file but did not return a URL.')
        return signed.startsWith('http') ? signed : join(url, `storage/v1${signed}`)
      },

      signedUpload: async (bucket, path) => {
        const reply = await supabaseCall<{ url?: string }>(send, {
          url: join(url, `storage/v1/object/upload/sign/${bucket}/${path.replace(/^\/+/, '')}`),
          method: 'POST',
          headers: headers(),
          body: {},
        })
        if (!reply.url) throw new BackendError('unknown', 'Supabase did not return an upload URL.')
        return { url: reply.url.startsWith('http') ? reply.url : join(url, `storage/v1${reply.url}`), method: 'PUT' }
      },
    },

    functions: {
      list: async () => {
        throw unsupported('list edge functions without a management token', 'Supabase')
      },
      deploy: async () => {
        throw new BackendError(
          'unsupported',
          'Supabase deploys edge functions through its CLI, not its API. Tungsten writes the function; run `supabase functions deploy` to publish it.',
        )
      },
      invoke: (name, payload) => supabaseCall(send, {
        url: join(url, `functions/v1/${encodeURIComponent(name)}`),
        method: 'POST',
        headers: headers(),
        body: payload ?? {},
      }),
      remove: async () => { throw unsupported('delete an edge function', 'Supabase') },
      webhooks: {
        list: async () => { throw unsupported('list database webhooks', 'Supabase') },
        register: async () => {
          throw new BackendError(
            'unsupported',
            'Supabase webhooks are database triggers. Tungsten writes the SQL for one in the schema plan; apply it there.',
          )
        },
        remove: async () => { throw unsupported('remove a webhook', 'Supabase') },
      },
    },

    schema: {
      inspect: async () => {
        throw unsupported('read its schema back over the REST API', 'Supabase')
      },

      plan: async (blueprint: Blueprint) => planFor(blueprint, Boolean(serviceKey)),

      apply: async (blueprint: Blueprint) => {
        const plan = planFor(blueprint, Boolean(serviceKey))
        if (plan.mode === 'script') {
          throw new BackendError(
            'unsupported',
            'Supabase has no DDL endpoint. Copy the SQL from the plan into the SQL editor, or install Tungsten’s exec_sql function and add a service role key.',
          )
        }
        for (const operation of plan.operations) {
          await supabaseCall(send, {
            url: join(url, 'rest/v1/rpc/exec_sql'),
            method: 'POST',
            headers: headers({}, true),
            body: { query: operation.statement },
          })
        }
        return plan
      },

      policies: async (table) => {
        const rows = await supabaseCall<Array<Record<string, unknown>>>(send, {
          url: join(url, 'rest/v1/rpc/exec_sql'),
          method: 'POST',
          headers: headers({}, true),
          body: { query: `select policyname from pg_policies where tablename = '${table.replace(/'/g, "''")}'` },
        }).catch(() => [])
        return (rows ?? []).map((row) => String(row.policyname ?? ''))
      },
    },

    health: async () => {
      try {
        await supabaseCall(send, { url: join(url, 'auth/v1/settings'), headers: headers() })
        return { ok: true, detail: `Reached ${new URL(url).host}.` }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  return backend
}

/** The plan, and whether this project can run it unattended. */
function planFor(blueprint: Blueprint, hasServiceKey: boolean): SchemaPlan {
  const operations: SchemaOperation[] = sqlForBlueprint(blueprint, 'postgres')
  return {
    operations,
    problems: [],
    // Without a service key there is nothing to run the SQL with, so the
    // plan is honest about ending as a script the user pastes.
    mode: hasServiceKey ? 'apply' : 'script',
  }
}

function transformParams(transform: ImageTransform | undefined): string | undefined {
  if (!transform) return undefined
  const params = new URLSearchParams()
  if (transform.width) params.set('width', String(transform.width))
  if (transform.height) params.set('height', String(transform.height))
  if (transform.quality) params.set('quality', String(transform.quality))
  if (transform.fit) params.set('resize', transform.fit)
  if (transform.format && transform.format !== 'origin') params.set('format', transform.format)
  const text = params.toString()
  return text || undefined
}

function supabaseTransform(transform: ImageTransform): Record<string, unknown> {
  return {
    width: transform.width,
    height: transform.height,
    quality: transform.quality,
    resize: transform.fit,
    format: transform.format === 'origin' ? undefined : transform.format,
  }
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function safeParse(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    for (const key of ['message', 'error', 'hint']) {
      if (typeof parsed[key] === 'string') return parsed[key] as string
    }
  } catch { /* not JSON */ }
  return undefined
}

/** The shared JSON call, with Supabase's error shapes understood. */
function supabaseCall<T>(send: HttpSend, call: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  raw?: Uint8Array | string
}): Promise<T> {
  return callJson<T>(send, call)
}

/* --------------------------------------------------------------- realtime */

type SupabaseChannel = {
  subscribeTable: (table: string, handler: (change: TableChange) => void, options?: TableSubscribeOptions) => Subscription
  joinRoom: (name: string, handlers: RoomHandlers) => Room
  close: () => void
}

/**
 * Phoenix channels, by hand.
 *
 * Supabase Realtime is a Phoenix socket: join a topic, send heartbeats,
 * read `{topic, event, payload, ref}` frames. Implementing it here
 * rather than importing the SDK is forty lines and keeps the dependency
 * count at zero -- and because the socket is injected, a test can drive
 * it frame by frame without a server.
 */
function openChannel(
  config: AdapterConfig,
  url: string,
  anonKey: string,
  tokenOf: () => string | undefined,
): SupabaseChannel {
  const open = config.openSocket ?? defaultSocket()
  const endpoint = `${url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`
  const socket = open(endpoint)
  let reference = 0
  const nextRef = () => String(++reference)
  const listeners = new Map<string, (event: string, payload: Record<string, unknown>) => void>()
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const push = (topic: string, event: string, payload: unknown) => {
    socket.send(JSON.stringify({ topic, event, payload, ref: nextRef() }))
  }

  socket.addEventListener('open', () => {
    // Twenty-five seconds: Supabase closes an idle socket at thirty.
    heartbeat = setInterval(() => push('phoenix', 'heartbeat', {}), 25_000)
  })

  socket.addEventListener('message', (event) => {
    const frame = parseFrame(event.data)
    if (!frame) return
    const listener = listeners.get(frame.topic)
    listener?.(frame.event, frame.payload)
  })

  socket.addEventListener('close', () => { if (heartbeat) clearInterval(heartbeat) })

  const close = () => {
    if (heartbeat) clearInterval(heartbeat)
    socket.close()
  }

  return {
    close,

    subscribeTable(table, handler, options) {
      const topic = `realtime:public:${table}`
      let cursor: string | undefined
      listeners.set(topic, (event, payload) => {
        if (event !== 'postgres_changes') return
        const data = (payload.data ?? payload) as Record<string, unknown>
        const kind = String(data.type ?? data.eventType ?? '').toLowerCase()
        const mapped = kind.startsWith('insert') ? 'insert' : kind.startsWith('update') ? 'update' : kind.startsWith('delete') ? 'delete' : undefined
        if (!mapped) return
        if (options?.kinds && !options.kinds.includes(mapped)) return
        cursor = typeof data.commit_timestamp === 'string' ? data.commit_timestamp : cursor
        handler({
          kind: mapped,
          table,
          row: (data.record ?? data.new ?? {}) as Row,
          previous: (data.old_record ?? data.old) as Row | undefined,
          cursor,
          at: typeof data.commit_timestamp === 'string' ? data.commit_timestamp : undefined,
        })
      })

      push(topic, 'phx_join', {
        config: {
          postgres_changes: (options?.kinds ?? ['insert', 'update', 'delete']).map((kind) => ({
            event: kind.toUpperCase(),
            schema: 'public',
            table,
            filter: options?.where && isTest(options.where)
              ? `${options.where.column}=${options.where.op}.${String(options.where.value)}`
              : undefined,
          })),
        },
        access_token: tokenOf() ?? anonKey,
      })

      return {
        cursor: () => cursor,
        unsubscribe: async () => {
          push(topic, 'phx_leave', {})
          listeners.delete(topic)
        },
      }
    },

    joinRoom(name, handlers) {
      const topic = `realtime:${name}`
      listeners.set(topic, (event, payload) => {
        if (event === 'broadcast') {
          const message = payload as unknown as BroadcastMessage
          handlers.onMessage?.({ event: String(message.event ?? ''), payload: message.payload })
          return
        }
        if (event === 'presence_state' || event === 'presence_diff') {
          handlers.onPresence?.(payload as PresenceState)
        }
      })

      push(topic, 'phx_join', {
        config: { broadcast: { self: true }, presence: { key: '' } },
        access_token: tokenOf() ?? anonKey,
      })

      return {
        cursor: () => undefined,
        unsubscribe: async () => {
          push(topic, 'phx_leave', {})
          listeners.delete(topic)
        },
        broadcast: async (event, payload) => push(topic, 'broadcast', { type: 'broadcast', event, payload }),
        track: async (state) => push(topic, 'presence', { type: 'presence', event: 'track', payload: state }),
        untrack: async () => push(topic, 'presence', { type: 'presence', event: 'untrack' }),
      }
    },
  }
}

function parseFrame(data: unknown): { topic: string; event: string; payload: Record<string, unknown> } | undefined {
  if (typeof data !== 'string') return undefined
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    if (typeof parsed.topic !== 'string' || typeof parsed.event !== 'string') return undefined
    return { topic: parsed.topic, event: parsed.event, payload: (parsed.payload ?? {}) as Record<string, unknown> }
  } catch {
    return undefined
  }
}

/** The browser's WebSocket, or a refusal that explains itself. */
function defaultSocket() {
  const Constructor = (globalThis as unknown as { WebSocket?: new (url: string) => Socket }).WebSocket
  if (!Constructor) {
    return () => { throw new BackendError('offline', 'This build has no WebSocket, so realtime is unavailable.') }
  }
  return (endpoint: string) => new Constructor(endpoint)
}

export const supabaseAdapter: BackendAdapter = { info: SUPABASE_INFO, create }
