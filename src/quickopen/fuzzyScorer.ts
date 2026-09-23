/**
 * Fuzzy scoring, ported from VS Code's `src/vs/base/common/fuzzyScorer.ts`.
 *
 * This is the algorithm that makes Quick Open and the Command Palette feel right:
 * a dynamic-programming matrix scores every query character against every target
 * character, with bonuses for consecutive runs, word starts, path separators and
 * camelCase humps. Item scoring then weights a basename match far above a match
 * that only occurs in the containing directory path.
 *
 * Upstream is MIT licensed (c) Microsoft Corporation.
 */

export type FuzzyScore = { score: number; positions: number[] }
export type Match = { start: number; end: number }

const NO_MATCH = 0
const NO_SCORE: FuzzyScore = { score: NO_MATCH, positions: [] }

/** Matches on the basename outrank matches that only hit the directory path. */
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17
const LABEL_SCORE_THRESHOLD = 1 << 16
/** An exact path match always wins. */
const PATH_IDENTITY_SCORE = 1 << 18

const CHAR_SLASH = '/'.charCodeAt(0)
const CHAR_BACKSLASH = '\\'.charCodeAt(0)
const CHAR_UNDERSCORE = '_'.charCodeAt(0)
const CHAR_DASH = '-'.charCodeAt(0)
const CHAR_PERIOD = '.'.charCodeAt(0)
const CHAR_SPACE = ' '.charCodeAt(0)
const CHAR_SINGLE_QUOTE = "'".charCodeAt(0)
const CHAR_DOUBLE_QUOTE = '"'.charCodeAt(0)
const CHAR_COLON = ':'.charCodeAt(0)
const CHAR_A = 'A'.charCodeAt(0)
const CHAR_Z = 'Z'.charCodeAt(0)

function isUpper(code: number) {
  return code >= CHAR_A && code <= CHAR_Z
}

/** Path separators score higher than other separators, exactly as upstream. */
function scoreSeparatorAtPos(code: number) {
  switch (code) {
    case CHAR_SLASH:
    case CHAR_BACKSLASH:
      return 5
    case CHAR_UNDERSCORE:
    case CHAR_DASH:
    case CHAR_PERIOD:
    case CHAR_SPACE:
    case CHAR_SINGLE_QUOTE:
    case CHAR_DOUBLE_QUOTE:
    case CHAR_COLON:
      return 4
    default:
      return 0
  }
}

/** Treat `/` and `\` as the same character so queries work across platforms. */
function considerAsEqual(a: string, b: string) {
  if (a === b) return true
  if (a === '/' || a === '\\') return b === '/' || b === '\\'
  return false
}

function computeCharScore(
  queryCharAtIndex: string,
  queryLowerCharAtIndex: string,
  target: string,
  targetLower: string,
  targetIndex: number,
  matchesSequenceLength: number,
) {
  let score = 0
  if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) return score

  // Base bonus for matching the character at all.
  score += 1

  // Consecutive run bonus: the first three characters of a run get the full
  // bonus, the remainder half, so long runs do not completely dominate.
  if (matchesSequenceLength > 0) {
    score += Math.min(matchesSequenceLength, 3) * 6 + Math.max(0, matchesSequenceLength - 3) * 3
  }

  // Same-case bonus.
  if (queryCharAtIndex === target[targetIndex]) score += 1

  if (targetIndex === 0) {
    // Start-of-word bonus.
    score += 8
  } else {
    const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1))
    if (separatorBonus) {
      score += separatorBonus
    } else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) {
      // camelCase hump bonus, only outside a contiguous run:
      // "NPE" -> "NullPointerException" is boosted, "HTTP" -> "HTTP" is not.
      score += 2
    }
  }

  return score
}

function doScoreFuzzy(
  query: string,
  queryLower: string,
  queryLength: number,
  target: string,
  targetLower: string,
  targetLength: number,
  allowNonContiguousMatches: boolean,
): FuzzyScore {
  const scores: number[] = []
  const matches: number[] = []

  // Build the scoring matrix: rows are query characters, columns target characters.
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex += 1) {
    const queryIndexOffset = queryIndex * targetLength
    const queryIndexPreviousOffset = queryIndexOffset - targetLength
    const queryIndexGtNull = queryIndex > 0
    const queryCharAtIndex = query[queryIndex]
    const queryLowerCharAtIndex = queryLower[queryIndex]

    for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
      const targetIndexGtNull = targetIndex > 0
      const currentIndex = queryIndexOffset + targetIndex
      const leftIndex = currentIndex - 1
      const diagIndex = queryIndexPreviousOffset + targetIndex - 1

      const leftScore = targetIndexGtNull ? scores[leftIndex] : 0
      const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0
      const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0

      // Past the first query character we only score where the previous character
      // also matched, which keeps the match in sequence.
      const score = !diagScore && queryIndexGtNull
        ? 0
        : computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength)

      const isValidScore = score && diagScore + score >= leftScore
      if (isValidScore && (allowNonContiguousMatches || queryIndexGtNull || targetLower.startsWith(queryLower, targetIndex))) {
        matches[currentIndex] = matchesSequenceLength + 1
        scores[currentIndex] = diagScore + score
      } else {
        matches[currentIndex] = NO_MATCH
        scores[currentIndex] = leftScore
      }
    }
  }

  // Walk back from the bottom-right of the matrix to recover match positions.
  const positions: number[] = []
  let queryIndex = queryLength - 1
  let targetIndex = targetLength - 1
  while (queryIndex >= 0 && targetIndex >= 0) {
    const currentIndex = queryIndex * targetLength + targetIndex
    if (matches[currentIndex] === NO_MATCH) {
      targetIndex -= 1
    } else {
      positions.push(targetIndex)
      queryIndex -= 1
      targetIndex -= 1
    }
  }

  return { score: scores[queryLength * targetLength - 1] || NO_MATCH, positions: positions.reverse() }
}

