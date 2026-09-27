/**
 * Renders text with the fuzzy-matched characters emphasised, the way VS Code
 * highlights quick-open results. Ranges come from the scorer, so what the user
 * sees marked is exactly what the ranking was based on.
 */

import type React from 'react'
import type { Match } from '../quickopen/fuzzyScorer'

export function Highlight({ text, matches }: { text: string; matches: Match[] }) {
  if (!matches.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start))
    parts.push(<mark key={`${match.start}-${index}`}>{text.slice(match.start, match.end)}</mark>)
    cursor = match.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

export default Highlight
