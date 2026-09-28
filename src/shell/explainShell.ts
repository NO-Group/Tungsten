/**
 * Explaining a command line in plain English.
 *
 * A dictionary answers "what is tar?"; this answers "what is
 * `tar czf out.tgz --exclude node_modules site/` going to do to me?", which is
 * the question people actually have with their finger over Enter.
 *
 * The parser is deliberately small. It is not a shell: it splits on the
 * operators that change the meaning of a line, respects quoting so a pipe
 * inside a string is left alone, and hands each resulting segment to the
 * dictionary. Anything it cannot recognise is reported rather than guessed.
 */

import type { CommandEntry } from './commandModel'
import { shellDictionary, type Dictionary } from './commandDictionary'

/** Operators that separate one command from the next. */
const CONNECTORS: Record<string, string> = {
  '|': 'pipes that output into',
  '||': 'and only if that fails, runs',
  '&&': 'and if that succeeds, runs',
  ';': 'then, regardless of the result, runs',
}

/**
 * Commands whose job is to run another command.
 *
 * `xargs -0 rm -f` is dangerous because of the `rm`, not the `xargs`, so the
 * explainer follows the wrapper through to what it will actually execute.
 */
const WRAPPERS = new Set([
  'xargs', 'timeout', 'nohup', 'watch', 'setsid', 'env', 'time', 'nice', 'ionice',
  'flock', 'sudo', 'doas', 'parallel', 'strace', 'ltrace', 'chroot', 'unshare', 'nsenter',
  'entr', 'watchexec', 'stdbuf', 'unbuffer', 'systemd-run', 'taskset', 'chrt',
])

/** The pseudo-connector used for the command a wrapper goes on to run. */
export const RUNS = 'runs'

/** Redirections, and what each one does to a file. */
const REDIRECTS: Record<string, string> = {
  '>': 'writes standard output to',
  '>>': 'appends standard output to',
  '2>': 'writes error output to',
  '2>>': 'appends error output to',
  '&>': 'writes both output streams to',
  '<': 'reads standard input from',
  '2>&1': 'sends error output to the same place as standard output',
}

export type Token = { value: string; operator: boolean; quoted: boolean }

export type ExplainedFlag = {
  flag: string
  /** The dictionary text, or an explanation of why there is none. */
  summary: string
  known: boolean
}

export type ExplainedSegment = {
  /** The command word, with any `sudo` prefix removed. */
  name: string
  entry?: CommandEntry
  sudo: boolean
  flags: ExplainedFlag[]
  operands: string[]
  /** The connector that introduced this segment, for segments after the first. */
  connector?: string
}

export type ExplainedRedirect = { operator: string; target: string; summary: string }

export type Explanation = {
  /** False when nothing could be recognised at all. */
  ok: boolean
  segments: ExplainedSegment[]
  redirects: ExplainedRedirect[]
  /** The command ends with `&`, so the shell does not wait for it. */
  background: boolean
  /** Commands not found in the dictionary, in the order they appeared. */
  unknown: string[]
  /** Anything in the line that can destroy data, gathered for the caller. */
  warnings: string[]
  /** The whole thing as readable lines, ready to print. */
  sentences: string[]
}

/**
 * Splits a command line into words and operators.
 *
 * Quoted runs stay whole and are marked, which is what stops `echo "a | b"`
 * from being read as a pipeline.
 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let quoted = false

  const push = () => {
    if (current || quoted) tokens.push({ value: current, operator: false, quoted })
    current = ''
    quoted = false
  }

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; quoted = true; continue }
    if (char === '\\' && index + 1 < line.length) { current += line[index + 1]; index += 1; continue }
    if (/\s/.test(char)) { push(); continue }

    // Operators are their own tokens, longest match first.
    const rest = line.slice(index)
    const operator = ['2>&1', '2>>', '&>', '2>', '>>', '||', '&&', '|', '>', '<', ';', '&']
      .find((candidate) => rest.startsWith(candidate))
    if (operator) {
      push()
      tokens.push({ value: operator, operator: true, quoted: false })
      index += operator.length - 1
      continue
    }
    current += char
  }
  push()
  return tokens
}

/** The alias forms one documented option can be typed as. */
function aliasesOf(flag: string): string[] {
  return flag
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)
}

/** Finds the documented option a typed word refers to, if any. */
function optionFor(entry: CommandEntry | undefined, word: string) {
  if (!entry?.options) return undefined
  const bare = word.split('=')[0]
  return entry.options.find((option) =>
    aliasesOf(option.flag).some((alias) => {
      if (alias === word || alias === bare) return true
      // `if=FILE` style operands, and `--long=value` against `--long`.
      const aliasBare = alias.split('=')[0]
      return alias.includes('=') && aliasBare === bare
    }),
  )
}

/**
 * Expands a bundled short flag when every letter is documented.
 *
 * `-la` becomes `-l -a` for `ls`, but `-Syu` is left alone for pacman, which
 * documents the bundle itself.
 */
function expand(entry: CommandEntry | undefined, word: string): string[] {
  if (!/^-[A-Za-z]{2,}$/.test(word)) return [word]
  if (optionFor(entry, word)) return [word]
  const letters = word.slice(1).split('').map((letter) => `-${letter}`)
  return letters.every((letter) => optionFor(entry, letter)) ? letters : [word]
}

