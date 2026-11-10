/**
 * The Tungsten Schema blueprint.
 *
 * One JSON document describing everything a project needs from a
 * backend: tables, columns, relationships, row-level security, storage
 * buckets and functions. It is what the AI Architect writes, what the
 * approval gate renders, and what every adapter is handed to provision
 * against. Nothing in Tungsten applies a schema from any other shape.
 *
 * Three properties make it worth being a format rather than a pile of
 * calls:
 *
 * - **Portable.** Nothing in here is Postgres, Firestore or Vortex. A
 *   policy says `owner`, not `auth.uid() = owner_id`; the adapter knows
 *   how its backend spells that.
 * - **Reviewable.** Every field is something a person can read in a
 *   dialog before approving. If a value cannot be explained in a line
 *   of English, it does not belong in a blueprint.
 * - **Checkable.** `parseBlueprint` validates untrusted JSON -- an AI
 *   reply, a pasted file, a project saved by an older version -- and
 *   returns problems as sentences. A model that hallucinates a column
 *   type gets a refusal, not a migration.
 *
 * Blueprints are the bridge in both directions: the visual Data tab
 * converts to one (`blueprintFromSchema`) and back (`schemaFromBlueprint`),
 * so the canvas stays the single source of truth and the blueprint stays
 * the single thing adapters understand.
 */

import { safeName, type ColumnType, type DataSchema, type Table } from '../builder/dataSchema'
import { planSchema } from '../builder/schemaPlanner'

/** Bumped when the shape changes in a way an older reader would misread. */
export const BLUEPRINT_VERSION = 1

/** The column types a blueprint may use, across every backend. */
export const BLUEPRINT_TYPES = [
  'text', 'number', 'integer', 'boolean', 'timestamp', 'json', 'uuid', 'reference',
] as const

export type BlueprintType = (typeof BLUEPRINT_TYPES)[number]

export type BlueprintColumn = {
  name: string
  type: BlueprintType
  required?: boolean
  unique?: boolean
  /** A literal default. Strings only, so it survives JSON and review. */
  default?: string | number | boolean
  /** For `reference` columns: the table it points at. */
  references?: { table: string; column?: string; onDelete?: 'cascade' | 'restrict' | 'null' }
  /** One line, shown in the approval gate. */
  description?: string
}

/**
 * Who may do a thing to a row.
 *
 * Five words, deliberately. Every backend can express these, and a user
 * can tell at a glance what each means -- which is the entire point of
 * a security summary. `owner` means "the row's `owner_id` is the signed
 * in user"; the adapter writes whatever that is in its own dialect.
 */
export type PolicyRule = 'public' | 'authenticated' | 'owner' | 'admin' | 'nobody'

export type PolicySet = {
  read: PolicyRule
  create: PolicyRule
  update: PolicyRule
  delete: PolicyRule
}

/** Locked down: the default a table gets when the AI says nothing. */
export const PRIVATE_POLICIES: PolicySet = { read: 'owner', create: 'authenticated', update: 'owner', delete: 'owner' }

/** For reference data -- categories, plans, anything everyone reads. */
export const PUBLIC_READ_POLICIES: PolicySet = { read: 'public', create: 'admin', update: 'admin', delete: 'admin' }

export type BlueprintTable = {
  name: string
  /** Shown in the gate; defaults to the name. */
  label?: string
  description?: string
  columns: BlueprintColumn[]
  policies?: PolicySet
  /** The column holding the owning user, when policies mention `owner`. */
  ownerColumn?: string
  /** Publish row changes on this table. */
  realtime?: boolean
  /** Column groups to index, in query order. */
  indexes?: string[][]
}

export type BlueprintBucket = {
  name: string
  public?: boolean
  maxBytes?: number
  /** Allowed content types, e.g. `['image/*']`. */
  allow?: string[]
  description?: string
}

export type BlueprintFunction = {
  name: string
  trigger: 'http' | 'insert' | 'update' | 'delete' | 'schedule'
  /** For row triggers. */
  table?: string
  /** For scheduled functions: a cron expression. */
  schedule?: string
  /** What it is for, in a line. The AI writes this; the user reads it. */
  summary: string
}

