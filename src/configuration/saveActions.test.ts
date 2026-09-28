import { describe, expect, it } from 'vitest'

import { applySaveActions, saveOptionsFromConfiguration, type SaveOptions } from './saveActions'

const options = (overrides: Partial<SaveOptions> = {}): SaveOptions =>
  ({ trimTrailingWhitespace: false, insertFinalNewline: false, eol: 'auto', ...overrides })

describe('applySaveActions', () => {
  it('leaves the file alone when nothing is enabled', () => {
    const text = 'const a = 1   \nconst b = 2'
    expect(applySaveActions(text, options())).toBe(text)
  })

  it('trims trailing whitespace without touching indentation', () => {
    expect(applySaveActions('  const a = 1   \n\tconst b = 2  ', options({ trimTrailingWhitespace: true })))
      .toBe('  const a = 1\n\tconst b = 2')
  })

  it('leaves CRLF endings as CRLF while trimming', () => {
    expect(applySaveActions('a  \r\nb  \r\n', options({ trimTrailingWhitespace: true })))
      .toBe('a\r\nb\r\n')
  })

  it('adds a final newline, and only one', () => {
    expect(applySaveActions('a\nb', options({ insertFinalNewline: true }))).toBe('a\nb\n')
    expect(applySaveActions('a\nb\n', options({ insertFinalNewline: true }))).toBe('a\nb\n')
  })

  it('matches the file when adding a newline to CRLF text', () => {
    expect(applySaveActions('a\r\nb', options({ insertFinalNewline: true }))).toBe('a\r\nb\r\n')
  })

  it('leaves an empty file empty', () => {
    expect(applySaveActions('', options({ insertFinalNewline: true, trimTrailingWhitespace: true }))).toBe('')
  })

  it('normalises line endings when asked, and not when set to auto', () => {
    expect(applySaveActions('a\r\nb\nc', options({ eol: '\n' }))).toBe('a\nb\nc')
    expect(applySaveActions('a\nb', options({ eol: '\r\n' }))).toBe('a\r\nb')
    expect(applySaveActions('a\r\nb\nc', options({ eol: 'auto' }))).toBe('a\r\nb\nc')
  })

  it('applies every action in order', () => {
    expect(applySaveActions('a   \r\nb  ', options({ trimTrailingWhitespace: true, insertFinalNewline: true, eol: '\n' })))
      .toBe('a\nb\n')
  })
})

describe('saveOptionsFromConfiguration', () => {
  it('reads the files settings, defaults included', () => {
    expect(saveOptionsFromConfiguration({})).toEqual({
      trimTrailingWhitespace: false, insertFinalNewline: false, eol: 'auto',
    })
    expect(saveOptionsFromConfiguration({ 'files.insertFinalNewline': true }).insertFinalNewline).toBe(true)
  })
})
