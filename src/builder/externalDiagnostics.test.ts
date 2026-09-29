/**
 * An error on a line, shown on the block that wrote that line.
 *
 * The interesting cases are the boundaries: a line inside a handler, the
 * handler's own opening line, a line no block owns, and what any of it does
 * to whether the graph may be compiled.
 */

import { describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { checkIntegrity } from './integrity'
import { resetIds } from './graph'
import { instantiate, recipeById } from './recipes'
import { mapProblemsToBlocks, withExternalProblems, type ExternalProblem } from './externalDiagnostics'

const registry = createRegistry(builtinBlocks)

/** A small graph with known lines: start → log. */
function program() {
  resetIds()
  const { graph } = instantiate(recipeById('api-call')!, { nodes: [], connections: [] }, registry)
  return { graph, generated: generateProgram(graph, registry) }
}

const problem = (line: number, extra: Partial<ExternalProblem> = {}): ExternalProblem => ({
  line,
  message: "Type 'string' is not assignable to type 'number'.",
  severity: 'error',
  source: 'TypeScript',
  ...extra,
})

describe('errors from outside the canvas', () => {
  it('points an error at the block that generated the line', () => {
    const { generated } = program()
    const statement = generated.code.split('\n').findIndex((line) => line.includes('http.request')) + 1

    const [mapped] = mapProblemsToBlocks(generated, [problem(statement)])
    expect(mapped.nodeId).toBe(generated.sourceMap.find((entry) => entry.line === statement)?.nodeId)
    expect(mapped.nodeId).not.toBe('')
    expect(mapped.message).toContain('TypeScript:')
    expect(mapped.fix).toContain('stay in step')
  })

  it('keeps a problem on a line no block owns, rather than losing it', () => {
    const { generated } = program()
    const [mapped] = mapProblemsToBlocks(generated, [problem(1)])
    expect(mapped.nodeId).toBe('')
    expect(mapped.fix).toContain('belongs to no block')
  })

  it('names the source, and manages without one', () => {
    const { generated } = program()
    const [withSource, without] = mapProblemsToBlocks(generated, [
      problem(4, { message: 'boom', source: 'runtime' }),
      problem(4, { message: 'boom', source: undefined }),
    ])
    expect(withSource.message).toBe('runtime: boom')
    expect(without.message).toBe('boom')
  })

  it('freezes compilation while an external error stands', () => {
    const { graph, generated } = program()
    const clean = checkIntegrity(graph, registry)
    expect(clean.compilable).toBe(true)

    const blocked = withExternalProblems(clean, generated, [problem(4)])
    expect(blocked.compilable).toBe(false)
    expect(blocked.diagnostics.length).toBe(clean.diagnostics.length + 1)
  })

  it('lets a warning through', () => {
    const { graph, generated } = program()
    const clean = checkIntegrity(graph, registry)
    const warned = withExternalProblems(clean, generated, [problem(4, { severity: 'warning' })])
    expect(warned.compilable).toBe(true)
    expect(warned.diagnostics).toHaveLength(clean.diagnostics.length + 1)
  })

  it('changes nothing when there is nothing to report', () => {
    const { graph, generated } = program()
    const clean = checkIntegrity(graph, registry)
    expect(withExternalProblems(clean, generated, [])).toBe(clean)
  })

  it('does not un-block a graph the checker already refused', () => {
    resetIds()
    // A Log block with no event above it: an orphan, and nothing to compile.
    const { graph } = instantiate(
      { id: 'x', name: 'x', summary: 'x', outcome: 'x', blocks: [{ type: 'logic.log', at: { x: 0, y: 0 } }], links: [] },
      { nodes: [], connections: [] },
      registry,
    )
    const report = checkIntegrity(graph, registry)
    const generated = generateProgram(graph, registry)
    expect(withExternalProblems(report, generated, []).compilable).toBe(report.compilable)
  })
})
