/**
 * The Git service.
 *
 * Every Git operation the workbench performs lives here: status and history,
 * staging, commits, branches and stashes, diffs, blame, and merge or rebase
 * conflict resolution. The workbench supplies a small host -- how to notify,
 * how to show a virtual document, how to reload the workspace -- and gets back
 * state plus actions.
 *
 * Collecting it in one place means the desktop bridge is called from one file,
 * and the Source Control view can stay a pure renderer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { languageForPath, type WorkspaceFile } from '../workspace'
import {
  blameDocumentPath, conflictDocumentPath, diffDocumentPath, formatBlame, hasConflict, hasUnresolvedConflicts,
  isStagedOnly, mergeSourceChanges, resolutionMessage, type GitComparison, type SourceChange,
} from './gitModel'

export type { GitComparison }

export type GitView = 'changes' | 'history' | 'github'


export type GitOperationState = { operation: 'merge' | 'rebase' | null; conflicts: string[] }

/** What the service needs from the workbench around it. */
export type GitServiceHost = {
  workspaceRoot: string
  /**
   * Bumped by the workbench whenever the working tree may have changed on
   * disk -- a save, a refresh, a folder opened. Git state is re-read rather
   * than every one of those call sites having to know about Git.
   */
  revision: number
  /** Paths with unsaved editor changes, folded into the change list. */
  dirty: Set<string>
  activeFile?: WorkspaceFile
  notify: (message: string) => void
  /** Flush unsaved buffers to disk; a commit must not miss them. */
  save: () => Promise<void> | void
  refreshWorkspace: () => Promise<void> | void
  /** Opens a generated document (diff, conflict, blame) in an editor. */
  showDocument: (file: WorkspaceFile) => void
  /** Closes a generated document and focuses the real file behind it. */
  closeDocument: (virtualPath: string, focusPath: string) => void
  /** Reports command output into the terminal, as a commit does. */
  reportOutput: (text: string) => void
  /** Clears dirty state after a commit in the browser demo. */
  clearDirty: () => void
}

type GitHistoryEntry = { hash: string; shortHash: string; author: string; date: string; subject: string; refs: string }
type GitStash = { ref: string; hash: string; subject: string }
type GithubItem = { number: number; title: string; state: string; url: string }

/** A repository's state, as last read from one workspace root. */
type Repository = {
  root: string
  status: GitStatusResult
  branches: string[]
  history: GitHistoryEntry[]
  stashes: GitStash[]
  github: { pullRequests: GithubItem[]; issues: GithubItem[] }
  operation: GitOperationState
}

const EMPTY_STATUS: GitStatusResult = { isRepository: false, branch: 'main', changes: [], error: '' }
const EMPTY_OPERATION: GitOperationState = { operation: null, conflicts: [] }
const EMPTY_GITHUB = { pullRequests: [], issues: [] }
const EMPTY_REPOSITORY: Repository = {
  root: '', status: EMPTY_STATUS, branches: [], history: [], stashes: [], github: EMPTY_GITHUB, operation: EMPTY_OPERATION,
}

