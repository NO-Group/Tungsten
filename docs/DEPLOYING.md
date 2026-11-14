# Deploying Tungsten to the web

Tungsten runs in a browser. The web build is a folder of static files —
no server, no runtime, nothing to configure on the host — so any static
host will serve it. These notes are written for Cloudflare Pages because
that is what `tungsten.no-group.org` runs on, but only the first table is
host-specific.

## The short version

```sh
npm run domain -- tungsten.no-group.org   # once, per deployment
npm run web:build                         # writes dist/
```

`dist/` is the site. Publish that folder, not the repository.

## Cloudflare Pages

| Setting | Value |
| --- | --- |
| Build command | `npm run web:build` |
| Build output directory | `dist` |
| Node version | 22 (set `NODE_VERSION=22` if the default is older) |
| Root directory | *(blank)* |

The output directory is the setting that matters. Leave it blank, or set
it to `/`, and Pages publishes the repository — including the repository's
own `index.html`, whose only script tag is `/src/main.tsx`. That file is
TypeScript. No browser can execute it and no static host will compile it,
so the page loads, paints the boot screen, and stops there for ever.

That is the single most likely cause of a Tungsten deployment that is
stuck on the boot screen, and both halves of it are now guarded:

- `npm run web:build` reads `dist/` back after writing it and refuses to
  finish if what it wrote would not start (`npm run web:check` runs the
  same check on demand). It follows every URL in the published
  `index.html` and fails if a script or stylesheet is missing, if the page
  points at `/src/`, or if a dev address was baked in.
- The page itself carries an inline watchdog. If the bundle has not taken
  over after nine seconds — or if a script 404s, which it notices
  immediately — the boot screen stops pretending and says what happened,
  with a **Try again** button and a **Clear cached app data** button.

## What the build writes

`npm run web:build` runs `npm run build` and then adds the things a
deployment needs that `vite build` does not know about:

| File | Why |
| --- | --- |
| `index.html` | With the canonical link, Open Graph and Twitter cards, and the title from `site.json` injected into the head |
| `manifest.webmanifest` | Makes it installable |
| `sw.js` | Offline shell; precaches ≤1.5 MB of it, caches the rest on use |
| `_headers` | Immutable caching for `/assets/*`, no-cache for `sw.js` and `index.html` |
| `_redirects` | `/* /index.html 200`, so deep links reach the app |
| `404.html` | For hosts that use it instead of `_redirects` |
| `robots.txt`, `sitemap.xml` | Only useful with a domain set |
| `CNAME` | Written only when `site.json` has a valid domain |

`sitemap.xml` and `CNAME` are skipped when no domain is set. The build
still works — every path it emits is relative, so the folder runs from any
address, including `file://` — you just do not get the canonical link, the
social card or the sitemap. `npm run domain` with no argument prints the
current setting.

## Which build am I looking at?

The boot screen says, bottom-left of the plate:

```
VERSION 3.0.0    BUILD 7f5029389028    MELTS AT 3422 °C
```

The version comes from `package.json` and is stamped by a Vite plugin, so
every build has it. The build id is the first twelve hex of a sha256 over
the published file list, stamped by `scripts/build-web.mjs`, and it is the
same id the service worker uses for its cache name (`tungsten-<id>`). So
a screenshot of a stuck boot screen already answers "which deploy?" and
"is the worker serving an old one?" — if the id on screen is not the id of
the deploy you expect, you are looking at a cached shell, and **Clear
cached app data** will fix it.

Both read `dev` / `local` on the dev server, which is correct: there is no
build to name.

## When the deployed site is stuck on the boot screen

Work down this list; it is ordered by how often each one is the answer.

1. **Is the host publishing `dist/`?** View source on the deployed page.
   If you see `src="/src/main.tsx"`, the output directory is wrong. Fix
   the setting and redeploy. This is the one the watchdog reports as
   *"The application bundle did not load"*.
2. **Is it a stale service worker?** A worker from an earlier deploy can
   keep serving an old shell that points at asset hashes which no longer
   exist. Press **Clear cached app data** on the boot screen; it
   unregisters every worker, deletes every cache and reloads. `_headers`
   marks `sw.js` as `no-cache` precisely so this cannot persist past one
   visit, but a host that ignores `_headers` can still do it.
3. **Did the build actually run?** `npm run web:check` locally against the
   same `dist/` the host built. If it passes locally and the site is still
   stuck, the host is not running the build command.
4. **Is something throwing at start-up?** The watchdog prints the message
   after nine seconds. A crash inside the app, rather than a missing file,
   shows as *"The application failed while starting"*.

## Running the build locally

```sh
npm run web:build
npm run web:serve     # serves dist/ the way a host would
npm run web:check     # re-reads dist/ and reports what a visitor would get
```

`npm run web:serve` is the closest thing to the deployed site you can get
without deploying: it serves the built folder over HTTP, so the service
worker registers and the `_redirects` behaviour is the only thing you are
still trusting.
