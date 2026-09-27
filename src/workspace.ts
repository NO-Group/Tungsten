export type WorkspaceFile = {
  path: string
  content: string
  language: string
}

export const defaultFiles: WorkspaceFile[] = [
  {
    path: 'README.md',
    language: 'markdown',
    content: `# Forge / starter

A small, zero-dependency product page built inside **Tungsten**.

## Commands

\`\`\`sh
npm run dev
npm run build
\`\`\`

Open \`src/main.js\` and press **Ctrl + Enter** to launch the live preview.
`,
  },
  {
    path: 'index.html',
    language: 'html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge — Ship better work</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main class="shell">
      <nav>
        <a class="mark" href="#">F/01</a>
        <div class="nav-links"><a href="#work">Work</a><a href="#about">About</a></div>
      </nav>

      <section class="hero">
        <p class="eyebrow">INDEPENDENT DIGITAL STUDIO · ABUJA</p>
        <h1>We forge ideas<br />into <em>impact.</em></h1>
        <p class="intro">Strategy, identity and digital products for teams building what comes next.</p>
        <button id="start-button">Start a project <span>↗</span></button>
      </section>

      <footer><span>Selected work / 2026</span><span id="clock">00:00:00 WAT</span></footer>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  },
  {
    path: 'package.json',
    language: 'json',
    content: `{
  "name": "forge-starter",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "latest"
  }
}
`,
  },
  {
    path: 'src/main.js',
    language: 'javascript',
    content: `import { formatTime } from './utils/time.js'

const clock = document.querySelector('#clock')
const startButton = document.querySelector('#start-button')

function tick() {
  clock.textContent = \`\${formatTime(new Date())} WAT\`
}

startButton.addEventListener('click', () => {
  startButton.innerHTML = 'Brief received <span>✓</span>'
  document.body.dataset.started = 'true'
})

tick()
setInterval(tick, 1000)
`,
  },
  {
    path: 'src/styles.css',
    language: 'css',
    content: `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap');

:root { color-scheme: dark; font-family: 'DM Sans', sans-serif; background: #0d0d0d; color: #f2f1eb; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #0d0d0d; transition: background .4s ease; }
body[data-started='true'] { background: #161c0a; }
a { color: inherit; text-decoration: none; }
.shell { min-height: 100vh; padding: 28px 36px; display: flex; flex-direction: column; }
nav, footer { display: flex; justify-content: space-between; align-items: center; }
.mark { width: 48px; height: 48px; border: 1px solid #444; display: grid; place-items: center; font-size: 12px; }
.nav-links { display: flex; gap: 32px; font-size: 14px; }
.hero { margin: auto 0; padding: 80px 0; }
.eyebrow { color: #a9ff5c; font-size: 11px; letter-spacing: .2em; margin: 0 0 24px; }
h1 { font-family: 'Instrument Serif', Georgia, serif; font-size: clamp(64px, 11vw, 154px); line-height: .8; letter-spacing: -.045em; font-weight: 400; margin: 0; }
h1 em { color: #a9ff5c; font-weight: 400; }
.intro { color: #aaa; font-size: 18px; line-height: 1.55; max-width: 480px; margin: 42px 0 28px; }
button { border: 0; background: #a9ff5c; color: #111; font: 600 14px inherit; padding: 16px 20px; cursor: pointer; }
button span { margin-left: 28px; }
footer { border-top: 1px solid #292929; padding-top: 22px; color: #777; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
@media (max-width: 640px) { .shell { padding: 20px; } h1 { font-size: 62px; } .nav-links { gap: 16px; } }
`,
  },
  {
    path: 'src/utils/time.js',
    language: 'javascript',
    content: `export function formatTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}
`,
  },
  {
    path: '.gitignore',
    language: 'plaintext',
    content: `node_modules
dist
.env
.DS_Store
`,
  },
]

export const fileName = (path: string) => path.split('/').pop() ?? path

