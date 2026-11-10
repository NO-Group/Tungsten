/**
 * A database, drafted from a sentence.
 *
 * "A blog with posts and comments" is how people describe an app, and
 * `posts(title text, body text, published boolean)` is what the backend
 * needs. This is the translation, done locally and deterministically:
 * the same sentence always drafts the same tables, with no network call
 * and nothing to configure.
 *
 * It is a vocabulary, not a language model. Thirty-odd entities people
 * actually build apps around, each with the columns that entity almost
 * always has, plus one rule about which things belong to which. A noun
 * it does not recognise still becomes a table -- with a name and a
 * created-at, which is the honest minimum -- rather than being dropped,
 * and the result is a draft the user then edits. Every table it writes
 * is a table they can rename, retype or delete in the panel next to it.
 *
 * What it deliberately will not do is guess at structure it cannot
 * defend: no inferred many-to-many join tables, no column invented from
 * an adjective, no nesting. A draft that is wrong in ways you cannot see
 * is worse than a draft that is small.
 */

import { safeName, type Column, type DataSchema, type Table } from './dataSchema'

/** The tables the generated service always has, drawn or not. */
export const BUILT_IN_TABLES = ['users', 'sessions', 'files'] as const

export type SchemaPlan = {
  /** The tables to add, in the order they were mentioned. */
  tables: Table[]
  /** Plain-English remarks: what was assumed, and what was left out. */
  notes: string[]
}

/** One recognised entity: the table name, and what it is usually made of. */
type Entity = {
  /** The plural table name. */
  table: string
  /** Every singular or plural word that means this entity. */
  words: string[]
  columns: Column[]
  /** Entities this one usually hangs off, best match first. */
  belongsTo?: string[]
}

const text = (name: string, required = false): Column => ({ name, type: 'text', required })
const number = (name: string): Column => ({ name, type: 'number' })
const flag = (name: string): Column => ({ name, type: 'boolean' })
const time = (name: string): Column => ({ name, type: 'timestamp' })

/**
 * The vocabulary.
 *
 * Chosen by asking, for each entity, "if someone says this word, what are
 * the three or four columns they certainly meant?" -- and stopping there.
 * A post has a title and a body. Whether it has a slug is a question only
 * its author can answer, so the panel is where that gets added.
 */
