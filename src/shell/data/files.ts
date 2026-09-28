/**
 * Files, directories, links, disks-as-files, archives and permissions.
 *
 * The coreutils heartland, plus the archive tools people reach for once a
 * directory needs to travel and the permission tools they reach for once it
 * refuses to open.
 */

import { cmd, type CommandEntry } from '../commandModel'

export const fileCommands: CommandEntry[] = [
  cmd('ls', 'Files', 'List directory contents', 'ls [OPTION]... [FILE]...', {
    from: 'coreutils',
    description:
      'Sorted alphabetically and hidden entries omitted unless asked. Output is a table only when it is not a terminal-width list, which is why piping `ls` changes its shape -- use `ls -1` when a script depends on it.',
    options: [
      { flag: '-l', summary: 'Long format: permissions, owner, size, date' },
      { flag: '-a, --all', summary: 'Include entries starting with a dot' },
      { flag: '-A', summary: 'Like -a but without . and ..' },
      { flag: '-h, --human-readable', summary: 'Sizes as 1K, 234M, 2G' },
      { flag: '-t', summary: 'Sort by modification time, newest first' },
      { flag: '-S', summary: 'Sort by size, largest first' },
      { flag: '-r, --reverse', summary: 'Reverse the sort order' },
      { flag: '-R, --recursive', summary: 'List subdirectories too' },
      { flag: '-d, --directory', summary: 'Show the directory itself, not its contents' },
      { flag: '-1', summary: 'One entry per line' },
    ],
    examples: [
      { command: 'ls -lah', summary: 'The everyday listing: long, hidden, human sizes' },
      { command: 'ls -ltr', summary: 'Oldest to newest -- the newest file lands at the bottom' },
    ],
    seeAlso: ['tree', 'find', 'stat', 'du', 'exa'],
  }),
  cmd('cp', 'Files', 'Copy files and directories', 'cp [OPTION]... SOURCE... DEST', {
    from: 'coreutils',
    danger: 'Overwrites the destination silently unless you pass -i or -n.',
    options: [
      { flag: '-r, -R, --recursive', summary: 'Copy directories and everything in them' },
      { flag: '-a, --archive', summary: 'Recursive, preserving links, times and permissions' },
      { flag: '-i, --interactive', summary: 'Ask before overwriting' },
      { flag: '-n, --no-clobber', summary: 'Never overwrite an existing file' },
      { flag: '-u, --update', summary: 'Copy only when the source is newer' },
      { flag: '-v, --verbose', summary: 'Name each file as it is copied' },
      { flag: '-p', summary: 'Preserve mode, ownership and timestamps' },
    ],
    examples: [
      { command: 'cp -av src/ backup/', summary: 'Mirror a directory, keeping metadata' },
      { command: 'cp file.txt{,.bak}', summary: 'Brace expansion makes a backup beside the original' },
    ],
    seeAlso: ['mv', 'rsync', 'install', 'dd'],
  }),
  cmd('mv', 'Files', 'Move or rename files and directories', 'mv [OPTION]... SOURCE... DEST', {
    from: 'coreutils',
    danger: 'A move onto an existing path replaces it. Use -i or -n.',
    options: [
      { flag: '-i', summary: 'Ask before overwriting' },
      { flag: '-n', summary: 'Never overwrite' },
      { flag: '-v', summary: 'Name each file as it moves' },
      { flag: '-t DIR', summary: 'Name the target directory first, for use with xargs' },
    ],
    examples: [{ command: 'mv -v *.png images/', summary: 'Move every PNG into a directory' }],
    seeAlso: ['cp', 'rename', 'rsync'],
  }),
  cmd('rm', 'Files', 'Remove files and directories', 'rm [OPTION]... FILE...', {
    from: 'coreutils',
    danger: 'There is no undo and no trash. `rm -rf` on the wrong path is unrecoverable.',
    options: [
      { flag: '-r, -R, --recursive', summary: 'Remove directories and their contents' },
      { flag: '-f, --force', summary: 'Never prompt, ignore missing files' },
      { flag: '-i', summary: 'Ask about every file' },
      { flag: '-I', summary: 'Ask once before removing more than three files' },
      { flag: '-v', summary: 'Name each file as it is removed' },
      { flag: '--one-file-system', summary: 'Do not cross into another mounted filesystem' },
    ],
    examples: [{ command: 'rm -rI build/', summary: 'Delete a build directory with one confirmation' }],
    seeAlso: ['rmdir', 'shred', 'trash', 'unlink'],
  }),
  cmd('mkdir', 'Files', 'Create directories', 'mkdir [OPTION]... DIRECTORY...', {
    from: 'coreutils',
    options: [
      { flag: '-p, --parents', summary: 'Create missing parents, and do not complain if it exists' },
      { flag: '-m MODE', summary: 'Set the permissions as it is created' },
      { flag: '-v', summary: 'Name each directory created' },
    ],
    examples: [{ command: 'mkdir -p src/components/panel', summary: 'Create a whole path at once' }],
    seeAlso: ['rmdir', 'install', 'mktemp'],
  }),
  cmd('rmdir', 'Files', 'Remove empty directories', 'rmdir [OPTION]... DIRECTORY...', {
    from: 'coreutils',
    options: [{ flag: '-p', summary: 'Remove the parents too, as long as they become empty' }],
    seeAlso: ['rm', 'mkdir'],
  }),
  cmd('touch', 'Files', 'Create an empty file or update its timestamps', 'touch [OPTION]... FILE...', {
    from: 'coreutils',
    options: [
      { flag: '-a', summary: 'Change only the access time' },
      { flag: '-m', summary: 'Change only the modification time' },
      { flag: '-c, --no-create', summary: 'Do not create the file if it is missing' },
      { flag: '-d STRING, -t STAMP', summary: 'Use a given time instead of now' },
    ],
    seeAlso: ['stat', 'date'],
  }),
  cmd('cat', 'Files', 'Concatenate files to standard output', 'cat [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-n', summary: 'Number every output line' },
      { flag: '-b', summary: 'Number only the non-blank lines' },
      { flag: '-A', summary: 'Show tabs, line ends and non-printing characters' },
      { flag: '-s', summary: 'Squeeze repeated blank lines into one' },
    ],
    examples: [{ command: 'cat -n notes.md | head -20', summary: 'The first twenty lines, numbered' }],
    seeAlso: ['less', 'head', 'tail', 'tac', 'bat'],
  }),
  cmd('tac', 'Files', 'Print files with the lines in reverse order', 'tac [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['cat', 'rev'] }),
  cmd('head', 'Files', 'Print the first part of a file', 'head [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-n N', summary: 'Print the first N lines; -n -N prints all but the last N' },
      { flag: '-c N', summary: 'Print the first N bytes' },
      { flag: '-q', summary: 'Never print the filename header' },
    ],
    seeAlso: ['tail', 'sed', 'less'],
  }),
  cmd('tail', 'Files', 'Print the last part of a file', 'tail [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-n N', summary: 'Print the last N lines; -n +N starts at line N' },
      { flag: '-f, --follow', summary: 'Keep the file open and print new lines as they arrive' },
      { flag: '-F', summary: 'Follow by name, surviving log rotation' },
    ],
    examples: [{ command: 'tail -f /var/log/syslog', summary: 'Watch a log as it is written' }],
    seeAlso: ['head', 'less', 'journalctl', 'multitail'],
  }),
  cmd('less', 'Files', 'Page through a file or piped input', 'less [OPTION]... [FILE]...', {
    options: [
      { flag: '-N', summary: 'Show line numbers' },
      { flag: '-S', summary: 'Chop long lines instead of wrapping' },
      { flag: '-R', summary: 'Pass colour escapes through' },
      { flag: '+F', summary: 'Start in follow mode, like tail -f' },
      { flag: '-i', summary: 'Case-insensitive search unless the pattern has capitals' },
    ],
    examples: [{ command: 'git log | less -R', summary: 'Page coloured output without losing the colour' }],
    seeAlso: ['more', 'cat', 'bat', 'most'],
  }),
  cmd('more', 'Files', 'Page through a file, one screen at a time', 'more [OPTION]... [FILE]...', { seeAlso: ['less'] }),
  cmd('file', 'Files', 'Identify a file’s type by its contents', 'file [OPTION]... FILE...', {
    options: [
      { flag: '-b', summary: 'Do not print the filename' },
      { flag: '-i', summary: 'Print a MIME type' },
    ],
    seeAlso: ['stat', 'xxd', 'strings'],
  }),
  cmd('stat', 'Files', 'Show detailed file or filesystem status', 'stat [OPTION]... FILE...', {
    from: 'coreutils',
    options: [
      { flag: '-c FORMAT', summary: 'Print only the fields you name, e.g. %s for size' },
      { flag: '-f', summary: 'Report on the filesystem instead of the file' },
    ],
    examples: [{ command: 'stat -c "%s %n" *.log', summary: 'Size and name of every log' }],
    seeAlso: ['ls', 'file', 'du'],
  }),
  cmd('ln', 'Files', 'Create links between files', 'ln [OPTION]... TARGET [LINK_NAME]', {
    from: 'coreutils',
    description:
      'A hard link is another name for the same data; a symbolic link is a pointer that can dangle. Use -s unless you know you want the former.',
    options: [
      { flag: '-s, --symbolic', summary: 'Make a symbolic link' },
      { flag: '-f, --force', summary: 'Replace an existing link' },
      { flag: '-n', summary: 'Treat an existing symlinked directory as a file' },
      { flag: '-r, --relative', summary: 'Make the symlink target relative' },
    ],
    examples: [{ command: 'ln -sfn ../releases/v3 current', summary: 'Repoint a "current" symlink atomically' }],
    seeAlso: ['readlink', 'realpath', 'unlink'],
  }),
  cmd('readlink', 'Files', 'Print the target of a symbolic link', 'readlink [OPTION]... FILE...', {
    from: 'coreutils',
    options: [{ flag: '-f', summary: 'Follow every link and print the final canonical path' }],
    seeAlso: ['ln', 'realpath'],
  }),
  cmd('realpath', 'Files', 'Print the resolved absolute path', 'realpath [OPTION]... FILE...', { from: 'coreutils', seeAlso: ['readlink', 'pwd', 'basename'] }),
  cmd('basename', 'Files', 'Strip the directory (and optionally a suffix) from a path', 'basename NAME [SUFFIX]', { from: 'coreutils', seeAlso: ['dirname', 'realpath'] }),
  cmd('dirname', 'Files', 'Strip the last component from a path', 'dirname NAME...', { from: 'coreutils', seeAlso: ['basename'] }),
  cmd('tree', 'Files', 'Show a directory as an indented tree', 'tree [OPTION]... [DIRECTORY]', {
    options: [
      { flag: '-L N', summary: 'Descend at most N levels' },
      { flag: '-a', summary: 'Include hidden entries' },
      { flag: '-d', summary: 'Directories only' },
      { flag: '-I PATTERN', summary: 'Exclude matching names, e.g. node_modules' },
    ],
    examples: [{ command: 'tree -L 2 -I node_modules', summary: 'A two-level map of a project' }],
    seeAlso: ['ls', 'find', 'du'],
  }),
  cmd('du', 'Files', 'Estimate the space used by files and directories', 'du [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-h', summary: 'Human-readable sizes' },
      { flag: '-s', summary: 'One total per argument instead of every child' },
      { flag: '-d N, --max-depth=N', summary: 'Summarise only N levels down' },
      { flag: '-x', summary: 'Stay on one filesystem' },
      { flag: '-a', summary: 'Count files as well as directories' },
    ],
    examples: [{ command: 'du -sh * | sort -h | tail -10', summary: 'The ten biggest things here' }],
    seeAlso: ['df', 'ncdu', 'ls', 'find'],
  }),
  cmd('df', 'Files', 'Report free space on mounted filesystems', 'df [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-h', summary: 'Human-readable sizes' },
      { flag: '-i', summary: 'Report inodes instead of blocks -- the other way to run out of disk' },
      { flag: '-T', summary: 'Show the filesystem type' },
    ],
    seeAlso: ['du', 'mount', 'lsblk'],
  }),
  cmd('shred', 'Files', 'Overwrite a file to make recovery hard, then optionally delete it', 'shred [OPTION]... FILE...', {
    from: 'coreutils',
    danger: 'Destroys the contents in place. Useless on copy-on-write and journalling filesystems such as btrfs or ZFS.',
    options: [
      { flag: '-u', summary: 'Remove the file after overwriting' },
      { flag: '-n N', summary: 'Overwrite N times' },
      { flag: '-z', summary: 'Finish with a pass of zeros' },
    ],
    seeAlso: ['rm', 'dd'],
  }),
  cmd('dd', 'Files', 'Copy and convert data block by block', 'dd [OPERAND]...', {
    from: 'coreutils',
    danger: 'Writes wherever `of=` points, including a whole disk. Check the target twice.',
    options: [
      { flag: 'if=FILE', summary: 'Read from this file or device' },
      { flag: 'of=FILE', summary: 'Write to this file or device' },
      { flag: 'bs=BYTES', summary: 'Block size, e.g. 4M' },
      { flag: 'status=progress', summary: 'Print progress while it runs' },
      { flag: 'conv=fsync', summary: 'Flush to the device before exiting' },
    ],
    examples: [{ command: 'dd if=image.iso of=/dev/sdX bs=4M status=progress conv=fsync', summary: 'Write an installer image to a USB stick' }],
    seeAlso: ['cp', 'pv', 'shred'],
  }),
  cmd('install', 'Files', 'Copy files and set their permissions in one step', 'install [OPTION]... SOURCE... DEST', {
    from: 'coreutils',
    options: [
      { flag: '-D', summary: 'Create the parent directories' },
      { flag: '-m MODE', summary: 'Set the permissions' },
      { flag: '-o OWNER, -g GROUP', summary: 'Set ownership' },
    ],
    seeAlso: ['cp', 'mkdir', 'chmod'],
  }),
  cmd('mktemp', 'Files', 'Create a temporary file or directory safely', 'mktemp [OPTION]... [TEMPLATE]', {
    from: 'coreutils',
    options: [{ flag: '-d', summary: 'Make a directory instead of a file' }],
    examples: [{ command: 'tmp=$(mktemp -d) && trap \'rm -rf "$tmp"\' EXIT', summary: 'A scratch directory that cleans itself up' }],
    seeAlso: ['trap', 'mkdir'],
  }),
  cmd('rename', 'Files', 'Rename many files by pattern', 'rename [OPTION]... EXPRESSION FILE...', {
    examples: [{ command: "rename 's/\\.jpeg$/.jpg/' *.jpeg", summary: 'Fix an extension across a folder' }],
    seeAlso: ['mv', 'mmv'],
  }),
  cmd('split', 'Files', 'Split a file into pieces', 'split [OPTION]... [FILE [PREFIX]]', {
    from: 'coreutils',
    options: [
      { flag: '-b SIZE', summary: 'Split by size, e.g. 100M' },
      { flag: '-l N', summary: 'Split every N lines' },
      { flag: '-d', summary: 'Use numeric suffixes' },
    ],
    seeAlso: ['csplit', 'cat'],
  }),
  cmd('csplit', 'Files', 'Split a file at pattern matches', 'csplit [OPTION]... FILE PATTERN...', { from: 'coreutils', seeAlso: ['split', 'awk'] }),
  cmd('truncate', 'Files', 'Shrink or extend a file to a size', 'truncate [OPTION]... -s SIZE FILE...', { from: 'coreutils', danger: 'Shrinking discards the tail of the file.', seeAlso: ['dd', 'fallocate'] }),
  cmd('fallocate', 'Files', 'Reserve space for a file without writing it', 'fallocate [-l SIZE] FILE', { seeAlso: ['truncate', 'dd'] }),
  cmd('sync', 'Files', 'Flush filesystem buffers to disk', 'sync [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['dd', 'umount'] }),
  cmd('mount', 'Files', 'Attach a filesystem to the directory tree', 'mount [-t TYPE] [-o OPTIONS] DEVICE DIR', {
    options: [
      { flag: '-a', summary: 'Mount everything in /etc/fstab' },
      { flag: '-o ro', summary: 'Mount read-only' },
      { flag: '--bind', summary: 'Make a directory appear at a second path' },
    ],
    seeAlso: ['umount', 'findmnt', 'lsblk'],
  }),
  cmd('umount', 'Files', 'Detach a mounted filesystem', 'umount [OPTION]... DIR|DEVICE', {
    options: [{ flag: '-l', summary: 'Lazy: detach now, clean up when it is no longer busy' }],
    seeAlso: ['mount', 'lsof', 'fuser'],
  }),
  cmd('findmnt', 'Files', 'List mounted filesystems as a tree', 'findmnt [OPTION]... [DEVICE|MOUNTPOINT]', { seeAlso: ['mount', 'df'] }),
  cmd('lsof', 'Files', 'List open files and the processes holding them', 'lsof [OPTION]...', {
    options: [
      { flag: '-i :PORT', summary: 'Who is listening on a port' },
      { flag: '+D DIR', summary: 'Everything open under a directory' },
      { flag: '-p PID', summary: 'Everything one process has open' },
    ],
    examples: [{ command: 'lsof -i :5173', summary: 'Find what is holding the dev server port' }],
    seeAlso: ['fuser', 'ss', 'netstat'],
  }),
  cmd('fuser', 'Files', 'Identify processes using a file or socket', 'fuser [OPTION]... NAME...', { seeAlso: ['lsof', 'kill'] }),
  cmd('ncdu', 'Files', 'Browse disk usage interactively', 'ncdu [OPTION]... [DIR]', { seeAlso: ['du', 'df'] }),
  cmd('rsync', 'Files', 'Sync files locally or over SSH, copying only the differences', 'rsync [OPTION]... SOURCE... DEST', {
    description:
      'A trailing slash on the source means "the contents of", without means "the directory itself" -- the single most common rsync mistake.',
    options: [
      { flag: '-a', summary: 'Archive: recursive, preserving almost everything' },
      { flag: '-v', summary: 'Verbose' },
      { flag: '-z', summary: 'Compress in transit' },
      { flag: '-P', summary: 'Progress plus resume of partial files' },
      { flag: '--delete', summary: 'Remove files at the destination that are gone from the source' },
      { flag: '-n, --dry-run', summary: 'Show what would happen and change nothing' },
      { flag: '--exclude PATTERN', summary: 'Skip matching paths' },
    ],
    examples: [
      { command: 'rsync -avzP ./dist/ user@host:/srv/app/', summary: 'Deploy a build directory over SSH' },
      { command: 'rsync -avn --delete ./src/ ./mirror/', summary: 'Preview an exact mirror before doing it' },
    ],
    danger: '--delete removes files at the destination. Always rehearse it with -n.',
    seeAlso: ['scp', 'cp', 'sftp', 'unison'],
  }),
  cmd('exa', 'Files', 'A modern ls with colours, git status and a tree mode', 'exa [OPTION]... [PATH]...', { seeAlso: ['ls', 'lsd', 'tree'] }),
  cmd('lsd', 'Files', 'An ls rewrite with icons and colours', 'lsd [OPTION]... [PATH]...', { seeAlso: ['ls', 'exa'] }),
  cmd('bat', 'Files', 'A cat with syntax highlighting and paging', 'bat [OPTION]... [FILE]...', { seeAlso: ['cat', 'less'] }),
  cmd('pv', 'Files', 'Show progress as data flows through a pipe', 'pv [OPTION]... [FILE]...', {
    examples: [{ command: 'pv big.sql | mysql app', summary: 'Watch an import advance' }],
    seeAlso: ['dd', 'progress'],
  }),
  cmd('xxd', 'Files', 'Make a hex dump, or reverse one', 'xxd [OPTION]... [FILE]', {
    options: [{ flag: '-r', summary: 'Turn a hex dump back into binary' }],
    seeAlso: ['hexdump', 'od', 'strings'],
  }),
  cmd('hexdump', 'Files', 'Display a file in hex, decimal or ASCII', 'hexdump [OPTION]... FILE...', { options: [{ flag: '-C', summary: 'The canonical hex + ASCII layout' }], seeAlso: ['xxd', 'od'] }),
  cmd('od', 'Files', 'Dump a file in octal and other formats', 'od [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['hexdump', 'xxd'] }),
  cmd('strings', 'Files', 'Print the printable strings inside a binary', 'strings [OPTION]... FILE...', { seeAlso: ['grep', 'xxd', 'file'] }),
  cmd('cmp', 'Files', 'Compare two files byte by byte', 'cmp [OPTION]... FILE1 [FILE2]', { from: 'diffutils', seeAlso: ['diff', 'md5sum'] }),
  cmd('diff', 'Files', 'Show the differences between files line by line', 'diff [OPTION]... FILES', {
    from: 'diffutils',
    options: [
      { flag: '-u', summary: 'Unified format -- what patches and reviews use' },
      { flag: '-r', summary: 'Recurse into directories' },
      { flag: '-q', summary: 'Only report whether they differ' },
      { flag: '-w', summary: 'Ignore whitespace' },
      { flag: '--color=auto', summary: 'Colour the output' },
    ],
    examples: [{ command: 'diff -ru old/ new/ > changes.patch', summary: 'Produce a patch from two trees' }],
    seeAlso: ['patch', 'git', 'cmp', 'delta', 'vimdiff'],
  }),
  cmd('patch', 'Files', 'Apply a diff to files', 'patch [OPTION]... [ORIGFILE [PATCHFILE]]', {
    options: [
      { flag: '-pN', summary: 'Strip N leading path components' },
      { flag: '-R', summary: 'Reverse the patch' },
      { flag: '--dry-run', summary: 'Check whether it applies without touching anything' },
    ],
    seeAlso: ['diff', 'git'],
  }),
  cmd('md5sum', 'Files', 'Compute or check MD5 checksums', 'md5sum [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['sha256sum', 'cksum', 'cmp'] }),
  cmd('sha1sum', 'Files', 'Compute or check SHA-1 checksums', 'sha1sum [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['sha256sum'] }),
  cmd('sha256sum', 'Files', 'Compute or check SHA-256 checksums', 'sha256sum [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [{ flag: '-c', summary: 'Verify files against a checksum list' }],
    examples: [{ command: 'sha256sum -c SHASUMS256.txt', summary: 'Verify a download against its published sums' }],
    seeAlso: ['md5sum', 'gpg'],
  }),
  cmd('cksum', 'Files', 'Print a CRC checksum and byte count', 'cksum [FILE]...', { from: 'coreutils', seeAlso: ['md5sum'] }),
  cmd('chmod', 'Permissions', 'Change file mode bits', 'chmod [OPTION]... MODE FILE...', {
    from: 'coreutils',
    description:
      'Modes come two ways: symbolic (`u+x`, `go-w`) and octal (`755` = rwxr-xr-x, `644` = rw-r--r--). Read, write and execute are 4, 2 and 1, summed per owner / group / other.',
    options: [
      { flag: '-R', summary: 'Apply to a directory tree' },
      { flag: '--reference=FILE', summary: 'Copy another file’s mode' },
    ],
    examples: [
      { command: 'chmod +x scripts/deploy.sh', summary: 'Make a script runnable' },
      { command: 'chmod -R go-rwx ~/.ssh', summary: 'Lock a directory to its owner' },
    ],
    seeAlso: ['chown', 'umask', 'stat', 'setfacl'],
  }),
  cmd('chown', 'Permissions', 'Change file owner and group', 'chown [OPTION]... OWNER[:GROUP] FILE...', {
    from: 'coreutils',
    options: [
      { flag: '-R', summary: 'Apply to a directory tree' },
      { flag: '-h', summary: 'Change the symlink itself, not its target' },
    ],
    examples: [{ command: 'sudo chown -R www-data:www-data /srv/app', summary: 'Hand a directory to a service account' }],
    seeAlso: ['chmod', 'chgrp', 'id'],
  }),
  cmd('chgrp', 'Permissions', 'Change the group of a file', 'chgrp [OPTION]... GROUP FILE...', { from: 'coreutils', seeAlso: ['chown', 'groups'] }),
  cmd('getfacl', 'Permissions', 'Show access control lists', 'getfacl [OPTION]... FILE...', { seeAlso: ['setfacl', 'ls'] }),
  cmd('setfacl', 'Permissions', 'Set access control lists for finer-grained permissions', 'setfacl [OPTION]... FILE...', {
    options: [{ flag: '-m u:USER:rwx', summary: 'Grant one user explicit access' }],
    seeAlso: ['getfacl', 'chmod'],
  }),
  cmd('lsattr', 'Permissions', 'List filesystem attributes', 'lsattr [OPTION]... [FILE]...', { seeAlso: ['chattr'] }),
  cmd('chattr', 'Permissions', 'Change filesystem attributes, such as immutability', 'chattr [OPTION]... MODE FILE...', {
    options: [{ flag: '+i', summary: 'Immutable -- not even root can change it until cleared' }],
    seeAlso: ['lsattr', 'chmod'],
  }),
  cmd('sudo', 'Permissions', 'Run a command as another user, usually root', 'sudo [OPTION]... COMMAND', {
    danger: 'Everything after sudo runs with full privileges. Read the line before pressing Enter.',
    options: [
      { flag: '-u USER', summary: 'Run as this user instead of root' },
      { flag: '-i', summary: 'Start a login shell as the target user' },
      { flag: '-E', summary: 'Keep the current environment' },
      { flag: '-k', summary: 'Forget the cached credentials' },
    ],
    examples: [{ command: 'sudo -u postgres psql', summary: 'Open a database shell as the service user' }],
    seeAlso: ['su', 'doas', 'visudo', 'id'],
  }),
  cmd('su', 'Permissions', 'Switch to another user', 'su [OPTION]... [USER]', { options: [{ flag: '-', summary: 'Start a login shell, loading that user’s environment' }], seeAlso: ['sudo', 'login'] }),
  cmd('doas', 'Permissions', 'Run a command as another user (an OpenBSD-style sudo)', 'doas [OPTION]... COMMAND', { seeAlso: ['sudo'] }),
  cmd('visudo', 'Permissions', 'Edit the sudoers file with syntax checking', 'visudo [OPTION]...', { danger: 'A broken sudoers file can lock everyone out of root. Only edit it through visudo.', seeAlso: ['sudo'] }),
  cmd('passwd', 'Permissions', 'Change a user’s password', 'passwd [OPTION]... [USER]', { seeAlso: ['chage', 'useradd'] }),
  cmd('tar', 'Archives', 'Create and extract tar archives', 'tar [OPTION]... [FILE]...', {
    description:
      'Read the flags as a sentence: c create, x extract, t list, f the file, v verbose, z gzip, j bzip2, J xz. Modern tar detects compression on extract, so `tar xf` is usually enough.',
    options: [
      { flag: '-c', summary: 'Create an archive' },
      { flag: '-x', summary: 'Extract an archive' },
      { flag: '-t', summary: 'List the contents' },
      { flag: '-f FILE', summary: 'Use this archive file' },
      { flag: '-v', summary: 'List files as they are processed' },
      { flag: '-z', summary: 'Compress with gzip' },
      { flag: '-J', summary: 'Compress with xz' },
      { flag: '-C DIR', summary: 'Change to this directory first' },
      { flag: '--exclude PATTERN', summary: 'Leave matching paths out' },
    ],
    examples: [
      { command: 'tar czf site.tar.gz --exclude node_modules site/', summary: 'Pack a project without its dependencies' },
      { command: 'tar xf release.tar.gz -C /opt/app', summary: 'Unpack into a target directory' },
      { command: 'tar tf archive.tar | head', summary: 'Look inside before extracting' },
    ],
    seeAlso: ['gzip', 'zip', 'zstd', 'cpio', 'xz'],
  }),
  cmd('gzip', 'Archives', 'Compress a file with gzip, replacing it', 'gzip [OPTION]... [FILE]...', {
    options: [
      { flag: '-k', summary: 'Keep the original' },
      { flag: '-d', summary: 'Decompress' },
      { flag: '-9', summary: 'Best compression, slowest' },
    ],
    seeAlso: ['gunzip', 'zcat', 'tar', 'bzip2', 'zstd'],
  }),
  cmd('gunzip', 'Archives', 'Decompress a gzip file', 'gunzip [OPTION]... [FILE]...', { seeAlso: ['gzip', 'zcat'] }),
  cmd('zcat', 'Archives', 'Print a gzip file without decompressing it to disk', 'zcat [FILE]...', { seeAlso: ['gzip', 'zgrep'] }),
  cmd('bzip2', 'Archives', 'Compress with the bzip2 algorithm', 'bzip2 [OPTION]... [FILE]...', { seeAlso: ['gzip', 'xz'] }),
  cmd('xz', 'Archives', 'Compress with the xz algorithm -- small output, slow', 'xz [OPTION]... [FILE]...', { seeAlso: ['gzip', 'zstd', 'tar'] }),
  cmd('zstd', 'Archives', 'Compress with Zstandard -- fast, and nearly as small as xz', 'zstd [OPTION]... [FILE]...', { seeAlso: ['gzip', 'xz', 'tar'] }),
  cmd('zip', 'Archives', 'Create a zip archive', 'zip [OPTION]... ARCHIVE FILE...', {
    options: [
      { flag: '-r', summary: 'Recurse into directories' },
      { flag: '-e', summary: 'Encrypt with a password' },
      { flag: '-x PATTERN', summary: 'Exclude matching paths' },
    ],
    examples: [{ command: 'zip -r bundle.zip dist -x "*.map"', summary: 'Zip a build without source maps' }],
    seeAlso: ['unzip', 'tar'],
  }),
  cmd('unzip', 'Archives', 'Extract a zip archive', 'unzip [OPTION]... ARCHIVE [FILE]...', {
    options: [
      { flag: '-l', summary: 'List the contents without extracting' },
      { flag: '-d DIR', summary: 'Extract into this directory' },
      { flag: '-o', summary: 'Overwrite without asking' },
    ],
    seeAlso: ['zip', 'tar'],
  }),
  cmd('7z', 'Archives', 'Create and extract 7-Zip and many other archive formats', '7z COMMAND ARCHIVE [FILE]...', { seeAlso: ['zip', 'tar'] }),
  cmd('cpio', 'Archives', 'Copy files into or out of a cpio archive', 'cpio [OPTION]...', { seeAlso: ['tar', 'find'] }),
  cmd('ar', 'Archives', 'Create and extract static library archives', 'ar [OPTION] ARCHIVE [FILE]...', { seeAlso: ['tar', 'nm', 'ranlib'] }),
]
