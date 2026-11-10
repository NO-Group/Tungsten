/**
 * The planner, held to its promises.
 *
 * It is a vocabulary and one relation rule, so the tests are about the
 * edges: what it recognises, what it declines, and what it never does
 * to a schema that already exists.
 */

import { describe, expect, it } from 'vitest'

import { EMPTY_SCHEMA, type DataSchema } from './dataSchema'
import { applyPlan, describePlan, planSchema } from './schemaPlanner'

/** The table names a description drafts, in order. */
const names = (description: string) => planSchema(description).tables.map((table) => table.name)

/** The columns of one drafted table. */
function columns(description: string, table: string): string[] {
  const found = planSchema(description).tables.find((entry) => entry.name === table)
  if (!found) throw new Error(`no ${table} in ${names(description).join(', ') || 'nothing'}`)
  return found.columns.map((column) => column.name)
}

describe('drafting a schema from a sentence', () => {
  it('reads the obvious case', () => {
    expect(names('A blog with posts and comments')).toEqual(['posts', 'comments'])
    expect(columns('A blog with posts and comments', 'posts')).toContain('title')
    expect(columns('A blog with posts and comments', 'posts')).toContain('published')
  })

  it('keeps the order the person thought of them in', () => {
    expect(names('comments on products, and orders')).toEqual(['comments', 'products', 'orders'])
  })

  it('says a thing once however many ways it was said', () => {
    expect(names('posts, blog posts, articles and stories')).toEqual(['posts'])
  })

  it('understands singulars, plurals and the awkward plurals', () => {
    expect(names('a recipe')).toEqual(['recipes'])
    expect(names('categories')).toEqual(['categories'])
    expect(names('a dish with photos')).toEqual(['recipes', 'photos'])
    expect(names('classes')).toEqual(['courses'])
  })

  it('points the child at the parent, but only one that was mentioned', () => {
    expect(columns('posts and comments', 'comments')).toContain('post_id')
    expect(columns('comments', 'comments')).not.toContain('post_id')
    // Products are nearer than users in the comment's own list.
    expect(columns('users, products and comments', 'comments')).toContain('product_id')
  })

  it('treats accounts as already built, and links to them', () => {
    const plan = planSchema('an app where users write notes')
    expect(plan.tables.map((table) => table.name)).toEqual(['notes'])
    expect(plan.tables[0].columns.map((column) => column.name)).toContain('user_id')
    expect(plan.notes.join(' ')).toContain('Accounts are built in')
  })

  it('still makes a table for a word it has never heard of', () => {
    const plan = planSchema('a tracker for telescopes')
    expect(plan.tables.map((table) => table.name)).toEqual(['telescopes'])
    expect(plan.tables[0].columns.map((column) => column.name)).toEqual(['name', 'notes'])
    expect(plan.notes.join(' ')).toContain('“telescope” is not a word this knows')
  })

  it('declines the words that are about the app rather than its data', () => {
    expect(names('a simple mobile app for my new startup')).not.toContain('apps')
    expect(names('build me a dashboard')).toEqual([])
    expect(names('')).toEqual([])
    expect(planSchema('').notes[0]).toContain('Describe your app')
  })

  it('declines verbs, acronyms, numbers and punctuation', () => {
    expect(names('top 10 cars!!!')).toEqual(['cars'])
    // Said in the plural, so it is something being stored; said once and
    // three letters long, it is what they called the app.
    expect(names('a b2b crm')).toEqual([])
    expect(names('users upload and share photos')).toEqual(['photos'])
  })

  it('is the same every time, which is the point of not calling a model', () => {
    const once = JSON.stringify(planSchema('a shop with products, orders and reviews'))
    const twice = JSON.stringify(planSchema('a shop with products, orders and reviews'))
    expect(once).toBe(twice)
  })
})

describe('merging a draft into a drawn schema', () => {
  const drawn: DataSchema = { tables: [{ name: 'posts', columns: [{ name: 'headline', type: 'text' }] }] }

  it('never touches a table that is already there', () => {
    const result = applyPlan(drawn, planSchema('posts and comments'))
    expect(result.added).toEqual(['comments'])
    expect(result.skipped).toEqual(['posts'])
    expect(result.schema.tables[0].columns.map((column) => column.name)).toEqual(['headline'])
    expect(result.schema.tables).toHaveLength(2)
  })

  it('refuses to redraw the tables the service already provides', () => {
    const result = applyPlan({ tables: [] }, { tables: [{ name: 'files', columns: [] }], notes: [] })
    expect(result.added).toEqual([])
    expect(result.skipped).toEqual(['files'])
  })

  it('leaves an empty schema empty when there was nothing to draft', () => {
    const result = applyPlan(EMPTY_SCHEMA, planSchema('hello'))
    expect(result.schema.tables).toEqual([])
  })

  it('says what it did in one sentence', () => {
    expect(describePlan(['posts'], [])).toBe('Drew 1 table: posts.')
    expect(describePlan(['posts', 'tags'], ['users'])).toBe('Drew 2 tables: posts, tags. users was already there.')
    expect(describePlan([], ['posts', 'tags'])).toBe('posts, tags were already there.')
    expect(describePlan([], [])).toBe('Nothing in that looked like a thing to store.')
  })
})
