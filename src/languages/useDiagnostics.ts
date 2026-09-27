/**
 * The workbench's view of the language servers.
 *
 * Owns the problem list, the Problems panel's filter and severity toggles,
 * and the language status shown in the status bar. It also keeps the running
 * server told about the file being edited: started shortly after a file is
 * opened, and sent the document again shortly after it changes, both
 * debounced so typing never queues a request per keystroke.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  IDLE_LANGUAGE_STATUS,
  countDiagnostics,
  diagnosticsToMarkers,
  mergeDiagnostics,
  type Diagnostic,
  type LanguageStatus,
} from './diagnostics'
import { lspLanguages, prepareLanguageDocument, toMonacoRangeArgs } from './monacoLanguageClient'
import { MarkerSeverity, filterMarkers, groupMarkersByResource } from '../markers/markerService'

/** Long enough that opening a file in passing does not start a server. */
const START_DEBOUNCE = 350
/** Long enough that a burst of typing sends one document, not thirty. */
const SYNC_DEBOUNCE = 450

export type DiagnosticsHost = {
  activeFile?: { path: string; language: string; content: string }
  workspaceRoot: string
  /** The focused Monaco editor, if one is mounted. */
  editorInstance: any
  /** Reads the Monaco module once the first editor has loaded it. Must be stable. */
  getMonaco: () => any
}

export function useDiagnostics({ activeFile, workspaceRoot, editorInstance, getMonaco }: DiagnosticsHost) {
  const [problems, setProblems] = useState<Diagnostic[]>([])
  const [status, setStatus] = useState<LanguageStatus>(IDLE_LANGUAGE_STATUS)
  const [filter, setFilter] = useState('')
  const [severities, setSeverities] = useState(MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info)

  /** Start the server for the language being edited, once the file settles. */
  useEffect(() => {
    if (!window.tungsten || !activeFile || !workspaceRoot || !lspLanguages.has(activeFile.language)) return
    const language = activeFile.language
    let canceled = false
    const timer = window.setTimeout(() => {
      window.tungsten!.startLanguageServer(language).then((started) => {
        if (canceled) return
        setStatus({
          language,
          running: started.running,
          message: started.running ? `${language} language server` : started.error || 'Syntax highlighting only',
        })
      }).catch((error: Error) => {
        if (!canceled) setStatus({ language, running: false, message: error.message })
      })
    }, START_DEBOUNCE)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [activeFile, workspaceRoot])

  /** Keep the server's copy of the document current. */
  useEffect(() => {
    if (!window.tungsten || !activeFile || !workspaceRoot || !lspLanguages.has(activeFile.language)) return
    const language = activeFile.language
    const timer = window.setTimeout(async () => {
      const model = editorInstance?.getModel()
      if (!model) return
      const context = await prepareLanguageDocument(language, model)
      if (!context) return
      await context.api.languageNotify(language, 'textDocument/didChange', {
        textDocument: { uri: context.uri, version: model.getVersionId() },
        contentChanges: [{ text: model.getValue() }],
      })
    }, SYNC_DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [activeFile, editorInstance, workspaceRoot])

  /**
   * A server published diagnostics for one file: update the Problems panel and
   * the squiggles in that file's model, and leave every other file alone.
   */
  const handleNotification = useCallback(({ language, message }: { language: string; message: any }) => {
    const monaco = getMonaco()
    if (message.method !== 'textDocument/publishDiagnostics' || !monaco) return
    const diagnostics: any[] = message.params?.diagnostics || []
    const uri = decodeURIComponent(message.params?.uri || '')
    const model = monaco.editor.getModels()
      .find((candidate: any) => uri.endsWith(decodeURIComponent(candidate.uri.path)))
    if (!model) return

    const path = model.uri.path.replace(/^\/+/, '')
    setProblems((current) => mergeDiagnostics(current, path, diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      path,
      line: diagnostic.range.start.line + 1,
      severity: diagnostic.severity || 3,
    }))))

    monaco.editor.setModelMarkers(model, `tungsten-${language}`, diagnostics.map((diagnostic) => {
      const [startLineNumber, startColumn, endLineNumber, endColumn] = toMonacoRangeArgs(diagnostic.range)
      return {
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        message: diagnostic.message,
        source: diagnostic.source || language,
        code: diagnostic.code?.toString(),
        severity: diagnostic.severity === 1 ? monaco.MarkerSeverity.Error
          : diagnostic.severity === 2 ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
      }
    }))
  }, [getMonaco])

  const handleStatus = useCallback(({ language, running }: { language: string; running: boolean }) => {
    setStatus({ language, running, message: running ? `${language} language server` : `${language} server stopped` })
  }, [])

  const markers = useMemo(() => diagnosticsToMarkers(problems), [problems])
  const groups = useMemo(
    () => groupMarkersByResource(filterMarkers(markers, filter, severities)),
    [markers, filter, severities],
  )
  const counts = useMemo(() => countDiagnostics(problems), [problems])

  return {
    problems,
    status,
    filter,
    setFilter,
    severities,
    setSeverities,
    groups,
    counts,
    handleNotification,
    handleStatus,
  }
}
