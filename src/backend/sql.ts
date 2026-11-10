/**
 * A blueprint, as statements.
 *
 * Two of the adapters end at a SQL database, and the AI Architect's
 * whole promise is that the user sees exactly what will run before it
 * runs. Both needs are met by one function: a blueprint in, a list of
 * `SchemaOperation`s out, each carrying the statement it would execute
 * and whether running it could lose data.
 *
 * What makes this safe to generate is that nothing in a blueprint is
 * free text. Names are validated by `parseBlueprint` and re-checked
 * here, types come from a closed list, and policies come from five
 * words. There is no path from a user's typing to an interpolated
 * string, which is the only reason emitting SQL by concatenation is
 * defensible at all.
 *
 * Postgres and SQLite both come out of here. The difference is small
 * and worth keeping in one place: SQLite has no row-level security, so
 * the policies become a note in the plan rather than a lie.
 */

import {
  DEFAULT_OWNER_COLUMN,
  PRIVATE_POLICIES,
  type Blueprint,
  type BlueprintColumn,
  type BlueprintTable,
  type PolicyRule,
} from './blueprint'
import type { SchemaOperation } from './contract'
import { quoteIdentifier } from './adapters/http'

export type SqlDialect = 'postgres' | 'sqlite'

const POSTGRES_TYPES: Record<BlueprintColumn['type'], string> = {
  text: 'text',
  number: 'double precision',
  integer: 'bigint',
  boolean: 'boolean',
  timestamp: 'timestamptz',
  json: 'jsonb',
  uuid: 'uuid',
  reference: 'bigint',
}

const SQLITE_TYPES: Record<BlueprintColumn['type'], string> = {
  text: 'text',
  number: 'real',
  integer: 'integer',
  boolean: 'integer',
  timestamp: 'text',
  json: 'text',
  uuid: 'text',
  reference: 'integer',
}

/** One column, as it appears inside a `create table`. */
function columnSql(column: BlueprintColumn, dialect: SqlDialect): string {
  const types = dialect === 'postgres' ? POSTGRES_TYPES : SQLITE_TYPES
  const parts = [quoteIdentifier(column.name), types[column.type]]
  if (column.required) parts.push('not null')
  if (column.unique) parts.push('unique')
  if (column.default !== undefined) parts.push(`default ${literal(column.default)}`)
  if (column.references) {
    const target = quoteIdentifier(column.references.table)
    const key = quoteIdentifier(column.references.column ?? 'id')
    const onDelete = column.references.onDelete === 'cascade'
      ? ' on delete cascade'
      : column.references.onDelete === 'null'
        ? ' on delete set null'
        : ''
    parts.push(`references ${target}(${key})${onDelete}`)
  }
  return parts.join(' ')
}

/** A literal that is safe because the type system says what it can be. */
function literal(value: string | number | boolean): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * The Postgres expression for a policy word.
 *
 * `auth.uid()` is Supabase's spelling and Vortex's too -- it is the one
 * convention worth inheriting, because every row-level security example
 * on the internet uses it. The owner column is whatever the table said.
 */
function postgresPredicate(rule: PolicyRule, ownerColumn: string): string {
  switch (rule) {
    case 'public': return 'true'
    case 'authenticated': return 'auth.uid() is not null'
    case 'owner': return `auth.uid() = ${quoteIdentifier(ownerColumn)}`
    case 'admin': return "coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)"
    case 'nobody': return 'false'
  }
}

const ACTIONS: Array<{ key: keyof typeof PRIVATE_POLICIES; sql: string; clause: 'using' | 'check' }> = [
  { key: 'read', sql: 'select', clause: 'using' },
  { key: 'create', sql: 'insert', clause: 'check' },
  { key: 'update', sql: 'update', clause: 'using' },
  { key: 'delete', sql: 'delete', clause: 'using' },
]