export type Blueprint = {
  version: number
  /** The project this describes. */
  name: string
  description?: string
  tables: BlueprintTable[]
  buckets?: BlueprintBucket[]
  functions?: BlueprintFunction[]
  /** Remarks from whoever wrote it: assumptions, guesses, things left out. */
  notes?: string[]
}

/** The owner column a table gets when it does not name one. */
export const DEFAULT_OWNER_COLUMN = 'owner_id'

/** Columns every table has, which a blueprint never lists. */
export const IMPLICIT_COLUMNS = ['id', 'created_at'] as const

/* ------------------------------------------------------------ validation */

const TYPES = new Set<string>(BLUEPRINT_TYPES)
const RULES = new Set<string>(['public', 'authenticated', 'owner', 'admin', 'nobody'])
const NAME = /^[a-z][a-z0-9_]*$/

export type BlueprintParse =
  | { ok: true; blueprint: Blueprint; warnings: string[] }
  | { ok: false; problems: string[] }

/**
 * Reads untrusted JSON as a blueprint.
 *
 * Strict about anything that would reach a database -- names, types,
 * policy words, references -- and forgiving about anything cosmetic. A
 * missing description is a shrug; a column type of `varchar(255)` is a
 * refusal, because the whole promise of the format is that it means the
 * same thing on five backends.
 */
export function parseBlueprint(input: unknown): BlueprintParse {
  const problems: string[] = []
  const warnings: string[] = []

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, problems: ['A blueprint is a JSON object.'] }
  }
  const raw = input as Record<string, unknown>

  const version = typeof raw.version === 'number' ? raw.version : BLUEPRINT_VERSION
  if (version > BLUEPRINT_VERSION) {
    problems.push(`This blueprint is version ${version}; this build of Tungsten reads version ${BLUEPRINT_VERSION}.`)
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'App'
  const rawTables = Array.isArray(raw.tables) ? raw.tables : undefined
  if (!rawTables) problems.push('A blueprint needs a "tables" array.')

  const tables: BlueprintTable[] = []
  const names = new Set<string>()

  for (const entry of rawTables ?? []) {
    if (typeof entry !== 'object' || entry === null) { problems.push('Every table is an object.'); continue }
    const table = entry as Record<string, unknown>
    const tableName = typeof table.name === 'string' ? table.name.trim() : ''
    if (!NAME.test(tableName)) {
      problems.push(`“${tableName || 'unnamed'}” is not a usable table name: lower case, starting with a letter.`)
      continue
    }
    if (names.has(tableName)) { problems.push(`Two tables are called ${tableName}.`); continue }
    names.add(tableName)

    const rawColumns = Array.isArray(table.columns) ? table.columns : []
    if (!rawColumns.length) warnings.push(`${tableName} has no columns of its own.`)

    const columns: BlueprintColumn[] = []
    const seen = new Set<string>()
    for (const columnEntry of rawColumns) {
      if (typeof columnEntry !== 'object' || columnEntry === null) continue
      const column = columnEntry as Record<string, unknown>
      const columnName = typeof column.name === 'string' ? column.name.trim() : ''
      if (!NAME.test(columnName)) {
        problems.push(`${tableName}.${columnName || 'unnamed'} is not a usable column name.`)
        continue
      }
      if ((IMPLICIT_COLUMNS as readonly string[]).includes(columnName)) {
        // Harmless, and worth saying: every table gets these anyway.
        warnings.push(`${tableName}.${columnName} is added automatically; it was ignored.`)
        continue
      }
      if (seen.has(columnName)) { problems.push(`${tableName} lists ${columnName} twice.`); continue }
      seen.add(columnName)

      const type = typeof column.type === 'string' ? column.type : ''
      if (!TYPES.has(type)) {
        problems.push(`${tableName}.${columnName} has type “${type}”, which is not one of ${BLUEPRINT_TYPES.join(', ')}.`)
        continue
      }

      const parsed: BlueprintColumn = { name: columnName, type: type as BlueprintType }
      if (column.required === true) parsed.required = true
      if (column.unique === true) parsed.unique = true
      if (typeof column.description === 'string') parsed.description = column.description
      if (typeof column.default === 'string' || typeof column.default === 'number' || typeof column.default === 'boolean') {
        parsed.default = column.default
      }

      const references = column.references as Record<string, unknown> | undefined
      if (type === 'reference') {
        const target = references && typeof references.table === 'string' ? references.table.trim() : ''
        if (!NAME.test(target)) {
          problems.push(`${tableName}.${columnName} is a reference but does not say to which table.`)
          continue
        }
        parsed.references = { table: target }
        if (typeof references?.column === 'string') parsed.references.column = references.column
        const onDelete = references?.onDelete
        if (onDelete === 'cascade' || onDelete === 'restrict' || onDelete === 'null') parsed.references.onDelete = onDelete
      }
      columns.push(parsed)
    }

    const policies = readPolicies(table.policies, tableName, problems)
    const parsedTable: BlueprintTable = { name: tableName, columns, policies }
    if (typeof table.label === 'string') parsedTable.label = table.label
    if (typeof table.description === 'string') parsedTable.description = table.description
    if (table.realtime === true) parsedTable.realtime = true
    if (typeof table.ownerColumn === 'string' && NAME.test(table.ownerColumn)) parsedTable.ownerColumn = table.ownerColumn
    if (Array.isArray(table.indexes)) {
      parsedTable.indexes = table.indexes
        .filter((group): group is string[] => Array.isArray(group) && group.every((part) => typeof part === 'string'))
    }
    tables.push(parsedTable)
  }

  // References are checked once every table is known, so order in the
  // file does not matter.
  for (const table of tables) {
    for (const column of table.columns) {
      const target = column.references?.table
      if (target && !names.has(target)) {
        problems.push(`${table.name}.${column.name} points at ${target}, which this blueprint does not create.`)
      }
    }
    if (usesOwner(table) && !ownerColumnOf(table)) {
      warnings.push(`${table.name} is owner-scoped, so an ${table.ownerColumn ?? DEFAULT_OWNER_COLUMN} column was added.`)
    }
  }

  const buckets = readBuckets(raw.buckets, problems)
  const functions = readFunctions(raw.functions, names, problems)
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string') : []

  if (problems.length) return { ok: false, problems }

  const blueprint: Blueprint = {
    version: BLUEPRINT_VERSION,
    name,
    tables: tables.map((table) => withOwnerColumn(table)),
  }
  if (typeof raw.description === 'string') blueprint.description = raw.description
  if (buckets.length) blueprint.buckets = buckets
  if (functions.length) blueprint.functions = functions
  if (notes.length) blueprint.notes = notes

  return { ok: true, blueprint, warnings }
}

