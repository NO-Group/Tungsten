#!/usr/bin/env node
/**
 * Tungsten fork builder.
 *
 * Produces a rebranded, Graphene-themed VS Code from a pinned upstream commit.
 * This is the model every shipping VS Code fork uses (VSCodium, Cursor,
 * Windsurf): upstream is fetched at a pin and transformed by a checked-in
 * patch and branding layer, rather than being vendored into this repository.
 *
 * That is not a shortcut. Upstream is 19,443 files / 266 MB; vendoring it
 * would bury the ~2,000 lines that actually constitute the fork, and every
 * upstream bump would become an unreviewable diff. Keeping only the delta
 * means `git log` here shows exactly what Tungsten changes about VS Code.
 *
 * Stages:
 *   fetch   clone upstream at the pinned commit
 *   brand   deep-merge the product.json overlay, rewrite package.json identity
 *   theme   install Graphene as a built-in theme extension and default it
 *   shell   splice the Graphene workbench stylesheet into the chrome
 *   verify  assert every transformation actually landed
 *
 * Usage:
 *   node scripts/fork-vscode.mjs                 # fetch + brand + theme + verify
 *   node scripts/fork-vscode.mjs --stage verify  # re-check an existing tree
 *   node scripts/fork-vscode.mjs --full          # full checkout, needed to build
 *   node scripts/fork-vscode.mjs --dir /path     # where the fork tree lives
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGrapheneTheme, validateTheme } from '../fork/graphene/buildTheme.mjs'
import { buildWorkbenchCss, injectInto, validateCss, BEGIN_MARKER } from '../fork/graphene/buildWorkbenchCss.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(resolve(root, 'fork/upstream.json'), 'utf8'))

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index > -1 ? argv[index + 1] : fallback
}
const has = (name) => argv.includes(name)

const forkDir = resolve(flag('--dir', process.env.TUNGSTEN_FORK_DIR || '/tmp/tungsten-fork'))
const stage = flag('--stage', 'all')
const wantFull = has('--full')

const log = (message) => console.log(message)
const step = (message) => console.log(`\n\u001b[1m${message}\u001b[0m`)

function git(args, cwd = forkDir) {
  // maxBuffer: a VS Code-sized fetch/ls-files easily exceeds the 1 MB default.
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** For long operations, stream git's progress straight to the terminal. */
function gitLive(args, cwd = forkDir) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
}

/** Count files actually on disk, ignoring git's own metadata. */
function countFiles(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    total += entry.isDirectory() ? countFiles(resolve(dir, entry.name)) : 1
  }
  return total
}

/* ------------------------------------------------------------------ *
 * fetch
 * ------------------------------------------------------------------ */

/**
 * Files the branding and theme stages touch. A sparse checkout of just these
 * turns a 266 MB clone into a few hundred kilobytes, which is all that is
 * needed unless you are actually compiling. `--full` widens it.
 */
const SPARSE_PATHS = [
  '/product.json',
  '/package.json',
  '/.npmrc',
  '/build',
  '/resources',
  '/extensions/theme-defaults',
  '/src/vs/workbench/browser/media',
]

function stageFetch() {
  step(`fetch — microsoft/vscode @ ${pin.commit.slice(0, 12)} (${pin.tag})`)

  if (existsSync(resolve(forkDir, '.git'))) {
    const current = git(['rev-parse', 'HEAD']).trim()
    if (current === pin.commit) {
      log(`  already at the pinned commit, reusing ${forkDir}`)
      return
    }
    log('  pin changed, re-cloning')
    rmSync(forkDir, { recursive: true, force: true })
  }

  mkdirSync(forkDir, { recursive: true })
  git(['init', '-q'], forkDir)
  git(['remote', 'add', 'origin', pin.repository], forkDir)

  if (!wantFull) {
    git(['config', 'core.sparseCheckout', 'true'], forkDir)
    git(['sparse-checkout', 'init', '--no-cone'], forkDir)
    writeFileSync(resolve(forkDir, '.git/info/sparse-checkout'), `${SPARSE_PATHS.join('\n')}\n`)
  }

  log(`  fetching (${wantFull ? 'full tree' : 'sparse'})…`)
  gitLive(['fetch', '--depth', '1', '--filter=blob:none', 'origin', pin.commit], forkDir)
  gitLive(['checkout', 'FETCH_HEAD'], forkDir)

  const tracked = git(['ls-files']).split('\n').filter(Boolean).length
  const present = countFiles(forkDir)
  log(`  ${forkDir}: ${present} of ${tracked} upstream files materialised${wantFull ? '' : ' (sparse)'}`)
}

/* ------------------------------------------------------------------ *
 * brand
 * ------------------------------------------------------------------ */

