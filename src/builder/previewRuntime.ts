/**
 * The sandbox preview.
 *
 * The preview is not a picture of the interface: it is the interface, running
 * the program the blocks generated, in an iframe with no access to anything.
 * Clicking a button runs the click handler; typing in an input is readable by
 * the blocks that read it. There is no build step between drawing a graph and
 * using the thing it describes.
 *
 * Backend calls are stubbed rather than faked quietly. A query answers with
 * seeded rows and says in the log that it did, because a preview that silently
 * pretends to reach a database teaches the user something false.
 */

import { uiThemeCss } from './uiTokens'
import { renderDocumentBody, type UiDocument } from './uiSchema'
import type { RuntimeProfile } from '../backend/runtimeProfile'

/** What the frame posts back to the workbench. */
export type PreviewMessage =
  | { kind: 'ready' }
  | { kind: 'log'; text: string }
  | { kind: 'error'; text: string; line?: number }

/** Marks a message as ours; the frame is sandboxed, so origin is 'null'. */
export const PREVIEW_CHANNEL = 'tungsten.builder.preview'

/**
 * The preamble that runs inside the generated program's own function body.
 *
 * It is kept as an array so the line count is a fact rather than a guess:
 * the user's first line is always `PREAMBLE.length + 1` of the body, which is
 * what turns a thrown error's line number back into a block.
 */
const PREAMBLE = [
  'try { null.x } catch (error) { __setOffset(__lineOf(error) - 1); }',
]

export const PREVIEW_PREAMBLE_LINES = PREAMBLE.length