function readPolicies(input: unknown, table: string, problems: string[]): PolicySet {
  if (input === undefined) return { ...PRIVATE_POLICIES }
  if (typeof input !== 'object' || input === null) {
    problems.push(`${table}'s policies are not an object.`)
    return { ...PRIVATE_POLICIES }
  }
  const raw = input as Record<string, unknown>
  const read = (action: keyof PolicySet): PolicyRule => {
    const value = raw[action]
    if (value === undefined) return PRIVATE_POLICIES[action]
    if (typeof value !== 'string' || !RULES.has(value)) {
      problems.push(`${table}'s ${action} policy is “${String(value)}”; use one of ${[...RULES].join(', ')}.`)
      return PRIVATE_POLICIES[action]
    }
    return value as PolicyRule
  }
  return { read: read('read'), create: read('create'), update: read('update'), delete: read('delete') }
}

function readBuckets(input: unknown, problems: string[]): BlueprintBucket[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) { problems.push('"buckets" is an array.'); return [] }
  const buckets: BlueprintBucket[] = []
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!NAME.test(name)) { problems.push(`“${name || 'unnamed'}” is not a usable bucket name.`); continue }
    const bucket: BlueprintBucket = { name }
    if (raw.public === true) bucket.public = true
    if (typeof raw.maxBytes === 'number' && raw.maxBytes > 0) bucket.maxBytes = Math.floor(raw.maxBytes)
    if (Array.isArray(raw.allow)) bucket.allow = raw.allow.filter((type): type is string => typeof type === 'string')
    if (typeof raw.description === 'string') bucket.description = raw.description
    buckets.push(bucket)
  }
  return buckets
}

