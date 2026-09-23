/**
 * Glob matching compatible with VS Code's `files.exclude` / `search.exclude`
 * patterns, modelled on `src/vs/base/common/glob.ts`.
 *
 * Supported syntax:
 *   *          any character except `/`
 *   ?          one character except `/`
 *   **         any number of path segments
 *   [abc]      a character set
 *   [!abc]     a negated character set
 *   {a,b}      alternation
 *
 * A pattern with no slash matches a basename anywhere in the tree, which is
 * why a bare `node_modules` and a recursive-prefixed one behave the same way.
 */

export type GlobPattern = string
/** The shape of a VS Code exclude setting, e.g. star-star slash node_modules mapped to true. */
export type GlobExpression = Record<string, boolean>

const cache = new Map<string, RegExp>()

/** Translates a single glob into an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern)
  if (cached) return cached

  let source = ''
  let i = 0
  const n = pattern.length

  while (i < n) {
    const ch = pattern[i]
    switch (ch) {
      case '/': {
        source += '\\/'
        i += 1
        break
      }
      case '*': {
        if (pattern[i + 1] === '*') {
          // `**/` consumes any number of segments, including none.
          if (pattern[i + 2] === '/') {
            source += '(?:[^/]*(?:\\/|$))*'
            i += 3
          } else {
            source += '.*'
            i += 2
          }
        } else {
          source += '[^/]*'
          i += 1
        }
        break
      }
      case '?': {
        source += '[^/]'
        i += 1
        break
      }
      case '[': {
        let set = ''
        let j = i + 1
        let negate = false
        if (pattern[j] === '!' || pattern[j] === '^') {
          negate = true
          j += 1
        }
        while (j < n && pattern[j] !== ']') {
          set += pattern[j] === '\\' ? `\\${pattern[j + 1] ?? ''}` : escapeChar(pattern[j])
          j += pattern[j] === '\\' ? 2 : 1
        }
        if (j >= n) {
          // Unterminated set: treat the bracket literally.
          source += '\\['
          i += 1
        } else {
          source += set ? `[${negate ? '^' : ''}${set}]` : ''
          i = j + 1
        }
        break
      }
      case '{': {
        let depth = 1
        let j = i + 1
        const parts: string[] = []
        let current = ''
        while (j < n && depth > 0) {
          const c = pattern[j]
          if (c === '{') depth += 1
          else if (c === '}') {
            depth -= 1
            if (depth === 0) break
          }
          if (c === ',' && depth === 1) {
            parts.push(current)
            current = ''
          } else {
            current += c
          }
          j += 1
        }
        if (depth !== 0) {
          source += '\\{'
          i += 1
        } else {
          parts.push(current)
          source += `(?:${parts.map((part) => globToRegExp(part).source.replace(/^\^|\$$/g, '')).join('|')})`
          i = j + 1
        }
        break
      }
      default: {
        source += escapeChar(ch)
        i += 1
        break
      }
    }
  }

  const regex = new RegExp(`^${source}$`)
  cache.set(pattern, regex)
  return regex
}

function escapeChar(ch: string) {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch
}

/** Tests one path against one glob. */
export function matchGlob(pattern: string, path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (globToRegExp(pattern).test(normalized)) return true
  // A bare pattern (no separator) also matches any basename in the tree.
  if (!pattern.includes('/')) {
    const base = normalized.split('/').pop() ?? normalized
    return globToRegExp(pattern).test(base)
  }
  return false
}

/** True when any enabled pattern in the expression matches the path exactly. */
export function matchesGlobExpression(expression: GlobExpression, path: string): boolean {
  for (const [pattern, enabled] of Object.entries(expression)) {
    if (enabled && matchGlob(pattern, path)) return true
  }
  return false
}

/**
 * True when the path, or any directory above it, is excluded.
 *
 * This is what callers almost always want: `files.exclude` lists directories
 * such as a recursive node_modules pattern, and excluding that directory has to exclude
 * everything beneath it too.
 */
export function isExcluded(expression: GlobExpression, path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (matchesGlobExpression(expression, normalized)) return true
  const segments = normalized.split('/')
  for (let i = 1; i < segments.length; i += 1) {
    if (matchesGlobExpression(expression, segments.slice(0, i).join('/'))) return true
  }
  return false
}

/** VS Code's out-of-the-box `files.exclude`. */
export const defaultFileExcludes: GlobExpression = {
  '**/.git': true,
  '**/.svn': true,
  '**/.hg': true,
  '**/CVS': true,
  '**/.DS_Store': true,
  '**/Thumbs.db': true,
}

/** VS Code's out-of-the-box `search.exclude`, layered on top of the above. */
export const defaultSearchExcludes: GlobExpression = {
  ...defaultFileExcludes,
  '**/node_modules': true,
  '**/bower_components': true,
  '**/*.code-search': true,
  '**/dist': true,
  '**/out': true,
  '**/build': true,
  '**/coverage': true,
  '**/.next': true,
  '**/target': true,
  '**/__pycache__': true,
  '**/*.min.js': true,
  '**/package-lock.json': true,
}

/** Splits a comma-separated include/exclude box into a glob expression. */
export function parseGlobList(value: string): GlobExpression {
  const out: GlobExpression = {}
  for (const raw of value.split(',')) {
    const pattern = raw.trim()
    if (pattern) out[pattern] = true
  }
  return out
}
