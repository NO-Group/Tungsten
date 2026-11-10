/**
 * The visual database schema.
 *
 * Tables and columns, drawn rather than typed. What the panel shows is what
 * the migration will say, so the SQL preview sits underneath it rather than
 * behind a button: the point of drawing a schema is seeing what you get.
 */

import { useState } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'

import {
  checkSchema,
  createMigration,
  type Column,
  type ColumnType,
  type DataSchema,
} from '../../builder/dataSchema'

const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'boolean', 'timestamp', 'json']

export type DataSchemaPanelProps = {
  schema: DataSchema
  onAddTable: () => void
  /** Drafts tables from a description of the app. */
  onDraft?: (description: string) => void
  onRenameTable: (index: number, name: string) => void
  onRemoveTable: (index: number) => void
  onAddColumn: (table: number) => void
  onUpdateColumn: (table: number, column: number, patch: Partial<Column>) => void
  onRemoveColumn: (table: number, column: number) => void
}

export function DataSchemaPanel(props: DataSchemaPanelProps) {
  const { schema, onDraft } = props
  const problems = checkSchema(schema)
  const [description, setDescription] = useState('')

  /** Drafts, then clears: the box is a question, not a document. */
  function draft() {
    if (!onDraft || !description.trim()) return
    onDraft(description)
    setDescription('')
  }

  return (
    <section className="builder-schema">
      <header>
        Database
        {/* Wrapped, not passed: onClick would hand the event in as the name. */}
        <button onClick={() => props.onAddTable()}><Plus size={12} /> Table</button>
      </header>

      {/* The fastest way to a schema is describing the app, so it sits
          above the tables rather than behind a menu. What it writes is a
          draft: every table it draws is editable right below it. */}
      {onDraft && (
        <div className="builder-schema-draft">
          <input
            aria-label="Describe the data"
            placeholder="A blog with posts and comments…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') draft() }}
          />
          <button
            aria-label="Draft the tables"
            title="Draft tables from that description"
            onClick={() => draft()}
            disabled={!description.trim()}
          >
            <Sparkles size={12} /> Draft
          </button>
        </div>
      )}

      {!schema.tables.length && (
        <p className="builder-clean">
          No tables yet. Add one, and the Query and Insert blocks have somewhere to point.
        </p>
      )}

      {schema.tables.map((table, tableIndex) => (
        <article className="builder-table" key={`${table.name}-${tableIndex}`}>
          <header>
            <input
              aria-label={`Table ${tableIndex + 1} name`}
              value={table.name}
              onChange={(event) => props.onRenameTable(tableIndex, event.target.value)}
            />
            <button
              aria-label={`Delete table ${table.name}`}
              onClick={() => props.onRemoveTable(tableIndex)}
            >
              <Trash2 size={12} />
            </button>
          </header>

          <ul>
            {table.columns.map((column, columnIndex) => (
              <li key={columnIndex}>
                <input
                  aria-label={`Column ${columnIndex + 1} of ${table.name}`}
                  value={column.name}
                  onChange={(event) => props.onUpdateColumn(tableIndex, columnIndex, { name: event.target.value })}
                />
                <select
                  aria-label={`Type of ${column.name}`}
                  value={column.type}
                  onChange={(event) => props.onUpdateColumn(tableIndex, columnIndex, {
                    type: event.target.value as ColumnType,
                  })}
                >
                  {COLUMN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <label title="Required">
                  <input
                    type="checkbox"
                    aria-label={`${column.name} is required`}
                    checked={Boolean(column.required)}
                    onChange={(event) => props.onUpdateColumn(tableIndex, columnIndex, {
                      required: event.target.checked,
                    })}
                  />
                  req
                </label>
                <label title="Unique">
                  <input
                    type="checkbox"
                    aria-label={`${column.name} is unique`}
                    checked={Boolean(column.unique)}
                    onChange={(event) => props.onUpdateColumn(tableIndex, columnIndex, {
                      unique: event.target.checked,
                    })}
                  />
                  uniq
                </label>
                <button
                  aria-label={`Delete column ${column.name}`}
                  onClick={() => props.onRemoveColumn(tableIndex, columnIndex)}
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>

          <button className="builder-add-column" onClick={() => props.onAddColumn(tableIndex)}>
            <Plus size={11} /> Column
          </button>
        </article>
      ))}

      {Boolean(problems.length) && (
        <ul className="builder-schema-problems">
          {problems.map((problem, index) => <li key={index}>{problem.message}</li>)}
        </ul>
      )}

      {Boolean(schema.tables.length) && (
        <pre className="builder-migration" aria-label="Migration preview">{createMigration(schema)}</pre>
      )}
    </section>
  )
}