const languageByExtension: Record<string, string> = {
  astro: 'html', bat: 'bat', c: 'c', cc: 'cpp', clj: 'clojure', cljs: 'clojure',
  coffee: 'coffeescript', conf: 'ini', cpp: 'cpp', cs: 'csharp', css: 'css',
  dart: 'dart', ex: 'elixir', exs: 'elixir', fs: 'fsharp', fsx: 'fsharp', go: 'go',
  gql: 'graphql', graphql: 'graphql', h: 'cpp', handlebars: 'handlebars', hbs: 'handlebars',
  hpp: 'cpp', html: 'html', ini: 'ini', ipynb: 'json', java: 'java', jl: 'julia',
  js: 'javascript', jsx: 'javascript', json: 'json', jsonc: 'json', kt: 'kotlin',
  kts: 'kotlin', less: 'less', lua: 'lua', m: 'objective-c', md: 'markdown',
  mdx: 'mdx', mjs: 'javascript', mm: 'objective-c', pas: 'pascal', php: 'php',
  pl: 'perl', pm: 'perl', properties: 'ini', proto: 'protobuf', ps1: 'powershell',
  pug: 'pug', py: 'python', r: 'r', razor: 'razor', rb: 'ruby', rs: 'rust',
  sass: 'scss', scala: 'scala', scss: 'scss', sh: 'shell', sol: 'solidity',
  sql: 'sql', svelte: 'html', svg: 'xml', swift: 'swift', tf: 'hcl', tfvars: 'hcl',
  toml: 'ini', ts: 'typescript', tsx: 'typescript', txt: 'plaintext', vue: 'html',
  xml: 'xml', yaml: 'yaml', yml: 'yaml', zig: 'plaintext',
}

export const supportedLanguages = [
  'JavaScript', 'TypeScript', 'Python', 'Rust', 'Go', 'Java', 'C', 'C++', 'C#',
  'PHP', 'Ruby', 'Kotlin', 'Swift', 'Dart', 'Lua', 'Shell', 'PowerShell', 'SQL',
  'HTML', 'CSS', 'Sass', 'Less', 'JSON', 'YAML', 'XML', 'Markdown', 'GraphQL',
  'Dockerfile', 'Terraform', 'Elixir', 'F#', 'Scala', 'R', 'Perl', 'Julia',
  'Solidity', 'Clojure', 'Pascal', 'Objective-C', 'Handlebars', 'Vue', 'Svelte',
]

export const languageForPath = (path: string) => {
  const name = fileName(path)
  if (name === 'Dockerfile' || name === 'Containerfile') return 'dockerfile'
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : ''
  return languageByExtension[extension] || 'plaintext'
}

export const fileIconClass = (path: string) => {
  const language = languageForPath(path)
  const name = fileName(path)
  if (name === 'package.json') return 'npm'
  if (['javascript'].includes(language)) return 'js'
  if (language === 'typescript') return 'ts'
  if (['css', 'scss', 'less'].includes(language)) return 'css'
  if (['html', 'handlebars', 'pug'].includes(language)) return 'html'
  if (['json', 'yaml', 'ini'].includes(language)) return 'data'
  if (language === 'markdown' || language === 'mdx') return 'md'
  if (['python', 'ruby', 'php', 'perl', 'r', 'julia'].includes(language)) return 'script'
  if (['rust', 'go', 'java', 'kotlin', 'swift', 'dart', 'scala', 'c', 'cpp', 'csharp'].includes(language)) return 'native'
  if (['shell', 'powershell', 'bat'].includes(language)) return 'shell'
  if (['sql', 'graphql', 'hcl'].includes(language)) return 'query'
  if (language === 'dockerfile') return 'docker'
  return 'file'
}

/** A symbol discovered in a document, with the 1-based line it declares on. */
export type DocumentSymbol = {
  /** Symbol kind, used to pick an icon. */
  type: 'function' | 'method' | 'class' | 'interface' | 'enum' | 'struct' | 'variable' | 'constant' | 'property' | 'html' | 'symbol'
  label: string
  line: number
  /** Nesting depth, derived from leading indentation. */
  depth: number
}

/** Map a captured declaration keyword to a symbol kind. */
function symbolKindFor(keyword: string): DocumentSymbol['type'] {
  switch (keyword) {
    case 'class': return 'class'
    case 'interface': return 'interface'
    case 'enum': return 'enum'
    case 'struct': case 'impl': case 'trait': return 'struct'
    case 'const': return 'constant'
    case 'let': case 'var': return 'variable'
    case 'type': return 'interface'
    default: return 'function'
  }
}

/**
 * Extract an outline from a document.
 *
 * This is a lightweight lexical scan rather than a parse: it runs instantly on
 * every keystroke and works for files whose language server is unavailable. When
 * an LSP is attached the editor's own symbol provider supersedes it.
 */
