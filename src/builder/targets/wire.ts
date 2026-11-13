/**
 * One backend's wire protocol, as data the emitters can read.
 *
 * The web runtime carries every dialect and picks one at run time,
 * because the same page is also the preview and the preview can be
 * repointed. A generated Kotlin, Swift or Dart app is nothing of the
 * sort: it is built for one project, whose backend is known at emit
 * time. So the native emitters do not need a dialect table in the
 * app — they need to know which paths to write, and that is what this
 * module hands them.
 *
 * The point of putting it here rather than in each emitter is that
 * four languages disagreeing about where `/rest/v1/` goes is a bug
 * nobody finds until a phone build is in somebody's hands. There is
 * one table, with one set of tests, and the emitters render it.
 *
 * Paths carry `{table}`, `{id}`, `{bucket}` and `{name}` placeholders.
 * Every renderer fills them with its own string concatenation, because
 * escaping is a language's own business.
 */

import type { RuntimeProfile } from '../../backend/runtimeProfile'

/** How a plain `{ column: value }` filter is carried. */
export type FilterStyle =
  /** `?column=value`, which the generated service reads. */
  | 'pairs'
  /** `?select=*&column=eq.value`. */
  | 'postgrest'
  /** `?filter=column='value'`, quoted into an expression. */
  | 'pocketbase'
  /** A filter tree in the body of a POST. */
  | 'tree'
  /** `?queries[0]={"method":"equal",…}`: one JSON document per test. */
  | 'queries'

/** Where the rows are in a reply. `array` means the reply *is* the rows. */
export type ListEnvelope = 'rows' | 'items' | 'array' | 'documents'

/** Where one row is. `self` means the reply is the row; `first` takes [0]. */
export type RowEnvelope = 'row' | 'self' | 'first'

/** A write: the body, how it is wrapped, and what comes back. */
export type WriteStep = {
  method: 'POST' | 'PATCH'
  path: string
  /** The key the fields are nested under, when they are. */
  wrap: string | null
  /**
   * An id the *client* generates, sent beside the body.
   *
   * Appwrite wants `documentId` on every create and takes `unique()`
   * as “you pick one”. Everyone else lets the server decide.
   */
  idField: { key: string; value: string } | null
  prefer: string | null
  envelope: RowEnvelope
}

export type WirePlan = {
  dialect: RuntimeProfile['dialect']
  /** Empty when no backend is configured: the caller supplies the address. */
  base: string
  /** Sent on every request. Publishable values only — see runtimeProfile.ts. */
  headers: Array<[string, string]>
  token: { header: string; prefix: string }

  list: { method: 'GET' | 'POST'; path: string; filter: FilterStyle; envelope: ListEnvelope }
  create: WriteStep & { method: 'POST' }
  modify: WriteStep & { method: 'PATCH' }
  destroy: { method: 'DELETE'; path: string }

  /**
   * Fields this backend names differently from the canvas.
   *
   * Appwrite calls a row's id `$id`; every block a person drew says
   * `row.id`. The pairs are `[on the wire, in the app]`, applied to
   * every row coming back and reversed — dropped, rather than
   * renamed — on the way out, because a document cannot be written
   * with the fields the backend owns. Empty for everyone else, and the
   * emitters then generate nothing at all.
   */
  renames: Array<[string, string]>

  /**
   * `record` is PocketBase's: a confirmed password, and no session
   * back. `account` is Appwrite's: a `userId` the client invents, and
   * no session back either.
   */
  signUp: { path: string; body: 'credentials' | 'record' | 'account'; thenSignIn: boolean }
  /**
   * `then: 'session'` is for backends whose sign-in reply is a
   * *session* rather than a user — it carries the token and nothing
   * the app can display, so the runtime reads the account afterwards.
   */
  signIn: { path: string; identity: 'email' | 'identity'; then: 'session' | null }
  session: { method: 'GET' | 'POST'; path: string }
  /** Null where signing out is a local act only. */
  signOut: { method: 'POST' | 'DELETE'; path: string } | null
  /** `post` asks the backend for the authorize URL; `url` builds it. */
  oauth: { kind: 'post' | 'url'; path: string; suffix: string }
  tokenKey: string
  /** Empty means the reply is the user. */
  userKey: string

  upload: {
    method: 'POST'
    path: string
    /** multipart/form-data rather than raw bytes. */
    form: boolean
    /** The key holding the URL, when the backend answers with one. */
    urlKey: string | null
    /** How to build the URL when it does not. */
    publicPath: string | null
    /** The uploaded record's id goes in the URL, PocketBase style. */
    idInPath: boolean
    /** Where that id is in the reply. */
    idKey: string
    /** Where the stored *filename* is, when the URL needs that too. */
    nameKey: string | null
    /** Text parts sent beside the file in a multipart body. */
    fields: Array<[string, string]>
  }
}

/** The generated Node + SQLite service: the fallback, and the original. */
const TUNGSTEN: Omit<WirePlan, 'base' | 'headers' | 'token' | 'dialect'> = {
  list: { method: 'GET', path: '/data/{table}', filter: 'pairs', envelope: 'rows' },
  create: { method: 'POST', path: '/data/{table}', wrap: null, idField: null, prefer: null, envelope: 'row' },
  modify: { method: 'PATCH', path: '/data/{table}/{id}', wrap: null, idField: null, prefer: null, envelope: 'row' },
  destroy: { method: 'DELETE', path: '/data/{table}/{id}' },
  renames: [],
  signUp: { path: '/auth/sign-up', body: 'credentials', thenSignIn: false },
  signIn: { path: '/auth/sign-in', identity: 'email', then: null },
  session: { method: 'GET', path: '/auth/session' },
  signOut: { method: 'POST', path: '/auth/sign-out' },
  oauth: { kind: 'post', path: '/auth/oauth', suffix: '' },
  tokenKey: 'token',
  userKey: 'user',
  upload: {
    method: 'POST',
    path: '/storage/{bucket}',
    form: false,
    urlKey: 'url',
    publicPath: null,
    idInPath: false,
    idKey: 'id',
    nameKey: null,
    fields: [],
  },
}

const DEFAULT_TOKEN = { header: 'authorization', prefix: 'Bearer ' }

/**
 * Appwrite's own fields, and what the canvas calls them.
 *
 * A block drawn against a table says `row.id` and `row.created_at`
 * whatever the backend underneath is; these three renames are the whole
 * of keeping that promise here.
 */
const APPWRITE_FIELDS: Array<[string, string]> = [
  ['$id', 'id'],
  ['$createdAt', 'created_at'],
  ['$updatedAt', 'updated_at'],
]

/**
 * The plan for a project's backend.
 *
 * No profile is the normal state of a project nobody has configured,
 * and it means what it has always meant: the app calls the service
 * Tungsten generates, at whatever address the emitter bakes in.
 */
export function wirePlan(profile: RuntimeProfile | undefined): WirePlan {
  if (!profile) return { dialect: 'tungsten', base: '', headers: [], token: DEFAULT_TOKEN, ...TUNGSTEN }

  const headers = Object.entries(profile.headers)
  const shared = { base: profile.base, headers, token: profile.token }
  const users = profile.users ?? 'users'

  switch (profile.dialect) {
    case 'postgrest':
      return {
        dialect: 'postgrest',
        ...shared,
        list: { method: 'GET', path: '/rest/v1/{table}', filter: 'postgrest', envelope: 'array' },
        // Without `return=representation` PostgREST answers 201 with an
        // empty body, and the block's "saved row" output is nothing.
        create: { method: 'POST', path: '/rest/v1/{table}', wrap: null, idField: null, prefer: 'return=representation', envelope: 'first' },
        modify: { method: 'PATCH', path: '/rest/v1/{table}?id=eq.{id}', wrap: null, idField: null, prefer: 'return=representation', envelope: 'first' },
        destroy: { method: 'DELETE', path: '/rest/v1/{table}?id=eq.{id}' },
        renames: [],
        signUp: { path: '/auth/v1/signup', body: 'credentials', thenSignIn: false },
        signIn: { path: '/auth/v1/token?grant_type=password', identity: 'email', then: null },
        session: { method: 'GET', path: '/auth/v1/user' },
        signOut: { method: 'POST', path: '/auth/v1/logout' },
        oauth: { kind: 'url', path: '/auth/v1/authorize?provider=', suffix: '' },
        tokenKey: 'access_token',
        userKey: 'user',
        upload: {
          method: 'POST',
          path: '/storage/v1/object/{bucket}/{name}',
          form: false,
          urlKey: null,
          publicPath: '/storage/v1/object/public/{bucket}/{name}',
          idInPath: false,
          idKey: 'id',
          nameKey: null,
          fields: [],
        },
      }

    case 'pocketbase':
      return {
        dialect: 'pocketbase',
        ...shared,
        list: { method: 'GET', path: '/api/collections/{table}/records', filter: 'pocketbase', envelope: 'items' },
        create: { method: 'POST', path: '/api/collections/{table}/records', wrap: null, idField: null, prefer: null, envelope: 'self' },
        modify: { method: 'PATCH', path: '/api/collections/{table}/records/{id}', wrap: null, idField: null, prefer: null, envelope: 'self' },
        destroy: { method: 'DELETE', path: '/api/collections/{table}/records/{id}' },
        renames: [],
        // Creating the record does not start a session, so the app signs
        // in straight afterwards rather than returning a user who cannot
        // read anything.
        signUp: { path: `/api/collections/${users}/records`, body: 'record', thenSignIn: true },
        signIn: { path: `/api/collections/${users}/auth-with-password`, identity: 'identity', then: null },
        session: { method: 'POST', path: `/api/collections/${users}/auth-refresh` },
        signOut: null,
        oauth: { kind: 'url', path: '/api/oauth2-redirect?provider=', suffix: '' },
        tokenKey: 'token',
        userKey: 'record',
        upload: {
          method: 'POST',
          path: '/api/collections/{bucket}/records',
          form: true,
          urlKey: null,
          publicPath: '/api/files/{bucket}/{id}/{name}',
          idInPath: true,
          idKey: 'id',
          // A PocketBase file field holds the *stored* name, which is
          // not the name that was uploaded: it is suffixed to keep two
          // files of the same name apart.
          nameKey: 'file',
          fields: [],
        },
      }

    case 'vortex':
      return {
        dialect: 'vortex',
        ...shared,
        list: { method: 'POST', path: '/v1/data/{table}/query', filter: 'tree', envelope: 'rows' },
        create: { method: 'POST', path: '/v1/data/{table}', wrap: 'row', idField: null, prefer: null, envelope: 'row' },
        modify: { method: 'PATCH', path: '/v1/data/{table}/{id}', wrap: 'changes', idField: null, prefer: null, envelope: 'row' },
        destroy: { method: 'DELETE', path: '/v1/data/{table}/{id}' },
        renames: [],
        signUp: { path: '/v1/auth/sign-up', body: 'credentials', thenSignIn: false },
        signIn: { path: '/v1/auth/sign-in', identity: 'email', then: null },
        session: { method: 'GET', path: '/v1/auth/session' },
        signOut: { method: 'POST', path: '/v1/auth/sign-out' },
        oauth: { kind: 'url', path: '/v1/auth/oauth/', suffix: '' },
        tokenKey: 'token',
        userKey: 'user',
        upload: {
          method: 'POST',
          path: '/v1/storage/{bucket}/{name}',
          form: false,
          urlKey: 'url',
          publicPath: '/v1/storage/{bucket}/{name}',
          idInPath: false,
          idKey: 'id',
          nameKey: null,
          fields: [],
        },
      }

    case 'appwrite': {
      // Two things live in the path rather than a header: the database
      // a collection belongs to, and — for a URL opened outside the
      // app, where no header can travel — the project.
      const database = profile.database || 'default'
      const documents = `/databases/${database}/collections/{table}/documents`
      const project = profile.headers['x-appwrite-project'] ?? ''
      const query = project ? `?project=${encodeURIComponent(project)}` : ''
      return {
        dialect: 'appwrite',
        ...shared,
        list: { method: 'GET', path: documents, filter: 'queries', envelope: 'documents' },
        create: {
          method: 'POST',
          path: documents,
          // The fields go under `data`; `unique()` is Appwrite's way of
          // saying the server should pick the id after all.
          wrap: 'data',
          idField: { key: 'documentId', value: 'unique()' },
          prefer: null,
          envelope: 'self',
        },
        modify: {
          method: 'PATCH',
          path: `${documents}/{id}`,
          wrap: 'data',
          idField: null,
          prefer: null,
          envelope: 'self',
        },
        destroy: { method: 'DELETE', path: `${documents}/{id}` },
        renames: APPWRITE_FIELDS,
        signUp: { path: '/account', body: 'account', thenSignIn: true },
        // The reply to this is a *session*, which carries the secret and
        // nothing a screen can show, so the runtime reads the account
        // straight afterwards.
        signIn: { path: '/account/sessions/email', identity: 'email', then: 'session' },
        session: { method: 'GET', path: '/account' },
        signOut: { method: 'DELETE', path: '/account/sessions/current' },
        oauth: { kind: 'url', path: '/account/sessions/oauth2/', suffix: query },
        tokenKey: 'secret',
        // `GET /account` answers with the account itself, and the
        // session reply has no user in it to dig out.
        userKey: '',
        upload: {
          method: 'POST',
          path: '/storage/buckets/{bucket}/files',
          form: true,
          urlKey: null,
          publicPath: `/storage/buckets/{bucket}/files/{id}/view${query}`,
          idInPath: true,
          idKey: '$id',
          nameKey: null,
          fields: [['fileId', 'unique()']],
        },
      }
    }

    default:
      return { dialect: 'tungsten', ...shared, ...TUNGSTEN }
  }
}

/**
 * A path with its placeholders replaced by expressions in some language.
 *
 * The parts come back as a list so a renderer can join them with its own
 * concatenation operator and its own escaping call, which is the only
 * part of this that differs between Kotlin, Swift and Dart.
 */
export function pathParts(path: string, values: Record<string, string>): Array<{ text: string } | { slot: string }> {
  const parts: Array<{ text: string } | { slot: string }> = []
  let rest = path
  while (rest) {
    const open = rest.indexOf('{')
    if (open < 0) { parts.push({ text: rest }); break }
    if (open > 0) parts.push({ text: rest.slice(0, open) })
    const close = rest.indexOf('}', open)
    if (close < 0) { parts.push({ text: rest.slice(open) }); break }
    const name = rest.slice(open + 1, close)
    if (!(name in values)) {
      throw new Error(`The wire path “${path}” uses {${name}}, which this call does not have.`)
    }
    parts.push({ slot: values[name] })
    rest = rest.slice(close + 1)
  }
  return parts.filter((part) => ('slot' in part ? true : part.text.length > 0))
}

/**
 * The path, rendered in one language.
 *
 * `quote` wraps a literal, `escape` wraps a value that has to survive a
 * URL, and `join` is the concatenation operator. Three lines of
 * configuration instead of three copies of this loop.
 */
export function renderPath(
  path: string,
  values: Record<string, string>,
  language: { quote: (text: string) => string; escape: (expression: string) => string; join: string },
): string {
  return pathParts(path, values)
    .map((part) => ('slot' in part ? language.escape(part.slot) : language.quote(part.text)))
    .join(language.join)
}
