/**
 * A screen for a table, generated from the table.
 *
 * Once the tables exist, the first thing anyone builds on top of them is
 * the same thing every time: a heading, a form that writes a row, a list
 * that shows the rows, and a reload after the write. Twenty blocks of
 * nothing in particular, and the twenty blocks most likely to be wired
 * up slightly wrong.
 *
 * So the Data tab offers to do it. The result is an ordinary recipe --
 * ordinary blocks, placed and linked through the same `connect` the
 * canvas uses -- which means it can be edited, deleted and undone like
 * anything else the user drew. Nothing about it is special except that
 * nobody had to place it.
 *
 * It scaffolds against the columns the table actually has: a text column
 * becomes an input, a boolean becomes a checkbox, a number becomes an
 * input, and `created_at`, `id` and foreign keys are left alone because
 * the service fills those in.
 */

import { safeName, typeName, type Column, type Table } from './dataSchema'
import type { Recipe, RecipeBlock, RecipeLink } from './recipes'

const COLUMN = 300
const ROW = 120

/** Columns the user should not be asked to type in. */
function isGenerated(column: Column): boolean {
  return column.name === 'id' || column.name === 'created_at' || column.name.endsWith('_id')
}

/** The columns a form should offer, at most four of them. */
export function formColumns(table: Table): Column[] {
  return table.columns.filter((column) => !isGenerated(column) && column.type !== 'json').slice(0, 4)
}

/** `published_at` reads as "Published at" above a field. */
function label(name: string): string {
  const words = name.split('_').filter(Boolean)
  if (!words.length) return name
  return `${words[0][0].toUpperCase()}${words[0].slice(1)}${words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''}`
}

/**
 * The recipe for one table.
 *
 * Laid out in columns the way a person would lay it out: the load path
 * along the top, the form down the left, and the write path below it.
 * Positions matter more than they look -- events are emitted top to
 * bottom, so the list loads before the form is described.
 */
export function scaffoldFor(table: Table): Recipe {
  const name = safeName(table.name, 'table')
  const singular = typeName(name)
  const fields = formColumns(table)
  const blocks: RecipeBlock[] = []
  const links: RecipeLink[] = []
  const add = (block: RecipeBlock) => blocks.push(block) - 1

  // --- the list, loaded on start -------------------------------------
  const start = add({ type: 'event.start', at: { x: 0, y: 0 } })
  const heading = add({
    type: 'ui.heading',
    at: { x: COLUMN, y: 0 },
    values: { id: `${name}-heading`, text: label(name), level: 2 },
  })
  const query = add({ type: 'data.query', at: { x: COLUMN * 2, y: 0 }, values: { table: name } })
  const loop = add({ type: 'logic.forEach', at: { x: COLUMN * 3, y: 0 } })
  const rowText = add({ type: 'ui.text', at: { x: COLUMN * 4, y: 0 }, values: { id: `${name}-row` } })

  links.push([start, 'exec', heading, 'exec'])
  links.push([heading, 'exec', query, 'exec'])
  links.push([query, 'exec', loop, 'exec'])
  links.push([query, 'rows', loop, 'list'])
  links.push([loop, 'body', rowText, 'exec'])
  links.push([loop, 'item', rowText, 'value'])

  // --- the form ------------------------------------------------------
  // Chained off the loop rather than its body: the fields are part of
  // the screen, not part of each row.
  let tail = { block: loop, port: 'exec' }
  const inputs: Array<{ column: Column; id: string }> = []

  fields.forEach((column, index) => {
    const id = `${name}-${safeName(column.name, `field${index + 1}`)}`
    const block = column.type === 'boolean'
      ? add({
        type: 'ui.checkbox',
        at: { x: COLUMN, y: ROW * (index + 1.5) },
        values: { id, label: label(column.name) },
      })
      : add({
        type: 'ui.input',
        at: { x: COLUMN, y: ROW * (index + 1.5) },
        values: { id, placeholder: label(column.name) },
      })
    links.push([tail.block, tail.port, block, 'exec'])
    tail = { block, port: 'exec' }
    inputs.push({ column, id })
  })

  const button = add({
    type: 'ui.button',
    at: { x: COLUMN, y: ROW * (fields.length + 1.5) },
    values: { id: `${name}-save`, text: `Add ${singular.toLowerCase()}` },
  })
  links.push([tail.block, tail.port, button, 'exec'])

  // --- the write, on click -------------------------------------------
  const base = ROW * (fields.length + 3.2)
  const click = add({ type: 'event.click', at: { x: 0, y: base }, values: { target: `${name}-save` } })
  const row = add({ type: 'data.row', at: { x: COLUMN, y: base }, values: rowValues(inputs) })
  const insert = add({ type: 'data.insert', at: { x: COLUMN * 2, y: base }, values: { table: name } })
  const reload = add({ type: 'data.query', at: { x: COLUMN * 3, y: base }, values: { table: name } })
  const logged = add({ type: 'logic.log', at: { x: COLUMN * 4, y: base } })

  inputs.forEach(({ id }, index) => {
    const reader = add({
      type: 'ui.value',
      at: { x: 0, y: base + ROW * (index + 1) },
      values: { id },
    })
    links.push([reader, 'value', row, `value${index + 1}`])
  })

  links.push([click, 'exec', insert, 'exec'])
  links.push([row, 'row', insert, 'row'])
  links.push([insert, 'exec', reload, 'exec'])
  links.push([reload, 'exec', logged, 'exec'])
  links.push([reload, 'rows', logged, 'value'])

  return {
    id: `table-${name}`,
    name: `${label(name)} screen`,
    summary: `A heading, a form and a list, wired to the ${name} table.`,
    outcome: `a ${name} screen: ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}, a list and a save`,
    blocks,
    links,
  }
}

/** The column names, as the Row Fields block's properties. */
function rowValues(inputs: Array<{ column: Column }>): Record<string, string> {
  const values: Record<string, string> = {}
  inputs.forEach(({ column }, index) => {
    values[`name${index + 1}`] = safeName(column.name, `field${index + 1}`)
  })
  return values
}
