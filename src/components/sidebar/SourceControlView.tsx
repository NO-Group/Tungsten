/**
 * The Source Control view: changes, history and GitHub.
 *
 * Every Git operation arrives as a callback. The view never touches
 * `window.tungsten`, so the same markup renders in the browser sandbox where
 * the only "changes" are unsaved buffers.
 */

import {
  Archive, Check, ChevronRight, CircleAlert, GitBranch, GitCommitHorizontal,
  GitCompareArrows, GitPullRequest, Minus, Plus, RefreshCw, X,
} from 'lucide-react'
import { FileGlyph } from '../FileGlyph'
import { TipButton } from '../TipButton'
import { fileName } from '../../workspace'

export type GitView = 'changes' | 'history' | 'github'
export type SourceChange = { path: string; status: string; staged?: boolean; workingTree?: boolean }
export type GitCommitEntry = { hash: string; shortHash: string; author: string; date: string; subject: string; refs: string }
export type GitStash = { ref: string; hash: string; subject: string }
export type GitHubItem = { number: number; title: string; state: string; url: string }

export type SourceControlViewProps = {
  /** True when real Git is available (desktop with a repository root). */
  desktop: boolean
  view: GitView
  branch: string
  branches: string[]
  isRepository: boolean
  error?: string
  operation: { operation: 'merge' | 'rebase' | null; conflicts: string[] }
  integrateBranch: string
  commitMessage: string
  changes: SourceChange[]
  history: GitCommitEntry[]
  stashes: GitStash[]
  github: { pullRequests: GitHubItem[]; issues: GitHubItem[] }
  onViewChange: (view: GitView) => void
  onCheckoutBranch: (branch: string) => void
  onOpenConflict: (path: string) => void
  onFinishOperation: (mode: 'continue' | 'abort') => void
  onIntegrateBranchChange: (branch: string) => void
  onIntegrate: (mode: 'merge' | 'rebase') => void
  onCommitMessageChange: (message: string) => void
  onCommit: () => void
  onRefresh: () => void
  onOpenChange: (change: SourceChange) => void
  onStageChange: (change: SourceChange) => void
  onStash: () => void
  onPopStash: (reference?: string) => void
  onOpenExternal: (url: string) => void
}

/** Git reports both sides of a conflict in the status code. */
function isConflict(status: string) {
  return status.includes('U') || status === 'AA' || status === 'DD'
}

