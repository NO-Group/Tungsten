import { describe, expect, it } from 'vitest'

import { createDictionary } from '../shell/commandDictionary'
import { APROPOS_LIMIT, runSandboxCommand, sandboxCommands, type ShellContext } from './sandboxShell'

const context: ShellContext = {
  workspaceName: 'forge',
  files: [
    { path: 'README.md', content: '# Forge' },
    { path: 'src/main.ts', content: 'export const main = 1' },
    { path: 'src/utils/dates.ts', content: 'export const days = 7' },
  ],
  dirty: new Set(),
  now: () => new Date('2026-09-27T08:30:00Z'),
}

/** Everything except the echoed prompt line. */
const output = (command: string, overrides: Partial<ShellContext> = {}) =>
  runSandboxCommand(command, { ...context, ...overrides }).lines.slice(1)

describe('sandbox shell', () => {
  it('echoes the command the way a prompt does', () => {
    const [prompt] = runSandboxCommand('pwd', context).lines
    expect(prompt).toEqual({ text: 'tungsten@forge ~/forge $ pwd', kind: 'command' })
  })

  it('ignores an empty command without adding a prompt line', () => {
    expect(runSandboxCommand('   ', context)).toEqual({ lines: [] })
  })

  it('clears the scrollback rather than appending to it', () => {
    expect(runSandboxCommand('clear', context)).toEqual({ clear: true, lines: [] })
  })

  it('lists the immediate children of a directory', () => {
    expect(output('ls')[0].text).toBe('README.md   src/')
    expect(output('ls src')[0].text).toBe('main.ts   utils/')
    // A trailing slash is how directories are usually typed.
    expect(output('ls src/')[0].text).toBe('main.ts   utils/')
    expect(output('ls nope')[0].text).toBe('ls: nope: No such directory')
  })

  it('prints a file and reports a missing one as an error', () => {
    expect(output('cat src/main.ts')[0]).toEqual({ text: 'export const main = 1', kind: undefined })
    expect(output('cat nope.ts')[0]).toEqual({ text: 'cat: nope.ts: No such file', kind: 'error' })
    expect(output('cat')[0].text).toBe('cat: : No such file')
  })

  it('reports unsaved buffers through git status', () => {
    expect(output('git status')[0]).toEqual({ text: 'On branch main\nnothing to commit, working tree clean', kind: 'success' })

    const [line] = output('git status', { dirty: new Set(['src/main.ts', 'README.md']) })
    expect(line.kind).toBe('warning')
    expect(line.text).toContain('Changes not staged for commit:')
    expect(line.text).toContain('modified: src/main.ts')
    expect(line.text).toContain('modified: README.md')
  })

  it('answers the remaining builtins', () => {
    expect(output('pwd')[0].text).toBe('/workspace/forge')
    expect(output('whoami')[0].text).toBe('tungsten')
    expect(output('echo hello  world')[0].text).toBe('hello world')
    expect(output('date')[0].text).toContain('2026')
    expect(output('npm run build')[0].kind).toBe('success')
  })

  it('lists exactly what it supports in help', () => {
    expect(output('help')[0].text).toBe(`Available: ${sandboxCommands.join(', ')}`)
    for (const command of sandboxCommands) {
      const name = command.split(' ')[0]
      expect(output(command)[0]?.text ?? '', command).not.toBe(`${name}: command not found`)
    }
  })

  it('answers a real command it cannot run with what it knows about it', () => {
    const lines = output('sudo rm -rf /')
    expect(lines[0]).toEqual({ text: 'sudo: not available in this browser sandbox', kind: 'warning' })
    expect(lines[1].text).toContain('Run a command as another user')
    expect(lines[3].text).toContain('man sudo')
  })

  it('rejects a word nothing knows, and offers the nearest match', () => {
    const lines = output('gti status')
    expect(lines[0]).toEqual({ text: 'gti: command not found', kind: 'error' })
    expect(lines[1].text).toContain('git')
  })
})

describe('the dictionary at the prompt', () => {
  it('prints a manual page', () => {
    const text = output('man tar').map((line) => line.text).join('\n')
    expect(text).toContain('NAME')
    expect(text).toContain('tar — Create and extract tar archives')
    expect(text).toContain('-z')
    expect(text).toContain('SEE ALSO')
  })

  it('accepts a section argument the way man does', () => {
    expect(output('man 1 grep')[1].text).toContain('grep — Print lines matching a pattern')
  })

  it('colours the headings and the warning', () => {
    const lines = output('man rm')
    expect(lines.find((line) => line.text === 'NAME')?.kind).toBe('command')
    expect(lines.some((line) => line.kind === 'warning' && line.text.includes('no undo'))).toBe(true)
  })

  it('says there is no page, and guesses', () => {
    const lines = output('man gerp')
    expect(lines[0]).toEqual({ text: 'No manual entry for gerp', kind: 'error' })
    expect(lines[1].text).toContain('grep')
  })

  it('searches summaries with apropos', () => {
    const text = output('apropos compress').map((line) => line.text).join('\n')
    expect(text).toContain('gzip')
    expect(text).toContain('zstd')
  })

  it('caps a broad apropos and says so', () => {
    const lines = output('apropos file')
    expect(lines.length).toBe(APROPOS_LIMIT + 1)
    expect(lines[lines.length - 1].text).toContain('narrow the search')
  })

  it('gives the one-line description with whatis', () => {
    expect(output('whatis jq')[0].text).toBe('jq (text) — Query and transform JSON')
  })

  it('reads a whole command line back in English', () => {
    const text = output('explain tar czf site.tgz --exclude node_modules site/').map((line) => line.text).join('\n')
    expect(text).toContain('tar — Create and extract tar archives')
    expect(text).toContain('-c — Create an archive')
    expect(text).toContain('--exclude — Leave matching paths out')
    expect(text).toContain('acting on site.tgz, node_modules, site/')
  })

  it('warns, in the explanation, about a line that destroys data', () => {
    const lines = output('explain sudo rm -rf /var/cache')
    expect(lines.some((line) => line.kind === 'warning' && line.text.includes('no undo'))).toBe(true)
    expect(lines.some((line) => line.text.includes('full privileges'))).toBe(true)
  })

  it('explains a pipeline stage by stage', () => {
    const text = output('explain ps aux | grep -i node | wc -l').map((line) => line.text).join('\n')
    expect(text).toContain('ps — Report a snapshot of the current processes')
    expect(text).toContain('pipes that output into')
    expect(text).toContain('wc — Count lines, words and bytes')
  })

  it('describes the dictionary in the bare help output', () => {
    const lines = output('help')
    expect(lines[0].text).toContain('man, apropos, whatis, explain')
    expect(lines[1].text).toMatch(/documents \d{3} commands/)
  })

  it('answers help for a single command', () => {
    const lines = output('help cd')
    expect(lines[0].text).toBe('cd — Change the working directory')
    expect(lines[1].text).toContain('cd [-L|-P] [DIR]')
  })

  it('reads the workspace dictionary when one is passed in', () => {
    const dictionary = createDictionary([
      { name: 'deploy', group: 'Development', summary: 'Ship the current branch', synopsis: 'deploy [SERVICE]' },
    ])
    expect(output('whatis deploy', { dictionary })[0].text).toContain('Ship the current branch')
  })
})
