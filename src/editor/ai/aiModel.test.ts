/**
 * The permission tiers, and the edit arithmetic under them.
 *
 * The tests that matter most are the negative ones: an advisor turn must not
 * produce a changed buffer by any route, and a proposed edit must not apply
 * itself.
 */

import { describe, expect, it } from 'vitest'

import {
  applyReplacement, appliesImmediately, describeRange, mayMutate, previewOf, settle, withChunk,
  type AiContext, type AiTurn,
} from './aiModel'
import {
  actionFor, extractCode, localAssistant, parseSseChunk, performLocalAction, splitEvents,
} from './providers'

const buffer = ['const a = 1', 'const b = 2', 'const c = 3'].join('\n')

const context = (overrides: Partial<AiContext> = {}): AiContext => ({
  path: 'src/thing.ts',
  buffer,
  selection: 'const b = 2',
  startLine: 2,
  endLine: 2,
  language: 'typescript',
  ...overrides,
})

const turn = (overrides: Partial<AiTurn> = {}): AiTurn => ({
  id: 1,
  prompt: 'do the thing',
  mode: 'diff',
  context: context(),
  answer: '',
  state: 'streaming',
  ...overrides,
})

describe('permission tiers', () => {
  it('lets only two of the three modes write at all', () => {
    expect(mayMutate('advisor')).toBe(false)
    expect(mayMutate('diff')).toBe(true)
    expect(mayMutate('autonomous')).toBe(true)
  })

  it('lets only autonomous write without being asked again', () => {
    expect(appliesImmediately('advisor')).toBe(false)
    expect(appliesImmediately('diff')).toBe(false)
    expect(appliesImmediately('autonomous')).toBe(true)
  })

  it('refuses to change a buffer in advisor mode, even with an edit in hand', () => {
    const advised = settle(turn({ mode: 'advisor' }), { answer: 'here', replacement: 'const b = 99' })
    expect(advised.state).toBe('answered')
    expect(previewOf(advised)).toBe(buffer)
  })

  it('holds a diff turn at proposed until it is accepted', () => {
    const proposed = settle(turn({ mode: 'diff' }), { answer: 'ok', replacement: 'const b = 99' })
    expect(proposed.state).toBe('proposed')
    expect(previewOf(proposed)).toContain('const b = 99')
  })

  it('marks an autonomous turn applied', () => {
    const applied = settle(turn({ mode: 'autonomous' }), { answer: 'ok', replacement: 'const b = 99' })
    expect(applied.state).toBe('applied')
  })

  it('treats an answer with no edit as an answer, in every mode', () => {
    for (const mode of ['advisor', 'diff', 'autonomous'] as const) {
      const answered = settle(turn({ mode }), { answer: 'just prose' })
      expect(answered.state).toBe('answered')
      expect(previewOf(answered)).toBe(buffer)
    }
  })
})

describe('applying an edit', () => {
  it('replaces exactly the selected lines', () => {
    expect(applyReplacement(context(), 'const b = 99')).toBe('const a = 1\nconst b = 99\nconst c = 3')
  })

  it('replaces a multi-line selection with multi-line text', () => {
    const wide = context({ selection: 'const a = 1\nconst b = 2', startLine: 1, endLine: 2 })
    expect(applyReplacement(wide, 'let a = 1\nlet b = 2\nlet extra = 0'))
      .toBe('let a = 1\nlet b = 2\nlet extra = 0\nconst c = 3')
  })

  it('clamps a range that runs past the end of the file', () => {
    const past = context({ startLine: 3, endLine: 99 })
    expect(applyReplacement(past, 'const c = 30')).toBe('const a = 1\nconst b = 2\nconst c = 30')
  })

  it('accumulates streamed chunks in order', () => {
    expect(withChunk(withChunk(turn(), 'Hel'), 'lo').answer).toBe('Hello')
  })

  it('says which lines a turn is about', () => {
    expect(describeRange(context())).toBe('line 2')
    expect(describeRange(context({ startLine: 2, endLine: 5 }))).toBe('lines 2–5')
    expect(describeRange(context({ selection: '' }))).toBe('the whole file')
  })
})