/**
 * Reads a bare flag cluster: tar's `czf`, the dashless form older tools keep.
 *
 * Only the first operand is considered, and only when every letter in it is a
 * documented single-letter flag -- so `tar czf` is read as flags while
 * `cat notes` stays a filename.
 */
function bareFlags(entry: CommandEntry | undefined, word: string): string[] | undefined {
  if (!entry || !/^[A-Za-z]{2,5}$/.test(word)) return undefined
  const letters = word.split('').map((letter) => `-${letter}`)
  return letters.every((letter) => optionFor(entry, letter)) ? letters : undefined
}

function explainSegment(words: string[], dictionary: Dictionary, connector?: string): ExplainedSegment {
  let index = 0
  let sudo = false
  // Skip the things that wrap a command without being one: sudo, env, time.
  while (index < words.length && (words[index] === 'sudo' || words[index] === 'command')) {
    if (words[index] === 'sudo') sudo = true
    index += 1
  }
  // Leading NAME=value assignments belong to the environment, not the command.
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1

  const name = words[index] || ''
  const entry = dictionary.lookup(name)
  const rest = words.slice(index + 1)

  const flags: ExplainedFlag[] = []
  const operands: string[] = []

  for (const word of rest) {
    if (word.startsWith('-') && word !== '-' && word !== '--') {
      for (const piece of expand(entry, word)) {
        const option = optionFor(entry, piece)
        flags.push({
          flag: piece,
          summary: option ? option.summary : `not a documented flag of ${name || 'this command'}`,
          known: Boolean(option),
        })
      }
      continue
    }
    // Many tools document subcommands in the option table (`git status`,
    // `docker ps -a`), so an operand that matches one is explained too.
    const option = optionFor(entry, word)
    if (option && !flags.some((flag) => flag.flag === word)) {
      flags.push({ flag: word, summary: option.summary, known: true })
      continue
    }
    const bare = !flags.length && !operands.length ? bareFlags(entry, word) : undefined
    if (bare) {
      for (const letter of bare) {
        flags.push({ flag: letter, summary: optionFor(entry, letter)!.summary, known: true })
      }
      continue
    }
    operands.push(word)
  }

  return { name, entry, sudo, flags, operands, connector }
}

export function explainCommandLine(line: string, dictionary: Dictionary = shellDictionary): Explanation {
  const tokens = tokenize(line)
  const segments: ExplainedSegment[] = []
  const redirects: ExplainedRedirect[] = []
  let background = false

  let words: string[] = []
  let connector: string | undefined
  let pendingRedirect: string | null = null

  const flush = () => {
    if (words.length) {
      const segment = explainSegment(words, dictionary, connector)
      segments.push(segment)
      // A wrapper hands the rest of the line to another command; explain that
      // one too, so `xargs -0 rm -f` reports rm's warning and not just xargs'.
      if (WRAPPERS.has(segment.name)) {
        const start = segment.operands.findIndex((operand) => dictionary.lookup(operand))
        if (start >= 0) segments.push(explainSegment(segment.operands.slice(start), dictionary, RUNS))
      }
    }
    words = []
  }

  for (const token of tokens) {
    if (!token.operator) {
      if (pendingRedirect) {
        redirects.push({
          operator: pendingRedirect,
          target: token.value,
          summary: `${REDIRECTS[pendingRedirect]} ${token.value}`,
        })
        pendingRedirect = null
        continue
      }
      words.push(token.value)
      continue
    }

    if (token.value === '&') { background = true; continue }
    if (token.value === '2>&1') {
      redirects.push({ operator: token.value, target: '', summary: REDIRECTS['2>&1'] })
      continue
    }
    if (REDIRECTS[token.value]) { pendingRedirect = token.value; continue }
    if (CONNECTORS[token.value]) {
      flush()
      connector = token.value
      continue
    }
  }
  flush()

  const unknown = segments.filter((segment) => segment.name && !segment.entry).map((segment) => segment.name)
  const warnings: string[] = []
  for (const segment of segments) {
    if (segment.entry?.danger) warnings.push(`${segment.name}: ${segment.entry.danger}`)
    if (segment.sudo) warnings.push(`sudo: ${segment.name || 'this command'} runs with full privileges`)
  }

  const sentences = describe(segments, redirects, background)
  return { ok: segments.some((segment) => Boolean(segment.entry)), segments, redirects, background, unknown, warnings, sentences }
}

/** Turns the parsed segments into the lines a reader actually sees. */
function describe(segments: ExplainedSegment[], redirects: ExplainedRedirect[], background: boolean): string[] {
  const sentences: string[] = []

  segments.forEach((segment, index) => {
    if (index > 0 && segment.connector === RUNS) {
      sentences.push('runs, on what it is given:')
    } else if (index > 0 && segment.connector && CONNECTORS[segment.connector]) {
      sentences.push(`${segment.connector}  ${CONNECTORS[segment.connector]}…`)
    }
    if (!segment.name) return

    const headline = segment.entry
      ? `${segment.name} — ${segment.entry.summary}`
      : `${segment.name} — not in the dictionary`
    sentences.push(segment.sudo ? `sudo ${headline}` : headline)

    for (const flag of segment.flags) sentences.push(`    ${flag.flag} — ${flag.summary}`)
    if (segment.operands.length) {
      sentences.push(`    acting on ${segment.operands.join(', ')}`)
    }
  })

  for (const redirect of redirects) sentences.push(`${redirect.operator} — ${redirect.summary}`)
  if (background) sentences.push('& — runs in the background; the shell does not wait for it')
  return sentences
}