/** Deep merge, with `null` meaning "remove this key". */
function deepMerge(base, overlay) {
  const out = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith('_comment')) continue
    if (value === null) {
      delete out[key]
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)
      && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value)
      continue
    }
    out[key] = value
  }
  return out
}

function stageBrand() {
  step('brand — applying Graphene/Tungsten identity')

  const productPath = resolve(forkDir, 'product.json')
  if (!existsSync(productPath)) throw new Error('product.json missing; run the fetch stage first')

  const upstream = JSON.parse(readFileSync(productPath, 'utf8'))
  const overlay = JSON.parse(readFileSync(resolve(root, 'fork/branding/product.overlay.json'), 'utf8'))
  const merged = deepMerge(upstream, overlay)
  writeFileSync(productPath, `${JSON.stringify(merged, null, '\t')}\n`)
  log(`  product.json — ${Object.keys(overlay).filter((k) => !k.startsWith('_comment')).length} keys overlaid`)

  // Identity in package.json drives the built artefact's name and version.
  const packagePath = resolve(forkDir, 'package.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const tungsten = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  pkg.name = 'tungsten'
  pkg.version = tungsten.version
  pkg.author = { name: 'NO-Group' }
  pkg.repository = { type: 'git', url: 'https://github.com/NO-Group/Tungsten.git' }
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, '\t')}\n`)
  log(`  package.json — tungsten@${pkg.version} (upstream VS Code ${upstream.version ?? pin.tag})`)
}

/* ------------------------------------------------------------------ *
 * theme
 * ------------------------------------------------------------------ */

function stageTheme() {
  step('theme — installing Graphene as a built-in extension')

  const theme = buildGrapheneTheme()
  const issues = validateTheme(theme)
  if (issues.length > 0) {
    for (const issue of issues) console.error(`  ! ${issue}`)
    throw new Error(`Graphene theme failed validation with ${issues.length} issue(s)`)
  }

  const extensionDir = resolve(forkDir, 'extensions/theme-graphene')
  mkdirSync(resolve(extensionDir, 'themes'), { recursive: true })

  writeFileSync(resolve(extensionDir, 'package.json'), `${JSON.stringify({
    name: 'theme-graphene',
    displayName: 'Graphene Theme',
    description: 'The Graphene design language for Tungsten.',
    version: '1.0.0',
    publisher: 'nogroup',
    license: 'MIT',
    engines: { vscode: '*' },
    categories: ['Themes'],
    contributes: {
      themes: [{
        id: 'Graphene Dark',
        label: 'Graphene Dark',
        uiTheme: 'vs-dark',
        path: './themes/graphene-dark.json',
      }],
    },
  }, null, '\t')}\n`)

  writeFileSync(
    resolve(extensionDir, 'themes/graphene-dark.json'),
    `${JSON.stringify(theme, null, '\t')}\n`,
  )

  // Also keep a copy in-repo so the theme is reviewable without a fork tree.
  const distDir = resolve(root, 'fork/graphene/dist')
  mkdirSync(distDir, { recursive: true })
  cpSync(resolve(extensionDir, 'themes/graphene-dark.json'), resolve(distDir, 'graphene-dark.json'))

  log(`  extensions/theme-graphene — ${Object.keys(theme.colors).length} colours, ${theme.tokenColors.length} TextMate rules`)

  // Make Graphene the default rather than Dark Modern.
  const productPath = resolve(forkDir, 'product.json')
  const product = JSON.parse(readFileSync(productPath, 'utf8'))
  product.defaultColorTheme = 'Graphene Dark'
  writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`)
  log('  product.json — defaultColorTheme set to Graphene Dark')
}

/* ------------------------------------------------------------------ *
 * shell
 * ------------------------------------------------------------------ */

const WORKBENCH_CSS = 'src/vs/workbench/browser/media/style.css'

function stageShell() {
  step('shell — splicing the Graphene workbench stylesheet')

  const css = buildWorkbenchCss()
  const issues = validateCss(css)
  if (issues.length > 0) {
    for (const issue of issues) console.error(`  ! ${issue}`)
    throw new Error(`Graphene stylesheet failed validation with ${issues.length} issue(s)`)
  }

  const target = resolve(forkDir, WORKBENCH_CSS)
  if (!existsSync(target)) {
    throw new Error(`${WORKBENCH_CSS} is not checked out; widen the sparse set or use --full`)
  }

  const before = readFileSync(target, 'utf8')
  const after = injectInto(before, css)
  writeFileSync(target, after)

  const reinjected = before.includes(BEGIN_MARKER)
  const added = after.split('\n').length - before.split('\n').length
  log(`  ${WORKBENCH_CSS} — ${reinjected ? 'replaced' : 'appended'} Graphene block (${css.split('\n').length} lines, ${(css.match(/\{/g) ?? []).length} rules)`)
  if (!reinjected) log(`  upstream stylesheet grew by ${added} lines; no upstream rule was deleted`)

  writeFileSync(resolve(root, 'fork/graphene/dist/graphene.css'), css)
}