describe('the local rules assistant', () => {
  it('recognises the job from the request', () => {
    expect(actionFor('wrap this in try/catch please')).toBe('try')
    expect(actionFor('add a jsdoc comment')).toBe('document')
    expect(actionFor('log the result')).toBe('log')
    expect(actionFor('todo: come back to this')).toBe('todo')
    expect(actionFor('convert this function to an arrow')).toBe('arrow')
    expect(actionFor('what does this do?')).toBe('explain')
  })

  it('wraps a selection in try/catch, keeping the indentation', () => {
    const proposal = performLocalAction('try', {
      prompt: 'wrap in try',
      context: context({ selection: '  await save(row)', startLine: 2, endLine: 2 }),
    })
    expect(proposal.replacement).toContain('  try {')
    expect(proposal.replacement).toContain('    await save(row)')
    expect(proposal.replacement).toContain('throw error')
  })

  it('documents a function with its parameters', () => {
    const proposal = performLocalAction('document', {
      prompt: 'document this',
      context: context({ selection: 'function send(to, body) {', startLine: 1, endLine: 1 }),
    })
    expect(proposal.replacement).toContain('@param to')
    expect(proposal.replacement).toContain('@param body')
    expect(proposal.replacement).toContain('function send(to, body) {')
  })

  it('converts a function declaration to an arrow, and says when it cannot', () => {
    const converted = performLocalAction('arrow', {
      prompt: 'to arrow',
      context: context({ selection: 'function add(a, b) {\n  return a + b\n}', startLine: 1, endLine: 3 }),
    })
    expect(converted.replacement).toContain('const add = (a, b) => {')

    const refused = performLocalAction('arrow', { prompt: 'to arrow', context: context() })
    expect(refused.replacement).toBeUndefined()
    expect(refused.answer).toContain('nothing to convert')
  })

  it('explains a fragment with facts rather than flourish', () => {
    const proposal = performLocalAction('explain', {
      prompt: 'what is this',
      context: context({ selection: 'async function load() {\n  const rows = await db.select("users")\n  return rows\n}', startLine: 1, endLine: 4 }),
    })
    expect(proposal.answer).toContain('await')
    expect(proposal.answer).toContain('db.select')
    expect(proposal.answer).toContain('try/catch')
    expect(proposal.replacement).toBeUndefined()
  })

  it('streams its answer in pieces', async () => {
    const chunks: string[] = []
    const proposal = await localAssistant.run(
      { prompt: 'wrap in try', context: context() },
      (chunk) => chunks.push(chunk),
    )
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.join('')).toBe(proposal.answer)
  })
})

describe('reading a remote stream', () => {
  it('pulls the text out of SSE frames', () => {
    const frame = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
    ].join('\n')
    expect(parseSseChunk(frame)).toEqual({ text: 'Hello world', done: false })
  })

  it('notices the end of the stream', () => {
    expect(parseSseChunk('data: [DONE]').done).toBe(true)
  })

  it('ignores keep-alives and half-arrived frames', () => {
    expect(parseSseChunk(': keep-alive\ndata: {"choices":[{"delta":').text).toBe('')
  })

  it('keeps a partial frame for the next read', () => {
    const { events, rest } = splitEvents('data: {"a":1}\n\ndata: {"b":')
    expect(events).toBe('data: {"a":1}')
    expect(rest).toBe('data: {"b":')
  })

  it('takes the code out of a fenced reply', () => {
    expect(extractCode('Sure:\n```ts\nconst a = 1\n```\nthat is it')).toBe('const a = 1')
    expect(extractCode('no code here')).toBeUndefined()
  })
})

describe('a TODO carries the note, not the instruction', () => {
  it('strips the words that asked for it', () => {
    const proposal = performLocalAction('todo', {
      prompt: 'add a todo: check the rate limit',
      context: context(),
    })
    expect(proposal.replacement).toContain('// TODO: check the rate limit')
    expect(proposal.replacement).not.toContain('add a todo')
  })

  it('falls back to something rather than an empty note', () => {
    const proposal = performLocalAction('todo', { prompt: 'todo', context: context() })
    expect(proposal.replacement).toContain('// TODO: revisit this')
  })
})
