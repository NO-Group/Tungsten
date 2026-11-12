import { beforeEach, describe, expect, it } from 'vitest'

import { BALANCED, PRECISE, routeKey } from '../ai/engines'
import { cachePrefix, composePrompt, createGateway } from '../ai/gateway'
import { memoryStore, walletMeter } from '../ai/meter'
import { balance, newWallet } from '../ai/wallet'
import type { HttpReply, HttpSend } from './contract'
import type { SchemaPlan } from './contract'
import {
  ARCHITECT_MAX_OUTPUT,
  ARCHITECT_RULES,
  ARCHITECT_SYSTEM,
  architectPrompt,
  createArchitect,
  describeApplied,
  extractJson,
  offlineDraft,
  parseArchitectReply,
  resetDraftCounter,
  review,
  secureDefaults,
} from './architect'
import { PRIVATE_POLICIES, type Blueprint } from './blueprint'

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

const BLUEPRINT = {
  version: 1,
  name: 'Journal',
  tables: [
    {
      name: 'entries',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'text' },
        { name: 'owner_id', type: 'uuid' },
      ],
      policies: { read: 'owner', create: 'authenticated', update: 'owner', delete: 'owner' },
    },
  ],
}

const fenced = (value: unknown) => ['Here is the schema.', '```json', JSON.stringify(value), '```'].join('\n')

type Call = { body: Record<string, unknown> }

function recorder(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const http: HttpSend = async (_url, init) => {
    calls.push({ body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {} })
    const next = replies.shift() ?? { status: 200, body: {} }
    const status = next.status ?? 200
    const reply: HttpReply = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
      headers: { get: () => null },
    }
    return reply
  }
  return { http, calls }
}

function harness(options: { plan?: 'spark' | 'core' | 'forge'; replies?: Array<{ status?: number; body: unknown }> } = {}) {
  const store = memoryStore(newWallet(options.plan ?? 'forge', T0))
  const { http, calls } = recorder(options.replies ?? [])
  const gateway = createGateway({
    http,
    meter: walletMeter(store),
    baseUrl: 'https://gateway.test',
    plan: () => store.read().plan,
    now: () => T0,
    models: () => [routeKey(PRECISE.routes[0]), routeKey(BALANCED.routes[0])],
  })
  return { gateway, calls, left: () => balance(store.read(), T0).total }
}

const answer = (text: string) => ({ body: { text, model: 'claude-opus-5.5', usage: { inputTokens: 1_200, outputTokens: 600 } } })

beforeEach(() => resetDraftCounter())

describe('the prompt', () => {
  it('puts the contract in the cacheable prefix', () => {
    const messages = composePrompt(architectPrompt({ description: 'a journal' }))
    expect(messages[0].content).toBe(ARCHITECT_SYSTEM)
    expect(messages[1].content).toBe(ARCHITECT_RULES)
    expect(messages.filter((message) => message.cache)).toHaveLength(2)
  })

  it('keeps that prefix identical between two different apps', () => {
    const first = cachePrefix(composePrompt(architectPrompt({ description: 'a journal' })))
    const second = cachePrefix(composePrompt(architectPrompt({ description: 'a bug tracker for teams' })))
    expect(second).toBe(first)
  })

  it('tells the model never to invent id or created_at', () => {
    expect(ARCHITECT_RULES).toContain('Never declare id or created_at')
    expect(ARCHITECT_RULES).toContain('owner/authenticated/owner/owner')
  })

  it('shows what already exists so it extends rather than replaces', () => {
    const question = architectPrompt({
      description: 'add comments',
      existing: BLUEPRINT as unknown as Blueprint,
    }).question
    expect(question).toContain('do not rename or remove anything')
    expect(question).toContain('entries')
  })
})

