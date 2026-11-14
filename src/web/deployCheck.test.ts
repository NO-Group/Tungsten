/**
 * The deployment check.
 *
 * Written against the failure that prompted it: a host publishing the
 * repository instead of `dist/`, which serves a page whose only script is
 * `/src/main.tsx`. Nothing fetches it, nothing throws, and the boot screen
 * stays up for ever. Every case here is one a browser would hit silently.
 */

import { describe, expect, it } from 'vitest'

import { checkDeployment, describeProblems, precachedFiles, referencedFiles } from './deployCheck'

const BUILT_HTML = [
  '<!doctype html><html><head>',
  '<link rel="icon" href="./icons/icon-192.png" />',
  '<link rel="manifest" href="./manifest.webmanifest" />',
  '</head><body><div id="root"></div>',
  '<script type="module" src="./assets/index-abc123.js"></script>',
  '</body></html>',
].join('')

const BUILT_FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  'assets/index-abc123.js',
  'icons/icon-192.png',
]

const fatal = (problems: ReturnType<typeof checkDeployment>) =>
  problems.filter((problem) => problem.severity === 'fatal')

describe('reading a deployment', () => {
  it('passes a folder a browser could actually start', () => {
    expect(checkDeployment({ html: BUILT_HTML, files: BUILT_FILES })).toEqual([])
  })

  it('collects only same-site URLs, deduplicated', () => {
    const html = [
      '<script src="/assets/a.js"></script>',
      '<script src="./assets/a.js"></script>',
      '<img src="https://cdn.example/x.png" />',
      '<img src="data:image/png;base64,AAA" />',
      '<a href="#main">skip</a>',
      '<a href="mailto:x@example.com">mail</a>',
      '<link href="./styles.css?v=2" />',
    ].join('')
    expect(referencedFiles(html)).toEqual(['assets/a.js', 'styles.css'])
  })
})

describe('the deployment that shows a boot screen for ever', () => {
  it('fails the repository index.html, which points at source', () => {
    const problems = checkDeployment({
      html: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      files: ['index.html'],
    })
    const says = fatal(problems).map((problem) => problem.says).join('\n')
    expect(says).toContain('/src/main.tsx')
    expect(says).toContain('only a dev server can serve')
    expect(fatal(problems)[0].fix).toContain('output directory')
  })

  it('fails a page with no bundle at all', () => {
    const problems = checkDeployment({ html: '<div id="root"></div>', files: ['index.html'] })
    expect(fatal(problems)[0].says).toContain('loads no application bundle')
    // And names the symptom, so the message matches what is on screen.
    expect(fatal(problems)[0].says).toContain('boot screen')
  })

  it('fails a bundle that is referenced but not published', () => {
    const problems = checkDeployment({ html: BUILT_HTML, files: BUILT_FILES.filter((file) => !file.endsWith('.js')) })
    expect(fatal(problems).map((problem) => problem.says).join('')).toContain('assets/index-abc123.js')
  })

  it('fails a dev address baked into the page', () => {
    const problems = checkDeployment({
      html: '<script type="module" src="http://localhost:5173/main.js"></script>',
      files: ['index.html'],
    })
    expect(fatal(problems).map((problem) => problem.says).join('')).toContain('localhost')
  })

  it('says nothing more once there is no page, rather than piling on', () => {
    const problems = checkDeployment({ html: '', files: [] })
    expect(problems.filter((problem) => problem.says.startsWith('index.html is not'))).toHaveLength(1)
    expect(problems.every((problem) => problem.says.includes('not published'))).toBe(true)
  })
})

describe('the deployment that merely works badly', () => {
  it('warns, but does not fail, when only `npm run build` was run', () => {
    const problems = checkDeployment({
      html: BUILT_HTML,
      files: ['index.html', 'assets/index-abc123.js', 'icons/icon-192.png'],
    })
    expect(fatal(problems)).toEqual([])
    const says = problems.map((problem) => problem.says).join('\n')
    expect(says).toContain('sw.js is not published')
    expect(says).toContain('_headers is not published')
    // The manifest is referenced *and* required; saying it twice is noise,
    // but saying it at all is the point -- it must name the right command.
    expect(problems.find((problem) => problem.says.includes('manifest'))?.fix).toContain('npm run web:build')
  })

  it('warns when a missing icon is referenced, without calling it fatal', () => {
    const problems = checkDeployment({ html: BUILT_HTML, files: BUILT_FILES.filter((file) => !file.startsWith('icons/')) })
    expect(fatal(problems)).toEqual([])
    expect(problems[0].says).toContain('icons/icon-192.png')
  })

  it('warns when the worker precaches a file that is not there', () => {
    const problems = checkDeployment({
      html: BUILT_HTML,
      files: BUILT_FILES,
      serviceWorker: 'const PRECACHE = ["./","./index.html","./assets/gone-999.js"]\nconst X = 1\n',
    })
    expect(fatal(problems)).toEqual([])
    expect(problems.map((problem) => problem.says).join('')).toContain('assets/gone-999.js')
  })

  it('reads the precache list out of a real worker, and shrugs at a broken one', () => {
    expect(precachedFiles('const PRECACHE = ["./","./sw-test.js"]\n')).toEqual(['', 'sw-test.js'].filter(Boolean))
    expect(precachedFiles('const PRECACHE = [not json]\n')).toEqual([])
    expect(precachedFiles('nothing like it')).toEqual([])
  })
})

describe('the report', () => {
  it('says so plainly when there is nothing wrong', () => {
    expect(describeProblems([])).toContain('deployable')
  })

  it('marks fatal and warning differently, and indents the fix under it', () => {
    const text = describeProblems([
      { severity: 'fatal', says: 'no bundle.', fix: 'publish dist/.' },
      { severity: 'warning', says: 'no worker.' },
    ])
    expect(text.split('\n')).toEqual(['FAIL  no bundle.', '      publish dist/.', 'warn  no worker.'])
  })
})
