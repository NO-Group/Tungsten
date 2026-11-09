/**
 * Reading `site.json` from disk.
 *
 * The rules for what a site config *means* -- defaults, domain
 * normalisation, what to do with a malformed field -- live in
 * `src/web/site.ts`, where they are unit-tested. Node 22 imports
 * TypeScript directly, so the build scripts use that module rather than a
 * second copy of the same logic that quietly drifts from it.
 *
 * This file is only the part that touches the filesystem.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SITE, normaliseDomain, readSite as parseSite } from '../src/web/site.ts'

export { DEFAULT_SITE, normaliseDomain }

export const SITE_FILE = 'site.json'

/** The config, with every default filled in. Missing file is not an error. */
export function readSite(root = process.cwd()) {
  const path = join(root, SITE_FILE)
  if (!existsSync(path)) return { ...DEFAULT_SITE }
  try {
    return parseSite(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    console.warn(`site: ${SITE_FILE} could not be read (${error.message}); using defaults.`)
    return { ...DEFAULT_SITE }
  }
}

export function writeSite(site, root = process.cwd()) {
  writeFileSync(join(root, SITE_FILE), `${JSON.stringify(site, null, 2)}\n`)
}
