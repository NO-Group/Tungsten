import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Bell,
  Blocks,
  Bot,
  Box,
  BugPlay,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  CircleCheck,
  CircleStop,
  CircleUserRound,
  Columns2,
  Command,
  Copy,
  CornerDownRight,
  Cpu,
  Ellipsis,
  ExternalLink,
  Download,
  Eye,
  File,
  FileCode2,
  FlaskConical,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  Hammer,
  Keyboard,
  Layers,
  ListChecks,
  Maximize2,
  Menu,
  Minus,
  PackagePlus,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  Pause,
  Play,
  Plus,
  Radio,
  Rocket,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SquareCode,
  SplitSquareHorizontal,
  StepForward,
  TerminalSquare,
  Trash2,
  Undo2,
  UsersRound,
  Mic,
  X,
  Zap,
} from 'lucide-react'
import { defaultFiles, fileIconClass, fileName, languageForPath, supportedLanguages, symbolsFor, type WorkspaceFile } from './workspace'
import {
  applyMonacoTheme,
  applyWorkbenchTheme,
  getTheme,
  loadThemeId,
  monacoThemeName,
  saveThemeId,
  themes,
} from './theme/themeService'
import { prepareQuery, scoreItem, type Match } from './quickopen/fuzzyScorer'
import { chordFromEvent, createResolver, keybindingLabel, parseKeybinding, type KeybindingRule } from './keybinding/keybindings'
import defaultKeybindingRules from './keybinding/defaults'
import { parseWhenClause, type Context as WhenContext } from './keybinding/contextkey'
const DesktopTerminal = lazy(() => import('./components/DesktopTerminal'))
const configuredEditor = () => import('./components/ConfiguredEditor')
const Editor = lazy(configuredEditor)
const DiffEditor = lazy(() => configuredEditor().then((module) => ({ default: module.DiffEditor })))
import './styles.css'

type Activity = 'explorer' | 'search' | 'source' | 'debug' | 'tests' | 'extensions'
type TerminalProfile = { kind: 'wsl' | 'container'; id: string; label?: string }
type TerminalTab = { id: number; label: string; generation: number; profile?: Omit<TerminalProfile, 'label'> }
type CommandItem = {
  /** Stable VS Code-compatible command id, e.g. `workbench.action.files.save`. */
  id: string
  label: string
  detail: string
  icon: typeof File
  /** When clause gating palette visibility and keybinding dispatch. */
  when?: string
  action: () => void | Promise<void>
}

/** Quick-access modes, mirroring VS Code's quick-open prefixes. */
type PaletteMode = 'commands' | 'files' | 'symbols' | 'line'

/** A scored row in quick access, carrying fuzzy highlight ranges. */
type PaletteEntry = {
  id: string
  label: string
  detail: string
  icon: typeof File
  action: () => void | Promise<void>
  labelMatch: Match[]
  detailMatch: Match[]
  keybinding?: string
}
type SettingsState = {
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  autosave: boolean
  stickyScroll: boolean
  renderWhitespace: boolean
  reducedMotion: boolean
  highContrast: boolean
  screenReaderOptimized: boolean
  telemetry: boolean
  crashReports: boolean
}

type TreeNode = {
  name: string
  path: string
  folder: boolean
  children: TreeNode[]
}

const WORKSPACE_KEY = 'tungsten.workspace.v1'
const SETTINGS_KEY = 'tungsten.settings.v1'
const TERMINAL_LAYOUT_KEY = 'tungsten.terminals.v2'
const WORKBENCH_LAYOUT_KEY = 'tungsten.workbench.v2'
/** User keybinding overrides, keyed by command id. */
const KEYBINDINGS_KEY = 'tungsten.keybindings.v2'
const APP_VERSION = '3.0'
const PREVIEW_PATH = '$preview'
const lspLanguages = new Set(['javascript', 'typescript', 'python', 'rust', 'go', 'c', 'cpp', 'java', 'csharp', 'ruby', 'php', 'kotlin', 'lua'])
const openedLspDocuments = new Set<string>()
let languageProvidersRegistered = false
let monacoApi: any = null
const semanticTokenTypes = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator']
const semanticTokenModifiers = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary']

async function prepareLanguageDocument(language: string, model: any) {
  const api = window.tungsten
  if (!api || !lspLanguages.has(language)) return null
  const relativePath = model.uri.path.replace(/^\/+/, '')
  const server = await api.startLanguageServer(language).catch(() => null)
  if (!server?.running) return null
  const uri = await api.fileUri(relativePath)
  const key = `${language}:${uri}`
  if (!openedLspDocuments.has(key)) {
    await api.languageNotify(language, 'textDocument/didOpen', {
      textDocument: { uri, languageId: language, version: model.getVersionId(), text: model.getValue() },
    })
    openedLspDocuments.add(key)
  }
  return { api, uri }
}

function registerLanguageProviders(monaco: any) {
  if (languageProvidersRegistered || !window.tungsten) return
  languageProvidersRegistered = true
  for (const language of lspLanguages) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '>', '/', '"', "'"],
      provideCompletionItems: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { suggestions: [] }
        const result = await context.api.languageRequest(language, 'textDocument/completion', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).catch(() => null)
        const items = Array.isArray(result) ? result : result?.items || []
        const word = model.getWordUntilPosition(position)
        const fallbackRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          suggestions: items.slice(0, 200).map((item: any) => ({
            label: typeof item.label === 'string' ? item.label : item.label?.label || 'completion',
            detail: item.detail,
            documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
            insertText: item.textEdit?.newText || item.insertText || (typeof item.label === 'string' ? item.label : item.label?.label) || 'completion',
            insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            kind: Math.max(0, Math.min(27, (item.kind || 1) - 1)),
            range: item.textEdit?.range ? new monaco.Range(
              item.textEdit.range.start.line + 1,
              item.textEdit.range.start.character + 1,
              item.textEdit.range.end.line + 1,
              item.textEdit.range.end.character + 1,
            ) : fallbackRange,
          })),
        }
      },
    })
    monaco.languages.registerHoverProvider(language, {
      provideHover: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const result = await context.api.languageRequest(language, 'textDocument/hover', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).catch(() => null)
        if (!result?.contents) return null
        const contents = Array.isArray(result.contents) ? result.contents : [result.contents]
        return { contents: contents.map((entry: any) => ({ value: typeof entry === 'string' ? entry : entry.value || '' })) }
      },
    })
    const locationRequest = async (method: string, model: any, position: any, extra: Record<string, unknown> = {}) => {
      const context = await prepareLanguageDocument(language, model)
      if (!context) return []
      const result = await context.api.languageRequest(language, method, {
        textDocument: { uri: context.uri },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        ...extra,
      }).catch(() => null)
      const locations = Array.isArray(result) ? result : result ? [result] : []
      return locations.map((location: any) => {
        const target = location.targetUri ? { uri: location.targetUri, range: location.targetSelectionRange || location.targetRange } : location
        return {
          uri: monaco.Uri.parse(target.uri),
          range: new monaco.Range(target.range.start.line + 1, target.range.start.character + 1, target.range.end.line + 1, target.range.end.character + 1),
        }
      })
    }
    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: (model: any, position: any) => locationRequest('textDocument/definition', model, position),
    })
    monaco.languages.registerReferenceProvider(language, {
      provideReferences: (model: any, position: any) => locationRequest('textDocument/references', model, position, { context: { includeDeclaration: true } }),
    })
    monaco.languages.registerRenameProvider(language, {
      provideRenameEdits: async (model: any, position: any, newName: string) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { edits: [], rejectReason: 'Language server unavailable.' }
        const result = await context.api.languageRequest(language, 'textDocument/rename', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          newName,
        }).catch(() => null)
        const edits: any[] = []
        for (const [uri, changes] of Object.entries(result?.changes || {})) {
          for (const change of changes as any[]) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { text: change.newText, range: new monaco.Range(change.range.start.line + 1, change.range.start.character + 1, change.range.end.line + 1, change.range.end.character + 1) }, versionId: undefined })
        }
        return { edits, rejectReason: edits.length ? undefined : 'No rename edits were returned.' }
      },
      resolveRenameLocation: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const result = await context.api.languageRequest(language, 'textDocument/prepareRename', { textDocument: { uri: context.uri }, position: { line: position.lineNumber - 1, character: position.column - 1 } }).catch(() => null)
        const range = result?.range || result
        return range ? { range: new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1), text: model.getValueInRange(new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1)) } : null
      },
    })
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const value = await context.api.languageRequest(language, 'textDocument/signatureHelp', { textDocument: { uri: context.uri }, position: { line: position.lineNumber - 1, character: position.column - 1 } }).catch(() => null)
        return value ? { value, dispose: () => undefined } : null
      },
    })
    monaco.languages.registerDocumentSemanticTokensProvider(language, {
      getLegend: () => ({ tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers }),
      provideDocumentSemanticTokens: async (model: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { data: new Uint32Array() }
        const result = await context.api.languageRequest(language, 'textDocument/semanticTokens/full', { textDocument: { uri: context.uri } }).catch(() => null)
        return { data: new Uint32Array(result?.data || []), resultId: result?.resultId }
      },
      releaseDocumentSemanticTokens: () => undefined,
    })
    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions: async (model: any, range: any, actionContext: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { actions: [], dispose: () => undefined }
        const diagnostics = actionContext.markers.map((marker: any) => ({
          range: { start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 }, end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 } },
          severity: marker.severity === monaco.MarkerSeverity.Error ? 1 : marker.severity === monaco.MarkerSeverity.Warning ? 2 : 3,
          message: marker.message,
          source: marker.source,
          code: marker.code,
        }))
        const results = await context.api.languageRequest(language, 'textDocument/codeAction', {
          textDocument: { uri: context.uri },
          range: { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } },
          context: { diagnostics, only: actionContext.only ? [actionContext.only] : undefined },
        }).catch(() => [])
        const actions = (results || []).map((action: any) => {
          const edits: any[] = []
          for (const [uri, changes] of Object.entries(action.edit?.changes || {})) {
            for (const change of changes as any[]) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { text: change.newText, range: new monaco.Range(change.range.start.line + 1, change.range.start.character + 1, change.range.end.line + 1, change.range.end.character + 1) }, versionId: undefined })
          }
          return { title: action.title, kind: action.kind, diagnostics: actionContext.markers, isPreferred: action.isPreferred, edit: edits.length ? { edits } : undefined, command: action.command ? { id: action.command.command, title: action.command.title || action.title, arguments: action.command.arguments } : undefined }
        })
        return { actions, dispose: () => undefined }
      },
    })
  }
}

const defaultSettings: SettingsState = {
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  autosave: false,
  stickyScroll: true,
  renderWhitespace: false,
  reducedMotion: false,
  highContrast: false,
  screenReaderOptimized: false,
  telemetry: false,
  crashReports: true,
}

function loadFiles() {
  try {
    const stored = localStorage.getItem(WORKSPACE_KEY)
    if (stored) return JSON.parse(stored) as WorkspaceFile[]
  } catch {
    // Fall back to the factory workspace.
  }
  return defaultFiles
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return defaultSettings
  }
}

function loadTerminalLayout(): { tabs: TerminalTab[]; activeId: number; split: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(TERMINAL_LAYOUT_KEY) || '{}')
    const tabs = Array.isArray(stored.tabs) ? stored.tabs.filter((tab: TerminalTab) => Number.isInteger(tab.id) && typeof tab.label === 'string').slice(0, 12) : []
    if (tabs.length) return { tabs: tabs.map((tab: TerminalTab) => ({ ...tab, generation: 0 })), activeId: tabs.some((tab: TerminalTab) => tab.id === stored.activeId) ? stored.activeId : tabs[0].id, split: Boolean(stored.split) }
  } catch { /* Use the default terminal layout. */ }
  return { tabs: [{ id: 1, label: 'shell 1', generation: 0 }], activeId: 1, split: false }
}

function loadWorkbenchLayout() {
  try { return JSON.parse(localStorage.getItem(WORKBENCH_LAYOUT_KEY) || '{}') as { sidebarWidth?: number; panelHeight?: number; sidebarVisible?: boolean; panelOpen?: boolean } }
  catch { return {} }
}

/** User overrides map a command id to a keybinding string ('' disables it). */
function loadUserKeybindings(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEYBINDINGS_KEY) || '{}') as Record<string, string> }
  catch { return {} }
}

/**
 * Merge the shipped defaults with the user's overrides. A user entry replaces
 * every default binding for that command, and an empty string unbinds it.
 */
function mergeKeybindings(overrides: Record<string, string>): KeybindingRule[] {
  const overridden = new Set(Object.keys(overrides))
  const rules = defaultKeybindingRules.filter((rule) => !overridden.has(rule.command))
  for (const [command, key] of Object.entries(overrides)) {
    if (key) rules.push({ command, key, isUser: true })
  }
  return rules
}

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = []

  files.forEach((file) => {
    const parts = file.path.split('/')
    let children = root
    let current = ''

    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part
      const isFolder = index < parts.length - 1
      let node = children.find((item) => item.name === part && item.folder === isFolder)
      if (!node) {
        node = { name: part, path: current, folder: isFolder, children: [] }
        children.push(node)
      }
      children = node.children
    })
  })

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
    nodes.forEach((node) => sort(node.children))
  }
  sort(root)
  return root
}

/**
 * Render text with the fuzzy-matched characters emphasised, the way VS Code
 * highlights quick-open results.
 */
function Highlight({ text, matches }: { text: string; matches: Match[] }) {
  if (!matches.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start))
    parts.push(<mark key={`${match.start}-${index}`}>{text.slice(match.start, match.end)}</mark>)
    cursor = match.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function FileGlyph({ path }: { path: string }) {
  const kind = fileIconClass(path)
  const labels: Record<string, string> = {
    js: 'JS', ts: 'TS', css: '#', html: '<>', data: '{}', md: 'M↓', npm: '⬡',
    script: 'λ', native: '◆', shell: '$_', query: 'Q', docker: '▣', file: '·',
  }
  return <span className={`file-glyph ${kind}`}>{labels[kind]}</span>
}

