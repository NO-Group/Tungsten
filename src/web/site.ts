/**
 * Tungsten as a website.
 *
 * The desktop build has a packager to tell it what it is called and where it
 * lives. A web build has to carry that itself: a title, a description, an
 * icon set, a canonical address. All of it comes from one file --
 * `site.json` at the root -- and everything derived from it is built by a
 * pure function here, so the deploy script is plumbing rather than policy.
 *
 * The domain is optional on purpose. A build with no domain set still works
 * -- every path it emits is relative, so it runs from a file:// folder, a
 * subdirectory, or a preview URL. Setting a domain only adds the things
 * that genuinely need an absolute address: the canonical link, the social
 * card, the sitemap, and the CNAME a static host reads.
 */

export type SiteConfig = {
  /**
   * The bare hostname this is served from, with no scheme and no slash:
   * `tungsten.dev`, or `ide.example.co.uk`. Empty means "not deployed to a
   * known address yet", which is a legitimate state, not a missing value.
   */
  domain: string
  name: string
  shortName: string
  title: string
  description: string
  themeColor: string
  backgroundColor: string
  /** Shown on the social card; relative to the site root. */
  socialImage: string
}

export const DEFAULT_SITE: SiteConfig = {
  domain: '',
  name: 'Tungsten',
  shortName: 'Tungsten',
  title: 'Tungsten — a rugged development environment',
  description:
    'Tungsten is a development environment you can run in a browser: a real editor, a terminal, '
    + 'and a visual builder whose blocks and code are the same program.',
  themeColor: '#111311',
  backgroundColor: '#111311',
  socialImage: 'icons/social.png',
}

/**
 * Turns whatever the user typed into a bare hostname.
 *
 * People paste `https://tungsten.dev/` as often as they type `tungsten.dev`,
 * and a CNAME file containing a URL is a broken deployment that looks fine
 * in the diff.
 */
export function normaliseDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^\/+/, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '')
}

/** A hostname a certificate could be issued for. */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  return labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

/** The absolute address of a path, or undefined when there is no domain. */
export function siteUrl(site: SiteConfig, path = ''): string | undefined {
  if (!isValidDomain(site.domain)) return undefined
  const clean = path.replace(/^\.?\//, '')
  return `https://${site.domain}/${clean}`
}

export function readSite(raw: unknown): SiteConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SITE }
  const value = raw as Partial<SiteConfig>
  const text = (key: keyof SiteConfig) => (
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : DEFAULT_SITE[key]
  )
  return {
    domain: normaliseDomain(typeof value.domain === 'string' ? value.domain : ''),
    name: text('name'),
    shortName: text('shortName'),
    title: text('title'),
    description: text('description'),
    themeColor: text('themeColor'),
    backgroundColor: text('backgroundColor'),
    socialImage: text('socialImage'),
  }
}

// --------------------------------------------------------------- manifest

export type WebManifest = {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>
  shortcuts: Array<{ name: string; url: string; description: string }>
}

/**
 * The install manifest.
 *
 * `start_url` and `scope` are relative, which is what lets the same build
 * install correctly from a root domain, a project subpath or a preview
 * deployment without being rebuilt for each.
 */
export function buildManifest(site: SiteConfig): WebManifest {
  return {
    name: site.name,
    short_name: site.shortName,
    description: site.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    theme_color: site.themeColor,
    background_color: site.backgroundColor,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'New file', url: './?open=new-file', description: 'Start a new file in the workspace' },
      { name: 'Visual builder', url: './?open=builder', description: 'Open the block canvas' },
      { name: 'Terminal', url: './?open=terminal', description: 'Open the terminal panel' },
    ],
  }
}

/**
 * What the social card says.
 *
 * The title is already written as "Name — tagline", which is the shape a
 * card wants: something large and something small. Splitting it here keeps
 * one authored string in `site.json` instead of three that can disagree.
 */
export function cardText(site: SiteConfig): { heading: string; tagline: string } {
  const [heading, ...rest] = site.title.split(/\s*[—–|:-]\s+/)
  const tagline = rest.join(' — ').trim()
  return {
    heading: (heading || site.name).trim(),
    tagline: tagline || site.description.split(/(?<=\.)\s/)[0] || '',
  }
}

// ------------------------------------------------------------- head tags

/** Marks the block this module owns, so re-running the build replaces it. */
export const HEAD_START = '<!-- tungsten:site -->'
export const HEAD_END = '<!-- /tungsten:site -->'

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Writes the real build into the boot screen.
 *
 * The boot screen shows the version and the build id because that is the
 * difference between a decoration and an instrument: when somebody says
 * the site is broken, the first question is always which copy of it they
 * are looking at, and the answer is already on their screen.
 *
 * The page ships with `dev` and `local` in those slots, which is exactly
 * what a developer running the dev server should see. Each stamp is
 * independent -- Vite knows the version at build time, and only
 * `build-web.mjs` knows the build id -- so this is called twice with
 * different halves of the answer.
 */
export function stampBuild(html: string, stamp: { version?: string; buildId?: string }): string {
  const write = (text: string, slot: 'version' | 'build', value: string | undefined) => {
    if (!value) return text
    return text.replace(
      new RegExp(`(<span data-boot-${slot}>)[^<]*(</span>)`),
      `$1${escapeAttribute(value)}$2`,
    )
  }
  return write(write(html, 'version', stamp.version), 'build', stamp.buildId)
}

