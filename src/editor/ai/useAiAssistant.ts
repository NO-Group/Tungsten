/**
 * The assistant, as workbench state.
 *
 * Holds the mode, the turns, and the one thing that actually matters: an
 * edit reaches a buffer through `onEdit`, which is the workbench's ordinary
 * "this file changed" path. Nothing here writes to Monaco directly. That is
 * what makes the propagation free -- an accepted edit is indistinguishable
 * from typing, so the builder's file sync picks it up and moves the blocks
 * without anyone telling it to.
 */

import { useCallback, useRef, useState } from 'react'

import {
  appliesImmediately, mayMutate, previewOf, settle, withChunk,
  type AiContext, type AiMode, type AiTurn,
} from './aiModel'
import { localAssistant, type AiProvider } from './providers'

export type AiHost = {
  /** Applies an edit the way a keystroke would. */
  onEdit: (path: string, next: string) => void
  notify: (message: string) => void
  /** Defaults to the offline rules assistant. */
  provider?: AiProvider
}

export type AiAssistant = {
  mode: AiMode
  setMode: (mode: AiMode) => void
  open: boolean
  setOpen: (open: boolean) => void
  turns: AiTurn[]
  busy: boolean
  provider: AiProvider
  /** Runs a prompt against the given editor context. */
  ask: (prompt: string, context: AiContext) => Promise<void>
  /** Applies a proposed edit. Only meaningful for a turn in diff mode. */
  accept: (id: number) => void
  discard: (id: number) => void
  clear: () => void
  /** What the buffer would become, for the diff view. */
  preview: (id: number) => string | undefined
}

export function useAiAssistant(host: AiHost): AiAssistant {
  const provider = host.provider ?? localAssistant
  const [mode, setMode] = useState<AiMode>('advisor')
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<AiTurn[]>([])
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  const { onEdit, notify } = host

  const ask = useCallback(async (prompt: string, context: AiContext) => {
    const text = prompt.trim()
    if (!text || busy) return

    const id = nextId.current
    nextId.current += 1
    const turn: AiTurn = { id, prompt: text, mode, context, answer: '', state: 'streaming' }

    setTurns((current) => [...current, turn])
    setBusy(true)

    const update = (change: (value: AiTurn) => AiTurn) => {
      setTurns((current) => current.map((entry) => (entry.id === id ? change(entry) : entry)))
    }

    try {
      const proposal = await provider.run({ prompt: text, context }, (chunk) => {
        update((entry) => withChunk(entry, chunk))
      })

      const settled = settle({ ...turn, answer: '' }, proposal)
      update(() => settled)

      // The one place a buffer is written without being asked again, and it
      // is gated on the mode twice: once here, once in `settle`.
      if (settled.state === 'applied' && mayMutate(mode) && appliesImmediately(mode)) {
        onEdit(context.path, previewOf(settled))
        notify(proposal.summary ? `${proposal.summary} — applied` : 'Applied the assistant’s edit')
      }
    } catch (error) {
      update((entry) => ({ ...entry, state: 'failed', error: (error as Error).message }))
      notify(`The assistant failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [busy, mode, notify, onEdit, provider])

  const accept = useCallback((id: number) => {
    setTurns((current) => current.map((entry) => {
      if (entry.id !== id || entry.state !== 'proposed') return entry
      // Advisor turns can never reach 'proposed', so this cannot bypass it.
      onEdit(entry.context.path, previewOf(entry))
      notify(entry.proposal?.summary ? `${entry.proposal.summary} — applied` : 'Applied the assistant’s edit')
      return { ...entry, state: 'applied' }
    }))
  }, [notify, onEdit])

  const discard = useCallback((id: number) => {
    setTurns((current) => current.map((entry) => (
      entry.id === id && entry.state === 'proposed' ? { ...entry, state: 'discarded' } : entry
    )))
  }, [])

  const clear = useCallback(() => setTurns([]), [])

  const preview = useCallback((id: number) => {
    const turn = turns.find((entry) => entry.id === id)
    return turn ? previewOf(turn) : undefined
  }, [turns])

  return { mode, setMode, open, setOpen, turns, busy, provider, ask, accept, discard, clear, preview }
}