function TipButton({
  label,
  children,
  className = '',
  onClick,
  active = false,
  disabled = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function ExplorerTree({
  files,
  activePath,
  openFile,
  dirty,
  onFileContext,
}: {
  files: WorkspaceFile[]
  activePath: string
  openFile: (path: string) => void
  dirty: Set<string>
  onFileContext: (event: React.MouseEvent, path: string) => void
}) {
  const [expanded, setExpanded] = useState(() => new Set(['src', 'src/utils']))
  const tree = useMemo(() => buildTree(files), [files])

  const renderNode = (node: TreeNode, depth = 0) => {
    if (node.folder) {
      const isOpen = expanded.has(node.path)
      return (
        <div key={node.path}>
          <button
            className="tree-row folder-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (isOpen) next.delete(node.path)
              else next.add(node.path)
              return next
            })}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {isOpen ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
            <span>{node.name}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <button
        key={node.path}
        className={`tree-row file-row ${activePath === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: 26 + depth * 14 }}
        onClick={() => openFile(node.path)}
        onContextMenu={(event) => onFileContext(event, node.path)}
      >
        <FileGlyph path={node.path} />
        <span className="tree-label">{node.name}</span>
        {dirty.has(node.path) && <span className="dirty-dot" />}
      </button>
    )
  }

  return <div className="file-tree">{tree.map((node) => renderNode(node))}</div>
}

function Preview({ html, onReload }: { html: string; onReload: () => void }) {
  const [key, setKey] = useState(0)
  return (
    <section className="preview-shell">
      <div className="preview-toolbar">
        <div className="preview-controls">
          <button aria-label="Reload preview" title="Reload preview" onClick={() => { setKey((value) => value + 1); onReload() }}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="preview-address">
          <ShieldCheck size={13} />
          <span>tungsten://preview/forge</span>
        </div>
        <button className="preview-external" title="Open preview in a new tab" onClick={() => {
          const blob = new Blob([html], { type: 'text/html' })
          window.open(URL.createObjectURL(blob), '_blank')
        }}><ExternalLink size={13} /></button>
      </div>
      <iframe key={key} title="Project preview" sandbox="allow-scripts" srcDoc={html} />
    </section>
  )
}

const activityItems = [
  { id: 'explorer' as const, label: 'Explorer', icon: Files },
  { id: 'search' as const, label: 'Search', icon: Search },
  { id: 'source' as const, label: 'Source Control', icon: GitBranch },
  { id: 'debug' as const, label: 'Run and Debug', icon: BugPlay },
  { id: 'tests' as const, label: 'Testing', icon: FlaskConical },
  { id: 'extensions' as const, label: 'Extensions', icon: Blocks },
]

export default function App() {
  const [initialTerminalLayout] = useState(loadTerminalLayout)
  const [initialWorkbenchLayout] = useState(loadWorkbenchLayout)
  const [files, setFiles] = useState<WorkspaceFile[]>(loadFiles)
  const [workspaceName, setWorkspaceName] = useState('forge')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [workspaceRoots, setWorkspaceRoots] = useState<Array<{ name: string; path: string; prefix: string }>>([])
  const [openTabs, setOpenTabs] = useState(['README.md', 'index.html', 'src/main.js'])
  const [activePath, setActivePath] = useState('src/main.js')
  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarVisible, setSidebarVisible] = useState(initialWorkbenchLayout.sidebarVisible ?? true)
  const [sidebarWidth, setSidebarWidth] = useState(initialWorkbenchLayout.sidebarWidth ?? 248)
  const [panelOpen, setPanelOpen] = useState(initialWorkbenchLayout.panelOpen ?? true)
  const [panelHeight, setPanelHeight] = useState(initialWorkbenchLayout.panelHeight ?? 225)
  const [panelTab, setPanelTab] = useState('TERMINAL')
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: 'commands' })
  const [paletteQuery, setPaletteQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keybindingsOpen, setKeybindingsOpen] = useState(false)
  const [userKeybindings, setUserKeybindings] = useState<Record<string, string>>(loadUserKeybindings)
  const [themeId, setThemeId] = useState<string>(loadThemeId)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  /** Chords entered so far in a multi-chord sequence such as `ctrl+k ctrl+s`. */
  const [pendingChords, setPendingChords] = useState<string[]>([])
  /** Which surface has focus, used for `when` clauses like `terminalFocus`. */
  const [focusedSurface, setFocusedSurface] = useState<'editor' | 'terminal' | 'input' | 'none'>('none')
  const [zenMode, setZenMode] = useState(false)
  const [activityBarVisible, setActivityBarVisible] = useState(true)
  const [centeredLayout, setCenteredLayout] = useState(false)
  /** Recently closed editors, for Reopen Closed Editor. */
  const [closedTabs, setClosedTabs] = useState<string[]>([])
  /** Highlighted row in quick access, driven by the arrow keys. */
  const [paletteIndex, setPaletteIndex] = useState(0)
  /** Command currently capturing keystrokes in the keybinding editor. */
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null)
  const [keybindingFilter, setKeybindingFilter] = useState('')
  const [settings, setSettings] = useState<SettingsState>(loadSettings)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [sidePreview, setSidePreview] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [nativeSearchResults, setNativeSearchResults] = useState<Array<{ path: string; line: number; column: number; preview: string }>>([])
  const [searching, setSearching] = useState(false)
  const [externalChange, setExternalChange] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [gitInfo, setGitInfo] = useState<GitStatusResult>({ isRepository: false, branch: 'main', changes: [], error: '' })
  const [gitBranches, setGitBranches] = useState<string[]>([])
  const [gitView, setGitView] = useState<'changes' | 'history' | 'github'>('changes')
  const [gitOperation, setGitOperation] = useState<{ operation: 'merge' | 'rebase' | null; conflicts: string[] }>({ operation: null, conflicts: [] })
  const [gitIntegrateBranch, setGitIntegrateBranch] = useState('')
  const [gitComparison, setGitComparison] = useState<{ path: string; virtualPath: string; before: string; after: string; staged: boolean; hunks: Array<{ id: string; header: string; patch: string }>; conflict?: boolean; base?: string } | null>(null)
  const [gitHistory, setGitHistory] = useState<Array<{ hash: string; shortHash: string; author: string; date: string; subject: string; refs: string }>>([])
  const [gitStashes, setGitStashes] = useState<Array<{ ref: string; hash: string; subject: string }>>([])
  const [githubItems, setGithubItems] = useState<{ pullRequests: Array<{ number: number; title: string; state: string; url: string }>; issues: Array<{ number: number; title: string; state: string; url: string }> }>({ pullRequests: [], issues: [] })
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>({ tasks: [{ label: 'npm: dev', command: 'npm run dev' }, { label: 'npm: build', command: 'npm run build' }], tests: [], frameworks: ['Vite'] })
  const [discoveredTests, setDiscoveredTests] = useState<Array<{ id: string; name: string; path: string; line: number; command: string }>>([])
  const [testResults, setTestResults] = useState<Record<string, { status: 'running' | 'passed' | 'failed'; durationMs?: number; output?: string; failures?: string[]; snapshots?: string[] }>>({})
  const [activeTestResult, setActiveTestResult] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<Record<string, Array<{ line: number; hits: number }>>>({})
  const [extensions, setExtensions] = useState<ExtensionManifest[]>([])
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>(initialTerminalLayout.tabs)
  const nextTerminalIdRef = useRef(Math.max(0, ...initialTerminalLayout.tabs.map((terminal) => terminal.id)) + 1)
  const [activeTerminalId, setActiveTerminalId] = useState(initialTerminalLayout.activeId)
  const [terminalSplit, setTerminalSplit] = useState(initialTerminalLayout.split)
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false)
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('')
  const [terminalSearchRequest, setTerminalSearchRequest] = useState<{ id: number; query: string } | null>(null)
  const [terminalCommand, setTerminalCommand] = useState<{ id: number; command: string; terminalId?: number } | null>(null)
  const [projectModal, setProjectModal] = useState(false)
  const [remoteModal, setRemoteModal] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [sshConfig, setSshConfig] = useState({ host: '', port: '22', username: '', root: '/', password: '', privateKeyPath: '' })
  const [remoteProfiles, setRemoteProfiles] = useState<{ wsl: string[]; containers: Array<{ id: string; name: string; image: string }>; devcontainer: boolean }>({ wsl: [], containers: [], devcontainer: false })
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [collaborationUrl, setCollaborationUrl] = useState('')
  const [collaborationName, setCollaborationName] = useState('Developer')
  const [collaborationActive, setCollaborationActive] = useState(false)
  const [participants, setParticipants] = useState<string[]>([])
  const [collaboratorCursors, setCollaboratorCursors] = useState<Record<string, { path: string; line: number; column: number }>>({})
  const [comments, setComments] = useState<Array<{ name: string; text: string; path?: string; line?: number }>>([])
  const [commentInput, setCommentInput] = useState('')
  const [projectTemplate, setProjectTemplate] = useState('web')
  const [projectName, setProjectName] = useState('my-tungsten-app')
  const [debugState, setDebugState] = useState<{ running: boolean; output: string[]; id?: string; threadId?: number }>({ running: false, output: [] })
  const [breakpoints, setBreakpoints] = useState<Array<{ path: string; line: number; condition?: string }>>([])
  const [debugThreads, setDebugThreads] = useState<Array<{ id: number; name: string }>>([])
  const [debugFrames, setDebugFrames] = useState<Array<{ id: number; name: string; line: number; source?: { path?: string; name?: string } }>>([])
  const [debugScopes, setDebugScopes] = useState<Array<{ name: string; variablesReference: number }>>([])
  const [debugVariables, setDebugVariables] = useState<Array<{ name: string; value: string; type?: string; variablesReference?: number }>>([])
  const [watches, setWatches] = useState<string[]>([])
  const [watchInput, setWatchInput] = useState('')
  const [watchValues, setWatchValues] = useState<Record<string, string>>({})
  const [lspState, setLspState] = useState<{ language: string; running: boolean; message: string }>({ language: '', running: false, message: 'Built-in syntax engine' })
  const [problems, setProblems] = useState<Array<{ message: string; path: string; line: number; severity: number }>>([])
  const [updateState, setUpdateState] = useState('Up to date')
  const [editorInstance, setEditorInstance] = useState<any>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<Array<{ text: string; kind?: string }>>([
    { text: `Tungsten Shell 2.2.0  ·  ${window.tungsten ? 'desktop process runner' : 'web sandbox'}`, kind: 'muted' },
    { text: `${supportedLanguages.length} language grammars loaded. Type “help” for available commands.`, kind: 'success' },
  ])
  const [terminalInput, setTerminalInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const terminalInputRef = useRef<HTMLInputElement>(null)
  const paletteInputRef = useRef<HTMLInputElement>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const restoredWorkspaceRef = useRef(false)
  const watchEvaluationQueueRef = useRef<string[]>([])
  const toggleBreakpointRef = useRef<(path: string, line: number) => void>(() => undefined)
  /** Indirection so the global key listener always calls the latest dispatcher. */
  const runCommandRef = useRef<(id: string) => Promise<boolean>>(async () => false)

  const activeFile = files.find((file) => file.path === activePath)
  const symbols = useMemo(() => symbolsFor(activeFile), [activeFile])
  const runEditorAction = useCallback((action: string) => {
    void editorInstance?.getAction(action)?.run()
  }, [editorInstance])

  const activeTheme = useMemo(() => getTheme(themeId), [themeId])

  // Paint the workbench and Monaco whenever the selected theme changes.
  useEffect(() => {
    applyWorkbenchTheme(activeTheme)
    saveThemeId(activeTheme.id)
    if (monacoApi) applyMonacoTheme(monacoApi, activeTheme)
  }, [activeTheme])

  /** Keybinding rules currently in force (defaults merged with user overrides). */
  const keybindingRules = useMemo(() => mergeKeybindings(userKeybindings), [userKeybindings])
  const keybindingResolver = useMemo(() => createResolver(keybindingRules), [keybindingRules])
  /** Shortcut label for a command id, for menus and the palette. */
  const shortcutFor = useCallback((commandId: string) => keybindingResolver.lookupLabel(commandId), [keybindingResolver])

  /**
   * Context keys for `when` clause evaluation, mirroring the keys VS Code
   * exposes. Keybindings, palette entries and menu items are all filtered
   * through these.
   */
  const whenContext = useMemo<WhenContext>(() => ({
    editorFocus: focusedSurface === 'editor',
    terminalFocus: focusedSurface === 'terminal',
    editorTextFocus: focusedSurface === 'editor',
    inputFocus: focusedSurface === 'input',
    activityBar: activity,
    panelVisible: panelOpen,
    panelTab,
    sidebarVisible,
    zenMode,
    editorIsOpen: Boolean(activePath) && activePath !== PREVIEW_PATH,
    openTabs: openTabs.length,
    resourceExtname: activePath.includes('.') ? `.${activePath.split('.').pop()}` : '',
    resourceLangId: activeFile?.language || '',
    dirtyCount: dirty.size,
    isDesktop: Boolean(window.tungsten),
    workspaceOpen: Boolean(workspaceRoot),
    remoteConnected,
    gitRepository: gitInfo.isRepository,
    gitOperation: gitOperation.operation || '',
    debugState: debugState.running ? (debugState.threadId ? 'stopped' : 'running') : '',
    quickOpenOpen: palette.open,
  }), [activePath, activeFile, activity, debugState.running, debugState.threadId, dirty.size, focusedSurface, gitInfo.isRepository, gitOperation.operation, openTabs.length, palette.open, panelOpen, panelTab, remoteConnected, sidebarVisible, workspaceRoot, zenMode])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }, [])

  const save = useCallback(async (path?: string) => {
    const targets = path ? [path] : [...dirty]
    const finishSave = () => {
      if (path) {
        setDirty((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
        notify(`${fileName(path)} saved`)
      } else {
        setDirty(new Set())
        notify('All files saved')
      }
      if (window.tungsten && workspaceRoot) {
        window.tungsten.gitStatus().then(setGitInfo).catch(() => undefined)
        if (!path) void window.tungsten.clearRecovery()
      }
    }

    try {
      if (window.tungsten && workspaceRoot) {
        await Promise.all(targets.map((target) => {
          const file = files.find((item) => item.path === target)
          return file ? window.tungsten!.writeFile(file.path, file.content) : Promise.resolve({ ok: true as const })
        }))
      } else {
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(files))
      }
      finishSave()
    } catch (error) {
      notify(`Save failed: ${(error as Error).message}`)
      throw error
    }
  }, [dirty, files, notify, workspaceRoot])

  const openFile = useCallback((path: string) => {
    setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path])
    setActivePath(path)
  }, [])

  const applyDesktopWorkspace = useCallback((result: DesktopWorkspaceResult, restored = false, preserveTabs = false) => {
    if (result.canceled || !result.files) return
    const preferred = result.files.find((file) => file.path.toLowerCase() === 'readme.md')
      || result.files.find((file) => file.path === 'package.json')
      || result.files[0]
    setFiles(result.files)
    setWorkspaceName(result.name || 'workspace')
    setWorkspaceRoot(result.path || '')
    setWorkspaceRoots(result.roots || (result.path ? [{ name: result.name || 'workspace', path: result.path, prefix: '' }] : []))
    setRemoteConnected(Boolean(result.remote))
    if (!preserveTabs) {
      setOpenTabs(preferred ? [preferred.path] : [])
      setActivePath(preferred?.path || '')
    }
    setDirty(new Set())
    window.tungsten?.gitStatus().then(setGitInfo).catch(() => undefined)
    window.tungsten?.gitBranches().then(setGitBranches).catch(() => setGitBranches([]))
    window.tungsten?.gitHistory(150).then(setGitHistory).catch(() => setGitHistory([]))
    window.tungsten?.gitStashes().then(setGitStashes).catch(() => setGitStashes([]))
    window.tungsten?.gitOperationStatus().then(setGitOperation).catch(() => setGitOperation({ operation: null, conflicts: [] }))
    window.tungsten?.githubItems().then(setGithubItems).catch(() => setGithubItems({ pullRequests: [], issues: [] }))
    window.tungsten?.detectProject().then(setProjectInfo).catch(() => undefined)
    window.tungsten?.discoverTests().then(setDiscoveredTests).catch(() => setDiscoveredTests([]))
    window.tungsten?.readCoverage().then(setCoverage).catch(() => setCoverage({}))
    window.tungsten?.scanExtensions().then(setExtensions).catch(() => undefined)
    window.tungsten?.loadRecovery().then((snapshot) => {
      if (!snapshot?.files?.length || snapshot.workspaceRoot !== result.path) return
      if (window.confirm(`Tungsten found ${snapshot.files.length} recovered file${snapshot.files.length === 1 ? '' : 's'} from an interrupted session. Restore them?`)) {
        setFiles((current) => current.map((file) => snapshot.files.find((saved: WorkspaceFile) => saved.path === file.path) || file))
        setDirty(new Set(snapshot.files.map((file: WorkspaceFile) => file.path)))
        notify('Recovery snapshot restored')
      } else {
        void window.tungsten?.clearRecovery()
      }
    }).catch(() => undefined)
    setTerminalLines((lines) => [...lines, { text: `${restored ? 'Restored' : 'Opened'} ${result.path} · ${result.files!.length} text files indexed`, kind: 'success' }])
    notify(result.truncated ? 'Workspace opened; 4,000-file index limit reached' : `${result.name} ${restored ? 'restored' : 'opened'}`)
  }, [notify])

  const openDesktopFolder = useCallback(async () => {
    if (!window.tungsten) {
      notify('Install the desktop app to open local folders')
      return
    }

    try {
      applyDesktopWorkspace(await window.tungsten.openFolder())
    } catch (error) {
      notify(`Could not open folder: ${(error as Error).message}`)
    }
  }, [applyDesktopWorkspace, notify])

  const addWorkspaceFolder = async () => {
    if (!window.tungsten || !workspaceRoot || remoteConnected) return notify('Additional roots are available for local desktop workspaces')
    if (dirty.size) return notify('Save your changes before adding another workspace root')
    try { applyDesktopWorkspace(await window.tungsten.addWorkspaceFolder(), false, true) }
    catch (error) { notify(`Could not add workspace folder: ${(error as Error).message}`) }
  }

  const removeWorkspaceFolder = async (prefix: string) => {
    if (!window.tungsten || !prefix) return
    if (dirty.size) return notify('Save your changes before removing a workspace root')
    try { applyDesktopWorkspace(await window.tungsten.removeWorkspaceFolder(prefix)) }
    catch (error) { notify(`Could not remove workspace folder: ${(error as Error).message}`) }
  }

  const closeTab = (path: string) => {
    const index = openTabs.indexOf(path)
    const nextTabs = openTabs.filter((tab) => tab !== path)
    setOpenTabs(nextTabs)
    // Remember real files so Reopen Closed Editor can bring them back.
    if (path && path !== PREVIEW_PATH) setClosedTabs((current) => [...current.filter((tab) => tab !== path), path].slice(-20))
    if (activePath === path) {
      setActivePath(nextTabs[Math.min(index, nextTabs.length - 1)] || '')
    }
  }

  /** Reopen the most recently closed editor, as Ctrl+Shift+T does in VS Code. */
  const reopenClosedEditor = useCallback(() => {
    setClosedTabs((current) => {
      const path = current[current.length - 1]
      if (!path) return current
      setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path])
      setActivePath(path)
      return current.slice(0, -1)
    })
  }, [])

  /** Move forward or back through open editors, wrapping at both ends. */
  const cycleEditor = useCallback((offset: number) => {
    setOpenTabs((tabs) => {
      if (tabs.length < 2) return tabs
      setActivePath((current) => {
        const index = tabs.indexOf(current)
        const next = (((index < 0 ? 0 : index) + offset) % tabs.length + tabs.length) % tabs.length
        return tabs[next]
      })
      return tabs
    })
  }, [])

  const toggleFullScreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [])

  /** Move the cursor to a line in the active editor and centre it. */
  const revealLine = useCallback((line: number) => {
    if (!line) return
    editorInstance?.setPosition({ lineNumber: line, column: 1 })
    editorInstance?.revealLineInCenter(line)
    editorInstance?.focus()
  }, [editorInstance])

  /** Send a DAP execution-control request for the stopped thread. */
  const debugControl = useCallback(async (command: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') => {
    if (!window.tungsten || !debugState.id) return
    await window.tungsten.sendDebug(debugState.id, {
      type: 'request',
      command,
      arguments: { threadId: debugState.threadId || 1 },
    }).catch((error: Error) => notify(`Debug ${command} failed: ${error.message}`))
  }, [debugState.id, debugState.threadId, notify])

  const updateFile = (value?: string) => {
    if (!activeFile || activeFile.language === 'diff' || value === undefined) return
    setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content: value } : file))
    setDirty((current) => new Set(current).add(activePath))
  }

  const buildPreview = useCallback(() => {
    const get = (path: string) => files.find((file) => file.path === path)?.content ?? ''
    const styles = get('src/styles.css')
    const utils = get('src/utils/time.js').replace(/\bexport\s+/g, '')
    const script = get('src/main.js').replace(/^import\s+.*$/gm, '')
    return get('index.html')
      .replace(/<link[^>]+href=["']\/src\/styles\.css["'][^>]*>/, `<style>${styles}</style>`)
      .replace(/<script[^>]+src=["']\/src\/main\.js["'][^>]*><\/script>/, `<script type="module">${utils}\n${script.replace(/<\/script/gi, '<\\/script')}</script>`)
  }, [files])

  const runProject = useCallback(() => {
    if (!openTabs.includes(PREVIEW_PATH)) setOpenTabs((tabs) => [...tabs, PREVIEW_PATH])
    setActivePath(PREVIEW_PATH)
    notify('Preview rebuilt successfully')
    setTerminalLines((lines) => [
      ...lines,
      { text: '$ npm run dev', kind: 'command' },
      { text: 'VITE ready in 287 ms  →  tungsten://preview/forge', kind: 'success' },
    ])
  }, [notify, openTabs])

  const openNewFileDialog = () => {
    setRenameTarget(null)
    setNewFileName('')
    setNewFileOpen(true)
  }

  const createFile = async () => {
    const path = newFileName.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/')
    if (!path || path.split('/').includes('..')) {
      notify('Enter a valid path inside the workspace')
      return
    }
    if (files.some((file) => file.path === path && file.path !== renameTarget)) {
      notify('A file with that path already exists')
      return
    }

    try {
      if (renameTarget) {
        if (window.tungsten && workspaceRoot) await window.tungsten.renamePath(renameTarget, path)
        setFiles((current) => current.map((file) => file.path === renameTarget ? { ...file, path, language: languageForPath(path) } : file))
        setOpenTabs((tabs) => tabs.map((tab) => tab === renameTarget ? path : tab))
        setActivePath((active) => active === renameTarget ? path : active)
        setDirty((current) => {
          const next = new Set(current)
          if (next.delete(renameTarget)) next.add(path)
          return next
        })
        notify(`${fileName(renameTarget)} renamed to ${fileName(path)}`)
      } else {
        if (window.tungsten && workspaceRoot) await window.tungsten.writeFile(path, '')
        setFiles((current) => [...current, { path, content: '', language: languageForPath(path) }])
        setDirty((current) => new Set(current).add(path))
        openFile(path)
        notify(`${fileName(path)} created`)
      }
      setNewFileName('')
      setRenameTarget(null)
      setNewFileOpen(false)
    } catch (error) {
      notify(`File operation failed: ${(error as Error).message}`)
    }
  }

  const renameFile = (path: string) => {
    setRenameTarget(path)
    setNewFileName(path)
    setNewFileOpen(true)
    setContextMenu(null)
  }

  const deleteFile = async (path: string) => {
    setContextMenu(null)
    if (!window.confirm(`Delete ${path}? This cannot be undone.`)) return
    try {
      if (window.tungsten && workspaceRoot) await window.tungsten.deletePath(path)
      setFiles((current) => current.filter((file) => file.path !== path))
      setDirty((current) => { const next = new Set(current); next.delete(path); return next })
      const remainingTabs = openTabs.filter((tab) => tab !== path)
      setOpenTabs(remainingTabs)
      if (activePath === path) setActivePath(remainingTabs[0] || '')
      notify(`${fileName(path)} deleted`)
    } catch (error) {
      notify(`Delete failed: ${(error as Error).message}`)
    }
  }

  const refreshWorkspace = useCallback(async () => {
    if (!window.tungsten || !workspaceRoot) {
      notify('Open a desktop workspace before refreshing')
      return
    }
    if (dirty.size && !window.confirm('Refreshing will discard unsaved editor changes. Continue?')) return
    try {
      const result = await window.tungsten.refreshWorkspace()
      if (result.files) {
        const remaining = openTabs.filter((tab) => tab === PREVIEW_PATH || result.files!.some((file) => file.path === tab))
        setFiles(result.files)
        setOpenTabs(remaining)
        setActivePath(remaining.includes(activePath) ? activePath : remaining[0] || result.files[0]?.path || '')
        setDirty(new Set())
        setExternalChange(null)
        notify(`${result.files.length} files refreshed from disk`)
      }
    } catch (error) {
      notify(`Refresh failed: ${(error as Error).message}`)
    }
  }, [activePath, dirty.size, notify, openTabs, workspaceRoot])

  const resetWorkspace = useCallback(() => {
    setFiles(defaultFiles)
    setWorkspaceName('forge')
    setWorkspaceRoot('')
    setOpenTabs(['README.md', 'index.html', 'src/main.js'])
    setActivePath('src/main.js')
    setDirty(new Set())
    setGitInfo({ isRepository: false, branch: 'main', changes: [], error: '' })
    localStorage.removeItem(WORKSPACE_KEY)
    notify('Workspace restored to defaults')
  }, [notify])

  const refreshGit = useCallback(async () => {
    if (!window.tungsten || !workspaceRoot) return
    try {
      setGitInfo(await window.tungsten.gitStatus())
      window.tungsten.gitHistory(150).then(setGitHistory).catch(() => setGitHistory([]))
      window.tungsten.gitBranches().then(setGitBranches).catch(() => setGitBranches([]))
      window.tungsten.gitOperationStatus().then(setGitOperation).catch(() => setGitOperation({ operation: null, conflicts: [] }))
      window.tungsten.gitStashes().then(setGitStashes).catch(() => setGitStashes([]))
      window.tungsten.githubItems().then(setGithubItems).catch(() => setGithubItems({ pullRequests: [], issues: [] }))
    } catch (error) {
      setGitInfo({ isRepository: false, branch: '', changes: [], error: (error as Error).message })
    }
  }, [workspaceRoot])

  const commitChanges = async () => {
    if (!commitMessage.trim()) return
    if (!window.tungsten || !workspaceRoot) {
      setDirty(new Set())
      setCommitMessage('')
      notify('Demo changes committed locally')
      return
    }
    try {
      await save()
      const result = await window.tungsten.gitCommit(commitMessage)
      setGitInfo(result.status)
      setCommitMessage('')
      setTerminalLines((lines) => [...lines, { text: result.output, kind: 'success' }])
      notify('Changes committed')
    } catch (error) {
      notify(`Commit failed: ${(error as Error).message}`)
    }
  }

  const runTerminalCommand = (raw: string) => {
    const command = raw.trim()
    if (!command) return
    setHistory((current) => [...current, command])
    setHistoryIndex(-1)
    const base: Array<{ text: string; kind?: string }> = [{ text: `tungsten@${workspaceName} ~/${workspaceName} $ ${command}`, kind: 'command' }]
    const [name, ...args] = command.split(/\s+/)

    if (name === 'clear') {
      setTerminalLines([])
      return
    }
    if (window.tungsten && workspaceRoot) {
      setTerminalLines((lines) => [...lines, ...base])
      window.tungsten.runCommand(command).then((result) => {
        const output: Array<{ text: string; kind?: string }> = []
        if (result.stdout.trimEnd()) output.push({ text: result.stdout.trimEnd(), kind: result.code === 0 ? undefined : 'warning' })
        if (result.stderr.trimEnd()) output.push({ text: result.stderr.trimEnd(), kind: 'error' })
        if (!output.length) output.push({ text: `Process exited with code ${result.code}`, kind: result.code === 0 ? 'success' : 'error' })
        setTerminalLines((lines) => [...lines, ...output])
      }).catch((error: Error) => setTerminalLines((lines) => [...lines, { text: error.message, kind: 'error' }]))
      return
    }
    if (name === 'help') {
      base.push({ text: 'Available: help, clear, ls, pwd, cat, echo, date, whoami, git status, npm run dev, npm run build', kind: 'muted' })
    } else if (name === 'pwd') {
      base.push({ text: '/workspace/forge' })
    } else if (name === 'whoami') {
      base.push({ text: 'tungsten' })
    } else if (name === 'date') {
      base.push({ text: new Date().toString() })
    } else if (name === 'echo') {
      base.push({ text: args.join(' ') })
    } else if (name === 'ls') {
      const target = args[0]?.replace(/\/$/, '') || ''
      const entries = new Set<string>()
      files.filter((file) => !target || file.path.startsWith(`${target}/`)).forEach((file) => {
        const relative = target ? file.path.slice(target.length + 1) : file.path
        entries.add(relative.split('/')[0] + (relative.includes('/') ? '/' : ''))
      })
      base.push({ text: [...entries].join('   ') || `ls: ${target}: No such directory` })
    } else if (name === 'cat') {
      const file = files.find((item) => item.path === args[0])
      base.push({ text: file?.content || `cat: ${args[0] || ''}: No such file`, kind: file ? undefined : 'error' })
    } else if (command === 'git status') {
      base.push({ text: `On branch main\n${dirty.size ? `Changes not staged for commit:\n  ${[...dirty].map((path) => `modified: ${path}`).join('\n  ')}` : 'nothing to commit, working tree clean'}`, kind: dirty.size ? 'warning' : 'success' })
    } else if (command === 'npm run dev') {
      base.push({ text: 'VITE ready in 287 ms\n  Local: tungsten://preview/forge\n  press Ctrl+Enter to open', kind: 'success' })
    } else if (command === 'npm run build') {
      base.push({ text: '✓ 8 modules transformed.\n✓ built in 412ms  dist/index.html  7.21 kB', kind: 'success' })
    } else {
      base.push({ text: `${name}: command not found`, kind: 'error' })
    }
    setTerminalLines((lines) => [...lines, ...base])
  }

  const runIntegratedCommand = (command: string) => {
    setPanelOpen(true)
    setPanelTab('TERMINAL')
    if (window.tungsten && workspaceRoot) {
      const terminalId = newTerminal(undefined, `task · ${command.split(/\s+/)[0]}`)
      setTerminalCommand((current) => ({ id: (current?.id || 0) + 1, command, terminalId }))
    } else {
      runTerminalCommand(command)
    }
  }

  const runStructuredTest = async (testId: string) => {
    if (!window.tungsten) {
      const test = discoveredTests.find((candidate) => candidate.id === testId)
      if (test) runIntegratedCommand(test.command)
      return
    }
    setActiveTestResult(testId)
    setTestResults((current) => ({ ...current, [testId]: { status: 'running' } }))
    try {
      const result = await window.tungsten.runTest(testId)
      setTestResults((current) => ({ ...current, [testId]: result }))
      setCoverage(result.coverage)
      notify(`Test ${result.status} in ${result.durationMs} ms`)
    } catch (error) {
      setTestResults((current) => ({ ...current, [testId]: { status: 'failed', output: (error as Error).message, failures: [(error as Error).message] } }))
    }
  }

  const createProjectFromTemplate = async () => {
    if (!window.tungsten) {
      notify('Project templates are available in the desktop app')
      return
    }
    try {
      const result = await window.tungsten.createProject(projectTemplate, projectName)
      if (!result.canceled) {
        applyDesktopWorkspace(result)
        setProjectModal(false)
      }
    } catch (error) {
      notify(`Project creation failed: ${(error as Error).message}`)
    }
  }

  const connectRemote = async () => {
    if (!window.tungsten) return notify('Remote workspaces require the desktop app')
    try {
      const result = await window.tungsten.connectSsh({ host: sshConfig.host, port: Number(sshConfig.port), username: sshConfig.username, root: sshConfig.root, password: sshConfig.password || undefined, privateKeyPath: sshConfig.privateKeyPath || undefined })
      applyDesktopWorkspace(result)
      setRemoteConnected(true)
      setRemoteModal(false)
      setSshConfig((config) => ({ ...config, password: '' }))
      notify(`Connected to ${sshConfig.host}`)
    } catch (error) {
      notify(`SSH connection failed: ${(error as Error).message}`)
    }
  }

  const disconnectRemoteWorkspace = async () => {
    await window.tungsten?.disconnectRemote().catch(() => undefined)
    setRemoteConnected(false)
    setWorkspaceRoot('')
    setWorkspaceRoots([])
    setFiles([])
    setOpenTabs([])
    setActivePath('')
    setProjectInfo({ tasks: [], tests: [], frameworks: [] })
    setDiscoveredTests([])
    setRemoteModal(false)
    notify('Remote workspace disconnected')
  }

  const startCollaboration = async (join = false) => {
    if (!window.tungsten) return notify('Live collaboration requires the desktop app')
    try {
      if (join) await window.tungsten.joinCollaboration(collaborationUrl, collaborationName)
      else {
        const room = await window.tungsten.hostCollaboration(collaborationName)
        setCollaborationUrl(room.url)
      }
      setCollaborationActive(true)
      setParticipants([collaborationName])
      notify(join ? 'Joined collaboration room' : 'Collaboration room is ready')
    } catch (error) {
      notify(`Collaboration failed: ${(error as Error).message}`)
    }
  }

  const sendComment = () => {
    if (!commentInput.trim() || !window.tungsten) return
    const comment = { type: 'comment' as const, name: collaborationName, text: commentInput.trim(), path: activeFile?.path, line: cursor.line }
    void window.tungsten.sendCollaborationEvent(comment)
    setCommentInput('')
  }

  const startDebugging = useCallback(async () => {
    if (!window.tungsten || !workspaceRoot) {
      notify('Open a desktop workspace before debugging')
      return
    }
    const launchFile = files.find((file) => file.path === '.tungsten/launch.json')
    if (!launchFile) {
      setActivity('debug')
      setSidebarVisible(true)
      notify('Create .tungsten/launch.json to configure a debug adapter')
      return
    }
    try {
      const manifest = JSON.parse(launchFile.content)
      const configuration = manifest.configurations?.[0]
      if (!configuration) throw new Error('No launch configuration was found.')
      const { id } = await window.tungsten.startDebug(configuration)
      setDebugState({ running: true, id, output: [`Started ${configuration.name || 'debug adapter'}`] })
      await window.tungsten.sendDebug(id, {
        type: 'request',
        command: 'initialize',
        arguments: { clientID: 'tungsten', clientName: 'Tungsten IDE', adapterID: configuration.type || 'custom', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true },
      })
      setActivity('debug')
      setSidebarVisible(true)
    } catch (error) {
      setDebugState({ running: false, output: [(error as Error).message] })
      notify(`Debugger failed: ${(error as Error).message}`)
    }
  }, [files, notify, workspaceRoot])

  const stopDebugging = useCallback(async () => {
    if (window.tungsten && debugState.id) await window.tungsten.stopDebug(debugState.id)
    setDebugState((state) => ({ ...state, running: false, output: [...state.output, 'Debug session stopped'] }))
  }, [debugState.id])

  const toggleBreakpoint = async (path: string, line: number) => {
    const exists = breakpoints.some((point) => point.path === path && point.line === line)
    const next = exists ? breakpoints.filter((point) => point.path !== path || point.line !== line) : [...breakpoints, { path, line }]
    setBreakpoints(next)
    if (window.tungsten && debugState.id) {
      try {
        const absolutePath = await window.tungsten.absolutePath(path)
        await window.tungsten.sendDebug(debugState.id, {
          type: 'request',
          command: 'setBreakpoints',
          arguments: { source: { path: absolutePath }, breakpoints: next.filter((point) => point.path === path).map((point) => ({ line: point.line })) },
        })
      } catch (error) {
        notify(`Breakpoint sync failed: ${(error as Error).message}`)
      }
    }
  }

  const editBreakpointCondition = async (path: string, line: number) => {
    const point = breakpoints.find((breakpoint) => breakpoint.path === path && breakpoint.line === line)
    const condition = window.prompt('Breakpoint condition (leave empty for unconditional)', point?.condition || '') ?? point?.condition
    const next = breakpoints.map((breakpoint) => breakpoint.path === path && breakpoint.line === line ? { ...breakpoint, condition: condition || undefined } : breakpoint)
    setBreakpoints(next)
    if (window.tungsten && debugState.id) {
      const absolutePath = await window.tungsten.absolutePath(path)
      await window.tungsten.sendDebug(debugState.id, { type: 'request', command: 'setBreakpoints', arguments: { source: { path: absolutePath }, breakpoints: next.filter((breakpoint) => breakpoint.path === path).map((breakpoint) => ({ line: breakpoint.line, condition: breakpoint.condition })) } })
    }
  }

  const installExtension = async () => {
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
  }

  const openGitDiff = async (path: string, staged = false) => {
    if (!window.tungsten) return
    try {
      const [{ diff, hunks }, versions] = await Promise.all([window.tungsten.gitDiff(path, staged), window.tungsten.gitFileVersions(path, staged)])
      const virtualPath = `.tungsten/diffs/${staged ? 'staged-' : ''}${fileName(path)}.diff`
      setGitComparison({ ...versions, virtualPath, hunks })
      setFiles((current) => [...current.filter((file) => file.path !== virtualPath), { path: virtualPath, content: diff, language: 'diff' }])
      openFile(virtualPath)
    } catch (error) {
      notify(`Could not open diff: ${(error as Error).message}`)
    }
  }

  const stageGitHunk = async (patch: string) => {
    if (!window.tungsten || !gitComparison) return
    try {
      const status = await window.tungsten.gitStageHunk(patch, gitComparison.staged)
      setGitInfo(status)
      notify(gitComparison.staged ? 'Hunk unstaged' : 'Hunk staged')
      await openGitDiff(gitComparison.path, gitComparison.staged)
    } catch (error) { notify(`Could not apply hunk: ${(error as Error).message}`) }
  }

  const openGitConflict = async (path: string) => {
    if (!window.tungsten) return
    try {
      const versions = await window.tungsten.gitConflictVersions(path)
      const virtualPath = `.tungsten/conflicts/${fileName(path)}.merge`
      setGitComparison({ path, virtualPath, before: versions.ours, after: versions.theirs, base: versions.base, staged: false, hunks: [], conflict: true })
      setFiles((current) => [...current.filter((file) => file.path !== virtualPath), { path: virtualPath, content: versions.theirs, language: languageForPath(path) }])
      openFile(virtualPath)
    } catch (error) { notify(`Could not open conflict: ${(error as Error).message}`) }
  }

  const resolveGitConflict = async (resolution: 'ours' | 'theirs' | 'both' | 'mark') => {
    if (!window.tungsten || !gitComparison?.conflict) return
    try {
      setGitInfo(await window.tungsten.gitResolveConflict(gitComparison.path, resolution))
      notify(resolution === 'mark' ? 'Working file marked as resolved' : `Conflict resolved using ${resolution === 'ours' ? 'current' : resolution === 'theirs' ? 'incoming' : 'both'} changes`)
      setGitComparison(null)
      setOpenTabs((tabs) => tabs.filter((tab) => tab !== gitComparison.virtualPath))
      setActivePath(gitComparison.path)
      await refreshWorkspace()
      await refreshGit()
    } catch (error) { notify(`Could not resolve conflict: ${(error as Error).message}`) }
  }

  const integrateGitBranch = async (operation: 'merge' | 'rebase') => {
    if (!window.tungsten || !gitIntegrateBranch) return
    try {
      const status = await window.tungsten.gitIntegrate(operation, gitIntegrateBranch)
      setGitInfo(status)
      await refreshWorkspace()
      await refreshGit()
      const conflicted = status.changes.some((change) => change.status.includes('U') || change.status === 'AA' || change.status === 'DD')
      notify(`${operation === 'merge' ? 'Merge' : 'Rebase'} ${conflicted ? 'requires conflict resolution' : 'completed'}`)
    } catch (error) { notify(`${operation} failed: ${(error as Error).message}`); await refreshGit() }
  }

  const finishGitOperation = async (action: 'continue' | 'abort') => {
    if (!window.tungsten || !gitOperation.operation) return
    try {
      setGitInfo(await window.tungsten.gitOperationAction(gitOperation.operation, action))
      await refreshWorkspace()
      await refreshGit()
      notify(`${gitOperation.operation} ${action === 'continue' ? 'continued' : 'aborted'}`)
    } catch (error) { notify(`Could not ${action} ${gitOperation.operation}: ${(error as Error).message}`) }
  }

  const openGitBlame = async () => {
    if (!window.tungsten || !activeFile || activeFile.language === 'diff') return
    try {
      const blame = await window.tungsten.gitBlame(activeFile.path)
      const virtualPath = `.tungsten/blame/${fileName(activeFile.path)}.txt`
      const content = blame.map((entry) => `${entry.hash.slice(0, 9).padEnd(10)} ${entry.author.slice(0, 18).padEnd(19)} ${entry.date} │ ${entry.content}`).join('\n')
      setFiles((current) => [...current.filter((file) => file.path !== virtualPath), { path: virtualPath, content, language: 'plaintext' }])
      openFile(virtualPath)
    } catch (error) { notify(`Could not load blame: ${(error as Error).message}`) }
  }

  const extensionCommands: CommandItem[] = extensions.flatMap((extension) => {
    if (extension.enabled === false) return []
    const contributions = extension.contributes as { commands?: Array<{ id?: string; title?: string; command?: string }> }
    return (contributions.commands || []).filter((command) => command.title && (command.id || command.command)).map((command) => ({
      id: `extension.${extension.id}.${command.id || command.command}`,
      label: `Extension: ${command.title}`,
      detail: `${extension.name} · ${command.id || command.command}`,
      icon: Blocks,
      action: async () => {
        if (command.id && extension.verification === 'verified') {
          const result = await window.tungsten?.executeExtensionCommand(command.id, [])
          if (result !== undefined) notify(typeof result === 'string' ? result : JSON.stringify(result))
        } else if (command.command) runIntegratedCommand(command.command)
        else notify('Executable extensions require a matching SHA-256 integrity declaration')
      },
    }))
  })

  /** Working-tree changes: git status merged with unsaved editor buffers. */
  const sourceChanges = useMemo(() => {
    const changes = new Map<string, { path: string; status: string; staged?: boolean; workingTree?: boolean }>()
    if (gitInfo.isRepository) gitInfo.changes.forEach((change) => changes.set(change.path, change))
    dirty.forEach((path) => changes.set(path, { ...(changes.get(path) || { path, status: 'M' }), workingTree: true }))
    return [...changes.values()]
  }, [dirty, gitInfo])

  /**
   * The command table.
   *
   * Every entry has a stable VS Code-compatible id, so the same definition powers
   * the command palette, the menu bar, the keybinding editor and keystroke
   * dispatch. `when` clauses are evaluated against `whenContext`.
   */
  const commands: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      // File.
      { id: 'workbench.action.files.openFolder', label: 'File: Open Folder', detail: window.tungsten ? 'Open a local project from this computer' : 'Available in the desktop app', icon: FolderOpen, action: openDesktopFolder },
      { id: 'workbench.action.files.newUntitledFile', label: 'File: New File', detail: 'Create a file in the workspace', icon: File, action: openNewFileDialog },
      { id: 'workbench.action.files.save', label: 'File: Save', detail: activePath && activePath !== PREVIEW_PATH ? fileName(activePath) : 'No editable file active', icon: Check, when: 'editorIsOpen', action: () => { if (activePath) void save(activePath).catch(() => undefined) } },
      { id: 'workbench.action.files.saveAll', label: 'File: Save All', detail: `${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}`, icon: Copy, action: () => { void save().catch(() => undefined) } },
      { id: 'workbench.action.files.rename', label: 'File: Rename Active File', detail: activeFile?.path || 'No editable file active', icon: FileCode2, when: 'editorIsOpen', action: () => { if (activeFile) renameFile(activeFile.path) } },
      { id: 'workbench.action.files.delete', label: 'File: Delete Active File', detail: activeFile?.path || 'No editable file active', icon: Trash2, when: 'editorIsOpen', action: () => { if (activeFile) void deleteFile(activeFile.path) } },
      { id: 'workbench.action.files.copyPathOfActiveFile', label: 'File: Copy Path of Active File', detail: activePath || 'No active file', icon: Copy, when: 'editorIsOpen', action: () => { void navigator.clipboard.writeText(activePath); notify('Path copied') } },
      { id: 'workbench.action.files.revealActiveFileInExplorer', label: 'File: Reveal in File Manager', detail: activePath || 'No active file', icon: FolderOpen, when: 'editorIsOpen && isDesktop', action: () => { void window.tungsten?.revealPath(activePath) } },
      { id: 'workbench.action.closeActiveEditor', label: 'View: Close Editor', detail: activePath ? fileName(activePath) : 'No editor open', icon: X, when: 'editorIsOpen', action: () => { if (activePath) closeTab(activePath) } },
      { id: 'workbench.action.closeAllEditors', label: 'View: Close All Editors', detail: `${openTabs.length} open`, icon: X, action: () => { setOpenTabs([]); setActivePath('') } },
      { id: 'workbench.action.reopenClosedEditor', label: 'View: Reopen Closed Editor', detail: closedTabs.length ? fileName(closedTabs[closedTabs.length - 1]) : 'Nothing to reopen', icon: Undo2, action: reopenClosedEditor },
      { id: 'workbench.action.nextEditor', label: 'View: Next Editor', detail: 'Cycle forward through open tabs', icon: ChevronRight, when: 'openTabs > 1', action: () => cycleEditor(1) },
      { id: 'workbench.action.previousEditor', label: 'View: Previous Editor', detail: 'Cycle back through open tabs', icon: ChevronRight, when: 'openTabs > 1', action: () => cycleEditor(-1) },

      // Quick access.
      { id: 'workbench.action.showCommands', label: 'View: Show Command Palette', detail: 'Search and run any command', icon: Command, action: () => { setPalette({ open: true, mode: 'commands' }); setPaletteQuery('') } },
      { id: 'workbench.action.quickOpen', label: 'Go: Quick Open File', detail: 'Fuzzy-search files by name', icon: FileCode2, action: () => { setPalette({ open: true, mode: 'files' }); setPaletteQuery('') } },
      { id: 'workbench.action.gotoSymbol', label: 'Go: Go to Symbol in Editor', detail: `${symbols.length} symbols in the active file`, icon: Braces, when: 'editorIsOpen', action: () => { setPalette({ open: true, mode: 'symbols' }); setPaletteQuery('') } },
      { id: 'workbench.action.gotoLine', label: 'Go: Go to Line/Column', detail: 'Jump to a line in the active file', icon: CornerDownRight, when: 'editorIsOpen', action: () => { setPalette({ open: true, mode: 'line' }); setPaletteQuery('') } },
      { id: 'workbench.action.showAllSymbols', label: 'Go: Go to Symbol in Workspace', detail: 'Search symbols across the workspace', icon: Braces, action: () => { setPalette({ open: true, mode: 'symbols' }); setPaletteQuery('') } },

      // Editor actions, delegated to Monaco.
      { id: 'editor.action.formatDocument', label: 'Editor: Format Document', detail: 'Run the registered formatter', icon: Braces, when: 'editorIsOpen', action: () => runEditorAction('editor.action.formatDocument') },
      { id: 'editor.action.commentLine', label: 'Editor: Toggle Line Comment', detail: 'Comment or uncomment the selection', icon: Braces, when: 'editorIsOpen', action: () => runEditorAction('editor.action.commentLine') },
      { id: 'editor.action.blockComment', label: 'Editor: Toggle Block Comment', detail: 'Wrap the selection in a block comment', icon: Braces, when: 'editorIsOpen', action: () => runEditorAction('editor.action.blockComment') },
      { id: 'editor.action.rename', label: 'Editor: Rename Symbol', detail: 'Rename across the workspace via LSP', icon: FileCode2, when: 'editorIsOpen', action: () => runEditorAction('editor.action.rename') },
      { id: 'editor.action.revealDefinition', label: 'Go: Go to Definition', detail: 'Jump to the symbol definition', icon: CornerDownRight, when: 'editorIsOpen', action: () => runEditorAction('editor.action.revealDefinition') },
      { id: 'editor.action.goToReferences', label: 'Go: Go to References', detail: 'List every reference to the symbol', icon: CornerDownRight, when: 'editorIsOpen', action: () => runEditorAction('editor.action.goToReferences') },
      { id: 'editor.action.quickFix', label: 'Editor: Quick Fix', detail: 'Show code actions at the cursor', icon: Zap, when: 'editorIsOpen', action: () => runEditorAction('editor.action.quickFix') },
      { id: 'editor.action.triggerSuggest', label: 'Editor: Trigger Suggest', detail: 'Open the completion widget', icon: Zap, when: 'editorIsOpen', action: () => runEditorAction('editor.action.triggerSuggest') },
      { id: 'editor.action.startFindReplaceAction', label: 'Edit: Replace in File', detail: 'Find and replace in the active file', icon: Search, when: 'editorIsOpen', action: () => runEditorAction('editor.action.startFindReplaceAction') },
      { id: 'editor.action.copyLinesDownAction', label: 'Edit: Copy Line Down', detail: 'Duplicate the current line', icon: Copy, when: 'editorIsOpen', action: () => runEditorAction('editor.action.copyLinesDownAction') },
      { id: 'editor.action.moveLinesDownAction', label: 'Edit: Move Line Down', detail: 'Move the current line down', icon: ChevronDown, when: 'editorIsOpen', action: () => runEditorAction('editor.action.moveLinesDownAction') },
      { id: 'editor.action.moveLinesUpAction', label: 'Edit: Move Line Up', detail: 'Move the current line up', icon: ChevronDown, when: 'editorIsOpen', action: () => runEditorAction('editor.action.moveLinesUpAction') },
      { id: 'editor.action.deleteLines', label: 'Edit: Delete Line', detail: 'Remove the current line', icon: Trash2, when: 'editorIsOpen', action: () => runEditorAction('editor.action.deleteLines') },
      { id: 'editor.action.insertCursorBelow', label: 'Selection: Add Cursor Below', detail: 'Multi-cursor downward', icon: Plus, when: 'editorIsOpen', action: () => runEditorAction('editor.action.insertCursorBelow') },
      { id: 'editor.action.insertCursorAbove', label: 'Selection: Add Cursor Above', detail: 'Multi-cursor upward', icon: Plus, when: 'editorIsOpen', action: () => runEditorAction('editor.action.insertCursorAbove') },
      { id: 'editor.action.addSelectionToNextFindMatch', label: 'Selection: Add Next Occurrence', detail: 'Select the next matching token', icon: Plus, when: 'editorIsOpen', action: () => runEditorAction('editor.action.addSelectionToNextFindMatch') },
      { id: 'editor.action.selectHighlights', label: 'Selection: Select All Occurrences', detail: 'Select every matching token', icon: Plus, when: 'editorIsOpen', action: () => runEditorAction('editor.action.selectHighlights') },
      { id: 'editor.action.smartSelect.expand', label: 'Selection: Expand Selection', detail: 'Grow the selection by scope', icon: Maximize2, when: 'editorIsOpen', action: () => runEditorAction('editor.action.smartSelect.expand') },
      { id: 'editor.action.smartSelect.shrink', label: 'Selection: Shrink Selection', detail: 'Shrink the selection by scope', icon: Minus, when: 'editorIsOpen', action: () => runEditorAction('editor.action.smartSelect.shrink') },
      { id: 'editor.action.indentLines', label: 'Edit: Indent Line', detail: 'Indent the selection', icon: ChevronRight, when: 'editorIsOpen', action: () => runEditorAction('editor.action.indentLines') },
      { id: 'editor.action.outdentLines', label: 'Edit: Outdent Line', detail: 'Outdent the selection', icon: ChevronRight, when: 'editorIsOpen', action: () => runEditorAction('editor.action.outdentLines') },
      { id: 'editor.fold', label: 'View: Fold', detail: 'Collapse the region at the cursor', icon: ChevronsDownUp, when: 'editorIsOpen', action: () => runEditorAction('editor.fold') },
      { id: 'editor.unfold', label: 'View: Unfold', detail: 'Expand the region at the cursor', icon: ChevronsDownUp, when: 'editorIsOpen', action: () => runEditorAction('editor.unfold') },
      { id: 'editor.foldAll', label: 'View: Fold All', detail: 'Collapse every region', icon: ChevronsDownUp, when: 'editorIsOpen', action: () => runEditorAction('editor.foldAll') },
      { id: 'editor.unfoldAll', label: 'View: Unfold All', detail: 'Expand every region', icon: ChevronsDownUp, when: 'editorIsOpen', action: () => runEditorAction('editor.unfoldAll') },
      { id: 'editor.action.toggleWordWrap', label: 'View: Toggle Word Wrap', detail: settings.wordWrap ? 'Word wrap is on' : 'Word wrap is off', icon: ChevronsDownUp, action: () => setSettings((current) => ({ ...current, wordWrap: !current.wordWrap })) },
      { id: 'editor.action.toggleMinimap', label: 'View: Toggle Minimap', detail: settings.minimap ? 'Minimap is on' : 'Minimap is off', icon: Layers, action: () => setSettings((current) => ({ ...current, minimap: !current.minimap })) },

      // Views.
      { id: 'workbench.view.explorer', label: 'View: Show Explorer', detail: 'Files and folders', icon: Files, action: () => { setActivity('explorer'); setSidebarVisible(true) } },
      { id: 'workbench.view.search', label: 'View: Show Search', detail: 'Search across the workspace', icon: Search, action: () => { setActivity('search'); setSidebarVisible(true) } },
      { id: 'workbench.view.scm', label: 'View: Show Source Control', detail: gitInfo.isRepository ? `${sourceChanges.length} changes on ${gitInfo.branch}` : 'No repository detected', icon: GitBranch, action: () => { setActivity('source'); setSidebarVisible(true); void refreshGit() } },
      { id: 'workbench.view.debug', label: 'View: Show Run and Debug', detail: 'Breakpoints, call stack and variables', icon: BugPlay, action: () => { setActivity('debug'); setSidebarVisible(true) } },
      { id: 'workbench.view.testing', label: 'View: Show Testing', detail: `${discoveredTests.length} tests detected`, icon: FlaskConical, action: () => { setActivity('tests'); setSidebarVisible(true) } },
      { id: 'workbench.view.extensions', label: 'View: Show Extensions', detail: `${extensions.length} installed`, icon: Blocks, action: () => { setActivity('extensions'); setSidebarVisible(true) } },
      { id: 'workbench.actions.view.problems', label: 'View: Show Problems', detail: `${problems.length} diagnostics`, icon: CircleAlert, action: () => { setPanelOpen(true); setPanelTab('PROBLEMS') } },
      { id: 'workbench.action.output.toggleOutput', label: 'View: Toggle Output', detail: 'Workbench output channels', icon: ListChecks, action: () => { setPanelOpen(true); setPanelTab('OUTPUT') } },
      { id: 'workbench.debug.action.toggleRepl', label: 'View: Toggle Debug Console', detail: 'Inspect debug output', icon: Bot, action: () => { setPanelOpen(true); setPanelTab('DEBUG CONSOLE') } },

      // Layout.
      { id: 'workbench.action.toggleSidebarVisibility', label: 'View: Toggle Primary Side Bar', detail: sidebarVisible ? 'Hide the side bar' : 'Show the side bar', icon: PanelLeftClose, action: () => setSidebarVisible((value) => !value) },
      { id: 'workbench.action.togglePanel', label: 'View: Toggle Panel', detail: panelOpen ? 'Hide the bottom panel' : 'Show the bottom panel', icon: PanelBottomOpen, action: () => setPanelOpen((value) => !value) },
      { id: 'workbench.action.toggleZenMode', label: 'View: Toggle Zen Mode', detail: zenMode ? 'Leave distraction-free editing' : 'Distraction-free editing', icon: Maximize2, action: () => setZenMode((value) => !value) },
      { id: 'workbench.action.toggleActivityBarVisibility', label: 'View: Toggle Activity Bar', detail: activityBarVisible ? 'Hide the activity bar' : 'Show the activity bar', icon: PanelLeftClose, action: () => setActivityBarVisible((value) => !value) },
      { id: 'workbench.action.toggleCenteredLayout', label: 'View: Toggle Centered Layout', detail: centeredLayout ? 'Use the full width' : 'Centre the editor', icon: Columns2, action: () => setCenteredLayout((value) => !value) },
      { id: 'workbench.action.splitEditor', label: 'View: Split Editor', detail: sidePreview ? 'Close the side pane' : 'Open a side pane', icon: SplitSquareHorizontal, action: () => setSidePreview((value) => !value) },
      { id: 'workbench.action.closeEditorsInGroup', label: 'View: Close All Editors in Group', detail: `${openTabs.length} open`, icon: X, when: 'editorIsOpen', action: () => { openTabs.forEach((path) => closeTab(path)) } },
      // Tungsten uses a single editor group plus an optional side pane rather
      // than VS Code's arbitrary group tree, so the "focus group N" commands
      // map onto the main editor and that side pane.
      { id: 'workbench.action.focusFirstEditorGroup', label: 'View: Focus First Editor Group', detail: 'Focus the main editor', icon: Columns2, action: () => { editorInstance?.focus() } },
      { id: 'workbench.action.focusSecondEditorGroup', label: 'View: Focus Second Editor Group', detail: sidePreview ? 'Focus the side pane' : 'Open and focus the side pane', icon: SplitSquareHorizontal, when: 'editorIsOpen', action: () => { setSidePreview(true) } },
      { id: 'workbench.action.toggleFullScreen', label: 'View: Toggle Full Screen', detail: 'Enter or leave full screen', icon: Maximize2, action: toggleFullScreen },
      { id: 'workbench.action.zoomIn', label: 'View: Zoom In', detail: `Editor font ${settings.fontSize}px`, icon: Plus, action: () => setSettings((current) => ({ ...current, fontSize: Math.min(28, current.fontSize + 1) })) },
      { id: 'workbench.action.zoomOut', label: 'View: Zoom Out', detail: `Editor font ${settings.fontSize}px`, icon: Minus, action: () => setSettings((current) => ({ ...current, fontSize: Math.max(8, current.fontSize - 1) })) },
      { id: 'workbench.action.zoomReset', label: 'View: Reset Zoom', detail: 'Restore the default font size', icon: RotateCcw, action: () => setSettings((current) => ({ ...current, fontSize: defaultSettings.fontSize })) },

      // Terminal.
      { id: 'workbench.action.terminal.toggleTerminal', label: 'Terminal: Toggle Terminal', detail: 'Show or hide the integrated terminal', icon: TerminalSquare, action: () => { if (panelTab === 'TERMINAL' && panelOpen) setPanelOpen(false); else { setPanelTab('TERMINAL'); setPanelOpen(true) } } },
      { id: 'workbench.action.terminal.new', label: 'Terminal: Create New Terminal', detail: 'Start another shell', icon: Plus, action: () => { if (window.tungsten) newTerminal(); else { setPanelTab('TERMINAL'); setPanelOpen(true) } } },
      { id: 'workbench.action.terminal.split', label: 'Terminal: Split Terminal', detail: terminalSplit ? 'Return to a single pane' : 'Show two terminals side by side', icon: Columns2, action: () => { if (terminalTabs.length < 2) newTerminal(); setTerminalSplit((value) => !value) } },
      { id: 'workbench.action.terminal.kill', label: 'Terminal: Kill Active Terminal', detail: 'Close the focused terminal', icon: Trash2, when: 'isDesktop', action: () => closeTerminal(activeTerminalId) },
      { id: 'workbench.action.terminal.clear', label: 'Terminal: Clear', detail: 'Clear the terminal buffer', icon: Trash2, action: () => { if (window.tungsten) setTerminalTabs((tabs) => tabs.map((terminal) => terminal.id === activeTerminalId ? { ...terminal, generation: terminal.generation + 1 } : terminal)); else setTerminalLines([]) } },
      { id: 'workbench.action.terminal.focusNext', label: 'Terminal: Focus Next Terminal', detail: `${terminalTabs.length} terminals open`, icon: ChevronRight, when: 'isDesktop', action: () => focusTerminalByOffset(1) },
      { id: 'workbench.action.terminal.focusPrevious', label: 'Terminal: Focus Previous Terminal', detail: `${terminalTabs.length} terminals open`, icon: ChevronRight, when: 'isDesktop', action: () => focusTerminalByOffset(-1) },

      // Run, debug and tasks.
      { id: 'workbench.action.tungsten.runProject', label: 'Run: Open Live Preview', detail: 'Build and run the current workspace', icon: Play, action: runProject },
      { id: 'workbench.action.debug.start', label: 'Debug: Start Debugging', detail: 'Start from .tungsten/launch.json', icon: BugPlay, when: '!debugState', action: () => { void startDebugging() } },
      { id: 'workbench.action.debug.stop', label: 'Debug: Stop Debugging', detail: 'Terminate the active session', icon: CircleStop, when: 'debugState', action: () => { void stopDebugging() } },
      { id: 'workbench.action.debug.continue', label: 'Debug: Continue', detail: 'Resume execution', icon: Play, when: 'debugState', action: () => { void debugControl('continue') } },
      { id: 'workbench.action.debug.pause', label: 'Debug: Pause', detail: 'Pause the running program', icon: Pause, when: 'debugState', action: () => { void debugControl('pause') } },
      { id: 'workbench.action.debug.stepOver', label: 'Debug: Step Over', detail: 'Run the next statement', icon: StepForward, when: 'debugState', action: () => { void debugControl('next') } },
      { id: 'workbench.action.debug.stepInto', label: 'Debug: Step Into', detail: 'Step into the call', icon: CornerDownRight, when: 'debugState', action: () => { void debugControl('stepIn') } },
      { id: 'workbench.action.debug.stepOut', label: 'Debug: Step Out', detail: 'Finish the current frame', icon: Undo2, when: 'debugState', action: () => { void debugControl('stepOut') } },
      { id: 'workbench.action.debug.restart', label: 'Debug: Restart', detail: 'Restart the debug session', icon: RotateCcw, when: 'debugState', action: () => { void stopDebugging().then(() => startDebugging()) } },
      { id: 'editor.debug.action.toggleBreakpoint', label: 'Debug: Toggle Breakpoint', detail: activeFile ? `Line ${cursor.line} of ${fileName(activeFile.path)}` : 'No active file', icon: CircleAlert, when: 'editorIsOpen', action: () => { if (activeFile) void toggleBreakpoint(activeFile.path, cursor.line) } },
      { id: 'workbench.action.tasks.runTask', label: 'Task: Run Task', detail: `${projectInfo.tasks.length} tasks detected`, icon: ListChecks, action: () => { setActivity('tests'); setSidebarVisible(true) } },

      // Source control.
      { id: 'tungsten.git.refresh', label: 'Git: Refresh', detail: 'Reload status, branches and history', icon: RefreshCw, action: () => { void refreshGit() } },
      { id: 'tungsten.git.commitStaged', label: 'Git: Commit Staged', detail: commitMessage ? commitMessage : 'Enter a commit message first', icon: GitCommitHorizontal, when: 'gitRepository', action: () => { void commitChanges() } },
      { id: 'tungsten.git.blame', label: 'Git: Show Blame for Active File', detail: activeFile?.path || 'No active file', icon: GitCommitHorizontal, when: 'editorIsOpen && gitRepository', action: openGitBlame },
      { id: 'tungsten.git.stash', label: 'Git: Stash Changes', detail: `${sourceChanges.length} changes`, icon: Archive, when: 'gitRepository', action: () => { void window.tungsten?.gitStashPush().then(setGitInfo).then(() => refreshGit()) } },

      // Preferences.
      { id: 'workbench.action.openSettings', label: 'Preferences: Open Settings', detail: 'Editor and workspace preferences', icon: Settings, action: () => setSettingsOpen(true) },
      { id: 'workbench.action.openGlobalKeybindings', label: 'Preferences: Open Keyboard Shortcuts', detail: `${keybindingRules.length} bindings`, icon: Keyboard, action: () => setKeybindingsOpen(true) },
      { id: 'workbench.action.selectTheme', label: 'Preferences: Color Theme', detail: activeTheme.label, icon: Eye, action: () => { setThemePickerOpen(true); setPaletteQuery('') } },

      // Workspace, remote, extensions.
      { id: 'workbench.action.tungsten.newProject', label: 'Project: New From Template', detail: 'Web, Node.js, Python, Rust or Go', icon: Rocket, action: () => setProjectModal(true) },
      { id: 'workbench.action.addRootFolder', label: 'Workspace: Add Folder to Workspace', detail: `${workspaceRoots.length} roots currently open`, icon: FolderPlus, action: () => { void addWorkspaceFolder() } },
      { id: 'workbench.action.tungsten.refreshWorkspace', label: 'Workspace: Refresh From Disk', detail: 'Reload files changed by other programs', icon: RefreshCw, action: refreshWorkspace },
      { id: 'workbench.action.tungsten.resetWorkspace', label: 'Workspace: Reset Starter', detail: 'Restore all starter files', icon: RotateCcw, action: resetWorkspace },
      { id: 'workbench.action.tungsten.welcome', label: 'Help: Welcome', detail: 'Open the welcome dashboard', icon: Hammer, action: () => setActivePath('') },
      { id: 'workbench.action.remote.connect', label: 'Remote: Connect over SSH', detail: 'Open the remote development dashboard', icon: SquareCode, action: () => { setRemoteModal(true); void window.tungsten?.remoteProfiles().then(setRemoteProfiles) } },
      { id: 'workbench.action.collaboration.open', label: 'Collaboration: Open Live Share', detail: collaborationActive ? `${participants.length} participants connected` : 'Host or join a Yjs room', icon: UsersRound, action: () => setCollaborationOpen(true) },
      { id: 'workbench.extensions.action.installFromFolder', label: 'Extensions: Install From Folder', detail: 'Install a declarative Tungsten extension', icon: PackagePlus, action: () => { void installExtension() } },
      { id: 'update.checkForUpdate', label: 'Update: Check for Updates', detail: updateState, icon: Download, action: () => { void window.tungsten?.checkForUpdates().then((result) => notify(result.message || (result.available ? 'Update available' : 'Tungsten is up to date'))) } },
    ]

    // Detected project tasks and enabled extension contributions join the palette.
    for (const task of projectInfo.tasks.slice(0, 20)) {
      list.push({ id: `tungsten.task.${task.label}`, label: `Task: ${task.label}`, detail: task.command, icon: ListChecks, action: () => runIntegratedCommand(task.command) })
    }
    list.push(...extensionCommands)

    // Every theme is directly runnable from the palette, as in VS Code.
    for (const theme of themes) {
      list.push({
        id: `workbench.action.selectTheme.${theme.id}`,
        label: `Preferences: Color Theme — ${theme.label}`,
        detail: `${theme.kind === 'hc-dark' || theme.kind === 'hc-light' ? 'High contrast' : theme.kind === 'light' ? 'Light' : 'Dark'} · from Visual Studio Code`,
        icon: Eye,
        action: () => { setThemeId(theme.id); notify(`Color theme: ${theme.label}`) },
      })
    }

    return list
  }, [activeFile, activePath, activeTerminalId, activeTheme.label, activityBarVisible, centeredLayout, closedTabs, collaborationActive, commitMessage, cursor.line, debugControl, dirty.size, editorInstance, discoveredTests.length, extensionCommands, extensions.length, gitInfo.branch, gitInfo.isRepository, keybindingRules.length, notify, openDesktopFolder, openTabs.length, panelOpen, panelTab, participants.length, problems.length, projectInfo.tasks, refreshWorkspace, runEditorAction, runProject, settings.fontSize, settings.minimap, settings.wordWrap, sidebarVisible, sidePreview, sourceChanges.length, symbols.length, terminalSplit, terminalTabs.length, updateState, workspaceRoots.length, zenMode])

  /** Command lookup by id, used by keystroke dispatch and the menu bar. */
  const commandsById = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])

  /**
   * Run a command by id, honouring its `when` clause so a keybinding can never
   * fire a command the palette would have hidden.
   */
  const runCommandById = useCallback(async (id: string) => {
    const command = commandsById.get(id)
    if (!command) return false
    if (command.when && !parseWhenClause(command.when).evaluate(whenContext)) return false
    await command.action()
    return true
  }, [commandsById, whenContext])

  // Keystroke dispatch reads through a ref so the listener never goes stale.
  useEffect(() => { runCommandRef.current = runCommandById }, [runCommandById])

  /**
   * Quick access, scored with VS Code's fuzzy algorithm.
   *
   * The leading character of the query selects the mode the way VS Code's
   * quick-open prefixes do: `>` commands, `@` symbols, `:` go-to-line, `#`
   * workspace symbols. Results carry highlight ranges so matched characters can
   * be emphasised in the list.
   */
  const { paletteMode, paletteSearch } = useMemo(() => {
    const raw = paletteQuery
    if (raw.startsWith('>')) return { paletteMode: 'commands' as PaletteMode, paletteSearch: raw.slice(1) }
    if (raw.startsWith('@') || raw.startsWith('#')) return { paletteMode: 'symbols' as PaletteMode, paletteSearch: raw.slice(1) }
    if (raw.startsWith(':')) return { paletteMode: 'line' as PaletteMode, paletteSearch: raw.slice(1) }
    return { paletteMode: palette.mode, paletteSearch: raw }
  }, [palette.mode, paletteQuery])

  const paletteItems: PaletteEntry[] = useMemo(() => {
    const query = prepareQuery(paletteSearch)

    if (paletteMode === 'line') {
      const line = Number.parseInt(paletteSearch, 10)
      const maxLine = activeFile ? activeFile.content.split('\n').length : 0
      if (!Number.isFinite(line) || line < 1) {
        return [{ id: 'goto.line.hint', label: 'Go to line', detail: `Type a line number between 1 and ${maxLine || 1}`, icon: CornerDownRight, action: () => undefined, labelMatch: [], detailMatch: [] }]
      }
      const target = Math.min(Math.max(1, line), Math.max(1, maxLine))
      return [{
        id: `goto.line.${target}`,
        label: `Go to line ${target}`,
        detail: activeFile ? fileName(activeFile.path) : '',
        icon: CornerDownRight,
        labelMatch: [],
        detailMatch: [],
        action: () => {
          editorInstance?.setPosition({ lineNumber: target, column: 1 })
          editorInstance?.revealLineInCenter(target)
          editorInstance?.focus()
        },
      }]
    }

    if (paletteMode === 'symbols') {
      const entries = symbols.map((symbol, index) => ({
        id: `symbol.${index}.${symbol.label}`,
        label: symbol.label,
        detail: activeFile ? fileName(activeFile.path) : '',
        icon: Braces,
        line: symbol.line,
      }))
      if (!query.normalized) {
        return entries.map((entry) => ({ ...entry, labelMatch: [], detailMatch: [], action: () => revealLine(entry.line) }))
      }
      return entries
        .map((entry) => ({ entry, score: scoreItem(entry.label, entry.detail, query) }))
        .filter(({ score }) => score.score > 0)
        .sort((a, b) => b.score.score - a.score.score)
        .slice(0, 300)
        .map(({ entry, score }) => ({ ...entry, labelMatch: score.labelMatch, detailMatch: score.descriptionMatch, action: () => revealLine(entry.line) }))
    }

    if (paletteMode === 'files') {
      const candidates = files.filter((file) => file.language !== 'diff')
      if (!query.normalized) {
        // With no query, show the most recently opened editors first.
        const recent = [...openTabs].reverse()
        const ordered = [...candidates].sort((a, b) => {
          const indexA = recent.indexOf(a.path)
          const indexB = recent.indexOf(b.path)
          return (indexA < 0 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB < 0 ? Number.MAX_SAFE_INTEGER : indexB)
        })
        return ordered.slice(0, 200).map((file) => ({
          id: `file.${file.path}`, label: fileName(file.path), detail: file.path, icon: FileCode2,
          labelMatch: [], detailMatch: [], action: () => openFile(file.path),
        }))
      }
      return candidates
        .map((file) => {
          const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
          return { file, directory, score: scoreItem(fileName(file.path), directory, query) }
        })
        .filter(({ score }) => score.score > 0)
        .sort((a, b) => b.score.score - a.score.score || fileName(a.file.path).length - fileName(b.file.path).length)
        .slice(0, 300)
        .map(({ file, score }) => ({
          id: `file.${file.path}`, label: fileName(file.path), detail: file.path, icon: FileCode2,
          labelMatch: score.labelMatch, detailMatch: [], action: () => openFile(file.path),
        }))
    }

    // Commands: hide any whose `when` clause currently fails.
    const available = commands.filter((command) => !command.when || parseWhenClause(command.when).evaluate(whenContext))
    if (!query.normalized) {
      return available.slice(0, 200).map((command) => ({
        ...command, labelMatch: [], detailMatch: [], keybinding: shortcutFor(command.id),
      }))
    }
    return available
      .map((command) => ({ command, score: scoreItem(command.label, command.detail, query) }))
      .filter(({ score }) => score.score > 0)
      .sort((a, b) => b.score.score - a.score.score || a.command.label.length - b.command.label.length)
      .slice(0, 300)
      .map(({ command, score }) => ({
        ...command, labelMatch: score.labelMatch, detailMatch: score.descriptionMatch, keybinding: shortcutFor(command.id),
      }))
  }, [activeFile, commands, editorInstance, files, openFile, openTabs, paletteMode, paletteSearch, revealLine, shortcutFor, symbols, whenContext])

  // Keep the highlighted row in range whenever the result set changes.
  useEffect(() => {
    setPaletteIndex((index) => (index >= paletteItems.length ? 0 : index))
  }, [paletteItems.length])

  /** Rows for the keybinding editor: every command with its current binding. */
  const filteredKeybindings = useMemo(() => {
    const query = keybindingFilter.trim().toLowerCase()
    return commands
      .map((command) => ({ command, binding: keybindingResolver.lookupCommand(command.id)[0] }))
      .filter(({ command, binding }) => !query
        || command.label.toLowerCase().includes(query)
        || command.id.toLowerCase().includes(query)
        || (binding ? keybindingLabel(binding.chords).toLowerCase().includes(query) : false))
      .sort((a, b) => a.command.label.localeCompare(b.command.label))
  }, [commands, keybindingFilter, keybindingResolver])

  /** Themes matching the picker's filter box. */
  const filteredThemes = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase()
    return query ? themes.filter((theme) => theme.label.toLowerCase().includes(query) || theme.kind.includes(query)) : themes
  }, [paletteQuery])

  const paletteModeLabel = paletteMode === 'files' ? 'FILES' : paletteMode === 'symbols' ? 'SYMBOLS' : paletteMode === 'line' ? 'GO TO LINE' : 'COMMANDS'
  const paletteModePlaceholder = paletteMode === 'files'
    ? 'Search files by name (append : to go to a line)…'
    : paletteMode === 'symbols' ? 'Search symbols in the active file…'
    : paletteMode === 'line' ? 'Enter a line number…'
    : 'Type a command…'

  const executePaletteItem = useCallback((item: PaletteEntry) => {
    setPalette((current) => ({ ...current, open: false }))
    setPaletteQuery('')
    setPaletteIndex(0)
    void item.action()
  }, [])

  useEffect(() => {
    if (!window.tungsten || restoredWorkspaceRef.current) return
    restoredWorkspaceRef.current = true
    window.tungsten.restoreWorkspace()
      .then((result) => applyDesktopWorkspace(result, true))
      .catch(() => undefined)
    window.tungsten.remoteProfiles().then(setRemoteProfiles).catch(() => undefined)
  }, [applyDesktopWorkspace])

  useEffect(() => {
    if (!window.tungsten || !activeFile || !workspaceRoot || !lspLanguages.has(activeFile.language)) return
    let canceled = false
    const timer = window.setTimeout(() => {
      window.tungsten!.startLanguageServer(activeFile.language).then((status) => {
        if (canceled) return
        setLspState({ language: activeFile.language, running: status.running, message: status.running ? `${activeFile.language} language server` : status.error || 'Syntax highlighting only' })
      }).catch((error: Error) => {
        if (!canceled) setLspState({ language: activeFile.language, running: false, message: error.message })
      })
    }, 350)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [activeFile, workspaceRoot])

  useEffect(() => {
    if (!window.tungsten || !activeFile || !workspaceRoot || !lspLanguages.has(activeFile.language)) return
    const timer = window.setTimeout(async () => {
      const model = editorInstance?.getModel()
      if (!model) return
      const context = await prepareLanguageDocument(activeFile.language, model)
      if (!context) return
      await context.api.languageNotify(activeFile.language, 'textDocument/didChange', {
        textDocument: { uri: context.uri, version: model.getVersionId() },
        contentChanges: [{ text: model.getValue() }],
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [activeFile, editorInstance, workspaceRoot])

  useEffect(() => {
    toggleBreakpointRef.current = (path, line) => { void toggleBreakpoint(path, line) }
  })

  useEffect(() => {
    if (!window.tungsten) return
    const unsubscribeWorkspace = window.tungsten.onWorkspaceFileEvent(({ path }) => setExternalChange(path))
    const unsubscribeRemote = window.tungsten.onRemoteStatus(({ connected, message }) => { setRemoteConnected(connected); notify(message) })
    const unsubscribeCollaborationDocument = window.tungsten.onCollaborationDocument(({ files: sharedFiles }) => {
      setFiles((current) => {
        const known = new Map(current.map((file) => [file.path, file]))
        Object.entries(sharedFiles).forEach(([path, content]) => known.set(path, { ...(known.get(path) || { path, language: languageForPath(path) }), content }))
        return [...known.values()]
      })
    })
    const unsubscribeExtension = window.tungsten.onExtensionEvent((message) => { if (message.type === 'error') notify(`${message.extensionId}: ${message.message}`) })
    const unsubscribeCollaborationEvent = window.tungsten.onCollaborationEvent((message) => {
      if (message.type === 'presence' && message.name) {
        setParticipants((current) => message.state === 'disconnected' ? current.filter((name) => name !== message.name) : current.includes(message.name!) ? current : [...current, message.name!])
        if (message.state === 'cursor' && message.name !== collaborationName && message.path && message.line && message.column) setCollaboratorCursors((current) => ({ ...current, [message.name!]: { path: message.path!, line: message.line!, column: message.column! } }))
        if (message.state === 'reconnecting') notify('Collaboration connection lost; reconnecting…')
        if (message.state === 'reconnected') notify('Collaboration reconnected')
        if (message.state === 'disconnected') setCollaboratorCursors((current) => { const next = { ...current }; delete next[message.name!]; return next })
      }
      if (message.type === 'comment' && message.text) setComments((current) => [...current, { name: message.name || 'Collaborator', text: message.text!, path: message.path, line: message.line }])
    })
    const unsubscribeLanguage = window.tungsten.onLanguageNotification(({ language, message }) => {
      if (message.method !== 'textDocument/publishDiagnostics' || !monacoApi) return
      const diagnostics = message.params?.diagnostics || []
      const uri = decodeURIComponent(message.params?.uri || '')
      const model = monacoApi.editor.getModels().find((candidate: any) => uri.endsWith(decodeURIComponent(candidate.uri.path)))
      if (!model) return
      const problemPath = model.uri.path.replace(/^\/+/, '')
      setProblems(diagnostics.map((diagnostic: any) => ({ message: diagnostic.message, path: problemPath, line: diagnostic.range.start.line + 1, severity: diagnostic.severity || 3 })))
      monacoApi.editor.setModelMarkers(model, `tungsten-${language}`, diagnostics.map((diagnostic: any) => ({
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
        message: diagnostic.message,
        source: diagnostic.source || language,
        code: diagnostic.code?.toString(),
        severity: diagnostic.severity === 1 ? monacoApi.MarkerSeverity.Error : diagnostic.severity === 2 ? monacoApi.MarkerSeverity.Warning : monacoApi.MarkerSeverity.Info,
      })))
    })
    const unsubscribeStatus = window.tungsten.onLanguageStatus(({ language, running }) => setLspState({ language, running, message: running ? `${language} language server` : `${language} server stopped` }))
    const unsubscribeDebugMessage = window.tungsten.onDebugMessage(({ id, message }) => {
      if (message.type === 'event' && message.event === 'initialized') {
        void (async () => {
          const grouped = new Map<string, Array<{ path: string; line: number; condition?: string }>>()
          breakpoints.forEach((point) => grouped.set(point.path, [...(grouped.get(point.path) || []), point]))
          for (const [path, points] of grouped) {
            const absolutePath = await window.tungsten!.absolutePath(path)
            await window.tungsten!.sendDebug(id, { type: 'request', command: 'setBreakpoints', arguments: { source: { path: absolutePath }, breakpoints: points.map((point) => ({ line: point.line, condition: point.condition })) } })
          }
          await window.tungsten!.sendDebug(id, { type: 'request', command: 'configurationDone', arguments: {} })
        })()
      } else if (message.type === 'event' && message.event === 'output') setDebugState((state) => ({ ...state, output: [...state.output, message.body?.output || ''] }))
      else if (message.type === 'event' && message.event === 'stopped') {
        const threadId = message.body?.threadId || 1
        setDebugState((state) => ({ ...state, threadId, output: [...state.output, `Paused: ${message.body?.reason || 'breakpoint'}`] }))
        void window.tungsten!.sendDebug(id, { type: 'request', command: 'threads', arguments: {} })
      } else if (message.type === 'response' && message.success && message.command === 'threads') {
        const threads = message.body?.threads || []
        setDebugThreads(threads)
        const threadId = threads[0]?.id || 1
        void window.tungsten!.sendDebug(id, { type: 'request', command: 'stackTrace', arguments: { threadId, startFrame: 0, levels: 50 } })
      } else if (message.type === 'response' && message.success && message.command === 'stackTrace') {
        const frames = message.body?.stackFrames || []
        setDebugFrames(frames)
        if (frames[0]?.id) void window.tungsten!.sendDebug(id, { type: 'request', command: 'scopes', arguments: { frameId: frames[0].id } })
      } else if (message.type === 'response' && message.success && message.command === 'scopes') {
        const scopes = message.body?.scopes || []
        setDebugScopes(scopes)
        if (scopes[0]?.variablesReference) void window.tungsten!.sendDebug(id, { type: 'request', command: 'variables', arguments: { variablesReference: scopes[0].variablesReference } })
        watchEvaluationQueueRef.current = [...watches]
        watches.forEach((expression) => { void window.tungsten!.sendDebug(id, { type: 'request', command: 'evaluate', arguments: { expression, frameId: debugFrames[0]?.id, context: 'watch' } }) })
      } else if (message.type === 'response' && message.success && message.command === 'variables') setDebugVariables(message.body?.variables || [])
      else if (message.type === 'response' && message.success && message.command === 'evaluate') {
        const expression = watchEvaluationQueueRef.current.shift()
        if (expression) setWatchValues((values) => ({ ...values, [expression]: message.body?.result || 'undefined' }))
      } else if (message.type === 'response' && message.success === false) setDebugState((state) => ({ ...state, output: [...state.output, message.message || `${message.command} failed`] }))
    })
    const unsubscribeDebugOutput = window.tungsten.onDebugOutput(({ output }) => setDebugState((state) => ({ ...state, output: [...state.output, output] })))
    const unsubscribeDebugExit = window.tungsten.onDebugExit(({ code }) => setDebugState((state) => ({ ...state, running: false, output: [...state.output, `Adapter exited with code ${code}`] })))
    const unsubscribeUpdater = window.tungsten.onUpdaterStatus(({ event }) => {
      const labels: Record<string, string> = { 'checking-for-update': 'Checking for updates…', 'update-available': 'Update available', 'update-not-available': 'Up to date', 'download-progress': 'Downloading update…', 'update-downloaded': 'Restart to update', error: 'Update check failed' }
      setUpdateState(labels[event] || event)
      if (event === 'update-available') void window.tungsten?.downloadUpdate()
    })
    return () => { unsubscribeWorkspace(); unsubscribeRemote(); unsubscribeCollaborationDocument(); unsubscribeCollaborationEvent(); unsubscribeExtension(); unsubscribeLanguage(); unsubscribeStatus(); unsubscribeDebugMessage(); unsubscribeDebugOutput(); unsubscribeDebugExit(); unsubscribeUpdater() }
  }, [breakpoints, collaborationName, debugFrames, notify, watches])

  useEffect(() => {
    if (!window.tungsten || !workspaceRoot || !dirty.size) return
    const timer = window.setTimeout(() => {
      const changedFiles = files.filter((file) => dirty.has(file.path))
      void window.tungsten!.saveRecovery({ workspaceRoot, savedAt: Date.now(), files: changedFiles })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [dirty, files, workspaceRoot])

  useEffect(() => {
    if (!window.tungsten || !collaborationActive || !activeFile || activeFile.language === 'diff') return
    const timer = window.setTimeout(() => { void window.tungsten!.publishCollaborationFile(activeFile.path, activeFile.content) }, 220)
    return () => window.clearTimeout(timer)
  }, [activeFile, collaborationActive])

  useEffect(() => {
    if (!window.tungsten || !workspaceRoot || !searchQuery.trim()) return
    let canceled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      window.tungsten!.searchWorkspace(searchQuery, 500).then((results) => {
        if (!canceled) setNativeSearchResults(results)
      }).catch(() => {
        if (!canceled) setNativeSearchResults([])
      }).finally(() => {
        if (!canceled) setSearching(false)
      })
    }, 180)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [searchQuery, workspaceRoot])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem(KEYBINDINGS_KEY, JSON.stringify(userKeybindings))
  }, [userKeybindings])

  useEffect(() => {
    if (!collaborationActive || !activePath || activePath === PREVIEW_PATH) return
    const timer = window.setTimeout(() => { void window.tungsten?.sendCollaborationEvent({ type: 'presence', state: 'cursor', name: collaborationName, path: activePath, line: cursor.line, column: cursor.column }) }, 90)
    return () => window.clearTimeout(timer)
  }, [activePath, collaborationActive, collaborationName, cursor.column, cursor.line])

  useEffect(() => {
    localStorage.setItem(TERMINAL_LAYOUT_KEY, JSON.stringify({ tabs: terminalTabs.map(({ id, label, profile }) => ({ id, label, profile, generation: 0 })), activeId: activeTerminalId, split: terminalSplit }))
  }, [activeTerminalId, terminalSplit, terminalTabs])

  useEffect(() => {
    localStorage.setItem(WORKBENCH_LAYOUT_KEY, JSON.stringify({ sidebarVisible, sidebarWidth, panelOpen, panelHeight }))
  }, [panelHeight, panelOpen, sidebarVisible, sidebarWidth])

  useEffect(() => {
    if (!editorInstance || !activeFile || activeFile.language === 'diff') return
    const decorations = [
      ...breakpoints.filter((point) => point.path === activeFile.path).map((point) => ({ range: new monacoApi.Range(point.line, 1, point.line, 1), options: { isWholeLine: true, glyphMarginClassName: 'debug-breakpoint-glyph', glyphMarginHoverMessage: { value: point.condition ? `Conditional breakpoint: ${point.condition}` : 'Breakpoint' } } })),
      ...(coverage[activeFile.path] || []).map((entry) => ({ range: new monacoApi.Range(entry.line, 1, entry.line, 1), options: { isWholeLine: true, linesDecorationsClassName: entry.hits > 0 ? 'coverage-hit-line' : 'coverage-miss-line', overviewRuler: { color: entry.hits > 0 ? '#628844' : '#a34e49', position: 1 } } })),
      ...Object.entries(collaboratorCursors).filter(([, point]) => point.path === activeFile.path).map(([name, point]) => ({ range: new monacoApi.Range(point.line, point.column, point.line, point.column), options: { beforeContentClassName: 'collaboration-cursor', hoverMessage: { value: `${name} is editing here` } } })),
      ...(debugFrames[0] && debugVariables.length && ((debugFrames[0].source?.path || debugFrames[0].source?.name || '').replaceAll('\\', '/').endsWith(activeFile.path) || activeFile.path.endsWith(debugFrames[0].source?.name || '__no_file__')) ? [{ range: new monacoApi.Range(debugFrames[0].line, 1, debugFrames[0].line, 1), options: { after: { content: `  ${debugVariables.slice(0, 6).map((variable) => `${variable.name} = ${variable.value}`).join('  ·  ')}`, inlineClassName: 'debug-inline-value' } } }] : []),
    ]
    const collection = editorInstance.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [activeFile, breakpoints, collaboratorCursors, coverage, debugFrames, debugVariables, editorInstance])

  useEffect(() => {
    if (!settings.autosave || !dirty.size) return
    const timer = window.setTimeout(() => { void save().catch(() => undefined) }, 900)
    return () => window.clearTimeout(timer)
  }, [dirty, files, save, settings.autosave])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [terminalLines])

  useEffect(() => {
    if (palette.open) window.setTimeout(() => paletteInputRef.current?.focus(), 20)
  }, [palette.open])

  useEffect(() => {
    if (newFileOpen) window.setTimeout(() => newFileInputRef.current?.focus(), 20)
  }, [newFileOpen])

  /**
   * Keystroke dispatch through the VS Code-style resolver.
   *
   * A keypress is appended to any chords already pending. The resolver either
   * matches a command, reports that more chords are needed (the status bar then
   * shows the pending prefix), or reports no match, which clears the sequence.
   */
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingChords.length) { setPendingChords([]); return }
        setPalette((current) => ({ ...current, open: false })); setSettingsOpen(false); setKeybindingsOpen(false)
        setNewFileOpen(false); setRenameTarget(null); setMenuOpen(null); setContextMenu(null); setThemePickerOpen(false)
        return
      }

      // The keybinding editor captures raw keystrokes while recording.
      if (recordingCommand) return

      const chord = chordFromEvent(event)
      if (!chord) return

      // While typing in a text field, only allow chords that carry a modifier so
      // ordinary typing is never swallowed.
      const target = event.target as HTMLElement | null
      const isTextEntry = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey
      if (isTextEntry && !hasModifier && !pendingChords.length) return

      const result = keybindingResolver.resolve(whenContext, pendingChords, chord)
      if (result.kind === 'more-chords-needed') {
        event.preventDefault()
        setPendingChords((current) => [...current, chord])
        return
      }
      if (result.kind === 'no-match') {
        if (pendingChords.length) { event.preventDefault(); setPendingChords([]) }
        return
      }

      event.preventDefault()
      setPendingChords([])
      void runCommandRef.current(result.command)
    }

    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [keybindingResolver, pendingChords, recordingCommand, whenContext])

  // A pending chord prefix times out, matching VS Code's behaviour.
  useEffect(() => {
    if (!pendingChords.length) return
    const timer = window.setTimeout(() => setPendingChords([]), 5000)
    return () => window.clearTimeout(timer)
  }, [pendingChords])

  const startSidebarResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: MouseEvent) => setSidebarWidth(Math.max(190, Math.min(420, startWidth + moveEvent.clientX - startX)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startPanelResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight
    const move = (moveEvent: MouseEvent) => setPanelHeight(Math.max(120, Math.min(window.innerHeight * .65, startHeight + startY - moveEvent.clientY)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const newTerminal = (profile?: TerminalProfile, label?: string) => {
    const id = nextTerminalIdRef.current++
    setTerminalTabs((tabs) => [...tabs, { id, label: label || profile?.label || `shell ${id}`, generation: 0, profile: profile ? { kind: profile.kind, id: profile.id } : undefined }])
    setActiveTerminalId(id)
    setPanelTab('TERMINAL')
    setPanelOpen(true)
    return id
  }

  const closeTerminal = (id: number) => {
    if (terminalTabs.length === 1) {
      const replacementId = nextTerminalIdRef.current++
      setTerminalTabs([{ id: replacementId, label: 'shell 1', generation: 0 }])
      setActiveTerminalId(replacementId)
      return
    }
    const remaining = terminalTabs.filter((terminal) => terminal.id !== id)
    setTerminalTabs(remaining)
    if (activeTerminalId === id) setActiveTerminalId(remaining[0].id)
  }

  /** Move focus between terminal tabs, wrapping at both ends. */
  const focusTerminalByOffset = (offset: number) => {
    if (terminalTabs.length < 2) return
    const index = terminalTabs.findIndex((terminal) => terminal.id === activeTerminalId)
    const next = ((index + offset) % terminalTabs.length + terminalTabs.length) % terminalTabs.length
    setActiveTerminalId(terminalTabs[next].id)
    setPanelTab('TERMINAL')
    setPanelOpen(true)
  }

  const panelContent = () => {
    if (panelTab === 'PROBLEMS') return problems.length ? (
      <div className="problems-list">{problems.map((problem, index) => <button key={`${problem.path}-${problem.line}-${index}`} onClick={() => { openFile(problem.path); editorInstance?.setPosition({ lineNumber: problem.line, column: 1 }); editorInstance?.revealLineInCenter(problem.line) }}><CircleAlert size={13} className={problem.severity === 1 ? 'error' : 'warning'} /><span>{problem.message}</span><small>{problem.path}:{problem.line}</small></button>)}</div>
    ) : (
      <div className="empty-panel"><CircleCheck size={24} /><strong>No problems detected</strong><span>Workspace validation passed.</span></div>
    )
    if (panelTab === 'OUTPUT') return (
      <div className="output-panel"><span>[Tungsten]</span> Workspace index ready · {files.length} files<br /><span>[Project]</span> {projectInfo.frameworks.join(', ') || 'No framework detected'}<br /><span>[Language]</span> {lspState.message}<br /><span>[Git]</span> {gitInfo.isRepository ? `Watching ${gitInfo.branch}` : 'No repository detected'}</div>
    )
    if (panelTab === 'DEBUG CONSOLE') return (
      <div className="debug-console-output">{debugState.output.length ? debugState.output.map((line, index) => <div key={index}>{line}</div>) : <div className="empty-panel"><Bot size={24} /><strong>Debug console is ready</strong><span>Start a debug session to inspect values.</span></div>}</div>
    )
    if (window.tungsten) {
      const secondary = terminalTabs.find((terminal) => terminal.id !== activeTerminalId)
      const visible = terminalTabs.filter((terminal) => terminal.id === activeTerminalId || (terminalSplit && terminal.id === secondary?.id))
      return <div className="terminal-workspace">
        <div className="terminal-tab-strip">{terminalTabs.map((terminal) => <button key={terminal.id} className={terminal.id === activeTerminalId ? 'active' : ''} onClick={() => setActiveTerminalId(terminal.id)}><TerminalSquare size={11} /><span>{terminal.label}</span><X size={10} onClick={(event) => { event.stopPropagation(); closeTerminal(terminal.id) }} /></button>)}<button className="terminal-add" title="New local terminal" onClick={() => newTerminal()}><Plus size={12} /></button><select title="Terminal profile" defaultValue="" onChange={(event) => { const [kind, id] = event.target.value.split(':'); if (kind === 'wsl') newTerminal({ kind, id, label: `WSL · ${id}` }); if (kind === 'container') { const container = remoteProfiles.containers.find((item) => item.id === id); newTerminal({ kind, id, label: `Docker · ${container?.name || id}` }); } event.target.value = '' }}><option value="">Profiles…</option>{remoteProfiles.wsl.map((name) => <option key={`wsl:${name}`} value={`wsl:${name}`}>WSL · {name}</option>)}{remoteProfiles.containers.map((container) => <option key={`container:${container.id}`} value={`container:${container.id}`}>Docker · {container.name}</option>)}</select></div>
        {terminalSearchOpen && <form className="terminal-search" onSubmit={(event) => { event.preventDefault(); if (terminalSearchQuery) setTerminalSearchRequest({ id: Date.now(), query: terminalSearchQuery }) }}><Search size={12} /><input autoFocus value={terminalSearchQuery} onChange={(event) => setTerminalSearchQuery(event.target.value)} placeholder="Find in terminal" /><button type="submit">Next</button><button type="button" onClick={() => setTerminalSearchOpen(false)}><X size={12} /></button></form>}
        <div className={`terminal-grid ${terminalSplit && visible.length > 1 ? 'split' : ''}`} onFocus={() => setFocusedSurface('terminal')} onBlur={() => setFocusedSurface((current) => current === 'terminal' ? 'none' : current)}>{visible.map((terminal) => <div key={`${terminal.id}-${terminal.generation}`} className="terminal-cell"><Suspense fallback={<div className="terminal-loading">Starting PTY…</div>}><DesktopTerminal sessionKey={terminal.id * 1000 + terminal.generation} command={terminal.id === (terminalCommand?.terminalId || activeTerminalId) ? terminalCommand : null} profile={terminal.profile} searchRequest={terminal.id === activeTerminalId ? terminalSearchRequest : null} themeId={activeTheme.id} fontSize={Math.max(9, settings.fontSize - 1)} /></Suspense></div>)}</div>
      </div>
    }
    return (
      <div className="terminal" onClick={() => terminalInputRef.current?.focus()}>
        <div className="terminal-scroll">
          {terminalLines.map((line, index) => <div key={index} className={`terminal-line ${line.kind || ''}`}>{line.text}</div>)}
          <div className="terminal-prompt">
            <span className="prompt-user">tungsten@{workspaceName}</span><span className="prompt-path"> ~/{workspaceName} </span><span>$</span>
            <input
              ref={terminalInputRef}
              value={terminalInput}
              spellCheck={false}
              autoComplete="off"
              aria-label="Terminal input"
              onChange={(event) => setTerminalInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  runTerminalCommand(terminalInput); setTerminalInput('')
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  const next = Math.min(history.length - 1, historyIndex + 1)
                  setHistoryIndex(next); setTerminalInput(history[history.length - 1 - next] || '')
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  const next = Math.max(-1, historyIndex - 1)
                  setHistoryIndex(next); setTerminalInput(next === -1 ? '' : history[history.length - 1 - next] || '')
                }
              }}
            />
          </div>
          <div ref={terminalEndRef} />
        </div>
      </div>
    )
  }

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    if (window.tungsten && workspaceRoot) return nativeSearchResults.map((result) => ({
      file: files.find((file) => file.path === result.path) || { path: result.path, content: '', language: languageForPath(result.path) },
      line: result.preview,
      index: result.line - 1,
      column: result.column,
    }))
    const query = searchQuery.toLowerCase()
    return files.flatMap((file) => file.content.split('\n').map((line, index) => ({ file, line, index, column: line.toLowerCase().indexOf(query) + 1 })).filter((result) => result.column > 0)).slice(0, 500)
  }, [files, nativeSearchResults, searchQuery, workspaceRoot])

  const sidebarContent = () => {
    if (activity === 'search') return (
      <>
        <div className="sidebar-title"><span>SEARCH</span><Ellipsis size={16} /></div>
        <div className="search-box-wrap"><Search size={13} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search workspace" /></div>
        <div className="search-meta">{searching ? 'Searching with ripgrep…' : searchQuery ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} in ${new Set(searchResults.map((item) => item.file.path)).size} files` : 'Type to search across files'}</div>
        <div className="search-results">
          {searchResults.map((result, index) => <button key={`${result.file.path}-${result.index}-${index}`} onClick={() => { openFile(result.file.path); setCursor({ line: result.index + 1, column: result.column }); window.setTimeout(() => { editorInstance?.setPosition({ lineNumber: result.index + 1, column: result.column }); editorInstance?.revealLineInCenter(result.index + 1) }, 30) }}>
            <div><FileGlyph path={result.file.path} /><strong>{fileName(result.file.path)}</strong><span>:{result.index + 1}</span></div>
            <p>{result.line.trim()}</p>
          </button>)}
        </div>
      </>
    )
    if (activity === 'source') return (
      <>
        <div className="sidebar-title"><span>SOURCE CONTROL</span><span className="branch-label"><GitBranch size={11} />{gitInfo.branch || 'no repository'}</span></div>
        <div className="git-view-tabs"><button className={gitView === 'changes' ? 'active' : ''} onClick={() => setGitView('changes')}>Changes</button><button className={gitView === 'history' ? 'active' : ''} onClick={() => setGitView('history')}>History</button><button className={gitView === 'github' ? 'active' : ''} onClick={() => setGitView('github')}>GitHub</button></div>
        {gitView === 'changes' && <>
        {gitBranches.length > 0 && <div className="branch-switcher"><GitBranch size={13} /><select value={gitInfo.branch} onChange={(event) => { void window.tungsten?.gitCheckout(event.target.value).then((status) => { setGitInfo(status); void refreshWorkspace() }).catch((error: Error) => notify(error.message)) }}>{gitBranches.map((branch) => <option key={branch}>{branch}</option>)}</select></div>}
        {gitOperation.operation ? <div className="git-operation-card"><strong>{gitOperation.operation.toUpperCase()} IN PROGRESS</strong><span>{gitOperation.conflicts.length ? `${gitOperation.conflicts.length} conflict${gitOperation.conflicts.length === 1 ? '' : 's'} must be resolved` : 'All conflicts resolved; ready to continue'}</span>{gitOperation.conflicts.map((path) => <button key={path} onClick={() => { void openGitConflict(path) }}><GitCompareArrows size={12} /><span>{path}</span><ChevronRight size={11} /></button>)}<div><button disabled={gitOperation.conflicts.length > 0} onClick={() => { void finishGitOperation('continue') }}><Check size={11} />Continue</button><button onClick={() => { void finishGitOperation('abort') }}><X size={11} />Abort</button></div></div> : gitBranches.length > 1 && <div className="git-integrate"><select value={gitIntegrateBranch} onChange={(event) => setGitIntegrateBranch(event.target.value)}><option value="">Integrate branch…</option>{gitBranches.filter((branch) => branch !== gitInfo.branch).map((branch) => <option key={branch}>{branch}</option>)}</select><button disabled={!gitIntegrateBranch} onClick={() => { void integrateGitBranch('merge') }}>Merge</button><button disabled={!gitIntegrateBranch} onClick={() => { void integrateGitBranch('rebase') }}>Rebase</button></div>}
        <div className="commit-box">
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void commitChanges() }}
            placeholder="Message (⌘Enter to commit)"
          />
          <button disabled={!commitMessage.trim() || (!sourceChanges.length && window.tungsten !== undefined)} onClick={() => { void commitChanges() }}><Check size={14} /> Commit all changes</button>
        </div>
        <div className="section-heading"><span>CHANGES</span><span className="count-pill">{sourceChanges.length}</span><TipButton label="Refresh Git status" onClick={refreshGit}><RefreshCw size={13} /></TipButton></div>
        {!gitInfo.isRepository && window.tungsten && workspaceRoot ? (
          <div className="sidebar-empty"><GitCommitHorizontal size={25} /><span>{gitInfo.error || 'This folder is not a Git repository'}</span></div>
        ) : sourceChanges.length === 0 ? (
          <div className="sidebar-empty"><GitCommitHorizontal size={25} /><span>Working tree is clean</span></div>
        ) : sourceChanges.map(({ path, status, staged, workingTree }) => (
          <div className="change-row" key={path}>
            <button className="change-main" onClick={() => { if (window.tungsten) { if (status.includes('U') || status === 'AA' || status === 'DD') void openGitConflict(path); else void openGitDiff(path, Boolean(staged && !workingTree)) } else if (files.some((file) => file.path === path)) openFile(path) }}><FileGlyph path={path} /><span>{fileName(path)}</span><small>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}{staged ? ' · staged' : ''}</small></button>
            {window.tungsten && !status.includes('U') && status !== 'AA' && status !== 'DD' && <button className="stage-button" title={staged && !workingTree ? 'Unstage file' : 'Stage file'} onClick={() => { void window.tungsten!.gitStage(path, !(staged && !workingTree)).then(setGitInfo).catch((error: Error) => notify(error.message)) }}>{staged && !workingTree ? <Minus size={12} /> : <Plus size={12} />}</button>}
            <b>{status}</b>
          </div>
        ))}
        <div className="git-actions"><button onClick={() => { void window.tungsten?.gitStashPush(`Tungsten stash ${new Date().toLocaleString()}`).then((status) => { setGitInfo(status); void refreshGit() }).catch((error: Error) => notify(error.message)) }}>Stash changes</button><button disabled={gitStashes.length === 0} onClick={() => { if (gitStashes[0]) void window.tungsten?.gitStashPop(gitStashes[0].ref).then((status) => { setGitInfo(status); void refreshWorkspace() }).catch((error: Error) => notify(error.message)) }}>Pop stash</button></div>
        </>}
        {gitView === 'history' && <div className="git-history-list">{gitHistory.map((commit) => <div key={commit.hash}><i /><span><strong>{commit.subject}</strong><small>{commit.shortHash} · {commit.author} · {new Date(commit.date).toLocaleDateString()}</small>{commit.refs && <em>{commit.refs}</em>}</span></div>)}{gitStashes.length > 0 && <><div className="section-heading"><span>STASHES</span><span className="count-pill">{gitStashes.length}</span></div>{gitStashes.map((stash) => <button className="stash-row" key={stash.ref} onClick={() => { void window.tungsten?.gitStashPop(stash.ref).then(setGitInfo).catch((error: Error) => notify(error.message)) }}><Archive size={12} /><span>{stash.subject}</span><small>{stash.ref}</small></button>)}</>}</div>}
        {gitView === 'github' && <div className="github-list"><div className="section-heading"><span>PULL REQUESTS</span><span className="count-pill">{githubItems.pullRequests.length}</span></div>{githubItems.pullRequests.map((item) => <button key={`pr-${item.number}`} onClick={() => { void window.tungsten?.openExternal(item.url) }}><GitPullRequest size={13} /><span><strong>#{item.number} {item.title}</strong><small>{item.state}</small></span></button>)}<div className="section-heading"><span>ISSUES</span><span className="count-pill">{githubItems.issues.length}</span></div>{githubItems.issues.map((item) => <button key={`issue-${item.number}`} onClick={() => { void window.tungsten?.openExternal(item.url) }}><CircleAlert size={13} /><span><strong>#{item.number} {item.title}</strong><small>{item.state}</small></span></button>)}</div>}
      </>
    )
    if (activity === 'debug') return (
      <>
        <div className="sidebar-title"><span>RUN AND DEBUG</span><TipButton label={debugState.running ? 'Stop debugging' : 'Start debugging'} onClick={() => { if (debugState.running) void stopDebugging(); else void startDebugging() }}>{debugState.running ? <CircleStop size={15} /> : <Play size={15} />}</TipButton></div>
        <div className="debug-launch">
          <button className={debugState.running ? 'stop' : ''} onClick={() => { if (debugState.running) void stopDebugging(); else void startDebugging() }}>{debugState.running ? <CircleStop size={15} /> : <BugPlay size={15} />}{debugState.running ? 'Stop session' : 'Start debugging'}<kbd>F5</kbd></button>
          <p>{files.some((file) => file.path === '.tungsten/launch.json') ? 'Using .tungsten/launch.json' : 'Add .tungsten/launch.json with your DAP adapter configuration.'}</p>
        </div>
        {debugState.running && debugState.id && <div className="debug-controls">{([
          ['Continue', 'continue', Play],
          ['Pause', 'pause', Pause],
          ['Step over', 'next', StepForward],
          ['Step into', 'stepIn', CornerDownRight],
          ['Step out', 'stepOut', Undo2],
        ] as const).map(([label, command, Icon]) => <button key={command} title={`${label} (${shortcutFor(`workbench.action.debug.${command === 'next' ? 'stepOver' : command === 'stepIn' ? 'stepInto' : command === 'stepOut' ? 'stepOut' : command}`) || '—'})`} onClick={() => { void debugControl(command) }}><Icon size={13} /></button>)}<span>DAP SESSION</span></div>}
        {debugState.running && <>
          <div className="section-heading"><ChevronDown size={13} /><span>THREADS</span><span className="count-pill">{debugThreads.length}</span></div>
          <div className="debug-data-list">{debugThreads.map((thread) => <button key={thread.id} onClick={() => { setDebugState((state) => ({ ...state, threadId: thread.id })); void window.tungsten?.sendDebug(debugState.id!, { type: 'request', command: 'stackTrace', arguments: { threadId: thread.id, startFrame: 0, levels: 50 } }) }}><Cpu size={12} /><strong>{thread.name}</strong><small>#{thread.id}</small></button>)}</div>
          <div className="section-heading"><ChevronDown size={13} /><span>CALL STACK</span><span className="count-pill">{debugFrames.length}</span></div>
          <div className="debug-data-list">{debugFrames.map((frame) => <button key={frame.id} onClick={() => { const candidate = (frame.source?.path || '').replaceAll('\\', '/'); const relative = candidate.startsWith(workspaceRoot.replaceAll('\\', '/')) ? candidate.slice(workspaceRoot.length + 1) : files.find((file) => candidate.endsWith(`/${file.path}`))?.path || frame.source?.name || ''; if (files.some((file) => file.path === relative)) { openFile(relative); window.setTimeout(() => { editorInstance?.setPosition({ lineNumber: frame.line, column: 1 }); editorInstance?.revealLineInCenter(frame.line) }, 30) } void window.tungsten?.sendDebug(debugState.id!, { type: 'request', command: 'scopes', arguments: { frameId: frame.id } }) }}><Layers size={12} /><strong>{frame.name}</strong><small>{frame.source?.name || 'source'}:{frame.line}</small></button>)}</div>
          <div className="section-heading"><ChevronDown size={13} /><span>VARIABLES</span><span className="count-pill">{debugVariables.length}</span></div>
          <div className="debug-variable-list">{debugScopes.map((scope) => <b key={scope.name}>{scope.name}</b>)}{debugVariables.map((variable, index) => <div key={`${variable.name}-${index}`}><span>{variable.name}</span><code>{variable.value}</code><small>{variable.type}</small></div>)}</div>
          <div className="section-heading"><ChevronDown size={13} /><span>WATCH</span><span className="count-pill">{watches.length}</span></div>
          <div className="watch-input"><input value={watchInput} placeholder="Expression" onChange={(event) => setWatchInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && watchInput.trim()) { setWatches((items) => [...items, watchInput.trim()]); setWatchInput('') } }} /><Plus size={12} /></div>
          <div className="debug-variable-list">{watches.map((expression) => <div key={expression}><span>{expression}</span><code>{watchValues[expression] || 'not evaluated'}</code><X size={11} onClick={() => setWatches((items) => items.filter((item) => item !== expression))} /></div>)}</div>
        </>}
        <div className="section-heading"><ChevronDown size={13} /><span>BREAKPOINTS</span><span className="count-pill">{breakpoints.length}</span><TipButton label="Add breakpoint at cursor" onClick={() => { if (activeFile) void toggleBreakpoint(activeFile.path, cursor.line) }}><Plus size={13} /></TipButton></div>
        <div className="breakpoint-list">{breakpoints.length ? breakpoints.map((point) => <button key={`${point.path}:${point.line}`} title="Right-click to edit condition" onContextMenu={(event) => { event.preventDefault(); void editBreakpointCondition(point.path, point.line) }} onClick={() => { openFile(point.path); setCursor({ line: point.line, column: 1 }); editorInstance?.revealLineInCenter(point.line); editorInstance?.setPosition({ lineNumber: point.line, column: 1 }) }}><span className="breakpoint-dot" /><strong>{fileName(point.path)}</strong><small>line {point.line}{point.condition ? ` · ${point.condition}` : ''}</small><X size={12} onClick={(event) => { event.stopPropagation(); void toggleBreakpoint(point.path, point.line) }} /></button>) : <p>No breakpoints set</p>}</div>
        <div className="section-heading"><ChevronDown size={13} /><span>DEBUG OUTPUT</span></div>
        <div className="debug-sidebar-output">{debugState.output.slice(-8).map((line, index) => <p key={index}>{line}</p>)}</div>
      </>
    )
    if (activity === 'tests') return (
      <>
        <div className="sidebar-title"><span>TESTING & TASKS</span><TipButton label="Refresh tests and coverage" onClick={() => { void window.tungsten?.detectProject().then(setProjectInfo); void window.tungsten?.discoverTests().then(setDiscoveredTests); void window.tungsten?.readCoverage().then(setCoverage) }}><RefreshCw size={14} /></TipButton></div>
        <div className="framework-tags">{projectInfo.frameworks.length ? projectInfo.frameworks.map((framework) => <span key={framework}>{framework}</span>) : <span>No framework detected</span>}</div>
        <div className="section-heading"><ChevronDown size={13} /><span>TEST PROFILES</span><span className="count-pill">{projectInfo.tests.length}</span></div>
        <div className="task-list">{projectInfo.tests.length ? projectInfo.tests.map((task) => <button key={task.label} onClick={() => runIntegratedCommand(task.command)}><FlaskConical size={14} /><span><strong>{task.label}</strong><small>{task.command}</small></span><Play size={12} /></button>) : <div className="sidebar-empty compact"><FlaskConical size={22} /><span>No test runner detected</span></div>}</div>
        <div className="section-heading"><ChevronDown size={13} /><span>DISCOVERED TESTS</span><span className="count-pill">{discoveredTests.length}</span></div>
        <div className="test-case-list">{discoveredTests.slice(0, 300).map((test) => { const result = testResults[test.id]; return <div key={test.id} className={result?.status || ''}><button title="Open test" onClick={() => { setActiveTestResult(test.id); openFile(test.path); window.setTimeout(() => { editorInstance?.setPosition({ lineNumber: test.line, column: 1 }); editorInstance?.revealLineInCenter(test.line) }, 30) }}>{result?.status === 'failed' ? <CircleAlert size={11} /> : result?.status === 'running' ? <RefreshCw size={11} className="spin" /> : <CircleCheck size={11} />}<span><strong>{test.name}</strong><small>{test.path}:{test.line}{result?.durationMs !== undefined ? ` · ${result.durationMs} ms` : ''}</small></span></button><button title="Run this test" onClick={() => { void runStructuredTest(test.id) }}><Play size={11} /></button><button title="Debug this test" onClick={() => { runIntegratedCommand(test.command); notify('Test command started in a dedicated terminal; attach a launch configuration to debug') }}><BugPlay size={11} /></button></div> })}</div>
        {activeTestResult && testResults[activeTestResult] && <div className={`test-result-detail ${testResults[activeTestResult].status}`}><strong>{testResults[activeTestResult].status.toUpperCase()}</strong>{testResults[activeTestResult].failures?.map((line, index) => <code key={`failure-${index}`}>{line}</code>)}{testResults[activeTestResult].snapshots?.map((line, index) => <code key={`snapshot-${index}`}>Snapshot · {line}</code>)}{testResults[activeTestResult].output && <pre>{testResults[activeTestResult].output}</pre>}</div>}
        <div className="coverage-summary"><ShieldCheck size={13} /><span>{Object.keys(coverage).length ? `Coverage loaded for ${Object.keys(coverage).length} files` : 'Run coverage to enable editor overlays'}</span></div>
        <div className="section-heading"><ChevronDown size={13} /><span>PROJECT TASKS</span><span className="count-pill">{projectInfo.tasks.length}</span></div>
        <div className="task-list">{projectInfo.tasks.map((task) => <button key={`${task.label}-${task.command}`} onClick={() => runIntegratedCommand(task.command)}><ListChecks size={14} /><span><strong>{task.label}</strong><small>{task.command}</small></span><Play size={12} /></button>)}</div>
      </>
    )
    if (activity === 'extensions') return (
      <>
        <div className="sidebar-title"><span>EXTENSIONS</span><TipButton label="Install extension from folder" onClick={() => { void installExtension() }}><PackagePlus size={15} /></TipButton></div>
        <div className="search-box-wrap"><Search size={13} /><input placeholder="Search installed extensions" /></div>
        <div className="extension-install-banner"><PackagePlus size={17} /><div><strong>Declarative extensions</strong><p>Install commands, themes and language contributions from a local folder.</p></div><button onClick={() => { void installExtension() }}>Install</button></div>
        <div className="section-heading"><span>BUILT IN</span><span className="count-pill">4</span></div>
        {[
          { id: 'core.languages', name: 'Language Core', description: `${supportedLanguages.length} bundled language grammars`, icon: 'L' },
          { id: 'core.format', name: 'Formatter Core', description: 'Monaco document formatting bridge', icon: 'P' },
          { id: 'core.git', name: 'Git Tools', description: 'Diffs, staging, branches and commits', icon: 'G' },
          { id: 'core.debug', name: 'Debug Adapter Core', description: 'Debug Adapter Protocol transport', icon: 'D' },
        ].map((extension) => <div className="extension-card" key={extension.id}><div className={`extension-icon ext-${extension.icon.toLowerCase()}`}>{extension.icon}</div><div><strong>{extension.name}</strong><p>{extension.description}</p><span>Tungsten · Enabled</span></div><ShieldCheck size={13} /></div>)}
        <div className="section-heading"><span>INSTALLED PACKAGES</span><span className="count-pill">{extensions.length}</span></div>
        {extensions.map((extension) => <div className={`extension-card managed ${extension.enabled === false ? 'disabled' : ''}`} key={extension.id}><div className="extension-icon">{extension.name[0] || 'E'}</div><div><strong>{extension.name}</strong><p>{extension.description}</p><span>{extension.publisher} · {extension.scope || 'user'} · {extension.verification || 'declarative'} · {extension.enabled === false ? 'Disabled' : 'Enabled'}</span><small>{extension.permissions?.length ? `Permissions: ${extension.permissions.join(', ')}` : 'No runtime permissions'}</small></div><div className="extension-actions"><button title={extension.enabled === false ? 'Enable extension' : 'Disable extension'} onClick={() => { void window.tungsten?.setExtensionEnabled(extension.id, extension.enabled === false).then(setExtensions).catch((error: Error) => notify(error.message)) }}>{extension.enabled === false ? <Play size={11} /> : <CircleStop size={11} />}</button>{extension.scope !== 'workspace' && <button title="Uninstall extension" onClick={() => { void window.tungsten?.uninstallExtension(extension.id).then(setExtensions).catch((error: Error) => notify(error.message)) }}><Trash2 size={11} /></button>}</div></div>)}
      </>
    )
    return (
      <>
        <div className="sidebar-title"><span>EXPLORER</span><Ellipsis size={16} /></div>
        <div className="project-heading"><ChevronDown size={13} /><strong>{workspaceName.toUpperCase()}</strong><span>{externalChange && <i className="workspace-change-dot" title={`${externalChange} changed on disk`} />}</span><TipButton label="Open folder" onClick={openDesktopFolder}><FolderOpen size={14} /></TipButton><TipButton label="Add workspace root" onClick={() => { void addWorkspaceFolder() }}><FolderPlus size={14} /></TipButton><TipButton label="Refresh workspace" onClick={() => { setExternalChange(null); void refreshWorkspace() }}><RefreshCw size={13} /></TipButton><TipButton label="New file" onClick={openNewFileDialog}><File size={14} /><Plus size={8} className="mini-plus" /></TipButton></div>
        {workspaceRoots.length > 1 && <div className="workspace-roots">{workspaceRoots.map((root) => <div key={root.path}><span>{root.prefix || '@primary'} · {root.name}</span>{root.prefix && <button title="Remove workspace root" onClick={() => { void removeWorkspaceFolder(root.prefix) }}><X size={10} /></button>}</div>)}</div>}
        <ExplorerTree files={files} activePath={activePath} openFile={openFile} dirty={dirty} onFileContext={(event, path) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, path }) }} />
        <div className="outline-section">
          <div className="section-heading"><ChevronDown size={13} /><span>OUTLINE</span><span /><Ellipsis size={14} /></div>
          {symbols.length ? <div className="symbols-list">{symbols.map((symbol, index) => <div key={`${symbol.label}-${index}`}><Braces size={13} /><span>{symbol.label}</span></div>)}</div> : <p className="outline-empty">No symbols found</p>}
        </div>
        <div className="collapsed-section"><ChevronRight size={13} /> TIMELINE</div>
      </>
    )
  }

  /**
   * Menu bar.
   *
   * Entries reference command ids, so their labels, shortcuts and `when` clauses
   * come from the single command table and can never drift out of sync with the
   * keybindings the user has actually configured. `divider` starts a new group.
   */
  const menus: Record<string, Array<{ command?: string; label?: string; action?: () => void; divider?: boolean }>> = {
    File: [
      { command: 'workbench.action.tungsten.newProject' },
      { command: 'workbench.action.files.openFolder' },
      { command: 'workbench.action.addRootFolder' },
      { command: 'workbench.action.files.newUntitledFile', divider: true },
      { command: 'workbench.action.quickOpen' },
      { command: 'workbench.action.files.rename' },
      { command: 'workbench.action.files.delete' },
      { command: 'workbench.action.files.save', divider: true },
      { command: 'workbench.action.files.saveAll' },
      { command: 'workbench.action.closeActiveEditor' },
    ],
    Edit: [
      { command: 'workbench.action.showCommands' },
      { command: 'editor.action.startFindReplaceAction' },
      { command: 'workbench.view.search' },
      { command: 'editor.action.formatDocument', divider: true },
      { command: 'editor.action.commentLine' },
      { command: 'editor.action.blockComment' },
      { command: 'editor.action.copyLinesDownAction', divider: true },
      { command: 'editor.action.moveLinesUpAction' },
      { command: 'editor.action.moveLinesDownAction' },
      { command: 'editor.action.deleteLines' },
    ],
    Selection: [
      { label: 'Select All', action: () => runEditorAction('editor.action.selectAll') },
      { command: 'editor.action.smartSelect.expand' },
      { command: 'editor.action.smartSelect.shrink' },
      { command: 'editor.action.insertCursorAbove', divider: true },
      { command: 'editor.action.insertCursorBelow' },
      { command: 'editor.action.addSelectionToNextFindMatch' },
      { command: 'editor.action.selectHighlights' },
    ],
    Go: [
      { command: 'workbench.action.quickOpen' },
      { command: 'workbench.action.gotoSymbol' },
      { command: 'workbench.action.gotoLine' },
      { command: 'editor.action.revealDefinition', divider: true },
      { command: 'editor.action.goToReferences' },
      { command: 'workbench.action.nextEditor', divider: true },
      { command: 'workbench.action.previousEditor' },
      { command: 'workbench.action.reopenClosedEditor' },
    ],
    View: [
      { command: 'workbench.action.selectTheme' },
      { command: 'workbench.action.toggleSidebarVisibility', divider: true },
      { command: 'workbench.action.togglePanel' },
      { command: 'workbench.action.toggleActivityBarVisibility' },
      { command: 'workbench.action.toggleZenMode' },
      { command: 'workbench.action.toggleCenteredLayout' },
      { command: 'workbench.action.splitEditor' },
      { command: 'workbench.action.toggleFullScreen' },
      { command: 'workbench.action.zoomIn', divider: true },
      { command: 'workbench.action.zoomOut' },
      { command: 'workbench.action.zoomReset' },
      { command: 'workbench.action.tungsten.refreshWorkspace', divider: true },
      { command: 'workbench.action.openSettings' },
    ],
    Run: [
      { command: 'workbench.action.tungsten.runProject' },
      { command: debugState.running ? 'workbench.action.debug.stop' : 'workbench.action.debug.start' },
      { command: 'workbench.action.debug.continue', divider: true },
      { command: 'workbench.action.debug.stepOver' },
      { command: 'workbench.action.debug.stepInto' },
      { command: 'workbench.action.debug.stepOut' },
      { command: 'editor.debug.action.toggleBreakpoint', divider: true },
      { command: 'workbench.action.tasks.runTask' },
    ],
    Terminal: [
      { command: 'workbench.action.terminal.new' },
      { command: 'workbench.action.terminal.split' },
      { command: 'workbench.action.terminal.toggleTerminal' },
      { command: 'workbench.action.terminal.clear', divider: true },
      { command: 'workbench.action.terminal.kill' },
    ],
    Help: [
      { command: 'workbench.action.tungsten.welcome' },
      { command: 'workbench.action.openGlobalKeybindings' },
      { command: 'update.checkForUpdate', divider: true },
      { label: 'About Tungsten', action: () => notify(`Tungsten IDE ${APP_VERSION} · ${themes.length} Visual Studio Code themes · ${commands.length} commands`) },
    ],
  }

  return (
    <div className={`ide ${settings.reducedMotion ? 'reduced-motion' : ''} ${settings.highContrast ? 'high-contrast' : ''}`} onClick={() => { if (menuOpen) setMenuOpen(null); if (contextMenu) setContextMenu(null) }}>
      <header className="titlebar">
        <div className="brand-mark" title="Tungsten"><Hammer size={15} strokeWidth={2.4} /></div>
        <button className="menu-mobile"><Menu size={15} /></button>
        <nav className="app-menu" aria-label="Application menu">
          {['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'].map((name) => (
            <div className="menu-wrap" key={name}>
              <button onClick={(event) => { event.stopPropagation(); if (menus[name]) setMenuOpen(menuOpen === name ? null : name) }}>{name}</button>
              {menuOpen === name && menus[name] && <div className="menu-dropdown" onClick={(event) => event.stopPropagation()}>
                {menus[name].map((item, index) => {
                  const command = item.command ? commandsById.get(item.command) : undefined
                  const label = item.label || command?.label.replace(/^[^:]+:\s*/, '') || item.command || ''
                  const enabled = !command?.when || parseWhenClause(command.when).evaluate(whenContext)
                  return (
                    <button
                      key={item.command || item.label}
                      className={`${item.divider && index ? 'with-divider' : ''} ${enabled ? '' : 'disabled'}`}
                      disabled={!enabled}
                      title={command?.detail}
                      onClick={() => {
                        setMenuOpen(null)
                        if (item.action) item.action()
                        else if (item.command) void runCommandById(item.command)
                      }}
                    >
                      <span>{label}</span>
                      <kbd>{item.command ? shortcutFor(item.command) : ''}</kbd>
                    </button>
                  )
                })}
              </div>}
            </div>
          ))}
        </nav>
        <button className="command-center" onClick={() => setPalette({ open: true, mode: 'commands' })}>
          <Search size={12} /><span>{workspaceName} — Tungsten</span><kbd>⌘ K</kbd>
        </button>
        <div className="title-actions">
          <TipButton label={collaborationActive ? `${participants.length} collaborators connected` : 'Live collaboration'} active={collaborationActive} onClick={() => setCollaborationOpen(true)}><UsersRound size={15} /></TipButton><TipButton label="Tungsten Copilot"><Bot size={15} /></TipButton>
          <TipButton label={sidebarVisible ? 'Hide primary sidebar' : 'Show primary sidebar'} active={sidebarVisible} onClick={() => setSidebarVisible((value) => !value)}><PanelLeftClose size={15} /></TipButton>
          <TipButton label={panelOpen ? 'Hide panel' : 'Show panel'} active={panelOpen} onClick={() => setPanelOpen((value) => !value)}><PanelBottomClose size={15} /></TipButton>
          <TipButton label="Toggle side preview" active={sidePreview} onClick={() => setSidePreview((value) => !value)}><Columns2 size={15} /></TipButton>
        </div>
      </header>

      <main className="workbench">
        <aside className="activitybar">
          <div>
            {activityItems.map((item) => {
              const Icon = item.icon
              return <button key={item.id} className={activity === item.id && sidebarVisible ? 'active' : ''} onClick={() => {
                if (item.id === 'source') void refreshGit()
                if (activity === item.id) setSidebarVisible((value) => !value)
                else { setActivity(item.id); setSidebarVisible(true) }
              }} aria-label={item.label} title={item.label}>
                <Icon size={21} strokeWidth={1.65} />
                {item.id === 'source' && sourceChanges.length > 0 && <span className="activity-badge">{sourceChanges.length}</span>}
                {item.id === 'tests' && projectInfo.tests.length > 0 && <span className="activity-badge">{projectInfo.tests.length}</span>}
              </button>
            })}
          </div>
          <div>
            <button aria-label="Accounts" title="Accounts"><CircleUserRound size={20} strokeWidth={1.6} /><span className="presence-dot" /></button>
            <button aria-label="Manage" title="Manage" onClick={() => setSettingsOpen(true)}><Settings size={20} strokeWidth={1.6} /></button>
          </div>
        </aside>

        {sidebarVisible && <aside className="sidebar" style={{ width: sidebarWidth }}>
          {sidebarContent()}
          <div className="resize-handle vertical" onMouseDown={startSidebarResize} />
        </aside>}

        <section className="main-stage">
          <div className="editor-tabs">
            <div className="tab-scroll">
              {openTabs.map((path) => {
                const isPreview = path === PREVIEW_PATH
                return <button key={path} className={`editor-tab ${activePath === path ? 'active' : ''}`} onClick={() => setActivePath(path)}>
                  {isPreview ? <Eye size={14} className="preview-tab-icon" /> : <FileGlyph path={path} />}
                  <span>{isPreview ? 'Preview' : fileName(path)}</span>
                  {dirty.has(path) ? <span className="tab-dirty" /> : <X size={13} className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(path) }} />}
                </button>
              })}
            </div>
            <div className="tab-actions"><TipButton label="Run project" onClick={runProject}><Play size={14} fill="currentColor" /></TipButton><TipButton label="Toggle side preview" active={sidePreview} onClick={() => setSidePreview((value) => !value)}><SplitSquareHorizontal size={14} /></TipButton><TipButton label="More actions" onClick={() => setPalette({ open: true, mode: 'commands' })}><Ellipsis size={15} /></TipButton></div>
          </div>

          {activePath && activePath !== PREVIEW_PATH && <div className="breadcrumbs">
            <span>{workspaceName}</span><ChevronRight size={12} />
            {activePath.split('/').map((part, index, parts) => <span className="crumb" key={`${part}-${index}`}>{index === parts.length - 1 && <FileGlyph path={activePath} />}{part}{index < parts.length - 1 && <ChevronRight size={12} />}</span>)}
            {dirty.has(activePath) && <span className="unsaved-label">UNSAVED</span>}
          </div>}

          <div className="editor-and-panel">
            <div className={`editor-area ${sidePreview && activeFile && activePath !== PREVIEW_PATH ? 'with-side-preview' : ''}`}>
              <Suspense fallback={<div className="editor-loading"><div className="loading-mark"><Hammer size={24} /></div><span>Heating editor core…</span></div>}>
              {activePath === PREVIEW_PATH ? <Preview html={buildPreview()} onReload={() => notify('Preview refreshed')} /> : gitComparison && activePath === gitComparison.virtualPath ? (
                <div className="git-compare-editor">
                  <div className="git-compare-toolbar"><span><GitCompareArrows size={13} /> {gitComparison.path}</span><strong>{gitComparison.conflict ? 'CURRENT ↔ INCOMING' : gitComparison.staged ? 'INDEX ↔ HEAD' : 'WORKTREE ↔ INDEX'}</strong><div>{gitComparison.conflict ? <><button onClick={() => { void resolveGitConflict('ours') }}><Check size={11} />Accept current</button><button onClick={() => { void resolveGitConflict('theirs') }}><Check size={11} />Accept incoming</button><button onClick={() => { void resolveGitConflict('both') }}><Copy size={11} />Accept both</button><button title="Open the marker file for manual editing" onClick={() => openFile(gitComparison.path)}><FileCode2 size={11} />Edit manually</button><button title="Stage the manually edited working file" onClick={() => { void resolveGitConflict('mark') }}><GitCommitHorizontal size={11} />Mark resolved</button></> : gitComparison.hunks.map((hunk, index) => <button key={hunk.id} title={hunk.header} onClick={() => { void stageGitHunk(hunk.patch) }}>{gitComparison.staged ? <Minus size={11} /> : <Plus size={11} />}{gitComparison.staged ? 'Unstage' : 'Stage'} hunk {index + 1}</button>)}</div></div>
                  <DiffEditor height="100%" original={gitComparison.before} modified={gitComparison.after} language={files.find((file) => file.path === gitComparison.path)?.language || 'plaintext'} theme={monacoThemeName(activeTheme)} options={{ readOnly: true, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, fontSize: settings.fontSize, fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace", originalEditable: false, scrollBeyondLastLine: false }} />
                </div>
              ) : activeFile ? (
                <Editor
                  height="100%"
                  path={`file:///${activeFile.path}`}
                  language={activeFile.language}
                  value={activeFile.content}
                  theme={monacoThemeName(activeTheme)}
                  beforeMount={(monaco) => {
                    monacoApi = monaco
                    registerLanguageProviders(monaco)
                    // Register every imported VS Code theme so switching is instant.
                    for (const theme of themes) {
                      monaco.editor.defineTheme(monacoThemeName(theme), {
                        base: theme.base,
                        inherit: true,
                        rules: theme.rules,
                        colors: theme.editor,
                      })
                    }
                    applyMonacoTheme(monaco, activeTheme)
                  }}
                  onChange={updateFile}
                  onMount={(editor) => {
                    setEditorInstance(editor)
                    editor.onDidChangeCursorPosition((event) => setCursor({ line: event.position.lineNumber, column: event.position.column }))
                    // Track focus so `when` clauses like `editorFocus` resolve correctly.
                    editor.onDidFocusEditorText(() => setFocusedSurface('editor'))
                    editor.onDidBlurEditorText(() => setFocusedSurface((current) => current === 'editor' ? 'none' : current))
                    editor.onMouseDown((event: any) => {
                      const breakpointPath = decodeURIComponent(editor.getModel()?.uri.path || '').replace(/^\/+/, '')
                      if (event.target.type === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position && breakpointPath) toggleBreakpointRef.current(breakpointPath, event.target.position.lineNumber)
                    })
                    editor.focus()
                  }}
                  options={{
                    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
                    readOnly: activeFile.language === 'diff',
                    glyphMargin: true,
                    fontSize: settings.fontSize,
                    lineHeight: Math.round(settings.fontSize * 1.62),
                    fontLigatures: true,
                    minimap: { enabled: settings.minimap, maxColumn: 90, renderCharacters: false, scale: 1 },
                    wordWrap: settings.wordWrap ? 'on' : 'off',
                    renderWhitespace: settings.renderWhitespace ? 'selection' : 'none',
                    stickyScroll: { enabled: settings.stickyScroll },
                    padding: { top: 14, bottom: 20 },
                    smoothScrolling: !settings.reducedMotion,
                    cursorSmoothCaretAnimation: settings.reducedMotion ? 'off' : 'on',
                    accessibilitySupport: settings.screenReaderOptimized ? 'on' : 'auto',
                    cursorBlinking: 'smooth',
                    renderLineHighlight: 'all',
                    overviewRulerBorder: false,
                    hideCursorInOverviewRuler: true,
                    bracketPairColorization: { enabled: true },
                    guides: { bracketPairs: true, indentation: true },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                  loading={<div className="editor-loading"><div className="loading-mark"><Hammer size={24} /></div><span>Heating editor core…</span></div>}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-brand"><Hammer size={41} /></div><h2>TUNGSTEN</h2><p>A development environment forged for focus.</p>
                  <div className="dashboard-cards"><button onClick={openDesktopFolder}><FolderOpen size={16} /><span><strong>Local workspace</strong><small>Open a folder on this computer</small></span></button><button onClick={() => setRemoteModal(true)}><SquareCode size={16} /><span><strong>Remote development</strong><small>SSH, containers, and WSL</small></span></button><button onClick={() => setCollaborationOpen(true)}><UsersRound size={16} /><span><strong>Live collaboration</strong><small>Shared editing and review</small></span></button></div>
                  <div className="empty-actions"><button onClick={() => setProjectModal(true)}>New project <kbd>⇧⌘N</kbd></button><button onClick={openDesktopFolder}>Open folder <kbd>⌘O</kbd></button><button onClick={() => setPalette({ open: true, mode: 'files' })}>Quick open <kbd>⌘P</kbd></button><button onClick={openNewFileDialog}>New file <kbd>⌘N</kbd></button><button onClick={runProject}>Run project <kbd>⌃↵</kbd></button></div>
                </div>
              )}
              </Suspense>
              {sidePreview && activeFile && activePath !== PREVIEW_PATH && <div className="side-preview-pane">
                <div className="side-preview-heading"><span><Eye size={12} /> LIVE PREVIEW</span><button title="Close side preview" onClick={() => setSidePreview(false)}><X size={13} /></button></div>
                <div className="side-preview-content"><Preview html={buildPreview()} onReload={() => notify('Preview refreshed')} /></div>
              </div>}
            </div>

            {panelOpen && <section className="bottom-panel" style={{ height: panelHeight }}>
              <div className="resize-handle horizontal" onMouseDown={startPanelResize} />
              <header className="panel-header">
                <nav>{['PROBLEMS', 'OUTPUT', 'DEBUG CONSOLE', 'TERMINAL'].map((tab) => <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>{tab}{tab === 'PROBLEMS' && <span className="tab-count">{problems.length}</span>}</button>)}</nav>
                <div><span className="terminal-name"><TerminalSquare size={13} /> {window.tungsten ? 'pty' : 'sandbox'} <ChevronDown size={11} /></span><TipButton label="New terminal" onClick={() => { if (window.tungsten) newTerminal(); else { setPanelTab('TERMINAL'); setTerminalLines((lines) => [...lines, { text: '— new terminal session —', kind: 'muted' }]); window.setTimeout(() => terminalInputRef.current?.focus(), 20) } }}><Plus size={14} /></TipButton><TipButton label="Split terminal" active={terminalSplit} onClick={() => { if (terminalTabs.length < 2) newTerminal(); setTerminalSplit((value) => !value) }}><Columns2 size={13} /></TipButton><TipButton label="Find in terminal" active={terminalSearchOpen} onClick={() => setTerminalSearchOpen((value) => !value)}><Search size={13} /></TipButton><TipButton label="Restart terminal" onClick={() => { if (window.tungsten) setTerminalTabs((tabs) => tabs.map((terminal) => terminal.id === activeTerminalId ? { ...terminal, generation: terminal.generation + 1 } : terminal)); else setTerminalLines([]) }}><Trash2 size={13} /></TipButton><TipButton label="Maximize panel" onClick={() => setPanelHeight((height) => height > 400 ? 225 : Math.round(window.innerHeight * .62))}><Maximize2 size={13} /></TipButton><TipButton label="Close panel" onClick={() => setPanelOpen(false)}><X size={14} /></TipButton></div>
              </header>
              {panelContent()}
            </section>}
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <div>
          <button title={remoteConnected ? 'Manage remote connection' : 'Open a remote workspace'} className={`remote-status ${remoteConnected ? 'connected' : ''}`} onClick={() => { setRemoteModal(true); void window.tungsten?.remoteProfiles().then(setRemoteProfiles) }}><SquareCode size={13} /><span>{remoteConnected ? 'SSH' : ''}</span></button>
          <button title="Current branch" onClick={() => { setActivity('source'); setSidebarVisible(true); void refreshGit() }}><GitBranch size={13} /><span>{gitInfo.branch || 'main'}{sourceChanges.length ? '*' : ''}</span></button>
          <button title="Refresh source control" onClick={refreshGit}><RefreshCw size={11} /><span>{sourceChanges.length}</span></button>
          <button title={`${problems.length} language diagnostics`} onClick={() => { setPanelOpen(true); setPanelTab('PROBLEMS') }}><X size={12} /><span>{problems.filter((problem) => problem.severity === 1).length}</span><CircleAlert size={12} /><span>{problems.filter((problem) => problem.severity !== 1).length}</span></button>
          {pendingChords.length > 0 && <button className="chord-indicator" title="Waiting for the next key in the sequence"><Keyboard size={12} /><span>({keybindingLabel(pendingChords)}) was pressed. Waiting for second key…</span></button>}
        </div>
        <div>
          <button title={workspaceRoot || 'Tungsten demo workspace'}><Radio size={11} /><span>{workspaceName}</span></button>
          <button title={window.tungsten ? `Desktop app · ${window.tungsten.platform}` : 'Browser workspace'}><Box size={11} /><span>{window.tungsten ? 'Desktop' : 'Web'}</span></button>
          {activePath !== PREVIEW_PATH && <><button title={`Go to line (${shortcutFor('workbench.action.gotoLine')})`} onClick={() => { setPalette({ open: true, mode: 'line' }); setPaletteQuery(':') }}>Ln {cursor.line}, Col {cursor.column}</button><button>Spaces: 2</button><button>UTF-8</button><button>LF</button><button>{activeFile?.language || 'Plain Text'}</button></>}
          <button title={`Color theme: ${activeTheme.label} — click to change`} onClick={() => { setThemePickerOpen(true); setPaletteQuery('') }}><Eye size={12} /><span>{activeTheme.label}</span></button>
          <button title={lspState.message} className={lspState.running ? 'service-running' : ''}><Zap size={12} /><span>{lspState.running ? `${lspState.language} LSP` : 'Syntax'}</span></button>
          <button title={updateState} onClick={() => { if (updateState === 'Restart to update') void window.tungsten?.installUpdate(); else void window.tungsten?.checkForUpdates() }}><Download size={12} /><span>{updateState}</span></button>
          <button title="Notifications"><Bell size={13} /></button>
        </div>
      </footer>

      {palette.open && <div className="overlay palette-overlay" onMouseDown={() => setPalette((current) => ({ ...current, open: false }))}>
        <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
          <div className="palette-input">
            <Command size={17} />
            <input
              ref={paletteInputRef}
              value={paletteQuery}
              onChange={(event) => { setPaletteQuery(event.target.value); setPaletteIndex(0) }}
              placeholder={paletteModePlaceholder}
              aria-label="Quick access"
              aria-activedescendant={paletteItems[paletteIndex] ? `palette-item-${paletteIndex}` : undefined}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex((index) => paletteItems.length ? (index + 1) % paletteItems.length : 0) }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex((index) => paletteItems.length ? (index - 1 + paletteItems.length) % paletteItems.length : 0) }
                else if (event.key === 'Home') { event.preventDefault(); setPaletteIndex(0) }
                else if (event.key === 'End') { event.preventDefault(); setPaletteIndex(Math.max(0, paletteItems.length - 1)) }
                else if (event.key === 'Enter') { event.preventDefault(); const item = paletteItems[paletteIndex]; if (item) executePaletteItem(item) }
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="palette-label">{paletteModeLabel} · {paletteItems.length} result{paletteItems.length === 1 ? '' : 's'}</div>
          <div className="palette-list" role="listbox">
            {paletteItems.slice(0, 100).map((item, index) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  id={`palette-item-${index}`}
                  role="option"
                  aria-selected={index === paletteIndex}
                  ref={index === paletteIndex ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
                  className={index === paletteIndex ? 'selected' : ''}
                  onMouseMove={() => setPaletteIndex(index)}
                  onClick={() => executePaletteItem(item)}
                >
                  <Icon size={16} />
                  <div>
                    <strong><Highlight text={item.label} matches={item.labelMatch} /></strong>
                    <span><Highlight text={item.detail} matches={item.detailMatch} /></span>
                  </div>
                  {item.keybinding ? <div className="shortcut-keys"><kbd>{item.keybinding}</kbd></div> : null}
                </button>
              )
            })}
            {!paletteItems.length && <div className="no-results">No matching {paletteModeLabel.toLowerCase()}</div>}
          </div>
          <footer>
            <span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span>
            <span className="palette-hints"><kbd>&gt;</kbd> commands <kbd>@</kbd> symbols <kbd>:</kbd> line</span>
          </footer>
        </div>
      </div>}

      {themePickerOpen && <div className="overlay palette-overlay" onMouseDown={() => { setThemePickerOpen(false); setThemeId(themeId) }}>
        <div className="command-palette theme-picker" onMouseDown={(event) => event.stopPropagation()}>
          <div className="palette-input">
            <Eye size={17} />
            <input
              autoFocus
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Select a color theme (arrow keys preview instantly)"
              aria-label="Select color theme"
              onKeyDown={(event) => {
                const list = filteredThemes
                if (!list.length) return
                const index = Math.max(0, list.findIndex((theme) => theme.id === themeId))
                if (event.key === 'ArrowDown') { event.preventDefault(); setThemeId(list[(index + 1) % list.length].id) }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setThemeId(list[(index - 1 + list.length) % list.length].id) }
                else if (event.key === 'Enter') { event.preventDefault(); setThemePickerOpen(false); notify(`Color theme: ${getTheme(themeId).label}`) }
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="palette-label">COLOR THEMES · imported from Visual Studio Code</div>
          <div className="palette-list" role="listbox">
            {filteredThemes.map((theme) => (
              <button
                key={theme.id}
                role="option"
                aria-selected={theme.id === themeId}
                className={theme.id === themeId ? 'selected' : ''}
                onMouseEnter={() => setThemeId(theme.id)}
                onClick={() => { setThemeId(theme.id); setThemePickerOpen(false); notify(`Color theme: ${theme.label}`) }}
              >
                <span className="theme-swatch" style={{ background: theme.workbench.background, borderColor: theme.workbench.border }}>
                  <i style={{ background: theme.workbench.accent }} />
                  <i style={{ background: theme.workbench.added }} />
                  <i style={{ background: theme.workbench.error }} />
                </span>
                <div>
                  <strong>{theme.label}</strong>
                  <span>{theme.kind === 'hc-dark' || theme.kind === 'hc-light' ? 'High contrast' : theme.kind === 'light' ? 'Light' : 'Dark'} · {theme.rules.length} token rules</span>
                </div>
                {theme.id === themeId && <Check size={14} />}
              </button>
            ))}
            {!filteredThemes.length && <div className="no-results">No themes match “{paletteQuery}”</div>}
          </div>
          <footer><span><kbd>↑↓</kbd> preview</span><span><kbd>↵</kbd> apply</span><span><kbd>esc</kbd> close</span></footer>
        </div>
      </div>}

      {collaborationOpen && <div className="overlay" onMouseDown={() => setCollaborationOpen(false)}>
        <section className="collaboration-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header><span className="modal-icon"><UsersRound size={18} /></span><div><h2>Live collaboration</h2><p>Shared Yjs editing, presence, review comments, and encrypted-room signaling foundations.</p></div><button onClick={() => setCollaborationOpen(false)}><X size={16} /></button></header>
          <div className="collaboration-connect"><label>Display name<input value={collaborationName} onChange={(event) => setCollaborationName(event.target.value)} /></label><label>Room URL<input value={collaborationUrl} placeholder="ws://host:port/token" onChange={(event) => setCollaborationUrl(event.target.value)} /></label><button onClick={() => { void startCollaboration(false) }}>Host</button><button disabled={!collaborationUrl} onClick={() => { void startCollaboration(true) }}>Join</button></div>
          <div className="collaboration-body"><section><div className="section-heading"><span>PRESENCE</span><span className="count-pill">{participants.length}</span></div>{participants.map((name) => <div className="participant" key={name}><CircleUserRound size={14} /><span>{name}</span><i /></div>)}<button className="voice-foundation" disabled={!collaborationActive} onClick={() => { void window.tungsten?.sendCollaborationEvent({ type: 'signal', name: collaborationName, action: 'voice-ready' }); notify('Voice-room signaling announced; media permission remains under your control') }}><Mic size={13} /> Voice room ready</button></section><section><div className="section-heading"><span>REVIEW COMMENTS</span><span className="count-pill">{comments.length}</span></div><div className="comment-list">{comments.map((comment, index) => <button key={index} onClick={() => { if (comment.path) openFile(comment.path); if (comment.line) window.setTimeout(() => editorInstance?.setPosition({ lineNumber: comment.line!, column: 1 }), 30) }}><strong>{comment.name}</strong><span>{comment.text}</span><small>{comment.path}{comment.line ? `:${comment.line}` : ''}</small></button>)}</div><div className="comment-input"><input value={commentInput} placeholder="Comment on the current line" onChange={(event) => setCommentInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendComment() }} /><button disabled={!collaborationActive} onClick={sendComment}><Plus size={12} /></button></div></section></div>
          <footer>{collaborationActive && <button className="secondary" onClick={() => { void window.tungsten?.leaveCollaboration(); setCollaborationActive(false); setParticipants([]) }}>Leave room</button>}<span /><button className="primary" onClick={() => setCollaborationOpen(false)}>Done</button></footer>
        </section>
      </div>}

      {remoteModal && <div className="overlay" onMouseDown={() => setRemoteModal(false)}>
        <section className="remote-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header><span className="modal-icon"><SquareCode size={18} /></span><div><h2>Remote development</h2><p>Open code and terminals over SSH, WSL, or a development container.</p></div><button onClick={() => setRemoteModal(false)}><X size={16} /></button></header>
          <div className="remote-form"><label>Host<input value={sshConfig.host} placeholder="dev.example.com" onChange={(event) => setSshConfig((config) => ({ ...config, host: event.target.value }))} /></label><label>Port<input value={sshConfig.port} inputMode="numeric" onChange={(event) => setSshConfig((config) => ({ ...config, port: event.target.value }))} /></label><label>Username<input value={sshConfig.username} autoComplete="username" onChange={(event) => setSshConfig((config) => ({ ...config, username: event.target.value }))} /></label><label>Remote folder<input value={sshConfig.root} onChange={(event) => setSshConfig((config) => ({ ...config, root: event.target.value }))} /></label><label>Password (optional)<input type="password" value={sshConfig.password} autoComplete="current-password" onChange={(event) => setSshConfig((config) => ({ ...config, password: event.target.value }))} /></label><label>Private key path (optional)<input value={sshConfig.privateKeyPath} placeholder="~/.ssh/id_ed25519" onChange={(event) => setSshConfig((config) => ({ ...config, privateKeyPath: event.target.value }))} /></label></div>
          <div className="remote-profiles"><div><strong>WSL distributions</strong>{remoteProfiles.wsl.length ? remoteProfiles.wsl.map((distribution) => <button key={distribution} onClick={() => { newTerminal({ kind: 'wsl', id: distribution, label: `WSL: ${distribution}` }); setRemoteModal(false) }}>{distribution}</button>) : <span>No distributions detected</span>}</div><div><strong>Running containers</strong>{remoteProfiles.containers.length ? remoteProfiles.containers.map((container) => <button key={container.id} onClick={() => { newTerminal({ kind: 'container', id: container.id, label: container.name }); setRemoteModal(false) }}>{container.name} · {container.image}</button>) : <span>No containers detected</span>}</div><div><strong>Dev Container</strong><span>{remoteProfiles.devcontainer ? '.devcontainer/devcontainer.json detected; use a running container terminal below.' : 'No configuration in this workspace'}</span></div></div>
          <footer>{remoteConnected && <button className="secondary" onClick={() => { void disconnectRemoteWorkspace() }}>Disconnect</button>}<span /><button className="secondary" onClick={() => setRemoteModal(false)}>Cancel</button><button className="primary" disabled={!sshConfig.host || !sshConfig.username} onClick={() => { void connectRemote() }}>Connect SSH</button></footer>
        </section>
      </div>}

      {projectModal && <div className="overlay" onMouseDown={() => setProjectModal(false)}>
        <section className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header><span className="modal-icon"><Rocket size={18} /></span><div><h2>Forge a new project</h2><p>Start with a clean, portable foundation.</p></div><button onClick={() => setProjectModal(false)}><X size={16} /></button></header>
          <div className="project-form">
            <label>PROJECT NAME<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
            <span className="field-label">TEMPLATE</span>
            <div className="template-grid">
              {[
                ['web', 'Web app', 'HTML, CSS and JavaScript', '<>'],
                ['node', 'Node.js', 'Modern ESM application', 'JS'],
                ['python', 'Python', 'Package with pytest', 'PY'],
                ['rust', 'Rust', 'Cargo binary crate', 'RS'],
                ['go', 'Go', 'Go module and main package', 'GO'],
              ].map(([id, name, detail, icon]) => <button key={id} className={projectTemplate === id ? 'active' : ''} onClick={() => setProjectTemplate(id)}><span>{icon}</span><div><strong>{name}</strong><small>{detail}</small></div>{projectTemplate === id && <Check size={14} />}</button>)}
            </div>
          </div>
          <footer><button onClick={() => setProjectModal(false)}>Cancel</button><button className="primary" disabled={!projectName.trim()} onClick={() => { void createProjectFromTemplate() }}><Rocket size={13} /> Create project</button></footer>
        </section>
      </div>}

      {settingsOpen && <div className="overlay" onMouseDown={() => setSettingsOpen(false)}>
        <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="modal-icon"><Settings size={17} /></span><div><h2>Editor settings</h2><p>Make the forge yours.</p></div></div><button onClick={() => setSettingsOpen(false)}><X size={17} /></button></header>
          <div className="settings-body">
            <div className="settings-profiles"><div><strong>Workspace profiles</strong><span>Apply a focused settings preset.</span></div><button onClick={() => setSettings({ ...defaultSettings })}>Focus</button><button onClick={() => setSettings({ ...defaultSettings, highContrast: true, reducedMotion: true, screenReaderOptimized: true })}>Accessible</button><button onClick={() => setSettings({ ...defaultSettings, fontSize: 17, minimap: false })}>Presentation</button></div>
            <label className="range-setting"><div><strong>Font size</strong><span>Controls the editor text size.</span></div><div><input type="range" min="11" max="19" value={settings.fontSize} onChange={(event) => setSettings({ ...settings, fontSize: Number(event.target.value) })} /><output>{settings.fontSize}px</output></div></label>
            {[
              ['Word wrap', 'Wrap long lines at the editor viewport.', 'wordWrap'],
              ['Minimap', 'Show a compact overview of the active file.', 'minimap'],
              ['Sticky scroll', 'Keep surrounding scopes visible while scrolling.', 'stickyScroll'],
              ['Visible whitespace', 'Reveal spaces and tabs in selected text.', 'renderWhitespace'],
              ['Auto save', 'Save changes after a short delay.', 'autosave'],
              ['Reduced motion', 'Disable non-essential motion and smooth scrolling.', 'reducedMotion'],
              ['High contrast', 'Increase workbench borders and focus visibility.', 'highContrast'],
              ['Screen reader mode', 'Optimize editor accessibility and ARIA output.', 'screenReaderOptimized'],
              ['Product telemetry', 'Share anonymous feature usage; disabled by default.', 'telemetry'],
              ['Crash reports', 'Allow packaged builds to create local crash diagnostics.', 'crashReports'],
            ].map(([title, description, key]) => <label className="toggle-setting" key={key}><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" checked={settings[key as keyof SettingsState] as boolean} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} /><span className="toggle-track"><i /></span></label>)}
            <div className="keybinding-editor"><div><strong>Keyboard shortcuts</strong><span>Search and execute all commands from the palette.</span></div><button onClick={() => { setSettingsOpen(false); setKeybindingsOpen(true) }}>Open keybinding editor <kbd>{shortcutFor('workbench.action.openGlobalKeybindings')}</kbd></button></div>
          </div>
          <footer><button onClick={() => setSettings(defaultSettings)}>Reset defaults</button><button className="primary" onClick={() => setSettingsOpen(false)}>Done</button></footer>
        </section>
      </div>}

      {keybindingsOpen && <div className="overlay" onMouseDown={() => setKeybindingsOpen(false)}>
        <section className="keybindings-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span className="modal-icon"><Keyboard size={17} /></span><div><h2>Keyboard shortcuts</h2><p>Select a command, then press the keys you want. Backspace removes a binding; Escape cancels.</p></div></div>
            <button onClick={() => { setKeybindingsOpen(false); setRecordingCommand(null) }}><X size={17} /></button>
          </header>
          <div className="search-box-wrap keybinding-filter"><Search size={13} /><input autoFocus value={keybindingFilter} onChange={(event) => setKeybindingFilter(event.target.value)} placeholder="Search commands and keybindings" /></div>
          <div className="keybindings-table" role="table">
            <div className="keybindings-head" role="row"><span>Command</span><span>Keybinding</span><span>When</span><span /></div>
            {filteredKeybindings.map(({ command, binding }) => {
              const isRecording = recordingCommand === command.id
              const custom = Object.prototype.hasOwnProperty.call(userKeybindings, command.id)
              return (
                <div className={`keybindings-row ${custom ? 'custom' : ''}`} role="row" key={command.id}>
                  <span className="keybinding-command" title={command.id}>{command.label}</span>
                  <button
                    className={`keybinding-input ${isRecording ? 'recording' : ''}`}
                    onClick={() => setRecordingCommand(isRecording ? null : command.id)}
                    onKeyDown={(event) => {
                      if (!isRecording) return
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') { setRecordingCommand(null); return }
                      if (event.key === 'Backspace' || event.key === 'Delete') {
                        setUserKeybindings((current) => ({ ...current, [command.id]: '' }))
                        setRecordingCommand(null)
                        notify(`${command.label} unbound`)
                        return
                      }
                      const chord = chordFromEvent(event)
                      if (!chord) return
                      const conflicting = keybindingResolver.conflicts(parseKeybinding(chord), whenContext, command.id)
                      setUserKeybindings((current) => ({ ...current, [command.id]: chord }))
                      setRecordingCommand(null)
                      notify(conflicting.length
                        ? `${keybindingLabel(chord)} also runs ${conflicting.length} other command${conflicting.length === 1 ? '' : 's'}`
                        : `${command.label} bound to ${keybindingLabel(chord)}`)
                    }}
                  >
                    {isRecording ? 'Press keys…' : binding ? <kbd>{keybindingLabel(binding.chords)}</kbd> : <em>Unassigned</em>}
                  </button>
                  <span className="keybinding-when">{binding?.when || '—'}</span>
                  <span className="keybinding-actions">
                    {custom && <button title="Restore the default binding" onClick={() => { setUserKeybindings((current) => { const next = { ...current }; delete next[command.id]; return next }); notify(`${command.label} reset`) }}><RotateCcw size={12} /></button>}
                  </span>
                </div>
              )
            })}
            {!filteredKeybindings.length && <div className="no-results">No commands match “{keybindingFilter}”</div>}
          </div>
          <footer>
            <span className="keybinding-count">{Object.keys(userKeybindings).length} customised · {keybindingRules.length} active bindings</span>
            <button onClick={() => { setUserKeybindings({}); notify('Keyboard shortcuts reset to defaults') }}>Reset all</button>
            <button className="primary" onClick={() => { setKeybindingsOpen(false); setRecordingCommand(null) }}>Done</button>
          </footer>
        </section>
      </div>}

      {newFileOpen && <div className="overlay" onMouseDown={() => { setNewFileOpen(false); setRenameTarget(null) }}>
        <section className="new-file-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="new-file-icon"><FileCode2 size={20} /></div><div><h2>{renameTarget ? 'Rename file' : 'Create a new file'}</h2><p>{renameTarget ? 'Change the file name or move it to another folder.' : 'Use a path to place it inside a folder.'}</p></div>
          <label>FILE PATH<input ref={newFileInputRef} value={newFileName} onChange={(event) => setNewFileName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFile() }} placeholder="src/components/button.tsx" /></label>
          <footer><button onClick={() => { setNewFileOpen(false); setRenameTarget(null) }}>Cancel</button><button className="primary" disabled={!newFileName.trim()} onClick={() => { void createFile() }}>{renameTarget ? 'Rename file' : 'Create file'}</button></footer>
        </section>
      </div>}

      {contextMenu && <div
        className="context-menu"
        style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 220) }}
        onClick={(event) => event.stopPropagation()}
      >
        <button onClick={() => { openFile(contextMenu.path); setContextMenu(null) }}><FileCode2 size={14} /><span>Open</span><kbd>Enter</kbd></button>
        <button onClick={() => renameFile(contextMenu.path)}><Braces size={14} /><span>Rename…</span><kbd>F2</kbd></button>
        <button onClick={() => { void navigator.clipboard.writeText(contextMenu.path); setContextMenu(null); notify('Relative path copied') }}><Copy size={14} /><span>Copy relative path</span></button>
        {window.tungsten && <button onClick={() => { void window.tungsten!.revealPath(contextMenu.path); setContextMenu(null) }}><FolderOpen size={14} /><span>Reveal in file manager</span></button>}
        <button className="danger" onClick={() => { void deleteFile(contextMenu.path) }}><Trash2 size={14} /><span>Delete</span></button>
      </div>}

      {toast && <div className="toast"><CircleCheck size={15} /><span>{toast}</span></div>}
    </div>
  )
}
