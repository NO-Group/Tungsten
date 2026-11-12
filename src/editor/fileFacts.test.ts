/**
 * The facts behind the status bar readings.
 *
 * These tests are mostly about damage: a reindent that rewrites a
 * string literal, a normalisation that eats the last newline, a
 * detector that reads deeply nested two-space code as eight. Each of
 * those is a quiet corruption of somebody's file, which is why the
 * status bar used to say `Spaces: 2` and do nothing instead.
 */

import { describe, expect, it } from 'vitest'

import {
  BOM,
  convertEol,
  convertIndentation,
  describeIndentation,
  detectEncoding,
  detectEol,
  detectIndentation,
  explainEol,
  explainIndentation,
  setEncoding,
} from './fileFacts'

const SETTING = { insertSpaces: true, tabSize: 2 }

describe('line endings', () => {
  it('reads a file of one kind', () => {
    expect(detectEol('a\nb\nc').kind).toBe('LF')
    expect(detectEol('a\r\nb\r\nc').kind).toBe('CRLF')
  })

  it('calls a mixed file mixed instead of picking a winner', () => {
    const facts = detectEol('a\r\nb\nc\n')
    expect(facts).toMatchObject({ kind: 'Mixed', crlf: 1, lf: 2 })
    expect(explainEol(facts)).toContain('every diff will be noisy')
  })

  it('does not invent a conflict in a file with no line breaks', () => {
    expect(detectEol('one line')).toMatchObject({ kind: 'LF', empty: true })
  })

  it('normalises mixed endings in one pass, and keeps the trailing break', () => {
    expect(convertEol('a\r\nb\nc\n', 'LF')).toBe('a\nb\nc\n')
    expect(convertEol('a\r\nb\nc\n', 'CRLF')).toBe('a\r\nb\r\nc\r\n')
    // Converting twice is the same as converting once.
    expect(convertEol(convertEol('a\r\nb\n', 'CRLF'), 'CRLF')).toBe('a\r\nb\r\n')
  })

  it('treats a lone carriage return as a line ending too', () => {
    expect(convertEol('a\rb', 'LF')).toBe('a\nb')
  })
})

describe('indentation', () => {
  it('reads two-space code as two, not as the deepest indent', () => {
    const text = 'a\n  b\n    c\n      d\n  e\n'
    expect(detectIndentation(text, SETTING)).toMatchObject({ insertSpaces: true, tabSize: 2, detected: true })
  })

  it('reads four-space code as four', () => {
    const text = 'function a() {\n    if (b) {\n        c()\n    }\n}\n'
    expect(detectIndentation(text, SETTING)).toMatchObject({ insertSpaces: true, tabSize: 4 })
  })

  it('calls a tab file a tab file even when some lines are space-aligned', () => {
    const text = 'a\n\tb\n\tc\n\t\td\n          aligned\n'
    const facts = detectIndentation(text, SETTING)
    expect(facts.insertSpaces).toBe(false)
    expect(facts.inconsistent).toBe(true)
  })

  it('falls back to the setting, and says it was not detected', () => {
    const facts = detectIndentation('no indentation here\nat all\n', { insertSpaces: false, tabSize: 8 })
    expect(facts).toMatchObject({ insertSpaces: false, tabSize: 8, detected: false })
    expect(explainIndentation(facts)).toContain('nothing in this file is indented')
  })

  it('converts spaces to tabs and back without touching the code', () => {
    const spaces = 'const a = {\n    b: "  keep  these  spaces  ",\n        c: 1,\n}\n'
    const tabs = convertIndentation(spaces, { insertSpaces: true, tabSize: 4 }, { insertSpaces: false, tabSize: 4 })
    expect(tabs).toBe('const a = {\n\tb: "  keep  these  spaces  ",\n\t\tc: 1,\n}\n')
    const back = convertIndentation(tabs, { insertSpaces: false, tabSize: 4 }, { insertSpaces: true, tabSize: 4 })
    expect(back).toBe(spaces)
  })

  it('retabs from two spaces to four', () => {
    const text = 'a\n  b\n    c\n'
    expect(convertIndentation(text, { insertSpaces: true, tabSize: 2 }, { insertSpaces: true, tabSize: 4 }))
      .toBe('a\n    b\n        c\n')
  })

  it('keeps a half-level of alignment rather than rounding it away', () => {
    // Three spaces under a four-space convention is somebody aligning a
    // continuation. Rounding it to zero or four would move their code.
    const out = convertIndentation('a\n   b\n', { insertSpaces: true, tabSize: 4 }, { insertSpaces: false, tabSize: 4 })
    expect(out).toBe('a\n   b\n')
  })

  it('is a no-op when nothing changes', () => {
    const text = 'a\n  b\n'
    expect(convertIndentation(text, SETTING, SETTING)).toBe(text)
  })

  it('labels itself the way the status bar reads', () => {
    expect(describeIndentation({ insertSpaces: true, tabSize: 2 })).toBe('Spaces: 2')
    expect(describeIndentation({ insertSpaces: false, tabSize: 4 })).toBe('Tab Size: 4')
  })
})

describe('encoding', () => {
  it('reports the only thing that actually varies', () => {
    expect(detectEncoding('plain')).toBe('UTF-8')
    expect(detectEncoding(`${BOM}plain`)).toBe('UTF-8 with BOM')
  })

  it('adds and removes the mark without doubling it', () => {
    const marked = setEncoding('plain', 'UTF-8 with BOM')
    expect(marked).toBe(`${BOM}plain`)
    expect(setEncoding(marked, 'UTF-8 with BOM')).toBe(marked)
    expect(setEncoding(marked, 'UTF-8')).toBe('plain')
  })

  it('leaves the rest of the text alone', () => {
    expect(setEncoding(`${BOM}#!/bin/sh\necho hi\n`, 'UTF-8')).toBe('#!/bin/sh\necho hi\n')
  })
})
