/**
 * The Universal Data Contract.
 *
 * Everything the canvas can ask a backend to do, written once, in terms
 * that belong to Tungsten rather than to any vendor. A block says
 * `db.select('orders', …)`; it never says `.from('orders').select()`,
 * never imports `@supabase/supabase-js`, and never knows whether the
 * answer came from Postgres, Firestore or a Node service on somebody's
 * VPS. An adapter translates. That is the whole idea, and the reason it
 * is worth the indirection is that the alternative -- vendor calls
 * reaching into generated apps -- is a decision users cannot take back.
 *
 * Four rules this file follows, all of them load-bearing:
 *
 * 1. **Plain data in, plain data out.** Every argument and every result
 *    is JSON-serialisable. Filters are a tree of objects, not a builder
 *    chain, because a filter has to survive being saved in a project
 *    file, shown in an inspector and translated into three query
 *    languages.
 * 2. **Capabilities are declared, not discovered.** An adapter says up
 *    front what it cannot do. The UI greys those blocks out instead of
 *    letting a user build on a feature that throws at runtime.
 * 3. **Failures are sentences.** A `BackendError` carries a code for
 *    the program and a sentence for the person. "Row level security
 *    blocked that insert" beats `PGRST301`.
 * 4. **No SDKs.** Adapters speak HTTP and WebSocket through injected
 *    transports. It keeps Tungsten dependency-free, keeps every adapter
 *    testable without a network, and means adding a backend is a file
 *    rather than a supply chain.
 */

/* --------------------------------------------------------------- plumbing */

/** The minimum of a fetch response an adapter uses. */
export type HttpReply = {
  ok: boolean
  status: number
  text: () => Promise<string>
  headers?: { get: (name: string) => string | null }
}

/** The minimum of fetch an adapter needs, so tests can supply their own. */
export type HttpSend = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<HttpReply>

/** A socket, narrowed to the four things a realtime channel uses. */
export type Socket = {
  send: (data: string) => void
  close: () => void
  addEventListener: (event: 'open' | 'message' | 'close' | 'error', handler: (event: { data?: unknown }) => void) => void
}

/** Opens a socket. Injected for the same reason `HttpSend` is. */
export type SocketOpen = (url: string, protocols?: string[]) => Socket

/**
 * Why a call failed, in both registers.
 *
 * `code` is for `if`s and `message` is for humans. Adapters map their
 * backend's own vocabulary onto this list; anything they cannot place
 * becomes `unknown` with the backend's sentence passed through, which
 * is better than inventing a category.
 */
export type BackendErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'rate-limited'
  | 'unsupported'
  | 'offline'
  | 'unknown'

export class BackendError extends Error {
  readonly code: BackendErrorCode
  /** The backend's own error text, kept for the console. */
  readonly detail?: string

  constructor(code: BackendErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.detail = detail
  }
}

/** The error an adapter throws for something it has declared it cannot do. */
export function unsupported(feature: string, backend: string): BackendError {
  return new BackendError('unsupported', `${backend} cannot ${feature} from Tungsten yet.`)
}

/* ------------------------------------------------------------------- auth */

export type UserRole = 'owner' | 'admin' | 'member' | 'guest' | (string & {})

export type TungstenUser = {
  id: string
  email?: string
  /** Display name, when the backend has one. */
  name?: string
  /** Whatever the project decided to attach. Always JSON. */
  metadata?: Record<string, unknown>
  roles?: UserRole[]
  createdAt?: string
}

export type TungstenSession = {
  user: TungstenUser
  /** The bearer token every other call carries. */
  token: string
  refreshToken?: string
  /** ISO 8601. Absent when the backend issues non-expiring tokens. */
  expiresAt?: string
}

export type OAuthProvider = 'google' | 'github' | 'apple' | 'microsoft' | 'facebook' | 'discord' | (string & {})

export type SignUpInput = {
  email: string
  password: string
  name?: string
  metadata?: Record<string, unknown>
}

/**
 * Accounts, sessions and the ways into them.
 *
 * `oauthUrl` returns a URL rather than performing a redirect: the canvas
 * runs in an iframe, a generated Android app runs in a Chrome Custom
 * Tab, and a desktop build opens a browser window. Only the caller knows
 * which, so the adapter's job ends at the address.
 */
