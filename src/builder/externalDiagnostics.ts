/**
 * Errors from outside the canvas, pointed back at the block that caused them.
 *
 * A type error from the language server, or a stack frame from a running
 * program, arrives as a line number in `src/generated/blocks.ts`. That is
 * useless to someone who has never opened that file -- they drew a graph.
 * The generator already records which block produced which line, so the
 * mapping exists; this turns it into diagnostics the canvas can show, in the
 * same shape the integrity checker produces, and blocks compilation while
 * any of them is an error.
 *
 * Pure, so the mapping can be tested with a table of line numbers instead of
 * a language server.
 */

import { nodeAtLine, type GeneratedProgram } from './codeGenerator'
import type { BuilderDiagnostic, IntegrityReport } from './integrity'

/** What a language server, compiler or runtime told us. */
export type ExternalProblem = {
  /** 1-based, in the generated file. */
  line: number
  column?: number
  message: string
  severity: 'error' | 'warning'
  /** Where it came from, for the message: 'TypeScript', 'runtime', … */
  source?: string
}

/**
 * Turns problems in the generated file into problems on the canvas.
 *
 * A problem on a line no block owns is kept, attached to nothing: losing it
 * would be worse than showing it without a home, and the panel still lists
 * it. Those carry an empty `nodeId`, which the canvas ignores.
 */
export function mapProblemsToBlocks(
  program: GeneratedProgram,
  problems: ExternalProblem[],
): BuilderDiagnostic[] {
  return problems.map((problem) => {
    const nodeId = nodeAtLine(program, problem.line) ?? ''
    const source = problem.source ? `${problem.source}: ` : ''
    return {
      severity: problem.severity,
      nodeId,
      message: `${source}${problem.message}`,
      fix: nodeId
        ? 'Fix it here, or edit the generated line; the two stay in step.'
        : `Line ${problem.line} of the generated file belongs to no block — check the file directly.`,
      // Reported under the rule the checker uses for a block it cannot make
      // sense of, so the canvas needs no new case to render it.
      code: 'unknown-block' as const,
    }
  })
}

/**
 * Folds external problems into an integrity report.
 *
 * The rule is the same one the checker applies to its own findings: an error
 * freezes compilation, a warning does not. A graph that compiles to code the
 * compiler rejects is not a graph that compiles.
 */
export function withExternalProblems(
  report: IntegrityReport,
  program: GeneratedProgram,
  problems: ExternalProblem[],
): IntegrityReport {
  if (!problems.length) return report
  const mapped = mapProblemsToBlocks(program, problems)
  const blocking = mapped.some((entry) => entry.severity === 'error')
  return {
    ...report,
    diagnostics: [...report.diagnostics, ...mapped],
    compilable: report.compilable && !blocking,
  }
}