describe('reading the reply', () => {
  it('takes the blueprint out of a fence', () => {
    const parsed = parseArchitectReply(fenced(BLUEPRINT))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.blueprint.tables[0].name).toBe('entries')
  })

  it('copes with a bare object and no fence', () => {
    expect(extractJson(`Sure thing. ${JSON.stringify(BLUEPRINT)} Hope that helps.`)).toContain('"entries"')
  })

  it('refuses rather than guesses at broken JSON', () => {
    const parsed = parseArchitectReply('```json\n{ "version": 1, "tables": [\n```')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('not valid JSON')
  })

  it('refuses a blueprint that does not satisfy the schema', () => {
    const parsed = parseArchitectReply(fenced({ version: 1, name: 'X', tables: [{ name: 'a', columns: [{ name: 'b', type: 'wat' }] }] }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('not valid')
  })

  it('says so plainly when there is no blueprint at all', () => {
    const parsed = parseArchitectReply('I would start with a users table, probably.')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('did not return a blueprint')
  })
})

describe('a missing policy fails closed', () => {
  it('locks a table the model forgot to secure', () => {
    const parsed = parseArchitectReply(
      fenced({ version: 1, name: 'X', tables: [{ name: 'secrets', columns: [{ name: 'value', type: 'text' }] }] }),
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.blueprint.tables[0].policies).toEqual(PRIVATE_POLICIES)
  })

  it('leaves a deliberately public table public, for the gate to shout about', () => {
    const open = {
      version: 1,
      name: 'X',
      tables: [
        {
          name: 'posts',
          columns: [{ name: 'body', type: 'text' }],
          policies: { read: 'public', create: 'authenticated', update: 'owner', delete: 'owner' },
        },
      ],
    }
    const parsed = parseArchitectReply(fenced(open))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.blueprint.tables[0].policies?.read).toBe('public')
      expect(review(parsed.blueprint).cautions.join(' ')).toContain('Anyone on the internet can read posts')
    }
  })

  it('makes an unspecified bucket private', () => {
    const secured = secureDefaults({
      version: 1,
      name: 'X',
      tables: [],
      buckets: [{ name: 'uploads' }],
    })
    expect(secured.buckets?.[0].public).toBe(false)
  })

  it('only ever adds restrictions', () => {
    const before: Blueprint = { version: 1, name: 'X', tables: [], buckets: [{ name: 'cdn', public: true }] }
    expect(secureDefaults(before).buckets?.[0].public).toBe(true)
  })
})

describe('drafting', () => {
  it('spends credits and returns a summary', async () => {
    const { gateway, calls, left } = harness({ replies: [answer(fenced(BLUEPRINT))] })
    const architect = createArchitect({ gateway })
    const before = left()
    const draft = await architect.draft({ description: 'a private journal' })

    expect(draft.ok).toBe(true)
    if (draft.ok) {
      expect(draft.source).toBe('ai')
      expect(draft.credits).toBeGreaterThan(0)
      expect(draft.summary.tables[0].name).toBe('entries')
      expect(draft.summary.tables[0].policies).toContain('the row’s owner')
    }
    expect(left()).toBeLessThan(before)
    expect(calls[0].body.engine).toBe('precise')
    expect(calls[0].body.maxOutputTokens).toBeLessThanOrEqual(ARCHITECT_MAX_OUTPUT)
  })

  it('answers a refusal rather than throwing it', async () => {
    const { gateway, left } = harness({ plan: 'spark' })
    const architect = createArchitect({ gateway })
    const before = left()
    const draft = await architect.draft({ description: 'a journal' })

    expect(draft.ok).toBe(false)
    if (!draft.ok) expect(draft.reason).toContain('Precise')
    expect(left()).toBe(before)
  })

  it('falls back to the offline planner with no gateway', async () => {
    const architect = createArchitect()
    const draft = await architect.draft({ description: 'a blog with posts and comments' })
    expect(draft.ok).toBe(true)
    if (draft.ok) {
      expect(draft.source).toBe('offline')
      expect(draft.credits).toBe(0)
      expect(draft.blueprint.tables.length).toBeGreaterThan(0)
    }
  })

  it('admits when the offline planner recognised nothing', () => {
    // The planner gives an unrecognised noun a table, which is the right
    // call — but a description made only of filler leaves it with none.
    const draft = offlineDraft({ description: 'the and it is a of to' })
    expect(draft.ok).toBe(false)
    if (!draft.ok) expect(draft.reason).toContain('configure an AI gateway')
  })

  it('will not draft from an empty description', async () => {
    const draft = await createArchitect().draft({ description: '   ' })
    expect(draft.ok).toBe(false)
    if (!draft.ok) expect(draft.reason).toBe('Describe the app first.')
  })

  it('gives each draft its own idempotency key', async () => {
    const { gateway } = harness({ replies: [answer(fenced(BLUEPRINT)), answer(fenced(BLUEPRINT))] })
    const keys: string[] = []
    const architect = createArchitect({
      gateway,
      keyFor: (request) => {
        keys.push(request.description)
        return `k:${request.description}`
      },
    })
    await architect.draft({ description: 'one' })
    await architect.draft({ description: 'two' })
    expect(keys).toEqual(['one', 'two'])
  })
})