export type TungstenAuth = {
  signUp: (input: SignUpInput) => Promise<TungstenSession>
  signIn: (email: string, password: string) => Promise<TungstenSession>
  signOut: () => Promise<void>
  /** The signed-in user, or undefined. Never throws for "nobody is signed in". */
  session: () => Promise<TungstenSession | undefined>
  refresh: (refreshToken: string) => Promise<TungstenSession>
  /** Where to send the browser for a provider sign-in. */
  oauthUrl: (provider: OAuthProvider, redirectTo: string) => Promise<string>
  /** Emails a one-time link. Resolves when the mail has been accepted. */
  magicLink: (email: string, redirectTo: string) => Promise<void>
  /** Finishes a magic link or OAuth round trip from the code in the URL. */
  exchange: (code: string) => Promise<TungstenSession>
  updateUser: (patch: { name?: string; metadata?: Record<string, unknown>; password?: string }) => Promise<TungstenUser>
  /** Roles are metadata everywhere, but naming the operation keeps blocks honest. */
  setRoles: (userId: string, roles: UserRole[]) => Promise<TungstenUser>
  /** The token later calls will carry. Set by the runtime after a sign-in. */
  useToken: (token: string | undefined) => void
}

/* --------------------------------------------------------------------- db */

export type FilterOperator =
  | 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
  | 'like' | 'ilike' | 'in' | 'contains' | 'is-null' | 'not-null'

/** One test against one column. */
export type FilterTest = {
  column: string
  op: FilterOperator
  /** Absent for `is-null` and `not-null`. An array for `in`. */
  value?: string | number | boolean | null | Array<string | number | boolean>
}

/** A tree, so "A and (B or C)" is expressible without a query language. */
export type Filter =
  | FilterTest
  | { all: Filter[] }
  | { any: Filter[] }
  | { not: Filter }

/** A related table pulled in with the row. */
export type Embed = {
  /** The related table. */
  table: string
  /** Columns to bring back. Empty means all of them. */
  columns?: string[]
  /** The property the related rows land on. Defaults to the table name. */
  as?: string
  /** The column on this table pointing at the other one, when it is not `<table>_id`. */
  foreignKey?: string
  /** One row rather than a list. */
  single?: boolean
}

export type SortOrder = { column: string; direction?: 'asc' | 'desc' }

export type SelectOptions = {
  columns?: string[]
  where?: Filter
  embed?: Embed[]
  order?: SortOrder[]
  limit?: number
  offset?: number
  /** Opaque, from a previous page. Preferred over offset when the backend has it. */
  cursor?: string
  /** Ask for the total count. Costs a second query on some backends. */
  count?: boolean
}

export type Row = Record<string, unknown>

export type Page<T = Row> = {
  rows: T[]
  /** Total matching rows, when `count` was asked for and the backend can. */
  total?: number
  /** Pass to the next `select` to continue. Absent on the last page. */
  cursor?: string
}

export type TungstenDb = {
  select: (table: string, options?: SelectOptions) => Promise<Page>
  /** One row by primary key, or undefined. */
  find: (table: string, id: string | number, options?: Pick<SelectOptions, 'columns' | 'embed'>) => Promise<Row | undefined>
  insert: (table: string, row: Row | Row[]) => Promise<Row[]>
  update: (table: string, id: string | number, changes: Row) => Promise<Row>
  /** Changes every row a filter matches. Returns how many. */
  updateWhere: (table: string, where: Filter, changes: Row) => Promise<number>
  remove: (table: string, id: string | number) => Promise<void>
  removeWhere: (table: string, where: Filter) => Promise<number>
  /** Insert, or update when the unique columns already exist. */
  upsert: (table: string, row: Row | Row[], onConflict?: string[]) => Promise<Row[]>
  count: (table: string, where?: Filter) => Promise<number>
  /** An escape hatch, and declared as one: not every backend has it. */
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<unknown>
}

/* --------------------------------------------------------------- realtime */

export type ChangeKind = 'insert' | 'update' | 'delete'

export type TableChange = {
  kind: ChangeKind
  table: string
  row: Row
  /** The row as it was, when the backend sends it. */
  previous?: Row
  /** Monotonic, per channel. Pass back as `since` to resume. */
  cursor?: string
  at?: string
}

export type PresenceState = Record<string, Record<string, unknown>>

export type BroadcastMessage = { event: string; payload: unknown; from?: string }

export type Subscription = {
  /** Stops delivery and releases the channel. Safe to call twice. */
  unsubscribe: () => Promise<void>
  /** The last cursor seen, for resuming after a reconnect. */
  cursor: () => string | undefined
}

export type TableSubscribeOptions = {
  /** Only these kinds. Default: all three. */
  kinds?: ChangeKind[]
  where?: Filter
  /**
   * Replay from here. The difference between "live updates" and "a
   * client that can be closed, reopened and still correct".
   */
  since?: string
}

