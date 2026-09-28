/**
 * One editor group: a tab strip, breadcrumbs, and an editor body.
 *
 * Tungsten's window can hold up to four of these side by side or stacked.
 * Every group is a full editor -- there is no privileged "primary" pane and
 * no cheap placeholder for the inactive ones. The only thing the active group
 * has that the others do not is ownership of the Monaco instance that
 * editor-scoped commands resolve through.
 *
 * The component is deliberately presentational: it holds no state of its own
 * and never mutates the layout directly. Every interaction is reported
 * upward, which is what keeps the group model in `src/editor/editorGroups.ts`
 * the single source of truth for what is open.
 */

import { Suspense, lazy } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Eye,
  FileCode2,
  FolderOpen,
  GitCommitHorizontal,
  GitCompareArrows,
  Hammer,
  Minus,
  Play,
  Plus,
  SplitSquareHorizontal,
  SquareCode,
  UsersRound,
  X,
} from 'lucide-react'

import { PREVIEW_PATH, fileName, type WorkspaceFile } from '../workspace'
import type { GitComparison } from '../git/gitModel'
import { type TungstenTheme, monacoThemeName } from '../theme/themeService'
import {
  type EditorGroup as EditorGroupModel,
  type EditorGroupLayout,
  focusGroup,
  moveEditor,
  setActiveEditor,
  setGroupEditors,
  splitGroup,
  togglePinned,
} from '../editor/editorGroups'
import { FileGlyph } from './FileGlyph'
import { TipButton } from './TipButton'
import { Preview } from './Preview'

const configuredEditor = () => import('./ConfiguredEditor')
const Editor = lazy(configuredEditor)
const DiffEditor = lazy(() => configuredEditor().then((module) => ({ default: module.DiffEditor })))

/**
 * The Monaco options this group renders with, already resolved from the
 * configuration by `editorOptionsFromConfiguration`. The group does not read
 * settings itself: it is handed what to draw with.
 */
export type EditorSettings = {
  editor: Record<string, unknown>
  diff: Record<string, unknown>
}

/** The staged/unstaged comparison currently being reviewed, if any. */

/**
 * Everything the group can ask the workbench to do.
 *
 * Bundling these keeps the call site readable: a group needs a lot of the
 * application, and thirty loose props would obscure which of them are
 * commands and which are data.
 */
export type EditorGroupActions = {
  setLayout: (update: (current: EditorGroupLayout) => EditorGroupLayout) => void
  closeTab: (groupId: number, path: string) => void
  updateFile: (path: string, value?: string) => void
  openFile: (path: string) => void
  notify: (message: string) => void

  setEditorInstance: (editor: unknown) => void
  setCursor: (position: { line: number; column: number }) => void
  setFocusedSurface: (next: string | ((current: string) => string)) => void
  toggleBreakpoint: (path: string, line: number) => void

  buildPreview: () => string
  setSidePreview: (update: (value: boolean) => boolean) => void
  runProject: () => void
  openCommandPalette: (mode: 'commands' | 'files') => void

  resolveGitConflict: (resolution: 'ours' | 'theirs' | 'both' | 'mark') => void | Promise<void>
  stageGitHunk: (patch: string) => void | Promise<void>

  openDesktopFolder: () => void
  openNewFileDialog: () => void
  openRemoteDialog: () => void
  openCollaborationDialog: () => void
  openProjectDialog: () => void
}

/**
 * Monaco wiring the workbench owns.
 *
 * `register` runs once per editor mount and installs the language providers,
 * snippet provider and themes. `api` returns the live Monaco namespace, which
 * the gutter click handler needs in order to compare against MouseTargetType.
 * Both are injected rather than imported so this component stays free of the
 * LSP and snippet plumbing.
 */
export type MonacoBridge = {
  register: (monaco: unknown) => void
  api: () => { editor: { MouseTargetType: Record<string, number> } } | null
}

export type EditorGroupProps = {
  group: EditorGroupModel
  layout: EditorGroupLayout
  files: WorkspaceFile[]
  dirty: Set<string>
  settings: EditorSettings
  theme: TungstenTheme
  workspaceName: string
  gitComparison: GitComparison | null
  sidePreview: boolean
  monaco: MonacoBridge
  actions: EditorGroupActions
}

export type { GitComparison }


const loadingEditor = (
  <div className="editor-loading">
    <div className="loading-mark"><Hammer size={24} /></div>
    <span>Heating editor core…</span>
  </div>
)

