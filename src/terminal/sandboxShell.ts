/**
 * The emulated shell used in the browser build.
 *
 * There is no PTY in a browser tab, so Tungsten answers a small set of
 * commands from the in-memory workspace instead of pretending to be a real
 * terminal. Keeping it pure -- a command and a snapshot in, lines out -- means
 * the behaviour is testable and the React component stays a renderer.
 */

import { manPage, shellDictionary, type Dictionary } from '../shell/commandDictionary'
import { explainCommandLine } from '../shell/explainShell'

export type ShellLine = { text: string; kind?: 'command' | 'muted' | 'success' | 'warning' | 'error' }

export type ShellFile = { path: string; content: string }

export type ShellContext = {
  workspaceName: string
  /**
   * The command dictionary `man`, `apropos` and `explain` read.
   *
   * Passed in rather than imported at the point of use so the workspace's own
   * `dictionary/*.commands.json` entries answer here too.
   */
  dictionary?: Dictionary
  files: ShellFile[]
  /** Paths with unsaved changes, reported by `git status`. */
  dirty: Set<string>
  /** Injectable clock, so `date` can be asserted. */
  now?: () => Date
}

export type ShellResult = {
  /** True for `clear`, which wipes the scrollback instead of appending. */
  clear?: true
  lines: ShellLine[]
}

/** Commands the sandbox answers, in the order `help` lists them. */
export const sandboxCommands = [
  'help', 'man', 'apropos', 'whatis', 'explain', 'clear', 'ls', 'pwd', 'cat', 'echo',
  'date', 'whoami', 'git status', 'npm run dev', 'npm run build',
]

/** How many matches `apropos` prints before it tells you to narrow the search. */
export const APROPOS_LIMIT = 12

/** The prompt line that echoes what was typed, as a real shell would. */
function echo(command: string, workspaceName: string): ShellLine {
  return { text: `tungsten@${workspaceName} ~/${workspaceName} $ ${command}`, kind: 'command' }
}

/**
 * Lists the immediate children of a directory.
 *
 * The workspace is a flat list of paths, so a directory listing is the set of
 * first path segments below the target, with a trailing slash on the ones that
 * have children of their own.
 */
function listDirectory(files: ShellFile[], target: string): string {
  const entries = new Set<string>()
  files
    .filter((file) => !target || file.path.startsWith(`${target}/`))
    .forEach((file) => {
      const relative = target ? file.path.slice(target.length + 1) : file.path
      entries.add(relative.split('/')[0] + (relative.includes('/') ? '/' : ''))
    })
  return [...entries].join('   ')
}

