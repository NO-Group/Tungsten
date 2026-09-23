import { describe, expect, it } from 'vitest'
import { Placeholder, SnippetParser, Text, Variable } from './snippetParser'
import { createVariableResolver } from './snippetVariables'
import { builtinSnippets, parseSnippetFile, resolveSnippet, snippetsForLanguage } from './snippetService'

const parse = (value: string) => new SnippetParser().parse(value)
const text = (value: string) => parse(value).toString()

describe('snippet parser', () => {
  it('passes plain text through unchanged', () => {
    expect(text('hello world')).toBe('hello world')
  })

  it('parses simple tabstops', () => {
    const snippet = parse('foo$1bar$2')
    expect(snippet.toString()).toBe('foobar')
    expect(snippet.placeholders.map((p) => p.index)).toEqual([1, 2])
  })

  it('parses placeholders with defaults', () => {
    const snippet = parse('${1:name}')
    expect(snippet.toString()).toBe('name')
    expect(snippet.placeholders).toHaveLength(1)
  })

  it('parses nested placeholders', () => {
    const snippet = parse('${1:outer ${2:inner}}')
    expect(snippet.toString()).toBe('outer inner')
    expect(snippet.placeholders.map((p) => p.index).sort()).toEqual([1, 2])
  })

  it('mirrors a repeated tabstop index to the first default value', () => {
    // $1 appearing twice means both render the same default.
    const snippet = parse('${1:value} and $1')
    expect(snippet.toString()).toBe('value and value')
  })

  it('parses choices', () => {
    const snippet = parse('${1|one,two,three|}')
    const choice = snippet.placeholders[0].choice
    expect(choice?.options.map((option) => option.value)).toEqual(['one', 'two', 'three'])
    // The first option is what gets inserted.
    expect(snippet.toString()).toBe('one')
  })

  it('parses variables', () => {
    const snippet = parse('$TM_FILENAME')
    expect(snippet.children[0]).toBeInstanceOf(Variable)
  })

  it('parses variables with defaults', () => {
    const snippet = parse('${TM_FILENAME:untitled.txt}')
    expect(snippet.toString()).toBe('untitled.txt')
  })

  it('handles escapes', () => {
    expect(text('\\$1')).toBe('$1')
    expect(text('\\}')).toBe('}')
    expect(text('\\\\')).toBe('\\')
  })

  it('treats a malformed placeholder as literal text rather than throwing', () => {
    expect(() => parse('${1')).not.toThrow()
    expect(text('${1')).toBe('${1')
  })

  it('survives an invalid transform regex', () => {
    expect(() => parse('${1/(/x/}')).not.toThrow()
  })

  it('appends a final tabstop when asked', () => {
    const snippet = new SnippetParser().parse('${1:a}', true)
    expect(snippet.placeholders.some((p) => p.index === 0)).toBe(true)
  })

  it('sorts the final tabstop last', () => {
    const snippet = parse('$0 $1 $2')
    const sorted = snippet.placeholders.slice().sort(Placeholder.compareByIndex)
    expect(sorted.map((p) => p.index)).toEqual([1, 2, 0])
  })

  it('reports marker offsets within the rendered text', () => {
    const snippet = parse('abc${1:X}def')
    expect(snippet.offset(snippet.placeholders[0])).toBe(3)
  })

  it('strips everything down to insert text', () => {
    expect(SnippetParser.asInsertText('${1:foo} $2 bar')).toBe('foo  bar')
  })

  it('escapes text for round-tripping', () => {
    expect(Text.escape('a$b}c')).toBe('a\\$b\\}c')
  })
})

describe('snippet transforms', () => {
  const resolve = (template: string, vars: Record<string, string>) =>
    parse(template).resolveVariables((name) => vars[name]).toString()

  it('applies /upcase', () => {
    expect(resolve('${FOO/(.*)/${1:/upcase}/}', { FOO: 'hello' })).toBe('HELLO')
  })

  it('applies /downcase', () => {
    expect(resolve('${FOO/(.*)/${1:/downcase}/}', { FOO: 'HELLO' })).toBe('hello')
  })

  it('applies /capitalize', () => {
    expect(resolve('${FOO/(.*)/${1:/capitalize}/}', { FOO: 'hello' })).toBe('Hello')
  })

  it('applies /pascalcase', () => {
    expect(resolve('${FOO/(.*)/${1:/pascalcase}/}', { FOO: 'hello world' })).toBe('HelloWorld')
  })

  it('applies /camelcase', () => {
    expect(resolve('${FOO/(.*)/${1:/camelcase}/}', { FOO: 'hello world' })).toBe('helloWorld')
  })

  it('substitutes capture groups', () => {
    expect(resolve('${FOO/(\\w+)-(\\w+)/$2_$1/}', { FOO: 'a-b' })).toBe('b_a')
  })

  it('honours the if-branch of a conditional format', () => {
    expect(resolve('${FOO/(a)?.*/${1:+yes}/}', { FOO: 'abc' })).toBe('yes')
  })

  it('honours the else-branch when the group is empty', () => {
    expect(resolve('${FOO/(a)?.*/${1:-no}/}', { FOO: 'xyz' })).toBe('no')
  })
})

