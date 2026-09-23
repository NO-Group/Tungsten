import { describe, expect, it } from 'vitest'
import { createMatches, prepareQuery, scoreFuzzy, scoreItem } from './fuzzyScorer'

const score = (target: string, query: string) => scoreFuzzy(target, query, query.toLowerCase(), true).score

describe('scoreFuzzy', () => {
  it('scores a match and rejects a non-match', () => {
    expect(score('helloWorld', 'hello')).toBeGreaterThan(0)
    expect(score('helloWorld', 'zzz')).toBe(0)
  })

  it('returns no score when the query is longer than the target', () => {
    expect(score('ab', 'abcdef')).toBe(0)
  })

  it('prefers a prefix match over a mid-word match', () => {
    expect(score('indexer', 'index')).toBeGreaterThan(score('myindexer', 'index'))
  })

  it('rewards camelCase humps', () => {
    expect(score('NullPointerException', 'npe')).toBeGreaterThan(0)
    // The hump match should beat a scattered lowercase match of the same length.
    expect(score('NullPointerException', 'npe')).toBeGreaterThan(score('nonpaidentry', 'npe'))
  })

  it('rewards separators, ranking path-boundary matches highly', () => {
    expect(score('src/main/app.ts', 'sma')).toBeGreaterThan(0)
  })

  it('rewards consecutive runs over scattered matches', () => {
    expect(score('abcdef', 'abc')).toBeGreaterThan(score('axbxcx', 'abc'))
  })

  it('treats path separators as interchangeable', () => {
    expect(score('src/app.ts', 'src/app')).toBeGreaterThan(0)
    expect(score('src\\app.ts', 'src/app')).toBeGreaterThan(0)
  })

  it('reports match positions in order', () => {
    const result = scoreFuzzy('helloWorld', 'hw', 'hw', true)
    expect(result.positions).toEqual([0, 5])
  })
})

describe('createMatches', () => {
  it('collapses adjacent positions into ranges', () => {
    expect(createMatches([0, 1, 2, 5, 6])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 7 }])
  })

  it('handles an empty input', () => {
    expect(createMatches([])).toEqual([])
  })
})

describe('prepareQuery', () => {
  it('strips whitespace and lower-cases', () => {
    const query = prepareQuery('  App Component ')
    expect(query.normalized).toBe('AppComponent')
    expect(query.normalizedLower).toBe('appcomponent')
  })

  it('detects a path separator in the query', () => {
    expect(prepareQuery('src/app').containsPathSeparator).toBe(true)
    expect(prepareQuery('app').containsPathSeparator).toBe(false)
  })

  it('treats a quoted query as a contiguous match request', () => {
    const query = prepareQuery('"app"')
    expect(query.expectContiguousMatch).toBe(true)
    expect(query.normalized).toBe('app')
  })
})

describe('scoreItem', () => {
  it('ranks a basename match above a path-only match', () => {
    const query = prepareQuery('app')
    const basename = scoreItem('app.ts', 'src/utils', query).score
    const pathOnly = scoreItem('index.ts', 'src/app', query).score
    expect(basename).toBeGreaterThan(pathOnly)
    expect(pathOnly).toBeGreaterThan(0)
  })

  it('ranks a basename prefix above a basename substring', () => {
    const query = prepareQuery('app')
    const prefix = scoreItem('app.ts', 'src', query).score
    const substring = scoreItem('myapp.ts', 'src', query).score
    expect(prefix).toBeGreaterThan(substring)
  })

  it('gives an exact path the top score', () => {
    const query = prepareQuery('src/app.ts')
    const exact = scoreItem('app.ts', 'src', query).score
    const other = scoreItem('app.ts', 'lib', query).score
    expect(exact).toBeGreaterThan(other)
  })

  it('splits highlight ranges across label and description', () => {
    const result = scoreItem('app.ts', 'src', prepareQuery('src/app'))
    expect(result.score).toBeGreaterThan(0)
    expect(result.descriptionMatch.length).toBeGreaterThan(0)
    expect(result.labelMatch.length).toBeGreaterThan(0)
  })

  it('returns no score for an empty query or a non-match', () => {
    expect(scoreItem('app.ts', 'src', prepareQuery('')).score).toBe(0)
    expect(scoreItem('app.ts', 'src', prepareQuery('zzzz')).score).toBe(0)
  })

  it('honours a quoted contiguous query', () => {
    expect(scoreItem('application.ts', 'src', prepareQuery('"app"')).score).toBeGreaterThan(0)
    expect(scoreItem('a-p-p.ts', 'src', prepareQuery('"app"')).score).toBe(0)
  })
})
