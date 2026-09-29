/**
 * Runs the integrity checker, in a worker when there is one.
 *
 * The contract is the same either way: a report is always available. In a
 * browser the work happens off the main thread and the previous report stays
 * on screen for the frame or two it takes; anywhere without workers -- a
 * test, a server render -- it runs inline and the answer is immediate.
 *
 * Reports are keyed by `docVersion`, so an answer that arrives after the
 * graph has moved on is discarded rather than shown.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { checkIntegrity, type IntegrityReport } from './integrity'
import { runIntegrity, type IntegrityRequest, type IntegrityResponse } from './integrityWorker'
import type { BlockGraph, BlockRegistry } from './blockSchema'
import type { PluginManifest } from './pluginBlocks'

export type IntegrityCheck = {
  report: IntegrityReport
  /** True while a worker answer for the current version is outstanding. */
  checking: boolean
  /** Which engine answered, so the UI can say so honestly. */
  engine: 'worker' | 'inline'
}

/** Workers are absent in jsdom and in any non-browser host. */
function workerAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined'
}

export function useIntegrityCheck(
  graph: BlockGraph,
  registry: BlockRegistry,
  docVersion: number,
  manifests: PluginManifest[] = [],
  state: readonly { name: string }[] = [],
): IntegrityCheck {
  const supported = workerAvailable()

  // The inline result is computed whenever there is no worker. The memo is
  // not conditional -- hooks cannot be -- but the work behind it is.
  const inline = useMemo(
    () => (supported ? undefined : checkIntegrity(graph, registry, state)),
    [graph, registry, state, supported],
  )

  const [fromWorker, setFromWorker] = useState<IntegrityResponse | undefined>(undefined)
  const worker = useRef<Worker | undefined>(undefined)

  useEffect(() => {
    if (!supported) return undefined
    const instance = new Worker(new URL('./integrityWorker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<IntegrityResponse>) => setFromWorker(event.data)
    // A worker that fails to start must not leave the canvas without a
    // checker; the inline result below covers it.
    instance.onerror = () => { worker.current = undefined }
    return () => {
      worker.current = undefined
      instance.terminate()
    }
  }, [supported])

  useEffect(() => {
    if (!supported || !worker.current) return
    const request: IntegrityRequest = { docVersion, graph, manifests, state: [...state] }
    worker.current.postMessage(request)
  }, [docVersion, graph, manifests, state, supported])

  return useMemo(() => {
    if (inline) return { report: inline, checking: false, engine: 'inline' as const }
    if (fromWorker && fromWorker.docVersion === docVersion) {
      return { report: fromWorker.report, checking: false, engine: 'worker' as const }
    }
    // Nothing for this version yet: show the last answer if there is one,
    // and otherwise fall back to running it here. A canvas without a report
    // would have to render as "no problems", which is a lie.
    const fallback = fromWorker?.report ?? runIntegrity({ docVersion, graph, manifests, state: [...state] }).report
    return { report: fallback, checking: true, engine: 'worker' as const }
  }, [docVersion, fromWorker, graph, inline, manifests, state])
}
