#!/usr/bin/env node
/**
 * Turns whatever icon you dropped in `resources/` into the artifacts the
 * packagers need.
 *
 * Electron-builder, the Windows installer and the macOS bundle all want a
 * large square PNG; a browser tab wants a small one; nobody wants a JPEG.
 * So the source can be any format -- drop `resources/icon.jpg` and run this
 * -- and the canonical `resources/icon.png` is generated from it.
 *
 *   npm run icon            # find the newest source and convert it
 *   npm run icon -- --check # fail if icon.png is missing or stale
 *
 * The original is never deleted. It is the source, and a JPEG of a nice
 * icon is worth keeping even though nothing in the build reads it.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RESOURCES = join(process.cwd(), 'resources')
const TARGET = join(RESOURCES, 'icon.png')
/**
 * In the order they are preferred as a source.
 *
 * `icon.svg` is deliberately not here. It is the vector master, and turning
 * it into a raster needs a delegate ImageMagick often does not have -- a
 * failure that would be mystifying at exactly the wrong moment. Export it
 * yourself and save the result as one of these.
 */
const CANDIDATES = ['icon.jpg', 'icon.jpeg', 'icon.webp', 'icon.source.png']
/** electron-builder refuses anything smaller than this. */
const SIZE = 1024

const check = process.argv.includes('--check')

function sources() {
  return CANDIDATES
    .map((name) => join(RESOURCES, name))
    .filter((path) => existsSync(path))
}

function converter() {
  for (const [command, build] of [
    ['magick', (input, output) => [input, '-resize', `${SIZE}x${SIZE}`, '-background', 'none', '-gravity', 'center', '-extent', `${SIZE}x${SIZE}`, output]],
    ['convert', (input, output) => [input, '-resize', `${SIZE}x${SIZE}`, '-background', 'none', '-gravity', 'center', '-extent', `${SIZE}x${SIZE}`, output]],
    ['ffmpeg', (input, output) => ['-y', '-i', input, '-vf', `scale=${SIZE}:${SIZE}`, output]],
  ]) {
    try {
      execFileSync('which', [command], { stdio: 'ignore' })
      return { command, build }
    } catch {
      // Try the next one.
    }
  }
  return undefined
}

const found = sources()

if (!found.length) {
  if (check) {
    if (existsSync(TARGET)) {
      console.log('icon: resources/icon.png is present; no source to check it against.')
      process.exit(0)
    }
    console.error('icon: resources/icon.png is missing and there is no source to build it from.')
    process.exit(1)
  }
  console.error([
    'icon: nothing to convert.',
    '',
    `Drop your artwork in resources/ as one of: ${CANDIDATES.join(', ')}`,
    'then run `npm run icon` again. A square image of at least 1024×1024 gives',
    'the best result on every platform.',
  ].join('\n'))
  process.exit(1)
}

const source = found[0]
const fresh = existsSync(TARGET) && statSync(TARGET).mtimeMs >= statSync(source).mtimeMs

if (check) {
  if (fresh) {
    console.log(`icon: resources/icon.png is up to date with ${source.replace(`${process.cwd()}/`, '')}.`)
    process.exit(0)
  }
  console.error(`icon: resources/icon.png is stale. Run \`npm run icon\` (source: ${source.replace(`${process.cwd()}/`, '')}).`)
  process.exit(1)
}

const tool = converter()
if (!tool) {
  console.error([
    'icon: no image converter found.',
    '',
    'Install ImageMagick (`magick`) or ffmpeg, or export a 1024×1024 PNG',
    'yourself and save it as resources/icon.png.',
  ].join('\n'))
  process.exit(1)
}

const relative = (path) => path.replace(`${process.cwd()}/`, '')

try {
  execFileSync(tool.command, tool.build(source, TARGET), { stdio: 'inherit' })
} catch (error) {
  console.error([
    '',
    `icon: ${tool.command} could not read ${relative(source)}.`,
    `       ${error.message.split('\n')[0]}`,
    '',
    'If the source is a vector, export it to PNG or JPEG first: the raster',
    'delegates ImageMagick needs for SVG are often not installed.',
  ].join('\n'))
  process.exit(1)
}

console.log(`icon: ${relative(source)} → ${relative(TARGET)} at ${SIZE}×${SIZE} (via ${tool.command}).`)
console.log('icon: the source file was left where it is; nothing in the build reads it directly.')
