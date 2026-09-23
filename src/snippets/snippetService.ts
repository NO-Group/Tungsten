import { SnippetParser, type TextmateSnippet } from './snippetParser'
import { createVariableResolver, type SnippetVariableContext } from './snippetVariables'

export interface Snippet {
  /** Stable identifier, `source:languageId:prefix`. */
  id: string
  name: string
  prefix: string
  body: string
  description?: string
  /** `'*'` means the snippet applies to every language. */
  languageId: string
  source: 'builtin' | 'user'
}

export interface SnippetInsertion {
  /** Text to insert, with tabstops and variables already resolved. */
  text: string
  /** Character offsets of each tabstop, in visiting order. */
  tabstops: Array<{ index: number; start: number; end: number; choices: string[] }>
}

const BUILTIN: Array<Omit<Snippet, 'id' | 'source'>> = [
  // TypeScript / JavaScript
  { name: 'Log to console', prefix: 'log', languageId: 'typescript', body: "console.log('$1')$0", description: 'Print to the console' },
  { name: 'Arrow function', prefix: 'af', languageId: 'typescript', body: 'const ${1:name} = (${2:args}) => {\n\t$0\n}' },
  { name: 'Async arrow function', prefix: 'aaf', languageId: 'typescript', body: 'const ${1:name} = async (${2:args}) => {\n\t$0\n}' },
  { name: 'Function', prefix: 'fn', languageId: 'typescript', body: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
  { name: 'Interface', prefix: 'iface', languageId: 'typescript', body: 'interface ${1:Name} {\n\t$0\n}' },
  { name: 'Type alias', prefix: 'type', languageId: 'typescript', body: 'type ${1:Name} = $0' },
  { name: 'Try/catch', prefix: 'try', languageId: 'typescript', body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}' },
  { name: 'For of loop', prefix: 'forof', languageId: 'typescript', body: 'for (const ${1:item} of ${2:items}) {\n\t$0\n}' },
  { name: 'Import module', prefix: 'imp', languageId: 'typescript', body: "import { $2 } from '${1:module}'$0" },
  { name: 'Export default', prefix: 'expd', languageId: 'typescript', body: 'export default ${1:name}$0' },
  { name: 'Describe block', prefix: 'desc', languageId: 'typescript', body: "describe('${1:suite}', () => {\n\t$0\n})" },
  { name: 'Test case', prefix: 'it', languageId: 'typescript', body: "it('${1:does something}', () => {\n\t$0\n})" },
  { name: 'Switch statement', prefix: 'switch', languageId: 'typescript', body: 'switch (${1:value}) {\n\tcase ${2:option}:\n\t\t$0\n\t\tbreak\n\tdefault:\n\t\tbreak\n}' },
  { name: 'Class', prefix: 'class', languageId: 'typescript', body: 'class ${1:Name} {\n\tconstructor(${2:args}) {\n\t\t$0\n\t}\n}' },

  // React
  { name: 'React function component', prefix: 'rfc', languageId: 'tsx', body: "export default function ${1:${TM_FILENAME_BASE}}() {\n\treturn (\n\t\t<div>$0</div>\n\t)\n}" },
  { name: 'useState hook', prefix: 'us', languageId: 'tsx', body: 'const [${1:value}, set${1/(.*)/${1:/capitalize}/}] = useState(${2:initial})$0' },
  { name: 'useEffect hook', prefix: 'ue', languageId: 'tsx', body: 'useEffect(() => {\n\t$0\n}, [$1])' },
  { name: 'useMemo hook', prefix: 'um', languageId: 'tsx', body: 'const ${1:value} = useMemo(() => $2, [$3])$0' },
  { name: 'useCallback hook', prefix: 'uc', languageId: 'tsx', body: 'const ${1:handler} = useCallback((${2:args}) => {\n\t$0\n}, [$3])' },

  // Python
  { name: 'Main guard', prefix: 'main', languageId: 'python', body: "if __name__ == '__main__':\n\t${0:pass}" },
  { name: 'Function', prefix: 'def', languageId: 'python', body: 'def ${1:name}(${2:args}):\n\t"""${3:Summary.}"""\n\t${0:pass}' },
  { name: 'Class', prefix: 'class', languageId: 'python', body: 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${0:pass}' },
  { name: 'Try/except', prefix: 'try', languageId: 'python', body: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:error}:\n\t${0:raise}' },
  { name: 'List comprehension', prefix: 'lc', languageId: 'python', body: '[${1:item} for ${1:item} in ${2:items}]$0' },

  // Rust
  { name: 'Function', prefix: 'fn', languageId: 'rust', body: 'fn ${1:name}(${2:args}) ${3:-> ()} {\n\t$0\n}' },
  { name: 'Test module', prefix: 'test', languageId: 'rust', body: '#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn ${1:works}() {\n\t\t$0\n\t}\n}' },
  { name: 'Match expression', prefix: 'match', languageId: 'rust', body: 'match ${1:value} {\n\t${2:pattern} => $3,\n\t_ => $0,\n}' },
  { name: 'Struct', prefix: 'struct', languageId: 'rust', body: '#[derive(Debug, Clone)]\nstruct ${1:Name} {\n\t$0\n}' },

  // Go
  { name: 'Function', prefix: 'fn', languageId: 'go', body: 'func ${1:name}(${2:args}) ${3:error} {\n\t$0\n}' },
  { name: 'Error check', prefix: 'iferr', languageId: 'go', body: 'if err != nil {\n\treturn ${1:err}\n}\n$0' },
  { name: 'Struct', prefix: 'struct', languageId: 'go', body: 'type ${1:Name} struct {\n\t$0\n}' },

  // Any language
  { name: 'TODO comment', prefix: 'todo', languageId: '*', body: '${LINE_COMMENT} TODO($CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE): $0' },
  { name: 'File header', prefix: 'header', languageId: '*', body: '${BLOCK_COMMENT_START}\n  ${TM_FILENAME}\n  ${1:Description}\n  Created $CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE\n${BLOCK_COMMENT_END}\n$0' },
  { name: 'UUID', prefix: 'uuid', languageId: '*', body: '$UUID$0' },
]

export const builtinSnippets: Snippet[] = BUILTIN.map((snippet) => ({
  ...snippet,
  id: `builtin:${snippet.languageId}:${snippet.prefix}`,
  source: 'builtin' as const,
}))

/** Snippets that apply to a language, including the `*` globals. */
export function snippetsForLanguage(all: Snippet[], languageId: string) {
  return all.filter((snippet) => snippet.languageId === languageId || snippet.languageId === '*')
}

/**
 * Resolves a snippet body into insertable text plus tabstop positions.
 *
 * Indentation is normalised to the editor's settings: snippet bodies are
 * authored with tabs, and each leading tab becomes `indent`, with subsequent
 * lines prefixed by the current line's indentation the way VS Code does.
 */
export function resolveSnippet(body: string, context: SnippetVariableContext = {}): SnippetInsertion {
  const parser = new SnippetParser()
  const snippet: TextmateSnippet = parser.parse(body, true)
  snippet.resolveVariables(createVariableResolver(context))

  const indent = context.indent ?? '  '
  const eol = context.eol ?? '\n'
  const baseIndent = context.currentLine ? (context.currentLine.match(/^[\t ]*/)?.[0] ?? '') : ''

  let text = snippet.toString()

  // Record tabstops against the raw text before reindenting, then map the
  // offsets forward so they survive the whitespace rewrite.
  const raw = text
  const stops = snippet.placeholders
    .slice()
    .sort((a, b) => {
      if (a.index === b.index) return snippet.offset(a) - snippet.offset(b)
      if (a.index === 0) return 1
      if (b.index === 0) return -1
      return a.index - b.index
    })
    .map((placeholder) => {
      const start = snippet.offset(placeholder)
      return {
        index: placeholder.index,
        start,
        end: start + snippet.fullLen(placeholder),
        choices: placeholder.choice?.options.map((option) => option.value) ?? [],
      }
    })
    .filter((stop) => stop.start >= 0)

  const reindent = (value: string) => value
    .split('\n')
    .map((line, lineIndex) => {
      const leading = line.match(/^\t*/)?.[0] ?? ''
      const rest = line.slice(leading.length)
      const prefix = lineIndex === 0 ? '' : baseIndent
      return prefix + indent.repeat(leading.length) + rest
    })
    .join(eol)

  text = reindent(raw)

  // Offsets shift by however much the prefix of the text grew.
  const mapOffset = (offset: number) => reindent(raw.slice(0, offset)).length
  const tabstops = stops.map((stop) => ({
    ...stop,
    start: mapOffset(stop.start),
    end: mapOffset(stop.end),
  }))

  return { text, tabstops }
}

/** Parses a VS Code `snippets.json` file (the `{ name: { prefix, body } }` shape). */
export function parseSnippetFile(source: string, languageId: string): Snippet[] {
  let data: Record<string, { prefix?: string | string[]; body?: string | string[]; description?: string }>
  try {
    data = JSON.parse(stripJsonComments(source))
  } catch {
    return []
  }
  const out: Snippet[] = []
  for (const [name, entry] of Object.entries(data ?? {})) {
    if (!entry || typeof entry !== 'object') continue
    const prefixes = Array.isArray(entry.prefix) ? entry.prefix : [entry.prefix]
    const body = Array.isArray(entry.body) ? entry.body.join('\n') : entry.body
    if (!body) continue
    for (const prefix of prefixes) {
      if (!prefix) continue
      out.push({
        id: `user:${languageId}:${prefix}`,
        name,
        prefix,
        body,
        description: entry.description,
        languageId,
        source: 'user',
      })
    }
  }
  return out
}

/** Minimal JSONC support so user snippet files may carry comments. */
function stripJsonComments(source: string) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += ch
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}
