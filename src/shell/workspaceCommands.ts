/**
 * Commands contributed by the workspace.
 *
 * "Every bash command in the world" has a long tail that no shipped list can
 * close: the deploy script your team wrote, the internal CLI, the wrapper that
 * only exists on this machine. A project can document those by dropping JSON
 * into `dictionary/`, and they appear beside the built-ins.
 *
 * The same rule as the builder's plugins applies -- the file is read as data
 * and nothing in it is ever evaluated.
 */

import { commandGroups, type CommandEntry, type CommandGroup } from './commandModel'

/** Where a workspace keeps its own command documentation. */
export const DICTIONARY_DIRECTORY = 'dictionary'
const FILE_PATTERN = /^dictionary\/[^/]+\.commands\.json$/

export type WorkspaceCommandFile = { path: string; content: string }

export type WorkspaceCommandLoad = {
  entries: CommandEntry[]
  /** One readable line per file that could not be used, for the sidebar. */
  problems: string[]
}

/** An example file, written by the "Document a command" action. */
export const EXAMPLE_COMMAND_FILE = {
  path: 'dictionary/team.commands.json',
  content: `${JSON.stringify(
    {
      commands: [
        {
          name: 'deploy',
          group: 'Development',
          summary: 'Ship the current branch to staging',
          synopsis: 'deploy [--prod] [SERVICE]',
          description: 'A thin wrapper around the release pipeline. Without --prod it stops at staging.',
          options: [
            { flag: '--prod', summary: 'Promote to production after staging goes green' },
            { flag: '--dry-run', summary: 'Print the plan and change nothing' },
          ],
          examples: [{ command: 'deploy --dry-run api', summary: 'Rehearse an API deploy' }],
          seeAlso: ['git', 'kubectl'],
          danger: 'Without --dry-run this changes production traffic.',
        },
      ],
    },
    null,
    2,
  )}\n`,
}

function isGroup(value: unknown): value is CommandGroup {
  return typeof value === 'string' && (commandGroups as readonly string[]).includes(value)
}

/** Reads one entry, returning the reason it was rejected instead of throwing. */
function entryFrom(raw: unknown, source: string): { entry?: CommandEntry; problem?: string } {
  if (!raw || typeof raw !== 'object') return { problem: `${source}: an entry is not an object` }
  const record = raw as Record<string, unknown>
  const { name, group, summary, synopsis } = record

  if (typeof name !== 'string' || !name.trim()) return { problem: `${source}: an entry has no name` }
  if (!isGroup(group)) return { problem: `${source}: ${name} has an unknown group "${String(group)}"` }
  if (typeof summary !== 'string' || !summary.trim()) return { problem: `${source}: ${name} has no summary` }
  if (typeof synopsis !== 'string' || !synopsis.trim()) return { problem: `${source}: ${name} has no synopsis` }

  const list = <T>(value: unknown, read: (item: Record<string, unknown>) => T | undefined): T[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const items = value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(read)
      .filter((item): item is T => item !== undefined)
    return items.length ? items : undefined
  }

  return {
    entry: {
      name: name.trim(),
      group,
      summary: summary.trim(),
      synopsis: synopsis.trim(),
      description: typeof record.description === 'string' ? record.description : undefined,
      danger: typeof record.danger === 'string' ? record.danger : undefined,
      from: typeof record.from === 'string' ? record.from : undefined,
      options: list(record.options, (item) =>
        typeof item.flag === 'string' && typeof item.summary === 'string'
          ? { flag: item.flag, summary: item.summary }
          : undefined),
      examples: list(record.examples, (item) =>
        typeof item.command === 'string' && typeof item.summary === 'string'
          ? { command: item.command, summary: item.summary }
          : undefined),
      seeAlso: Array.isArray(record.seeAlso)
        ? record.seeAlso.filter((item): item is string => typeof item === 'string')
        : undefined,
      source,
    },
  }
}

/** Reads every `dictionary/*.commands.json` in the workspace. */
export function loadWorkspaceCommands(files: WorkspaceCommandFile[]): WorkspaceCommandLoad {
  const entries: CommandEntry[] = []
  const problems: string[] = []

  for (const file of files.filter((candidate) => FILE_PATTERN.test(candidate.path))) {
    const source = file.path.split('/').pop() || file.path
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      problems.push(`${source}: not valid JSON`)
      continue
    }

    const raw = parsed && typeof parsed === 'object' && 'commands' in (parsed as object)
      ? (parsed as { commands: unknown }).commands
      : parsed
    if (!Array.isArray(raw)) {
      problems.push(`${source}: expected a "commands" array`)
      continue
    }

    for (const item of raw) {
      const { entry, problem } = entryFrom(item, source)
      if (entry) entries.push(entry)
      if (problem) problems.push(problem)
    }
  }

  return { entries, problems }
}
