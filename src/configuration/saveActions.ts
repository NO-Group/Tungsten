/**
 * What happens to a file's text on the way to disk.
 *
 * `files.trimTrailingWhitespace`, `files.insertFinalNewline` and `files.eol`
 * are declared settings, so saving has to honour them. They are pure string
 * transforms, applied in the order VS Code applies them: trim, then add the
 * final newline, then normalise the line endings.
 */

import { configurationSchema } from './configurationRegistry'

export type SaveOptions = {
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
  /** '\n', '\r\n', or 'auto' to keep whatever the file already uses. */
  eol: string
}

export function saveOptionsFromConfiguration(values: Record<string, unknown>): SaveOptions {
  const read = <T>(key: string) => (key in values ? values[key] : configurationSchema[key]?.default) as T
  return {
    trimTrailingWhitespace: read<boolean>('files.trimTrailingWhitespace'),
    insertFinalNewline: read<boolean>('files.insertFinalNewline'),
    eol: read<string>('files.eol'),
  }
}

/** Applies the on-save transforms. Returns the text unchanged if none apply. */
export function applySaveActions(content: string, options: SaveOptions): string {
  let text = content

  if (options.trimTrailingWhitespace) {
    // Trailing whitespace only: the line endings themselves are left alone
    // so a file with CRLF does not silently become LF here.
    text = text.replace(/[^\S\r\n]+(?=\r?\n|$)/g, '')
  }

  if (options.insertFinalNewline && text.length && !/\n$/.test(text)) {
    text += text.includes('\r\n') ? '\r\n' : '\n'
  }

  if (options.eol === '\n' || options.eol === '\r\n') {
    text = text.replace(/\r\n|\r|\n/g, options.eol)
  }

  return text
}
