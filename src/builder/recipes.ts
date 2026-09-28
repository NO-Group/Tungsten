/**
 * Recipes: whole features, in one click.
 *
 * A block at a time is fine for learning and slow for building. Most apps
 * start from the same handful of shapes -- a sign-in form, a list drawn from
 * a table, a call to an API -- so those ship as graphs rather than as
 * documentation telling you which nine blocks to wire together.
 *
 * A recipe is declarative: blocks with their values and positions, and links
 * between them by index. It is instantiated through the same `connect` the
 * canvas uses, so a recipe cannot introduce a link the builder would have
 * refused, and `recipes.test.ts` holds every one of them to a harder line
 * than that -- each must generate code, pass the integrity checker with no
 * errors, and survive a round trip through the parser.
 */

import type { BlockGraph, BlockRegistry } from './blockSchema'
import { addNode, connect, createNode } from './graph'

export type RecipeBlock = {
  type: string
  at: { x: number; y: number }
  values?: Record<string, string | number | boolean>
}

/** `[fromBlock, fromPort, toBlock, toPort]`, blocks named by index. */
export type RecipeLink = [number, string, number, string]

export type Recipe = {
  id: string
  name: string
  /** One line, shown under the name in the palette. */
  summary: string
  /** What the user gets, in their words, for the notification. */
  outcome: string
  blocks: RecipeBlock[]
  links: RecipeLink[]
}

const COLUMN = 300
const ROW = 120

export const recipes: Recipe[] = [
  {
    id: 'signin-form',
    name: 'Sign-in form',
    summary: 'Two fields, a button, and the handler that signs the user in.',
    outcome: 'a sign-in form wired to an email sign-up',
    blocks: [
      { type: 'event.start', at: { x: 0, y: 0 } },
      { type: 'ui.input', at: { x: COLUMN, y: 0 }, values: { id: 'email', placeholder: 'Email' } },
      { type: 'ui.input', at: { x: COLUMN, y: ROW }, values: { id: 'password', placeholder: 'Password' } },
      { type: 'ui.button', at: { x: COLUMN, y: ROW * 2 }, values: { text: 'Sign in', id: 'signin' } },
      { type: 'event.click', at: { x: 0, y: ROW * 3.4 }, values: { target: 'signin' } },
      { type: 'ui.value', at: { x: COLUMN, y: ROW * 4.6 }, values: { id: 'email' } },
      { type: 'ui.value', at: { x: COLUMN, y: ROW * 5.4 }, values: { id: 'password' } },
      { type: 'auth.signUp', at: { x: COLUMN * 2, y: ROW * 3.4 } },
      { type: 'ui.text', at: { x: COLUMN * 3, y: ROW * 3.4 }, values: { value: 'Signed in' } },
    ],
    links: [
      [0, 'exec', 1, 'exec'],
      [1, 'exec', 2, 'exec'],
      [2, 'exec', 3, 'exec'],
      [4, 'exec', 7, 'exec'],
      [5, 'value', 7, 'email'],
      [6, 'value', 7, 'password'],
      [7, 'exec', 8, 'exec'],
    ],
  },
  {
    id: 'oauth-button',
    name: 'Sign in with Google',
    summary: 'A provider button and the OAuth round trip behind it.',
    outcome: 'an OAuth sign-in button',
    blocks: [
      { type: 'event.start', at: { x: 0, y: 0 } },
      { type: 'ui.button', at: { x: COLUMN, y: 0 }, values: { text: 'Continue with Google', id: 'google' } },
      { type: 'event.click', at: { x: 0, y: ROW * 1.6 }, values: { target: 'google' } },
      { type: 'auth.oauth', at: { x: COLUMN, y: ROW * 1.6 }, values: { provider: 'google', redirect: '/' } },
      { type: 'ui.text', at: { x: COLUMN * 2, y: ROW * 1.6 } },
    ],
    links: [
      [0, 'exec', 1, 'exec'],
      [2, 'exec', 3, 'exec'],
      [3, 'exec', 4, 'exec'],
      [3, 'user', 4, 'value'],
    ],
  },
  {
    id: 'table-list',
    name: 'List a table',
    summary: 'Query rows on load and draw one line per row.',
    outcome: 'a list drawn from the users table',
    blocks: [
      { type: 'event.start', at: { x: 0, y: 0 } },
      { type: 'data.query', at: { x: COLUMN, y: 0 }, values: { table: 'users' } },
      { type: 'logic.forEach', at: { x: COLUMN * 2, y: 0 } },
      { type: 'ui.text', at: { x: COLUMN * 3, y: ROW } },
    ],
    links: [
      [0, 'exec', 1, 'exec'],
      [1, 'exec', 2, 'exec'],
      [1, 'rows', 2, 'list'],
      [2, 'body', 3, 'exec'],
      [2, 'item', 3, 'value'],
    ],
  },
  {
    id: 'api-call',
    name: 'Call an API',
    summary: 'Fetch on load, show the response, log it for debugging.',
    outcome: 'an API call rendered on load',
    blocks: [
      { type: 'event.start', at: { x: 0, y: 0 } },
      { type: 'network.fetch', at: { x: COLUMN, y: 0 }, values: { url: 'https://api.example.com/items', method: 'GET' } },
      { type: 'ui.text', at: { x: COLUMN * 2, y: 0 } },
      { type: 'logic.log', at: { x: COLUMN * 3, y: 0 } },
    ],
    links: [
      [0, 'exec', 1, 'exec'],
      [1, 'exec', 2, 'exec'],
      [1, 'response', 2, 'value'],
      [2, 'exec', 3, 'exec'],
      [1, 'response', 3, 'value'],
    ],
  },
  {
    id: 'signup-save',
    name: 'Sign up and save the profile',
    summary: 'Create the account, then write the row it returns to the database.',
    outcome: 'sign-up writing a profile row',
    blocks: [
      { type: 'event.click', at: { x: 0, y: 0 }, values: { target: 'signup' } },
      { type: 'ui.value', at: { x: 0, y: ROW }, values: { id: 'email' } },
      { type: 'ui.value', at: { x: 0, y: ROW * 1.8 }, values: { id: 'password' } },
      { type: 'auth.signUp', at: { x: COLUMN, y: 0 } },
      { type: 'data.insert', at: { x: COLUMN * 2, y: 0 }, values: { table: 'profiles' } },
      { type: 'ui.text', at: { x: COLUMN * 3, y: 0 }, values: { value: 'Welcome' } },
    ],
    links: [
      [0, 'exec', 3, 'exec'],
      [1, 'value', 3, 'email'],
      [2, 'value', 3, 'password'],
      [3, 'exec', 4, 'exec'],
      [3, 'user', 4, 'row'],
      [4, 'exec', 5, 'exec'],
    ],
  },
  {
    id: 'guarded-action',
    name: 'Only when signed in',
    summary: 'Read the session and branch on it before doing the work.',
    outcome: 'a session guard around an action',
    blocks: [
      { type: 'event.start', at: { x: 0, y: 0 } },
      { type: 'auth.session', at: { x: COLUMN, y: 0 } },
      { type: 'logic.exists', at: { x: COLUMN, y: ROW * 1.4 } },
      { type: 'logic.if', at: { x: COLUMN * 2, y: 0 } },
      { type: 'ui.text', at: { x: COLUMN * 3, y: ROW * 0.6 }, values: { value: 'Welcome back' } },
      { type: 'ui.text', at: { x: COLUMN * 3, y: ROW * 1.8 }, values: { value: 'Please sign in' } },
    ],
    links: [
      [0, 'exec', 1, 'exec'],
      [1, 'exec', 3, 'exec'],
      [1, 'user', 2, 'value'],
      [2, 'result', 3, 'condition'],
      [3, 'body', 4, 'exec'],
      [3, 'else', 5, 'exec'],
    ],
  },
]

