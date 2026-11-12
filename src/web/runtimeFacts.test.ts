/**
 * What this build can reach.
 *
 * The point of these is that each row changes with the environment.
 * A capability list that reads the same everywhere is a brochure.
 */

import { describe, expect, it } from 'vitest'

import { describeRuntime, readRuntime, type RuntimeInput } from './runtimeFacts'

const WEB: RuntimeInput = {
  protocol: 'https:',
  serviceWorker: true,
  pty: false,
  persistence: true,
  aiGateway: false,
}

const DESKTOP: RuntimeInput = {
  desktop: { platform: 'darwin', versions: { electron: '34.0.0', chromium: '132.0', node: '22.22.3' } },
  protocol: 'file:',
  serviceWorker: false,
  pty: true,
  persistence: true,
  aiGateway: true,
}

function state(input: RuntimeInput, id: string) {
  return describeRuntime(input).capabilities.find((capability) => capability.id === id)?.state
}

describe('describeRuntime', () => {
  it('gives the desktop shell the things only it has', () => {
    expect(state(DESKTOP, 'files')).toBe('yes')
    expect(state(DESKTOP, 'git')).toBe('yes')
    expect(state(DESKTOP, 'shell')).toBe('yes')
    expect(describeRuntime(DESKTOP).title).toBe('Desktop · darwin')
  })

  it('refuses them to a browser tab, with a reason', () => {
    expect(state(WEB, 'files')).toBe('no')
    expect(state(WEB, 'git')).toBe('no')
    const git = describeRuntime(WEB).capabilities.find((capability) => capability.id === 'git')
    expect(git?.detail).toContain('rather than inventing history')
  })

  it('calls the browser shell limited rather than yes or no', () => {
    // It is a real shell over a documented subset, and the PTY bridge
    // only exists while the dev server does. Neither "yes" nor "no" is
    // true, and claiming either is how people file bugs.
    expect(state(WEB, 'shell')).toBe('limited')
    expect(state({ ...WEB, pty: true }, 'shell')).toBe('limited')
    const withPty = describeRuntime({ ...WEB, pty: true }).capabilities.find((capability) => capability.id === 'shell')
    expect(withPty?.detail).toContain('stops when the server does')
  })

  it('explains a private-mode tab losing everything on reload', () => {
    expect(state({ ...WEB, persistence: false }, 'persistence')).toBe('no')
    const facts = describeRuntime({ ...WEB, persistence: false })
    expect(facts.capabilities.find((capability) => capability.id === 'persistence')?.detail)
      .toContain('Private-mode browsers do this')
  })

  it('knows a file:// folder is already offline rather than broken', () => {
    const offline = describeRuntime({ ...WEB, protocol: 'file:', serviceWorker: false })
    const row = offline.capabilities.find((capability) => capability.id === 'offline')
    expect(row?.state).toBe('no')
    expect(row?.detail).toContain('already runs without a network')
    expect(offline.summary).toContain('no server to ask')
  })

  it('reports the gateway honestly in both directions', () => {
    expect(state(WEB, 'ai')).toBe('no')
    expect(state({ ...WEB, aiGateway: true }, 'ai')).toBe('yes')
  })

  it('carries the versions a bug report needs', () => {
    expect(describeRuntime(DESKTOP).versions).toEqual([
      { label: 'Electron', value: '34.0.0' },
      { label: 'Chromium', value: '132.0' },
      { label: 'Node', value: '22.22.3' },
    ])
    expect(describeRuntime(WEB).versions).toEqual([{ label: 'Context', value: 'https' }])
  })
})

describe('readRuntime', () => {
  it('survives a scope with none of the browser globals', () => {
    const facts = readRuntime({} as typeof globalThis)
    expect(facts).toMatchObject({ protocol: 'file:', serviceWorker: false, persistence: false, desktop: undefined })
  })

  it('treats storage that throws as storage that is absent', () => {
    const scope = {
      location: { protocol: 'https:' },
      localStorage: {
        setItem: () => { throw new Error('denied') },
        removeItem: () => undefined,
      },
    } as unknown as typeof globalThis
    expect(readRuntime(scope).persistence).toBe(false)
  })
})
