/**
 * The AI Architect.
 *
 * You describe the app; it writes a Tungsten Blueprint — tables,
 * columns, policies, buckets, functions — and then it stops. Nothing
 * is applied until a person has read a summary of it in English and
 * pressed a button. That pause is the entire design, and everything
 * else here exists to make the pause worth something.
 *
 * Four rules, each of which is a test:
 *
 * 1. **A missing policy fails closed.** An AI that forgets to mention
 *    security must not produce a world-readable table. `secureDefaults`
 *    fills every unspecified policy with `PRIVATE_POLICIES`, so the
 *    worst case of a lazy model is a table that is too locked down —
 *    which someone will notice and complain about, unlike the reverse.
 *
 * 2. **A reply that does not parse is a refusal, not a guess.** No
 *    repairing half-written JSON into something plausible. A blueprint
 *    is a security document; "probably what it meant" is not a
 *    standard to apply one by.
 *
 * 3. **Offline still works.** Without a gateway the deterministic
 *    planner in `blueprint.ts` drafts it instead. The result is
 *    narrower and says so, rather than the feature simply vanishing.
 *
 * 4. **The architect never applies anything.** It returns a draft.
 *    `review()` turns a draft into the thing the gate renders, and
 *    only a caller holding an approved review may call `apply`.
 */

import type { EngineId } from '../ai/engines'
import type { Gateway, PromptParts } from '../ai/gateway'
import {
  PRIVATE_POLICIES,
  blueprintFromDescription,
  parseBlueprint,
  summariseBlueprint,
  type Blueprint,
  type BlueprintSummary,
  type BlueprintTable,
} from './blueprint'
import type { SchemaPlan, TungstenSchema } from './contract'

/* --------------------------------------------------------- the prompt */

/** Constant for the life of a release, so the provider can cache it. */
export const ARCHITECT_SYSTEM = [
  'You are the backend architect inside Tungsten.',
  'You turn a description of an application into a Tungsten Blueprint: a JSON',
  'document describing tables, columns, access policies, storage buckets and',
  'functions. You do not write application code and you do not run anything.',
].join(' ')

/** Also constant. The schema contract, stated once. */
export const ARCHITECT_RULES = [
  'Reply with exactly one fenced JSON block and no prose outside it.',
  'The JSON has: version (always 1), name, description, tables[], and optionally buckets[], functions[], notes[].',
  'A table has: name (snake_case, plural), columns[], policies, and optionally realtime, indexes.',
  'A column has: name, type, and optionally required, unique, default, references, description.',
  'Types are exactly: text, number, integer, boolean, timestamp, json, uuid, reference.',
  'Never declare id or created_at; every table has them implicitly.',
  'A reference column needs references: { table }.',
  'policies has read, create, update and delete, each exactly one of:',
  'public, authenticated, owner, admin, nobody.',
  'Default to owner/authenticated/owner/owner. Use public read only for data that is',
  'genuinely public, and say so in notes when you do.',
  'Put every assumption you made, and anything you deliberately left out, in notes[].',
].join(' ')

export type DraftRequest = {
  /** What the person typed. */
  description: string
  name?: string
  /** What the project already has, so the model extends instead of replacing. */
  existing?: Blueprint
}

/** The messages, stable parts first so the cache can hit. */
export function architectPrompt(request: DraftRequest): PromptParts {
  const lines = [`Application: ${request.name ?? 'App'}`, '', request.description.trim()]
  if (request.existing && request.existing.tables.length) {
    lines.push(
      '',
      'The project already has these tables. Keep them, extend them where the',
      'description implies it, and do not rename or remove anything:',
      '```json',
      JSON.stringify({ tables: request.existing.tables }, null, 2),
      '```',
    )
  }
  return { system: ARCHITECT_SYSTEM, library: ARCHITECT_RULES, question: lines.join('\n') }
}

/* ---------------------------------------------------------- the safety */

/**
 * Fill in what the model left out, in the safe direction.
 *
 * Only ever adds restrictions. A table that named its policies keeps
 * them — the gate's job is to show the user a public table, not to
 * quietly make it private — but a table that said nothing gets locked.
 */
export function secureDefaults(blueprint: Blueprint): Blueprint {
  const tables: BlueprintTable[] = blueprint.tables.map((table) =>
    table.policies ? table : { ...table, policies: { ...PRIVATE_POLICIES } },
  )
  const buckets = blueprint.buckets?.map((bucket) =>
    bucket.public === undefined ? { ...bucket, public: false } : bucket,
  )
  return buckets ? { ...blueprint, tables, buckets } : { ...blueprint, tables }
}

/** Pulls the first fenced block out of a reply. */
export function extractJson(answer: string): string | undefined {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(answer)
  if (fence) return fence[1].trim()
  const brace = answer.indexOf('{')
  const last = answer.lastIndexOf('}')
  return brace >= 0 && last > brace ? answer.slice(brace, last + 1) : undefined
}

export type ParsedReply =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; reason: string }

/**
 * A model's reply, turned into a blueprint or turned down.
 *
 * Deliberately strict. Every failure here is a sentence a person can
 * act on, because the alternative — a half-understood blueprint
 * applied to a real database — is the thing this whole layer exists to
 * prevent.
 */
export function parseArchitectReply(answer: string): ParsedReply {
  const json = extractJson(answer)
  if (!json) return { ok: false, reason: 'The architect did not return a blueprint. Ask again, more specifically.' }

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'The architect returned something that is not valid JSON. Nothing was changed.' }
  }

  const parsed = parseBlueprint(value)
  if (!parsed.ok) {
    return { ok: false, reason: `That blueprint is not valid: ${parsed.problems.join(' ')}` }
  }
  return { ok: true, blueprint: secureDefaults(parsed.blueprint) }
}

