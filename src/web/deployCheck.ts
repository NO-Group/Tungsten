/**
 * Does this folder actually work as a website?
 *
 * `vite build` succeeding means the code compiled. It says nothing about
 * whether the thing on the other end of a deploy will start, and there is
 * one failure here that is worse than all the others: the page paints,
 * because the boot screen is inline HTML, and then nothing happens,
 * because the bundle it asked for was never published. A host serving the
 * repository instead of `dist/` does exactly that, and the result is a
 * beautiful screen that spins for ever.
 *
 * So this reads the built folder the way a browser would read the site —
 * follow every URL the page references, and check something is there —
 * and reports what a visitor would experience, not what the build thought
 * it wrote.
 *
 * Pure, so the rules are unit-tested rather than discovered in production.
 * `scripts/web-check.mjs` supplies the filesystem.
 */

export type Deployment = {
  /** The contents of the published `index.html`. */
  html: string
  /** Every published path, relative to the site root, with `/` separators. */
  files: string[]
  /** The contents of `sw.js`, when one was published. */
  serviceWorker?: string
}

export type Severity = 'fatal' | 'warning'

export type Problem = {
  severity: Severity
  /** What is wrong, in a sentence somebody can act on. */
  says: string
  /** What to do about it, where that is not obvious. */
  fix?: string
}

/** Files a deployment is incomplete without, and why each one matters. */
const REQUIRED: Array<{ path: string; severity: Severity; why: string; fix: string }> = [
  {
    path: 'index.html',
    severity: 'fatal',
    why: 'there is no page to serve',
    fix: 'Run `npm run web:build`, and publish the dist/ folder it writes.',
  },
  {
    path: 'manifest.webmanifest',
    severity: 'warning',
    why: 'the app cannot be installed',
    fix: 'Run `npm run web:build` rather than `npm run build`: the manifest is written by the first.',
  },
  {
    path: 'sw.js',
    severity: 'warning',
    why: 'it will not work offline',
    fix: 'Run `npm run web:build` rather than `npm run build`.',
  },
  {
    path: '_headers',
    severity: 'warning',
    why: 'assets will be re-downloaded on every visit',
    fix: 'Run `npm run web:build`; Cloudflare Pages and Netlify both read this file.',
  },
]

/** `./assets/index-abc.js` and `/assets/index-abc.js` are the same file. */
function normalise(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  return path.replace(/^\.?\//, '')
}

/** Every URL the page asks the browser to fetch from this site. */
export function referencedFiles(html: string): string[] {
  const urls: string[] = []
  const attributes = /(?:src|href)\s*=\s*"([^"]+)"/g
  for (const match of html.matchAll(attributes)) {
    const url = match[1].trim()
    // Another origin, a data URI, an anchor and a mailto are all somebody
    // else's problem; only same-site paths are ours to publish.
    if (!url || /^(https?:|data:|mailto:|#|\/\/)/.test(url)) continue
    urls.push(normalise(url))
  }
  return [...new Set(urls)]
}

/** The precache list out of a generated worker. */
export function precachedFiles(source: string): string[] {
  const block = /const PRECACHE = (\[[\s\S]*?\])\s*\n/.exec(source)
  if (!block) return []
  try {
    return (JSON.parse(block[1]) as string[]).map(normalise).filter((path) => path !== '')
  } catch {
    return []
  }
}

export function checkDeployment({ html, files, serviceWorker }: Deployment): Problem[] {
  const problems: Problem[] = []
  const published = new Set(files.map(normalise))

  for (const file of REQUIRED) {
    if (!published.has(file.path)) {
      problems.push({ severity: file.severity, says: `${file.path} is not published, so ${file.why}.`, fix: file.fix })
    }
  }

  if (!published.has('index.html')) return problems

  // The one that matters. A module the page cannot fetch is a boot screen
  // that never goes away, and the usual cause is publishing the repository
  // rather than the build.
  const sources = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((match) => match[1])
  if (!sources.length) {
    problems.push({
      severity: 'fatal',
      says: 'index.html loads no application bundle, so the page would show the boot screen and stop there.',
      fix: 'Publish the index.html that `vite build` writes into dist/, not the one in the repository root.',
    })
  }

  for (const source of sources) {
    if (source.includes('/src/')) {
      problems.push({
        severity: 'fatal',
        says: `index.html still points at the source file ${source}, which only a dev server can serve.`,
        fix: 'This is the repository\u2019s index.html, not the built one. Set the host\u2019s output directory to `dist`.',
      })
    }
  }

  for (const url of referencedFiles(html)) {
    if (published.has(url)) continue
    const fatal = url.endsWith('.js') || url.endsWith('.css')
    problems.push({
      severity: fatal ? 'fatal' : 'warning',
      says: `index.html asks for ${url}, which is not published.`,
      fix: fatal
        ? 'A missing script or stylesheet leaves the boot screen on screen for ever. Rebuild and publish dist/ whole.'
        : undefined,
    })
  }

  if (/(?:src|href)="https?:\/\/(?:localhost|127\.0\.0\.1)/.test(html)) {
    problems.push({
      severity: 'fatal',
      says: 'index.html references localhost, which is not a machine your visitors have.',
      fix: 'Something was built with a dev address baked in. Rebuild with `npm run web:build`.',
    })
  }

  // A worker that precaches a file nobody published installs happily and
  // then serves a 404 from cache on the next visit.
  for (const path of precachedFiles(serviceWorker ?? '')) {
    if (!published.has(path)) {
      problems.push({
        severity: 'warning',
        says: `sw.js precaches ${path}, which is not published.`,
        fix: 'Rebuild: the worker is generated from the folder it ships with, so the two have drifted.',
      })
    }
  }

  return problems
}

/** The report, as a person reads it. */
export function describeProblems(problems: Problem[]): string {
  if (!problems.length) return 'web: the build looks deployable.'
  const lines: string[] = []
  for (const problem of problems) {
    lines.push(`${problem.severity === 'fatal' ? 'FAIL' : 'warn'}  ${problem.says}`)
    if (problem.fix) lines.push(`      ${problem.fix}`)
  }
  return lines.join('\n')
}