describe('the approval gate', () => {
  const blueprint = BLUEPRINT as unknown as Blueprint

  const plan = (over: Partial<SchemaPlan> = {}): SchemaPlan => ({
    operations: [{ kind: 'create-table', subject: 'entries', statement: 'CREATE TABLE entries (...)' }],
    problems: [],
    mode: 'apply',
    ...over,
  })

  it('approves a clean plan', () => {
    const gate = review(blueprint, plan())
    expect(gate.approvable).toBe(true)
    expect(gate.blockers).toEqual([])
    expect(gate.destructive).toEqual([])
  })

  it('refuses to approve over a problem', () => {
    const gate = review(blueprint, plan({ problems: ['This backend cannot create tables.'] }))
    expect(gate.approvable).toBe(false)
    expect(gate.blockers).toContain('This backend cannot create tables.')
  })

  it('warns about data loss without blocking a judgement call', () => {
    const gate = review(
      blueprint,
      plan({
        operations: [
          { kind: 'drop-column', subject: 'entries.body', statement: 'ALTER TABLE entries DROP COLUMN body', destructive: true },
        ],
      }),
    )
    expect(gate.destructive).toHaveLength(1)
    expect(gate.cautions.join(' ')).toContain('could lose existing data')
    // A caution, not a blocker: a gate that refuses judgement calls gets routed around.
    expect(gate.approvable).toBe(true)
  })

  it('says when the backend can only hand over a script', () => {
    expect(review(blueprint, plan({ mode: 'script' })).cautions.join(' ')).toContain('hand you a script')
  })

  it('blocks an empty blueprint', () => {
    expect(review({ version: 1, name: 'X', tables: [] }).approvable).toBe(false)
  })

  it('works with no backend at all, for the canvas-only case', () => {
    const gate = review(blueprint)
    expect(gate.approvable).toBe(true)
    expect(gate.plan).toBeUndefined()
    expect(describeApplied(gate)).toBe('Applied the canvas schema for 1 table.')
  })

  it('counts the operations when there is a backend', () => {
    expect(describeApplied(review(blueprint, plan()))).toBe('Applied 1 operation for 1 table.')
  })
})

describe('applying', () => {
  it('only ever calls the backend through plan and apply', async () => {
    const seen: string[] = []
    const schema = {
      inspect: async () => ({ version: 1, name: 'X', tables: [] }),
      plan: async () => { seen.push('plan'); return { operations: [], problems: [], mode: 'apply' as const } },
      apply: async () => { seen.push('apply'); return { operations: [], problems: [], mode: 'apply' as const } },
      policies: async () => [],
    }
    const architect = createArchitect({ schema })
    await architect.plan(BLUEPRINT as unknown as Blueprint)
    expect(seen).toEqual(['plan'])
    await architect.apply(BLUEPRINT as unknown as Blueprint)
    expect(seen).toEqual(['plan', 'apply'])
  })

  it('returns nothing rather than pretending when there is no backend', async () => {
    const architect = createArchitect()
    expect(await architect.plan(BLUEPRINT as unknown as Blueprint)).toBeUndefined()
  })
})