function readFunctions(input: unknown, tables: Set<string>, problems: string[]): BlueprintFunction[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) { problems.push('"functions" is an array.'); return [] }
  const functions: BlueprintFunction[] = []
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const trigger = typeof raw.trigger === 'string' ? raw.trigger : ''
    if (!NAME.test(name)) { problems.push(`“${name || 'unnamed'}” is not a usable function name.`); continue }
    if (!['http', 'insert', 'update', 'delete', 'schedule'].includes(trigger)) {
      problems.push(`${name} has trigger “${trigger}”; use http, insert, update, delete or schedule.`)
      continue
    }
    const parsed: BlueprintFunction = {
      name,
      trigger: trigger as BlueprintFunction['trigger'],
      summary: typeof raw.summary === 'string' ? raw.summary : '',
    }
    if (typeof raw.table === 'string') {
      if (!tables.has(raw.table)) problems.push(`${name} triggers on ${raw.table}, which this blueprint does not create.`)
      parsed.table = raw.table
    } else if (trigger !== 'http' && trigger !== 'schedule') {
      problems.push(`${name} triggers on a row change but names no table.`)
      continue
    }
    if (typeof raw.schedule === 'string') parsed.schedule = raw.schedule
    functions.push(parsed)
  }
  return functions
}

/* ------------------------------------------------------------- utilities */

/** Does anything about this table depend on knowing who owns a row? */
export function usesOwner(table: BlueprintTable): boolean {
  const policies = table.policies ?? PRIVATE_POLICIES
  return Object.values(policies).includes('owner')
}

/** The column holding the owner, if the table already has one. */
export function ownerColumnOf(table: BlueprintTable): string | undefined {
  const named = table.ownerColumn
  if (named && table.columns.some((column) => column.name === named)) return named
  const found = table.columns.find((column) => (
    column.name === DEFAULT_OWNER_COLUMN || column.name === 'user_id'
  ))
  return found?.name
}

/**
 * Adds the owner column an owner-scoped table needs.
 *
 * A policy that reads `owner_id` on a table with no `owner_id` is not a
 * policy, it is an outage. Rather than refusing the blueprint, the
 * column is added and the warning says so: the AI meant the right thing
 * and forgot the plumbing, which is the commonest way these come back.
 */
export function withOwnerColumn(table: BlueprintTable): BlueprintTable {
  if (!usesOwner(table)) return table
  const existing = ownerColumnOf(table)
  if (existing) return { ...table, ownerColumn: existing }
  const name = table.ownerColumn ?? DEFAULT_OWNER_COLUMN
  return {
    ...table,
    ownerColumn: name,
    columns: [
      ...table.columns,
      { name, type: 'reference', required: true, references: { table: 'users', onDelete: 'cascade' }, description: 'The signed-in user this row belongs to.' },
    ],
  }
}

/* ---------------------------------------------------- the visual bridge */

const TO_COLUMN_TYPE: Record<BlueprintType, ColumnType> = {
  text: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  timestamp: 'timestamp',
  json: 'json',
  uuid: 'text',
  reference: 'number',
}

/** A blueprint as the Data tab draws it. */
export function schemaFromBlueprint(blueprint: Blueprint): DataSchema {
  return {
    tables: blueprint.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        name: column.name,
        type: TO_COLUMN_TYPE[column.type],
        required: column.required,
        unique: column.unique,
      })),
    })),
  }
}