export type RoomHandlers = {
  onMessage?: (message: BroadcastMessage) => void
  onPresence?: (state: PresenceState) => void
  onError?: (error: BackendError) => void
}

export type TungstenRealtime = {
  /** Live row changes on one table. */
  table: (
    table: string,
    handler: (change: TableChange) => void,
    options?: TableSubscribeOptions,
  ) => Promise<Subscription>
  /** A named room for broadcast and presence. */
  room: (name: string, handlers: RoomHandlers) => Promise<Room>
  /** Closes every channel this adapter opened. */
  disconnect: () => Promise<void>
}

export type Room = Subscription & {
  broadcast: (event: string, payload: unknown) => Promise<void>
  /** Announce this client, or update what it announced. */
  track: (state: Record<string, unknown>) => Promise<void>
  untrack: () => Promise<void>
}

/* ---------------------------------------------------------------- storage */

export type BucketInfo = { name: string; public: boolean; maxBytes?: number; allow?: string[] }

/** What to do to an image on its way out. */
export type ImageTransform = {
  width?: number
  height?: number
  /** 1-100. */
  quality?: number
  fit?: 'cover' | 'contain' | 'fill'
  format?: 'origin' | 'webp' | 'avif' | 'jpeg' | 'png'
}

export type UploadInput = {
  bucket: string
  /** Path inside the bucket. A name alone is fine. */
  path: string
  data: Uint8Array | Blob | string
  contentType?: string
  /** Replace an existing object at this path. */
  overwrite?: boolean
}

export type StoredFile = {
  bucket: string
  path: string
  url: string
  size?: number
  contentType?: string
}

export type TungstenStorage = {
  buckets: () => Promise<BucketInfo[]>
  createBucket: (bucket: BucketInfo) => Promise<BucketInfo>
  removeBucket: (name: string) => Promise<void>
  upload: (input: UploadInput) => Promise<StoredFile>
  remove: (bucket: string, path: string) => Promise<void>
  list: (bucket: string, prefix?: string) => Promise<StoredFile[]>
  /** A public URL, with transforms applied when the backend can do them. */
  publicUrl: (bucket: string, path: string, transform?: ImageTransform) => string
  /** A time-limited URL for a private object. */
  signedUrl: (bucket: string, path: string, seconds: number, transform?: ImageTransform) => Promise<string>
  /** A URL the browser can upload straight to, skipping Tungsten entirely. */
  signedUpload?: (bucket: string, path: string, seconds: number) => Promise<{ url: string; method: 'PUT' | 'POST' }>
}

/* -------------------------------------------------------------- functions */

export type FunctionRuntime = 'js' | 'ts' | 'deno' | 'node' | 'edge'

export type FunctionSpec = {
  name: string
  runtime: FunctionRuntime
  /** The source, as a single file. Bundling is the adapter's problem. */
  source: string
  /** Secrets by name; values are set out of band, never stored in a project. */
  secrets?: string[]
  /** Who may call it. */
  access?: 'public' | 'authenticated' | 'service'
}

export type WebhookSpec = {
  name: string
  table: string
  on: ChangeKind[]
  /** Where the backend should POST. */
  url: string
  secret?: string
}

export type TungstenFunctions = {
  list: () => Promise<Array<{ name: string; runtime: FunctionRuntime; updatedAt?: string }>>
  deploy: (spec: FunctionSpec) => Promise<void>
  invoke: (name: string, payload?: unknown) => Promise<unknown>
  remove: (name: string) => Promise<void>
  webhooks: {
    list: () => Promise<WebhookSpec[]>
    register: (spec: WebhookSpec) => Promise<void>
    remove: (name: string) => Promise<void>
  }
}

/* ------------------------------------------------------- schema & security */

export type { Blueprint, BlueprintTable, BlueprintColumn, PolicyRule, PolicySet } from './blueprint'

import type { Blueprint } from './blueprint'

/** One thing applying a blueprint would do. */
export type SchemaOperation = {
  kind: 'create-table' | 'add-column' | 'alter-column' | 'drop-column' | 'create-index' | 'policy' | 'bucket' | 'function'
  /** What it affects, in words: `orders.total`, `orders read policy`. */
  subject: string
  /** The statement or call, for the user to read before approving. */
  statement: string
  /** True when running it could lose data. The approval gate highlights these. */
  destructive?: boolean
}

