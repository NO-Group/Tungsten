import { describe, expect, it } from 'vitest'
import { fileIconClass, languageForPath, supportedLanguages } from './workspace'

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
