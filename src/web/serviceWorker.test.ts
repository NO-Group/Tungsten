import { describe, it, expect } from 'vitest'
import {
  PRECACHE_LIMIT,
  cacheName,
  choosePrecache,
  precacheBytes,
  serviceWorkerSource,
  type BuiltFile,
} from './serviceWorker'

/** Roughly the shape of a real `dist/`, with the real offenders in it. */
const dist: BuiltFile[] = [
  { path: 'index.html', size: 4_000 },
  { path: 'manifest.webmanifest', size: 900 },
  { path: 'icons/icon-192.png', size: 32_000 },
  { path: 'icons/apple-touch-icon.png', size: 26_000 },
  { path: 'icons/icon-512.png', size: 206_000 },
  { path: 'icons/icon-maskable-512.png', size: 134_000 },
  { path: 'icons/social.png', size: 414_000 },
  { path: 'assets/index-AbCdEfGh.js', size: 22_000 },
  { path: 'assets/react-vendor-nMGWyzFd.js', size: 211_000 },
  { path: 'assets/App-CCMho75K.js', size: 515_000 },
  { path: 'assets/App-CX8nAxFi.css', size: 100_000 },
  { path: 'assets/editor-core-BoeN8Icr.css', size: 162_000 },
  { path: 'assets/editor-core-BPP2c7S2.js', size: 4_393_000 },
  { path: 'assets/ts.worker-9_CJKYKz.js', size: 6_913_000 },
  { path: 'assets/json.worker-izi4BK3w.js', size: 429_000 },
  { path: 'assets/jetbrains-mono-latin-500-normal-CJOVTJB7.woff', size: 28_000 },
  { path: 'assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2', size: 21_000 },
  { path: 'assets/codicon-Brq4_Ui5.ttf', size: 141_000 },
  { path: 'assets/icon-jAuscaGU.png', size: 895_000 },
]

describe('choosePrecache', () => {
  const list = choosePrecache(dist)

  it('always starts with the page itself', () => {
    expect(list[0]).toBe('./')
    expect(list).toContain('index.html')
  })

  it('takes the shell: styles, fonts, the entry and the framework', () => {
    expect(list).toContain('assets/index-AbCdEfGh.js')
    expect(list).toContain('assets/react-vendor-nMGWyzFd.js')
    expect(list).toContain('assets/App-CX8nAxFi.css')
    expect(list).toContain('assets/editor-core-BoeN8Icr.css')
    expect(list).toContain('assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2')
    expect(list).toContain('assets/codicon-Brq4_Ui5.ttf')
  })

  it('stores each face once, in the format every browser here supports', () => {
    expect(list).not.toContain('assets/jetbrains-mono-latin-500-normal-CJOVTJB7.woff')
  })

  it('leaves the language workers to the runtime cache', () => {
    expect(list).not.toContain('assets/ts.worker-9_CJKYKz.js')
    expect(list).not.toContain('assets/json.worker-izi4BK3w.js')
  })

  it('leaves the heavy feature chunks out too', () => {
    expect(list).not.toContain('assets/editor-core-BPP2c7S2.js')
    expect(list).not.toContain('assets/App-CCMho75K.js')
    expect(list).not.toContain('assets/icon-jAuscaGU.png')
  })

  it('takes the small icons and the manifest', () => {
    expect(list).toContain('icons/icon-192.png')
    expect(list).toContain('icons/apple-touch-icon.png')
    expect(list).toContain('manifest.webmanifest')
  })

  it('leaves the install-time artwork to the moment it is installed', () => {
    expect(list).not.toContain('icons/icon-512.png')
    expect(list).not.toContain('icons/icon-maskable-512.png')
  })

  it('never precaches the social card, which only a crawler reads', () => {
    expect(list).not.toContain('icons/social.png')
  })

  it('refuses anything over the limit whatever it is called', () => {
    const huge = choosePrecache([{ path: 'assets/index-Zz.js', size: PRECACHE_LIMIT + 1 }])
    expect(huge).toEqual(['./'])
  })

  it('keeps a first visit small', () => {
    expect(precacheBytes(dist)).toBeLessThan(900_000)
  })

  it('is stable across directory order', () => {
    expect(choosePrecache([...dist].reverse())).toEqual(list)
  })

  it('ignores files nested below assets', () => {
    expect(choosePrecache([{ path: 'assets/sub/index-Aa.js', size: 10 }])).toEqual(['./'])
  })
})

describe('cacheName', () => {
  it('changes with the build', () => {
    expect(cacheName('abc')).not.toBe(cacheName('abd'))
  })

  it('stays a legal cache key', () => {
    expect(cacheName('1.0.0+sha/🙂')).toMatch(/^tungsten-[a-zA-Z0-9._-]+$/)
  })
})

describe('serviceWorkerSource', () => {
  const source = serviceWorkerSource({ cache: 'tungsten-test', precache: ['./', 'index.html'] })

  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(`'use strict'; const self = { addEventListener() {} }; ${source}`)).not.toThrow()
  })

  it('embeds the cache name and the list', () => {
    expect(source).toContain('const CACHE = "tungsten-test"')
    expect(source).toContain('"index.html"')
  })

  it('handles the three lifecycle events', () => {
    expect(source).toContain("addEventListener('install'")
    expect(source).toContain("addEventListener('activate'")
    expect(source).toContain("addEventListener('fetch'")
  })

  it('deletes other versions of itself on activate', () => {
    expect(source).toContain('caches.delete')
    expect(source).toContain("key.startsWith('tungsten-')")
  })

  it('serves navigations network first with the shell behind them', () => {
    expect(source).toContain("request.mode === 'navigate'")
    expect(source).toContain('shellFirst')
  })

  it('never touches another origin or a mutation', () => {
    expect(source).toContain("request.method !== 'GET'")
    expect(source).toContain('url.origin !== self.location.origin')
  })

  it('waits to be told before replacing the running build', () => {
    expect(source).toContain('tungsten:skip-waiting')
    expect(source).toContain('self.skipWaiting()')
  })

  it('does not fail the whole install on one bad file', () => {
    expect(source).toContain('console.warn')
    expect(source).toContain('Promise.all(PRECACHE.map')
  })
})
