/**
 * Snippet variable resolution, mirroring the set VS Code documents at
 * https://code.visualstudio.com/docs/editor/userdefinedsnippets#_variables.
 */

export interface SnippetVariableContext {
  filePath?: string
  languageId?: string
  selection?: string
  currentLine?: string
  lineNumber?: number
  clipboard?: string
  indent?: string
  eol?: string
  /** Injectable clock so snapshots of date/time variables are testable. */
  now?: Date
  workspaceName?: string
  workspacePath?: string
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** Comment syntax per language, used by the LINE_COMMENT family. */
const COMMENTS: Record<string, { line: string; blockStart: string; blockEnd: string }> = {
  typescript: { line: '//', blockStart: '/*', blockEnd: '*/' },
  javascript: { line: '//', blockStart: '/*', blockEnd: '*/' },
  tsx: { line: '//', blockStart: '/*', blockEnd: '*/' },
  jsx: { line: '//', blockStart: '/*', blockEnd: '*/' },
  json: { line: '//', blockStart: '/*', blockEnd: '*/' },
  css: { line: '/*', blockStart: '/*', blockEnd: '*/' },
  rust: { line: '//', blockStart: '/*', blockEnd: '*/' },
  go: { line: '//', blockStart: '/*', blockEnd: '*/' },
  java: { line: '//', blockStart: '/*', blockEnd: '*/' },
  c: { line: '//', blockStart: '/*', blockEnd: '*/' },
  cpp: { line: '//', blockStart: '/*', blockEnd: '*/' },
  python: { line: '#', blockStart: '"""', blockEnd: '"""' },
  ruby: { line: '#', blockStart: '=begin', blockEnd: '=end' },
  shell: { line: '#', blockStart: ':<<\'END\'', blockEnd: 'END' },
  yaml: { line: '#', blockStart: '#', blockEnd: '#' },
  sql: { line: '--', blockStart: '/*', blockEnd: '*/' },
  html: { line: '<!--', blockStart: '<!--', blockEnd: '-->' },
  markdown: { line: '<!--', blockStart: '<!--', blockEnd: '-->' },
}

const basename = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath

/**
 * Builds a resolver for `SnippetParser`. Unknown names return `undefined`,
 * which leaves the variable's default (or its literal name) in place — the
 * behaviour VS Code specifies.
 */
export function createVariableResolver(context: SnippetVariableContext = {}) {
  const now = context.now ?? new Date()
  const filePath = context.filePath ?? ''
  const name = filePath ? basename(filePath) : ''
  const comment = COMMENTS[context.languageId ?? ''] ?? { line: '//', blockStart: '/*', blockEnd: '*/' }

  const values: Record<string, string | undefined> = {
    // Selection and current line
    TM_SELECTED_TEXT: context.selection || undefined,
    TM_CURRENT_LINE: context.currentLine ?? '',
    TM_CURRENT_WORD: (context.selection || '').split(/\s+/)[0] || undefined,
    TM_LINE_INDEX: String((context.lineNumber ?? 1) - 1),
    TM_LINE_NUMBER: String(context.lineNumber ?? 1),

    // File and workspace
    TM_FILENAME: name,
    TM_FILENAME_BASE: name.replace(/\.[^.]+$/, ''),
    TM_DIRECTORY: filePath.split(/[\\/]/).slice(0, -1).join('/'),
    TM_FILEPATH: filePath,
    RELATIVE_FILEPATH: filePath,
    WORKSPACE_NAME: context.workspaceName ?? '',
    WORKSPACE_FOLDER: context.workspacePath ?? '',

    CLIPBOARD: context.clipboard || undefined,

    // Editor state
    CURSOR_INDEX: String((context.lineNumber ?? 1) - 1),
    CURSOR_NUMBER: String(context.lineNumber ?? 1),

    // Date and time
    CURRENT_YEAR: String(now.getFullYear()),
    CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(-2),
    CURRENT_MONTH: pad(now.getMonth() + 1),
    CURRENT_MONTH_NAME: MONTH_NAMES[now.getMonth()],
    CURRENT_MONTH_NAME_SHORT: MONTH_NAMES[now.getMonth()].slice(0, 3),
    CURRENT_DATE: pad(now.getDate()),
    CURRENT_DAY_NAME: DAY_NAMES[now.getDay()],
    CURRENT_DAY_NAME_SHORT: DAY_NAMES[now.getDay()].slice(0, 3),
    CURRENT_HOUR: pad(now.getHours()),
    CURRENT_MINUTE: pad(now.getMinutes()),
    CURRENT_SECOND: pad(now.getSeconds()),
    CURRENT_SECONDS_UNIX: String(Math.floor(now.getTime() / 1000)),
    CURRENT_TIMEZONE_OFFSET: formatTimezone(now),

    // Comments
    LINE_COMMENT: comment.line,
    BLOCK_COMMENT_START: comment.blockStart,
    BLOCK_COMMENT_END: comment.blockEnd,

    // Misc
    RANDOM: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    RANDOM_HEX: Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
    UUID: randomUuid(),
  }

  return (variable: string) => values[variable]
}

function formatTimezone(date: Date) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function randomUuid() {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  // RFC 4122 version 4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