/** Score a single string against a query. */
export function scoreFuzzy(target: string, query: string, queryLower: string, allowNonContiguousMatches: boolean): FuzzyScore {
  if (!target || !query) return NO_SCORE
  const targetLength = target.length
  const queryLength = query.length
  if (targetLength < queryLength) return NO_SCORE
  return doScoreFuzzy(query, queryLower, queryLength, target, target.toLowerCase(), targetLength, allowNonContiguousMatches)
}

/** Collapse sorted match positions into contiguous ranges for highlighting. */
export function createMatches(positions: number[]): Match[] {
  const result: Match[] = []
  let current: Match | undefined
  for (const position of positions) {
    if (current && position === current.end) {
      current.end += 1
    } else {
      current = { start: position, end: position + 1 }
      result.push(current)
    }
  }
  return result
}

export type PreparedQuery = {
  original: string
  normalized: string
  normalizedLower: string
  /** Set when the query contains a path separator, which forces full-path matching. */
  containsPathSeparator: boolean
  expectContiguousMatch: boolean
}

/**
 * Normalise a raw query. A query wrapped in double quotes requests a contiguous
 * match, mirroring VS Code's behaviour.
 */
export function prepareQuery(original: string): PreparedQuery {
  const trimmed = original.trim()
  const expectContiguousMatch = trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"')
  const normalized = (expectContiguousMatch ? trimmed.slice(1, -1) : trimmed).replace(/\s/g, '')
  return {
    original,
    normalized,
    normalizedLower: normalized.toLowerCase(),
    containsPathSeparator: normalized.includes('/') || normalized.includes('\\'),
    expectContiguousMatch,
  }
}

export type ItemScore = {
  score: number
  labelMatch: Match[]
  descriptionMatch: Match[]
}

const NO_ITEM_SCORE: ItemScore = { score: NO_MATCH, labelMatch: [], descriptionMatch: [] }

/**
 * Score a label/description pair the way Quick Open does.
 *
 * `label` is typically the file basename and `description` the containing folder.
 * A basename hit is weighted above `LABEL_SCORE_THRESHOLD` so that it always sorts
 * ahead of a path-only hit, and a basename *prefix* hit ranks higher still.
 */
export function scoreItem(
  label: string,
  description: string | undefined,
  query: PreparedQuery,
  allowNonContiguousMatches = true,
): ItemScore {
  if (!query.normalized) return NO_ITEM_SCORE

  const fullPath = description ? `${description}/${label}` : label
  if (fullPath === query.normalized) {
    return {
      score: PATH_IDENTITY_SCORE,
      labelMatch: [{ start: 0, end: label.length }],
      descriptionMatch: description ? [{ start: 0, end: description.length }] : [],
    }
  }

  const contiguous = query.expectContiguousMatch || !allowNonContiguousMatches

  // Prefer a hit on the label itself unless the query clearly targets a path.
  if (!query.containsPathSeparator) {
    const labelScore = scoreFuzzy(label, query.normalized, query.normalizedLower, !contiguous)
    if (labelScore.score) {
      const isPrefix = label.toLowerCase().startsWith(query.normalizedLower)
      const base = isPrefix ? LABEL_PREFIX_SCORE_THRESHOLD : LABEL_SCORE_THRESHOLD
      return { score: base + labelScore.score, labelMatch: createMatches(labelScore.positions), descriptionMatch: [] }
    }
  }

  // Otherwise score against the whole path and split the highlights back out.
  if (description) {
    const descriptionPrefixLength = description.length + 1
    const pathScore = scoreFuzzy(fullPath, query.normalized, query.normalizedLower, !contiguous)
    if (pathScore.score) {
      const labelMatch: Match[] = []
      const descriptionMatch: Match[] = []
      for (const match of createMatches(pathScore.positions)) {
        if (match.start >= descriptionPrefixLength) {
          labelMatch.push({ start: match.start - descriptionPrefixLength, end: match.end - descriptionPrefixLength })
        } else if (match.end > descriptionPrefixLength) {
          // A range straddling the separator is split across both fields.
          labelMatch.push({ start: 0, end: match.end - descriptionPrefixLength })
          descriptionMatch.push({ start: match.start, end: descriptionPrefixLength })
        } else {
          descriptionMatch.push(match)
        }
      }
      return { score: pathScore.score, labelMatch, descriptionMatch }
    }
  }

  return NO_ITEM_SCORE
}

/**
 * Sort helper matching VS Code's comparer: score first, then prefer the shorter
 * label so that `index.ts` beats `indexOfSomethingElse.ts` at equal score.
 */
export function compareItemsByScore<T>(
  a: T,
  b: T,
  scoreOf: (item: T) => ItemScore,
  labelOf: (item: T) => string,
): number {
  const scoreA = scoreOf(a).score
  const scoreB = scoreOf(b).score
  if (scoreA !== scoreB) return scoreB - scoreA
  const labelA = labelOf(a)
  const labelB = labelOf(b)
  if (labelA.length !== labelB.length) return labelA.length - labelB.length
  return labelA.localeCompare(labelB)
}
