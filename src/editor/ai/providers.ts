/**
 * Where answers come from.
 *
 * Two providers ship. Neither is pretending to be the other.
 *
 * `localAssistant` is a rules engine: it reads the request, recognises a
 * handful of concrete jobs -- wrap this in try/catch, document this
 * function, log this value, explain what this does -- and performs them
 * exactly, offline, deterministically. It cannot invent code it was not
 * taught, and it never claims to. What it does do, it does the same way
 * every time, which is worth something in an editor.
 *
 * `remoteAssistant` talks to any OpenAI-compatible chat endpoint the user
 * configures, streaming the reply. Tungsten ships no key and no default
 * endpoint: until one is configured in settings, there is nothing to call
 * and the local assistant answers instead.
 *
 * Both satisfy one interface, so the permission engine above them neither
 * knows nor cares which is running.
 */

import type { AiContext, AiProposal } from './aiModel'

export type AiRequest = {
  prompt: string
  context: AiContext
}

export type AiProvider = {
  id: string
  label: string
  /** Streams the answer, then resolves the final proposal. */
  run: (request: AiRequest, onChunk: (text: string) => void) => Promise<AiProposal>
}

export type RemoteConfig = {
  /** e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string
  model: string
  apiKey?: string
}

// ---------------------------------------------------------------- local

/** The jobs the local assistant knows how to do. */
export type LocalAction = 'try' | 'document' | 'log' | 'todo' | 'arrow' | 'explain'


/** Reads a request and decides which job it is. */
export function actionFor(prompt: string): LocalAction {
  const text = prompt.toLowerCase()
  if (/\btry\b|catch|error handling|handle (the )?error/.test(text)) return 'try'
  if (/comment|document|jsdoc|docstring|describe this/.test(text)) return 'document'
  if (/log|print|console/.test(text)) return 'log'
  if (/todo|fixme|remind/.test(text)) return 'todo'
  if (/arrow|const function|convert .*function/.test(text)) return 'arrow'
  return 'explain'
}

const indentOf = (line: string) => /^\s*/.exec(line)?.[0] ?? ''

/** The identifier most likely to be interesting in a fragment. */
function subjectOf(code: string): string | undefined {
  const declared = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(code)
  if (declared) return declared[1]
  const named = /function\s+([A-Za-z_$][\w$]*)/.exec(code)
  if (named) return named[1]
  const assigned = /([A-Za-z_$][\w$]*)\s*=/.exec(code)
  return assigned?.[1]
}

/** A static reading of a fragment. Facts, not opinions. */
function describe(code: string, language: string): string {
  const lines = code.split('\n').filter((line) => line.trim())
  const functions = (code.match(/\bfunction\b|=>/g) ?? []).length
  const awaits = (code.match(/\bawait\b/g) ?? []).length
  const returns = (code.match(/\breturn\b/g) ?? []).length
  const branches = (code.match(/\bif\b|\bswitch\b|\?\s/g) ?? []).length
  const calls = new Set([...code.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].map((match) => match[1]))

  const facts = [
    `${lines.length} line${lines.length === 1 ? '' : 's'} of ${language || 'code'}`,
    functions ? `${functions} function${functions === 1 ? '' : 's'}` : '',
    branches ? `${branches} branch${branches === 1 ? '' : 'es'}` : '',
    awaits ? `${awaits} await${awaits === 1 ? '' : 's'} — this runs asynchronously` : '',
    returns ? `${returns} return${returns === 1 ? '' : 's'}` : '',
  ].filter(Boolean)

  const named = [...calls].filter((name) => !['if', 'for', 'while', 'switch', 'catch'].includes(name)).slice(0, 6)
  return [
    facts.join(', '),
    named.length ? `Calls: ${named.join(', ')}.` : '',
    awaits && !/try\s*{/.test(code)
      ? 'Nothing here catches a rejection — ask me to wrap it in try/catch.'
      : '',
  ].filter(Boolean).join('\n')
}

/** Performs one job, returning the replacement text for the selection. */
export function performLocalAction(action: LocalAction, request: AiRequest): AiProposal {
  const { context, prompt } = request
  const code = context.selection.trim() ? context.selection : context.buffer
  const first = code.split('\n')[0] ?? ''
  const indent = indentOf(first)
  const subject = subjectOf(code)

  if (action === 'try') {
    const body = code.split('\n').map((line) => `  ${line}`).join('\n')
    return {
      answer: 'Wrapped the selection in try/catch. The catch logs and rethrows, so nothing is swallowed.',
      summary: 'Wrap in try/catch',
      replacement: `${indent}try {\n${body}\n${indent}} catch (error) {\n${indent}  console.error('${(subject ?? 'this step').replace(/'/g, "\\'")} failed', error)\n${indent}  throw error\n${indent}}`,
    }
  }

  if (action === 'document') {
    const params = /\(([^)]*)\)/.exec(first)?.[1]
      ?.split(',')
      .map((part) => part.trim().split(/[:=\s]/)[0])
      .filter(Boolean) ?? []
    const doc = [
      `${indent}/**`,
      `${indent} * ${subject ? `${subject}.` : 'What this does.'}`,
      ...(params.length ? [`${indent} *`] : []),
      ...params.map((name) => `${indent} * @param ${name}`),
      `${indent} */`,
    ].join('\n')
    return {
      answer: `Added a doc comment${params.length ? ` with ${params.length} parameter${params.length === 1 ? '' : 's'}` : ''}. Fill in the summary line.`,
      summary: 'Add a doc comment',
      replacement: `${doc}\n${code}`,
    }
  }

  if (action === 'log') {
    const name = subject ?? 'value'
    return {
      answer: `Added a log of \`${name}\` after the selection.`,
      summary: `Log ${name}`,
      replacement: `${code}\n${indent}console.log('${name}:', ${name})`,
    }
  }

  if (action === 'todo') {
    // "add a todo: check the rate limit" should leave "check the rate
    // limit", not repeat the instruction back into the file.
    const note = prompt.replace(/^.*?\b(todo|fixme)\b[:\s]*/i, '').trim() || 'revisit this'
    return {
      answer: 'Added a TODO above the selection.',
      summary: 'Add a TODO',
      replacement: `${indent}// TODO: ${note}\n${code}`,
    }
  }

  if (action === 'arrow') {
    const match = /^(\s*)function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*{/.exec(first)
    if (!match) {
      return {
        answer: 'That does not start with a `function name(...) {` declaration, so there is nothing to convert. Select the declaration line and ask again.',
      }
    }
    const [, lead, name, params] = match
    const rest = code.split('\n').slice(1).join('\n')
    return {
      answer: `Converted \`${name}\` to a const arrow function.`,
      summary: `Convert ${name} to an arrow function`,
      replacement: `${lead}const ${name} = (${params}) => {\n${rest}`,
    }
  }

  return { answer: describe(code, context.language) }
}

/**
 * The offline assistant.
 *
 * Streamed a word at a time rather than returned whole, so the pipeline
 * above it is exercised exactly as a network provider would exercise it --
 * and so a long answer appears as it is written.
 */
export const localAssistant: AiProvider = {
  id: 'local',
  label: 'Local rules assistant',
  run: async (request, onChunk) => {
    const proposal = performLocalAction(actionFor(request.prompt), request)
    for (const word of proposal.answer.split(/(\s+)/)) {
      onChunk(word)
      // Yield so a caller streaming into React sees it arrive, not all at once.
      await Promise.resolve()
    }
    return proposal
  },
}

// --------------------------------------------------------------- remote

/**
 * Pulls text out of an OpenAI-style SSE stream.
 *
 * Exported because the parsing, not the fetching, is the part that goes
 * wrong: split frames, `[DONE]`, keep-alive comments, and chunks that
 * contain several events at once.
 */
export function parseSseChunk(raw: string): { text: string; done: boolean } {
  let text = ''
  let done = false
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') { done = true; continue }
    try {
      const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
      text += parsed.choices?.[0]?.delta?.content ?? ''
    } catch {
      // A partial frame; the caller keeps the remainder and tries again.
    }
  }
  return { text, done }
}

/** Splits a buffer into whole SSE events plus whatever is left over. */
export function splitEvents(buffer: string): { events: string; rest: string } {
  const boundary = buffer.lastIndexOf('\n\n')
  if (boundary < 0) return { events: '', rest: buffer }
  return { events: buffer.slice(0, boundary), rest: buffer.slice(boundary + 2) }
}

const SYSTEM_PROMPT = [
  'You are a code assistant inside an IDE.',
  'Answer briefly.',
  'When the user asks for a change, reply with the replacement code for the',
  'selected lines inside one fenced block, and nothing else in the fence.',
].join(' ')

/** Pulls the first fenced block out of a reply, when there is one. */
export function extractCode(answer: string): string | undefined {
  const fence = /```[\w-]*\n([\s\S]*?)```/.exec(answer)
  return fence ? fence[1].replace(/\n$/, '') : undefined
}

export function remoteAssistant(config: RemoteConfig, fetchImpl: typeof fetch = globalThis.fetch): AiProvider {
  return {
    id: 'remote',
    label: config.model,
    run: async (request, onChunk) => {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                `File: ${request.context.path}`,
                `Selection (${request.context.startLine}-${request.context.endLine}):`,
                '```',
                request.context.selection || request.context.buffer,
                '```',
                request.prompt,
              ].join('\n'),
            },
          ],
        }),
      })

      if (!response.ok) throw new Error(`The assistant endpoint answered ${response.status}.`)
      if (!response.body) throw new Error('The assistant endpoint sent no body.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answer = ''

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = splitEvents(buffer)
        buffer = rest
        if (!events) continue
        const parsed = parseSseChunk(events)
        if (parsed.text) { answer += parsed.text; onChunk(parsed.text) }
        if (parsed.done) break
      }

      const replacement = extractCode(answer)
      return {
        answer,
        replacement,
        summary: replacement ? 'Apply the assistant’s edit' : undefined,
      }
    },
  }
}
