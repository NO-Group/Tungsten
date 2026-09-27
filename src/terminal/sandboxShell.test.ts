import { describe, expect, it } from 'vitest'

import { runSandboxCommand, sandboxCommands, type ShellContext } from './sandboxShell'

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

  it('rejects anything else by name, not by the whole line', () => {
    expect(output('sudo rm -rf /')[0]).toEqual({ text: 'sudo: command not found', kind: 'error' })
  })
})
