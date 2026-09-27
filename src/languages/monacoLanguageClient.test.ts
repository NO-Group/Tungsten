import { describe, expect, it } from 'vitest'

import { lspLanguages, toMonacoRangeArgs } from './monacoLanguageClient'

describe('toMonacoRangeArgs', () => {
  it('shifts an LSP range onto Monaco\u2019s one-based grid', () => {
    expect(toMonacoRangeArgs({ start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }))
      .toEqual([1, 1, 1, 5])
  })

  it('keeps multi-line ranges intact', () => {
    expect(toMonacoRangeArgs({ start: { line: 11, character: 2 }, end: { line: 14, character: 0 } }))
      .toEqual([12, 3, 15, 1])
  })
})

describe('lspLanguages', () => {
  it('covers the languages the main process can start a server for', () => {
    for (const language of ['typescript', 'python', 'rust', 'go']) {
      expect(lspLanguages.has(language)).toBe(true)
    }
  })

  it('leaves markup and data formats to Monaco\u2019s own tokenizer', () => {
    for (const language of ['markdown', 'json', 'css', 'html']) {
      expect(lspLanguages.has(language)).toBe(false)
    }
  })
})