/** The runtime the generated code is handed: the whole of its world. */
const RUNTIME = String.raw`
const post = (message) => parent.postMessage({ channel: ${JSON.stringify(PREVIEW_CHANNEL)}, ...message }, '*')
const log = (...values) => post({ kind: 'log', text: values.map(format).join(' ') })

function format(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function lineOf(error) {
  const match = /<anonymous>:(\d+):\d+/.exec(error && error.stack ? error.stack : '')
  return match ? Number(match[1]) : 0
}

/** A thrown error, reported against the line of the generated program. */
function report(error, offset) {
  const raw = lineOf(error)
  const line = raw ? raw - offset - PREAMBLE_LINES : 0
  post({ kind: 'error', text: error && error.message ? error.message : String(error), line: line > 0 ? line : undefined })
}

const root = document.getElementById('app')

/** Puts an element on the page, or updates the one already there. */
/**
 * One render pass.
 *
 * Elements are reused by id, which is what lets a handler run again
 * without the page doubling. But a component drawn inside a loop asks for
 * the same id once per item, and reusing it there would collapse a list of
 * fifty rows into one. So an id is claimed per pass: the first use is the
 * id itself, the second becomes "id~2", and so on.
 *
 * Anything not claimed during a pass belonged to a previous one and is
 * removed, which is how a list that shrank stops showing rows that are no
 * longer in it.
 */
let claimed = new Map()
let touched = new Set()
let anonymous = 0

function beginPass() {
  claimed = new Map()
  touched = new Set()
  drawInto = root
  // Components with no id of their own are numbered by the order they are
  // drawn in. Counting the elements already on the page instead -- which
  // is what this did -- made the numbers climb on every pass, so a
  // re-render replaced the page rather than updating it.
  anonymous = 0
}

function endPass() {
  // Everything with an id, at any depth: a row removed from a list takes
  // its container and that container's children with it.
  for (const element of [...root.querySelectorAll('[id]')]) {
    if (!touched.has(element.id)) element.remove()
  }
}

/**
 * Where new elements go.
 *
 * A container sets this while the blocks inside it draw, so nesting needs
 * no knowledge anywhere else: every renderer appends to "here", and the
 * stack decides what here means.
 *
 * Emphatically not named after the window property this frame posts its
 * messages to: shadowing that cut the preview off from the workbench
 * entirely, and every message with it.
 *
 * Note also that this whole runtime lives inside a template literal, so a
 * backtick in a comment ends it. That is how this line was written twice.
 */
let drawInto = root

function upsert(baseId, create) {
  const count = (claimed.get(baseId) || 0) + 1
  claimed.set(baseId, count)
  const id = count === 1 ? baseId : baseId + '~' + count
  touched.add(id)

  let element = document.getElementById(id)
  if (!element) {
    element = create()
    element.id = id
  }
  // Re-appending is how an element follows its container when the graph
  // moves it, and is a no-op when it is already in the right place.
  if (element.parentElement !== drawInto) drawInto.append(element)
  return element
}

/** True when an element is one of the copies a repeat produced. */
function isCopyOf(id, baseId) {
  return id === baseId || id.indexOf(baseId + '~') === 0
}

/** The token names a style property may name, mirroring uiSchema. */
const TOKENS = ['surface', 'raised', 'border', 'text', 'muted', 'accent', 'accent-ink', 'danger']
const colour = (value) => (TOKENS.indexOf(String(value)) >= 0 ? 'var(--app-' + value + ')' : String(value))

/** Applies the style properties a component carries. */
function applyStyle(element, style) {
  if (!style) return
  if (typeof style.radius === 'number') element.style.borderRadius = style.radius + 'px'
  if (style.padding) element.style.padding = String(style.padding)
  if (style.background) element.style.background = colour(style.background)
  if (style.color) element.style.color = colour(style.color)
  if (style.width) element.style.width = String(style.width)
  if (style.align) element.style.textAlign = String(style.align)
}

/**
 * How to read an interactive element, by id.
 *
 * A text field answers with .value and needs nothing here, but a checkbox
 * answers with .checked and a dropdown drawn this pass may not be in the
 * document yet. Registering a reader as the element is drawn means
 * render.value asks the control itself rather than guessing from the tag.
 */
const readers = new Map()

const render = {
  button: ({ id, text, ...style }) => {
    const element = upsert(String(id), () => document.createElement('button'))
    element.textContent = String(text)
    applyStyle(element, style)
    return element
  },
  text: (value, style) => {
    anonymous += 1
    const element = upsert('text-' + anonymous, () => document.createElement('p'))
    element.textContent = format(value)
    applyStyle(element, style)
    return element
  },
  heading: ({ id, text, level, ...style }) => {
    const rank = Math.min(6, Math.max(1, Math.round(Number(level) || 2)))
    const element = upsert(String(id), () => document.createElement('h' + rank))
    // A level change makes a different element, so the old one is replaced
    // rather than relabelled: an h2 cannot become an h3 in place.
    if (element.tagName !== 'H' + rank) {
      const replacement = document.createElement('h' + rank)
      replacement.id = element.id
      element.replaceWith(replacement)
      replacement.textContent = format(text)
      applyStyle(replacement, style)
      return replacement
    }
    element.textContent = format(text)
    applyStyle(element, style)
    return element
  },
  image: ({ id, src, alt, ...style }) => {
    const source = String(src || '')
    const label = String(alt == null ? 'Image' : alt)
    const element = upsert(String(id), () => document.createElement(source ? 'img' : 'div'))
    const wanted = source ? 'IMG' : 'DIV'
    if (element.tagName !== wanted) {
      const replacement = document.createElement(source ? 'img' : 'div')
      replacement.id = element.id
      element.replaceWith(replacement)
      return render.image({ id: replacement.id, src: source, alt: label, ...style })
    }
    if (source) {
      element.src = source
      element.alt = label
    } else {
      element.className = 'placeholder'
      element.textContent = label
    }
    applyStyle(element, style)
    return element
  },
  checkbox: ({ id, label, checked, ...style }) => {
    const name = String(id)
    const element = upsert(name, () => {
      const wrapper = document.createElement('label')
      wrapper.className = 'checkbox'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = checked === true
      wrapper.append(box, document.createElement('span'))
      return wrapper
    })
    element.querySelector('span').textContent = String(label == null ? '' : label)
    applyStyle(element, style)
    // Deliberately not re-applying the checked flag on every pass: it is the
    // starting state, and overwriting it would untick the box under the
    // user whenever anything else on the screen re-rendered.
    readers.set(name, () => (element.querySelector('input').checked ? 'true' : 'false'))
    return element
  },
  select: ({ id, options, value, ...style }) => {
    const name = String(id)
    const choices = String(options == null ? '' : options)
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
    const element = upsert(name, () => document.createElement('select'))
    const current = element.value
    const wanted = choices.join('\u0000')
    // Rebuilt only when the choices actually changed, so re-rendering does
    // not throw away what the user picked.
    if (element.dataset.options !== wanted) {
      element.dataset.options = wanted
      element.textContent = ''
      for (const choice of choices) {
        const option = document.createElement('option')
        option.textContent = choice
        element.append(option)
      }
      const start = current || String(value || '')
      if (choices.indexOf(start) >= 0) element.value = start
    }
    applyStyle(element, style)
    readers.set(name, () => element.value)
    return element
  },
  link: ({ id, text, href, ...style }) => {
    const element = upsert(String(id), () => document.createElement('a'))
    element.textContent = String(text == null ? '' : text)
    element.href = String(href || '#')
    element.target = '_blank'
    element.rel = 'noreferrer noopener'
    applyStyle(element, style)
    return element
  },
  divider: ({ id, ...style }) => {
    const element = upsert(String(id), () => document.createElement('hr'))
    applyStyle(element, style)
    return element
  },
  /**
   * A row or a column, with whatever is drawn inside it.
   *
   * The body is awaited while this element is the current parent, which
   * is safe because the generated program runs its statements in order --
   * there is never a second body drawing at the same time.
   */
  stack: async ({ id, direction, gap, ...style }, body) => {
    const element = upsert(String(id), () => document.createElement('div'))
    element.style.display = 'flex'
    element.style.flexDirection = direction === 'row' ? 'row' : 'column'
    element.style.gap = (Number(gap) || 0) + 'px'
    element.style.alignItems = direction === 'row' ? 'center' : 'flex-start'
    applyStyle(element, style)

    const previous = drawInto
    drawInto = element
    try {
      await body()
    } finally {
      drawInto = previous
    }
    return element
  },
  /**
   * What is in a control right now, by element id.
   *
   * Controls that cannot answer with .value register a reader when they
   * draw. The DOM fallback still handles the case where a start handler
   * reads a field before anything has drawn it this pass.
   */
  value: (id) => {
    const name = String(id)
    const reader = readers.get(name)
    if (reader) return reader()
    const element = document.getElementById(name)
    if (!element) return ''
    if (element.type === 'checkbox') return element.checked ? 'true' : 'false'
    const box = element.querySelector ? element.querySelector('input[type=checkbox]') : null
    if (box) return box.checked ? 'true' : 'false'
    return 'value' in element ? element.value : ''
  },
  input: ({ id, placeholder, ...style }) => {
    const element = upsert(String(id), () => document.createElement('input'))
    element.placeholder = String(placeholder ?? '')
    applyStyle(element, style)
    return { get value() { return element.value } }
  },
}

/**
 * Re-runs the start handlers.
 *
 * Every renderer here upserts by id rather than appending, so running the
 * handlers again updates the elements that exist instead of duplicating
 * them. That is what makes a variable change visible: set it, and what
 * draws it is drawn again.
 */
function rerender() {
  // A pass, so ids are claimed from scratch and rows that are no longer
  // produced -- or belong to the screen just left -- are cleared away
  // afterwards.
  beginPass()
  Promise.all(handlersOf(current).map((handler) => guarded(handler))).then(endPass)
}

const app = {
  /**
   * The variables, in the sandbox.
   *
   * Page state is a plain object. App state is written through to
   * localStorage, so a reload keeps it -- which is the distinction
   * between the two scopes, made real rather than described.
   */
  state: (initial) => {
    const scopes = { page: { ...(initial.page || {}) }, app: { ...(initial.app || {}) } }
    try {
      Object.assign(scopes.app, JSON.parse(localStorage.getItem('tungsten.preview.state') || '{}'))
    } catch { /* Nothing stored, or storage refused: the defaults stand. */ }

    resetPage = () => { scopes.page = { ...(initial.page || {}) } }
    const scopeOf = (name) => (name in scopes.page ? 'page' : 'app')
    return {
      get: (name) => scopes[scopeOf(name)][name],
      set: (name, value) => {
        const scope = scopeOf(name)
        scopes[scope][name] = value
        if (scope === 'app') {
          try { localStorage.setItem('tungsten.preview.state', JSON.stringify(scopes.app)) } catch { /* ignore */ }
        }
        rerender()
        return value
      },
    }
  },
  /**
   * Declares the screens. The first is where the app starts, unless the
   * workbench asked for a particular one -- which it does, so the preview
   * shows the screen being drawn rather than always the first.
   */
  screens: (names) => {
    screens = Array.prototype.slice.call(names).map(String)
    if (screens.indexOf(current) < 0) current = screens[0]
    return screens
  },
  screen: (name) => ({
    onStart: (handler) => { starts.push({ screen: String(name), handler: handler }) },
    onClick: (target, handler) => bindClick(String(name), target, handler),
  }),
  onStart: (handler) => { starts.push({ screen: screens[0], handler: handler }) },
  onClick: (target, handler) => bindClick(screens[0], target, handler),
  currentScreen: () => current,
  goTo: (name) => {
    const target = String(name)
    if (screens.indexOf(target) < 0) {
      log('No screen called "' + target + '". Add it in the screen bar, or pick one that exists.')
      return current
    }
    if (target === current) return current
    trail.push(current)
    enter(target)
    return current
  },
  back: () => {
    if (!trail.length) {
      log('Nothing to go back to: this is the screen the app started on.')
      return current
    }
    enter(trail.pop())
    return current
  },
}

/**
 * Binds a click, delegated from the root rather than to one element: a
 * button inside a repeat exists once per row, and every one of them is
 * that button. Binding by id would only ever reach the first.
 */
function bindClick(screen, target, handler) {
  bindings.push(() => {
    const name = String(target)
    if (screen === current && !document.getElementById(name)) {
      log('No element with id "' + name + '" to click. Add a Button block with that id.')
    }
    root.addEventListener('click', (event) => {
      // A handler belongs to its screen: the element it names can exist on
      // two of them, and only the one being shown should answer.
      if (screen !== current) return
      const hit = event.target && event.target.closest ? event.target.closest('[id]') : null
      if (hit && isCopyOf(hit.id, name)) void guarded(handler)
    })
  })
}

/**
 * Where the backend is, if there is one.
 *
 * The same four services answer three ways over. Inside the IDE there
 * is no server and must not be one -- a preview that wrote to a
 * database would be a preview that could ruin your afternoon -- so the
 * calls are simulated and say so in the log. A build with a backend
 * configured carries that backend's profile and speaks its dialect. A
 * build without one falls back to the Node service Tungsten generates,
 * which is where this runtime started.
 *
 * window.TUNGSTEN_API and window.TUNGSTEN_BACKEND win over whatever is
 * baked in, so a built app can be pointed at staging by one line in the
 * page rather than a rebuild.
 */
const PROFILE = (typeof window !== 'undefined' && window.TUNGSTEN_BACKEND) || BAKED_PROFILE || null
const BACKEND = (typeof window !== 'undefined' && window.TUNGSTEN_API) || (PROFILE && PROFILE.base) || API_BASE || ''
const TOKEN_SLOT = (PROFILE && PROFILE.token) || { header: 'authorization', prefix: 'Bearer ' }
const USERS = (PROFILE && PROFILE.users) || 'users'

let AUTH_TOKEN = null

async function backend(path, options) {
  const settings = options || {}
  const headers = Object.assign({ accept: 'application/json' }, (PROFILE && PROFILE.headers) || {})
  // A signed-in user's token replaces the publishable key the profile
  // carries, rather than being sent beside it.
  if (AUTH_TOKEN) headers[TOKEN_SLOT.header] = TOKEN_SLOT.prefix + AUTH_TOKEN
  if (settings.json !== undefined) headers['content-type'] = 'application/json'
  Object.assign(headers, settings.headers || {})

  const response = await fetch(BACKEND + path, {
    method: settings.method || 'GET',
    headers,
    body: settings.json !== undefined ? JSON.stringify(settings.json) : settings.body,
  })
  const text = await response.text()
  let parsed = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { body: text } }
  if (!response.ok) {
    // Every backend puts its sentence somewhere else, and a status code
    // on its own tells the user nothing they can act on.
    const said = parsed.error || parsed.message || parsed.msg || parsed.error_description
    throw new Error(typeof said === 'string' ? said : ('Request failed: ' + response.status))
  }
  return parsed
}

const nameOf = (file) => (file && file.name) || 'upload'
const blobOf = (file) => (file instanceof Blob ? file : new Blob([String(file == null ? '' : file)]))
const pairs = (where) => Object.keys(where || {}).map((key) => [key, where[key]])

/**
 * One entry per wire protocol.
 *
 * The blocks never see this: they call db.select and the dialect
 * decides whether that is a query string, a PostgREST parameter, a
 * PocketBase filter expression or a POSTed filter tree. Adding a
 * backend is adding an entry here and a profile in runtimeProfile.ts.
 */
const WIRE = {
  tungsten: {
    list: (table, where) => ({
      path: '/data/' + table + (pairs(where).length ? '?' + new URLSearchParams(where).toString() : ''),
    }),
    rows: (reply) => reply.rows || [],
    create: (table, row) => ({ path: '/data/' + table, method: 'POST', json: row || {} }),
    row: (reply) => reply.row || reply,
    patch: (table, id, changes) => ({ path: '/data/' + table + '/' + id, method: 'PATCH', json: changes || {} }),
    drop: (table, id) => ({ path: '/data/' + table + '/' + id, method: 'DELETE' }),
    signUp: (email, password) => ({ path: '/auth/sign-up', method: 'POST', json: { email, password } }),
    signIn: (email, password) => ({ path: '/auth/sign-in', method: 'POST', json: { email, password } }),
    session: () => ({ path: '/auth/session' }),
    signOut: () => ({ path: '/auth/sign-out', method: 'POST' }),
    oauth: (provider) => ({ path: '/auth/oauth', method: 'POST', json: { provider } }),
    token: (reply) => reply.token,
    user: (reply) => reply.user || reply,
    upload: (bucket, file) => ({
      path: '/storage/' + bucket,
      method: 'POST',
      body: blobOf(file),
      headers: { 'x-file-name': nameOf(file) },
    }),
    uploaded: (reply) => reply.url || '',
  },

  postgrest: {
    list: (table, where) => ({
      path: '/rest/v1/' + table + '?select=*'
        + pairs(where).map((pair) => '&' + encodeURIComponent(pair[0]) + '=eq.' + encodeURIComponent(pair[1])).join(''),
    }),
    // PostgREST answers with the array itself, not an envelope.
    rows: (reply) => (Array.isArray(reply) ? reply : reply.rows || []),
    create: (table, row) => ({
      path: '/rest/v1/' + table,
      method: 'POST',
      json: row || {},
      headers: { prefer: 'return=representation' },
    }),
    row: (reply) => (Array.isArray(reply) ? reply[0] || {} : reply),
    patch: (table, id, changes) => ({
      path: '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id),
      method: 'PATCH',
      json: changes || {},
      headers: { prefer: 'return=representation' },
    }),
    drop: (table, id) => ({ path: '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), method: 'DELETE' }),
    signUp: (email, password) => ({ path: '/auth/v1/signup', method: 'POST', json: { email, password } }),
    signIn: (email, password) => ({ path: '/auth/v1/token?grant_type=password', method: 'POST', json: { email, password } }),
    session: () => ({ path: '/auth/v1/user' }),
    signOut: () => ({ path: '/auth/v1/logout', method: 'POST' }),
    oauth: (provider, redirect) => ({
      url: BACKEND + '/auth/v1/authorize?provider=' + encodeURIComponent(provider)
        + '&redirect_to=' + encodeURIComponent(redirect),
    }),
    token: (reply) => reply.access_token,
    user: (reply) => reply.user || reply,
    upload: (bucket, file) => ({
      path: '/storage/v1/object/' + bucket + '/' + encodeURIComponent(nameOf(file)),
      method: 'POST',
      body: blobOf(file),
    }),
    uploaded: (reply, bucket, name) => BACKEND + '/storage/v1/object/public/' + bucket + '/' + encodeURIComponent(name),
  },

  pocketbase: {
    list: (table, where) => ({
      path: '/api/collections/' + table + '/records'
        + (pairs(where).length
          ? '?filter=' + encodeURIComponent(
            pairs(where).map((pair) => pair[0] + "='" + String(pair[1]).replace(/'/g, "\\'") + "'").join(' && '),
          )
          : ''),
    }),
    rows: (reply) => reply.items || [],
    create: (table, row) => ({ path: '/api/collections/' + table + '/records', method: 'POST', json: row || {} }),
    row: (reply) => reply,
    patch: (table, id, changes) => ({
      path: '/api/collections/' + table + '/records/' + id,
      method: 'PATCH',
      json: changes || {},
    }),
    drop: (table, id) => ({ path: '/api/collections/' + table + '/records/' + id, method: 'DELETE' }),
    // Creating the record does not sign it in, so the runtime does both.
    signUp: (email, password) => ({
      path: '/api/collections/' + USERS + '/records',
      method: 'POST',
      json: { email, password, passwordConfirm: password },
      then: 'sign-in',
    }),
    signIn: (email, password) => ({
      path: '/api/collections/' + USERS + '/auth-with-password',
      method: 'POST',
      json: { identity: email, password },
    }),
    session: () => ({ path: '/api/collections/' + USERS + '/auth-refresh', method: 'POST' }),
    signOut: () => null,
    oauth: (provider, redirect) => ({
      url: BACKEND + '/api/oauth2-redirect?provider=' + encodeURIComponent(provider)
        + '&redirect=' + encodeURIComponent(redirect),
    }),
    token: (reply) => reply.token,
    user: (reply) => reply.record || reply,
    upload: (bucket, file) => {
      const form = new FormData()
      form.append('file', blobOf(file), nameOf(file))
      return { path: '/api/collections/' + bucket + '/records', method: 'POST', body: form }
    },
    // A file belongs to a record here, so the URL needs the id that
    // came back from the upload.
    uploaded: (reply, bucket) => BACKEND + '/api/files/' + bucket + '/' + reply.id + '/'
      + (Array.isArray(reply.file) ? reply.file[0] : reply.file),
  },

  vortex: {
    list: (table, where) => ({
      path: '/v1/data/' + table + '/query',
      method: 'POST',
      json: pairs(where).length
        ? { where: { all: pairs(where).map((pair) => ({ column: pair[0], op: 'eq', value: pair[1] })) } }
        : {},
    }),
    rows: (reply) => reply.rows || [],
    create: (table, row) => ({ path: '/v1/data/' + table, method: 'POST', json: { row: row || {} } }),
    row: (reply) => reply.row || (reply.rows && reply.rows[0]) || {},
    patch: (table, id, changes) => ({
      path: '/v1/data/' + table + '/' + id,
      method: 'PATCH',
      json: { changes: changes || {} },
    }),
    drop: (table, id) => ({ path: '/v1/data/' + table + '/' + id, method: 'DELETE' }),
    signUp: (email, password) => ({ path: '/v1/auth/sign-up', method: 'POST', json: { email, password } }),
    signIn: (email, password) => ({ path: '/v1/auth/sign-in', method: 'POST', json: { email, password } }),
    session: () => ({ path: '/v1/auth/session' }),
    signOut: () => ({ path: '/v1/auth/sign-out', method: 'POST' }),
    oauth: (provider, redirect) => ({
      url: BACKEND + '/v1/auth/oauth/' + encodeURIComponent(provider) + '?redirect=' + encodeURIComponent(redirect),
    }),
    token: (reply) => reply.token || reply.access_token,
    user: (reply) => reply.user || reply,
    upload: (bucket, file) => ({
      path: '/v1/storage/' + bucket + '/' + encodeURIComponent(nameOf(file)),
      method: 'POST',
      body: blobOf(file),
      headers: { 'content-type': (file && file.type) || 'application/octet-stream' },
    }),
    uploaded: (reply, bucket, name) => reply.url || (BACKEND + '/v1/storage/' + bucket + '/' + encodeURIComponent(name)),
  },
}

const wire = WIRE[(PROFILE && PROFILE.dialect) || 'tungsten'] || WIRE.tungsten
const ask = (request) => backend(request.path, request)

// Seeded, obviously fake, and honest about it: a preview must not imply that
// it reached a real database.
const seeds = { users: [{ id: 1, email: 'ada@example.com' }, { id: 2, email: 'grace@example.com' }] }

const db = {
  select: async (table, where) => {
    if (!BACKEND) {
      log('db.select("' + table + '") — preview data' + (where ? ' with a filter' : ''))
      return seeds[table] ? seeds[table].slice() : []
    }
    return wire.rows(await ask(wire.list(table, where)))
  },
  insert: async (table, row) => {
    if (!BACKEND) {
      log('db.insert("' + table + '") — preview only, nothing was written')
      return { id: Math.floor(Math.random() * 1000), ...row }
    }
    return wire.row(await ask(wire.create(table, row)))
  },
  update: async (table, id, changes) => {
    if (!BACKEND) {
      log('db.update("' + table + '", ' + id + ') — preview only, nothing was changed')
      return { id, ...changes }
    }
    return wire.row(await ask(wire.patch(table, id, changes)))
  },
  remove: async (table, id) => {
    if (!BACKEND) {
      log('db.remove("' + table + '", ' + id + ') — preview only, nothing was deleted')
      return { ok: true }
    }
    await ask(wire.drop(table, id))
    return { ok: true }
  },
}

const http = {
  request: async ({ url, method }) => {
    if (!BACKEND) {
      log((method || 'GET') + ' ' + url + ' — stubbed in the preview, no request left the sandbox')
      return { ok: true, url, status: 200, body: null }
    }
    const response = await fetch(url, { method: method || 'GET' })
    const body = await response.text()
    return { ok: response.ok, url, status: response.status, body }
  },
}

/** Keeps the token from a sign-in reply, and hands back the user. */
function accept(reply) {
  const token = wire.token(reply)
  if (token) AUTH_TOKEN = token
  return wire.user(reply)
}

const auth = {
  signUp: async (email, password) => {
    if (!BACKEND) {
      log('auth.signUp("' + email + '") — preview account')
      return { id: 'preview-user', email }
    }
    const request = wire.signUp(email, password)
    const reply = await ask(request)
    // Some backends create the account without signing it in. Handing
    // back a user with no session would leave the next block
    // unauthorised for a reason nobody could see.
    if (request.then === 'sign-in') return accept(await ask(wire.signIn(email, password)))
    return accept(reply)
  },
  signIn: async (email, password) => {
    if (!BACKEND) {
      log('auth.signIn("' + email + '") — preview account')
      return { id: 'preview-user', email }
    }
    return accept(await ask(wire.signIn(email, password)))
  },
  oauth: async (provider) => {
    if (!BACKEND) {
      log('auth.oauth("' + provider + '") — preview sign-in')
      return { id: 'preview-user', provider }
    }
    const redirect = typeof location !== 'undefined' ? location.href : ''
    const request = wire.oauth(provider, redirect)
    // Most backends answer with the provider's authorize URL; some
    // build it from the address alone. Going there is the app's
    // business, not the runtime's.
    if (request.url) return { url: request.url, provider }
    return ask(request)
  },
  session: async () => {
    if (!BACKEND) return { id: 'preview-user', email: 'ada@example.com' }
    if (!AUTH_TOKEN) return {}
    try {
      return accept(await ask(wire.session()))
    } catch {
      // An expired token is "nobody is signed in", not a failure the
      // app should have to handle.
      AUTH_TOKEN = null
      return {}
    }
  },
  signOut: async () => {
    const request = BACKEND && AUTH_TOKEN ? wire.signOut() : null
    if (request) await ask(request)
    AUTH_TOKEN = null
  },
}

const storage = {
  upload: async (bucket, file) => {
    if (!BACKEND) {
      log('storage.upload("' + bucket + '") — preview only')
      return 'https://preview.local/' + bucket + '/file'
    }
    const reply = await ask(wire.upload(bucket, file))
    return wire.uploaded(reply, bucket, nameOf(file))
  },
}

/**
 * The screens, in the sandbox.
 *
 * A handler is registered against the screen it was declared on, and only
 * the current screen's handlers run in a pass. Everything the previous
 * screen drew goes away on its own: endPass removes what the pass did not
 * touch, which is the same mechanism that clears a row dropped from a list.
 */
let screens = ['home']
let current = INITIAL_SCREEN
const trail = []
const starts = []
const bindings = []
/** Restores page variables to their initial values. Set by app.state. */
let resetPage = () => {}

const handlersOf = (screen) => starts.filter((entry) => entry.screen === screen).map((entry) => entry.handler)

function enter(screen) {
  current = screen
  // Page scope belongs to one screen and does not survive leaving it --
  // the distinction between the two scopes, made real rather than
  // described. App scope is untouched, which is the whole point of it.
  resetPage()
  rerender()
}

let offset = 0
const setOffset = (value) => { offset = value }

async function guarded(handler) {
  try { await handler() } catch (error) { report(error, offset) }
}
`

