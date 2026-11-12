/**
 * What the status bar is actually reporting about a file.
 *
 * The right-hand end of a status bar is usually four lies in a row:
 * `Spaces: 2`, `UTF-8`, `LF` and a language name, all hard-coded,
 * none of them read from the file in front of you. This module is the
 * answer to that — every one of those readings is computed from the
 * text, and every one of them has an action behind it that changes
 * the text in a way you can verify by looking at it.
 *
 * Everything here is pure: text in, text or facts out. The editor
 * decides what to do with the result.
 */

export type EolKind = 'LF' | 'CRLF' | 'Mixed'

export type EolFacts = {
  kind: EolKind
  lf: number
  crlf: number
  /** True when the file has no line break at all, so the kind is a default. */
  empty: boolean
}

/**
 * Counts the line endings.
 *
 * `Mixed` is a real state and worth surfacing: a file with both is the
 * thing that produces a diff where every line changed. A file with no
 * break at all reports LF rather than inventing a conflict.
 */
export function detectEol(text: string): EolFacts {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  if (!crlf && !lf) return { kind: 'LF', lf: 0, crlf: 0, empty: true }
  if (crlf && lf) return { kind: 'Mixed', lf, crlf, empty: false }
  return { kind: crlf ? 'CRLF' : 'LF', lf, crlf, empty: false }
}

/** Rewrites every line ending to one kind. Mixed input is normalised. */
export function convertEol(text: string, to: Exclude<EolKind, 'Mixed'>): string {
  const normalised = text.replace(/\r\n|\r|\n/g, '\n')
  return to === 'CRLF' ? normalised.replace(/\n/g, '\r\n') : normalised
}

export type Indentation = {
  insertSpaces: boolean
  tabSize: number
}

export type IndentationFacts = Indentation & {
  /** False when nothing in the file is indented, so this is the setting rather than a reading. */
  detected: boolean
  /** Lines that begin with a tab while the file is mostly spaces, or the reverse. */
  inconsistent: boolean
}

const INDENT = /^[\t ]+/

/**
 * Reads the indentation out of the file, the way an editor must.
 *
 * The rule that matters is the tie-break: a file that uses tabs is a
 * tab file even if it also contains space-aligned continuation lines,
 * because converting those would break the alignment they exist for.
 * Width comes from the most common *step* between successive indent
 * levels rather than the most common indent, so a file of deeply
 * nested four-space code does not read as sixteen.
 */
export function detectIndentation(text: string, fallback: Indentation): IndentationFacts {
  const lines = text.split(/\r\n|\r|\n/)
  const widths: number[] = []
  let tabLines = 0
  let spaceLines = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const match = INDENT.exec(line)
    if (!match) {
      widths.push(0)
      continue
    }
    const lead = match[0]
    if (lead.includes('\t')) tabLines += 1
    else spaceLines += 1
    widths.push(lead.includes('\t') ? 0 : lead.length)
  }

  if (!tabLines && !spaceLines) {
    return { ...fallback, detected: false, inconsistent: false }
  }

  const inconsistent = tabLines > 0 && spaceLines > 0
  if (tabLines >= spaceLines) {
    return { insertSpaces: false, tabSize: fallback.tabSize, detected: true, inconsistent }
  }

  // Steps between consecutive indentation levels, which is what a
  // "tab size" actually is.
  const steps = new Map<number, number>()
  let previous = 0
  for (const width of widths) {
    const step = width - previous
    if (step > 0 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1)
    previous = width
  }

  let best = 0
  let bestCount = 0
  for (const [step, count] of steps) {
    // A tie goes to the smaller step: two spaces nested twice looks
    // exactly like four spaces nested once, and the smaller reading
    // is the one that reindents without damage.
    if (count > bestCount || (count === bestCount && best && step < best)) {
      best = step
      bestCount = count
    }
  }

  return {
    insertSpaces: true,
    tabSize: best || fallback.tabSize,
    detected: true,
    inconsistent,
  }
}

/**
 * Reindents a file from one convention to another.
 *
 * Only the leading whitespace of a line is touched. Anything after the
 * first non-whitespace character — including a tab inside a string, a
 * table in a comment, or an aligned trailing comment — is left exactly
 * as it was, because a reindent that edits content is a corruption
 * with a friendly name.
 */
export function convertIndentation(text: string, from: Indentation, to: Indentation): string {
  if (from.insertSpaces === to.insertSpaces && from.tabSize === to.tabSize) return text

  return text.split('\n').map((line) => {
    const match = INDENT.exec(line)
    if (!match) return line
    const lead = match[0]
    const rest = line.slice(lead.length)

    // Width in columns, expanding tabs against the *source* width.
    let columns = 0
    for (const character of lead) {
      if (character === '\t') columns += from.tabSize - (columns % from.tabSize)
      else columns += 1
    }

    // Levels are counted in the *source* convention and re-emitted in
    // the target one: that is what makes a two-space file become a
    // four-space file rather than staying the same width.
    const levels = Math.floor(columns / from.tabSize)
    const remainder = columns % from.tabSize
    const indent = to.insertSpaces
      ? ' '.repeat(levels * to.tabSize + remainder)
      : '\t'.repeat(levels) + ' '.repeat(remainder)
    return indent + rest
  }).join('\n')
}

export type Encoding = 'UTF-8' | 'UTF-8 with BOM'

export const BOM = '\uFEFF'

/**
 * The only two encodings a Tungsten workspace can be in.
 *
 * Files are held as JavaScript strings, so they are Unicode by
 * construction — there is no Latin-1 state to report and offering to
 * "reopen with encoding" would be theatre. What genuinely varies, and
 * genuinely breaks shell scripts and JSON parsers, is the byte-order
 * mark, so that is what this reports and what the picker can change.
 */
export function detectEncoding(text: string): Encoding {
  return text.startsWith(BOM) ? 'UTF-8 with BOM' : 'UTF-8'
}

export function setEncoding(text: string, encoding: Encoding): string {
  const bare = text.startsWith(BOM) ? text.slice(BOM.length) : text
  return encoding === 'UTF-8 with BOM' ? BOM + bare : bare
}

/** `Spaces: 2`, `Tab Size: 4` — the label, with no claim it was detected. */
export function describeIndentation(indentation: Indentation): string {
  return indentation.insertSpaces ? `Spaces: ${indentation.tabSize}` : `Tab Size: ${indentation.tabSize}`
}

/** The hover text, which is where the detail belongs. */
export function explainIndentation(facts: IndentationFacts): string {
  const source = facts.detected ? 'detected in this file' : 'from your settings; nothing in this file is indented'
  const warning = facts.inconsistent ? ' This file mixes tabs and spaces.' : ''
  return `${describeIndentation(facts)} — ${source}. Click to change or convert.${warning}`
}

export function explainEol(facts: EolFacts): string {
  if (facts.empty) return 'No line breaks in this file. Click to choose the ending new lines will use.'
  if (facts.kind === 'Mixed') {
    return `Mixed line endings: ${facts.lf} LF and ${facts.crlf} CRLF. Click to normalise — until then every diff will be noisy.`
  }
  return `${facts.kind} line endings throughout. Click to convert.`
}

export function explainEncoding(encoding: Encoding): string {
  return encoding === 'UTF-8 with BOM'
    ? 'UTF-8 with a byte-order mark. Shell scripts and JSON parsers often choke on it. Click to remove it.'
    : 'UTF-8, no byte-order mark. Click to add one.'
}
