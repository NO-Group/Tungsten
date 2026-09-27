import { describe, expect, it } from 'vitest'

import {
  IDLE_SESSION, appendOutput, breakpointsByPath, reduceDebugMessage, toggleBreakpointAt,
  withBreakpointCondition, workspacePathForSource, type DebugSession,
} from './debugModel'

const running: DebugSession = { ...IDLE_SESSION, running: true, id: 'session-1' }

/** Feeds a sequence of messages through the reducer, as the adapter would. */
function converse(start: DebugSession, exchanges: Array<[Parameters<typeof reduceDebugMessage>[1], string[]?]>, watches: string[] = []) {
  let session = start
  const sent: string[] = []
  for (const [message] of exchanges) {
    const reaction = reduceDebugMessage(session, message, watches)
    session = reaction.session
    sent.push(...reaction.requests.map((request) => request.command))
  }
  return { session, sent }
}

describe('adapter conversation', () => {
  it('asks for threads when the program stops, and records why', () => {
    const { session, requests } = reduceDebugMessage(running, { type: 'event', event: 'stopped', body: { threadId: 7, reason: 'exception' } }, [])
    expect(session.threadId).toBe(7)
    expect(session.output).toEqual(['Paused: exception'])
    expect(requests).toEqual([{ command: 'threads', arguments: {} }])
  })

  it('walks threads to a stack to scopes to variables', () => {
    const { session, sent } = converse(running, [
      [{ type: 'event', event: 'stopped', body: {} }],
      [{ type: 'response', success: true, command: 'threads', body: { threads: [{ id: 3, name: 'main' }] } }],
      [{ type: 'response', success: true, command: 'stackTrace', body: { stackFrames: [{ id: 11, name: 'run', line: 4 }] } }],
      [{ type: 'response', success: true, command: 'scopes', body: { scopes: [{ name: 'Locals', variablesReference: 22 }] } }],
      [{ type: 'response', success: true, command: 'variables', body: { variables: [{ name: 'x', value: '1' }] } }],
    ])
    expect(sent).toEqual(['threads', 'stackTrace', 'scopes', 'variables'])
    expect(session.threads).toHaveLength(1)
    expect(session.frames[0].id).toBe(11)
    expect(session.scopes[0].name).toBe('Locals')
    expect(session.variables).toEqual([{ name: 'x', value: '1' }])
  })

  it('requests the stack for the first thread reported', () => {
    const { requests } = reduceDebugMessage(running, {
      type: 'response', success: true, command: 'threads', body: { threads: [{ id: 9, name: 'worker' }] },
    }, [])
    expect(requests[0].arguments).toEqual({ threadId: 9, startFrame: 0, levels: 50 })
  })

  it('stops chaining when there is nothing to expand', () => {
    expect(reduceDebugMessage(running, { type: 'response', success: true, command: 'stackTrace', body: { stackFrames: [] } }, []).requests).toEqual([])
    expect(reduceDebugMessage(running, { type: 'response', success: true, command: 'scopes', body: { scopes: [] } }, []).requests).toEqual([])
  })

  it('evaluates watches against the top frame and matches replies to them in order', () => {
    const withFrames = { ...running, frames: [{ id: 42, name: 'run', line: 1 }] }
    const scopes = reduceDebugMessage(withFrames, {
      type: 'response', success: true, command: 'scopes', body: { scopes: [{ name: 'Locals', variablesReference: 5 }] },
    }, ['count', 'user.name'])
    expect(scopes.requests.map((request) => request.command)).toEqual(['variables', 'evaluate', 'evaluate'])
    expect(scopes.requests[1].arguments).toEqual({ expression: 'count', frameId: 42, context: 'watch' })
    expect(scopes.session.pendingWatches).toEqual(['count', 'user.name'])

    // The replies carry no expression, so they are matched by request order.
    const first = reduceDebugMessage(scopes.session, { type: 'response', success: true, command: 'evaluate', body: { result: '3' } }, [])
    const second = reduceDebugMessage(first.session, { type: 'response', success: true, command: 'evaluate', body: {} }, [])
    expect(second.session.watchValues).toEqual({ count: '3', 'user.name': 'undefined' })
    expect(second.session.pendingWatches).toEqual([])
  })

  it('ignores an evaluate reply nobody is waiting for', () => {
    const { session } = reduceDebugMessage(running, { type: 'response', success: true, command: 'evaluate', body: { result: '1' } }, [])
    expect(session.watchValues).toEqual({})
  })

  it('reports failures and adapter output on the console', () => {
    expect(reduceDebugMessage(running, { type: 'response', success: false, command: 'stepIn', message: 'Cannot step' }, []).session.output)
      .toEqual(['Cannot step'])
    expect(reduceDebugMessage(running, { type: 'response', success: false, command: 'stepIn' }, []).session.output)
      .toEqual(['stepIn failed'])
    expect(reduceDebugMessage(running, { type: 'event', event: 'output', body: { output: 'hello' } }, []).session.output)
      .toEqual(['hello'])
  })

  it('marks the session stopped when the program ends, and asks for nothing more', () => {
    const { session, requests } = reduceDebugMessage(running, { type: 'event', event: 'terminated' }, [])
    expect(session.running).toBe(false)
    expect(requests).toEqual([])
  })

  it('waits for the caller to configure breakpoints once initialized', () => {
    const reaction = reduceDebugMessage(running, { type: 'event', event: 'initialized' }, [])
    expect(reaction.configure).toBe(true)
    expect(reaction.requests).toEqual([])
  })

  it('leaves the session untouched for messages it does not handle', () => {
    expect(reduceDebugMessage(running, { type: 'event', event: 'thread' }, []).session).toBe(running)
    expect(reduceDebugMessage(running, { type: 'request', command: 'runInTerminal' }, []).session).toBe(running)
  })

  it('appends console lines without losing the earlier ones', () => {
    expect(appendOutput(appendOutput(IDLE_SESSION, 'one'), 'two', 'three').output).toEqual(['one', 'two', 'three'])
  })
})

