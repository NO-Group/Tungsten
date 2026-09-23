import { describe, expect, it } from 'vitest'
import { defaultFileIcon, fileIconFor, folderIconFor, knownExtensions, knownFileNames } from './fileIcons'

describe('file icon theme', () => {
  it('covers the major languages with distinct glyphs', () => {
    expect(fileIconFor('a.ts').glyph).toBe('TS')
    expect(fileIconFor('a.py').glyph).toBe('py')
    expect(fileIconFor('a.rs').glyph).toBe('rs')
    expect(fileIconFor('a.go').glyph).toBe('go')
    expect(fileIconFor('a.rb').glyph).toBe('rb')
  })

  it('prefers an exact filename over its extension', () => {
    // package.json is JSON, but it gets the npm icon.
    expect(fileIconFor('package.json').glyph).toBe('npm')
    expect(fileIconFor('other.json').glyph).toBe('{}')
  })

  it('matches filenames case-insensitively', () => {
    expect(fileIconFor('README.md').glyph).toBe(fileIconFor('readme.md').glyph)
    expect(fileIconFor('Dockerfile').glyph).toBe('do')
  })

  it('resolves a nested path by its basename', () => {
    expect(fileIconFor('src/deep/nested/app.tsx').glyph).toBe('TSX')
  })

  it('marks test files distinctly from their language', () => {
    const test = fileIconFor('app.test.ts')
    expect(test.glyph).toBe('✓')
    expect(test.glyph).not.toBe(fileIconFor('app.ts').glyph)
  })

  it('falls back to a default for an unknown extension', () => {
    expect(fileIconFor('a.unknownext')).toEqual(defaultFileIcon)
  })

  it('falls back for a file with no extension', () => {
    expect(fileIconFor('somefile')).toEqual(defaultFileIcon)
  })

  it('gives every icon a non-empty glyph and a valid colour', () => {
    for (const extension of knownExtensions()) {
      const icon = fileIconFor(`file.${extension}`)
      expect(icon.glyph.length, extension).toBeGreaterThan(0)
      expect(icon.color, extension).toMatch(/^#[0-9a-f]{6}$/i)
    }
    for (const name of knownFileNames()) {
      const icon = fileIconFor(name)
      expect(icon.glyph.length, name).toBeGreaterThan(0)
      expect(icon.color, name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps glyphs short enough for the icon slot', () => {
    for (const extension of knownExtensions()) {
      // Anything longer than three characters overflows the 17px slot.
      expect([...fileIconFor(`file.${extension}`).glyph].length, extension).toBeLessThanOrEqual(3)
    }
  })

  it('covers a broad set of file types', () => {
    expect(knownExtensions().length).toBeGreaterThan(60)
  })

  it('colours well-known folders and distinguishes open from closed', () => {
    expect(folderIconFor('src').color).not.toBe(folderIconFor('node_modules').color)
    expect(folderIconFor('src', true).glyph).not.toBe(folderIconFor('src', false).glyph)
  })

  it('falls back to a neutral folder colour for unknown names', () => {
    expect(folderIconFor('whatever').color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
