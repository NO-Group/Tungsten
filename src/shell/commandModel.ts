/**
 * The shape of one entry in the shell dictionary.
 *
 * A dictionary is only as good as the questions it can answer. The three that
 * matter at a terminal are "what is this?", "what does that flag do?" and
 * "show me a real invocation" -- so every entry carries a one-line summary, a
 * synopsis in the shape manuals use, and, for anything commonly typed, a flag
 * table and worked examples.
 *
 * Entries are data, not code: nothing here is evaluated, so the dictionary can
 * also be extended from the workspace (see `workspaceCommands.ts`) without
 * handing a JSON file the ability to run anything.
 */

/** The shelves the dictionary is organised into. */
export const commandGroups = [
  'Builtins',
  'Files',
  'Text',
  'Search',
  'Processes',
  'System',
  'Network',
  'Archives',
  'Permissions',
  'Development',
  'Packages',
  'Containers',
] as const

export type CommandGroup = (typeof commandGroups)[number]

/** A single documented flag. `flag` may list aliases: `-a, --all`. */
export type CommandOption = { flag: string; summary: string }

/** A worked invocation. `command` is meant to be runnable as written. */
export type CommandExample = { command: string; summary: string }

export type CommandEntry = {
  /** The word typed at the prompt. Unique across the dictionary. */
  name: string
  /**
   * Other words that reach this entry: the friendly name of a tool whose
   * binary is spelled differently (`imagemagick` for `magick`), or a second
   * spelling of the same command.
   */
  aliases?: string[]
  group: CommandGroup
  /** One line, sentence case, no trailing period -- it renders in lists. */
  summary: string
  /** Usage form, in manual notation: `ls [OPTION]... [FILE]...`. */
  synopsis: string
  /** A paragraph for when the summary is not enough. */
  description?: string
  options?: CommandOption[]
  examples?: CommandExample[]
  /** Related commands, by name. Validated against the dictionary by tests. */
  seeAlso?: string[]
  /** True for shell builtins and keywords, which have no binary on PATH. */
  builtin?: boolean
  /** Set when the command can destroy data, and rendered as a warning. */
  danger?: string
  /** Where it comes from: coreutils, git, a distribution package. */
  from?: string
  /** Set on entries contributed by the workspace rather than built in. */
  source?: string
}

/**
 * Builds an entry.
 *
 * Positional for the four fields every command has and an object for the rest,
 * which keeps the long tail of the dictionary to one readable line each while
 * still letting the common commands carry full flag tables.
 */
export function cmd(
  name: string,
  group: CommandGroup,
  summary: string,
  synopsis: string,
  extra: Omit<CommandEntry, 'name' | 'group' | 'summary' | 'synopsis'> = {},
): CommandEntry {
  return { name, group, summary, synopsis, ...extra }
}