export function runSandboxCommand(raw: string, context: ShellContext): ShellResult {
  const command = raw.trim()
  if (!command) return { lines: [] }
  if (command === 'clear') return { clear: true, lines: [] }

  const { workspaceName, files, dirty, now = () => new Date(), dictionary = shellDictionary } = context
  const [name, ...args] = command.split(/\s+/)
  const lines: ShellLine[] = [echo(command, workspaceName)]
  const say = (text: string, kind?: ShellLine['kind']) => { lines.push({ text, kind }); return { lines } }
  const sayAll = (texts: ShellLine[]) => { lines.push(...texts); return { lines } }

  /** "Did you mean" for a word the dictionary almost recognises. */
  const suggestion = (typed: string) => {
    const near = dictionary.suggest(typed)
    return near.length ? `Did you mean: ${near.join(', ')}?` : ''
  }

  switch (name) {
    case 'help': {
      if (!args.length) {
        return sayAll([
          { text: `Available: ${sandboxCommands.join(', ')}`, kind: 'muted' },
          { text: `The dictionary documents ${dictionary.entries.length} commands — try "man tar", "apropos compress" or "explain ls -la | head".`, kind: 'muted' },
        ])
      }
      const entry = dictionary.lookup(args[0])
      if (!entry) return say(`help: no entry for ${args[0]}. ${suggestion(args[0])}`.trim(), 'error')
      return sayAll([
        { text: `${entry.name} — ${entry.summary}` },
        { text: `    ${entry.synopsis}`, kind: 'muted' },
        { text: `    man ${entry.name} for the full page`, kind: 'muted' },
      ])
    }

    case 'man': {
      if (!args.length) return say('What manual page do you want? Try "man ls".', 'muted')
      const entry = dictionary.lookup(args[args.length - 1])
      if (!entry) {
        return sayAll([
          { text: `No manual entry for ${args[args.length - 1]}`, kind: 'error' },
          ...(suggestion(args[args.length - 1]) ? [{ text: suggestion(args[args.length - 1]), kind: 'muted' as const }] : []),
        ])
      }
      // The dictionary's tones map onto the colours the terminal already has.
      return sayAll(manPage(entry).map((line) => ({
        text: line.text,
        kind: line.tone === 'heading' ? 'command' : line.tone === 'warning' ? 'warning' : line.tone,
      })))
    }

    case 'whatis': {
      if (!args.length) return say('whatis: what command do you mean?', 'error')
      const entry = dictionary.lookup(args[0])
      if (!entry) return say(`${args[0]}: nothing appropriate. ${suggestion(args[0])}`.trim(), 'error')
      return say(`${entry.name} (${entry.group.toLowerCase()}) — ${entry.summary}`)
    }

    case 'apropos': {
      const query = args.join(' ')
      if (!query) return say('apropos: what are you looking for?', 'error')
      const hits = dictionary.search(query, { limit: APROPOS_LIMIT + 1 })
      if (!hits.length) return say(`${query}: nothing appropriate`, 'error')
      const shown = hits.slice(0, APROPOS_LIMIT)
      return sayAll([
        ...shown.map((entry) => ({ text: `${entry.name.padEnd(16)}${entry.summary}` })),
        ...(hits.length > APROPOS_LIMIT
          ? [{ text: 'more matches — narrow the search, or open the Dictionary view', kind: 'muted' as const }]
          : []),
      ])
    }

    case 'explain': {
      const line = command.slice('explain'.length).trim()
      if (!line) return say('explain: give me a command line to read, e.g. explain tar xzf app.tgz', 'muted')
      const explanation = explainCommandLine(line, dictionary)
      if (!explanation.sentences.length) return say('explain: nothing to read in that line', 'muted')
      return sayAll([
        ...explanation.sentences.map((text) => ({ text, kind: text.startsWith(' ') ? ('muted' as const) : undefined })),
        ...explanation.warnings.map((text) => ({ text: `! ${text}`, kind: 'warning' as const })),
      ])
    }
    case 'pwd':
      return say('/workspace/forge')
    case 'whoami':
      return say('tungsten')
    case 'date':
      return say(now().toString())
    case 'echo':
      return say(args.join(' '))
    case 'ls': {
      // A trailing slash is how people type directories; drop it before matching.
      const target = args[0]?.replace(/\/$/, '') || ''
      return say(listDirectory(files, target) || `ls: ${target}: No such directory`)
    }
    case 'cat': {
      const file = files.find((item) => item.path === args[0])
      return say(file?.content || `cat: ${args[0] || ''}: No such file`, file ? undefined : 'error')
    }
  }

  if (command === 'git status') {
    const changes = [...dirty].map((path) => `modified: ${path}`).join('\n  ')
    return say(
      `On branch main\n${dirty.size ? `Changes not staged for commit:\n  ${changes}` : 'nothing to commit, working tree clean'}`,
      dirty.size ? 'warning' : 'success',
    )
  }
  if (command === 'npm run dev') {
    return say('VITE ready in 287 ms\n  Local: tungsten://preview/forge\n  press Ctrl+Enter to open', 'success')
  }
  if (command === 'npm run build') {
    return say('✓ 8 modules transformed.\n✓ built in 412ms  dist/index.html  7.21 kB', 'success')
  }

  // The dictionary knows far more commands than the browser sandbox can run,
  // so an unknown word is answered with knowledge rather than a dead end.
  const known = dictionary.lookup(name)
  if (known) {
    return sayAll([
      { text: `${name}: not available in this browser sandbox`, kind: 'warning' },
      { text: `${known.name} — ${known.summary}`, kind: 'muted' },
      { text: `    ${known.synopsis}`, kind: 'muted' },
      { text: `    man ${known.name} to read the page here`, kind: 'muted' },
    ])
  }
  const near = suggestion(name)
  return sayAll([
    { text: `${name}: command not found`, kind: 'error' },
    ...(near ? [{ text: near, kind: 'muted' as const }] : []),
  ])
}
