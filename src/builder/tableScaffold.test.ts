/**
 * The generated screen, held to the standard a shipped recipe is held to.
 *
 * It has to instantiate with no refused links, generate code, pass the
 * integrity checker with no errors, and survive the parser — the same
 * four tests `recipes.test.ts` applies, because a starter that arrives
 * with a red badge is worse than no starter.
 */

import { describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { parseProgram } from './codeParser'
import { checkIntegrity } from './integrity'
import { resetIds } from './graph'
import { instantiate } from './recipes'
import { formColumns, scaffoldFor } from './tableScaffold'
import type { Table } from './dataSchema'

const registry = createRegistry(builtinBlocks)
const empty = { nodes: [], connections: [] }

const posts: Table = {
  name: 'posts',
  columns: [
    { name: 'id', type: 'number' },
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'text' },
    { name: 'published', type: 'boolean' },
    { name: 'user_id', type: 'number' },
    { name: 'created_at', type: 'timestamp' },
  ],
}

/** The graph a table scaffolds to. */
function built(table: Table) {
  resetIds()
  return instantiate(scaffoldFor(table), empty, registry)
}

describe('scaffolding a screen from a table', () => {
  it('asks for the columns the user fills in, and no others', () => {
    expect(formColumns(posts).map((column) => column.name)).toEqual(['title', 'body', 'published'])
  })

  it('stops at four fields, however wide the table', () => {
    const wide: Table = {
      name: 'wide',
      columns: 'abcdefg'.split('').map((letter) => ({ name: `col_${letter}`, type: 'text' as const })),
    }
    expect(formColumns(wide)).toHaveLength(4)
  })

  it('instantiates without a single refused link', () => {
    const result = built(posts)
    expect(result.rejected).toEqual([])
    expect(result.added.length).toBe(scaffoldFor(posts).blocks.length)
  })

  it('passes the integrity checker it will be judged by', () => {
    const report = checkIntegrity(built(posts).graph, registry)
    expect(report.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(report.compilable).toBe(true)
  })

  it('writes a program that reads, writes and reloads the table', () => {
    const code = generateProgram(built(posts).graph, registry).code
    expect(code).toContain('await db.select("posts")')
    expect(code).toContain('await db.insert("posts", { "title": render.value("posts-title")')
    expect(code).toContain('"published": render.value("posts-published")')
    expect(code).toContain('render.heading({ id: "posts-heading", text: "Posts", level: 2 })')
    // The reload is what makes the list show the row that was just added.
    expect(code.match(/db\.select\("posts"\)/g)).toHaveLength(2)
  })

  it('uses a checkbox for a boolean and an input for everything else', () => {
    const types = built(posts).graph.nodes.map((node) => node.type)
    expect(types.filter((type) => type === 'ui.input')).toHaveLength(2)
    expect(types.filter((type) => type === 'ui.checkbox')).toHaveLength(1)
  })

  it('comes back unchanged through the parser', () => {
    const code = generateProgram(built(posts).graph, registry).code
    const back = parseProgram(code, registry)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(generateProgram(back.graph, registry).code).toBe(code)
  })

  it('scaffolds a table with nothing but generated columns', () => {
    const bare: Table = { name: 'pings', columns: [{ name: 'id', type: 'number' }] }
    const result = built(bare)
    expect(result.rejected).toEqual([])
    const report = checkIntegrity(result.graph, registry)
    expect(report.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([])
    // No fields, so the row it writes is empty — and that still compiles.
    expect(generateProgram(result.graph, registry).code).toContain('db.insert("pings", {})')
  })

  it('names itself after the table, in words', () => {
    const recipe = scaffoldFor({ name: 'blog_posts', columns: [{ name: 'title', type: 'text' }] })
    expect(recipe.id).toBe('table-blog_posts')
    expect(recipe.name).toBe('Blog posts screen')
    expect(recipe.outcome).toContain('1 field')
  })
})
