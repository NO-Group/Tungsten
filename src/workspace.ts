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

export const symbolsFor = (file?: WorkspaceFile) => {
  if (!file) return []
  if (['css', 'scss', 'less'].includes(file.language)) {
    return [...file.content.matchAll(/(?:^|\n)([^@\n][^{\n]+)\s*\{/g)].slice(0, 10).map((match) => ({
      type: 'class',
      label: match[1].trim().split(',')[0],
    }))
  }
  if (['html', 'handlebars'].includes(file.language)) {
    return [...file.content.matchAll(/<(main|nav|section|article|header|footer|form|h[1-6])(?:\s[^>]*)?>/g)].slice(0, 10).map((match) => ({
      type: 'html',
      label: match[1],
    }))
  }
  const expression = /(?:function|class|interface|enum|struct|def|fn|func)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  return [...file.content.matchAll(expression)].slice(0, 12).map((match) => ({
    type: /function|def|fn|func/.test(match[0]) ? 'function' : 'symbol',
    label: match[1] || match[2],
  }))
}
