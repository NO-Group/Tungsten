/**
 * The Debug Adapter Protocol conversation, as a pure state machine.
 *
 * A debug session is mostly a chain of replies: stopping asks for threads,
 * threads ask for a stack, the stack asks for scopes, scopes ask for variables
 * and watch evaluations. Writing that as a reducer -- message and current
 * session in, next session and the requests to send out -- keeps the ordering
 * rules in one testable place instead of spread through a subscription
 * callback.
 */

export type DebugThread = { id: number; name: string }
export type DebugFrame = { id: number; name: string; line: number; source?: { path?: string; name?: string } }
export type DebugScope = { name: string; variablesReference: number }
export type DebugVariable = { name: string; value: string; type?: string; variablesReference?: number }
export type Breakpoint = { path: string; line: number; condition?: string }

/** The fields of a DAP message body the workbench reads. */
export type DebugBody = {
  output?: string
  reason?: string
  threadId?: number
  threads?: DebugThread[]
  stackFrames?: DebugFrame[]
  scopes?: DebugScope[]
  variables?: DebugVariable[]
  result?: string
}

export type DebugMessage = {
  type: string
  event?: string
  command?: string
  success?: boolean
  message?: string
  body?: DebugBody
}

export type DebugSession = {
  running: boolean
  /** The debug console, oldest line first. */
  output: string[]
  id?: string
  threadId?: number
  threads: DebugThread[]
  frames: DebugFrame[]
  scopes: DebugScope[]
  variables: DebugVariable[]
  watchValues: Record<string, string>
  /** Watch expressions awaiting an `evaluate` reply, in the order requested. */
  pendingWatches: string[]
}

export type DebugRequest = { command: string; arguments?: Record<string, unknown> }

export type DebugReaction = {
  session: DebugSession
  /** Requests to send to the adapter, in order. */
  requests: DebugRequest[]
  /**
   * The adapter is ready to be configured. Breakpoints have to be sent with
   * absolute paths, which only the desktop side can resolve, so that part is
   * left to the caller.
   */
  configure?: boolean
}

export const IDLE_SESSION: DebugSession = {
  running: false, output: [], threads: [], frames: [], scopes: [], variables: [], watchValues: {}, pendingWatches: [],
}

/** How many stack frames to ask for; deeper than anyone reads, cheap to fetch. */
const STACK_FRAME_LIMIT = 50

export function appendOutput(session: DebugSession, ...lines: string[]): DebugSession {
  return { ...session, output: [...session.output, ...lines] }
}

export function reduceDebugMessage(session: DebugSession, message: DebugMessage, watches: string[]): DebugReaction {
  const still = (requests: DebugRequest[] = []) => ({ session, requests })
  const body = message.body || {}

  if (message.type === 'event') {
    if (message.event === 'initialized') return { session, requests: [], configure: true }
    if (message.event === 'output') return { session: appendOutput(session, body.output || ''), requests: [] }
    if (message.event === 'stopped') {
      const threadId = body.threadId || 1
      return {
        session: { ...appendOutput(session, `Paused: ${body.reason || 'breakpoint'}`), threadId },
        requests: [{ command: 'threads', arguments: {} }],
      }
    }
    if (message.event === 'terminated' || message.event === 'exited') {
      return { session: { ...session, running: false }, requests: [] }
    }
    return still()
  }

  if (message.type !== 'response') return still()

  if (message.success === false) {
    return { session: appendOutput(session, message.message || `${message.command} failed`), requests: [] }
  }

  switch (message.command) {
    case 'threads': {
      const threads = body.threads || []
      const threadId = threads[0]?.id || 1
      return {
        session: { ...session, threads },
        requests: [{ command: 'stackTrace', arguments: { threadId, startFrame: 0, levels: STACK_FRAME_LIMIT } }],
      }
    }
    case 'stackTrace': {
      const frames = body.stackFrames || []
      return {
        session: { ...session, frames },
        requests: frames[0]?.id ? [{ command: 'scopes', arguments: { frameId: frames[0].id } }] : [],
      }
    }
    case 'scopes': {
      const scopes = body.scopes || []
      const frameId = session.frames[0]?.id
      // Watches are evaluated against the top frame, one request each; the
      // replies carry no expression, so the order is remembered here.
      const evaluations = watches.map((expression) => ({
        command: 'evaluate',
        arguments: { expression, frameId, context: 'watch' },
      }))
      return {
        session: { ...session, scopes, pendingWatches: watches },
        requests: [
          ...(scopes[0]?.variablesReference ? [{ command: 'variables', arguments: { variablesReference: scopes[0].variablesReference } }] : []),
          ...evaluations,
        ],
      }
    }
    case 'variables':
      return { session: { ...session, variables: body.variables || [] }, requests: [] }
    case 'evaluate': {
      const [expression, ...pendingWatches] = session.pendingWatches
      if (!expression) return still()
      return {
        session: { ...session, pendingWatches, watchValues: { ...session.watchValues, [expression]: body.result || 'undefined' } },
        requests: [],
      }
    }
    default:
      return still()
  }
}

export function toggleBreakpointAt(breakpoints: Breakpoint[], path: string, line: number): Breakpoint[] {
  const exists = breakpoints.some((point) => point.path === path && point.line === line)
  return exists
    ? breakpoints.filter((point) => point.path !== path || point.line !== line)
    : [...breakpoints, { path, line }]
}

export function withBreakpointCondition(breakpoints: Breakpoint[], path: string, line: number, condition?: string): Breakpoint[] {
  return breakpoints.map((point) => (
    point.path === path && point.line === line ? { ...point, condition: condition || undefined } : point
  ))
}

/** Breakpoints grouped by file, which is how DAP wants them set. */
export function breakpointsByPath(breakpoints: Breakpoint[]): Map<string, Breakpoint[]> {
  const grouped = new Map<string, Breakpoint[]>()
  breakpoints.forEach((point) => grouped.set(point.path, [...(grouped.get(point.path) || []), point]))
  return grouped
}

/**
 * Maps a frame's source back onto a workspace path.
 *
 * Adapters report absolute, sometimes Windows-shaped paths. Everything in the
 * workbench is a workspace-relative path with forward slashes, so a frame is
 * only useful once it has been translated back.
 */
export function workspacePathForSource(
  source: { path?: string; name?: string } | undefined,
  workspaceRoot: string,
  paths: string[],
): string {
  const candidate = (source?.path || '').replaceAll('\\', '/')
  const root = workspaceRoot.replaceAll('\\', '/')
  const relative = root && candidate.startsWith(`${root}/`)
    ? candidate.slice(root.length + 1)
    : paths.find((path) => candidate.endsWith(`/${path}`)) || source?.name || ''
  return paths.includes(relative) ? relative : ''
}
