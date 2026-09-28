/**
 * Monaco's options, built from the configuration.
 *
 * Every `editor.*` setting the registry declares is answered here, so a
 * change in the settings editor reaches the editor itself rather than being
 * recorded and ignored. Options Tungsten does not offer as settings -- the
 * glyph margin the breakpoints need, the padding, the overview ruler -- are
 * the house style and stay fixed.
 */

import { configurationSchema } from './configurationRegistry'

/** Only the fonts are Tungsten's rather than Monaco's. */
export const EDITOR_FONT = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"

type Values = Record<string, unknown>

function read<T>(values: Values, key: string): T {
  return (key in values ? values[key] : configurationSchema[key]?.default) as T
}

/**
 * Line height follows the font unless it has been set: VS Code's rule, where
 * 0 means "derive it", and anything under 8 is a multiplier.
 */
export function resolveLineHeight(lineHeight: number, fontSize: number): number {
  if (!lineHeight) return Math.round(fontSize * 1.62)
  if (lineHeight < 8) return Math.round(fontSize * lineHeight)
  return Math.round(lineHeight)
}

/** The editor options for a file, as Monaco wants them. */
export function editorOptionsFromConfiguration(values: Values, readOnly = false) {
  const fontSize = read<number>(values, 'editor.fontSize')
  const reducedMotion = read<boolean>(values, 'accessibility.reducedMotion')
  const rulers = read<number[]>(values, 'editor.rulers')

  return {
    readOnly,
    fontFamily: read<string>(values, 'editor.fontFamily') || EDITOR_FONT,
    fontSize,
    lineHeight: resolveLineHeight(read<number>(values, 'editor.lineHeight'), fontSize),
    fontLigatures: true,
    glyphMargin: true,
    tabSize: read<number>(values, 'editor.tabSize'),
    insertSpaces: read<boolean>(values, 'editor.insertSpaces'),
    detectIndentation: read<boolean>(values, 'editor.detectIndentation'),
    wordWrap: read<string>(values, 'editor.wordWrap'),
    renderWhitespace: read<string>(values, 'editor.renderWhitespace'),
    minimap: { enabled: read<boolean>(values, 'editor.minimap.enabled'), maxColumn: 90, renderCharacters: false, scale: 1 },
    stickyScroll: { enabled: read<boolean>(values, 'editor.stickyScroll.enabled') },
    bracketPairColorization: { enabled: read<boolean>(values, 'editor.bracketPairColorization.enabled') },
    guides: { bracketPairs: read<boolean>(values, 'editor.guides.bracketPairs'), indentation: true },
    linkedEditing: read<boolean>(values, 'editor.linkedEditing'),
    formatOnPaste: read<boolean>(values, 'editor.formatOnPaste'),
    tabCompletion: read<string>(values, 'editor.tabCompletion'),
    suggestOnTriggerCharacters: read<boolean>(values, 'editor.suggestOnTriggerCharacters'),
    rulers: Array.isArray(rulers) ? rulers : [],
    // Blinking is a setting; the smooth caret animation follows reduced motion.
    cursorBlinking: read<string>(values, 'editor.cursorBlinking'),
    cursorStyle: read<string>(values, 'editor.cursorStyle'),
    cursorSmoothCaretAnimation: reducedMotion ? 'off' : 'on',
    smoothScrolling: !reducedMotion,
    accessibilitySupport: read<boolean>(values, 'accessibility.screenReaderOptimized') ? 'on' : 'auto',
    padding: { top: 14, bottom: 20 },
    renderLineHighlight: 'all',
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollBeyondLastLine: false,
    automaticLayout: true,
  }
}

/** The diff editor shows two read-only panes and ignores most of the above. */
export function diffEditorOptionsFromConfiguration(values: Values) {
  return {
    readOnly: true,
    renderSideBySide: true,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: read<number>(values, 'editor.fontSize'),
    fontFamily: read<string>(values, 'editor.fontFamily') || EDITOR_FONT,
    originalEditable: false,
    scrollBeyondLastLine: false,
  }
}