/**
 * The plan, before anything happens.
 *
 * Nothing in Tungsten applies a schema without showing this first. An
 * AI that quietly dropped a column would be a tool nobody could trust
 * with a second project.
 */
export type SchemaPlan = {
  operations: SchemaOperation[]
  /** Problems that stop the plan from being applied at all. */
  problems: string[]
  /** How the adapter will run it: directly, or by handing over a script. */
  mode: 'apply' | 'script'
}

export type TungstenSchema = {
  /** What the backend currently has. */
  inspect: () => Promise<Blueprint>
  /** What applying this blueprint would do. Never changes anything. */
  plan: (blueprint: Blueprint) => Promise<SchemaPlan>
  /** Runs an approved plan. */
  apply: (blueprint: Blueprint) => Promise<SchemaPlan>
  /** The policies, rules or guards for one table, as the backend spells them. */
  policies: (table: string) => Promise<string[]>
}

/* -------------------------------------------------------------- the whole */

/**
 * What an adapter can do, stated before anything is built on it.
 *
 * Every flag that is false here turns into a greyed-out block with a
 * tooltip saying which backends have it, rather than a runtime error in
 * somebody's shipped app.
 */
export type Capabilities = {
  auth: { password: boolean; oauth: boolean; magicLink: boolean; roles: boolean }
  db: { embeds: boolean; cursorPaging: boolean; upsert: boolean; rpc: boolean; count: boolean }
  realtime: { tables: boolean; rooms: boolean; presence: boolean; replay: boolean }
  storage: { buckets: boolean; signedUrls: boolean; transforms: boolean; directUpload: boolean }
  functions: { deploy: boolean; invoke: boolean; webhooks: boolean }
  schema: { create: boolean; migrate: boolean; policies: boolean }
}

/** Where an adapter is in its life, which the project dropdown shows. */
export type AdapterStatus = 'default' | 'ready' | 'preview' | 'planned'

export type AdapterInfo = {
  id: string
  label: string
  /** One line for the dropdown. */
  summary: string
  status: AdapterStatus
  /** What the user has to paste in to use it. */
  fields: Array<{ key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }>
  capabilities: Capabilities
}

/**
 * Whatever the user pasted into those fields, plus injected transports.
 *
 * The two transports are named rather than part of the index signature:
 * a config is mostly strings, and letting a function hide behind
 * `Record<string, string>` is how a credential ends up stringified into
 * a URL.
 */
export type AdapterConfig = {
  [key: string]: string | HttpSend | SocketOpen | undefined
  http?: HttpSend
  openSocket?: SocketOpen
}

/**
 * One backend, assembled.
 *
 * The canvas holds exactly one of these at a time and never asks which
 * kind it is -- `capabilities` is the only thing it inspects, and only
 * to decide what to grey out.
 */
export type TungstenBackend = {
  info: AdapterInfo
  auth: TungstenAuth
  db: TungstenDb
  realtime: TungstenRealtime
  storage: TungstenStorage
  functions: TungstenFunctions
  schema: TungstenSchema
  /** A cheap round trip, for the "Test connection" button. */
  health: () => Promise<{ ok: boolean; detail: string }>
}

/** What a backend module exports. */
export type BackendAdapter = {
  info: AdapterInfo
  /** Throws a `BackendError` with a sentence when the config is incomplete. */
  create: (config: AdapterConfig) => TungstenBackend
}

/** Every capability off. Adapters switch on what they have, so new flags default to honest. */
export const NO_CAPABILITIES: Capabilities = {
  auth: { password: false, oauth: false, magicLink: false, roles: false },
  db: { embeds: false, cursorPaging: false, upsert: false, rpc: false, count: false },
  realtime: { tables: false, rooms: false, presence: false, replay: false },
  storage: { buckets: false, signedUrls: false, transforms: false, directUpload: false },
  functions: { deploy: false, invoke: false, webhooks: false },
  schema: { create: false, migrate: false, policies: false },
}

/** Capabilities with some branches replaced, for adapters declaring their own. */
export function capabilities(patch: {
  [K in keyof Capabilities]?: Partial<Capabilities[K]>
}): Capabilities {
  return {
    auth: { ...NO_CAPABILITIES.auth, ...patch.auth },
    db: { ...NO_CAPABILITIES.db, ...patch.db },
    realtime: { ...NO_CAPABILITIES.realtime, ...patch.realtime },
    storage: { ...NO_CAPABILITIES.storage, ...patch.storage },
    functions: { ...NO_CAPABILITIES.functions, ...patch.functions },
    schema: { ...NO_CAPABILITIES.schema, ...patch.schema },
  }
}
