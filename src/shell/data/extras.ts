/**
 * The commands the rest of the dictionary points at.
 *
 * Every `seeAlso` has to land on a real entry -- a cross-reference to a page
 * that does not exist is worse than no cross-reference -- so the alternatives
 * and companions named elsewhere are documented here.
 */

import { cmd, type CommandEntry } from '../commandModel'

export const extraCommands: CommandEntry[] = [
  cmd('unlink', 'Files', 'Remove a single file by unlinking it', 'unlink FILE', { from: 'coreutils', seeAlso: ['rm', 'ln'] }),
  cmd('trash', 'Files', 'Move files to the desktop trash instead of deleting them', 'trash [OPTION]... FILE...', {
    description: 'The recoverable alternative to rm, worth aliasing on a laptop.',
    seeAlso: ['rm', 'shred'],
  }),
  cmd('mmv', 'Files', 'Rename many files by wildcard pattern', 'mmv [OPTION]... FROM TO', { seeAlso: ['rename', 'mv'] }),
  cmd('unison', 'Files', 'Two-way file synchronisation between hosts', 'unison [OPTION]... ROOT1 ROOT2', { seeAlso: ['rsync'] }),
  cmd('progress', 'Files', 'Show how far a running cp, dd or tar has got', 'progress [OPTION]...', { seeAlso: ['pv', 'dd'] }),
  cmd('most', 'Files', 'A pager that can show several files at once', 'most [OPTION]... [FILE]...', { seeAlso: ['less', 'more'] }),
  cmd('multitail', 'Files', 'Follow several log files in split windows', 'multitail [OPTION]... FILE...', { seeAlso: ['tail', 'less'] }),
  cmd('ranlib', 'Archives', 'Build the index of a static library archive', 'ranlib ARCHIVE', { seeAlso: ['ar', 'nm'] }),
  cmd('mkswap', 'System', 'Prepare a device or file as swap space', 'mkswap [OPTION]... DEVICE', { danger: 'Formatting a device as swap destroys what was on it.', seeAlso: ['swapon', 'mkfs'] }),
  cmd('arch', 'System', 'Print the machine architecture', 'arch', { from: 'coreutils', seeAlso: ['uname', 'lscpu'] }),
  cmd('logname', 'System', 'Print the name of the user who logged in', 'logname', { from: 'coreutils', seeAlso: ['whoami', 'id'] }),
  cmd('login', 'System', 'Begin a session on the system', 'login [OPTION]... [USER]', { seeAlso: ['su', 'logout', 'who'] }),
  cmd('lastlog', 'System', 'Report the most recent login of every user', 'lastlog [OPTION]...', { seeAlso: ['last', 'who'] }),
  cmd('smem', 'System', 'Report memory use with shared pages counted fairly', 'smem [OPTION]...', { seeAlso: ['free', 'top'] }),
  cmd('ncal', 'System', 'Print a calendar in vertical layout', 'ncal [OPTION]... [[MONTH] YEAR]', { seeAlso: ['cal', 'date'] }),
  cmd('anacron', 'System', 'Run periodic jobs that were missed while the machine was off', 'anacron [OPTION]... [JOB]...', { seeAlso: ['crontab', 'at'] }),
  cmd('daemonize', 'Processes', 'Run a command as a background daemon', 'daemonize [OPTION]... PATH [ARG]...', { seeAlso: ['nohup', 'setsid', 'systemd-run'] }),
  cmd('dtruss', 'Processes', 'Trace system calls on macOS', 'dtruss [OPTION]... COMMAND', { seeAlso: ['strace', 'dtrace'] }),
  cmd('dtrace', 'Processes', 'Dynamically instrument a running system', 'dtrace [OPTION]... SCRIPT', { seeAlso: ['dtruss', 'perf', 'strace'] }),
  cmd('flamegraph', 'Processes', 'Turn sampled stacks into an interactive flame graph', 'flamegraph.pl [OPTION]... < FOLDED', { seeAlso: ['perf', 'hyperfine'] }),
  cmd('tracepath', 'Network', 'Trace the path to a host and discover the MTU', 'tracepath [OPTION]... HOST', { seeAlso: ['traceroute', 'ping'] }),
  cmd('iwctl', 'Network', 'Manage wireless connections with iwd', 'iwctl [OPTION]... [COMMAND]', { seeAlso: ['nmcli', 'iw'] }),
  cmd('wireshark', 'Network', 'Capture and analyse network traffic with a graphical interface', 'wireshark [OPTION]... [FILE]', { seeAlso: ['tcpdump', 'tshark'] }),
  cmd('nginx', 'Network', 'A web server and reverse proxy', 'nginx [OPTION]...', {
    options: [{ flag: '-t', summary: 'Test the configuration before reloading' }, { flag: '-s reload', summary: 'Reload without dropping connections' }],
    seeAlso: ['certbot', 'curl', 'systemctl'],
  }),
  cmd('port', 'Packages', 'The MacPorts package manager', 'port [OPTION]... ACTION [PORT]...', { seeAlso: ['brew'] }),
  cmd('nix-env', 'Packages', 'Install and manage packages in a Nix profile', 'nix-env [OPTION]... OPERATION', { seeAlso: ['nix'] }),
  cmd('fnm', 'Packages', 'A fast Node.js version manager', 'fnm [OPTION]... COMMAND', { seeAlso: ['nvm', 'asdf'] }),
  cmd('mise', 'Packages', 'Manage runtime versions and project environments', 'mise [OPTION]... COMMAND', { seeAlso: ['asdf', 'direnv'] }),
  cmd('luarocks', 'Packages', 'The Lua package manager', 'luarocks [OPTION]... COMMAND', { seeAlso: ['lua'] }),
  cmd('pg_restore', 'Development', 'Restore a PostgreSQL database from an archive', 'pg_restore [OPTION]... [FILE]', { danger: 'Restoring over a live database replaces its contents.', seeAlso: ['pg_dump', 'psql'] }),
  cmd('ipython', 'Development', 'An enhanced interactive Python shell', 'ipython [OPTION]... [FILE]', { seeAlso: ['python3', 'jupyter'] }),
  cmd('jupyter', 'Development', 'Run notebooks and interactive computing servers', 'jupyter SUBCOMMAND [OPTION]...', { seeAlso: ['ipython', 'python3'] }),
  cmd('rails', 'Development', 'Generate, run and manage Ruby on Rails applications', 'rails COMMAND [OPTION]...', { seeAlso: ['ruby', 'bundle'] }),
  cmd('glab', 'Development', 'The GitLab command line', 'glab COMMAND [SUBCOMMAND] [FLAGS]', { seeAlso: ['gh', 'git'] }),
  cmd('cypress', 'Development', 'Run browser end-to-end tests interactively', 'cypress COMMAND [OPTION]...', { seeAlso: ['playwright', 'vitest'] }),
  cmd('datamash', 'Text', 'Compute statistics on columns of text', 'datamash [OPTION]... OPERATION COLUMN...', {
    examples: [{ command: 'datamash -t, mean 2 < data.csv', summary: 'Average a CSV column without writing a script' }],
    seeAlso: ['awk', 'sort', 'mlr'],
  }),
  cmd('par', 'Text', 'Reformat paragraphs to a width, more carefully than fmt', 'par [OPTION]... [WIDTH]', { seeAlso: ['fmt', 'fold'] }),
  cmd('peco', 'Search', 'Interactive filtering for the shell', 'peco [OPTION]... [FILE]', { seeAlso: ['fzf'] }),
  cmd('micro', 'Development', 'A small modern terminal editor with familiar keys', 'micro [OPTION]... [FILE]...', { seeAlso: ['nano', 'vim'] }),
  cmd('vimdiff', 'Development', 'Open a diff of two or more files in vim', 'vimdiff [OPTION]... FILE...', { seeAlso: ['diff', 'vim', 'delta'] }),
  cmd('msbuild', 'Development', 'Build .NET projects and solutions', 'msbuild [OPTION]... [PROJECT]', { seeAlso: ['dotnet', 'make'] }),
  cmd('pulumi', 'Development', 'Define cloud infrastructure in a programming language', 'pulumi COMMAND [OPTION]...', { danger: '`pulumi destroy` deletes the real resources in the stack.', seeAlso: ['terraform', 'aws'] }),
  cmd('terminal-notifier', 'System', 'Send a macOS notification from the shell', 'terminal-notifier [OPTION]...', { seeAlso: ['notify-send'] }),
]
