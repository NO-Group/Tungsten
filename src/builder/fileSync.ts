/**
 * Keeping the canvas and a real workspace file the same thing.
 *
 * Inside the builder, the blocks and the code pane are already two views of
 * one graph. This takes that one step further: the program becomes an actual
 * file in the workspace, open in ordinary editor tabs, and editing it *there*
 * moves the blocks -- so "the code" is not a preview the builder owns, it is
 * the file, and there is no export step between them.
 *
 * The whole problem is echoes. Writing the file changes the file, which would
 * look like an edit, which would rewrite the blocks, which would rewrite the
 * file. The way out is to remember the exact text last agreed on by both
 * sides: whichever side no longer matches it is the side that changed, and
 * the other side follows. That is what `decideSync` decides, and it is a pure
 * function so the rule can be tested rather than watched.
 */

/** The file a builder graph is mirrored into. */
export const BUILDER_SYNC_PATH = 'src/generated/blocks.ts'

/** Remembered in the builder's own storage, so the choice survives a reload. */
export const BUILDER_SYNC_KEY = 'tungsten.builder.sync.v1'

export type SyncInputs = {
  /** The text the builder currently holds, generated or typed in its pane. */
  code: string
  /** The file's content, or undefined when the file does not exist yet. */
  file?: string
  /** The last text both sides agreed on. */
  agreed?: string
  /** Sync does nothing at all while this is false. */
  enabled: boolean
  /** An empty canvas does not create the file; it would be noise. */
  hasBlocks: boolean
}

export type SyncDecision =
  /** Nothing to do: the two already match, or sync is off. */
  | { action: 'idle' }
  /** Put the builder's text into the file. */
  | { action: 'write'; code: string }
  /** Read the file into the blocks. */
  | { action: 'adopt'; code: string }
  /**
   * Both sides moved since they last agreed -- an external edit landing at
   * the same moment as a canvas change. The file wins, because a person's
   * typing is never the thing to throw away, but it is worth saying so.
   */
  | { action: 'adopt'; code: string; conflict: true }

export function decideSync(inputs: SyncInputs): SyncDecision {
  const { code, file, agreed, enabled, hasBlocks } = inputs
  if (!enabled) return { action: 'idle' }

  // Nothing on the canvas and no file: creating an empty generated file the
  // moment the builder opens would litter every workspace.
  if (file === undefined && !hasBlocks) return { action: 'idle' }
  if (file === undefined) return { action: 'write', code }
  if (file === code) return { action: 'idle' }

  const graphMoved = code !== agreed
  const fileMoved = file !== agreed

  if (graphMoved && fileMoved) return { action: 'adopt', code: file, conflict: true }
  if (fileMoved) return { action: 'adopt', code: file }
  return { action: 'write', code }
}

/** Reads the persisted on/off choice. Sync is on unless it was turned off. */
export function readSyncPreference(stored: string | null): boolean {
  return stored !== 'off'
}

export function writeSyncPreference(enabled: boolean): string {
  return enabled ? 'on' : 'off'
}
