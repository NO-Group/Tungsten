/**
 * Binds the builder to a file in the workspace.
 *
 * With this running, `src/generated/blocks.ts` is not an export target, it is
 * the program: open it in any editor tab and what you type moves the blocks,
 * move the blocks and the tab updates under you. The builder's own code pane
 * and that tab are the same text.
 *
 * The rule lives in `fileSync.ts` as a pure function; this hook is only the
 * plumbing around it -- read the file, decide, apply, remember what both
 * sides agreed on. Reads from the file are debounced because they arrive one
 * keystroke at a time; writes are not, because a graph change is one event.
 */

import { useEffect, useRef } from 'react'

import { BUILDER_SYNC_PATH, decideSync } from './fileSync'
import { PARSE_DEBOUNCE } from './useBuilder'

export type FileSyncHost = {
  /** The builder's current text, and whether there is anything to mirror. */
  code: string
  hasBlocks: boolean
  enabled: boolean
  /** The workspace file's content, or undefined when it does not exist. */
  file?: string
  /** Writes the file. Creates it when it is not there yet. */
  writeFile: (path: string, content: string) => void
  /** Hands text from the file to the builder. */
  adoptCode: (code: string) => void
  notify: (message: string) => void
  /** Overridable for tests; the mirrored path otherwise. */
  path?: string
}

export function useBuilderFileSync(host: FileSyncHost) {
  const { code, hasBlocks, enabled, file, writeFile, adoptCode, notify, path = BUILDER_SYNC_PATH } = host

  /** The text both sides last agreed on. Neither side is "the source". */
  const agreed = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Everything the effect needs that must not re-trigger it lives in a ref:
  // an effect that re-runs because a callback identity changed would fight
  // the debounce it is trying to honour. The ref is refreshed after each
  // commit, never during render.
  const actions = useRef({ writeFile, adoptCode, notify })
  useEffect(() => { actions.current = { writeFile, adoptCode, notify } })

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    // The agreement survives being switched off. Forgetting it would make
    // switching back on look like "both sides changed", and the file would
    // win -- silently discarding whatever was built on the canvas while
    // sync was off. Keeping it means the side that actually moved is still
    // the side that moved.
    if (!enabled) return undefined

    const decision = decideSync({ code, file, agreed: agreed.current, enabled, hasBlocks })
    if (decision.action === 'idle') {
      if (file !== undefined && file === code) agreed.current = code
      return undefined
    }

    if (decision.action === 'write') {
      agreed.current = decision.code
      actions.current.writeFile(path, decision.code)
      return undefined
    }

    // A file edit: wait for the typing to stop, exactly as the builder's own
    // pane does, then read it.
    if (timer.current) clearTimeout(timer.current)
    const adopted = decision.code
    const conflicted = 'conflict' in decision
    timer.current = setTimeout(() => {
      agreed.current = adopted
      actions.current.adoptCode(adopted)
      if (conflicted) actions.current.notify(`${path} changed outside the builder; the file was kept`)
    }, PARSE_DEBOUNCE)

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [code, enabled, file, hasBlocks, path])
}