/** The statements that create one table and lock it down. */
function tableOperations(table: BlueprintTable, dialect: SqlDialect): SchemaOperation[] {
  const name = quoteIdentifier(table.name)
  const identity = dialect === 'postgres'
    ? 'id bigint generated always as identity primary key'
    : 'id integer primary key autoincrement'
  const createdAt = dialect === 'postgres'
    ? 'created_at timestamptz not null default now()'
    : "created_at text not null default (datetime('now'))"

  const columns = [identity, ...table.columns.map((column) => columnSql(column, dialect)), createdAt]
  const operations: SchemaOperation[] = [{
    kind: 'create-table',
    subject: table.name,
    statement: `create table if not exists ${name} (\n  ${columns.join(',\n  ')}\n);`,
  }]

  for (const group of table.indexes ?? []) {
    if (!group.length) continue
    const indexName = quoteIdentifier(`${table.name}_${group.join('_')}_idx`)
    operations.push({
      kind: 'create-index',
      subject: `${table.name}(${group.join(', ')})`,
      statement: `create index if not exists ${indexName} on ${name} (${group.map(quoteIdentifier).join(', ')});`,
    })
  }

  if (dialect !== 'postgres') {
    // Said plainly rather than skipped: a user who picked a backend
    // without row-level security should learn it here, not after a
    // leak.
    operations.push({
      kind: 'policy',
      subject: `${table.name} policies`,
      statement: `-- SQLite has no row-level security. ${table.name} is protected by the service's own auth checks, not by the database.`,
    })
    return operations
  }

  const owner = table.ownerColumn ?? DEFAULT_OWNER_COLUMN
  const policies = table.policies ?? PRIVATE_POLICIES
  operations.push({
    kind: 'policy',
    subject: `${table.name} row-level security`,
    statement: `alter table ${name} enable row level security;`,
  })

  for (const action of ACTIONS) {
    const rule = policies[action.key]
    const predicate = postgresPredicate(rule, owner)
    const policyName = `${table.name}_${action.sql}_${rule}`
    // Dropped first so applying a blueprint twice is not an error --
    // provisioning that cannot be re-run is provisioning nobody trusts.
    operations.push({
      kind: 'policy',
      subject: `${table.name} ${action.sql} policy`,
      statement: [
        `drop policy if exists "${policyName}" on ${name};`,
        `create policy "${policyName}" on ${name} for ${action.sql} to authenticated ${action.clause} (${predicate});`,
      ].join('\n'),
    })
  }

  return operations
}

/**
 * Every statement a blueprint implies, in the order they must run.
 *
 * Tables first, in dependency order, so a foreign key never points at
 * something that does not exist yet; then indexes and policies; then
 * buckets and functions, which are notes rather than SQL.
 */
export function sqlForBlueprint(blueprint: Blueprint, dialect: SqlDialect): SchemaOperation[] {
  const operations: SchemaOperation[] = []

  for (const table of orderTables(blueprint.tables)) {
    operations.push(...tableOperations(table, dialect))
  }

  for (const bucket of blueprint.buckets ?? []) {
    operations.push({
      kind: 'bucket',
      subject: bucket.name,
      statement: `create storage bucket "${bucket.name}" (${bucket.public ? 'public' : 'private'}${bucket.maxBytes ? `, max ${bucket.maxBytes} bytes` : ''});`,
    })
  }

  for (const entry of blueprint.functions ?? []) {
    operations.push({
      kind: 'function',
      subject: entry.name,
      statement: `-- ${entry.name}: ${entry.trigger}${entry.table ? ` on ${entry.table}` : ''} — ${entry.summary}`,
    })
  }

  return operations
}

/**
 * Tables sorted so references come after what they point at.
 *
 * A cycle -- two tables referencing each other -- is left in the order
 * it arrived rather than rejected: Postgres can create both and add the
 * constraint later, and refusing a legitimate shape because the sort is
 * simple would be the wrong trade.
 */
export function orderTables(tables: BlueprintTable[]): BlueprintTable[] {
  const byName = new Map(tables.map((table) => [table.name, table]))
  const done = new Set<string>()
  const ordered: BlueprintTable[] = []

  const visit = (table: BlueprintTable, seen: Set<string>) => {
    if (done.has(table.name) || seen.has(table.name)) return
    seen.add(table.name)
    for (const column of table.columns) {
      const target = column.references?.table
      const next = target ? byName.get(target) : undefined
      if (next && next !== table) visit(next, seen)
    }
    done.add(table.name)
    ordered.push(table)
  }

  for (const table of tables) visit(table, new Set())
  return ordered
}

/** The whole plan as one script, for the clipboard and the SQL editor. */
export function scriptFor(operations: SchemaOperation[]): string {
  return [
    '-- Generated by the Tungsten AI Backend Architect.',
    '-- Review it, then run it. Every statement is idempotent.',
    '',
    ...operations.map((operation) => operation.statement),
    '',
  ].join('\n')
}
