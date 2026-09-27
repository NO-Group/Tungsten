/**
 * The small coloured monogram shown beside a file in tabs, trees and
 * breadcrumbs. Colour and glyph come from the icon theme in
 * `src/theme/fileIcons.ts`, so language identity stays consistent
 * everywhere a filename appears.
 */

import { fileIconClass } from '../workspace'
import { fileIconFor } from '../theme/fileIcons'

export function FileGlyph({ path }: { path: string }) {
  const icon = fileIconFor(path)
  return (
    <span
      className={`file-glyph ${fileIconClass(path)}`}
      style={{ color: icon.color }}
      title={icon.label}
      aria-hidden
    >{icon.glyph}</span>
  )
}

export default FileGlyph
