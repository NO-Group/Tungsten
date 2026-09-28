/**
 * The dictionary is data, so most of these tests are about the data being
 * trustworthy: unique names, real cross-references, a synopsis that starts
 * with the command it documents. The rest exercise search, suggestions, the
 * manual renderer, the workspace loader and the explainer.
 */

import { describe, expect, it } from 'vitest'

import { commandGroups } from './commandModel'
import {
  builtinDictionary, createDictionary, editDistance, manPage, shellDictionary, wrap,
} from './commandDictionary'
import { explainCommandLine, tokenize } from './explainShell'
import { EXAMPLE_COMMAND_FILE, loadWorkspaceCommands } from './workspaceCommands'

describe('the dictionary data', () => {
  it('documents several hundred commands', () => {
    expect(builtinDictionary.length).toBeGreaterThan(500)
  })

  it('never lists the same command twice', () => {
    const seen = new Map<string, number>()
    for (const entry of builtinDictionary) seen.set(entry.name, (seen.get(entry.name) || 0) + 1)
    expect([...seen].filter(([, count]) => count > 1)).toEqual([])
  })

  it('gives every entry a group the model knows about', () => {
    const unknown = builtinDictionary.filter((entry) => !commandGroups.includes(entry.group))
    expect(unknown).toEqual([])
  })

  it('writes every summary as one line without a trailing period', () => {
    const bad = builtinDictionary.filter((entry) => entry.summary.includes('\n') || entry.summary.endsWith('.'))
    expect(bad.map((entry) => entry.name)).toEqual([])
  })

  it('writes a synopsis that actually invokes the command', () => {
    // Some tools are invoked through another word -- `python3 -m venv`,
    // `docker compose` -- so an alias counts, but nothing else does.
    const bad = builtinDictionary.filter((entry) => {
      const words = [entry.name, ...(entry.aliases || [])]
      return !words.some((word) => entry.synopsis.includes(word))
    })
    expect(bad.map((entry) => `${entry.name}: ${entry.synopsis}`)).toEqual([])
  })

  it('never points an entry at itself', () => {
    const selves = builtinDictionary.filter((entry) => entry.seeAlso?.includes(entry.name))
    expect(selves.map((entry) => entry.name)).toEqual([])
  })

  it('reaches an aliased entry by either name', () => {
    expect(shellDictionary.lookup('imagemagick')).toBe(shellDictionary.lookup('magick'))
    expect(shellDictionary.lookup('httpie')?.name).toBe('http')
    // An alias is a way in, not a second entry in the list.
    expect(shellDictionary.entries.filter((entry) => entry.name === 'miller')).toEqual([])
    expect(shellDictionary.search('miller').map((entry) => entry.name)).toContain('mlr')
  })

  it('only cross-references commands that exist', () => {
    const dangling: string[] = []
    for (const entry of builtinDictionary) {
      for (const other of entry.seeAlso || []) {
        if (!shellDictionary.lookup(other)) dangling.push(`${entry.name} -> ${other}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('covers every group with real entries', () => {
    const counts = shellDictionary.counts()
    expect(counts.length).toBe(commandGroups.length)
    for (const row of counts) expect(row.count).toBeGreaterThan(3)
  })

  it('warns about the commands that destroy things', () => {
    for (const name of ['rm', 'dd', 'shred', 'mkfs', 'git']) {
      expect(shellDictionary.lookup(name)?.danger).toBeTruthy()
    }
  })

  it('knows the shell builtins are builtins', () => {
    expect(shellDictionary.lookup('cd')?.builtin).toBe(true)
    expect(shellDictionary.lookup('export')?.builtin).toBe(true)
    expect(shellDictionary.lookup('ls')?.builtin).toBeUndefined()
  })
})

describe('lookup and search', () => {
  it('finds a command by its exact name', () => {
    expect(shellDictionary.lookup('grep')?.summary).toBe('Print lines matching a pattern')
  })

  it('puts the exact name first, ahead of every mention of it', () => {
    const [first] = shellDictionary.search('tar')
    expect(first.name).toBe('tar')
  })

  it('ranks a prefix above a description match', () => {
    const names = shellDictionary.search('ssh').map((entry) => entry.name)
    expect(names[0]).toBe('ssh')
    expect(names.indexOf('ssh-keygen')).toBeLessThan(names.indexOf('mosh'))
  })

  it('searches summaries, so a concept finds the tool', () => {
    expect(shellDictionary.search('compress').map((entry) => entry.name)).toContain('gzip')
    expect(shellDictionary.search('checksum').map((entry) => entry.name)).toContain('sha256sum')
  })

  it('prefers the fully documented command on an equal word match', () => {
    // Both summaries say "archive"; tar is the one with a flag table.
    const names = shellDictionary.search('archive').map((entry) => entry.name)
    expect(names[0]).toBe('tar')
    expect(names).toContain('7z')
  })

  it('searches flag tables', () => {
    expect(shellDictionary.search('pipefail').map((entry) => entry.name)).toContain('set')
  })

  it('narrows rather than widens with a second word', () => {
    const one = shellDictionary.search('list')
    const two = shellDictionary.search('list directory')
    expect(two.length).toBeLessThan(one.length)
    expect(two.map((entry) => entry.name)).toContain('ls')
  })

  it('filters to a single group', () => {
    const hits = shellDictionary.search('', { group: 'Containers' })
    expect(hits.length).toBeGreaterThan(5)
    expect(hits.every((entry) => entry.group === 'Containers')).toBe(true)
  })

  it('returns everything when the query is blank', () => {
    expect(shellDictionary.search('').length).toBeGreaterThan(100)
  })

  it('suggests a near miss', () => {
    expect(shellDictionary.suggest('gerp')).toContain('grep')
    expect(shellDictionary.suggest('dokcer')).toContain('docker')
    expect(shellDictionary.suggest('systemctk')).toContain('systemctl')
  })

  it('suggests nothing for something unrecognisable', () => {
    expect(shellDictionary.suggest('qqqqzzzz')).toEqual([])
  })

  it('counts a transposition as one mistake, not two', () => {
    expect(editDistance('grep', 'grep')).toBe(0)
    expect(editDistance('gerp', 'grep')).toBe(1)
    expect(editDistance('gti', 'git')).toBe(1)
    expect(editDistance('sl', 'ls')).toBe(1)
    expect(editDistance('cat', 'dog')).toBe(3)
    expect(editDistance('', 'ls')).toBe(2)
  })

  it('suggests the command behind a swapped-letter typo', () => {
    expect(shellDictionary.suggest('gti')).toContain('git')
    expect(shellDictionary.suggest('sl')).toContain('ls')
  })
})

describe('manual pages', () => {
  it('renders the standard sections', () => {
    const text = manPage(shellDictionary.lookup('ls')!).map((line) => line.text).join('\n')
    expect(text).toContain('NAME')
    expect(text).toContain('ls — List directory contents')
    expect(text).toContain('SYNOPSIS')
    expect(text).toContain('OPTIONS')
    expect(text).toContain('EXAMPLES')
    expect(text).toContain('SEE ALSO')
  })

  it('renders a warning section for a dangerous command', () => {
    const lines = manPage(shellDictionary.lookup('rm')!)
    expect(lines.some((line) => line.tone === 'warning')).toBe(true)
  })

  it('leaves out sections an entry does not have', () => {
    const text = manPage(shellDictionary.lookup('tac')!).map((line) => line.text).join('\n')
    expect(text).not.toContain('EXAMPLES')
    expect(text).toContain('SYNOPSIS')
  })

  it('says where a command comes from', () => {
    const text = manPage(shellDictionary.lookup('cd')!).map((line) => line.text).join('\n')
    expect(text).toContain('shell builtin')
  })

  it('wraps long text at a width', () => {
    const lines = wrap('one two three four five six seven', 10)
    expect(lines.every((line) => line.length <= 10)).toBe(true)
    expect(lines.join(' ')).toBe('one two three four five six seven')
  })
})

describe('workspace contributions', () => {
  it('reads commands out of dictionary/*.commands.json', () => {
    const { entries, problems } = loadWorkspaceCommands([EXAMPLE_COMMAND_FILE])
    expect(problems).toEqual([])
    expect(entries.map((entry) => entry.name)).toEqual(['deploy'])
    expect(entries[0].source).toBe('team.commands.json')
    expect(entries[0].options?.[0].flag).toBe('--prod')
  })

  it('ignores files elsewhere in the workspace', () => {
    const { entries } = loadWorkspaceCommands([{ path: 'src/team.commands.json', content: '[]' }])
    expect(entries).toEqual([])
  })

  it('reports bad JSON instead of throwing', () => {
    const { problems } = loadWorkspaceCommands([{ path: 'dictionary/a.commands.json', content: '{oops' }])
    expect(problems).toEqual(['a.commands.json: not valid JSON'])
  })

  it('names the field an entry is missing', () => {
    const { entries, problems } = loadWorkspaceCommands([{
      path: 'dictionary/a.commands.json',
      content: JSON.stringify({ commands: [{ name: 'x', group: 'Nope', summary: 's', synopsis: 'x' }] }),
    }])
    expect(entries).toEqual([])
    expect(problems[0]).toContain('unknown group')
  })

  it('merges into the dictionary and can be searched', () => {
    const { entries } = loadWorkspaceCommands([EXAMPLE_COMMAND_FILE])
    const dictionary = createDictionary(entries)
    expect(dictionary.lookup('deploy')?.summary).toBe('Ship the current branch to staging')
    expect(dictionary.search('staging').map((entry) => entry.name)).toContain('deploy')
    expect(dictionary.entries.length).toBe(builtinDictionary.length + 1)
  })

  it('lets the workspace override a built-in entry', () => {
    const dictionary = createDictionary([
      { name: 'ls', group: 'Files', summary: 'Our wrapper around ls', synopsis: 'ls [FILE]...', source: 'team.commands.json' },
    ])
    expect(dictionary.lookup('ls')?.summary).toBe('Our wrapper around ls')
    expect(dictionary.entries.length).toBe(builtinDictionary.length)
  })
})

describe('tokenizing a command line', () => {
  it('splits words and operators', () => {
    expect(tokenize('ls -la | grep foo').map((token) => token.value))
      .toEqual(['ls', '-la', '|', 'grep', 'foo'])
  })

  it('keeps a quoted string whole, pipes and all', () => {
    const tokens = tokenize('echo "a | b"')
    expect(tokens.map((token) => token.value)).toEqual(['echo', 'a | b'])
    expect(tokens[1].quoted).toBe(true)
  })

  it('reads the long redirection operators before the short ones', () => {
    expect(tokenize('cmd 2>> log').map((token) => token.value)).toEqual(['cmd', '2>>', 'log'])
    expect(tokenize('cmd >> log').map((token) => token.value)).toEqual(['cmd', '>>', 'log'])
  })

  it('honours a backslash escape', () => {
    expect(tokenize('touch a\\ file').map((token) => token.value)).toEqual(['touch', 'a file'])
  })
})

describe('explaining a command line', () => {
  it('explains a command and its flags in order', () => {
    const { sentences } = explainCommandLine('ls -la /tmp')
    expect(sentences[0]).toBe('ls — List directory contents')
    expect(sentences[1]).toContain('-l — Long format')
    expect(sentences[2]).toContain('-a')
    expect(sentences[3]).toBe('    acting on /tmp')
  })

  it('reads a dashless flag cluster, but not a filename', () => {
    const tar = explainCommandLine('tar czf site.tgz site/')
    expect(tar.segments[0].flags.map((flag) => flag.flag)).toEqual(['-c', '-z', '-f'])
    expect(tar.segments[0].operands).toEqual(['site.tgz', 'site/'])

    // `notes` is not a flag cluster just because -n and -s exist.
    const cat = explainCommandLine('cat notes')
    expect(cat.segments[0].flags).toEqual([])
    expect(cat.segments[0].operands).toEqual(['notes'])
  })

  it('splits a bundled short flag only when every letter is documented', () => {
    const ls = explainCommandLine('ls -la')
    expect(ls.segments[0].flags.map((flag) => flag.flag)).toEqual(['-l', '-a'])
    const pacman = explainCommandLine('pacman -Syu')
    expect(pacman.segments[0].flags.map((flag) => flag.flag)).toEqual(['-Syu'])
  })

  it('marks a flag the dictionary does not know', () => {
    const { segments } = explainCommandLine('ls -Z')
    expect(segments[0].flags[0]).toEqual({ flag: '-Z', summary: 'not a documented flag of ls', known: false })
  })

  it('explains a subcommand documented in the flag table', () => {
    const { sentences } = explainCommandLine('git status')
    expect(sentences[1]).toContain('status — What has changed')
  })

  it('walks a pipeline stage by stage', () => {
    const { segments, sentences } = explainCommandLine('ps aux | grep -i node | wc -l')
    expect(segments.map((segment) => segment.name)).toEqual(['ps', 'grep', 'wc'])
    expect(segments[1].connector).toBe('|')
    expect(sentences.join('\n')).toContain('pipes that output into')
  })

  it('reads the conditional connectors', () => {
    const { segments } = explainCommandLine('npm ci && npm run build || echo failed')
    expect(segments.map((segment) => segment.connector)).toEqual([undefined, '&&', '||'])
  })

  it('explains redirections and backgrounding', () => {
    const { redirects, background } = explainCommandLine('node server.js > out.log 2>&1 &')
    expect(redirects[0]).toEqual({ operator: '>', target: 'out.log', summary: 'writes standard output to out.log' })
    expect(redirects[1].summary).toContain('same place as standard output')
    expect(background).toBe(true)
  })

  it('notices sudo and hoists the privilege warning', () => {
    const { segments, warnings } = explainCommandLine('sudo rm -rf /var/tmp/cache')
    expect(segments[0].sudo).toBe(true)
    expect(segments[0].name).toBe('rm')
    expect(warnings.some((warning) => warning.includes('no undo'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('full privileges'))).toBe(true)
  })

  it('steps over a leading environment assignment', () => {
    const { segments } = explainCommandLine('NODE_ENV=production node build.js')
    expect(segments[0].name).toBe('node')
    expect(segments[0].operands).toEqual(['build.js'])
  })

  it('reports an unknown command rather than guessing', () => {
    const { unknown, ok, sentences } = explainCommandLine('frobnicate --hard')
    expect(unknown).toEqual(['frobnicate'])
    expect(ok).toBe(false)
    expect(sentences[0]).toContain('not in the dictionary')
  })

  it('understands operand-style options such as dd’s', () => {
    const { segments } = explainCommandLine('dd if=disk.img of=/dev/sdb bs=4M')
    const flags = segments[0].flags.map((flag) => flag.flag)
    expect(flags).toEqual(['if=disk.img', 'of=/dev/sdb', 'bs=4M'])
    expect(segments[0].flags[1].summary).toContain('Write to this file or device')
  })

  it('explains a real pipeline end to end', () => {
    const { sentences, warnings } = explainCommandLine('find . -name "*.log" -print0 | xargs -0 rm -f')
    const text = sentences.join('\n')
    expect(text).toContain('find — Search a directory tree')
    expect(text).toContain('-name — Match the filename by glob')
    expect(text).toContain('xargs — Build and run command lines from standard input')
    expect(text).toContain('-0 — Input is null-separated')
    expect(warnings.some((warning) => warning.startsWith('rm:'))).toBe(true)
  })

  it('explains nothing gracefully', () => {
    const explanation = explainCommandLine('   ')
    expect(explanation.ok).toBe(false)
    expect(explanation.sentences).toEqual([])
  })

  it('does not treat a pipe inside quotes as a pipeline', () => {
    const { segments } = explainCommandLine('echo "one | two"')
    expect(segments).toHaveLength(1)
    expect(segments[0].operands).toEqual(['one | two'])
  })
})