const ENTITIES: Entity[] = [
  {
    table: 'posts',
    words: ['post', 'posts', 'article', 'articles', 'blog', 'blogs', 'story', 'stories'],
    columns: [text('title', true), text('body'), flag('published'), time('published_at')],
    belongsTo: ['users'],
  },
  {
    table: 'comments',
    words: ['comment', 'comments', 'reply', 'replies'],
    columns: [text('body', true)],
    belongsTo: ['posts', 'products', 'photos', 'videos', 'users'],
  },
  {
    table: 'products',
    words: ['product', 'products', 'item', 'items', 'listing', 'listings'],
    columns: [text('name', true), text('description'), number('price'), number('stock')],
  },
  {
    table: 'orders',
    words: ['order', 'orders', 'purchase', 'purchases', 'checkout', 'checkouts'],
    columns: [text('status'), number('total')],
    belongsTo: ['customers', 'users'],
  },
  {
    table: 'customers',
    words: ['customer', 'customers', 'client', 'clients', 'buyer', 'buyers'],
    columns: [text('name', true), text('email'), text('phone')],
  },
  {
    table: 'tasks',
    words: ['task', 'tasks', 'todo', 'todos', 'to-do', 'ticket', 'tickets', 'issue', 'issues'],
    columns: [text('title', true), text('notes'), flag('done'), time('due_at')],
    belongsTo: ['projects', 'users'],
  },
  {
    table: 'projects',
    words: ['project', 'projects', 'board', 'boards', 'workspace', 'workspaces'],
    columns: [text('name', true), text('description')],
    belongsTo: ['teams', 'users'],
  },
  {
    table: 'teams',
    words: ['team', 'teams', 'organisation', 'organisations', 'organization', 'organizations', 'company', 'companies'],
    columns: [text('name', true)],
  },
  {
    table: 'messages',
    words: ['message', 'messages', 'chat', 'chats', 'dm', 'dms'],
    columns: [text('body', true), time('sent_at')],
    belongsTo: ['rooms', 'users'],
  },
  {
    table: 'rooms',
    words: ['room', 'rooms', 'channel', 'channels', 'conversation', 'conversations', 'thread', 'threads'],
    columns: [text('name', true), flag('private')],
  },
  {
    table: 'events',
    words: ['event', 'events', 'meeting', 'meetings', 'appointment', 'appointments'],
    columns: [text('title', true), text('location'), time('starts_at'), time('ends_at')],
    belongsTo: ['users'],
  },
  {
    table: 'bookings',
    words: ['booking', 'bookings', 'reservation', 'reservations'],
    columns: [text('status'), time('starts_at'), time('ends_at')],
    belongsTo: ['events', 'rooms', 'users'],
  },
  {
    table: 'notes',
    words: ['note', 'notes', 'memo', 'memos', 'entry', 'entries', 'journal', 'journals'],
    columns: [text('title', true), text('body')],
    belongsTo: ['users'],
  },
  {
    table: 'photos',
    words: ['photo', 'photos', 'picture', 'pictures', 'image', 'images', 'gallery', 'galleries'],
    columns: [text('caption'), text('url', true)],
    belongsTo: ['albums', 'users'],
  },
  {
    table: 'albums',
    words: ['album', 'albums', 'collection', 'collections'],
    columns: [text('name', true)],
    belongsTo: ['users'],
  },
  {
    table: 'videos',
    words: ['video', 'videos', 'clip', 'clips'],
    columns: [text('title', true), text('url', true), number('seconds')],
    belongsTo: ['users'],
  },
  {
    table: 'reviews',
    words: ['review', 'reviews', 'rating', 'ratings', 'feedback'],
    columns: [number('stars'), text('body')],
    belongsTo: ['products', 'places', 'recipes', 'users'],
  },
  {
    table: 'places',
    words: ['place', 'places', 'venue', 'venues', 'restaurant', 'restaurants', 'shop', 'shops', 'store', 'stores'],
    columns: [text('name', true), text('address'), number('latitude'), number('longitude')],
  },
  {
    table: 'recipes',
    words: ['recipe', 'recipes', 'dish', 'dishes'],
    columns: [text('name', true), text('ingredients'), text('steps'), number('minutes')],
    belongsTo: ['users'],
  },
  {
    table: 'invoices',
    words: ['invoice', 'invoices', 'bill', 'bills', 'receipt', 'receipts'],
    columns: [text('number', true), number('amount'), text('status'), time('due_at')],
    belongsTo: ['customers', 'orders'],
  },
  {
    table: 'payments',
    words: ['payment', 'payments', 'transaction', 'transactions'],
    columns: [number('amount'), text('currency'), text('status')],
    belongsTo: ['invoices', 'orders', 'users'],
  },
  {
    table: 'subscriptions',
    words: ['subscription', 'subscriptions', 'plan', 'plans', 'membership', 'memberships'],
    columns: [text('name', true), number('price'), text('interval'), flag('active')],
    belongsTo: ['users', 'teams'],
  },
  {
    table: 'categories',
    words: ['category', 'categories', 'tag', 'tags', 'label', 'labels', 'topic', 'topics'],
    columns: [text('name', true), text('colour')],
  },
  {
    table: 'courses',
    words: ['course', 'courses', 'class', 'classes', 'module', 'modules'],
    columns: [text('title', true), text('summary')],
    belongsTo: ['users'],
  },
  {
    table: 'lessons',
    words: ['lesson', 'lessons', 'chapter', 'chapters'],
    columns: [text('title', true), text('body'), number('position')],
    belongsTo: ['courses'],
  },
  {
    table: 'workouts',
    words: ['workout', 'workouts', 'exercise', 'exercises', 'session', 'sessions', 'run', 'runs'],
    columns: [text('name', true), number('minutes'), time('performed_at')],
    belongsTo: ['users'],
  },
  {
    table: 'habits',
    words: ['habit', 'habits', 'streak', 'streaks', 'goal', 'goals'],
    columns: [text('name', true), text('frequency'), flag('active')],
    belongsTo: ['users'],
  },
  {
    table: 'expenses',
    words: ['expense', 'expenses', 'spend', 'spending', 'budget', 'budgets'],
    columns: [text('description', true), number('amount'), time('spent_at')],
    belongsTo: ['categories', 'users'],
  },
  {
    table: 'contacts',
    words: ['contact', 'contacts', 'lead', 'leads', 'person', 'people'],
    columns: [text('name', true), text('email'), text('phone'), text('notes')],
    belongsTo: ['users'],
  },
  {
    table: 'documents',
    words: ['document', 'documents', 'doc', 'docs', 'page', 'pages', 'file', 'files'],
    columns: [text('title', true), text('body')],
    belongsTo: ['projects', 'users'],
  },
]

