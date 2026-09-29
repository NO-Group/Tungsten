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
  // Components with no id of their own are numbered by the order they are
  // drawn in. Counting the elements already on the page instead -- which
  // is what this did -- made the numbers climb on every pass, so a
  // re-render replaced the page rather than updating it.
  anonymous = 0
}

function endPass() {
  for (const element of [...root.children]) {
    if (!touched.has(element.id)) element.remove()
  }
}

function upsert(baseId, create) {
  const count = (claimed.get(baseId) || 0) + 1
  claimed.set(baseId, count)
  const id = count === 1 ? baseId : baseId + '~' + count
  touched.add(id)

  let element = document.getElementById(id)
  if (!element) {
    element = create()
    element.id = id
    root.append(element)
  }
  return element
}

/** True when an element is one of the copies a repeat produced. */
function isCopyOf(id, baseId) {
  return id === baseId || id.indexOf(baseId + '~') === 0
}

const render = {
  button: ({ id, text }) => {
    const element = upsert(String(id), () => document.createElement('button'))
    element.textContent = String(text)
    return element
  },
  text: (value) => {
    anonymous += 1
    const element = upsert('text-' + anonymous, () => document.createElement('p'))
    element.textContent = format(value)
    return element
  },
  /** What is in a field right now, by element id. */
  value: (id) => {
    const element = document.getElementById(String(id))
    return element && 'value' in element ? element.value : ''
  },
  input: ({ id, placeholder }) => {
    const element = upsert(String(id), () => document.createElement('input'))
    element.placeholder = String(placeholder ?? '')
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
  // produced are cleared away afterwards.
  beginPass()
  Promise.all(starts.map((handler) => guarded(handler))).then(endPass)
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
  onStart: (handler) => { starts.push(handler) },
  onClick: (target, handler) => {
    // Delegated from the root rather than bound to one element: a button
    // inside a repeat exists once per row, and every one of them is that
    // button. Binding by id would only ever reach the first.
    const bind = () => {
      const name = String(target)
      if (!document.getElementById(name)) {
        log('No element with id "' + name + '" to click. Add a Button block with that id.')
      }
      root.addEventListener('click', (event) => {
        const hit = event.target && event.target.closest ? event.target.closest('[id]') : null
        if (hit && isCopyOf(hit.id, name)) void guarded(handler)
      })
    }
    bindings.push(bind)
  },
}

// Seeded, obviously fake, and honest about it: a preview must not imply that
// it reached a real database.
const seeds = { users: [{ id: 1, email: 'ada@example.com' }, { id: 2, email: 'grace@example.com' }] }

const db = {
  select: async (table, where) => {
    log('db.select("' + table + '") — preview data' + (where ? ' with a filter' : ''))
    return seeds[table] ? seeds[table].slice() : []
  },
  insert: async (table, row) => {
    log('db.insert("' + table + '") — preview only, nothing was written')
    return { id: Math.floor(Math.random() * 1000), ...row }
  },
}

const http = {
  request: async ({ url, method }) => {
    log((method || 'GET') + ' ' + url + ' — stubbed in the preview, no request left the sandbox')
    return { ok: true, url, status: 200, body: null }
  },
}

const auth = {
  signUp: async (email) => { log('auth.signUp("' + email + '") — preview account'); return { id: 'preview-user', email } },
  oauth: async (provider) => { log('auth.oauth("' + provider + '") — preview sign-in'); return { id: 'preview-user', provider } },
  session: async () => ({ id: 'preview-user', email: 'ada@example.com' }),
}

const storage = {
  upload: async (bucket) => {
    log('storage.upload("' + bucket + '") — preview only')
    return 'https://preview.local/' + bucket + '/file'
  },
}

const starts = []
const bindings = []
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
}

/**
 * Builds the whole sandbox document.
 *
 * Everything is inlined: the iframe is `sandbox="allow-scripts"` with no
 * network and no same-origin access, so there is nothing for it to fetch and
 * nothing it can reach if it tried.
 */
export function previewHtml({ document: ui, code }: PreviewOptions): string {
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
      ${RUNTIME}
      try {
        const program = new Function(
          'app', 'render', 'db', 'http', 'auth', 'storage', 'console', '__lineOf', '__setOffset',
          ${JSON.stringify(body)},
        );
        program(app, render, db, http, auth, storage, { log, warn: log, error: log }, lineOf, setOffset);
        bindings.forEach((bind) => bind());
        beginPass();
        Promise.all(starts.map((handler) => guarded(handler))).then(() => { endPass(); post({ kind: 'ready' }); });
      } catch (error) {
        report(error, 0);
      }
    </script>
  </body>
</html>`
}
