#!/usr/bin/env node
/**
 * Builds the icons a browser asks for, from the one icon the repository
 * keeps.
 *
 *   npm run web:icons            # build them
 *   npm run web:icons -- --check # fail if they are missing or stale
 *
 * These land in `public/`, so Vite copies them into `dist/` verbatim and
 * the deploy step needs no image tooling at all. That matters: a CI runner
 * without ImageMagick should still be able to ship the site, and a missing
 * install icon is the kind of fault nobody notices until someone tries to
 * add the app to a home screen.
 *
 * As in `prepare-icon.mjs`, staleness is decided by hashing the source
 * rather than comparing modification times, which are meaningless after a
 * clone.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SITE, readSite } from './site-config.mjs'
import { cardText } from '../src/web/site.ts'

const ROOT = process.cwd()
const SOURCE = join(ROOT, 'resources', 'icon.png')
const OUT = join(ROOT, 'public', 'icons')
// Kept out of `public/`, which is copied verbatim into the deployed
// site: a build receipt is not something to serve to the internet.
const LOCK = join(ROOT, 'resources', 'web-icons.lock.json')

const site = readSite(ROOT)
const background = site.backgroundColor || DEFAULT_SITE.backgroundColor

/**
 * Every icon, and why it exists.
 *
 * The maskable one is inset to 80%: Android crops icons to whatever shape
 * the launcher likes, and art that runs to the edge comes back with its
 * corners sliced off. The Apple touch icon is flattened onto the theme
 * colour because iOS composites transparency against black regardless of
 * what the page says.
 */
const ICONS = [
  { name: 'icon-192.png', size: 192, inset: 1, background: 'none' },
  { name: 'icon-512.png', size: 512, inset: 1, background: 'none' },
  { name: 'icon-maskable-512.png', size: 512, inset: 0.8, background },
  { name: 'apple-touch-icon.png', size: 180, inset: 0.92, background },
]

const SOCIAL = { name: 'social.png', width: 1200, height: 630, icon: 300 }

const check = process.argv.includes('--check')

function converter() {
  for (const command of ['magick', 'convert']) {
    try {
      execFileSync('which', [command], { stdio: 'ignore' })
      return command
    } catch {
      // Try the next one.
    }
  }
  return undefined
}

/**
 * A font ImageMagick can actually load.
 *
 * The app's own face is DM Sans, which ships as WOFF -- a format
 * ImageMagick cannot read. Rather than add a build dependency for one
 * image, the card falls back through what is installed, and draws no text
 * at all rather than crashing if nothing is.
 */
function fontFor(command) {
  let listed = ''
  try {
    listed = execFileSync(command, ['-list', 'font'], { encoding: 'utf8' })
  } catch {
    return undefined
  }
  const available = new Set(
    listed.split('\n')
      .map((line) => line.match(/^\s*Font:\s*(\S+)/)?.[1])
      .filter(Boolean),
  )
  for (const [bold, regular] of [
    ['DejaVu-Sans-Bold', 'DejaVu-Sans'],
    ['Helvetica-Bold', 'Helvetica'],
    ['Arial-Bold', 'Arial'],
  ]) {
    if (available.has(bold) && available.has(regular)) return { bold, regular }
  }
  return undefined
}

/** Greedy wrap, because `-annotate` does not break lines by itself. */
function wrap(text, columns) {
  const lines = ['']
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const line = lines[lines.length - 1]
    if (!line) lines[lines.length - 1] = word
    else if (`${line} ${word}`.length <= columns) lines[lines.length - 1] = `${line} ${word}`
    else lines.push(word)
  }
  return lines.filter(Boolean)
}

function fingerprint() {
  return createHash('sha256')
    .update(readFileSync(SOURCE))
    .update(JSON.stringify({ ICONS, SOCIAL, background }))
    .digest('hex')
}

function recorded() {
  if (!existsSync(LOCK)) return undefined
  try {
    return JSON.parse(readFileSync(LOCK, 'utf8'))
  } catch {
    return undefined
  }
}

const names = [...ICONS.map((icon) => icon.name), SOCIAL.name]

if (!existsSync(SOURCE)) {
  console.error('web:icons: resources/icon.png is missing. Run `npm run icon` first.')
  process.exit(1)
}

const digest = fingerprint()

if (check) {
  const missing = names.filter((name) => !existsSync(join(OUT, name)))
  const lock = recorded()
  if (!missing.length && lock?.sha256 === digest) {
    console.log(`web:icons: ${names.length} icons in public/icons are current.`)
    process.exit(0)
  }
  console.error(missing.length
    ? `web:icons: missing ${missing.join(', ')}. Run \`npm run web:icons\`.`
    : 'web:icons: public/icons no longer matches resources/icon.png. Run `npm run web:icons`.')
  process.exit(1)
}

const tool = converter()
if (!tool) {
  console.error([
    'web:icons: no image converter found.',
    '',
    'Install ImageMagick, or export these by hand into public/icons/:',
    ...names.map((name) => `  ${name}`),
  ].join('\n'))
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

for (const icon of ICONS) {
  const inner = Math.round(icon.size * icon.inset)
  execFileSync(tool, [
    SOURCE,
    '-resize', `${inner}x${inner}`,
    '-background', icon.background,
    '-gravity', 'center',
    '-extent', `${icon.size}x${icon.size}`,
    '-strip',
    join(OUT, icon.name),
  ], { stdio: 'inherit' })
  console.log(`web:icons: ${icon.name} (${icon.size}×${icon.size})`)
}

// The social card: the mark on the left, the name and tagline beside it,
// at the aspect ratio every link preview crops to. This is the only image
// of Tungsten most people will ever see, so it is worth more than a
// centred icon on a square.
const { heading, tagline } = cardText(site)
const card = [
  '-size', `${SOCIAL.width}x${SOCIAL.height}`, `xc:${background}`,
  '(', SOURCE, '-resize', `${SOCIAL.icon}x${SOCIAL.icon}`, ')',
  '-gravity', 'northwest', '-geometry', `+96+${Math.round((SOCIAL.height - SOCIAL.icon) / 2)}`, '-composite',
]

const font = fontFor(tool)
if (font) {
  // `-annotate` measures from the top of the text box under northwest
  // gravity, so each y below is a top edge, not a baseline. They are
  // spaced by hand because a 1200×630 card is laid out once and looked at
  // forever.
  const left = 96 + SOCIAL.icon + 72
  card.push(
    '-font', font.bold, '-pointsize', '82', '-fill', '#f0f3ef',
    '-annotate', `+${left}+222`, heading,
    '-fill', '#c8f169', '-draw', `rectangle ${left},340 ${left + 88},346`,
    '-font', font.regular, '-pointsize', '31', '-fill', '#858c86',
    '-annotate', `+${left}+382`, wrap(tagline, 34).join('\n'),
  )
} else {
  console.warn('web:icons: no usable font found; the social card will show the mark only.')
}

execFileSync(tool, [...card, '-strip', join(OUT, SOCIAL.name)], { stdio: 'inherit' })
console.log(`web:icons: ${SOCIAL.name} (${SOCIAL.width}×${SOCIAL.height})`)

writeFileSync(LOCK, `${JSON.stringify({
  source: 'resources/icon.png',
  sha256: digest,
  icons: names,
  tool,
}, null, 2)}\n`)

console.log('web:icons: written to public/icons; Vite copies them into dist unchanged.')
