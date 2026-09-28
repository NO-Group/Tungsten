/**
 * Text processing and search.
 *
 * The pipeline half of the shell: the tools that read lines on standard input
 * and write different lines on standard output, plus the ones that find the
 * files to feed them.
 */

import { cmd, type CommandEntry } from '../commandModel'

export const textCommands: CommandEntry[] = [
  cmd('grep', 'Search', 'Print lines matching a pattern', 'grep [OPTION]... PATTERN [FILE]...', {
    description:
      'Basic regular expressions by default, so `+`, `?` and `|` need backslashes -- pass -E to use the extended syntax people usually mean.',
    options: [
      { flag: '-i', summary: 'Ignore case' },
      { flag: '-v', summary: 'Invert: print the lines that do not match' },
      { flag: '-r, -R', summary: 'Search a directory tree' },
      { flag: '-n', summary: 'Prefix each line with its number' },
      { flag: '-l', summary: 'Print only the names of matching files' },
      { flag: '-c', summary: 'Print a count instead of the lines' },
      { flag: '-w', summary: 'Match whole words only' },
      { flag: '-E', summary: 'Extended regular expressions' },
      { flag: '-F', summary: 'Fixed strings, no regex at all' },
      { flag: '-A N, -B N, -C N', summary: 'Show N lines after, before, or around each match' },
      { flag: '--include=GLOB, --exclude-dir=GLOB', summary: 'Limit which files are searched' },
    ],
    examples: [
      { command: 'grep -rn "TODO" src/', summary: 'Every TODO with its file and line' },
      { command: 'grep -rn --exclude-dir=node_modules "useEffect" .', summary: 'Search a project, skipping dependencies' },
      { command: 'ps aux | grep -i postgres', summary: 'Filter another command’s output' },
    ],
    seeAlso: ['rg', 'ag', 'egrep', 'sed', 'awk', 'find'],
  }),
  cmd('egrep', 'Search', 'grep with extended regular expressions (now `grep -E`)', 'egrep [OPTION]... PATTERN [FILE]...', { seeAlso: ['grep'] }),
  cmd('fgrep', 'Search', 'grep for fixed strings (now `grep -F`)', 'fgrep [OPTION]... STRING [FILE]...', { seeAlso: ['grep'] }),
  cmd('zgrep', 'Search', 'grep inside compressed files', 'zgrep [OPTION]... PATTERN [FILE]...', { seeAlso: ['grep', 'zcat'] }),
  cmd('rg', 'Search', 'ripgrep -- a very fast recursive search that respects .gitignore', 'rg [OPTION]... PATTERN [PATH]...', {
    description: 'The default mode is recursive, and hidden and ignored files are skipped unless asked for. Tungsten uses ripgrep for workspace search when it is available.',
    options: [
      { flag: '-i', summary: 'Ignore case' },
      { flag: '-S', summary: 'Smart case: insensitive until the pattern has a capital' },
      { flag: '-t TYPE', summary: 'Only this file type, e.g. -t ts' },
      { flag: '-g GLOB', summary: 'Only paths matching a glob' },
      { flag: '-l', summary: 'Names of matching files only' },
      { flag: '--hidden, -u', summary: 'Include hidden and ignored files' },
      { flag: '-A N, -B N, -C N', summary: 'Context after, before, around' },
    ],
    examples: [{ command: 'rg -t ts "useBuilder" src', summary: 'Find a hook in TypeScript files only' }],
    seeAlso: ['grep', 'ag', 'fd', 'fzf'],
  }),
  cmd('ag', 'Search', 'The Silver Searcher -- a fast recursive code search', 'ag [OPTION]... PATTERN [PATH]...', { seeAlso: ['rg', 'grep'] }),
  cmd('sed', 'Text', 'Edit a stream of text by script', 'sed [OPTION]... SCRIPT [FILE]...', {
    description:
      'Reads a line, applies the script, prints the result. `s/old/new/` substitutes the first match on each line; adding `g` substitutes them all.',
    options: [
      { flag: '-i[SUFFIX]', summary: 'Edit files in place; a suffix keeps a backup' },
      { flag: '-E, -r', summary: 'Extended regular expressions' },
      { flag: '-n', summary: 'Do not print automatically -- pair with `p`' },
      { flag: '-e SCRIPT', summary: 'Add another script expression' },
    ],
    examples: [
      { command: "sed -i 's/localhost/127.0.0.1/g' config.ini", summary: 'Replace every occurrence, in place' },
      { command: "sed -n '10,20p' app.log", summary: 'Print just lines 10 to 20' },
      { command: "sed '/^#/d' config", summary: 'Strip comment lines' },
    ],
    danger: '-i rewrites the file with no backup unless you give the suffix.',
    seeAlso: ['awk', 'grep', 'tr', 'perl'],
  }),
  cmd('awk', 'Text', 'A pattern-action language for columnar text', 'awk [OPTION]... PROGRAM [FILE]...', {
    description:
      'Splits each line into fields: $1 is the first, $NF the last, $0 the whole line. A program is a list of `pattern { action }` pairs, with BEGIN and END blocks for setup and totals.',
    options: [
      { flag: "-F SEP", summary: 'Field separator, e.g. -F, for CSV' },
      { flag: '-v NAME=VALUE', summary: 'Pass a shell value into the program' },
    ],
    examples: [
      { command: "awk '{print $1, $NF}' access.log", summary: 'First and last column of every line' },
      { command: "awk -F: '$3 >= 1000 {print $1}' /etc/passwd", summary: 'Human accounts only' },
      { command: "awk '{sum += $2} END {print sum}' sizes.txt", summary: 'Total a column' },
    ],
    seeAlso: ['sed', 'cut', 'grep', 'perl', 'datamash'],
  }),
  cmd('cut', 'Text', 'Select columns from each line', 'cut OPTION... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-d DELIM', summary: 'Field delimiter' },
      { flag: '-f LIST', summary: 'Which fields to keep, e.g. 1,3-5' },
      { flag: '-c LIST', summary: 'Select by character position instead' },
      { flag: '--complement', summary: 'Keep everything except the selection' },
    ],
    examples: [{ command: 'cut -d: -f1 /etc/passwd', summary: 'Every username' }],
    seeAlso: ['awk', 'paste', 'column'],
  }),
  cmd('paste', 'Text', 'Join lines of files side by side', 'paste [OPTION]... [FILE]...', { from: 'coreutils', options: [{ flag: '-d DELIM', summary: 'Separator between columns' }], seeAlso: ['cut', 'join'] }),
  cmd('join', 'Text', 'Join two sorted files on a common field', 'join [OPTION]... FILE1 FILE2', { from: 'coreutils', seeAlso: ['sort', 'paste', 'comm'] }),
  cmd('comm', 'Text', 'Compare two sorted files line by line', 'comm [OPTION]... FILE1 FILE2', {
    from: 'coreutils',
    options: [{ flag: '-12', summary: 'Show only the lines both files share' }],
    seeAlso: ['diff', 'sort', 'uniq'],
  }),
  cmd('sort', 'Text', 'Sort lines of text', 'sort [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-n', summary: 'Numeric sort' },
      { flag: '-h', summary: 'Human numeric sort, understanding 2K and 3G' },
      { flag: '-r', summary: 'Reverse' },
      { flag: '-u', summary: 'Drop duplicates' },
      { flag: '-k N[,M]', summary: 'Sort on a field range' },
      { flag: '-t SEP', summary: 'Field separator' },
      { flag: '-V', summary: 'Version sort, so v10 comes after v9' },
    ],
    examples: [{ command: 'sort -k2 -n -r scores.txt', summary: 'Highest second column first' }],
    seeAlso: ['uniq', 'shuf', 'comm', 'awk'],
  }),
  cmd('uniq', 'Text', 'Report or drop repeated adjacent lines', 'uniq [OPTION]... [INPUT [OUTPUT]]', {
    from: 'coreutils',
    description: 'Only collapses neighbours, so it is almost always preceded by sort.',
    options: [
      { flag: '-c', summary: 'Prefix each line with its count' },
      { flag: '-d', summary: 'Only the lines that repeat' },
      { flag: '-u', summary: 'Only the lines that never repeat' },
      { flag: '-i', summary: 'Ignore case' },
    ],
    examples: [{ command: 'sort access.log | uniq -c | sort -rn | head', summary: 'The classic top-N-by-frequency pipeline' }],
    seeAlso: ['sort', 'wc', 'awk'],
  }),
  cmd('wc', 'Text', 'Count lines, words and bytes', 'wc [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [
      { flag: '-l', summary: 'Lines' },
      { flag: '-w', summary: 'Words' },
      { flag: '-c', summary: 'Bytes' },
      { flag: '-m', summary: 'Characters' },
    ],
    examples: [{ command: 'find src -name "*.ts" | wc -l', summary: 'How many TypeScript files there are' }],
    seeAlso: ['nl', 'grep', 'awk'],
  }),
  cmd('nl', 'Text', 'Number the lines of a file', 'nl [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['cat', 'wc'] }),
  cmd('tr', 'Text', 'Translate or delete characters', 'tr [OPTION]... SET1 [SET2]', {
    from: 'coreutils',
    options: [
      { flag: '-d', summary: 'Delete the characters in SET1' },
      { flag: '-s', summary: 'Squeeze runs of a character into one' },
      { flag: '-c', summary: 'Use the complement of SET1' },
    ],
    examples: [{ command: "tr 'A-Z' 'a-z' < names.txt", summary: 'Lowercase a file' }],
    seeAlso: ['sed', 'awk', 'iconv'],
  }),
  cmd('rev', 'Text', 'Reverse the characters of each line', 'rev [FILE]...', { seeAlso: ['tac', 'tr'] }),
  cmd('fmt', 'Text', 'Reflow text to a width', 'fmt [-WIDTH] [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['fold', 'par'] }),
  cmd('fold', 'Text', 'Wrap lines at a fixed width', 'fold [OPTION]... [FILE]...', { from: 'coreutils', options: [{ flag: '-w N', summary: 'Wrap at N columns' }, { flag: '-s', summary: 'Break at spaces' }], seeAlso: ['fmt'] }),
  cmd('column', 'Text', 'Format input into aligned columns', 'column [OPTION]... [FILE]...', {
    options: [{ flag: '-t', summary: 'Build a table' }, { flag: '-s SEP', summary: 'Input separator' }],
    examples: [{ command: 'cat /etc/passwd | column -t -s:', summary: 'Read a colon-separated file as a table' }],
    seeAlso: ['awk', 'paste'],
  }),
  cmd('expand', 'Text', 'Convert tabs to spaces', 'expand [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['unexpand', 'tr'] }),
  cmd('unexpand', 'Text', 'Convert spaces to tabs', 'unexpand [OPTION]... [FILE]...', { from: 'coreutils', seeAlso: ['expand'] }),
  cmd('shuf', 'Text', 'Shuffle lines at random', 'shuf [OPTION]... [FILE]', { from: 'coreutils', options: [{ flag: '-n N', summary: 'Output at most N lines' }], seeAlso: ['sort', 'head'] }),
  cmd('tee', 'Text', 'Copy standard input to a file and to standard output', 'tee [OPTION]... [FILE]...', {
    from: 'coreutils',
    options: [{ flag: '-a', summary: 'Append instead of truncating' }],
    examples: [{ command: 'npm run build 2>&1 | tee build.log', summary: 'Watch a build and keep the log' }],
    seeAlso: ['cat', 'sponge'],
  }),
  cmd('xargs', 'Text', 'Build and run command lines from standard input', 'xargs [OPTION]... [COMMAND [ARGUMENT]...]', {
    description:
      'Turns a list of words into arguments. Pair it with `find -print0` and `-0` so that paths with spaces survive.',
    options: [
      { flag: '-0', summary: 'Input is null-separated' },
      { flag: '-n N', summary: 'At most N arguments per command' },
      { flag: '-I {}', summary: 'Replace {} with each item, one run per item' },
      { flag: '-P N', summary: 'Run N commands in parallel' },
      { flag: '-r', summary: 'Do nothing if the input is empty' },
    ],
    examples: [
      { command: 'find . -name "*.log" -print0 | xargs -0 rm', summary: 'Delete matches safely, whatever the filenames' },
      { command: 'cat urls.txt | xargs -P 8 -n 1 curl -O', summary: 'Download eight files at a time' },
    ],
    seeAlso: ['find', 'parallel', 'tee'],
  }),
  cmd('parallel', 'Text', 'Run jobs in parallel from a list of inputs', 'parallel [OPTION]... COMMAND ::: ARGUMENTS', { seeAlso: ['xargs'] }),
  cmd('jq', 'Text', 'Query and transform JSON', 'jq [OPTION]... FILTER [FILE]...', {
    description: 'A filter language for JSON: `.` is the input, `.key` indexes it, `[]` iterates, and `|` chains just like the shell.',
    options: [
      { flag: '-r', summary: 'Raw output -- strings without quotes' },
      { flag: '-c', summary: 'Compact, one line per result' },
      { flag: '-e', summary: 'Exit non-zero when the result is null or false' },
    ],
    examples: [
      { command: "curl -s api/users | jq -r '.[].email'", summary: 'Pull one field out of a JSON array' },
      { command: "jq '.scripts | keys' package.json", summary: 'List the npm scripts' },
    ],
    seeAlso: ['yq', 'python3', 'curl'],
  }),
  cmd('yq', 'Text', 'Query and transform YAML with jq-style filters', 'yq [OPTION]... FILTER [FILE]...', { seeAlso: ['jq'] }),
  cmd('csvlook', 'Text', 'Render a CSV as a readable table', 'csvlook [OPTION]... [FILE]', { seeAlso: ['column', 'csvcut', 'miller'] }),
  cmd('csvcut', 'Text', 'Select columns from a CSV by name', 'csvcut [OPTION]... [FILE]', { seeAlso: ['cut', 'csvlook'] }),
  cmd('mlr', 'Text', 'Miller -- process CSV, TSV and JSON records like awk does lines', 'mlr [OPTION]... VERB [FILE]...', { aliases: ['miller'], seeAlso: ['awk', 'jq'] }),
  cmd('iconv', 'Text', 'Convert text between character encodings', 'iconv -f FROM -t TO [FILE]', {
    examples: [{ command: 'iconv -f latin1 -t utf-8 old.txt > new.txt', summary: 'Repair a legacy encoding' }],
    seeAlso: ['file', 'tr', 'dos2unix'],
  }),
  cmd('dos2unix', 'Text', 'Convert CRLF line endings to LF', 'dos2unix [OPTION]... [FILE]...', { seeAlso: ['unix2dos', 'tr', 'iconv'] }),
  cmd('unix2dos', 'Text', 'Convert LF line endings to CRLF', 'unix2dos [OPTION]... [FILE]...', { seeAlso: ['dos2unix'] }),
  cmd('base64', 'Text', 'Encode or decode base64', 'base64 [OPTION]... [FILE]', { from: 'coreutils', options: [{ flag: '-d', summary: 'Decode' }, { flag: '-w0', summary: 'Do not wrap the output' }], seeAlso: ['openssl', 'xxd'] }),
  cmd('seq', 'Text', 'Print a sequence of numbers', 'seq [OPTION]... FIRST [INCREMENT] LAST', {
    from: 'coreutils',
    examples: [{ command: 'seq -w 1 10', summary: 'Zero-padded one to ten' }],
    seeAlso: ['for', 'shuf', 'printf'],
  }),
  cmd('expr', 'Text', 'Evaluate an expression', 'expr EXPRESSION', { from: 'coreutils', seeAlso: ['let', 'bc', 'awk'] }),
  cmd('bc', 'Text', 'An arbitrary-precision calculator language', 'bc [OPTION]... [FILE]...', {
    options: [{ flag: '-l', summary: 'Load the math library and default to 20 decimal places' }],
    examples: [{ command: 'echo "scale=4; 22/7" | bc', summary: 'Divide with four decimal places' }],
    seeAlso: ['awk', 'expr', 'dc'],
  }),
  cmd('dc', 'Text', 'A reverse-polish desk calculator', 'dc [OPTION]... [FILE]...', { seeAlso: ['bc'] }),
  cmd('find', 'Search', 'Search a directory tree for files matching tests', 'find [PATH]... [EXPRESSION]', {
    description:
      'Walks the tree and evaluates tests against each entry. `-exec ... {} +` batches matches into as few commands as possible; `-exec ... {} \\;` runs one per file.',
    options: [
      { flag: '-name PATTERN', summary: 'Match the filename by glob (quote it)' },
      { flag: '-iname PATTERN', summary: 'The same, case-insensitively' },
      { flag: '-type f|d|l', summary: 'Files, directories or symlinks' },
      { flag: '-mtime N, -mmin N', summary: 'Modified N days or minutes ago' },
      { flag: '-size N', summary: 'Size, with +/- and a unit: +100M' },
      { flag: '-maxdepth N', summary: 'Do not descend deeper than N' },
      { flag: '-delete', summary: 'Delete the matches' },
      { flag: '-exec CMD {} +', summary: 'Run a command over the matches' },
      { flag: '-print0', summary: 'Null-separate the output, for xargs -0' },
    ],
    examples: [
      { command: 'find . -name "*.tmp" -delete', summary: 'Clean up temporary files' },
      { command: 'find /var/log -type f -mtime +30 -size +10M', summary: 'Big old logs' },
      { command: 'find src -name "*.ts" -exec wc -l {} +', summary: 'Line counts for a whole tree' },
    ],
    danger: '-delete and -exec rm act on everything that matched. Run the same expression without them first.',
    seeAlso: ['fd', 'locate', 'grep', 'xargs', 'tree'],
  }),
  cmd('fd', 'Search', 'A friendly, fast alternative to find', 'fd [OPTION]... [PATTERN] [PATH]...', {
    options: [
      { flag: '-e EXT', summary: 'Filter by extension' },
      { flag: '-H', summary: 'Include hidden files' },
      { flag: '-x CMD', summary: 'Run a command per match, in parallel' },
    ],
    examples: [{ command: 'fd -e ts useBuilder src', summary: 'Find TypeScript files by name' }],
    seeAlso: ['find', 'rg'],
  }),
  cmd('locate', 'Search', 'Find files by name in a prebuilt index', 'locate [OPTION]... PATTERN...', { seeAlso: ['updatedb', 'find', 'which'] }),
  cmd('updatedb', 'Search', 'Rebuild the index that locate searches', 'updatedb [OPTION]...', { seeAlso: ['locate'] }),
  cmd('which', 'Search', 'Show which file on PATH a command resolves to', 'which [OPTION]... COMMAND...', { seeAlso: ['type', 'whereis', 'command'] }),
  cmd('whereis', 'Search', 'Locate the binary, source and manual for a command', 'whereis [OPTION]... NAME...', { seeAlso: ['which', 'locate'] }),
  cmd('fzf', 'Search', 'Filter any list interactively by fuzzy matching', 'fzf [OPTION]...', {
    examples: [{ command: 'vim "$(fzf)"', summary: 'Pick a file to edit by typing a few letters' }],
    seeAlso: ['rg', 'fd', 'peco'],
  }),
  cmd('man', 'Search', 'Read the manual page for a command', 'man [SECTION] PAGE', {
    options: [
      { flag: '-k KEYWORD', summary: 'Search the manual summaries (same as apropos)' },
      { flag: '-f NAME', summary: 'Show the one-line description (same as whatis)' },
    ],
    seeAlso: ['apropos', 'whatis', 'info', 'tldr', 'help'],
  }),
  cmd('apropos', 'Search', 'Search the manual page descriptions by keyword', 'apropos KEYWORD...', { seeAlso: ['man', 'whatis'] }),
  cmd('whatis', 'Search', 'Print the one-line description of a command', 'whatis NAME...', { seeAlso: ['man', 'apropos'] }),
  cmd('info', 'Search', 'Read GNU info documentation', 'info [OPTION]... [MENU-ITEM]...', { seeAlso: ['man'] }),
  cmd('tldr', 'Search', 'Show community examples instead of a full manual page', 'tldr [OPTION]... COMMAND', { seeAlso: ['man', 'cheat'] }),
  cmd('cheat', 'Search', 'Show and edit personal cheat sheets for commands', 'cheat [OPTION]... COMMAND', { seeAlso: ['tldr', 'man'] }),
]
