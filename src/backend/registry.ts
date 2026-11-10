/**
 * The backend dropdown.
 *
 * Every backend Tungsten knows about, in the order a user should see
 * them, with the three that work implemented and the three that are
 * next declared rather than hidden. A planned adapter that appears in
 * the list with a date is a roadmap; a planned adapter that appears and
 * then throws a stack trace is a bug report, so `create` on an
 * unbuilt adapter refuses with a sentence naming what to use instead.
 *
 * Switching backends is a project setting, not a rewrite: the canvas
 * speaks the Universal Data Contract, so the only thing that changes
 * when this dropdown changes is which translation layer is underneath.
 */

import {
  BackendError,
  NO_CAPABILITIES,
  type AdapterConfig,
  type AdapterInfo,
  type BackendAdapter,
  type TungstenBackend,
} from './contract'
import { supabaseAdapter } from './adapters/supabase'
import { vortexAdapter } from './adapters/vortex'
import { selfHostedAdapter } from './adapters/selfHosted'

/** An adapter that is on the roadmap and honest about it. */
function planned(id: string, label: string, summary: string, fields: AdapterInfo['fields']): BackendAdapter {
  const info: AdapterInfo = { id, label, summary, status: 'planned', fields, capabilities: NO_CAPABILITIES }
  return {
    info,
    create: () => {
      throw new BackendError(
        'unsupported',
        `The ${label} adapter is not built yet. Supabase and the self-hosted service both work today, and a project can be moved between backends without touching the canvas.`,
      )
    },
  }
}

export const firebaseAdapter = planned(
  'firebase',
  'Firebase',
  'Firestore, Firebase Auth and Cloud Functions.',
  [
    { key: 'projectId', label: 'Project ID' },
    { key: 'apiKey', label: 'Web API key', secret: true },
  ],
)

export const appwriteAdapter = planned(
  'appwrite',
  'Appwrite',
  'Open source, self-hostable, with databases, auth, storage and functions.',
  [
    { key: 'url', label: 'Endpoint', placeholder: 'https://cloud.appwrite.io/v1' },
    { key: 'projectId', label: 'Project ID' },
    { key: 'apiKey', label: 'API key', secret: true, optional: true },
  ],
)

export const pocketbaseAdapter = planned(
  'pocketbase',
  'PocketBase',
  'One Go binary with SQLite, auth, files and realtime.',
  [
    { key: 'url', label: 'Server URL', placeholder: 'http://127.0.0.1:8090' },
    { key: 'adminToken', label: 'Admin token', secret: true, optional: true },
  ],
)

/**
 * The catalogue.
 *
 * Vortex is first because it is the flagship; Supabase is the default
 * until the Vortex fleet is live, which is a one-line change here and
 * nothing anywhere else.
 */
export const ADAPTERS: BackendAdapter[] = [
  vortexAdapter,
  supabaseAdapter,
  selfHostedAdapter,
  firebaseAdapter,
  appwriteAdapter,
  pocketbaseAdapter,
]

/** The backend a new project gets. */
export const DEFAULT_BACKEND = 'supabase'

export function adapterById(id: string): BackendAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.info.id === id)
}

/** Everything the dropdown needs, without exposing `create`. */
export function backendChoices(): AdapterInfo[] {
  return ADAPTERS.map((adapter) => adapter.info)
}

/** What a project saves: which backend, and what the user pasted in. */
export type BackendSettings = {
  adapter: string
  /** Field values by key. Secrets are stored exactly as entered. */
  config: Record<string, string>
}

export const DEFAULT_BACKEND_SETTINGS: BackendSettings = { adapter: DEFAULT_BACKEND, config: {} }

/** A saved setting, read defensively: an unknown adapter falls back. */
export function readBackendSettings(input: unknown): BackendSettings {
  if (typeof input !== 'object' || input === null) return { ...DEFAULT_BACKEND_SETTINGS }
  const raw = input as Record<string, unknown>
  const adapter = typeof raw.adapter === 'string' && adapterById(raw.adapter) ? raw.adapter : DEFAULT_BACKEND
  const config: Record<string, string> = {}
  if (typeof raw.config === 'object' && raw.config) {
    for (const [key, value] of Object.entries(raw.config as Record<string, unknown>)) {
      if (typeof value === 'string') config[key] = value
    }
  }
  return { adapter, config }
}

/** The fields an adapter needs that the settings do not have yet. */
export function missingFields(settings: BackendSettings): string[] {
  const adapter = adapterById(settings.adapter)
  if (!adapter) return []
  return adapter.info.fields
    .filter((field) => !field.optional && !settings.config[field.key]?.trim())
    .map((field) => field.label)
}

/**
 * Builds the backend a project is configured for.
 *
 * Transports are injected here rather than imported inside adapters, so
 * a test, the preview sandbox and the desktop build can each supply
 * their own without any adapter knowing the difference.
 */
export function createBackend(settings: BackendSettings, transports: Pick<AdapterConfig, 'http' | 'openSocket'> = {}): TungstenBackend {
  const adapter = adapterById(settings.adapter)
  if (!adapter) {
    throw new BackendError('invalid', `This project is set to the “${settings.adapter}” backend, which this build does not have.`)
  }
  const missing = missingFields(settings)
  if (missing.length) {
    throw new BackendError('invalid', `${adapter.info.label} still needs ${missing.join(' and ')}.`)
  }
  return adapter.create({ ...settings.config, ...transports })
}