/* ------------------------------------------------------------------ *
 * verify
 * ------------------------------------------------------------------ */

function stageVerify() {
  step('verify — asserting the fork actually applied')

  const failures = []
  const check = (label, condition) => {
    log(`  ${condition ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${label}`)
    if (!condition) failures.push(label)
  }

  const product = JSON.parse(readFileSync(resolve(forkDir, 'product.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(resolve(forkDir, 'package.json'), 'utf8'))

  check('product renamed to Tungsten', product.nameLong === 'Tungsten' && product.applicationName === 'tungsten')
  check('bundle identifier rebranded', product.darwinBundleIdentifier === 'org.nogroup.tungsten')
  check('package identity rebranded', pkg.name === 'tungsten')
  check('telemetry disabled', product.enableTelemetry === false)
  check('Microsoft telemetry endpoints removed', !product.aiConfig && !product.appCenter && !product.crashReporter)
  check('marketplace repointed to Open VSX', product.extensionsGallery?.serviceUrl?.includes('open-vsx.org') === true)
  check('issue reporting points at NO-Group', String(product.reportIssueUrl).includes('NO-Group/Tungsten'))
  check('Graphene is the default theme', product.defaultColorTheme === 'Graphene Dark')

  const themePath = resolve(forkDir, 'extensions/theme-graphene/themes/graphene-dark.json')
  check('Graphene theme extension installed', existsSync(themePath))

  if (existsSync(themePath)) {
    const theme = JSON.parse(readFileSync(themePath, 'utf8'))
    check('theme is valid', validateTheme(theme).length === 0)
    check('theme covers the workbench broadly', Object.keys(theme.colors).length > 300)
    check('editor background is Graphene base', theme.colors['editor.background'] === pin.expect.editorBackground)
    check('accent is the Graphene lime', theme.colors['activityBar.foreground'] === pin.expect.accent)
    check('semantic highlighting enabled', theme.semanticHighlighting === true)
  }

  const cssPath = resolve(forkDir, WORKBENCH_CSS)
  check('workbench stylesheet patched', existsSync(cssPath) && readFileSync(cssPath, 'utf8').includes(BEGIN_MARKER))

  if (existsSync(cssPath)) {
    const sheet = readFileSync(cssPath, 'utf8')
    check('Graphene block appears exactly once', sheet.split(BEGIN_MARKER).length === 2)
    check('upstream rules preserved', sheet.includes('.monaco-workbench.mac { font-family:'))
    check('stylesheet is structurally valid', validateCss(sheet.slice(sheet.indexOf(BEGIN_MARKER))).length === 0)
  }

  // Upstream must be untouched apart from the files the fork owns.
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean)
  const touched = dirty.map((line) => line.slice(3).trim()).sort()
  const allowed = ['extensions/theme-graphene/', 'package.json', 'product.json', WORKBENCH_CSS]
  const unexpected = touched.filter((file) => !allowed.some((prefix) => file.startsWith(prefix)))
  check(`only fork-owned files modified (${touched.length} changed)`, unexpected.length === 0)
  if (unexpected.length > 0) for (const file of unexpected.slice(0, 10)) log(`      unexpected: ${file}`)

  if (failures.length > 0) {
    console.error(`\n\u001b[31m${failures.length} check(s) failed\u001b[0m`)
    process.exit(1)
  }
  log(`\n\u001b[32mFork verified\u001b[0m — Tungsten ${pkg.version} on VS Code ${pin.tag}`)
  log(`  tree: ${forkDir}`)
  if (!wantFull) log('  note: sparse checkout. Re-run with --full to compile.')
}

/* ------------------------------------------------------------------ */

const stages = { fetch: stageFetch, brand: stageBrand, theme: stageTheme, shell: stageShell, verify: stageVerify }

try {
  if (stage === 'all') {
    stageFetch()
    stageBrand()
    stageTheme()
    stageShell()
    stageVerify()
  } else if (stages[stage]) {
    stages[stage]()
  } else {
    console.error(`unknown stage "${stage}"; expected one of: ${Object.keys(stages).join(', ')}, all`)
    process.exit(1)
  }
} catch (error) {
  console.error(`\n\u001b[31mfork failed:\u001b[0m ${error.message}`)
  process.exit(1)
}