describe('breakpoints', () => {
  const points = [{ path: 'a.ts', line: 3 }, { path: 'b.ts', line: 9 }]

  it('toggles a line on and off', () => {
    expect(toggleBreakpointAt(points, 'a.ts', 12)).toHaveLength(3)
    expect(toggleBreakpointAt(points, 'a.ts', 3)).toEqual([{ path: 'b.ts', line: 9 }])
    // Same line number in another file is a different breakpoint.
    expect(toggleBreakpointAt(points, 'b.ts', 3)).toHaveLength(3)
  })

  it('sets and clears a condition on one breakpoint only', () => {
    const conditional = withBreakpointCondition(points, 'a.ts', 3, 'i > 2')
    expect(conditional[0]).toEqual({ path: 'a.ts', line: 3, condition: 'i > 2' })
    expect(conditional[1]).toEqual({ path: 'b.ts', line: 9 })
    // An empty condition means unconditional, not a condition of "".
    expect(withBreakpointCondition(conditional, 'a.ts', 3, '')[0].condition).toBeUndefined()
  })

  it('groups by file, which is how the adapter wants them set', () => {
    const grouped = breakpointsByPath([...points, { path: 'a.ts', line: 40 }])
    expect([...grouped.keys()]).toEqual(['a.ts', 'b.ts'])
    expect(grouped.get('a.ts')).toHaveLength(2)
  })
})

describe('frame sources', () => {
  const paths = ['src/main.ts', 'src/util.ts']

  it('strips the workspace root from an absolute path', () => {
    expect(workspacePathForSource({ path: '/work/app/src/main.ts' }, '/work/app', paths)).toBe('src/main.ts')
  })

  it('handles Windows separators in either half', () => {
    expect(workspacePathForSource({ path: 'C:\\work\\app\\src\\util.ts' }, 'C:\\work\\app', paths)).toBe('src/util.ts')
  })

  it('falls back to a suffix match when the adapter reports another root', () => {
    expect(workspacePathForSource({ path: '/container/build/src/util.ts' }, '/work/app', paths)).toBe('src/util.ts')
  })

  it('returns nothing for a frame outside the workspace', () => {
    expect(workspacePathForSource({ path: '/usr/lib/node/internal.js' }, '/work/app', paths)).toBe('')
    expect(workspacePathForSource(undefined, '/work/app', paths)).toBe('')
    // The suffix fallback is deliberately lenient about the root, so that a
    // container or symlinked checkout still lands on the right buffer.
    expect(workspacePathForSource({ path: '/elsewhere/src/main.ts' }, '/work/app', paths)).toBe('src/main.ts')
  })
})