/** The words that mean "an account", which the service already provides. */
const ACCOUNT_WORDS = ['user', 'users', 'account', 'accounts', 'member', 'members', 'profile', 'profiles', 'login', 'logins', 'auth', 'authentication', 'sign-in', 'signin']

/** Words that are about the app, not about its data. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'with', 'without', 'for', 'of', 'to', 'in', 'on', 'at', 'by',
  'app', 'apps', 'application', 'site', 'website', 'platform', 'system', 'tool', 'service', 'build',
  'make', 'want', 'need', 'like', 'that', 'this', 'their', 'there', 'where', 'which', 'who', 'can',
  'each', 'every', 'has', 'have', 'having', 'is', 'are', 'be', 'it', 'its', 'my', 'our', 'your',
  'they', 'them', 'some', 'many', 'much', 'more', 'all', 'also', 'so', 'then', 'than', 'about',
  'simple', 'small', 'little', 'big', 'new', 'own', 'other', 'different', 'clone', 'tracker',
  'manager', 'dashboard', 'data', 'database', 'table', 'tables', 'backend', 'frontend', 'mobile',
  'web', 'desktop', 'ios', 'android', 'flutter', 'tauri', 'electron',
  'hello', 'please', 'thanks', 'thank', 'help', 'something', 'anything', 'stuff', 'things', 'thing',
])

/**
 * Verbs, listed because English does not mark them.
 *
 * "users write notes" has one noun in it and the planner has no parser,
 * so the alternative to a list is a `writes` table. Only verbs that are
 * not also entities need to be here -- the vocabulary is consulted
 * first, so "comments" and "orders" are safe as both.
 */
const VERBS = new Set([
  'write', 'writes', 'wrote', 'read', 'reads', 'create', 'creates', 'add', 'adds', 'edit', 'edits',
  'delete', 'deletes', 'remove', 'removes', 'upload', 'uploads', 'download', 'downloads', 'share',
  'shares', 'send', 'sends', 'receive', 'receives', 'track', 'tracks', 'manage', 'manages', 'keep',
  'keeps', 'save', 'saves', 'store', 'view', 'views', 'show', 'shows', 'list', 'browse', 'browses',
  'search', 'searches', 'sort', 'sorts', 'filter', 'filters', 'login', 'logs', 'sell', 'sells',
  'buy', 'buys', 'pay', 'pays', 'join', 'joins', 'leave', 'leaves', 'follow', 'follows', 'belong',
  'belongs', 'contain', 'contains', 'include', 'includes', 'display', 'displays', 'record',
  'records', 'report', 'reports', 'assign', 'assigns', 'invite', 'invites', 'publish', 'publishes',
])

/** `comment` out of `comments`, as far as English rules allow. */
function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

