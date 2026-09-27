/**
 * The emulated shell used in the browser build.
 *
 * There is no PTY in a browser tab, so Tungsten answers a small set of
 * commands from the in-memory workspace instead of pretending to be a real
 * terminal. Keeping it pure -- a command and a snapshot in, lines out -- means
 * the behaviour is testable and the React component stays a renderer.
 */

export type ShellLine = { text: string; kind?: 'command' | 'muted' | 'success' | 'warning' | 'error' }

export type ShellFile = { path: string; content: string }

export type ShellContext = {
  workspaceName: string
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
  'help', 'clear', 'ls', 'pwd', 'cat', 'echo', 'date', 'whoami',
  'git status', 'npm run dev', 'npm run build',
]

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

  const { workspaceName, files, dirty, now = () => new Date() } = context
  const [name, ...args] = command.split(/\s+/)
  const lines: ShellLine[] = [echo(command, workspaceName)]
  const say = (text: string, kind?: ShellLine['kind']) => { lines.push({ text, kind }); return { lines } }

  switch (name) {
    case 'help':
      return say(`Available: ${sandboxCommands.join(', ')}`, 'muted')
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

  return say(`${name}: command not found`, 'error')
}
