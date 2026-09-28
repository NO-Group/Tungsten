import { describe, expect, it } from 'vitest'

import { diffEditorOptionsFromConfiguration, editorOptionsFromConfiguration, resolveLineHeight } from './editorOptions'
import { configurationSchema } from './configurationRegistry'

describe('resolveLineHeight', () => {
  it('derives a line height from the font when it is zero', () => {
    expect(resolveLineHeight(0, 13)).toBe(21)
  })

  it('reads a small number as a multiplier, the way VS Code does', () => {
    expect(resolveLineHeight(2, 14)).toBe(28)
  })

  it('takes a large number as pixels', () => {
    expect(resolveLineHeight(30, 14)).toBe(30)
  })
})

describe('editorOptionsFromConfiguration', () => {
  it('answers every editor setting the registry declares', () => {
    // A setting nothing reads is a setting that silently does nothing, which
    // is what this file exists to prevent. `formatOnSave` is the exception:
    // it is a save action, and lives in saveActions.ts.
    const options = editorOptionsFromConfiguration({})
    const unread = Object.keys(configurationSchema)
      .filter((key) => key.startsWith('editor.') && key !== 'editor.formatOnSave')
      .filter((key) => {
        const leaf = key.split('.').slice(1)
        const top = leaf[0] as keyof typeof options
        if (!(top in options)) return true
        const value = options[top]
        return leaf.length > 1 && (!value || typeof value !== 'object' || !(leaf[1] in value))
      })
    expect(unread).toEqual([])
  })

  it('passes the modes through rather than flattening them to switches', () => {
    const options = editorOptionsFromConfiguration({
      'editor.wordWrap': 'bounded',
      'editor.renderWhitespace': 'all',
      'editor.cursorStyle': 'block',
    })
    expect(options.wordWrap).toBe('bounded')
    expect(options.renderWhitespace).toBe('all')
    expect(options.cursorStyle).toBe('block')
  })

  it('applies tab size, rulers and the bracket guides', () => {
    const options = editorOptionsFromConfiguration({
      'editor.tabSize': 8,
      'editor.rulers': [80, 120],
      'editor.guides.bracketPairs': true,
    })
    expect(options.tabSize).toBe(8)
    expect(options.rulers).toEqual([80, 120])
    expect(options.guides.bracketPairs).toBe(true)
  })

  it('never hands Monaco a malformed rulers list', () => {
    expect(editorOptionsFromConfiguration({ 'editor.rulers': 'eighty' }).rulers).toEqual([])
  })

  it('follows reduced motion for animation, not for anything else', () => {
    const still = editorOptionsFromConfiguration({ 'accessibility.reducedMotion': true })
    expect(still.smoothScrolling).toBe(false)
    expect(still.cursorSmoothCaretAnimation).toBe('off')
    expect(still.cursorBlinking).toBe(configurationSchema['editor.cursorBlinking'].default)
  })

  it('keeps the breakpoint gutter and marks a diff read-only', () => {
    expect(editorOptionsFromConfiguration({}).glyphMargin).toBe(true)
    expect(editorOptionsFromConfiguration({}, true).readOnly).toBe(true)
  })
})

describe('diffEditorOptionsFromConfiguration', () => {
  it('is read-only, side by side, and follows the editor font', () => {
    const options = diffEditorOptionsFromConfiguration({ 'editor.fontSize': 17 })
    expect(options.readOnly).toBe(true)
    expect(options.renderSideBySide).toBe(true)
    expect(options.fontSize).toBe(17)
  })
})
