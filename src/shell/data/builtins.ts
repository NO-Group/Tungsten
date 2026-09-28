/**
 * Shell builtins, keywords and job control.
 *
 * These have no binary on PATH -- the shell itself answers them -- which is
 * exactly why they are the ones people cannot find a man page for.
 */

import { cmd, type CommandEntry } from '../commandModel'

export const builtinCommands: CommandEntry[] = [
  cmd('cd', 'Builtins', 'Change the working directory', 'cd [-L|-P] [DIR]', {
    builtin: true,
    description:
      'With no argument, changes to $HOME. `cd -` returns to the previous directory and prints it.',
    options: [
      { flag: '-P', summary: 'Resolve symlinks, so you land on the physical path' },
      { flag: '-L', summary: 'Keep symlinks in the path (the default)' },
    ],
    examples: [
      { command: 'cd ..', summary: 'Go up one directory' },
      { command: 'cd -', summary: 'Go back to where you just were' },
    ],
    seeAlso: ['pwd', 'pushd', 'popd', 'dirs'],
  }),
  cmd('pwd', 'Builtins', 'Print the working directory', 'pwd [-L|-P]', {
    builtin: true,
    options: [{ flag: '-P', summary: 'Print the physical path, with symlinks resolved' }],
    seeAlso: ['cd', 'realpath'],
  }),
  cmd('echo', 'Builtins', 'Write arguments to standard output', 'echo [-neE] [STRING]...', {
    builtin: true,
    options: [
      { flag: '-n', summary: 'Do not add a trailing newline' },
      { flag: '-e', summary: 'Interpret backslash escapes such as \\n and \\t' },
      { flag: '-E', summary: 'Do not interpret escapes (the default)' },
    ],
    examples: [{ command: 'echo -e "one\\ttwo"', summary: 'Print two tab-separated words' }],
    seeAlso: ['printf', 'cat'],
  }),
  cmd('printf', 'Builtins', 'Format and print data', 'printf FORMAT [ARGUMENT]...', {
    builtin: true,
    description:
      'Portable where `echo` is not: the format string controls escapes and padding, and is reused until the arguments run out.',
    examples: [{ command: 'printf "%-10s %5.2f\\n" total 3.14159', summary: 'Pad a column and round a number' }],
    seeAlso: ['echo', 'seq'],
  }),
  cmd('export', 'Builtins', 'Mark a variable for the environment of child processes', 'export [NAME[=VALUE]]...', {
    builtin: true,
    examples: [{ command: 'export NODE_ENV=production', summary: 'Set a variable every child process will see' }],
    seeAlso: ['env', 'set', 'unset', 'declare'],
  }),
  cmd('source', 'Builtins', 'Read and execute a file in the current shell', 'source FILE [ARGUMENTS]', {
    builtin: true,
    description:
      'Unlike running a script, sourcing keeps the changes: variables it sets and directories it enters survive, because no subshell is involved.',
    seeAlso: ['.', 'exec', 'bash'],
  }),
  cmd('.', 'Builtins', 'Read and execute a file in the current shell (POSIX spelling of source)', '. FILE [ARGUMENTS]', {
    builtin: true,
    seeAlso: ['source'],
  }),
  cmd('alias', 'Builtins', 'Define or list command shorthands', 'alias [NAME[=VALUE]]...', {
    builtin: true,
    examples: [{ command: "alias ll='ls -lah'", summary: 'Create a shorthand for a long listing' }],
    seeAlso: ['unalias', 'type', 'function'],
  }),
  cmd('unalias', 'Builtins', 'Remove an alias', 'unalias [-a] NAME...', {
    builtin: true,
    options: [{ flag: '-a', summary: 'Remove every alias' }],
    seeAlso: ['alias'],
  }),
  cmd('set', 'Builtins', 'Set shell options and positional parameters', 'set [-abefhkmnptuvxBCEHPT] [-o OPTION] [ARG]...', {
    builtin: true,
    description:
      '`set -euo pipefail` is the standard safety header for a bash script: exit on error, treat unset variables as errors, and fail a pipeline if any stage fails.',
    options: [
      { flag: '-e', summary: 'Exit as soon as a command fails' },
      { flag: '-u', summary: 'Treat an unset variable as an error' },
      { flag: '-x', summary: 'Print each command before running it' },
      { flag: '-o pipefail', summary: 'A pipeline fails if any stage fails, not just the last' },
    ],
    seeAlso: ['shopt', 'export', 'unset'],
  }),
  cmd('unset', 'Builtins', 'Remove a variable or function', 'unset [-fv] NAME...', {
    builtin: true,
    options: [
      { flag: '-v', summary: 'Remove a variable' },
      { flag: '-f', summary: 'Remove a function' },
    ],
    seeAlso: ['set', 'export'],
  }),
  cmd('read', 'Builtins', 'Read a line into variables', 'read [-ers] [-p PROMPT] [-a ARRAY] [-d DELIM] [-n COUNT] [-t TIMEOUT] [NAME]...', {
    builtin: true,
    options: [
      { flag: '-p PROMPT', summary: 'Print a prompt before reading' },
      { flag: '-r', summary: 'Do not treat backslash as an escape -- almost always what you want' },
      { flag: '-s', summary: 'Do not echo the input, for passwords' },
      { flag: '-t TIMEOUT', summary: 'Give up after this many seconds' },
      { flag: '-a ARRAY', summary: 'Split the line into an array' },
    ],
    examples: [{ command: 'while IFS= read -r line; do echo "$line"; done < file', summary: 'Read a file line by line, safely' }],
    seeAlso: ['mapfile', 'echo'],
  }),
  cmd('test', 'Builtins', 'Evaluate a conditional expression', 'test EXPRESSION', {
    builtin: true,
    options: [
      { flag: '-f FILE', summary: 'True if the file exists and is a regular file' },
      { flag: '-d FILE', summary: 'True if the file exists and is a directory' },
      { flag: '-e FILE', summary: 'True if the path exists at all' },
      { flag: '-z STRING', summary: 'True if the string is empty' },
      { flag: '-n STRING', summary: 'True if the string is not empty' },
    ],
    seeAlso: ['[', '[[', 'if'],
  }),
  cmd('[', 'Builtins', 'Evaluate a conditional expression (the bracket spelling of test)', '[ EXPRESSION ]', {
    builtin: true,
    seeAlso: ['test', '[['],
  }),
  cmd('[[', 'Builtins', 'Bash conditional expression with pattern and regex matching', '[[ EXPRESSION ]]', {
    builtin: true,
    description:
      'Safer than `[`: no word splitting inside, `==` does glob matching and `=~` does regex matching.',
    examples: [{ command: '[[ $file == *.ts ]] && echo typescript', summary: 'Glob-match a variable without quoting worries' }],
    seeAlso: ['test', '['],
  }),
  cmd('if', 'Builtins', 'Run commands conditionally', 'if LIST; then LIST; [elif LIST; then LIST;]... [else LIST;] fi', { builtin: true, seeAlso: ['test', 'case'] }),
  cmd('case', 'Builtins', 'Branch on a pattern match', 'case WORD in [PATTERN) LIST;;]... esac', { builtin: true, seeAlso: ['if'] }),
  cmd('for', 'Builtins', 'Loop over words or a C-style counter', 'for NAME [in WORDS]; do LIST; done', {
    builtin: true,
    examples: [{ command: 'for f in *.log; do gzip "$f"; done', summary: 'Compress every log file in turn' }],
    seeAlso: ['while', 'until', 'select'],
  }),
  cmd('while', 'Builtins', 'Loop while a condition succeeds', 'while LIST; do LIST; done', { builtin: true, seeAlso: ['for', 'until'] }),
  cmd('until', 'Builtins', 'Loop until a condition succeeds', 'until LIST; do LIST; done', { builtin: true, seeAlso: ['while'] }),
  cmd('select', 'Builtins', 'Print a numbered menu and read a choice', 'select NAME [in WORDS]; do LIST; done', { builtin: true, seeAlso: ['read', 'for'] }),
  cmd('function', 'Builtins', 'Define a shell function', 'function NAME { COMMANDS; }', { builtin: true, seeAlso: ['return', 'local'] }),
  cmd('return', 'Builtins', 'Return from a function with a status', 'return [N]', { builtin: true, seeAlso: ['exit', 'function'] }),
  cmd('local', 'Builtins', 'Declare a variable scoped to the current function', 'local [OPTION] NAME[=VALUE]...', { builtin: true, seeAlso: ['declare', 'function'] }),
  cmd('declare', 'Builtins', 'Declare variables and give them attributes', 'declare [-aAfFgilnrtux] [NAME[=VALUE]]...', {
    builtin: true,
    options: [
      { flag: '-a', summary: 'Indexed array' },
      { flag: '-A', summary: 'Associative array' },
      { flag: '-i', summary: 'Integer -- arithmetic on assignment' },
      { flag: '-r', summary: 'Read-only' },
      { flag: '-x', summary: 'Export to the environment' },
    ],
    seeAlso: ['local', 'export', 'typeset', 'readonly'],
  }),
  cmd('typeset', 'Builtins', 'Declare variables (ksh spelling of declare)', 'typeset [OPTION] [NAME[=VALUE]]...', { builtin: true, seeAlso: ['declare'] }),
  cmd('readonly', 'Builtins', 'Mark a variable as unchangeable', 'readonly [-aAf] [NAME[=VALUE]]...', { builtin: true, seeAlso: ['declare'] }),
  cmd('shift', 'Builtins', 'Drop positional parameters from the front', 'shift [N]', { builtin: true, seeAlso: ['set', 'getopts'] }),
  cmd('getopts', 'Builtins', 'Parse short options in a script', 'getopts OPTSTRING NAME [ARG]...', {
    builtin: true,
    examples: [{ command: 'while getopts ":hv:" opt; do case $opt in h) usage;; v) level=$OPTARG;; esac; done', summary: 'The standard option loop' }],
    seeAlso: ['getopt', 'shift'],
  }),
  cmd('eval', 'Builtins', 'Build a command from arguments and run it', 'eval [ARG]...', {
    builtin: true,
    danger: 'Runs whatever it is handed -- never eval unsanitised input.',
    seeAlso: ['exec', 'source'],
  }),
  cmd('exec', 'Builtins', 'Replace the shell with a command, or redirect the shell itself', 'exec [-cl] [-a NAME] [COMMAND [ARGUMENTS]]', {
    builtin: true,
    examples: [{ command: 'exec 2> errors.log', summary: 'Send every later error from this shell to a file' }],
    seeAlso: ['eval', 'source'],
  }),
  cmd('exit', 'Builtins', 'Leave the shell with a status', 'exit [N]', { builtin: true, seeAlso: ['return', 'logout'] }),
  cmd('logout', 'Builtins', 'Leave a login shell', 'logout [N]', { builtin: true, seeAlso: ['exit'] }),
  cmd('trap', 'Builtins', 'Run a command when the shell receives a signal', 'trap [-lp] [ARG] [SIGSPEC]...', {
    builtin: true,
    examples: [{ command: "trap 'rm -f \"$tmp\"' EXIT", summary: 'Clean up a temporary file however the script ends' }],
    seeAlso: ['kill', 'exit'],
  }),
  cmd('wait', 'Builtins', 'Wait for background jobs to finish', 'wait [-fn] [-p VAR] [ID]...', {
    builtin: true,
    options: [{ flag: '-n', summary: 'Wait for the next job to finish, not all of them' }],
    seeAlso: ['jobs', 'bg', 'fg'],
  }),
  cmd('jobs', 'Builtins', 'List the shell’s background jobs', 'jobs [-lnprs] [JOBSPEC]...', { builtin: true, seeAlso: ['bg', 'fg', 'wait', 'disown'] }),
  cmd('bg', 'Builtins', 'Resume a stopped job in the background', 'bg [JOBSPEC]...', { builtin: true, seeAlso: ['fg', 'jobs'] }),
  cmd('fg', 'Builtins', 'Bring a job to the foreground', 'fg [JOBSPEC]', { builtin: true, seeAlso: ['bg', 'jobs'] }),
  cmd('disown', 'Builtins', 'Detach a job from the shell so it survives logout', 'disown [-ar] [-h] [JOBSPEC]...', { builtin: true, seeAlso: ['nohup', 'jobs'] }),
  cmd('kill', 'Builtins', 'Send a signal to a process or job', 'kill [-s SIGNAL | -SIGNAL] PID | %JOBSPEC...', {
    builtin: true,
    options: [
      { flag: '-9', summary: 'SIGKILL -- unconditional, no cleanup' },
      { flag: '-15', summary: 'SIGTERM -- ask politely (the default)' },
      { flag: '-l', summary: 'List the signal names' },
    ],
    seeAlso: ['killall', 'pkill', 'trap'],
  }),
  cmd('type', 'Builtins', 'Say what a name resolves to', 'type [-afptP] NAME...', {
    builtin: true,
    description: 'Distinguishes an alias from a function from a builtin from a file on PATH -- the first thing to run when a command behaves unexpectedly.',
    seeAlso: ['which', 'command', 'hash'],
  }),
  cmd('command', 'Builtins', 'Run a command, bypassing functions and aliases', 'command [-pVv] COMMAND [ARGUMENTS]', { builtin: true, seeAlso: ['type', 'builtin', 'enable'] }),
  cmd('builtin', 'Builtins', 'Run a shell builtin, bypassing any function of the same name', 'builtin SHELL-BUILTIN [ARGUMENTS]', { builtin: true, seeAlso: ['command', 'enable'] }),
  cmd('enable', 'Builtins', 'Enable or disable shell builtins', 'enable [-a] [-dnps] [-f FILE] [NAME]...', { builtin: true, seeAlso: ['builtin'] }),
  cmd('hash', 'Builtins', 'Show or clear the remembered locations of commands', 'hash [-lr] [-p PATH] [-dt] [NAME]...', {
    builtin: true,
    options: [{ flag: '-r', summary: 'Forget every remembered path -- fixes "command not found" after an install' }],
    seeAlso: ['type', 'which'],
  }),
  cmd('help', 'Builtins', 'Show help for a shell builtin', 'help [-dms] [PATTERN]', { builtin: true, seeAlso: ['man', 'info'] }),
  cmd('history', 'Builtins', 'Show or edit the command history', 'history [-c] [-d OFFSET] [N]', {
    builtin: true,
    options: [
      { flag: '-c', summary: 'Clear the history for this session' },
      { flag: '-d OFFSET', summary: 'Delete one entry -- how a pasted secret is removed' },
    ],
    seeAlso: ['fc', 'alias'],
  }),
  cmd('fc', 'Builtins', 'Fix a command from history in an editor and rerun it', 'fc [-e EDITOR] [-lnr] [FIRST] [LAST]', { builtin: true, seeAlso: ['history'] }),
  cmd('pushd', 'Builtins', 'Push a directory onto the stack and go there', 'pushd [DIR | +N | -N]', { builtin: true, seeAlso: ['popd', 'dirs', 'cd'] }),
  cmd('popd', 'Builtins', 'Pop the directory stack and go there', 'popd [+N | -N]', { builtin: true, seeAlso: ['pushd', 'dirs'] }),
  cmd('dirs', 'Builtins', 'Show the directory stack', 'dirs [-clpv] [+N | -N]', { builtin: true, seeAlso: ['pushd', 'popd'] }),
  cmd('umask', 'Builtins', 'Set the default permission mask for new files', 'umask [-pS] [MODE]', { builtin: true, seeAlso: ['chmod'] }),
  cmd('shopt', 'Builtins', 'Set optional shell behaviour', 'shopt [-pqsu] [-o] [OPTNAME]...', {
    builtin: true,
    examples: [{ command: 'shopt -s globstar', summary: 'Make ** match across directories' }],
    seeAlso: ['set'],
  }),
  cmd('ulimit', 'Builtins', 'Show or set resource limits for the shell', 'ulimit [-HSabcdefiklmnpqrstuvxPRT] [LIMIT]', {
    builtin: true,
    options: [{ flag: '-n', summary: 'Maximum open file descriptors -- the usual culprit behind EMFILE' }],
    seeAlso: ['set', 'prlimit'],
  }),
  cmd('times', 'Builtins', 'Print accumulated user and system times', 'times', { builtin: true, seeAlso: ['time'] }),
  cmd('time', 'Builtins', 'Time how long a pipeline takes', 'time [-p] PIPELINE', { builtin: true, seeAlso: ['times', 'hyperfine'] }),
  cmd('let', 'Builtins', 'Evaluate arithmetic expressions', 'let ARG [ARG]...', { builtin: true, seeAlso: ['expr', 'bc'] }),
  cmd('mapfile', 'Builtins', 'Read lines of input into an array', 'mapfile [-d DELIM] [-n COUNT] [-t] [ARRAY]', {
    builtin: true,
    options: [{ flag: '-t', summary: 'Strip the trailing newline from each line' }],
    seeAlso: ['read', 'readarray'],
  }),
  cmd('readarray', 'Builtins', 'Read lines of input into an array (synonym of mapfile)', 'readarray [-d DELIM] [-t] [ARRAY]', { builtin: true, seeAlso: ['mapfile'] }),
  cmd('true', 'Builtins', 'Do nothing, successfully', 'true', { builtin: true, seeAlso: ['false', ':'] }),
  cmd('false', 'Builtins', 'Do nothing, unsuccessfully', 'false', { builtin: true, seeAlso: ['true'] }),
  cmd(':', 'Builtins', 'The null command -- expands its arguments and succeeds', ': [ARGUMENTS]', { builtin: true, seeAlso: ['true'] }),
  cmd('bind', 'Builtins', 'Show or change readline key bindings', 'bind [-lpsvPSVX] [-m KEYMAP] [-q NAME] [KEYSEQ:FUNCTION]', { builtin: true, seeAlso: ['stty'] }),
  cmd('caller', 'Builtins', 'Print the context of the current function call', 'caller [EXPR]', { builtin: true, seeAlso: ['trap'] }),
  cmd('compgen', 'Builtins', 'Generate completion candidates', 'compgen [OPTION] [WORD]', { builtin: true, seeAlso: ['complete'] }),
  cmd('complete', 'Builtins', 'Define how a command completes its arguments', 'complete [OPTION] [NAME]...', { builtin: true, seeAlso: ['compgen'] }),
  cmd('suspend', 'Builtins', 'Suspend the shell until it receives SIGCONT', 'suspend [-f]', { builtin: true, seeAlso: ['bg', 'fg'] }),
]