/**
 * The tags a deployed page needs and a dev page does not.
 *
 * Absolute URLs appear only when there is a domain to make them from: a
 * social card pointing at `undefined/icons/social.png` is worse than no
 * social card, because a crawler caches it.
 */
export function buildHeadTags(site: SiteConfig): string {
  const url = siteUrl(site)
  const image = siteUrl(site, site.socialImage)
  const attribute = (value: string) => escapeAttribute(value)

  const tags = [
    `<link rel="manifest" href="./manifest.webmanifest" />`,
    `<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<meta name="apple-mobile-web-app-title" content="${attribute(site.shortName)}" />`,
    `<meta name="application-name" content="${attribute(site.shortName)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${attribute(site.name)}" />`,
    `<meta property="og:title" content="${attribute(site.title)}" />`,
    `<meta property="og:description" content="${attribute(site.description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attribute(site.title)}" />`,
    `<meta name="twitter:description" content="${attribute(site.description)}" />`,
  ]

  if (url) {
    tags.push(`<link rel="canonical" href="${attribute(url)}" />`)
    tags.push(`<meta property="og:url" content="${attribute(url)}" />`)
  }
  if (image) {
    tags.push(`<meta property="og:image" content="${attribute(image)}" />`)
    tags.push(`<meta name="twitter:image" content="${attribute(image)}" />`)
  }

  return [HEAD_START, ...tags.map((tag) => `    ${tag}`), `    ${HEAD_END}`].join('\n')
}

/**
 * Puts those tags in the page, replacing any that are already there.
 *
 * Idempotent, because the build runs more than once and a page that grows a
 * second canonical link every time is a page that ends up with nine.
 */
export function injectHead(html: string, site: SiteConfig): string {
  const block = buildHeadTags(site)
  const start = html.indexOf(HEAD_START)
  const end = html.indexOf(HEAD_END)

  let next: string
  if (start >= 0 && end > start) {
    next = html.slice(0, start) + block.trimStart() + html.slice(end + HEAD_END.length)
  } else {
    const head = html.indexOf('</head>')
    if (head < 0) return html
    next = `${html.slice(0, head)}${block}\n  ${html.slice(head)}`
  }

  // The title and description live in the source page too, so a developer
  // reading it sees the real ones; the deployed copy takes whatever
  // site.json says now.
  next = next.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttribute(site.title)}</title>`)
  next = next.replace(
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${escapeAttribute(site.description)}" />`,
  )
  next = next.replace(
    /<meta name="theme-color" content="[^"]*"\s*\/>/,
    `<meta name="theme-color" content="${escapeAttribute(site.themeColor)}" />`,
  )
  return next
}

// ------------------------------------------------------- crawler plumbing

export function buildRobots(site: SiteConfig): string {
  const sitemap = siteUrl(site, 'sitemap.xml')
  return [
    'User-agent: *',
    'Allow: /',
    ...(sitemap ? ['', `Sitemap: ${sitemap}`] : []),
    '',
  ].join('\n')
}

/** Returns undefined without a domain: a sitemap of relative URLs is invalid. */
export function buildSitemap(site: SiteConfig, paths: string[] = ['']): string | undefined {
  const root = siteUrl(site)
  if (!root) return undefined
  const entries = paths
    .map((path) => siteUrl(site, path))
    .filter((url): url is string => Boolean(url))
    .map((url) => `  <url><loc>${url}</loc></url>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * The deep-link page.
 *
 * Tungsten has no routes, so a request for a path that is not the app is a
 * mistake rather than a route to rewrite. It is sent to the root with a
 * meta refresh, which needs no JavaScript and no host-specific rewrite
 * rule -- and, unlike copying index.html, cannot break on a relative asset
 * path resolved from the wrong depth.
 */
export function buildNotFoundPage(site: SiteConfig): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${escapeAttribute(site.themeColor)}" />
    <meta http-equiv="refresh" content="0; url=/" />
    <link rel="canonical" href="/" />
    <title>${escapeAttribute(site.name)}</title>
    <style>
      body {
        margin: 0;
        display: grid;
        place-items: center;
        min-height: 100vh;
        background: ${site.backgroundColor};
        color: #d5d9d5;
        font-family: 'DM Sans', Inter, -apple-system, system-ui, sans-serif;
      }
      a { color: #c8f169; }
    </style>
  </head>
  <body>
    <p>Nothing lives here. <a href="/">Open ${escapeAttribute(site.name)}</a>.</p>
  </body>
</html>
`
}

/**
 * Headers for the static hosts that read a `_headers` file.
 *
 * Hashed assets are immutable and are told so, which is the difference
 * between a returning visit costing 16 MB and costing nothing. The page
 * itself must never be cached, or a deploy would be invisible to anyone
 * who had already been here.
 */
export function buildHeaders(): string {
  return [
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/icons/*',
    '  Cache-Control: public, max-age=604800',
    '',
    '/sw.js',
    '  Cache-Control: no-cache',
    '',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    // The builder preview is a sandboxed iframe with no same-origin access,
    // so it is unaffected; this stops anyone else framing the IDE.
    '  X-Frame-Options: SAMEORIGIN',
    '',
  ].join('\n')
}
