import { describe, expect, it } from 'vitest'
import { defaultSearchExcludes, isExcluded, matchGlob, matchesGlobExpression, parseGlobList } from './glob'
import { applyReplacement, buildSearchRegex, escapeRegExp, replaceInFile, searchFiles, type SearchableFile } from './textSearch'

describe('glob matching', () => {
  it('matches a literal path', () => {
    expect(matchGlob('src/app.ts', 'src/app.ts')).toBe(true)
    expect(matchGlob('src/app.ts', 'src/other.ts')).toBe(false)
  })

  it('matches * within a single segment only', () => {
    expect(matchGlob('src/*.ts', 'src/app.ts')).toBe(true)
    // * must not cross a directory boundary.
    expect(matchGlob('src/*.ts', 'src/nested/app.ts')).toBe(false)
  })

  it('matches ** across segments', () => {
    expect(matchGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true)
    expect(matchGlob('**/*.ts', 'a.ts')).toBe(true)
    expect(matchGlob('**/node_modules', 'a/b/node_modules')).toBe(true)
  })

  it('matches **/ against zero intermediate segments', () => {
    expect(matchGlob('src/**/app.ts', 'src/app.ts')).toBe(true)
  })

  it('matches ? as exactly one character', () => {
    expect(matchGlob('a?.ts', 'ab.ts')).toBe(true)
    expect(matchGlob('a?.ts', 'abc.ts')).toBe(false)
  })

  it('matches character sets and their negation', () => {
    expect(matchGlob('a[bc].ts', 'ab.ts')).toBe(true)
    expect(matchGlob('a[bc].ts', 'ad.ts')).toBe(false)
    expect(matchGlob('a[!bc].ts', 'ad.ts')).toBe(true)
    expect(matchGlob('a[!bc].ts', 'ab.ts')).toBe(false)
  })

  it('matches brace alternation', () => {
    expect(matchGlob('*.{ts,tsx}', 'a.ts')).toBe(true)
    expect(matchGlob('*.{ts,tsx}', 'a.tsx')).toBe(true)
    expect(matchGlob('*.{ts,tsx}', 'a.js')).toBe(false)
  })

  it('matches a bare pattern against any basename in the tree', () => {
    // This is why `node_modules` and `**/node_modules` behave alike.
    expect(matchGlob('node_modules', 'a/b/node_modules')).toBe(true)
  })

  it('treats a dot as literal, not as a regex wildcard', () => {
    expect(matchGlob('a.ts', 'axts')).toBe(false)
  })

  it('does not throw on an unterminated set or brace', () => {
    expect(() => matchGlob('a[bc', 'abc')).not.toThrow()
    expect(() => matchGlob('a{b,c', 'ab')).not.toThrow()
  })

  it('evaluates a glob expression, honouring disabled entries', () => {
    expect(matchesGlobExpression({ '**/*.ts': true }, 'a/b.ts')).toBe(true)
    expect(matchesGlobExpression({ '**/*.ts': false }, 'a/b.ts')).toBe(false)
  })

  it('parses a comma-separated include list', () => {
    expect(parseGlobList('src/**, *.md ')).toEqual({ 'src/**': true, '*.md': true })
  })

  it('excludes a directory and everything beneath it', () => {
    // Excluding `node_modules` has to exclude its contents, not just the
    // directory entry itself.
    for (const path of ['node_modules/react/index.js', 'dist/bundle.js', '.git/config']) {
      expect(isExcluded(defaultSearchExcludes, path), path).toBe(true)
    }
    expect(isExcluded(defaultSearchExcludes, 'src/app.ts')).toBe(false)
  })

  it('distinguishes an exact match from an ancestor match', () => {
    expect(matchesGlobExpression(defaultSearchExcludes, 'node_modules')).toBe(true)
    // The file itself matches no pattern; only its parent directory does.
    expect(matchesGlobExpression(defaultSearchExcludes, 'node_modules/react/index.js')).toBe(false)
    expect(isExcluded(defaultSearchExcludes, 'node_modules/react/index.js')).toBe(true)
  })
})

const files: SearchableFile[] = [
  { path: 'src/app.ts', content: 'const value = 1\nconst other = 2\nconsole.log(value)' },
  { path: 'src/util.ts', content: 'export function value() {\n  return VALUE\n}' },
  { path: 'node_modules/dep/index.js', content: 'const value = 3' },
  { path: 'README.md', content: '# Value\nSome value here.' },
]

