/**
 * The editor assistant, on the metered gateway.
 *
 * `localAssistant` is a rules engine and `remoteAssistant` talks to
 * whatever OpenAI-compatible endpoint you point it at with your own
 * key. This third provider is the commercial one: it goes through
 * `createGateway`, which means a plan gate, a credit hold, a hard
 * output clamp and a ledger entry, and it means the panel can say what
 * a question will cost before you ask it.
 *
 * Three things are deliberate.
 *
 * **The prompt is composed in cache order, every time.** `promptFor`
 * emits the same system block and the same house rules on every call,
 * so the provider's cache prefix is byte-identical between turns and
 * the repeated part bills at a tenth. Putting the file first — which
 * reads more naturally — would quietly turn every call into a full
 * price miss that nothing would ever report.
 *
 * **The file is volatile, the rules are not.** The buffer goes in the
 * question, not the cached prefix, because it changes with every
 * keystroke and a cache entry that never hits costs more to write than
 * it saves.
 *
 * **A refusal is not an error.** Running out of credits is an ordinary
 * state with a sentence attached and an upgrade that fixes it, so it
 * surfaces as the assistant's answer rather than as a thrown stack
 * trace in a red box.
 */

import { engineOr, type EngineId } from '../../ai/engines'
import { composePrompt, type Gateway, type PromptParts } from '../../ai/gateway'
import { estimateFor, tokensFromText, type Estimate } from '../../ai/pricing'
import type { Refusal } from '../../ai/plans'
import { describeRange, type AiContext, type AiProposal } from './aiModel'
import { extractCode, type AiProvider, type AiRequest } from './providers'

/**
 * Who the assistant is. Identical on every call, for every user, for
 * the life of a release — which is exactly what makes it cacheable.
 */
export const ASSISTANT_SYSTEM = [
  'You are the code assistant inside Tungsten, an IDE.',
  'You are talking to the person who wrote the file on screen.',
  'Answer in as few words as the question deserves and no fewer.',
  'Never apologise for what you cannot do; say what you can do instead.',
].join(' ')

/**
 * The house rules for edits. Also constant, also cached, and kept
 * separate from the system block so either can change without
 * invalidating the other.
 */
export const ASSISTANT_RULES = [
  'When the user asks for a change, reply with the replacement for the',
  'selected lines in exactly one fenced code block, with nothing else',
  'inside the fence and no commentary that repeats the code.',
  'Match the surrounding indentation and style; do not reformat lines',
  'you were not asked to touch.',
  'If the request is a question rather than an edit, answer it in prose',
  'and emit no fence at all.',
].join(' ')

/** The thing the gateway is actually sent, in cache order. */
export function promptFor(request: AiRequest): PromptParts {
  const { context, prompt } = request
  const scope = context.selection.trim() ? 'Selected lines' : 'Whole file'
  return {
    system: ASSISTANT_SYSTEM,
    library: ASSISTANT_RULES,
    question: [
      `File: ${context.path} (${context.language || 'plain text'})`,
      `Scope: ${describeRange(context)}`,
      `${scope}:`,
      '```',
      context.selection.trim() ? context.selection : context.buffer,
      '```',
      '',
      prompt,
    ].join('\n'),
  }
}

/** Tokens the assistant is allowed to spend on one reply. */
export const ASSISTANT_MAX_OUTPUT = 2_048

/**
 * What this question will cost, before it is asked.
 *
 * Computed from the same prompt the call will send, so the number
 * beside the send button and the number in the hold come from one
 * place. Returns the likely cost and the ceiling; the panel shows
 * both, because a balance that drops by the ceiling when the label
 * promised the estimate looks like theft.
 */
export function estimateTurn(engine: EngineId, request: AiRequest): Estimate {
  const parts = promptFor(request)
  const messages = composePrompt(parts)
  const text = messages.map((message) => message.content).join('\n')
  // Priced against the same output clamp the call will send, or the
  // quote would be for a reply the gateway is not allowed to produce.
  return estimateFor(engineOr(engine), {
    inputTokens: tokensFromText(text),
    maxOutputTokens: ASSISTANT_MAX_OUTPUT,
  })
}

export type MeteredOptions = {
  gateway: Gateway
  /** Which engine to spend on. Read fresh each call so a change applies at once. */
  engine: () => EngineId
  /** Distinguishes retries from new questions. */
  keyFor?: (request: AiRequest) => string
  label?: string
}

/** A refusal, phrased as something the panel can show as an answer. */
export function refusalAnswer(refusal: Refusal): AiProposal {
  const upgrade = refusal.upgradeTo ? ` Upgrading to ${refusal.upgradeTo} removes it.` : ''
  return { answer: `${refusal.message}${upgrade}` }
}

let turnCounter = 0

/**
 * The assistant, billed.
 *
 * Note what it does *not* do: it never applies anything. It returns an
 * `AiProposal` like the other two providers, and `aiModel.ts` decides
 * whether that proposal may touch a buffer. Adding money to the
 * pipeline does not get to add permissions to it.
 */
export function meteredAssistant(options: MeteredOptions): AiProvider {
  const { gateway } = options
  return {
    id: 'metered',
    label: options.label ?? 'Tungsten AI',
    run: async (request, onChunk) => {
      turnCounter += 1
      const key = options.keyFor?.(request) ?? `editor:${turnCounter}`
      const result = await gateway.complete({
        engine: options.engine(),
        prompt: promptFor(request),
        key,
        maxOutputTokens: ASSISTANT_MAX_OUTPUT,
        onChunk,
      })

      if (!result.ok) return refusalAnswer(result.refusal)

      const replacement = extractCode(result.text)
      return {
        answer: result.text,
        replacement,
        summary: replacement
          ? `Apply the assistant’s edit (${result.credits} credit${result.credits === 1 ? '' : 's'})`
          : undefined,
      }
    },
  }
}

/** Only for tests, which must not inherit a counter from each other. */
export function resetTurnCounter(): void {
  turnCounter = 0
}

export type { AiContext }
