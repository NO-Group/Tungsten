/**
 * The sync rule, as a rule.
 *
 * Every echo loop and lost edit this feature could have is decided here, so
 * they are settled in a table rather than discovered in a browser.
 */

import { describe, expect, it } from 'vitest'

import { decideSync, readSyncPreference, writeSyncPreference } from './fileSync'

const base = { enabled: true, hasBlocks: true }

describe('deciding which way to sync', () => {
  it('does nothing while sync is off', () => {
    expect(decideSync({ ...base, enabled: false, code: 'a', file: 'b' })).toEqual({ action: 'idle' })
  })

  it('does not create the file for an empty canvas', () => {
    expect(decideSync({ ...base, hasBlocks: false, code: '// nothing yet', file: undefined }))
      .toEqual({ action: 'idle' })
  })

  it('creates the file once there is something to mirror', () => {
    expect(decideSync({ ...base, code: 'app.onStart()', file: undefined }))
      .toEqual({ action: 'write', code: 'app.onStart()' })
  })

  it('stays quiet when the two already match', () => {
    expect(decideSync({ ...base, code: 'same', file: 'same', agreed: 'same' })).toEqual({ action: 'idle' })
  })

  it('writes the file when the blocks moved', () => {
    expect(decideSync({ ...base, code: 'next', file: 'agreed', agreed: 'agreed' }))
      .toEqual({ action: 'write', code: 'next' })
  })

  it('reads the file when the file moved', () => {
    expect(decideSync({ ...base, code: 'agreed', file: 'typed', agreed: 'agreed' }))
      .toEqual({ action: 'adopt', code: 'typed' })
  })

  it('keeps the file, and says so, when both moved', () => {
    const decision = decideSync({ ...base, code: 'from blocks', file: 'from a person', agreed: 'agreed' })
    expect(decision).toEqual({ action: 'adopt', code: 'from a person', conflict: true })
  })

  it('cannot loop: what it just wrote is what both sides agree on', () => {
    const written = decideSync({ ...base, code: 'v2', file: 'v1', agreed: 'v1' })
    expect(written).toEqual({ action: 'write', code: 'v2' })
    // The file now holds v2, and v2 is the agreement: nothing more to do.
    expect(decideSync({ ...base, code: 'v2', file: 'v2', agreed: 'v2' })).toEqual({ action: 'idle' })
  })

  it('remembers the choice, and defaults to synced', () => {
    expect(readSyncPreference(null)).toBe(true)
    expect(readSyncPreference('on')).toBe(true)
    expect(readSyncPreference('off')).toBe(false)
    expect(writeSyncPreference(false)).toBe('off')
    expect(readSyncPreference(writeSyncPreference(true))).toBe(true)
  })
})
