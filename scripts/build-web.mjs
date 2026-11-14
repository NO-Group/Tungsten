#!/usr/bin/env node
/**
 * Turns `dist/` into a website.
 *
 *   npm run web:build
 *
 * `vite build` already produces a folder of static files that works when
 * opened from disk. What it does not produce is everything a *deployment*
 * needs: the install manifest, the crawler files, the host configuration,
 * the certificate hint, and the service worker that makes the thing work
 * on a train.
 *
 * All of those are derived from `site.json` by pure functions in
 * `src/web/`, which are unit-tested. This script is the part that runs the
 * build and writes the results to disk -- deliberately boring, so that a
 * failure here is a filesystem problem rather than a logic one.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { checkDeployment, describeProblems } from '../src/web/deployCheck.ts'
import {
  stampBuild,
  buildHeaders,
  buildManifest,
  buildNotFoundPage,
  buildRobots,
  buildSitemap,
  injectHead,
  isValidDomain,
  siteUrl,
} from '../src/web/site.ts'
import { cacheName, choosePrecache, precacheBytes, serviceWorkerSource } from '../src/web/serviceWorker.ts'
import { readSite } from './site-config.mjs'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const skipBuild = process.argv.includes('--no-build')

const site = readSite(ROOT)

function listFiles(directory) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(path))
    else out.push({ path: relative(DIST, path).split('\\').join('/'), size: statSync(path).size })
  }
  return out
}

const written = []
function emit(name, contents) {
  writeFileSync(join(DIST, name), contents)
  const already = written.find((file) => file.name === name)
  if (already) already.size = Buffer.byteLength(contents)
  else written.push({ name, size: Buffer.byteLength(contents) })
}

const kb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} kB`

// ------------------------------------------------------------------ build

if (!skipBuild) {
  console.log('web: building the application...')
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: ROOT })
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('web: dist/index.html is missing. Run `npm run build` first.')
  process.exit(1)
}

// ------------------------------------------------------------------ page

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const injected = injectHead(html, site)
if (injected === html && !html.includes('tungsten:site')) {
  console.warn('web: could not find </head> in dist/index.html; metadata was not injected.')
}
emit('index.html', injected)

// ------------------------------------------------------------- deployment

emit('manifest.webmanifest', `${JSON.stringify(buildManifest(site), null, 2)}\n`)
emit('robots.txt', buildRobots(site))
emit('404.html', buildNotFoundPage(site))
emit('_headers', buildHeaders())

// Netlify-style SPA fallback. Tungsten has no routes, so this is a safety
// net for a stale bookmark rather than a router -- the 404 page does the
// same job on hosts that ignore this file.
emit('_redirects', '/*  /index.html  200\n')

const sitemap = buildSitemap(site)
if (sitemap) emit('sitemap.xml', sitemap)

if (isValidDomain(site.domain)) {
  // GitHub Pages reads this to attach the custom domain and request a
  // certificate; it is harmless everywhere else.
  emit('CNAME', `${site.domain}\n`)
}

// --------------------------------------------------------- service worker

const files = listFiles(DIST).filter((file) => file.path !== 'sw.js')
const precache = choosePrecache(files)
const buildId = createHash('sha256')
  .update(files.map((file) => `${file.path}:${file.size}`).sort().join('\n'))
  .digest('hex')
  .slice(0, 12)

emit('sw.js', serviceWorkerSource({ cache: cacheName(buildId), precache }))

// The boot screen names the build it belongs to, so a report of "the site
// is broken" arrives with the answer to "which copy of it?" already on
// screen. Stamped after the id exists, which means index.html grows by
// the difference between the placeholder and the id -- deterministic,
// because vite rewrites dist/ from scratch on every build, so the input
// to the hash above is always the placeholder length.
emit('index.html', stampBuild(readFileSync(join(DIST, 'index.html'), 'utf8'), { buildId }))

// ------------------------------------------------------------------ check

// Read back what was just written, the way a browser would read the
// deployed site. A folder that cannot start should fail on the machine
// that built it, not on the domain.
const published = listFiles(DIST).map((file) => file.path)
const problems = checkDeployment({
  html: readFileSync(join(DIST, 'index.html'), 'utf8'),
  files: published,
  serviceWorker: readFileSync(join(DIST, 'sw.js'), 'utf8'),
})

// ----------------------------------------------------------------- report

const total = files.reduce((sum, file) => sum + file.size, 0)

console.log('')
console.log(`web: ${written.length} files written into dist/`)
for (const file of written) console.log(`     ${file.name.padEnd(22)} ${kb(file.size)}`)
console.log('')
console.log(`web: ${precache.length} files precached (${kb(precacheBytes(files))} on first visit);`)
console.log(`     the remaining ${kb(total - precacheBytes(files))} is cached as it is used.`)
console.log(`web: cache ${cacheName(buildId)}`)

console.log('')
console.log(describeProblems(problems))
if (problems.some((problem) => problem.severity === 'fatal')) {
  console.error('')
  console.error('web: that folder would show the boot screen and stop. Not deployable.')
  process.exit(1)
}

if (isValidDomain(site.domain)) {
  console.log('')
  console.log(`web: ready for ${siteUrl(site)}`)
} else {
  console.log('')
  console.log('web: no domain set, so the build is relative and will work anywhere.')
  console.log('     Set yours with `npm run domain -- yourdomain.com` to add the')
  console.log('     canonical link, social card, sitemap and CNAME.')
}
