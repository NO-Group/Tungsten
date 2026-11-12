/**
 * The backend, as the built app sees it.
 *
 * Until now a generated app always called the routes of Tungsten's own
 * Node service — `/data/:table`, `/auth/sign-in` — whatever backend the
 * project was actually configured for. A project on Supabase built an
 * app that called addresses nobody was serving. The adapters under
 * `src/backend/adapters/` could not fix that: they are TypeScript the
 * IDE imports, and an exported app has no IDE in it.
 *
 * So a profile is the adapter's wire protocol reduced to data: a
 * dialect, a base address, the headers every request carries, and where
 * the session token goes. The runtime in `previewRuntime.ts` carries
 * one small encoder per dialect and reads the rest from this object,
 * which is baked into the page at build time. Changing backend changes
 * this JSON and nothing else in the emitted app.
 *
 * The rule this file exists to enforce: **a built app gets publishable
 * credentials only.** A Supabase service-role key or a PocketBase
 * superuser token in a page anyone can view-source is a database
 * anyone can empty, so those fields are dropped here and listed in
 * `withheld` so the product can say out loud that they were.
 */

import { adapterById, missingFields, type BackendSettings } from './registry'
import { VORTEX_DEFAULT_URL } from './adapters/vortex'

/** The wire protocols the generated runtime knows how to speak. */
export type RuntimeDialect = 'tungsten' | 'postgrest' | 'pocketbase' | 'vortex'

export type RuntimeProfile = {
  /** The adapter id this came from, so a build can be read back. */
  adapter: string
  label: string
  dialect: RuntimeDialect
  /** No trailing slash; the runtime always joins with one. */
  base: string
  /** Sent on every request. Publishable values only. */
  headers: Record<string, string>
  /**
   * Where a signed-in user's token goes.
   *
   * PocketBase takes a bare token; everyone else takes `Bearer `. One
   * line of data instead of a branch in four places.
   */
  token: { header: string; prefix: string }
  /** The collection or table holding users, where the dialect needs its name. */
  users?: string
  /** Credentials deliberately left out of the build, by field label. */
  withheld: string[]
}

/** Fields that must never reach a client: they are server credentials. */
const SERVER_ONLY = new Set(['serviceKey', 'adminKey', 'adminToken'])

/**
 * The profile for a project's backend, or undefined.
 *
 * Undefined is a normal answer twice over: for an adapter that is not
 * built yet, and for one whose credentials are half filled in. Both
 * cases mean "do not bake an address into the app" rather than "fail
 * the build", and the generated runtime falls back to the local
 * service exactly as it did before.
 */
export function runtimeProfileFor(settings: BackendSettings): RuntimeProfile | undefined {
  const adapter = adapterById(settings.adapter)
  if (!adapter || adapter.info.status === 'planned') return undefined
  if (missingFields(settings).length) return undefined

  const value = (key: string) => (settings.config[key] ?? '').trim()
  const trim = (url: string) => url.replace(/\/+$/, '')
  const withheld = adapter.info.fields
    .filter((item) => SERVER_ONLY.has(item.key) && value(item.key))
    .map((item) => item.label)

  const base: Omit<RuntimeProfile, 'dialect' | 'base' | 'headers' | 'token'> = {
    adapter: adapter.info.id,
    label: adapter.info.label,
    withheld,
  }

  switch (adapter.info.id) {
    case 'supabase': {
      const anonKey = value('anonKey')
      return {
        ...base,
        dialect: 'postgrest',
        base: trim(value('url')),
        // The anon key is meant to be public — it is the key the
        // browser sends — and row-level security is what makes that
        // safe. The service key, which bypasses it, stays behind.
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
        token: { header: 'authorization', prefix: 'Bearer ' },
      }
    }
    case 'vortex': {
      const projectKey = value('projectKey')
      return {
        ...base,
        dialect: 'vortex',
        base: trim(value('url') || VORTEX_DEFAULT_URL),
        headers: { 'x-vortex-project': projectKey, authorization: `Bearer ${projectKey}` },
        token: { header: 'authorization', prefix: 'Bearer ' },
      }
    }
    case 'pocketbase': {
      return {
        ...base,
        dialect: 'pocketbase',
        base: trim(value('url')),
        headers: {},
        // PocketBase reads the raw token, with no scheme in front of it.
        token: { header: 'authorization', prefix: '' },
        users: value('collection') || 'users',
      }
    }
    case 'self-hosted': {
      const token = value('token')
      return {
        ...base,
        dialect: 'tungsten',
        base: trim(value('url')),
        // A session token pasted into the IDE belongs to the person who
        // pasted it, not to everybody who downloads the app.
        headers: {},
        token: { header: 'authorization', prefix: 'Bearer ' },
        withheld: token ? [...withheld, 'Session token'] : withheld,
      }
    }
    default:
      return undefined
  }
}

/**
 * One sentence for the Backend panel.
 *
 * The thing worth saying is not the dialect, which nobody asked about:
 * it is which address the app will call and which credential was left
 * out of it.
 */
export function describeRuntimeProfile(profile: RuntimeProfile | undefined): string {
  if (!profile) {
    return 'Built apps will call the local Node service on their own machine, because this project has no complete backend yet.'
  }
  const host = hostOf(profile.base)
  const kept = `Built apps call ${profile.label} at ${host}.`
  if (!profile.withheld.length) return kept
  const list = profile.withheld.length === 1
    ? profile.withheld[0]
    : `${profile.withheld.slice(0, -1).join(', ')} and ${profile.withheld[profile.withheld.length - 1]}`
  return `${kept} ${list} stays in the IDE: it is a server credential, and a built app is readable by whoever downloads it.`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