describe('snippet variables', () => {
  const now = new Date('2026-09-23T14:05:09')

  it('resolves filename variables', () => {
    const resolver = createVariableResolver({ filePath: 'src/components/Button.tsx' })
    expect(resolver('TM_FILENAME')).toBe('Button.tsx')
    expect(resolver('TM_FILENAME_BASE')).toBe('Button')
    expect(resolver('TM_DIRECTORY')).toBe('src/components')
  })

  it('resolves date and time variables from an injected clock', () => {
    const resolver = createVariableResolver({ now })
    expect(resolver('CURRENT_YEAR')).toBe('2026')
    expect(resolver('CURRENT_MONTH')).toBe('09')
    expect(resolver('CURRENT_DATE')).toBe('23')
    expect(resolver('CURRENT_MONTH_NAME')).toBe('September')
    expect(resolver('CURRENT_MONTH_NAME_SHORT')).toBe('Sep')
    expect(resolver('CURRENT_HOUR')).toBe('14')
    expect(resolver('CURRENT_SECOND')).toBe('09')
  })

  it('resolves language-aware comment variables', () => {
    expect(createVariableResolver({ languageId: 'python' })('LINE_COMMENT')).toBe('#')
    expect(createVariableResolver({ languageId: 'typescript' })('LINE_COMMENT')).toBe('//')
    expect(createVariableResolver({ languageId: 'sql' })('LINE_COMMENT')).toBe('--')
  })

  it('generates a well-formed v4 UUID', () => {
    const uuid = createVariableResolver({})('UUID')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('returns undefined for unknown variables so defaults survive', () => {
    expect(createVariableResolver({})('NOT_A_VARIABLE')).toBeUndefined()
    // An unknown variable with a default keeps the default.
    const snippet = parse('${NOT_A_VARIABLE:fallback}')
    snippet.resolveVariables(createVariableResolver({}))
    expect(snippet.toString()).toBe('fallback')
  })
})

describe('snippet service', () => {
  it('resolves a snippet into text plus ordered tabstops', () => {
    const { text: body, tabstops } = resolveSnippet('const ${1:name} = ${2:value}$0', { indent: '  ' })
    expect(body).toBe('const name = value')
    expect(tabstops.map((stop) => stop.index)).toEqual([1, 2, 0])
    expect(body.slice(tabstops[0].start, tabstops[0].end)).toBe('name')
    expect(body.slice(tabstops[1].start, tabstops[1].end)).toBe('value')
  })

  it('reindents tab-authored bodies to the configured indent', () => {
    const { text: body } = resolveSnippet('if (x) {\n\t$0\n}', { indent: '    ' })
    expect(body).toBe('if (x) {\n    \n}')
  })

  it('keeps tabstop offsets correct after reindenting', () => {
    const { text: body, tabstops } = resolveSnippet('fn() {\n\t${1:body}\n}', { indent: '    ' })
    expect(body.slice(tabstops[0].start, tabstops[0].end)).toBe('body')
  })

  it('carries choices through to the caller', () => {
    const { tabstops } = resolveSnippet('${1|a,b|}')
    expect(tabstops[0].choices).toEqual(['a', 'b'])
  })

  it('ships builtin snippets for the major languages', () => {
    for (const language of ['typescript', 'python', 'rust', 'go', 'tsx']) {
      expect(snippetsForLanguage(builtinSnippets, language).length, language).toBeGreaterThan(0)
    }
  })

  it('includes global snippets in every language', () => {
    const globals = builtinSnippets.filter((snippet) => snippet.languageId === '*')
    expect(globals.length).toBeGreaterThan(0)
    const forPython = snippetsForLanguage(builtinSnippets, 'python')
    for (const global of globals) expect(forPython).toContain(global)
  })

  it('parses every builtin snippet body into non-empty text', () => {
    for (const snippet of builtinSnippets) {
      expect(() => new SnippetParser().parse(snippet.body), snippet.id).not.toThrow()
      // Resolve variables too: bodies such as `$UUID$0` are entirely variable
      // references and only produce text once a resolver has run.
      const { text: resolved } = resolveSnippet(snippet.body, {
        filePath: 'src/Example.tsx',
        languageId: snippet.languageId === '*' ? 'typescript' : snippet.languageId,
      })
      expect(resolved.length, snippet.id).toBeGreaterThan(0)
    }
  })

  it('gives every builtin snippet a unique id', () => {
    const ids = builtinSnippets.map((snippet) => snippet.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reads VS Code snippet files, including array bodies and comments', () => {
    const source = `{
      // a comment
      "Log": { "prefix": "log", "body": ["console.log($1)", "$0"], "description": "Log" }
    }`
    const [snippet] = parseSnippetFile(source, 'typescript')
    expect(snippet.prefix).toBe('log')
    expect(snippet.body).toBe('console.log($1)\n$0')
    expect(snippet.source).toBe('user')
  })

  it('expands a snippet file entry with multiple prefixes', () => {
    const source = '{ "Log": { "prefix": ["log", "cl"], "body": "console.log()" } }'
    expect(parseSnippetFile(source, 'typescript').map((s) => s.prefix)).toEqual(['log', 'cl'])
  })

  it('returns nothing for a malformed snippet file instead of throwing', () => {
    expect(parseSnippetFile('{ not json', 'typescript')).toEqual([])
  })
})