export function recipeById(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id)
}

export type RecipeResult = {
  graph: BlockGraph
  /** The ids of the blocks that were added, so the canvas can select them. */
  added: string[]
  /** Links the builder refused. Empty for every shipped recipe, by test. */
  rejected: string[]
}

/**
 * Adds a recipe to a graph.
 *
 * Placed below whatever is already on the canvas rather than on top of it,
 * so dropping a second recipe in never hides the first.
 */
export function instantiate(
  recipe: Recipe,
  graph: BlockGraph,
  registry: BlockRegistry,
  origin?: { x: number; y: number },
): RecipeResult {
  const bottom = graph.nodes.reduce((value, node) => Math.max(value, node.position.y + 140), 0)
  const at = origin ?? { x: 40, y: bottom ? bottom + 40 : 40 }

  let next = graph
  const added: string[] = []
  const rejected: string[] = []

  for (const block of recipe.blocks) {
    const node = createNode(block.type, { x: at.x + block.at.x, y: at.y + block.at.y })
    if (block.values) node.values = { ...node.values, ...block.values }
    added.push(node.id)
    next = addNode(next, node)
  }

  for (const [from, fromPort, to, toPort] of recipe.links) {
    const result = connect(
      next,
      registry,
      { node: added[from], port: fromPort },
      { node: added[to], port: toPort },
    )
    if (result.rejected) rejected.push(`${recipe.blocks[from].type}.${fromPort} → ${recipe.blocks[to].type}.${toPort}: ${result.rejected}`)
    else next = result.graph
  }

  return { graph: next, added, rejected }
}
