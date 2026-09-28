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
function upsert(id, create) {
  let element = document.getElementById(id)
  if (!element) {
    element = create()
    element.id = id
    root.append(element)
  }
  return element
}

const render = {
  button: ({ id, text }) => {
    const element = upsert(String(id), () => document.createElement('button'))
    element.textContent = String(text)
    return element
  },
  text: (value) => {
    const element = upsert('text-' + (root.querySelectorAll('p').length + 1), () => document.createElement('p'))
    element.textContent = format(value)
    return element
  },
  input: ({ id, placeholder }) => {
    const element = upsert(String(id), () => document.createElement('input'))
    element.placeholder = String(placeholder ?? '')
    return { get value() { return element.value } }
  },
}

const app = {
  onStart: (handler) => { starts.push(handler) },
  onClick: (target, handler) => {
    const bind = () => {
      const element = document.getElementById(String(target))
      if (!element) {
        log('No element with id "' + target + '" to click. Add a Button block with that id.')
        return
      }
      element.addEventListener('click', () => { void guarded(handler) })
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
      :root { color-scheme: dark; }
      body {
        margin: 0; padding: 18px; font: 13px/1.5 'DM Sans', system-ui, sans-serif;
        color: #d5d9d5; background: #111311;
      }
      #app { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
      button {
        padding: 6px 14px; font: inherit; color: #10140c; background: #c8f169;
        border: 0; border-radius: 5px; cursor: pointer;
      }
      button:active { transform: translateY(1px); }
      input {
        padding: 6px 9px; font: inherit; color: #d5d9d5; background: #101210;
        border: 1px solid #2b302b; border-radius: 5px; min-width: 200px;
      }
      p { margin: 0; }
      .empty { color: #858c86; }
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
        Promise.all(starts.map((handler) => guarded(handler))).then(() => post({ kind: 'ready' }));
      } catch (error) {
        report(error, 0);
      }
    </script>
  </body>
</html>`
}
