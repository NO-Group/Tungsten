/**
 * The debug session.
 *
 * Owns the adapter's lifetime, the breakpoints, the watch expressions, and the
 * state the Run and Debug view renders. The protocol itself is a pure reducer
 * in `debugModel.ts`; this adds the parts that cannot be pure -- starting the
 * adapter, sending requests, and resolving workspace paths to absolute ones.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  IDLE_SESSION, appendOutput, breakpointsByPath, reduceDebugMessage, toggleBreakpointAt,
  withBreakpointCondition, type Breakpoint, type DebugMessage, type DebugRequest, type DebugSession,
} from './debugModel'

export type DebugHost = {
  workspaceRoot: string
  /** Used to find `.tungsten/launch.json` and to report a missing one. */
  launchConfig?: string
  notify: (message: string) => void
  /** Brings the Run and Debug view forward when a session starts. */
  revealDebugView: () => void
}

export function useDebugSession({ workspaceRoot, launchConfig, notify, revealDebugView }: DebugHost) {
  const [session, setSession] = useState<DebugSession>(IDLE_SESSION)
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([])
  const [watches, setWatches] = useState<string[]>([])

  /**
   * Adapter messages arrive outside React, sometimes several in a tick, so the
   * reducer reads the session from a ref that is written synchronously rather
   * than from a render-scoped value that may be one message behind.
   */
  const sessionRef = useRef(session)
  const breakpointsRef = useRef(breakpoints)
  const watchesRef = useRef(watches)
  useEffect(() => {
    sessionRef.current = session
    breakpointsRef.current = breakpoints
    watchesRef.current = watches
  })

  const apply = useCallback((next: DebugSession) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const send = useCallback(async (id: string, request: DebugRequest) => {
    await window.tungsten?.sendDebug(id, { type: 'request', command: request.command, arguments: request.arguments || {} })
  }, [])

  /** Sends every breakpoint with an absolute path, then releases the adapter. */
  const configureAdapter = useCallback(async (id: string) => {
    for (const [path, points] of breakpointsByPath(breakpointsRef.current)) {
      const absolutePath = await window.tungsten!.absolutePath(path)
      await send(id, {
        command: 'setBreakpoints',
        arguments: { source: { path: absolutePath }, breakpoints: points.map((point) => ({ line: point.line, condition: point.condition })) },
      })
    }
    await send(id, { command: 'configurationDone' })
  }, [send])

  /** Routes one adapter message: update the session, send what it implies. */
  const handleMessage = useCallback((id: string, message: DebugMessage) => {
    const reaction = reduceDebugMessage(sessionRef.current, message, watchesRef.current)
    apply(reaction.session)
    reaction.requests.forEach((request) => { void send(id, request) })
    if (reaction.configure) void configureAdapter(id)
  }, [apply, configureAdapter, send])

  const handleOutput = useCallback((output: string) => apply(appendOutput(sessionRef.current, output)), [apply])

  const handleExit = useCallback((code: number) => {
    apply({ ...appendOutput(sessionRef.current, `Adapter exited with code ${code}`), running: false })
  }, [apply])

  const start = useCallback(async () => {
    if (!window.tungsten || !workspaceRoot) {
      notify('Open a desktop workspace before debugging')
      return
    }
    if (!launchConfig) {
      revealDebugView()
      notify('Create .tungsten/launch.json to configure a debug adapter')
      return
    }
    try {
      const manifest = JSON.parse(launchConfig)
      const configuration = manifest.configurations?.[0]
      if (!configuration) throw new Error('No launch configuration was found.')
      const { id } = await window.tungsten.startDebug(configuration)
      apply({ ...IDLE_SESSION, running: true, id, output: [`Started ${configuration.name || 'debug adapter'}`] })
      await send(id, {
        command: 'initialize',
        arguments: {
          clientID: 'tungsten', clientName: 'Tungsten IDE', adapterID: configuration.type || 'custom',
          pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
        },
      })
      revealDebugView()
    } catch (error) {
      apply({ ...IDLE_SESSION, output: [(error as Error).message] })
      notify(`Debugger failed: ${(error as Error).message}`)
    }
  }, [apply, launchConfig, notify, revealDebugView, send, workspaceRoot])

  const stop = useCallback(async () => {
    const { id } = sessionRef.current
    if (window.tungsten && id) await window.tungsten.stopDebug(id)
    apply({ ...appendOutput(sessionRef.current, 'Debug session stopped'), running: false })
  }, [apply])

  const control = useCallback(async (command: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') => {
    const { id, threadId } = sessionRef.current
    if (!window.tungsten || !id) return
    await send(id, { command, arguments: { threadId: threadId || 1 } })
      .catch((error: Error) => notify(`Debug ${command} failed: ${error.message}`))
  }, [notify, send])

  /** Pushes the breakpoints for one file to a live adapter. */
  const syncBreakpoints = useCallback(async (path: string, points: Breakpoint[]) => {
    const { id } = sessionRef.current
    if (!window.tungsten || !id) return
    try {
      const absolutePath = await window.tungsten.absolutePath(path)
      await send(id, {
        command: 'setBreakpoints',
        arguments: {
          source: { path: absolutePath },
          breakpoints: points.filter((point) => point.path === path).map((point) => ({ line: point.line, condition: point.condition })),
        },
      })
    } catch (error) {
      notify(`Breakpoint sync failed: ${(error as Error).message}`)
    }
  }, [notify, send])

  const toggleBreakpoint = useCallback(async (path: string, line: number) => {
    const next = toggleBreakpointAt(breakpointsRef.current, path, line)
    breakpointsRef.current = next
    setBreakpoints(next)
    await syncBreakpoints(path, next)
  }, [syncBreakpoints])

  const setBreakpointCondition = useCallback(async (path: string, line: number, condition?: string) => {
    const next = withBreakpointCondition(breakpointsRef.current, path, line, condition)
    breakpointsRef.current = next
    setBreakpoints(next)
    await syncBreakpoints(path, next)
  }, [syncBreakpoints])

  const selectThread = useCallback((threadId: number) => {
    const { id } = sessionRef.current
    apply({ ...sessionRef.current, threadId })
    if (id) void send(id, { command: 'stackTrace', arguments: { threadId, startFrame: 0, levels: 50 } })
  }, [apply, send])

  const selectFrame = useCallback((frameId: number) => {
    const { id } = sessionRef.current
    if (id) void send(id, { command: 'scopes', arguments: { frameId } })
  }, [send])

  const addWatch = useCallback((expression: string) => {
    if (expression.trim()) setWatches((current) => [...current, expression.trim()])
  }, [])

  const removeWatch = useCallback((expression: string) => {
    setWatches((current) => current.filter((item) => item !== expression))
  }, [])

  return {
    session,
    breakpoints,
    watches,
    handleMessage,
    handleOutput,
    handleExit,
    start,
    stop,
    control,
    toggleBreakpoint,
    setBreakpointCondition,
    selectThread,
    selectFrame,
    addWatch,
    removeWatch,
  }
}

export type DebugService = ReturnType<typeof useDebugSession>
