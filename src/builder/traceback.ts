/**
 * From a failure back to the block that caused it.
 *
 * A stack trace names a line in generated code, which is a file the user did
 * not write and should not have to read. The source map turns that line into
 * a block id; the canvas then reveals the block, and the message is rewritten
 * in terms of what the user drew rather than what the compiler emitted.
 */

import { nodeAtLine, type GeneratedProgram } from './codeGenerator'
import type { BlockRegistry } from './blockSchema'

export type Traceback = {
  /** The block to reveal, if the line could be mapped to one. */
  nodeId?: string
  line?: number
  /** The original message, kept verbatim for anyone who wants it. */
  raw: string
  /** The same failure, said in terms of the canvas. */
  message: string
}

/** Pulls the first plausible line number out of a compiler or runtime message. */
export function lineFromMessage(text: string): number | undefined {
  const patterns = [
    // A stack frame from the preview's generated function comes first: it is
    // the most specific, and the least likely to be a coincidence.
    /<anonymous>:(\d+):\d+/,
    /(?:^|[\s(])(?:line\s+)?(\d+):\d+/i,
    /\bline\s+(\d+)\b/i,
    /:(\d+)\)/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return Number(match[1])
  }
  return undefined
}

/**
 * Explains a failure against the graph.
 *
 * The line may come from the message itself -- a TypeScript error, a runtime
 * stack -- or be reported separately by the preview sandbox, which knows its
 * own offsets.
 */
export function explainFailure(
  program: GeneratedProgram,
  registry: BlockRegistry,
  raw: string,
  reportedLine?: number,
  nodeTypeById?: (nodeId: string) => string | undefined,
): Traceback {
  const line = reportedLine ?? lineFromMessage(raw)
  const nodeId = line === undefined ? undefined : nodeAtLine(program, line)
  if (!nodeId) return { line, raw, message: raw }

  const type = nodeTypeById?.(nodeId)
  const label = (type && registry.get(type)?.label) ?? 'a block'

  return {
    nodeId,
    line,
    raw,
    message: `“${label}” failed while running: ${raw}`,
  }
}
