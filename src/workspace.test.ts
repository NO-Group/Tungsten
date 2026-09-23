import { describe, expect, it } from 'vitest'
import { fileIconClass, languageForPath, supportedLanguages, symbolsFor } from './workspace'

describe('workspace language detection', () => {
  it.each([
    ['src/main.tsx', 'typescript'],
    ['server.py', 'python'],
    ['src/lib.rs', 'rust'],
    ['cmd/main.go', 'go'],
    ['Dockerfile', 'dockerfile'],
    ['infra/main.tf', 'hcl'],
    ['schema.graphql', 'graphql'],
    ['styles/theme.scss', 'scss'],
    ['.env', 'plaintext'],
  ])('maps %s to %s', (path, language) => {
    expect(languageForPath(path)).toBe(language)
  })

  it('ships a broad language catalog', () => {
    expect(supportedLanguages.length).toBeGreaterThanOrEqual(40)
    expect(supportedLanguages).toContain('Python')
    expect(supportedLanguages).toContain('Rust')
    expect(supportedLanguages).toContain('Terraform')
  })

  it('selects distinct icon families', () => {
    expect(fileIconClass('main.py')).toBe('script')
    expect(fileIconClass('main.cpp')).toBe('native')
    expect(fileIconClass('query.sql')).toBe('query')
    expect(fileIconClass('package.json')).toBe('npm')
  })
})

describe('document symbols', () => {
  it('extracts TypeScript declarations with their kinds', () => {
    const symbols = symbolsFor({
      path: 'a.ts',
      language: 'typescript',
      content: [
        'export class Widget {',
        '  render() {}',
        '}',
        'interface Props {}',
        'function helper() {}',
        'const value = 1',
      ].join('\n'),
    })
    const kinds = Object.fromEntries(symbols.map((symbol) => [symbol.label, symbol.type]))
    expect(kinds.Widget).toBe('class')
    expect(kinds.Props).toBe('interface')
    expect(kinds.helper).toBe('function')
    expect(kinds.value).toBe('constant')
  })

  it('reports one-based line numbers so jumping to a symbol lands correctly', () => {
    const symbols = symbolsFor({ path: 'a.ts', language: 'typescript', content: 'const a = 1\nfunction b() {}' })
    const b = symbols.find((symbol) => symbol.label === 'b')
    expect(b?.line).toBe(2)
  })

  it('derives nesting depth from indentation', () => {
    const symbols = symbolsFor({
      path: 'a.ts',
      language: 'typescript',
      content: 'class Outer {\n  method() {}\n}',
    })
    const outer = symbols.find((symbol) => symbol.label === 'Outer')
    const method = symbols.find((symbol) => symbol.label === 'method')
    expect(outer?.depth).toBe(0)
    if (method) expect(method.depth).toBeGreaterThan(0)
  })

  it('extracts Python definitions', () => {
    const symbols = symbolsFor({
      path: 'a.py',
      language: 'python',
      content: 'class Model:\n    def train(self):\n        pass',
    })
    expect(symbols.map((symbol) => symbol.label)).toContain('Model')
    expect(symbols.map((symbol) => symbol.label)).toContain('train')
  })

  it('returns an empty outline for content with no declarations', () => {
    expect(symbolsFor({ path: 'a.txt', language: 'plaintext', content: 'just prose' })).toEqual([])
  })

  it('caps the outline so a huge file cannot stall the sidebar', () => {
    const content = Array.from({ length: 2000 }, (_, i) => `function fn${i}() {}`).join('\n')
    expect(symbolsFor({ path: 'a.ts', language: 'typescript', content }).length).toBeLessThanOrEqual(400)
  })

  it('gives every symbol a usable label', () => {
    const symbols = symbolsFor({
      path: 'a.ts',
      language: 'typescript',
      content: 'class A {}\ninterface B {}\nfunction c() {}',
    })
    for (const symbol of symbols) {
      expect(symbol.label.length).toBeGreaterThan(0)
      expect(symbol.line).toBeGreaterThan(0)
    }
  })
})