/* ---------------------------------------------------------- the draft */

export type DraftSource = 'ai' | 'offline'

export type Draft =
  | {
      ok: true
      blueprint: Blueprint
      summary: BlueprintSummary
      source: DraftSource
      /** Credits spent. Zero offline. */
      credits: number
    }
  | { ok: false; reason: string; source: DraftSource }

export type ArchitectOptions = {
  /** Absent means offline: the deterministic planner drafts instead. */
  gateway?: Gateway
  engine?: () => EngineId
  /** The backend whose schema will be planned and applied against. */
  schema?: TungstenSchema
  keyFor?: (request: DraftRequest) => string
}

/** Tokens a blueprint is allowed to take. Schemas are not essays. */
export const ARCHITECT_MAX_OUTPUT = 4_096

let drafts = 0

/**
 * The offline draft.
 *
 * Narrower than the model's and honest about it: the planner knows a
 * fixed vocabulary of nouns, so it writes the tables it recognises and
 * notes the words it did not.
 */
export function offlineDraft(request: DraftRequest): Draft {
  const blueprint = secureDefaults(blueprintFromDescription(request.description, request.name ?? 'App'))
  if (!blueprint.tables.length) {
    return {
      ok: false,
      source: 'offline',
      reason:
        'The offline architect did not recognise any tables in that. Name the things the app stores — "posts, comments, users" — or configure an AI gateway for a fuller draft.',
    }
  }
  return { ok: true, blueprint, summary: summariseBlueprint(blueprint), source: 'offline', credits: 0 }
}

export type Architect = {
  /** Writes a blueprint. Changes nothing. */
  draft: (request: DraftRequest) => Promise<Draft>
  /** What applying this blueprint would do. Changes nothing. */
  plan: (blueprint: Blueprint) => Promise<SchemaPlan | undefined>
  /** Runs it. Only ever called from an approved review. */
  apply: (blueprint: Blueprint) => Promise<SchemaPlan | undefined>
}

export function createArchitect(options: ArchitectOptions = {}): Architect {
  const engine = options.engine ?? (() => 'precise' as EngineId)

  return {
    draft: async (request) => {
      if (!request.description.trim()) {
        return { ok: false, source: 'offline', reason: 'Describe the app first.' }
      }
      if (!options.gateway) return offlineDraft(request)

      drafts += 1
      const key = options.keyFor?.(request) ?? `architect:${drafts}`
      const result = await options.gateway.complete({
        engine: engine(),
        prompt: architectPrompt(request),
        key,
        maxOutputTokens: ARCHITECT_MAX_OUTPUT,
      })

      if (!result.ok) {
        const upgrade = result.refusal.upgradeTo ? ` Upgrading to ${result.refusal.upgradeTo} removes it.` : ''
        return { ok: false, source: 'ai', reason: `${result.refusal.message}${upgrade}` }
      }

      const parsed = parseArchitectReply(result.text)
      if (!parsed.ok) return { ok: false, source: 'ai', reason: parsed.reason }
      return {
        ok: true,
        blueprint: parsed.blueprint,
        summary: summariseBlueprint(parsed.blueprint),
        source: 'ai',
        credits: result.credits,
      }
    },

    plan: async (blueprint) => options.schema?.plan(blueprint),
    apply: async (blueprint) => options.schema?.apply(blueprint),
  }
}

/** Only for tests, which must not inherit a counter from each other. */
export function resetDraftCounter(): void {
  drafts = 0
}

/* ----------------------------------------------------------- the gate */

export type Review = {
  blueprint: Blueprint
  summary: BlueprintSummary
  /** Absent when no backend is configured: the draft still lands on the canvas. */
  plan?: SchemaPlan
  /** Operations that could lose data. The gate shows these first. */
  destructive: SchemaPlan['operations']
  /** Reasons this cannot be applied at all. */
  blockers: string[]
  /** Reasons to look twice before approving. */
  cautions: string[]
  /** May the approve button be pressed? */
  approvable: boolean
}

/**
 * Everything the approval gate needs, computed once.
 *
 * A blocker disables the button; a caution does not. The difference
 * matters: a gate that refuses to proceed over a judgement call trains
 * people to find a way around it, and a gate that stays silent about
 * one is decoration.
 */
export function review(blueprint: Blueprint, plan?: SchemaPlan): Review {
  const summary = summariseBlueprint(blueprint)
  const destructive = (plan?.operations ?? []).filter((operation) => operation.destructive)
  const blockers = [...(plan?.problems ?? [])]
  if (!blueprint.tables.length) blockers.push('This blueprint has no tables.')

  const cautions = [...summary.cautions]
  if (destructive.length) {
    cautions.push(
      `${destructive.length} operation${destructive.length === 1 ? '' : 's'} could lose existing data.`,
    )
  }
  if (plan?.mode === 'script') {
    cautions.push('This backend cannot apply migrations directly; Tungsten will hand you a script to run.')
  }

  return {
    blueprint,
    summary,
    plan,
    destructive,
    blockers,
    cautions,
    approvable: blockers.length === 0,
  }
}

/** One line for the notification after an approval. */
export function describeApplied(review: Review): string {
  const tables = review.blueprint.tables.length
  const operations = review.plan?.operations.length ?? 0
  const applied = operations ? `${operations} operation${operations === 1 ? '' : 's'}` : 'the canvas schema'
  return `Applied ${applied} for ${tables} table${tables === 1 ? '' : 's'}.`
}