export const symbolsFor = (file?: WorkspaceFile): DocumentSymbol[] => {
  if (!file) return []
  const lines = file.content.split('\n')
  const symbols: DocumentSymbol[] = []
  const depthOf = (line: string) => Math.floor((line.match(/^[\t ]*/)?.[0].replace(/\t/g, '  ').length || 0) / 2)

  if (['css', 'scss', 'less'].includes(file.language)) {
    lines.forEach((line, index) => {
      const match = line.match(/^\s*([^@{}\n][^{\n]*?)\s*\{\s*$/)
      if (match) symbols.push({ type: 'class', label: match[1].trim().split(',')[0], line: index + 1, depth: depthOf(line) })
    })
    return symbols.slice(0, 400)
  }

  if (['html', 'handlebars', 'xml', 'vue', 'svelte'].includes(file.language)) {
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/<(main|nav|section|article|aside|header|footer|form|template|script|style|h[1-6])(?:\s[^>]*)?>/g)) {
        const id = line.match(/\bid=["']([^"']+)["']/)?.[1]
        symbols.push({ type: 'html', label: id ? `${match[1]}#${id}` : match[1], line: index + 1, depth: depthOf(line) })
      }
    })
    return symbols.slice(0, 400)
  }

  if (['markdown', 'mdx'].includes(file.language)) {
    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
      if (match) symbols.push({ type: 'symbol', label: match[2], line: index + 1, depth: match[1].length - 1 })
    })
    return symbols.slice(0, 400)
  }

  if (['json', 'jsonc'].includes(file.language)) {
    lines.forEach((line, index) => {
      const match = line.match(/^\s*"([^"]+)"\s*:\s*[[{]/)
      if (match) symbols.push({ type: 'property', label: match[1], line: index + 1, depth: depthOf(line) })
    })
    return symbols.slice(0, 400)
  }

  if (['yaml', 'yml'].includes(file.language)) {
    lines.forEach((line, index) => {
      const match = line.match(/^(\s*)([\w.-]+):\s*$/)
      if (match) symbols.push({ type: 'property', label: match[2], line: index + 1, depth: Math.floor(match[1].length / 2) })
    })
    return symbols.slice(0, 400)
  }

  // General-purpose declaration scan covering the C-like and scripting families.
  const declaration = /\b(function|class|interface|enum|struct|impl|trait|def|fn|func|type)\s+([A-Za-z_$][\w$]*)/
  const assigned = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\b|class\b)/
  const binding = /^\s*(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/
  const method = /^\s*(?:public|private|protected|static|async|readonly|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/

  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|#)/.test(line)) return
    const depth = depthOf(line)

    const declarationMatch = line.match(declaration)
    if (declarationMatch) {
      symbols.push({ type: symbolKindFor(declarationMatch[1]), label: declarationMatch[2], line: index + 1, depth })
      return
    }
    const assignedMatch = line.match(assigned)
    if (assignedMatch) {
      symbols.push({ type: 'function', label: assignedMatch[2], line: index + 1, depth })
      return
    }
    const bindingMatch = line.match(binding)
    if (bindingMatch) {
      symbols.push({ type: symbolKindFor(bindingMatch[1]), label: bindingMatch[2], line: index + 1, depth })
      return
    }
    const methodMatch = line.match(method)
    if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try'].includes(methodMatch[1])) {
      symbols.push({ type: 'method', label: methodMatch[1], line: index + 1, depth })
    }
  })

  return symbols.slice(0, 400)
}

/**
 * Virtual path for the built-in live preview editor.
 *
 * It is not a real file, so every code path that reads or writes the workspace
 * has to recognise it. Keeping the constant here rather than in the renderer
 * means the tab strip, the editor group model and the save logic all agree on
 * what it is.
 */
export const PREVIEW_PATH = '$preview'

/** A node in the explorer tree: either a folder with children or a file. */
export type TreeNode = {
  name: string
  path: string
  folder: boolean
  children: TreeNode[]
}

/**
 * Folds a flat list of workspace paths into the nested tree the explorer
 * renders. Folders sort before files and both sort alphabetically, which is
 * the ordering every file explorer has trained people to expect.
 */
export function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = []

  files.forEach((file) => {
    const parts = file.path.split('/')
    let children = root
    let current = ''

    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part
      const isFolder = index < parts.length - 1
      let node = children.find((item) => item.name === part && item.folder === isFolder)
      if (!node) {
        node = { name: part, path: current, folder: isFolder, children: [] }
        children.push(node)
      }
      children = node.children
    })
  })

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
    nodes.forEach((node) => sort(node.children))
  }
  sort(root)
  return root
}