/** The drawn schema as a blueprint, with policies applied. */
export function blueprintFromSchema(
  schema: DataSchema,
  options: { name?: string; policies?: PolicySet; realtime?: boolean } = {},
): Blueprint {
  const tables: BlueprintTable[] = schema.tables.map((table: Table) => withOwnerColumn({
    name: safeName(table.name, 'table'),
    columns: table.columns.map((column) => {
      const parsed: BlueprintColumn = { name: safeName(column.name, 'column'), type: column.type }
      if (column.required) parsed.required = true
      if (column.unique) parsed.unique = true
      // A `<thing>_id` column on a drawn table is a reference in all but
      // name, and saying so is what gets a foreign key created.
      const target = /^(.*)_id$/.exec(parsed.name)?.[1]
      if (target && column.type === 'number') {
        parsed.type = 'reference'
        parsed.references = { table: `${target}s`, onDelete: 'cascade' }
      }
      return parsed
    }),
    policies: options.policies ?? { ...PRIVATE_POLICIES },
    realtime: options.realtime,
  }))

  // References to tables nobody drew are dropped back to plain numbers:
  // a foreign key to a missing table fails at apply time, and the drawn
  // schema is the user's, not the format's, to correct.
  const known = new Set(tables.map((table) => table.name))
  known.add('users')
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.references && !known.has(column.references.table)) {
        column.type = 'number'
        delete column.references
      }
    }
  }

  return { version: BLUEPRINT_VERSION, name: options.name ?? 'App', tables }
}

/**
 * A blueprint from a sentence.
 *
 * The planner that drafts the visual schema is also the first half of
 * the AI Architect: one vocabulary, one set of rules, two outputs. A
 * second, separate English-to-tables path would drift from this one
 * within a week.
 */
export function blueprintFromDescription(description: string, name = 'App'): Blueprint {
  const plan = planSchema(description)
  const blueprint = blueprintFromSchema({ tables: plan.tables }, { name, realtime: true })
  return plan.notes.length ? { ...blueprint, notes: plan.notes, description } : { ...blueprint, description }
}

/* ------------------------------------------------------- the review gate */

export type BlueprintSummary = {
  tables: Array<{ name: string; columns: string; policies: string; realtime: boolean }>
  buckets: string[]
  functions: string[]
  /** Everything about this blueprint that is worth a second look. */
  cautions: string[]
}

/**
 * The blueprint as the approval dialog shows it.
 *
 * Deliberately a data structure rather than markup: the same summary is
 * rendered in the panel, written into the notification, and asserted on
 * in tests. Policies are spelled out in English because "owner" means
 * nothing to somebody who has not read this file.
 */
export function summariseBlueprint(blueprint: Blueprint): BlueprintSummary {
  const cautions: string[] = []

  const tables = blueprint.tables.map((table) => {
    const policies = table.policies ?? PRIVATE_POLICIES
    if (policies.read === 'public') cautions.push(`Anyone on the internet can read ${table.name}.`)
    if (policies.create === 'public') cautions.push(`Anyone on the internet can write to ${table.name}.`)
    if (policies.delete === 'public' || policies.delete === 'authenticated') {
      cautions.push(`Any signed-in user can delete rows from ${table.name}.`)
    }
    return {
      name: table.name,
      columns: table.columns.map((column) => `${column.name} ${describeType(column)}`).join(', ') || 'id only',
      policies: describePolicies(policies),
      realtime: Boolean(table.realtime),
    }
  })

  for (const bucket of blueprint.buckets ?? []) {
    if (bucket.public) cautions.push(`The ${bucket.name} bucket is public: every uploaded file has a guessable URL.`)
  }

  return {
    tables,
    buckets: (blueprint.buckets ?? []).map((bucket) => `${bucket.name} (${bucket.public ? 'public' : 'private'})`),
    functions: (blueprint.functions ?? []).map((entry) => `${entry.name} — ${entry.trigger}${entry.table ? ` on ${entry.table}` : ''}`),
    cautions,
  }
}

function describeType(column: BlueprintColumn): string {
  const parts = [column.type === 'reference' ? `→ ${column.references?.table ?? '?'}` : column.type]
  if (column.required) parts.push('required')
  if (column.unique) parts.push('unique')
  return `(${parts.join(', ')})`
}

/** "Owners read and change their own rows; signed-in users create them." */
export function describePolicies(policies: PolicySet): string {
  const phrase: Record<PolicyRule, string> = {
    public: 'anyone',
    authenticated: 'any signed-in user',
    owner: 'the row’s owner',
    admin: 'admins',
    nobody: 'nobody',
  }
  return [
    `read: ${phrase[policies.read]}`,
    `create: ${phrase[policies.create]}`,
    `update: ${phrase[policies.update]}`,
    `delete: ${phrase[policies.delete]}`,
  ].join('; ')
}