/** Options for one render of the frame. */
export type PreviewOptions = {
  document: UiDocument
  /** The generated program, exactly as the code pane shows it. */
  code: string
  /**
   * The screen to open on.
   *
   * The workbench passes the screen being edited, so the preview shows the
   * one under the cursor instead of always the first. The document it is
   * handed must be that same screen's, or the first paint and the first
   * render would disagree about what is on the page.
   */
  screen?: string
  /**
   * The backend this document should talk to.
   *
   * Empty inside the IDE, where there is no server and must not be one:
   * the data, auth and storage blocks simulate themselves and say so in
   * the log. A built target passes the generated service's address, and
   * the same blocks make real requests. `window.TUNGSTEN_API`, if the
   * page sets one, wins over whatever is baked in here.
   */
  api?: string
  /**
   * The backend the built app should speak to, as data.
   *
   * Absent inside the IDE and in a project with no backend configured,
   * which is why the runtime still knows the generated service's routes:
   * they are the `tungsten` dialect, and the fallback when nothing else
   * is baked in.
   */
  profile?: RuntimeProfile
}

/**
 * Builds the whole sandbox document.
 *
 * Everything is inlined: the iframe is `sandbox="allow-scripts"` with no
 * network and no same-origin access, so there is nothing for it to fetch and
 * nothing it can reach if it tried.
 */
export function previewHtml({ document: ui, code, screen = 'home', api = '', profile }: PreviewOptions): string {
  const body = [...PREAMBLE, ...code.split('\n')].join('\n')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${uiThemeCss()}
    </style>
  </head>
  <body>
    <div id="app">
      ${renderDocumentBody(ui)}
    </div>
    <script>
      const PREAMBLE_LINES = ${PREVIEW_PREAMBLE_LINES};
      const INITIAL_SCREEN = ${JSON.stringify(screen)};
      const API_BASE = ${JSON.stringify(api)};
      const BAKED_PROFILE = ${profile ? JSON.stringify(profile) : 'null'};
      ${RUNTIME}
      try {
        const program = new Function(
          'app', 'render', 'db', 'http', 'auth', 'storage', 'console', '__lineOf', '__setOffset',
          ${JSON.stringify(body)},
        );
        program(app, render, db, http, auth, storage, { log, warn: log, error: log }, lineOf, setOffset);
        bindings.forEach((bind) => bind());
        beginPass();
        Promise.all(handlersOf(current).map((handler) => guarded(handler)))
          .then(() => { endPass(); post({ kind: 'ready' }); });
      } catch (error) {
        report(error, 0);
      }
    </script>
  </body>
</html>`
}