describe('text search', () => {
  it('finds matches across files', () => {
    const { results, matchCount } = searchFiles(files, { pattern: 'value' })
    expect(results.map((result) => result.path)).toEqual(['src/app.ts', 'src/util.ts', 'README.md'])
    expect(matchCount).toBeGreaterThan(0)
  })

  it('skips excluded directories by default', () => {
    const { results } = searchFiles(files, { pattern: 'value' })
    expect(results.some((result) => result.path.startsWith('node_modules'))).toBe(false)
  })

  it('can search excluded directories when defaults are off', () => {
    const { results } = searchFiles(files, { pattern: 'value', useDefaultExcludes: false })
    expect(results.some((result) => result.path.startsWith('node_modules'))).toBe(true)
  })

  it('is case-insensitive by default and exact with matchCase', () => {
    expect(searchFiles(files, { pattern: 'VALUE' }).matchCount).toBeGreaterThan(1)
    const exact = searchFiles(files, { pattern: 'VALUE', matchCase: true })
    expect(exact.matchCount).toBe(1)
    expect(exact.results[0].path).toBe('src/util.ts')
  })

  it('honours whole-word matching', () => {
    const partial = searchFiles([{ path: 'a.ts', content: 'value valueOf' }], { pattern: 'value' })
    expect(partial.matchCount).toBe(2)
    const whole = searchFiles([{ path: 'a.ts', content: 'value valueOf' }], { pattern: 'value', wholeWord: true })
    expect(whole.matchCount).toBe(1)
  })

  it('supports regular expressions with capture groups', () => {
    const { results } = searchFiles([{ path: 'a.ts', content: 'const foo = 1' }], {
      pattern: 'const (\\w+)',
      isRegex: true,
    })
    expect(results[0].matches[0].groups).toEqual(['foo'])
  })

  it('returns nothing for an invalid regex instead of throwing', () => {
    expect(() => searchFiles(files, { pattern: 'foo(', isRegex: true })).not.toThrow()
    expect(searchFiles(files, { pattern: 'foo(', isRegex: true }).matchCount).toBe(0)
  })

  it('does not hang on a zero-width regex match', () => {
    const { matchCount } = searchFiles([{ path: 'a.ts', content: 'abc' }], { pattern: 'x*', isRegex: true })
    expect(matchCount).toBeGreaterThan(0)
  })

  it('filters by an include glob', () => {
    const { results } = searchFiles(files, { pattern: 'value', includes: '*.md' })
    expect(results.map((result) => result.path)).toEqual(['README.md'])
  })

  it('filters by an extra exclude glob', () => {
    const { results } = searchFiles(files, { pattern: 'value', excludes: '**/*.md' })
    expect(results.some((result) => result.path.endsWith('.md'))).toBe(false)
  })

  it('reports accurate line numbers and columns', () => {
    const { results } = searchFiles([{ path: 'a.ts', content: 'one\ntwo needle\n' }], { pattern: 'needle' })
    const [match] = results[0].matches
    expect(match.line).toBe(2)
    expect(match.start).toBe(4)
    expect(match.end).toBe(10)
    expect(match.text).toBe('two needle')
  })

  it('stops at the result limit and says so', () => {
    const content = Array.from({ length: 100 }, () => 'hit').join('\n')
    const { matchCount, limitHit } = searchFiles([{ path: 'a.ts', content }], { pattern: 'hit', maxResults: 10 })
    expect(matchCount).toBe(10)
    expect(limitHit).toBe(true)
  })

  it('returns an empty set for an empty query', () => {
    expect(searchFiles(files, { pattern: '' }).matchCount).toBe(0)
  })

  it('escapes regex metacharacters in a literal search', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c')
    const { matchCount } = searchFiles([{ path: 'a.ts', content: 'a.b*c' }], { pattern: 'a.b*c' })
    expect(matchCount).toBe(1)
  })

  it('builds no regex for an empty pattern', () => {
    expect(buildSearchRegex({ pattern: '' })).toBeNull()
  })
})

describe('search and replace', () => {
  it('replaces a single match in a line', () => {
    const match = { line: 1, start: 6, end: 11, text: 'const value = 1' }
    expect(applyReplacement(match, 'total', false)).toBe('const total = 1')
  })

  it('expands capture references when replacing with a regex', () => {
    const match = { line: 1, start: 0, end: 3, text: 'a-b', groups: ['a', 'b'] }
    expect(applyReplacement(match, '$2$1', true)).toBe('ba')
  })

  it('treats $1 literally when the query is not a regex', () => {
    const match = { line: 1, start: 0, end: 1, text: 'x', groups: undefined }
    expect(applyReplacement(match, '$1', false)).toBe('$1')
  })

  it('replaces every match in a file in one pass', () => {
    const content = 'value one\nvalue two'
    const { results } = searchFiles([{ path: 'a.ts', content }], { pattern: 'value' })
    expect(replaceInFile(content, results[0].matches, 'item', false)).toBe('item one\nitem two')
  })

  it('keeps offsets valid with several matches on one line', () => {
    const content = 'aa aa aa'
    const { results } = searchFiles([{ path: 'a.ts', content }], { pattern: 'aa' })
    expect(replaceInFile(content, results[0].matches, 'bbb', false)).toBe('bbb bbb bbb')
  })
})
