/**
 * The project: its tasks, its tests, its coverage, and the extensions
 * installed alongside it.
 *
 * All of it is read from the workspace on disk, so it is reloaded whenever the
 * workspace changes rather than every caller that touches the disk having to
 * remember to refresh it.
 */

import { useCallback, useEffect, useState } from 'react'

/** What the browser build shows when there is no project to inspect. */
const DEMO_PROJECT: ProjectInfo = {
  tasks: [
    { label: 'npm: dev', command: 'npm run dev' },
    { label: 'npm: build', command: 'npm run build' },
  ],
  tests: [],
  frameworks: ['Vite', 'React'],
}

export type TestRun = {
  status: 'running' | 'passed' | 'failed'
  durationMs?: number
  output?: string
  failures?: string[]
  snapshots?: string[]
}

export type DiscoveredTest = { id: string; name: string; path: string; line: number; command: string }

export type ProjectHost = {
  workspaceRoot: string
  /** Bumped by the workbench when the files on disk may have changed. */
  revision: number
  notify: (message: string) => void
  /** Runs a command where the user can watch it, for the browser fallback. */
  runInTerminal: (command: string) => void
}

export function useProjectService({ workspaceRoot, revision, notify, runInTerminal }: ProjectHost) {
  const [info, setInfo] = useState<ProjectInfo>(DEMO_PROJECT)
  const [tests, setTests] = useState<DiscoveredTest[]>([])
  const [results, setResults] = useState<Record<string, TestRun>>({})
  const [activeResult, setActiveResult] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<Record<string, Array<{ line: number; hits: number }>>>({})
  const [extensions, setExtensions] = useState<ExtensionManifest[]>([])

  const refresh = useCallback(() => {
    const api = window.tungsten
    if (!api || !workspaceRoot) {
      // No workspace to inspect: fall back to what the browser build shows,
      // rather than leaving the last project's tasks and tests on screen.
      setInfo(DEMO_PROJECT)
      setTests([])
      setResults({})
      setCoverage({})
      return
    }
    api.detectProject().then(setInfo).catch(() => undefined)
    api.discoverTests().then(setTests).catch(() => setTests([]))
    api.readCoverage().then(setCoverage).catch(() => setCoverage({}))
    api.scanExtensions().then(setExtensions).catch(() => undefined)
  }, [workspaceRoot])

  /** The project follows the workspace: reloaded on change, cleared with it. */
  useEffect(() => {
    // Wrapped so the reads happen off the render path.
    const load = async () => refresh()
    void load()
  }, [refresh, revision])

  /**
   * Runs one discovered test.
   *
   * Without a desktop there is no runner, so the test's own command is sent to
   * the terminal instead -- the user still gets to see it run.
   */
  const runTest = useCallback(async (testId: string) => {
    if (!window.tungsten) {
      const test = tests.find((candidate) => candidate.id === testId)
      if (test) runInTerminal(test.command)
      return
    }
    setActiveResult(testId)
    setResults((current) => ({ ...current, [testId]: { status: 'running' } }))
    try {
      const result = await window.tungsten.runTest(testId)
      setResults((current) => ({ ...current, [testId]: result }))
      setCoverage(result.coverage)
      notify(`Test ${result.status} in ${result.durationMs} ms`)
    } catch (error) {
      const message = (error as Error).message
      setResults((current) => ({ ...current, [testId]: { status: 'failed', output: message, failures: [message] } }))
    }
  }, [notify, runInTerminal, tests])

  const installExtension = useCallback(async () => {
    if (!window.tungsten) {
      notify('Local extensions are available in the desktop app')
      return
    }
    try {
      const result = await window.tungsten.installExtensionFolder()
      setExtensions(result.extensions)
      if (!result.canceled) notify('Extension installed')
    } catch (error) {
      notify(`Extension install failed: ${(error as Error).message}`)
    }
  }, [notify])

  const uninstallExtension = useCallback((id: string) => {
    window.tungsten?.uninstallExtension(id).then(setExtensions).catch((error: Error) => notify(error.message))
  }, [notify])

  const setExtensionEnabled = useCallback((id: string, enabled: boolean) => {
    window.tungsten?.setExtensionEnabled(id, enabled).then(setExtensions).catch((error: Error) => notify(error.message))
  }, [notify])

  return {
    info,
    tests,
    results,
    activeResult,
    setActiveResult,
    coverage,
    extensions,
    refresh,
    runTest,
    installExtension,
    uninstallExtension,
    setExtensionEnabled,
  }
}

export type ProjectService = ReturnType<typeof useProjectService>
