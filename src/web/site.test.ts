import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SITE,
  HEAD_END,
  HEAD_START,
  buildHeaders,
  buildHeadTags,
  buildManifest,
  buildNotFoundPage,
  buildRobots,
  buildSitemap,
  cardText,
  injectHead,
  isValidDomain,
  normaliseDomain,
  readSite,
  siteUrl,
  stampBuild,
  type SiteConfig,
} from './site'

const site = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  ...DEFAULT_SITE,
  domain: 'tungsten.dev',
  ...overrides,
})

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Tungsten</title>
    <meta name="description" content="placeholder" />
    <meta name="theme-color" content="#000000" />
  </head>
  <body><div id="root"></div></body>
</html>
`

describe('normaliseDomain', () => {
  it('keeps a bare hostname', () => {
    expect(normaliseDomain('tungsten.dev')).toBe('tungsten.dev')
  })

  it('strips what people actually paste', () => {
    expect(normaliseDomain('https://Tungsten.dev/')).toBe('tungsten.dev')
    expect(normaliseDomain('  http://ide.example.co.uk  ')).toBe('ide.example.co.uk')
    expect(normaliseDomain('tungsten.dev/editor?x=1')).toBe('tungsten.dev')
    expect(normaliseDomain('tungsten.dev.')).toBe('tungsten.dev')
  })

  it('leaves an empty value empty', () => {
    expect(normaliseDomain('')).toBe('')
    expect(normaliseDomain('   ')).toBe('')
  })
})

describe('isValidDomain', () => {
  it('accepts real hostnames', () => {
    expect(isValidDomain('tungsten.dev')).toBe(true)
    expect(isValidDomain('ide.example.co.uk')).toBe(true)
    expect(isValidDomain('my-ide.example.com')).toBe(true)
  })

  it('rejects things that are not', () => {
    expect(isValidDomain('')).toBe(false)
    expect(isValidDomain('localhost')).toBe(false)
    expect(isValidDomain('-bad.example.com')).toBe(false)
    expect(isValidDomain('bad-.example.com')).toBe(false)
    expect(isValidDomain('has space.com')).toBe(false)
    expect(isValidDomain(`${'a'.repeat(64)}.com`)).toBe(false)
  })
})

describe('siteUrl', () => {
  it('builds absolute addresses', () => {
    expect(siteUrl(site())).toBe('https://tungsten.dev/')
    expect(siteUrl(site(), 'sitemap.xml')).toBe('https://tungsten.dev/sitemap.xml')
    expect(siteUrl(site(), './icons/icon-192.png')).toBe('https://tungsten.dev/icons/icon-192.png')
  })

  it('has no answer without a domain', () => {
    expect(siteUrl(site({ domain: '' }))).toBeUndefined()
  })
})

describe('readSite', () => {
  it('falls back to the defaults field by field', () => {
    const read = readSite({ domain: 'https://x.example.com/', title: 'Mine' })
    expect(read.domain).toBe('x.example.com')
    expect(read.title).toBe('Mine')
    expect(read.description).toBe(DEFAULT_SITE.description)
  })

  it('survives nonsense', () => {
    expect(readSite(null).domain).toBe('')
    expect(readSite('nope').name).toBe('Tungsten')
    expect(readSite({ name: 42 }).name).toBe('Tungsten')
  })
})

describe('buildManifest', () => {
  it('is relative so one build works at any path', () => {
    const manifest = buildManifest(site())
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.icons.every((icon) => !icon.src.startsWith('/'))).toBe(true)
  })

  it('offers a maskable icon', () => {
    const manifest = buildManifest(site())
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('carries the site identity', () => {
    const manifest = buildManifest(site({ name: 'Studio', shortName: 'St', themeColor: '#123456' }))
    expect(manifest.name).toBe('Studio')
    expect(manifest.short_name).toBe('St')
    expect(manifest.theme_color).toBe('#123456')
  })
})

describe('cardText', () => {
  it('splits the authored title into a heading and a tagline', () => {
    expect(cardText(site())).toEqual({
      heading: 'Tungsten',
      tagline: 'a rugged development environment',
    })
  })

  it('handles the other dashes and separators people type', () => {
    expect(cardText(site({ title: 'Tungsten – the editor' })).tagline).toBe('the editor')
    expect(cardText(site({ title: 'Tungsten | the editor' })).tagline).toBe('the editor')
    expect(cardText(site({ title: 'Tungsten: the editor' })).tagline).toBe('the editor')
  })

  it('falls back to the first sentence of the description', () => {
    const text = cardText(site({ title: 'Tungsten', description: 'An editor. And more.' }))
    expect(text.heading).toBe('Tungsten')
    expect(text.tagline).toBe('An editor.')
  })

  it('never leaves the heading empty', () => {
    expect(cardText(site({ title: '', name: 'Fallback' })).heading).toBe('Fallback')
  })
})

describe('buildHeadTags', () => {
  it('includes the manifest and the install metadata', () => {
    const tags = buildHeadTags(site())
    expect(tags).toContain('rel="manifest"')
    expect(tags).toContain('apple-touch-icon')
  })

  it('adds absolute tags only when there is a domain', () => {
    expect(buildHeadTags(site())).toContain('<link rel="canonical" href="https://tungsten.dev/" />')
    const anonymous = buildHeadTags(site({ domain: '' }))
    expect(anonymous).not.toContain('canonical')
    expect(anonymous).not.toContain('og:image')
    expect(anonymous).toContain('og:title')
  })

  it('escapes quotes in the description', () => {
    const tags = buildHeadTags(site({ description: 'the "best" one' }))
    expect(tags).toContain('&quot;best&quot;')
    expect(tags).not.toContain('content="the "best" one"')
  })
})

describe('injectHead', () => {
  it('inserts the block before the closing head tag', () => {
    const next = injectHead(page, site())
    expect(next).toContain(HEAD_START)
    expect(next).toContain(HEAD_END)
    expect(next.indexOf(HEAD_START)).toBeLessThan(next.indexOf('</head>'))
  })

  it('rewrites the title, description and theme colour', () => {
    const next = injectHead(page, site({ title: 'Mine', description: 'Short.', themeColor: '#abcdef' }))
    expect(next).toContain('<title>Mine</title>')
    expect(next).toContain('<meta name="description" content="Short." />')
    expect(next).toContain('<meta name="theme-color" content="#abcdef" />')
    expect(next).not.toContain('placeholder')
  })

  it('is idempotent', () => {
    const once = injectHead(page, site())
    const twice = injectHead(once, site())
    expect(twice).toBe(once)
    expect(twice.split(HEAD_START)).toHaveLength(2)
  })

  it('replaces the block rather than stacking a second one', () => {
    const once = injectHead(page, site({ domain: 'first.example.com' }))
    const twice = injectHead(once, site({ domain: 'second.example.com' }))
    expect(twice).toContain('https://second.example.com/')
    expect(twice).not.toContain('first.example.com')
    expect(twice.split('rel="canonical"')).toHaveLength(2)
  })

  it('leaves a page with no head alone', () => {
    expect(injectHead('<p>hi</p>', site())).toBe('<p>hi</p>')
  })
})

describe('buildRobots', () => {
  it('allows everything', () => {
    expect(buildRobots(site())).toContain('Allow: /')
  })

  it('points at the sitemap only when one can exist', () => {
    expect(buildRobots(site())).toContain('Sitemap: https://tungsten.dev/sitemap.xml')
    expect(buildRobots(site({ domain: '' }))).not.toContain('Sitemap')
  })
})

describe('buildSitemap', () => {
  it('lists the given paths', () => {
    const xml = buildSitemap(site(), ['', 'docs']) ?? ''
    expect(xml).toContain('<loc>https://tungsten.dev/</loc>')
    expect(xml).toContain('<loc>https://tungsten.dev/docs</loc>')
    expect(xml.startsWith('<?xml')).toBe(true)
  })

  it('is impossible without a domain', () => {
    expect(buildSitemap(site({ domain: '' }))).toBeUndefined()
  })
})

describe('buildNotFoundPage', () => {
  it('redirects to the root instead of copying the app', () => {
    const html = buildNotFoundPage(site())
    expect(html).toContain('http-equiv="refresh"')
    expect(html).toContain('url=/')
    expect(html).not.toContain('/assets/')
    expect(html).not.toContain('<script')
  })

  it('works without JavaScript', () => {
    expect(buildNotFoundPage(site())).toContain('<a href="/">Open Tungsten</a>')
  })
})

describe('buildHeaders', () => {
  it('freezes hashed assets and never the page', () => {
    const headers = buildHeaders()
    expect(headers).toContain('/assets/*')
    expect(headers).toContain('immutable')
    const page = headers.slice(headers.indexOf('/index.html'))
    expect(page).toContain('no-cache')
  })

  it('never caches the worker', () => {
    const headers = buildHeaders()
    const worker = headers.slice(headers.indexOf('/sw.js'), headers.indexOf('/index.html'))
    expect(worker).toContain('no-cache')
  })
})

describe('stampBuild', () => {
  // The boot screen ships with `dev` and `local` in these slots, which is
  // what the dev server should show. Vite fills the version in; only
  // build-web.mjs knows the build id, so the two halves arrive separately.
  const page = [
    '<p class="spec">',
    '<span>Version <span data-boot-version>dev</span></span>',
    '<span>Build <span data-boot-build>local</span></span>',
    '</p>',
  ].join('')

  it('writes the version without touching the build id', () => {
    const next = stampBuild(page, { version: '2.2.0' })
    expect(next).toContain('<span data-boot-version>2.2.0</span>')
    expect(next).toContain('<span data-boot-build>local</span>')
  })

  it('writes the build id without touching the version', () => {
    const next = stampBuild(page, { buildId: '2afb90405ca6' })
    expect(next).toContain('<span data-boot-build>2afb90405ca6</span>')
    expect(next).toContain('<span data-boot-version>dev</span>')
  })

  it('is idempotent, because the build stamps twice', () => {
    const once = stampBuild(page, { version: '2.2.0', buildId: 'abc123' })
    expect(stampBuild(once, { version: '2.2.0', buildId: 'abc123' })).toBe(once)
  })

  it('leaves the placeholders alone when it has nothing to say', () => {
    expect(stampBuild(page, {})).toBe(page)
    expect(stampBuild(page, { version: '' })).toBe(page)
  })

  it('escapes, because a version string reaches the page as markup', () => {
    expect(stampBuild(page, { version: '1.0-<script>' }))
      .toContain('<span data-boot-version>1.0-&lt;script&gt;</span>')
  })

  it('does not care that the page has other markup around it', () => {
    const full = `<html><body>${page}<div id="root"></div></body></html>`
    expect(stampBuild(full, { version: '9.9.9' })).toContain('>9.9.9</span>')
  })
})
