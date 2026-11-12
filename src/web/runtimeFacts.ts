/**
 * What this copy of Tungsten can actually reach.
 *
 * The same code runs in three places — the Electron shell, a browser
 * tab served over HTTP, and a `file://` folder somebody unzipped — and
 * the differences are not cosmetic. One has a real shell and a real
 * file system; one has a sandboxed shell, a service worker and
 * localStorage; one has neither and cannot even cache itself.
 *
 * The `Desktop` / `Web` word in the status bar used to be the whole
 * story and led nowhere. This is the rest of it: a list of
 * capabilities with a plain sentence about each, so "why can't I open
 * a folder" has an answer that does not require reading the source.
 */

export type CapabilityState = 'yes' | 'no' | 'limited'

export type Capability = {
  id: string
  label: string
  state: CapabilityState
  /** One sentence. What it means here, not what it means in general. */
  detail: string
}

export type RuntimeInput = {
  /** `window.tungsten` if the preload bridge is there. */
  desktop?: {
    platform: string
    versions: { electron: string; chromium: string; node: string }
  }
  /** `location.protocol`, e.g. `https:` or `file:`. */
  protocol: string
  /** Whether a service worker container exists in this context. */
  serviceWorker: boolean
  /** Whether the sandboxed shell has a PTY bridge behind it (the dev server plugin). */
  pty: boolean
  /** Whether localStorage could be written. */
  persistence: boolean
  /** Whether this build was told an AI gateway address. */
  aiGateway: boolean
}

export type RuntimeFacts = {
  /** `Desktop · darwin` or `Web · https` — the headline. */
  title: string
  /** The one-line summary under it. */
  summary: string
  capabilities: Capability[]
  /** Version strings worth copying into a bug report. */
  versions: Array<{ label: string; value: string }>
}

const FILE_PROTOCOL = 'file:'

export function describeRuntime(input: RuntimeInput): RuntimeFacts {
  const desktop = Boolean(input.desktop)
  const offlineFile = input.protocol === FILE_PROTOCOL

  const capabilities: Capability[] = [
    {
      id: 'files',
      label: 'Real file system',
      state: desktop ? 'yes' : 'no',
      detail: desktop
        ? 'Open a folder, write to it, rename and delete. Edits land on disk.'
        : 'The workspace lives in the browser. Files you create are real to Tungsten but not to your disk until you export them.',
    },
    {
      id: 'shell',
      label: 'Shell',
      state: desktop ? 'yes' : input.pty ? 'limited' : 'limited',
      detail: desktop
        ? 'A real PTY: your login shell, your PATH, your aliases.'
        : input.pty
          ? 'A real PTY over the dev server, same origin only. It stops when the server does.'
          : 'A sandboxed shell that runs a documented subset against the in-memory workspace. It is not pretending to be bash.',
    },
    {
      id: 'git',
      label: 'Git',
      state: desktop ? 'yes' : 'no',
      detail: desktop
        ? 'Status, diffs, staging, branches and commits run against the real repository.'
        : 'No repository to talk to from a browser tab. The source-control view stays empty rather than inventing history.',
    },
    {
      id: 'persistence',
      label: 'Session persistence',
      state: input.persistence ? 'yes' : 'no',
      detail: input.persistence
        ? 'Open editors, layout, terminals, settings, keybindings and the builder graph survive a reload.'
        : 'Storage is blocked in this context, so everything resets on reload. Private-mode browsers do this.',
    },
    {
      id: 'offline',
      label: 'Works offline',
      state: desktop ? 'yes' : input.serviceWorker ? 'yes' : 'no',
      detail: desktop
        ? 'Nothing is fetched at run time.'
        : input.serviceWorker
          ? 'A service worker precaches the build, so a reload with no network still opens.'
          : offlineFile
            ? 'Opened from a file:// path, where service workers are not allowed. It already runs without a network.'
            : 'No service worker in this context: a reload needs the network.',
    },
    {
      id: 'updates',
      label: 'Updates',
      state: desktop ? 'yes' : input.serviceWorker ? 'yes' : 'no',
      detail: desktop
        ? 'Checked with the packaged updater and installed on restart.'
        : input.serviceWorker
          ? 'A new build is picked up by the service worker; the status bar offers the reload.'
          : 'Nothing to check against. Reload to get whatever the server is serving.',
    },
    {
      id: 'ai',
      label: 'AI gateway',
      state: input.aiGateway ? 'yes' : 'no',
      detail: input.aiGateway
        ? 'Prompts are metered and priced before they are sent, and billed against your credit balance.'
        : 'No gateway address in this build, so the assistant runs on the local provider and the architect drafts offline. Nothing is billed.',
    },
  ]

  const versions = input.desktop
    ? [
        { label: 'Electron', value: input.desktop.versions.electron },
        { label: 'Chromium', value: input.desktop.versions.chromium },
        { label: 'Node', value: input.desktop.versions.node },
      ]
    : [{ label: 'Context', value: input.protocol.replace(':', '') }]

  return {
    title: input.desktop ? `Desktop · ${input.desktop.platform}` : `Web · ${input.protocol.replace(':', '')}`,
    summary: input.desktop
      ? 'The Electron shell: a real file system, a real shell and a real Git underneath the same workbench.'
      : offlineFile
        ? 'A folder on disk, opened directly. Everything runs locally; there is no server to ask for anything.'
        : 'A browser tab. The workbench is identical; what differs is what the page is allowed to touch.',
    capabilities,
    versions,
  }
}

/** Reads the facts out of the current window, with the awkward parts guarded. */
export function readRuntime(scope: typeof globalThis & { window?: unknown } = globalThis): RuntimeInput {
  const view = scope as unknown as {
    tungsten?: { platform: string; versions: { electron: string; chromium: string; node: string } }
    location?: { protocol?: string }
    navigator?: { serviceWorker?: unknown }
    localStorage?: Storage
    __TUNGSTEN_PTY__?: boolean
  }

  // A browser in private mode throws on write rather than returning
  // false, which is exactly the case this screen exists to explain, so
  // the probe is a real write and the failure is the answer.
  const persistence = (() => {
    try {
      const key = 'tungsten.runtime.probe'
      view.localStorage?.setItem(key, '1')
      view.localStorage?.removeItem(key)
      return Boolean(view.localStorage)
    } catch {
      return false
    }
  })()

  return {
    desktop: view.tungsten ? { platform: view.tungsten.platform, versions: view.tungsten.versions } : undefined,
    protocol: view.location?.protocol ?? 'file:',
    serviceWorker: Boolean(view.navigator?.serviceWorker),
    pty: Boolean(view.__TUNGSTEN_PTY__),
    persistence,
    aiGateway: false,
  }
}