export function EditorGroup({
  group,
  layout,
  files,
  dirty,
  settings,
  theme,
  workspaceName,
  gitComparison,
  sidePreview,
  monaco,
  actions,
}: EditorGroupProps) {
  const isActive = group.id === layout.activeGroupId
  const activePath = group.editors[group.activeIndex]?.path ?? ''
  const activeFile = files.find((file) => file.path === activePath)
  const showingDiff = Boolean(gitComparison && activePath === gitComparison.virtualPath)
  const splitDirection = layout.orientation === 'horizontal' ? 'right' : 'down'

  return (
    <div
      className={`editor-group ${isActive ? 'active' : ''}`}
      style={{ flexGrow: group.size, flexBasis: 0 }}
      onMouseDownCapture={() => { if (!isActive) actions.setLayout((current) => focusGroup(current, group.id)) }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('text/tungsten-editor')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData('text/tungsten-editor')
        if (!raw) return
        event.preventDefault()
        try {
          const { path, groupId } = JSON.parse(raw) as { path: string; groupId: number }
          if (groupId === group.id) return
          actions.setLayout((current) => moveEditor(current, path, groupId, group.id))
        } catch {
          // A drag that originated outside Tungsten. Ignore it.
        }
      }}
    >
      <div className="editor-tabs">
        <div className="tab-scroll">
          {group.editors.map((editor, editorIndex) => {
            const path = editor.path
            const isPreviewTab = path === PREVIEW_PATH
            return (
              <button
                key={path}
                className={`editor-tab ${activePath === path ? 'active' : ''} ${editor.pinned ? 'pinned' : ''} ${editor.preview ? 'preview' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/tungsten-editor', JSON.stringify({ path, groupId: group.id }))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onAuxClick={(event) => {
                  // Middle-click closes, as it does in every browser and in VS Code.
                  if (event.button !== 1) return
                  event.preventDefault()
                  actions.closeTab(group.id, path)
                }}
                onDoubleClick={() => actions.setLayout((current) => togglePinned(current, path, group.id))}
                onClick={() => actions.setLayout((current) => setActiveEditor(current, group.id, editorIndex))}
              >
                {isPreviewTab ? <Eye size={14} className="preview-tab-icon" /> : <FileGlyph path={path} />}
                <span>{isPreviewTab ? 'Preview' : fileName(path)}</span>
                {dirty.has(path)
                  ? <span className="tab-dirty" />
                  : <X size={13} className="tab-close" onClick={(event) => { event.stopPropagation(); actions.closeTab(group.id, path) }} />}
              </button>
            )
          })}
        </div>
        <div className="tab-actions">
          {isActive && <>
            <TipButton label="Run project" onClick={actions.runProject}><Play size={14} fill="currentColor" /></TipButton>
            <TipButton label="Toggle side preview" active={sidePreview} onClick={() => actions.setSidePreview((value) => !value)}><SplitSquareHorizontal size={14} /></TipButton>
          </>}
          <TipButton
            label={`Split editor ${splitDirection}`}
            onClick={() => actions.setLayout((current) => splitGroup(focusGroup(current, group.id), splitDirection, activePath || undefined))}
          ><SplitSquareHorizontal size={14} /></TipButton>
          {layout.groups.length > 1 && (
            <TipButton label="Close group" onClick={() => actions.setLayout((current) => setGroupEditors(current, group.id, []))}><X size={14} /></TipButton>
          )}
          {isActive && <TipButton label="More actions" onClick={() => actions.openCommandPalette('commands')}><Ellipsis size={15} /></TipButton>}
        </div>
      </div>

      {activePath && activePath !== PREVIEW_PATH && (
        <div className="breadcrumbs">
          <span>{workspaceName}</span><ChevronRight size={12} />
          {activePath.split('/').map((part, index, parts) => (
            <span className="crumb" key={`${part}-${index}`}>
              {index === parts.length - 1 && <FileGlyph path={activePath} />}
              {part}
              {index < parts.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
          {dirty.has(activePath) && <span className="unsaved-label">UNSAVED</span>}
        </div>
      )}

      <div className={`editor-area ${sidePreview && activeFile && activePath !== PREVIEW_PATH ? 'with-side-preview' : ''}`}>
        <Suspense fallback={loadingEditor}>
          {activePath === PREVIEW_PATH ? (
            <Preview html={actions.buildPreview()} onReload={() => actions.notify('Preview refreshed')} />
          ) : showingDiff && gitComparison ? (
            <div className="git-compare-editor">
              <div className="git-compare-toolbar">
                <span><GitCompareArrows size={13} /> {gitComparison.path}</span>
                <strong>{gitComparison.conflict ? 'CURRENT ↔ INCOMING' : gitComparison.staged ? 'INDEX ↔ HEAD' : 'WORKTREE ↔ INDEX'}</strong>
                <div>
                  {gitComparison.conflict ? (
                    <>
                      <button onClick={() => { void actions.resolveGitConflict('ours') }}><Check size={11} />Accept current</button>
                      <button onClick={() => { void actions.resolveGitConflict('theirs') }}><Check size={11} />Accept incoming</button>
                      <button onClick={() => { void actions.resolveGitConflict('both') }}><Copy size={11} />Accept both</button>
                      <button title="Open the marker file for manual editing" onClick={() => actions.openFile(gitComparison.path)}><FileCode2 size={11} />Edit manually</button>
                      <button title="Stage the manually edited working file" onClick={() => { void actions.resolveGitConflict('mark') }}><GitCommitHorizontal size={11} />Mark resolved</button>
                    </>
                  ) : gitComparison.hunks.map((hunk, index) => (
                    <button key={hunk.id} title={hunk.header} onClick={() => { void actions.stageGitHunk(hunk.patch) }}>
                      {gitComparison.staged ? <Minus size={11} /> : <Plus size={11} />}
                      {gitComparison.staged ? 'Unstage' : 'Stage'} hunk {index + 1}
                    </button>
                  ))}
                </div>
              </div>
              <DiffEditor
                height="100%"
                original={gitComparison.before}
                modified={gitComparison.after}
                language={files.find((file) => file.path === gitComparison.path)?.language || 'plaintext'}
                theme={monacoThemeName(theme)}
                options={settings.diff}
              />
            </div>
          ) : activeFile ? (
            <Editor
              height="100%"
              path={`file:///${activeFile.path}`}
              language={activeFile.language}
              value={activeFile.content}
              theme={monacoThemeName(theme)}
              beforeMount={(instance: unknown) => monaco.register(instance)}
              onChange={(value?: string) => actions.updateFile(activePath, value)}
              onMount={(editor: any) => {
                if (isActive) actions.setEditorInstance(editor)
                editor.onDidChangeCursorPosition((event: any) => actions.setCursor({ line: event.position.lineNumber, column: event.position.column }))
                editor.onDidFocusEditorText(() => {
                  // Focus follows the caret: the pane being typed in becomes the
                  // active group and takes ownership of `editorInstance`, so
                  // editor-scoped commands always act on what the user sees.
                  actions.setFocusedSurface('editor')
                  actions.setEditorInstance(editor)
                  actions.setLayout((current) => focusGroup(current, group.id))
                })
                editor.onDidBlurEditorText(() => actions.setFocusedSurface((current: string) => current === 'editor' ? 'none' : current))
                editor.onMouseDown((event: any) => {
                  const api = monaco.api()
                  if (!api) return
                  const breakpointPath = decodeURIComponent(editor.getModel()?.uri.path || '').replace(/^\/+/, '')
                  if (event.target.type === api.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position && breakpointPath) {
                    actions.toggleBreakpoint(breakpointPath, event.target.position.lineNumber)
                  }
                })
                editor.focus()
              }}
              options={{ ...settings.editor, readOnly: activeFile.language === 'diff' }}
              loading={loadingEditor}
            />
          ) : (
            <div className={`empty-editor ${isActive ? '' : 'idle'}`}>
              <div className="empty-brand"><Hammer size={41} /></div>
              <h2>TUNGSTEN</h2>
              <p>A development environment forged for focus.</p>
              <div className="dashboard-cards">
                <button onClick={actions.openDesktopFolder}><FolderOpen size={16} /><span><strong>Local workspace</strong><small>Open a folder on this computer</small></span></button>
                <button onClick={actions.openRemoteDialog}><SquareCode size={16} /><span><strong>Remote development</strong><small>SSH, containers, and WSL</small></span></button>
                <button onClick={actions.openCollaborationDialog}><UsersRound size={16} /><span><strong>Live collaboration</strong><small>Shared editing and review</small></span></button>
              </div>
              <div className="empty-actions">
                <button onClick={actions.openProjectDialog}>New project <kbd>⇧⌘N</kbd></button>
                <button onClick={actions.openDesktopFolder}>Open folder <kbd>⌘O</kbd></button>
                <button onClick={() => actions.openCommandPalette('files')}>Quick open <kbd>⌘P</kbd></button>
                <button onClick={actions.openNewFileDialog}>New file <kbd>⌘N</kbd></button>
                <button onClick={actions.runProject}>Run project <kbd>⌃↵</kbd></button>
              </div>
            </div>
          )}
        </Suspense>

        {sidePreview && activeFile && activePath !== PREVIEW_PATH && (
          <div className="side-preview-pane">
            <div className="side-preview-heading">
              <span><Eye size={12} /> LIVE PREVIEW</span>
              <button title="Close side preview" onClick={() => actions.setSidePreview(() => false)}><X size={13} /></button>
            </div>
            <div className="side-preview-content">
              <Preview html={actions.buildPreview()} onReload={() => actions.notify('Preview refreshed')} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditorGroup
