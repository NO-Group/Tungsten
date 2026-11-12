/**
 * The plumbing every adapter shares.
 *
 * One JSON client, one error translation, one filter renderer. Three
 * adapters written independently would disagree about what a 401 means
 * and about how `in` is spelled, and the disagreements would surface as
 * bugs in generated apps rather than here.
 */

import {
  BackendError,
  type AdapterConfig,
  type Filter,
  type FilterTest,
  type HttpReply,
  type HttpSend,
  type SortOrder,
} from '../contract'

/**
 * One configured field, as a string.
 *
 * A config holds both pasted text and injected transports, so reading a
 * field goes through here rather than through a cast: a function that
 * reached a URL by accident would be a credential in a query string.
 */
export function field(config: AdapterConfig, key: string): string | undefined {
  const value = config[key]
  return typeof value === 'string' ? value : undefined
}

/** The fetch an adapter uses when the config did not inject one. */
export function defaultSend(): HttpSend {
  const global = (globalThis as unknown as { fetch?: HttpSend }).fetch
  if (!global) {
    return () => Promise.reject(new BackendError('offline', 'This build has no fetch, so it cannot reach a backend.'))
  }
  return (url, init) => global(url, init)
}

/** Maps a status onto the contract's vocabulary. */
export function codeForStatus(status: number): BackendError['code'] {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 422 || status === 400) return 'invalid'
  if (status === 429) return 'rate-limited'
  if (status === 501) return 'unsupported'
  return 'unknown'
}

/**
 * The sentence hiding inside an error body.
 *
 * Backends disagree about where they put it -- `error`, `message`,
 * `msg`, `error_description`, or a bare string -- and a user staring at
 * `{"code":"PGRST116"}` has been told nothing. Anything unrecognisable
 * falls back to the status line rather than to the raw JSON.
 */
export function messageFrom(body: string, status: number): { message: string; detail?: string } {
  const trimmed = body.trim()
  if (!trimmed) return { message: `The backend answered ${status} with nothing else.` }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ['error_description', 'message', 'error', 'msg', 'hint', 'detail']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return { message: value.trim(), detail: trimmed }
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>).message
        if (typeof nested === 'string' && nested.trim()) return { message: nested.trim(), detail: trimmed }
      }
    }
  } catch {
    // Not JSON. A plain-text body is already the sentence.
    if (trimmed.length < 200) return { message: trimmed }
  }
  return { message: `The backend answered ${status}.`, detail: trimmed }
}

export type JsonCall = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /** Bytes instead of JSON, for uploads. */
  raw?: Uint8Array | string
}

/** One JSON request, with the error handling every call needs. */
export async function callJson<T = unknown>(send: HttpSend, call: JsonCall): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...call.headers }
  let body: string | Uint8Array | undefined
  if (call.raw !== undefined) {
    body = call.raw
  } else if (call.body !== undefined) {
    body = JSON.stringify(call.body)
    headers['content-type'] = headers['content-type'] ?? 'application/json'
  }

  let reply: HttpReply
  try {
    reply = await send(call.url, { method: call.method ?? 'GET', headers, body })
  } catch (error) {
    throw new BackendError('offline', `Could not reach ${origin(call.url)}.`, String(error))
  }

  const text = await reply.text()
  if (!reply.ok) {
    const { message, detail } = messageFrom(text, reply.status)
    throw new BackendError(codeForStatus(reply.status), message, detail)
  }
  if (!text.trim()) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

/** `https://db.example.com/rest/v1/orders` → `db.example.com`. */
export function origin(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Joins a base and a path without doubling or dropping the slash. */
export function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/* ---------------------------------------------------------------- filters */

/** Is this node a single test rather than a group? */
export function isTest(filter: Filter): filter is FilterTest {
  return 'column' in filter
}

/**
 * Renders a filter as SQL, with the values pulled out.
 *
 * Used by the adapters that end up at a database -- Vortex's `/v1/sql`,
 * the self-hosted service -- and by the schema planners for policy
 * expressions. Values are never interpolated: the caller binds them,
 * because a filter can hold anything a user typed into an inspector.
 */
export function filterToSql(filter: Filter, start = 1): { text: string; values: unknown[] } {
  const values: unknown[] = []
  let next = start

  const render = (node: Filter): string => {
    if ('all' in node) return node.all.length ? `(${node.all.map(render).join(' and ')})` : 'true'
    if ('any' in node) return node.any.length ? `(${node.any.map(render).join(' or ')})` : 'false'
    if ('not' in node) return `not ${render(node.not)}`

    const column = quoteIdentifier(node.column)
    switch (node.op) {
      case 'is-null': return `${column} is null`
      case 'not-null': return `${column} is not null`
      case 'in': {
        const list = Array.isArray(node.value) ? node.value : [node.value as string]
        if (!list.length) return 'false'
        const marks = list.map((value) => { values.push(value); return `$${next++}` })
        return `${column} in (${marks.join(', ')})`
      }
      case 'like':
      case 'ilike': {
        values.push(node.value)
        return `${column} ${node.op} $${next++}`
      }
      case 'contains': {
        values.push(node.value)
        return `${column} @> $${next++}`
      }
      default: {
        const operators: Record<string, string> = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }
        values.push(node.value)
        return `${column} ${operators[node.op] ?? '='} $${next++}`
      }
    }
  }

  return { text: render(filter), values }
}

/** An identifier safe to put in generated SQL, or a thrown refusal. */
export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BackendError('invalid', `“${name}” is not a column or table name Tungsten will put in a query.`)
  }
  return `"${name}"`
}

/** `order=created_at.desc,title.asc`, which several REST backends share. */
export function orderToParam(order: SortOrder[] | undefined): string | undefined {
  if (!order?.length) return undefined
  return order.map((entry) => `${entry.column}.${entry.direction ?? 'asc'}`).join(',')
}

/* -------------------------------------------------------------- uploads */

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; data: Uint8Array; contentType?: string }

/**
 * A `multipart/form-data` body, built by hand.
 *
 * Two backends in the catalogue take file uploads only as form data,
 * and `FormData` is not something an adapter can rely on: these run in
 * a worker, in Node during tests, and in a generated app's runtime.
 * Building the bytes here keeps the adapters transport-agnostic and,
 * more usefully, keeps the boundary deterministic so a test can read
 * the body it produced.
 */
export function multipartBody(parts: MultipartPart[], boundary = `tungsten${'-'.repeat(8)}${parts.length}`): {
  body: Uint8Array
  contentType: string
} {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []

  for (const part of parts) {
    const disposition = 'filename' in part
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`
    const type = 'filename' in part ? `\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}` : ''
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`))
    chunks.push('filename' in part ? part.data : encoder.encode(part.value))
    chunks.push(encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))

  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

/** Upload data of any accepted shape as bytes. */
export async function toBytes(data: Uint8Array | Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(await data.arrayBuffer())
}