/** `comments` out of `comment`, for a table name. */
function plural(word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`
  if (word.endsWith('s')) return word
  return `${word}s`
}

const BY_WORD = new Map<string, Entity>()
for (const entity of ENTITIES) {
  for (const word of entity.words) BY_WORD.set(word, entity)
}

/** The words of a description, lowercased and stripped of punctuation. */
function words(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Drafts a schema from a description.
 *
 * Mentions are collected in the order they appear, because that is the
 * order the person thought of them and therefore the order they will
 * look for them in the panel. Duplicates collapse: "posts and blog
 * posts" is one table, not two.
 */
export function planSchema(description: string): SchemaPlan {
  const tokens = words(description)
  const notes: string[] = []
  if (!tokens.length) return { tables: [], notes: ['Describe your app and this will draft the tables for it.'] }

  const named: Entity[] = []
  const unknown: string[] = []
  let accounts = false

  for (const token of tokens) {
    if (ACCOUNT_WORDS.includes(token)) { accounts = true; continue }
    const entity = BY_WORD.get(token) ?? BY_WORD.get(singular(token))
    if (entity) {
      if (!named.includes(entity)) named.push(entity)
      continue
    }
    // An unrecognised noun still deserves a table, but only if it looks
    // like a noun: short words, numbers and verbs are how a description
    // turns into a schema full of junk.
    const root = singular(token)
    if (STOP_WORDS.has(token) || STOP_WORDS.has(root)) continue
    if (VERBS.has(token) || VERBS.has(root)) continue
    if (/\d/.test(root)) continue
    // Four letters, or three if the description said it in the plural:
    // "cars" is a thing somebody is storing, "crm" is what they called
    // the app.
    const plainPlural = token !== root
    if (root.length < (plainPlural ? 3 : 4)) continue
    if (!unknown.includes(root)) unknown.push(root)
  }

  const tables: Table[] = []
  const present = new Set(named.map((entity) => entity.table))

  for (const entity of named) {
    const columns = [...entity.columns]
    // One foreign key, to the nearest thing that was actually mentioned.
    // Inventing the parent as well would be drafting a table nobody asked
    // for in order to point at it.
    const parent = entity.belongsTo?.find((candidate) => (
      present.has(candidate) || (candidate === 'users' && accounts)
    ))
    if (parent) columns.push({ name: `${singular(parent)}_id`, type: 'number' })
    tables.push({ name: entity.table, columns })
  }

  for (const root of unknown) {
    const name = safeName(plural(root), '')
    if (!name || present.has(name)) continue
    present.add(name)
    tables.push({ name, columns: [text('name', true), text('notes')] })
    notes.push(`“${root}” is not a word this knows, so ${name} got a name and a notes column to start from.`)
  }

  if (accounts) {
    notes.push('Accounts are built in: the service already has users, sessions and files, so no table was drawn for them.')
  }
  if (!tables.length) {
    notes.push('Nothing in that looked like a thing to store. Try naming them: “posts, comments and tags”.')
  }

  return { tables, notes }
}

/**
 * The draft, merged into whatever is already drawn.
 *
 * Existing tables win outright. A draft that silently rewrote the table
 * somebody spent ten minutes on would be the last time they pressed the
 * button.
 */
export function applyPlan(schema: DataSchema, plan: SchemaPlan): { schema: DataSchema; added: string[]; skipped: string[] } {
  const taken = new Set(schema.tables.map((table) => table.name))
  const added: string[] = []
  const skipped: string[] = []
  const tables = [...schema.tables]

  for (const table of plan.tables) {
    if (taken.has(table.name) || (BUILT_IN_TABLES as readonly string[]).includes(table.name)) {
      skipped.push(table.name)
      continue
    }
    taken.add(table.name)
    added.push(table.name)
    tables.push(table)
  }

  return { schema: { tables }, added, skipped }
}

/** One sentence about what a draft did, for the notification. */
export function describePlan(added: string[], skipped: string[]): string {
  if (!added.length && !skipped.length) return 'Nothing in that looked like a thing to store.'
  const parts: string[] = []
  if (added.length) parts.push(`Drew ${added.length} ${added.length === 1 ? 'table' : 'tables'}: ${added.join(', ')}`)
  if (skipped.length) parts.push(`${skipped.join(', ')} ${skipped.length === 1 ? 'was' : 'were'} already there`)
  return `${parts.join('. ')}.`
}
