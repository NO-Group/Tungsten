/**
 * Folding an approved blueprint into the drawn schema.
 *
 * The merge is additive on purpose, and these tests are mostly about
 * what it refuses to do: it will not rename a table, retype a column,
 * or drop a column somebody drew by hand just because the generated
 * blueprint did not mention it. Anything destructive belongs in the
 * architect's review, where a human agrees to it in words.
 */

import { describe, expect, it } from 'vitest'

import { describeMerge, mergeSchema, type DataSchema } from './dataSchema'

const CANVAS: DataSchema = {
  tables: [
    {
      name: 'recipes',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'scribbled_note', type: 'text' },
      ],
    },
  ],
}

describe('mergeSchema', () => {
  it('adds a table it has never seen', () => {
    const merge = mergeSchema(CANVAS, { tables: [{ name: 'comments', columns: [{ name: 'body', type: 'text' }] }] })
    expect(merge.added).toEqual(['comments'])
    expect(merge.extended).toEqual([])
    expect(merge.schema.tables.map((table) => table.name)).toEqual(['recipes', 'comments'])
  })

  it('extends a table that already exists instead of replacing it', () => {
    const merge = mergeSchema(CANVAS, {
      tables: [{ name: 'recipes', columns: [{ name: 'title', type: 'text' }, { name: 'body', type: 'text' }] }],
    })
    expect(merge.added).toEqual([])
    expect(merge.extended).toEqual(['recipes'])

    const columns = merge.schema.tables[0].columns.map((column) => column.name)
    // The hand-drawn column survives, and the new one lands after it.
    expect(columns).toEqual(['title', 'scribbled_note', 'body'])
  })

  it('leaves an existing column type alone rather than retyping it', () => {
    const merge = mergeSchema(CANVAS, {
      tables: [{ name: 'recipes', columns: [{ name: 'title', type: 'number' }] }],
    })
    expect(merge.extended).toEqual([])
    expect(merge.schema.tables[0].columns[0]).toEqual({ name: 'title', type: 'text', required: true })
  })

  it('never removes a table the blueprint forgot to mention', () => {
    const merge = mergeSchema(CANVAS, { tables: [] })
    expect(merge.schema.tables).toHaveLength(1)
    expect(merge).toMatchObject({ added: [], extended: [] })
  })

  it('does not mutate the schema it was handed', () => {
    const before = JSON.stringify(CANVAS)
    mergeSchema(CANVAS, { tables: [{ name: 'recipes', columns: [{ name: 'body', type: 'text' }] }] })
    expect(JSON.stringify(CANVAS)).toBe(before)
  })

  it('says plainly when there was nothing to do', () => {
    expect(describeMerge(mergeSchema(CANVAS, { tables: [] }))).toBe('Nothing to add; the canvas already has all of it.')
  })

  it('names what it added and what it extended', () => {
    const merge = mergeSchema(CANVAS, {
      tables: [
        { name: 'recipes', columns: [{ name: 'body', type: 'text' }] },
        { name: 'cooks', columns: [{ name: 'name', type: 'text' }] },
      ],
    })
    expect(describeMerge(merge)).toBe('Added cooks. Extended recipes.')
  })
})