export function SourceControlView({
  desktop, view, branch, branches, isRepository, error, operation, integrateBranch,
  commitMessage, changes, history, stashes, github, onViewChange, onCheckoutBranch,
  onOpenConflict, onFinishOperation, onIntegrateBranchChange, onIntegrate,
  onCommitMessageChange, onCommit, onRefresh, onOpenChange, onStageChange,
  onStash, onPopStash, onOpenExternal,
}: SourceControlViewProps) {
  return (
    <>
      <div className="sidebar-title">
        <span>SOURCE CONTROL</span>
        <span className="branch-label"><GitBranch size={11} />{branch || 'no repository'}</span>
      </div>

      <div className="git-view-tabs">
        <button className={view === 'changes' ? 'active' : ''} onClick={() => onViewChange('changes')}>Changes</button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => onViewChange('history')}>History</button>
        <button className={view === 'github' ? 'active' : ''} onClick={() => onViewChange('github')}>GitHub</button>
      </div>

      {view === 'changes' && <>
        {branches.length > 0 && (
          <div className="branch-switcher">
            <GitBranch size={13} />
            <select value={branch} onChange={(event) => onCheckoutBranch(event.target.value)}>
              {branches.map((name) => <option key={name}>{name}</option>)}
            </select>
          </div>
        )}

        {operation.operation ? (
          <div className="git-operation-card">
            <strong>{operation.operation.toUpperCase()} IN PROGRESS</strong>
            <span>{operation.conflicts.length
              ? `${operation.conflicts.length} conflict${operation.conflicts.length === 1 ? '' : 's'} must be resolved`
              : 'All conflicts resolved; ready to continue'}</span>
            {operation.conflicts.map((path) => (
              <button key={path} onClick={() => onOpenConflict(path)}>
                <GitCompareArrows size={12} /><span>{path}</span><ChevronRight size={11} />
              </button>
            ))}
            <div>
              <button disabled={operation.conflicts.length > 0} onClick={() => onFinishOperation('continue')}><Check size={11} />Continue</button>
              <button onClick={() => onFinishOperation('abort')}><X size={11} />Abort</button>
            </div>
          </div>
        ) : branches.length > 1 && (
          <div className="git-integrate">
            <select value={integrateBranch} onChange={(event) => onIntegrateBranchChange(event.target.value)}>
              <option value="">Integrate branch…</option>
              {branches.filter((name) => name !== branch).map((name) => <option key={name}>{name}</option>)}
            </select>
            <button disabled={!integrateBranch} onClick={() => onIntegrate('merge')}>Merge</button>
            <button disabled={!integrateBranch} onClick={() => onIntegrate('rebase')}>Rebase</button>
          </div>
        )}

        <div className="commit-box">
          <textarea
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.target.value)}
            onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onCommit() }}
            placeholder="Message (⌘Enter to commit)"
          />
          <button disabled={!commitMessage.trim() || (!changes.length && desktop)} onClick={onCommit}>
            <Check size={14} /> Commit all changes
          </button>
        </div>

        <div className="section-heading">
          <span>CHANGES</span>
          <span className="count-pill">{changes.length}</span>
          <TipButton label="Refresh Git status" onClick={onRefresh}><RefreshCw size={13} /></TipButton>
        </div>

        {!isRepository && desktop ? (
          <div className="sidebar-empty"><GitCommitHorizontal size={25} /><span>{error || 'This folder is not a Git repository'}</span></div>
        ) : changes.length === 0 ? (
          <div className="sidebar-empty"><GitCommitHorizontal size={25} /><span>Working tree is clean</span></div>
        ) : changes.map((change) => {
          const stagedOnly = Boolean(change.staged && !change.workingTree)
          return (
            <div className="change-row" key={change.path}>
              <button className="change-main" onClick={() => onOpenChange(change)}>
                <FileGlyph path={change.path} />
                <span>{fileName(change.path)}</span>
                <small>{change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}{change.staged ? ' · staged' : ''}</small>
              </button>
              {desktop && !isConflict(change.status) && (
                <button className="stage-button" title={stagedOnly ? 'Unstage file' : 'Stage file'} onClick={() => onStageChange(change)}>
                  {stagedOnly ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              )}
              <b>{change.status}</b>
            </div>
          )
        })}

        <div className="git-actions">
          <button onClick={onStash}>Stash changes</button>
          <button disabled={stashes.length === 0} onClick={() => onPopStash(stashes[0]?.ref)}>Pop stash</button>
        </div>
      </>}

      {view === 'history' && (
        <div className="git-history-list">
          {history.map((commit) => (
            <div key={commit.hash}>
              <i />
              <span>
                <strong>{commit.subject}</strong>
                <small>{commit.shortHash} · {commit.author} · {new Date(commit.date).toLocaleDateString()}</small>
                {commit.refs && <em>{commit.refs}</em>}
              </span>
            </div>
          ))}
          {stashes.length > 0 && <>
            <div className="section-heading"><span>STASHES</span><span className="count-pill">{stashes.length}</span></div>
            {stashes.map((stash) => (
              <button className="stash-row" key={stash.ref} onClick={() => onPopStash(stash.ref)}>
                <Archive size={12} /><span>{stash.subject}</span><small>{stash.ref}</small>
              </button>
            ))}
          </>}
        </div>
      )}

      {view === 'github' && (
        <div className="github-list">
          <div className="section-heading"><span>PULL REQUESTS</span><span className="count-pill">{github.pullRequests.length}</span></div>
          {github.pullRequests.map((item) => (
            <button key={`pr-${item.number}`} onClick={() => onOpenExternal(item.url)}>
              <GitPullRequest size={13} /><span><strong>#{item.number} {item.title}</strong><small>{item.state}</small></span>
            </button>
          ))}
          <div className="section-heading"><span>ISSUES</span><span className="count-pill">{github.issues.length}</span></div>
          {github.issues.map((item) => (
            <button key={`issue-${item.number}`} onClick={() => onOpenExternal(item.url)}>
              <CircleAlert size={13} /><span><strong>#{item.number} {item.title}</strong><small>{item.state}</small></span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export default SourceControlView
