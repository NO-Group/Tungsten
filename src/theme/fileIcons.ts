/**
 * File icon theme, following the structure of VS Code's `seti` icon theme:
 * a mapping from file extension / exact filename / language to an icon
 * definition, with a default fallback and separate folder icons.
 *
 * Icons are drawn as a short glyph plus a colour rather than shipping an icon
 * font, which keeps the bundle small while still giving every common file type
 * a distinct, recognisable appearance.
 */

export interface FileIcon {
  /** 1-3 characters rendered in the icon slot. */
  glyph: string
  /** Colour token; resolved against the active theme's palette. */
  color: string
  /** Optional label used for accessibility. */
  label?: string
}

/** Seti-style hues, expressed as theme-independent identity colours. */
export const iconColors = {
  blue: '#519aba',
  green: '#8dc149',
  orange: '#e37933',
  yellow: '#cbcb41',
  red: '#cc3e44',
  purple: '#a074c4',
  pink: '#f55385',
  grey: '#6d8086',
  white: '#d4d7d6',
  cyan: '#4dc3d1',
} as const

const icon = (glyph: string, color: string, label?: string): FileIcon => ({ glyph, color, label })

/** Exact filenames win over extensions, as in VS Code's icon themes. */
const byFileName: Record<string, FileIcon> = {
  'package.json': icon('npm', iconColors.red, 'npm manifest'),
  'package-lock.json': icon('npm', iconColors.grey),
  'tsconfig.json': icon('TS', iconColors.blue),
  'jsconfig.json': icon('JS', iconColors.yellow),
  'vite.config.ts': icon('V', iconColors.purple),
  'vite.config.js': icon('V', iconColors.purple),
  'webpack.config.js': icon('W', iconColors.blue),
  'rollup.config.js': icon('R', iconColors.red),
  'dockerfile': icon('do', iconColors.blue, 'Docker'),
  'docker-compose.yml': icon('do', iconColors.blue),
  '.gitignore': icon('git', iconColors.orange),
  '.gitattributes': icon('git', iconColors.orange),
  '.editorconfig': icon('ec', iconColors.grey),
  '.eslintrc': icon('es', iconColors.purple),
  '.eslintrc.json': icon('es', iconColors.purple),
  '.eslintrc.cjs': icon('es', iconColors.purple),
  'eslint.config.js': icon('es', iconColors.purple),
  '.prettierrc': icon('pr', iconColors.pink),
  'readme.md': icon('i', iconColors.blue, 'Readme'),
  'license': icon('§', iconColors.yellow),
  'makefile': icon('mk', iconColors.orange),
  'cargo.toml': icon('rs', iconColors.orange),
  'cargo.lock': icon('rs', iconColors.grey),
  'go.mod': icon('go', iconColors.cyan),
  'go.sum': icon('go', iconColors.grey),
  'requirements.txt': icon('py', iconColors.yellow),
  'pyproject.toml': icon('py', iconColors.yellow),
  'gemfile': icon('rb', iconColors.red),
  '.env': icon('env', iconColors.yellow),
  '.env.local': icon('env', iconColors.yellow),
}

