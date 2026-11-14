#!/usr/bin/env node
/**
 * Reads `dist/` the way a browser would read the deployed site.
 *
 *   npm run web:check
 *
 * Run by `npm run web:build` at the end, so a folder that cannot start is
 * caught on the machine that built it rather than on the domain. The rules
 * are in `src/web/deployCheck.ts`; this part only supplies the filesystem.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { checkDeployment, describeProblems } from '../src/web/deployCheck.ts'

const root = process.argv.slice(2).find((value) => !value.startsWith('--')) ?? 'dist'
const dist = resolve(process.cwd(), root)

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`web: ${root}/index.html does not exist. Run \`npm run web:build\` first.`)
  process.exit(1)
}

function listFiles(directory) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(path))
    else if (statSync(path).isFile()) out.push(relative(dist, path).split('\\').join('/'))
  }
  return out
}

const files = listFiles(dist)
const problems = checkDeployment({
  html: readFileSync(join(dist, 'index.html'), 'utf8'),
  files,
  serviceWorker: existsSync(join(dist, 'sw.js')) ? readFileSync(join(dist, 'sw.js'), 'utf8') : undefined,
})

console.log(`web: checking ${files.length} published files in ${root}/`)
console.log(describeProblems(problems))

if (problems.some((problem) => problem.severity === 'fatal')) {
  console.error('')
  console.error('web: this folder would show the boot screen and stop. Not deployable.')
  process.exit(1)
}