export function useGitService(host: GitServiceHost) {
  const { workspaceRoot, revision, dirty, activeFile, notify, save, refreshWorkspace, showDocument, closeDocument, reportOutput, clearDirty } = host

  /**
   * Everything Git told us, stamped with the workspace it describes.
   *
   * Keeping the root in the state means a new workspace shows empty Git state
   * immediately, and a reply that arrives late for the previous root is
   * ignored rather than clearing the new one.
   */
  const [loaded, setLoaded] = useState<Repository>(EMPTY_REPOSITORY)
  const repository = loaded.root === workspaceRoot ? loaded : EMPTY_REPOSITORY
  const { status, branches, history, stashes, github, operation } = repository

  const [comparison, setComparison] = useState<GitComparison | null>(null)
  const [view, setView] = useState<GitView>('changes')
  const [integrateBranch, setIntegrateBranch] = useState('')
  const [commitMessage, setCommitMessage] = useState('')

  const patch = useCallback((changes: Partial<Repository>) => {
    setLoaded((current) => ({ ...current, ...changes, root: workspaceRoot }))
  }, [workspaceRoot])

  /** The status alone; most operations return a fresh one as their result. */
  const setStatus = useCallback((next: GitStatusResult) => patch({ status: next }), [patch])

  const refresh = useCallback(async () => {
    const api = window.tungsten
    if (!api || !workspaceRoot) return
    try {
      patch({ status: await api.gitStatus() })
      // The rest is detail: slower, and never worth blocking the status on.
      api.gitHistory(150).then((next) => patch({ history: next })).catch(() => patch({ history: [] }))
      api.gitBranches().then((next) => patch({ branches: next })).catch(() => patch({ branches: [] }))
      api.gitOperationStatus().then((next) => patch({ operation: next })).catch(() => patch({ operation: EMPTY_OPERATION }))
      api.gitStashes().then((next) => patch({ stashes: next })).catch(() => patch({ stashes: [] }))
      api.githubItems().then((next) => patch({ github: next })).catch(() => patch({ github: EMPTY_GITHUB }))
    } catch (error) {
      patch({ status: { isRepository: false, branch: '', changes: [], error: (error as Error).message } })
    }
  }, [patch, workspaceRoot])

  /**
   * Git state belongs to a workspace, so it is reloaded whenever the root or
   * the working tree changes. Nothing else has to remember to keep the two in
   * step.
   */
  useEffect(() => {
    // Wrapped so the reads happen off the render path rather than
    // synchronously inside the effect body.
    const load = async () => { await refresh() }
    void load()
  }, [refresh, revision])

  const sourceChanges = useMemo(() => mergeSourceChanges(status, dirty), [dirty, status])

  const openDiff = useCallback(async (path: string, staged = false) => {
    const api = window.tungsten
    if (!api) return
    try {
      const [{ diff, hunks }, versions] = await Promise.all([api.gitDiff(path, staged), api.gitFileVersions(path, staged)])
      const virtualPath = diffDocumentPath(path, staged)
      setComparison({ ...versions, virtualPath, hunks })
      showDocument({ path: virtualPath, content: diff, language: 'diff' })
    } catch (error) {
      notify(`Could not open diff: ${(error as Error).message}`)
    }
  }, [notify, showDocument])

  const openConflict = useCallback(async (path: string) => {
    const api = window.tungsten
    if (!api) return
    try {
      const versions = await api.gitConflictVersions(path)
      const virtualPath = conflictDocumentPath(path)
      setComparison({
        path, virtualPath, before: versions.ours, after: versions.theirs,
        base: versions.base, staged: false, hunks: [], conflict: true,
      })
      // The conflict opens on "theirs" so the incoming change is what you edit.
      showDocument({ path: virtualPath, content: versions.theirs, language: languageForPath(path) })
    } catch (error) {
      notify(`Could not open conflict: ${(error as Error).message}`)
    }
  }, [notify, showDocument])

  /** Opens whichever review surface the change calls for. */
  const openChange = useCallback((change: SourceChange) => {
    if (hasConflict(change.status)) void openConflict(change.path)
    else void openDiff(change.path, isStagedOnly(change))
  }, [openConflict, openDiff])

  const stageHunk = useCallback(async (patch: string) => {
    const api = window.tungsten
    if (!api || !comparison) return
    try {
      setStatus(await api.gitStageHunk(patch, comparison.staged))
      notify(comparison.staged ? 'Hunk unstaged' : 'Hunk staged')
      // Re-open so the diff reflects what is left to stage.
      await openDiff(comparison.path, comparison.staged)
    } catch (error) {
      notify(`Could not apply hunk: ${(error as Error).message}`)
    }
  }, [comparison, notify, openDiff, setStatus])

  const stageFile = useCallback(async (change: SourceChange) => {
    const api = window.tungsten
    if (!api) return
    try {
      setStatus(await api.gitStage(change.path, !isStagedOnly(change)))
    } catch (error) {
      notify((error as Error).message)
    }
  }, [notify, setStatus])

  const resolveConflict = useCallback(async (resolution: 'ours' | 'theirs' | 'both' | 'mark') => {
    const api = window.tungsten
    if (!api || !comparison?.conflict) return
    try {
      setStatus(await api.gitResolveConflict(comparison.path, resolution))
      notify(resolutionMessage(resolution))
      closeDocument(comparison.virtualPath, comparison.path)
      setComparison(null)
      await refreshWorkspace()
      await refresh()
    } catch (error) {
      notify(`Could not resolve conflict: ${(error as Error).message}`)
    }
  }, [closeDocument, comparison, notify, refresh, refreshWorkspace, setStatus])

  const commit = useCallback(async () => {
    if (!commitMessage.trim()) return
    const api = window.tungsten
    if (!api || !workspaceRoot) {
      // The browser demo has no repository; committing just clears the slate.
      clearDirty()
      setCommitMessage('')
      notify('Demo changes committed locally')
      return
    }
    try {
      await save()
      const result = await api.gitCommit(commitMessage)
      setStatus(result.status)
      setCommitMessage('')
      reportOutput(result.output)
      notify('Changes committed')
    } catch (error) {
      notify(`Commit failed: ${(error as Error).message}`)
    }
  }, [clearDirty, commitMessage, notify, reportOutput, save, setStatus, workspaceRoot])

  const checkout = useCallback(async (branch: string) => {
    const api = window.tungsten
    if (!api) return
    try {
      setStatus(await api.gitCheckout(branch))
      await refreshWorkspace()
    } catch (error) {
      notify((error as Error).message)
    }
  }, [notify, refreshWorkspace, setStatus])

  const integrate = useCallback(async (mode: 'merge' | 'rebase') => {
    const api = window.tungsten
    if (!api || !integrateBranch) return
    try {
      const result = await api.gitIntegrate(mode, integrateBranch)
      setStatus(result)
      await refreshWorkspace()
      await refresh()
      notify(`${mode === 'merge' ? 'Merge' : 'Rebase'} ${hasUnresolvedConflicts(result.changes) ? 'requires conflict resolution' : 'completed'}`)
    } catch (error) {
      notify(`${mode} failed: ${(error as Error).message}`)
      await refresh()
    }
  }, [integrateBranch, notify, refresh, refreshWorkspace, setStatus])

  const finishOperation = useCallback(async (action: 'continue' | 'abort') => {
    const api = window.tungsten
    if (!api || !operation.operation) return
    try {
      setStatus(await api.gitOperationAction(operation.operation, action))
      await refreshWorkspace()
      await refresh()
      notify(`${operation.operation} ${action === 'continue' ? 'continued' : 'aborted'}`)
    } catch (error) {
      notify(`Could not ${action} ${operation.operation}: ${(error as Error).message}`)
    }
  }, [notify, operation.operation, refresh, refreshWorkspace, setStatus])

  const stash = useCallback(async () => {
    const api = window.tungsten
    if (!api) return
    try {
      setStatus(await api.gitStashPush(`Tungsten stash ${new Date().toLocaleString()}`))
      await refresh()
    } catch (error) {
      notify((error as Error).message)
    }
  }, [notify, refresh, setStatus])

  const popStash = useCallback(async (reference?: string) => {
    const api = window.tungsten
    const target = reference || stashes[0]?.ref
    if (!api || !target) return
    try {
      setStatus(await api.gitStashPop(target))
      await refreshWorkspace()
      await refresh()
    } catch (error) {
      notify((error as Error).message)
    }
  }, [notify, refresh, refreshWorkspace, setStatus, stashes])

  const openBlame = useCallback(async () => {
    const api = window.tungsten
    // Blaming a generated diff document would be meaningless.
    if (!api || !activeFile || activeFile.language === 'diff') return
    try {
      const blame = await api.gitBlame(activeFile.path)
      showDocument({ path: blameDocumentPath(activeFile.path), content: formatBlame(blame), language: 'plaintext' })
    } catch (error) {
      notify(`Could not load blame: ${(error as Error).message}`)
    }
  }, [activeFile, notify, showDocument])

  return {
    status,
    branches,
    history,
    stashes,
    github,
    operation,
    comparison,
    setComparison,
    view,
    setView,
    integrateBranch,
    setIntegrateBranch,
    commitMessage,
    setCommitMessage,
    sourceChanges,
    refresh,
    commit,
    checkout,
    openDiff,
    openConflict,
    openChange,
    openBlame,
    stageHunk,
    stageFile,
    resolveConflict,
    integrate,
    finishOperation,
    stash,
    popStash,
  }
}

export type GitService = ReturnType<typeof useGitService>