/** Extension mapping, the main lookup. */
const byExtension: Record<string, FileIcon> = {
  ts: icon('TS', iconColors.blue, 'TypeScript'),
  tsx: icon('TSX', iconColors.blue, 'TypeScript React'),
  js: icon('JS', iconColors.yellow, 'JavaScript'),
  jsx: icon('JSX', iconColors.yellow, 'JavaScript React'),
  mjs: icon('JS', iconColors.yellow),
  cjs: icon('JS', iconColors.yellow),
  json: icon('{}', iconColors.yellow, 'JSON'),
  jsonc: icon('{}', iconColors.yellow),

  html: icon('<>', iconColors.orange, 'HTML'),
  htm: icon('<>', iconColors.orange),
  css: icon('#', iconColors.blue, 'CSS'),
  scss: icon('#', iconColors.pink, 'Sass'),
  sass: icon('#', iconColors.pink),
  less: icon('#', iconColors.blue),

  md: icon('M', iconColors.blue, 'Markdown'),
  mdx: icon('M', iconColors.blue),
  txt: icon('¶', iconColors.grey, 'Plain text'),
  rst: icon('¶', iconColors.grey),

  py: icon('py', iconColors.yellow, 'Python'),
  rb: icon('rb', iconColors.red, 'Ruby'),
  rs: icon('rs', iconColors.orange, 'Rust'),
  go: icon('go', iconColors.cyan, 'Go'),
  java: icon('J', iconColors.red, 'Java'),
  kt: icon('kt', iconColors.purple, 'Kotlin'),
  swift: icon('sw', iconColors.orange, 'Swift'),
  c: icon('C', iconColors.blue, 'C'),
  h: icon('H', iconColors.purple),
  cpp: icon('C+', iconColors.blue, 'C++'),
  cc: icon('C+', iconColors.blue),
  hpp: icon('H+', iconColors.purple),
  cs: icon('C#', iconColors.green, 'C#'),
  php: icon('php', iconColors.purple, 'PHP'),
  lua: icon('lua', iconColors.blue),
  r: icon('R', iconColors.blue),
  scala: icon('sc', iconColors.red),
  dart: icon('dt', iconColors.cyan),
  ex: icon('ex', iconColors.purple, 'Elixir'),
  exs: icon('ex', iconColors.purple),
  hs: icon('hs', iconColors.purple, 'Haskell'),
  clj: icon('clj', iconColors.green),
  zig: icon('zig', iconColors.orange),

  sh: icon('$', iconColors.green, 'Shell'),
  bash: icon('$', iconColors.green),
  zsh: icon('$', iconColors.green),
  fish: icon('$', iconColors.green),
  ps1: icon('>', iconColors.blue, 'PowerShell'),

  yml: icon('y', iconColors.pink, 'YAML'),
  yaml: icon('y', iconColors.pink),
  toml: icon('t', iconColors.orange, 'TOML'),
  ini: icon('i', iconColors.grey),
  xml: icon('<>', iconColors.orange),
  csv: icon('csv', iconColors.green),
  sql: icon('sql', iconColors.pink, 'SQL'),
  graphql: icon('gql', iconColors.pink),
  gql: icon('gql', iconColors.pink),
  proto: icon('pb', iconColors.blue),

  png: icon('▣', iconColors.purple, 'Image'),
  jpg: icon('▣', iconColors.purple),
  jpeg: icon('▣', iconColors.purple),
  gif: icon('▣', iconColors.purple),
  webp: icon('▣', iconColors.purple),
  svg: icon('▨', iconColors.yellow, 'Vector image'),
  ico: icon('▣', iconColors.blue),

  pdf: icon('pdf', iconColors.red),
  zip: icon('▤', iconColors.grey, 'Archive'),
  tar: icon('▤', iconColors.grey),
  gz: icon('▤', iconColors.grey),

  lock: icon('🔒', iconColors.grey),
  log: icon('log', iconColors.grey),
  diff: icon('±', iconColors.orange, 'Diff'),
  patch: icon('±', iconColors.orange),
  merge: icon('⑂', iconColors.red, 'Merge conflict'),
  test: icon('✓', iconColors.green),
  wasm: icon('wa', iconColors.purple),
  vue: icon('V', iconColors.green, 'Vue'),
  svelte: icon('S', iconColors.orange, 'Svelte'),
  astro: icon('A', iconColors.orange),
}

export const defaultFileIcon: FileIcon = icon('·', iconColors.grey, 'File')
export const folderIcon: FileIcon = icon('▸', iconColors.blue, 'Folder')
export const folderOpenIcon: FileIcon = icon('▾', iconColors.blue, 'Open folder')

/** Folders that get a recognisable colour, as Seti does. */
const byFolderName: Record<string, string> = {
  src: iconColors.blue,
  source: iconColors.blue,
  test: iconColors.green,
  tests: iconColors.green,
  __tests__: iconColors.green,
  spec: iconColors.green,
  dist: iconColors.grey,
  build: iconColors.grey,
  out: iconColors.grey,
  node_modules: iconColors.grey,
  '.git': iconColors.orange,
  '.github': iconColors.grey,
  public: iconColors.orange,
  assets: iconColors.purple,
  images: iconColors.purple,
  docs: iconColors.blue,
  scripts: iconColors.yellow,
  config: iconColors.yellow,
  components: iconColors.cyan,
  styles: iconColors.pink,
  hooks: iconColors.cyan,
  utils: iconColors.yellow,
  lib: iconColors.yellow,
  api: iconColors.green,
}

/** Resolves the icon for a file path. */
export function fileIconFor(path: string): FileIcon {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase()

  const exact = byFileName[name]
  if (exact) return exact

  // Compound extensions such as `app.test.ts` prefer the more specific match.
  const parts = name.split('.')
  if (parts.length > 2) {
    const compound = parts.slice(-2).join('.')
    if (compound.startsWith('test.') || compound.startsWith('spec.')) {
      const base = byExtension[parts[parts.length - 1]]
      if (base) return { ...base, glyph: '✓', color: iconColors.green }
    }
  }

  const extension = parts.length > 1 ? parts[parts.length - 1] : ''
  return byExtension[extension] ?? defaultFileIcon
}

/** Resolves the icon for a folder, honouring the open/closed state. */
export function folderIconFor(name: string, open = false): FileIcon {
  const color = byFolderName[name.toLowerCase()] ?? iconColors.blue
  return { ...(open ? folderOpenIcon : folderIcon), color }
}

/** Every extension the theme knows, for tests and documentation. */
export function knownExtensions(): string[] {
  return Object.keys(byExtension).sort()
}

export function knownFileNames(): string[] {
  return Object.keys(byFileName).sort()
}
