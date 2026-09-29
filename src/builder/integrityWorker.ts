/**
 * The integrity checker, off the main thread.
 *
 * The checker is pure and, at the sizes graphs normally reach, cheap -- but
 * "normally" is doing work in that sentence. On a large graph it runs on
 * every mutation, which is every frame of a drag, and that is exactly when
 * the main thread has nothing to spare.
 *
 * Only data crosses the boundary. The registry cannot: its blocks carry
 * generator and parser functions, which do not survive being cloned. So the
 * worker rebuilds an identical registry from the built-in library plus the
 * workspace's plugin manifests, which are JSON by design.
 */

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { checkIntegrity, type IntegrityReport } from './integrity'
import { blockFromManifest, type PluginManifest } from './pluginBlocks'
import type { BlockGraph } from './blockSchema'

export type IntegrityRequest = {
  /** Echoed back, so a late answer to an old question can be discarded. */
  docVersion: number
  graph: BlockGraph
  manifests: PluginManifest[]
}

export type IntegrityResponse = {
  docVersion: number
  report: IntegrityReport
}

/** The whole job, shared by the worker and the synchronous fallback. */
export function runIntegrity(request: IntegrityRequest): IntegrityResponse {
  const plugins = request.manifests
    .map((manifest) => blockFromManifest(manifest))
    .filter((block): block is Exclude<ReturnType<typeof blockFromManifest>, string> => typeof block !== 'string')

  const registry = createRegistry([...builtinBlocks, ...plugins])
  return { docVersion: request.docVersion, report: checkIntegrity(request.graph, registry) }
}

// The worker entry point. Guarded because this module is imported directly by
// the fallback path and by tests, where there is no worker scope at all.
if (typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<IntegrityRequest>) => {
    self.postMessage(runIntegrity(event.data))
  }
}
