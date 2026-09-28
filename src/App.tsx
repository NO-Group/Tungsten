import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Archive,
  Blocks,
  Bot,
  BugPlay,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Code2,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Columns2,
  Command,
  Copy,
  CornerDownRight,
  Download,
  Eye,
  File,
  FileCode2,
  FlaskConical,
  Files,
  FolderOpen,
  FileDown,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  Hammer,
  Keyboard,
  Layers,
  ListChecks,
  Maximize2,
  Minus,
  PackagePlus,
  PanelBottomOpen,
  PanelLeftClose,
  Pause,
  Play,
  Puzzle,
  BookOpen,
  FilePlus2,
  Plus,
  Rocket,
  RefreshCw,
  RotateCcw,
  Search,
  Code,
  Replace,
  Settings,
  SquareCode,
  SplitSquareHorizontal,
  StepForward,
  TerminalSquare,
  Trash2,
  Undo2,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import { PREVIEW_PATH, defaultFiles, fileName, languageForPath, supportedLanguages, symbolsFor, type WorkspaceFile } from './workspace'
import { EditorGroup } from './components/EditorGroup'
import { ContextMenu } from './components/ContextMenu'
import { ActivityBar } from './components/ActivityBar'
import { PanelHeader } from './components/panel/PanelHeader'
import { TitleBar, type Menu as AppMenu } from './components/TitleBar'
import { StatusBar } from './components/StatusBar'
import { CommandPalette, type PaletteEntry, type PaletteMode } from './components/dialogs/CommandPalette'
import { ThemePicker } from './components/dialogs/ThemePicker'
import { SettingsEditor } from './components/dialogs/SettingsEditor'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { SnippetsDialog } from './components/dialogs/SnippetsDialog'
import { KeybindingsEditor } from './components/dialogs/KeybindingsEditor'
import { CollaborationDialog } from './components/dialogs/CollaborationDialog'
import { RemoteDialog } from './components/dialogs/RemoteDialog'
import { NewProjectDialog } from './components/dialogs/NewProjectDialog'
import { NewFileDialog } from './components/dialogs/NewFileDialog'
import { defaultSettings } from './settings'
import { ProblemsPanel } from './components/panel/ProblemsPanel'
import { SearchView } from './components/sidebar/SearchView'
import { SourceControlView } from './components/sidebar/SourceControlView'
import { DebugView } from './components/sidebar/DebugView'
import { TestingView } from './components/sidebar/TestingView'
import { ExtensionsView } from './components/sidebar/ExtensionsView'
import { DictionaryView } from './components/sidebar/DictionaryView'
import { ExplorerView } from './components/sidebar/ExplorerView'
import { BlockPalette } from './components/builder/BlockPalette'
import { BuilderView } from './components/builder/BuilderView'
import { useBuilder } from './builder/useBuilder'
import { EXAMPLE_PLUGIN, PLUGIN_DIRECTORY, PLUGIN_SUFFIX, loadPluginBlocks } from './builder/pluginBlocks'
import { createDictionary } from './shell/commandDictionary'
import { explainCommandLine } from './shell/explainShell'
import { DICTIONARY_DIRECTORY, EXAMPLE_COMMAND_FILE, loadWorkspaceCommands } from './shell/workspaceCommands'
import { createSocketBackend, ipcBackend, probeShellServer } from './terminal/ptyClient'
import type { ShellInfo } from './terminal/ptyProtocol'
import type { CompileTarget } from './builder/compile'
import { TerminalPanel } from './components/panel/TerminalPanel'
import {
  type EditorGroupLayout,
  MAX_GROUPS,
  activeEditor as groupActiveEditor,
  activeGroup,
  closeEditor as closeEditorInLayout,
  closeOthers as closeOthersInLayout,
  closeToTheRight as closeToTheRightInLayout,
  createLayout,
  cycleEditorInGroup,
  focusGroupByOffset,
  joinGroups,
  revealPath,
  setGroupEditors,
  splitGroup,
  togglePinned,
} from './editor/editorGroups'
import {
  applyMonacoTheme,
  applyWorkbenchTheme,
  getTheme,
  loadThemeId,
  monacoThemeName,
  saveThemeId,
  themes,
} from './theme/themeService'
import { buildPaletteItems, parsePaletteQuery } from './quickopen/paletteItems'
import { useWorkspaceSearch } from './search/useWorkspaceSearch'
import { builtinSnippets, parseSnippetFile, resolveSnippet, snippetsForLanguage, type Snippet } from './snippets/snippetService'
import type { SnippetVariableContext } from './snippets/snippetVariables'
import { configurationByCategory, configurationSchema, searchConfiguration } from './configuration/configurationRegistry'
import { chordFromEvent, createResolver, keybindingLabel, parseKeybinding, type KeybindingRule } from './keybinding/keybindings'
import defaultKeybindingRules from './keybinding/defaults'
import { parseWhenClause, type Context as WhenContext } from './keybinding/contextkey'
import { useProjectService } from './project/useProjectService'
import { useRemoteWorkspace } from './remote/useRemoteWorkspace'
import { useCollaboration } from './collaboration/useCollaboration'
import { cursorsInFile } from './collaboration/collaborationModel'
import { useDebugSession } from './debug/useDebugSession'
import { workspacePathForSource } from './debug/debugModel'
import { useGitService } from './git/useGitService'
import { registerLanguageProviders } from './languages/monacoLanguageClient'
import { registerSnippetProvider } from './languages/monacoSnippetProvider'
import { useDiagnostics } from './languages/useDiagnostics'
import { useWorkbenchLayout } from './workbench/useWorkbenchLayout'
import { useUserConfiguration } from './configuration/useUserConfiguration'
import { diffEditorOptionsFromConfiguration, editorOptionsFromConfiguration } from './configuration/editorOptions'
import { applySaveActions, saveOptionsFromConfiguration } from './configuration/saveActions'
import { useTerminalSessions } from './terminal/useTerminalSessions'
import { APP_VERSION } from './version'
import './styles.css'

/** Menu bar order, as read left to right. */
const MENU_ORDER = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']

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


const WORKSPACE_KEY = 'tungsten.workspace.v1'
/** User keybinding overrides, keyed by command id. */
const KEYBINDINGS_KEY = 'tungsten.keybindings.v2'
const SNIPPETS_KEY = 'tungsten.snippets.v1'

/** User-authored snippets, persisted as a VS Code-style snippets file per language. */
function loadUserSnippets(): Snippet[] {
  try {
    const raw = window.localStorage.getItem(SNIPPETS_KEY)
    if (!raw) return []
    const byLanguage = JSON.parse(raw) as Record<string, string>
    return Object.entries(byLanguage).flatMap(([languageId, source]) => parseSnippetFile(source, languageId))
  } catch {
    return []
  }
}
let monacoApi: any = null

function loadFiles() {
  try {
    const stored = localStorage.getItem(WORKSPACE_KEY)
    if (stored) return JSON.parse(stored) as WorkspaceFile[]
  } catch {
    // Fall back to the factory workspace.
  }
  return defaultFiles
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

export default function App() {
  const [files, setFiles] = useState<WorkspaceFile[]>(loadFiles)
  const workbench = useWorkbenchLayout()
  const {
    activity, sidebarVisible, setSidebarVisible, sidebarWidth,
    panelOpen, setPanelOpen, panelHeight, panelTab, setPanelTab,
    zenMode, setZenMode, activityBarVisible, setActivityBarVisible,
    centeredLayout, setCenteredLayout, sidePreview, setSidePreview,
    showView, selectActivity, showPanel, togglePanelMaximized,
    startSidebarResize, startPanelResize,
  } = workbench

  const [workspaceName, setWorkspaceName] = useState('forge')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [workspaceRoots, setWorkspaceRoots] = useState<Array<{ name: string; path: string; prefix: string }>>([])
  /**
   * The editor group layout is the single source of truth for what is open.
   *
   * `openTabs` and `activePath` are derived from it rather than stored, so the
   * tab strip, the split panes and every command that reasons about "the
   * active file" can never disagree. The two setters below are compatibility
   * shims that project array-level updates back onto the active group.
   */
  const [layout, setLayout] = useState<EditorGroupLayout>(() => createLayout(['README.md', 'index.html', 'src/main.js']))
  const currentGroup = activeGroup(layout)
  const openTabs = useMemo(() => currentGroup.editors.map((editor) => editor.path), [currentGroup])
  const activePath = groupActiveEditor(layout)?.path ?? ''

  const setActivePath = useCallback((next: string | ((current: string) => string)) => {
    setLayout((current) => {
      const path = typeof next === 'function' ? next(groupActiveEditor(current)?.path ?? '') : next
      return revealPath(current, path)
    })
  }, [])

  const setOpenTabs = useCallback((next: string[] | ((tabs: string[]) => string[])) => {
    setLayout((current) => {
      const group = activeGroup(current)
      const tabs = group.editors.map((editor) => editor.path)
      const resolved = typeof next === 'function' ? next(tabs) : next
      if (resolved === tabs) return current
      return setGroupEditors(current, group.id, resolved)
    })
  }, [])
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: 'commands' })
  const [paletteQuery, setPaletteQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keybindingsOpen, setKeybindingsOpen] = useState(false)
  const [userKeybindings, setUserKeybindings] = useState<Record<string, string>>(loadUserKeybindings)
  const [themeId, setThemeId] = useState<string>(loadThemeId)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  /**
   * The theme that was active when the picker opened.
   *
   * Arrowing through the list applies each theme to the real workbench, so
   * dismissing the picker has to put the original back -- otherwise a glance
   * at the list would silently change the user's theme.
   */
  const themeBeforePickerRef = useRef(themeId)
  const liveThemeIdRef = useRef(themeId)
  useEffect(() => { liveThemeIdRef.current = themeId })
  useEffect(() => {
    if (themePickerOpen) themeBeforePickerRef.current = liveThemeIdRef.current
  }, [themePickerOpen])
  /** Chords entered so far in a multi-chord sequence such as `ctrl+k ctrl+s`. */
  const [pendingChords, setPendingChords] = useState<string[]>([])
  /** Which surface has focus, used for `when` clauses like `terminalFocus`. */
  const [focusedSurface, setFocusedSurface] = useState<'editor' | 'terminal' | 'input' | 'none'>('none')
  /** Recently closed editors, for Reopen Closed Editor. */
  const [closedTabs, setClosedTabs] = useState<string[]>([])
  /** Highlighted row in quick access, driven by the arrow keys. */
  const [paletteIndex, setPaletteIndex] = useState(0)
  /** Command currently capturing keystrokes in the keybinding editor. */
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null)
  const [keybindingFilter, setKeybindingFilter] = useState('')
  const configuration = useUserConfiguration()
  const { settings, setSettings } = configuration
  /** Monaco's options, rebuilt whenever a setting changes. */
  const editorOptions = useMemo(() => ({
    editor: editorOptionsFromConfiguration(configuration.values),
    diff: diffEditorOptionsFromConfiguration(configuration.values),
  }), [configuration.values])
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [userSnippets, setUserSnippets] = useState<Snippet[]>(() => loadUserSnippets())
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false)
  const [settingsEditorQuery, setSettingsEditorQuery] = useState('')
  const [externalChange, setExternalChange] = useState<string | null>(null)
  const [projectModal, setProjectModal] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [projectTemplate, setProjectTemplate] = useState('web')
  const [projectName, setProjectName] = useState('my-tungsten-app')
  const [watchInput, setWatchInput] = useState('')
  const [updateState, setUpdateState] = useState('Up to date')
  const [editorInstance, setEditorInstance] = useState<any>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const restoredWorkspaceRef = useRef(false)
  const toggleBreakpointRef = useRef<(path: string, line: number) => void>(() => undefined)
  // Monaco providers are registered once, so they read live state through refs.
  const snippetsRef = useRef<Snippet[]>(builtinSnippets)
  const snippetContextRef = useRef<SnippetVariableContext>({})
  /** Indirection so the global key listener always calls the latest dispatcher. */
  const runCommandRef = useRef<(id: string) => Promise<boolean>>(async () => false)

  /**
   * Bumped whenever the files on disk may have changed underneath us. Services
   * that mirror the disk -- Git, for now -- watch it instead of every save,
   * refresh and folder-open having to call them.
   */
  const [workingTreeRevision, bumpWorkingTree] = useReducer((revision: number) => revision + 1, 0)

  const activeFile = files.find((file) => file.path === activePath)

  /**
   * A real shell for the browser build.
   *
   * The desktop has Electron's PTY. In a browser, Tungsten asks the dev
   * server whether it is hosting one; when it is, the terminal is bash rather
   * than the emulation, and everything on the machine is runnable.
   */
  const [shellServer, setShellServer] = useState<ShellInfo | null>(null)
  useEffect(() => {
    if (window.tungsten) return
    let cancelled = false
    void probeShellServer().then((info) => { if (!cancelled) setShellServer(info) })
    return () => { cancelled = true }
  }, [])

  const terminalBackend = useMemo(() => {
    if (window.tungsten) return ipcBackend(window.tungsten)
    return shellServer ? createSocketBackend() : null
  }, [shellServer])

  // The shell dictionary, merged with anything the workspace documents in
  // `dictionary/`. One index feeds the sidebar, the terminal and the palette.
  const workspaceCommands = useMemo(() => loadWorkspaceCommands(files), [files])
  const dictionary = useMemo(() => createDictionary(workspaceCommands.entries), [workspaceCommands.entries])

  const terminal = useTerminalSessions({
    workspaceRoot,
    workspaceName,
    files,
    dirty,
    dictionary,
    pty: Boolean(terminalBackend),
    revealTerminal: () => showPanel('TERMINAL'),
  })

  /**
   * What the half-typed prompt means, shown under the input as you type.
   *
   * Only the command word is resolved, so the hint appears on the first
   * keystrokes rather than waiting for a complete line.
   */
  const terminalHint = useMemo(() => {
    const typed = terminal.input.trim()
    if (!typed) return ''
    const entry = dictionary.lookup(typed.split(/\s+/)[0])
    if (!entry) return ''
    const explanation = explainCommandLine(typed, dictionary)
    const flags = explanation.segments[0]?.flags.filter((flag) => flag.known) || []
    return flags.length
      ? `${entry.name} — ${entry.summary} · ${flags.map((flag) => flag.flag).join(' ')}`
      : `${entry.name} — ${entry.summary}`
  }, [dictionary, terminal.input])
  const {
    tabs: terminalTabs, activeId: activeTerminalId, split: terminalSplit,
    searchOpen: terminalSearchOpen, searchQuery: terminalSearchQuery, searchRequest: terminalSearchRequest,
    command: terminalCommand, lines: terminalLines, input: terminalInput, history, historyIndex,
  } = terminal
  const runTerminalCommand = terminal.run
  const runIntegratedCommand = terminal.runTask
  const appendTerminalLine = terminal.appendLine

  /** Every snippet available: builtins plus anything the user has authored. */
  const allSnippets = useMemo(() => [...builtinSnippets, ...userSnippets], [userSnippets])

  /** Snippets applicable to the file currently open. */
  const activeSnippets = useMemo(
    () => snippetsForLanguage(allSnippets, activeFile?.language ?? 'typescript'),
    [allSnippets, activeFile?.language],
  )

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
  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }, [])

  const save = useCallback(async (path?: string) => {
    const targets = path ? [path] : [...dirty]

    // Formatting is Monaco's, and only the focused editor can do it; the text
    // transforms are ours and apply to every file being written.
    if (configuration.values['editor.formatOnSave'] && editorInstance) {
      const formatting = editorInstance.getAction?.('editor.action.formatDocument')
      if (formatting) await formatting.run().catch(() => undefined)
    }
    const saveOptions = saveOptionsFromConfiguration(configuration.values)
    const cleaned = new Map(targets.map((target) => {
      const file = files.find((item) => item.path === target)
      return [target, file ? applySaveActions(file.content, saveOptions) : '']
    }))
    setFiles((current) => current.map((file) => (
      cleaned.has(file.path) && cleaned.get(file.path) !== file.content
        ? { ...file, content: cleaned.get(file.path)! }
        : file
    )))
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
        // The files on disk moved on; Git state follows the revision.
        bumpWorkingTree()
        if (!path) void window.tungsten.clearRecovery()
      }
    }

    try {
      if (window.tungsten && workspaceRoot) {
        await Promise.all(targets.map((target) => {
          const file = files.find((item) => item.path === target)
          return file ? window.tungsten!.writeFile(file.path, cleaned.get(target) ?? file.content) : Promise.resolve({ ok: true as const })
        }))
      } else {
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(
          files.map((file) => (cleaned.has(file.path) ? { ...file, content: cleaned.get(file.path)! } : file)),
        ))
      }
      finishSave()
    } catch (error) {
      notify(`Save failed: ${(error as Error).message}`)
      throw error
    }
  }, [configuration.values, dirty, editorInstance, files, notify, workspaceRoot])

  const openFile = useCallback((path: string) => {
    setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path])
    setActivePath(path)
  }, [setActivePath, setOpenTabs])

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
    bumpWorkingTree()
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
    appendTerminalLine({ text: `${restored ? 'Restored' : 'Opened'} ${result.path} · ${result.files!.length} text files indexed`, kind: 'success' })
    notify(result.truncated ? 'Workspace opened; 4,000-file index limit reached' : `${result.name} ${restored ? 'restored' : 'opened'}`)
  }, [appendTerminalLine, notify, setActivePath, setOpenTabs])

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

  // Monaco is loaded by the first editor that mounts; reading it lazily keeps
  // the diagnostics handler stable enough to subscribe once.
  const getMonaco = useCallback(() => monacoApi, [])
  const diagnostics = useDiagnostics({ activeFile, workspaceRoot, editorInstance, getMonaco })
  const { problems, handleNotification: handleLanguageNotification, handleStatus: handleLanguageStatus } = diagnostics

  const project = useProjectService({
    workspaceRoot,
    revision: workingTreeRevision,
    notify,
    runInTerminal: runIntegratedCommand,
  })
  const { info: projectInfo, tests: discoveredTests, coverage, extensions } = project

  const remote = useRemoteWorkspace({
    notify,
    applyWorkspace: applyDesktopWorkspace,
    clearWorkspace: () => {
      setRemoteConnected(false)
      setWorkspaceRoot('')
      setWorkspaceRoots([])
      setFiles([])
      setOpenTabs([])
      setActivePath('')
    },
  })

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

  /** Close one editor in a specific group. Remembers it for Reopen Closed Editor. */
  const closeTabIn = useCallback((groupId: number, path: string) => {
    if (path && path !== PREVIEW_PATH) setClosedTabs((current) => [...current.filter((tab) => tab !== path), path].slice(-20))
    setLayout((current) => closeEditorInLayout(current, path, groupId))
  }, [])

  const closeTab = useCallback((path: string) => {
    setLayout((current) => {
      if (path && path !== PREVIEW_PATH) setClosedTabs((tabs) => [...tabs.filter((tab) => tab !== path), path].slice(-20))
      return closeEditorInLayout(current, path, current.activeGroupId)
    })
  }, [])

  /** Reopen the most recently closed editor, as Ctrl+Shift+T does in VS Code. */
  const reopenClosedEditor = useCallback(() => {
    setClosedTabs((current) => {
      const path = current[current.length - 1]
      if (!path) return current
      setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path])
      setActivePath(path)
      return current.slice(0, -1)
    })
  }, [setActivePath, setOpenTabs])

  /** Move forward or back through open editors, wrapping at both ends. */
  const cycleEditor = useCallback((offset: number) => {
    setLayout((current) => cycleEditorInGroup(current, offset))
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
  const debug = useDebugSession({
    workspaceRoot,
    launchConfig: files.find((file) => file.path === '.tungsten/launch.json')?.content,
    notify,
    revealDebugView: () => showView('debug'),
  })
  const { breakpoints, watches } = debug
  // Stable across renders, so the adapter subscription below is not torn down
  // and rebuilt every time the session state changes.
  const { handleMessage: handleDebugMessage, handleOutput: handleDebugOutput, handleExit: handleDebugExit } = debug
  const {
    running: debugRunning, output: debugOutput, id: debugSessionId, threadId: debugThreadId,
    threads: debugThreads, frames: debugFrames, scopes: debugScopes, variables: debugVariables, watchValues,
  } = debug.session

  /**
   * Write an edit back to a specific path.
   *
   * Takes the path explicitly rather than reading `activePath`, because with
   * split editors the pane being typed into is not necessarily the active one
   * at the moment the change event fires.
   */
  const updateFileAt = useCallback((path: string, value?: string) => {
    if (!path || value === undefined) return
    setFiles((current) => current.map((file) => (
      file.path === path && file.language !== 'diff' ? { ...file, content: value } : file
    )))
    setDirty((current) => new Set(current).add(path))
  }, [])

  /**
   * The visual builder.
   *
   * It owns its own graph and keeps the generated code beside it; the
   * workbench only decides when it is on screen and where its output goes.
   */
  /**
   * Plugin blocks are scanned out of the workspace on every change, so a
   * block appears in the library the moment its manifest is saved rather
   * than at the next restart.
   */
  const pluginLoad = useMemo(() => loadPluginBlocks(files), [files])

  const builder = useBuilder({ notify, plugins: pluginLoad.blocks })
  const [builderOpen, setBuilderOpen] = useState(false)
  const BUILDER_OUTPUT = 'src/generated/blocks.ts'

  /** Writes generated files into the workspace, replacing what is there. */
  const writeGeneratedFiles = useCallback((written: Array<{ path: string; contents: string }>) => {
    setFiles((current) => {
      const next = [...current]
      for (const file of written) {
        const index = next.findIndex((candidate) => candidate.path === file.path)
        const entry = { path: file.path, content: file.contents, language: languageForPath(file.path) }
        if (index >= 0) next[index] = { ...next[index], ...entry }
        else next.push(entry)
      }
      return next
    })
    setDirty((current) => {
      const next = new Set(current)
      written.forEach((file) => next.add(file.path))
      return next
    })
  }, [])

  /** Writes the generated program into the workspace as an ordinary file. */
  const exportBuilderCode = useCallback((code: string) => {
    setFiles((current) => (current.some((file) => file.path === BUILDER_OUTPUT)
      ? current.map((file) => (file.path === BUILDER_OUTPUT ? { ...file, content: code } : file))
      : [...current, { path: BUILDER_OUTPUT, content: code, language: languageForPath(BUILDER_OUTPUT) }]))
    setDirty((current) => new Set(current).add(BUILDER_OUTPUT))
    setBuilderOpen(false)
    openFile(BUILDER_OUTPUT)
    notify(`Blocks written to ${BUILDER_OUTPUT}`)
  }, [notify, openFile])

  /** Compiles the graph for a target and drops the result in the workspace. */
  const buildBuilderTarget = useCallback((target: CompileTarget) => {
    const result = builder.build(target)
    if (!result.ok) {
      notify(result.reason)
      return
    }
    writeGeneratedFiles(result.files)
    setBuilderOpen(false)
    openFile(result.files[0].path)
    notify(`Built ${result.summary}`)
  }, [builder, notify, openFile, writeGeneratedFiles])

  /** Drops a worked example into `plugins/`, so the SDK has a starting point. */
  const createExamplePlugin = useCallback(() => {
    const path = `${PLUGIN_DIRECTORY}/notify${PLUGIN_SUFFIX}`
    writeGeneratedFiles([{ path, contents: EXAMPLE_PLUGIN }])
    openFile(path)
    notify('Example block plugin added to plugins/')
  }, [notify, openFile, writeGeneratedFiles])

  /** Drops a worked example into `dictionary/`, so a team can document its own. */
  const documentCommand = useCallback(() => {
    writeGeneratedFiles([{ path: EXAMPLE_COMMAND_FILE.path, contents: EXAMPLE_COMMAND_FILE.content }])
    openFile(EXAMPLE_COMMAND_FILE.path)
    notify(`Example command documentation added to ${DICTIONARY_DIRECTORY}/`)
  }, [notify, openFile, writeGeneratedFiles])

  /** Reads whatever is typed at the prompt back in English, in the terminal. */
  const explainTerminalInput = useCallback(() => {
    const line = terminal.input.trim()
    showPanel('terminal')
    if (!line) {
      terminal.appendLine({ text: 'explain: type a command at the prompt first', kind: 'muted' })
      return
    }
    const explanation = explainCommandLine(line, dictionary)
    terminal.appendLine(
      { text: `explain ${line}`, kind: 'command' },
      ...explanation.sentences.map((text) => ({ text, kind: text.startsWith(' ') ? ('muted' as const) : undefined })),
      ...explanation.warnings.map((text) => ({ text: `! ${text}`, kind: 'warning' as const })),
    )
  }, [dictionary, showPanel, terminal])

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
    appendTerminalLine(
      { text: '$ npm run dev', kind: 'command' },
      { text: 'VITE ready in 287 ms  →  tungsten://preview/forge', kind: 'success' },
    )
  }, [appendTerminalLine, notify, openTabs, setActivePath, setOpenTabs])

  const openNewFileDialog = useCallback(() => {
    setRenameTarget(null)
    setNewFileName('')
    setNewFileOpen(true)
  }, [])

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
        bumpWorkingTree()
        notify(`${result.files.length} files refreshed from disk`)
      }
    } catch (error) {
      notify(`Refresh failed: ${(error as Error).message}`)
    }
  }, [activePath, dirty.size, notify, openTabs, setActivePath, setOpenTabs, workspaceRoot])

  const resetWorkspace = useCallback(() => {
    setFiles(defaultFiles)
    setWorkspaceName('forge')
    setWorkspaceRoot('')
    setOpenTabs(['README.md', 'index.html', 'src/main.js'])
    setActivePath('src/main.js')
    setDirty(new Set())
    localStorage.removeItem(WORKSPACE_KEY)
    notify('Workspace restored to defaults')
  }, [notify, setActivePath, setOpenTabs])

  const git = useGitService({
    workspaceRoot,
    revision: workingTreeRevision,
    dirty,
    activeFile,
    notify,
    save,
    refreshWorkspace,
    showDocument: (file) => {
      setFiles((current) => [...current.filter((item) => item.path !== file.path), file])
      openFile(file.path)
    },
    closeDocument: (virtualPath, focusPath) => {
      setOpenTabs((tabs) => tabs.filter((tab) => tab !== virtualPath))
      setActivePath(focusPath)
    },
    reportOutput: (text) => appendTerminalLine({ text, kind: 'success' }),
    clearDirty: () => setDirty(new Set()),
  })
  const {
    status: gitInfo, branches: gitBranches, history: gitHistory, stashes: gitStashes, github: githubItems,
    operation: gitOperation, comparison: gitComparison, view: gitView, setView: setGitView,
    integrateBranch: gitIntegrateBranch, setIntegrateBranch: setGitIntegrateBranch,
    commitMessage, setCommitMessage, sourceChanges, refresh: refreshGit, commit: commitChanges,
    openConflict: openGitConflict, openBlame: openGitBlame,
    stageHunk: stageGitHunk, resolveConflict: resolveGitConflict,
    integrate: integrateGitBranch, finishOperation: finishGitOperation,
  } = git

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
    multipleGroups: layout.groups.length > 1,
    editorGroups: layout.groups.length,
    resourceExtname: activePath.includes('.') ? `.${activePath.split('.').pop()}` : '',
    resourceLangId: activeFile?.language || '',
    dirtyCount: dirty.size,
    isDesktop: Boolean(window.tungsten),
    workspaceOpen: Boolean(workspaceRoot),
    remoteConnected,
    gitRepository: gitInfo.isRepository,
    gitOperation: gitOperation.operation || '',
    debugState: debugRunning ? (debugThreadId ? 'stopped' : 'running') : '',
    quickOpenOpen: palette.open,
    builderOpen,
  }), [activeFile, builderOpen, activePath, activity, debugRunning, debugThreadId, dirty.size, focusedSurface, gitInfo.isRepository, gitOperation.operation, layout.groups.length, openTabs.length, palette.open, panelOpen, panelTab, remoteConnected, sidebarVisible, workspaceRoot, zenMode])

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

  // Stable, so the editor action table below does not change every render.
  const { setOpen: setRemoteOpen } = remote

  const search = useWorkspaceSearch({
    files,
    workspaceRoot,
    notify,
    updateFile: (path, content) => setFiles((current) => current.map((file) => (
      file.path === path ? { ...file, content } : file
    ))),
  })

  const collaboration = useCollaboration({
    activeFile,
    activePath,
    cursor,
    notify,
    applySharedFiles: (merge) => setFiles(merge),
  })
  const { active: collaborationActive, cursors: collaboratorCursors, displayName: collaborationName } = collaboration
  // Stable, so the desktop subscriptions below are not rebuilt as the room changes.
  const { handleEvent: handleRoomEvent, handleDocument: handleRoomDocument, setOpen: setCollaborationOpen } = collaboration

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
      { id: 'workbench.view.explorer', label: 'View: Show Explorer', detail: 'Files and folders', icon: Files, action: () => showView('explorer') },
      { id: 'workbench.view.search', label: 'View: Show Search', detail: 'Search across the workspace', icon: Search, action: () => showView('search') },
      { id: 'workbench.view.scm', label: 'View: Show Source Control', detail: gitInfo.isRepository ? `${sourceChanges.length} changes on ${gitInfo.branch}` : 'No repository detected', icon: GitBranch, action: () => { showView('source'); void refreshGit() } },
      { id: 'workbench.view.debug', label: 'View: Show Run and Debug', detail: 'Breakpoints, call stack and variables', icon: BugPlay, action: () => showView('debug') },
      { id: 'workbench.view.testing', label: 'View: Show Testing', detail: `${discoveredTests.length} tests detected`, icon: FlaskConical, action: () => showView('tests') },
      { id: 'workbench.view.extensions', label: 'View: Show Extensions', detail: `${extensions.length} installed`, icon: Blocks, action: () => showView('extensions') },
      { id: 'workbench.actions.view.problems', label: 'View: Show Problems', detail: `${problems.length} diagnostics`, icon: CircleAlert, action: () => showPanel('PROBLEMS') },
      { id: 'workbench.action.output.toggleOutput', label: 'View: Toggle Output', detail: 'Workbench output channels', icon: ListChecks, action: () => showPanel('OUTPUT') },
      { id: 'workbench.debug.action.toggleRepl', label: 'View: Toggle Debug Console', detail: 'Inspect debug output', icon: Bot, action: () => showPanel('DEBUG CONSOLE') },

      // Layout.
      { id: 'workbench.action.toggleSidebarVisibility', label: 'View: Toggle Primary Side Bar', detail: sidebarVisible ? 'Hide the side bar' : 'Show the side bar', icon: PanelLeftClose, action: () => setSidebarVisible((value) => !value) },
      { id: 'workbench.action.togglePanel', label: 'View: Toggle Panel', detail: panelOpen ? 'Hide the bottom panel' : 'Show the bottom panel', icon: PanelBottomOpen, action: () => setPanelOpen((value) => !value) },
      { id: 'workbench.action.toggleZenMode', label: 'View: Toggle Zen Mode', detail: zenMode ? 'Leave distraction-free editing' : 'Distraction-free editing', icon: Maximize2, action: () => setZenMode((value) => !value) },
      { id: 'workbench.action.toggleActivityBarVisibility', label: 'View: Toggle Activity Bar', detail: activityBarVisible ? 'Hide the activity bar' : 'Show the activity bar', icon: PanelLeftClose, action: () => setActivityBarVisible((value) => !value) },
      { id: 'workbench.action.toggleCenteredLayout', label: 'View: Toggle Centered Layout', detail: centeredLayout ? 'Use the full width' : 'Centre the editor', icon: Columns2, action: () => setCenteredLayout((value) => !value) },
      { id: 'workbench.action.splitEditor', label: 'View: Split Editor Right', detail: layout.groups.length >= MAX_GROUPS ? `At the ${MAX_GROUPS}-group limit` : `${layout.groups.length} group${layout.groups.length === 1 ? '' : 's'} open`, icon: SplitSquareHorizontal, action: () => setLayout((current) => splitGroup(current, 'right', groupActiveEditor(current)?.path)) },
      { id: 'workbench.action.splitEditorDown', label: 'View: Split Editor Down', detail: 'Stack a new group below', icon: SplitSquareHorizontal, action: () => setLayout((current) => splitGroup(current, 'down', groupActiveEditor(current)?.path)) },
      { id: 'workbench.action.joinAllGroups', label: 'View: Join All Editor Groups', detail: `Collapse ${layout.groups.length} groups into one`, icon: SplitSquareHorizontal, when: 'multipleGroups', action: () => setLayout(joinGroups) },
      { id: 'workbench.action.focusNextGroup', label: 'View: Focus Next Editor Group', detail: 'Move focus to the split on the right', icon: ChevronRight, when: 'multipleGroups', action: () => setLayout((current) => focusGroupByOffset(current, 1)) },
      { id: 'workbench.action.focusPreviousGroup', label: 'View: Focus Previous Editor Group', detail: 'Move focus to the split on the left', icon: ChevronRight, when: 'multipleGroups', action: () => setLayout((current) => focusGroupByOffset(current, -1)) },
      { id: 'workbench.action.closeOtherEditors', label: 'View: Close Other Editors in Group', detail: 'Keeps the active and pinned tabs', icon: X, when: 'editorIsOpen', action: () => setLayout((current) => closeOthersInLayout(current, groupActiveEditor(current)?.path ?? '')) },
      { id: 'workbench.action.closeEditorsToTheRight', label: 'View: Close Editors to the Right', detail: 'Close every tab after the active one', icon: X, when: 'editorIsOpen', action: () => setLayout((current) => closeToTheRightInLayout(current, groupActiveEditor(current)?.path ?? '')) },
      { id: 'workbench.action.pinEditor', label: 'View: Toggle Pin Editor', detail: 'Pinned tabs survive Close Others', icon: Check, when: 'editorIsOpen', action: () => setLayout((current) => togglePinned(current, groupActiveEditor(current)?.path ?? '')) },
      { id: 'workbench.action.toggleGroupOrientation', label: 'View: Toggle Editor Group Layout', detail: layout.orientation === 'horizontal' ? 'Switch to stacked' : 'Switch to side-by-side', icon: SplitSquareHorizontal, when: 'multipleGroups', action: () => setLayout((current) => ({ ...current, orientation: current.orientation === 'horizontal' ? 'vertical' : 'horizontal' })) },
      { id: 'builder.open', label: 'Builder: Open Visual Builder', detail: `${builder.graph.nodes.length} blocks on the canvas`, icon: Puzzle, action: () => { setBuilderOpen(true); showView('builder') } },
      { id: 'builder.close', label: 'Builder: Back to the Editor', detail: 'Leave the canvas, keep the graph', icon: Code2, when: 'builderOpen', action: () => setBuilderOpen(false) },
      { id: 'builder.buildWeb', label: 'Builder: Build the Web Bundle', detail: 'index.html, the program, and the UI schema', icon: Hammer, action: () => buildBuilderTarget('web') },
      { id: 'builder.buildMobile', label: 'Builder: Export Mobile Source', detail: 'Flutter widgets and handlers from the same graph', icon: Hammer, action: () => buildBuilderTarget('mobile') },
      { id: 'builder.buildRunner', label: 'Builder: Build the Local Runner', detail: 'A dependency-free server for the built bundle', icon: Rocket, action: () => buildBuilderTarget('node') },
      { id: 'dictionary.open', label: 'Shell Dictionary: Browse Commands', detail: `${dictionary.entries.length} commands, searchable`, icon: BookOpen, action: () => showView('dictionary') },
      { id: 'dictionary.explain', label: 'Shell Dictionary: Explain the Terminal Command', detail: terminal.input.trim() ? terminal.input.trim() : 'Type a command in the terminal first', icon: BookOpen, action: () => explainTerminalInput() },
      { id: 'dictionary.man', label: 'Shell Dictionary: Read a Manual Page in the Terminal', detail: 'man <command>, answered from the dictionary', icon: BookOpen, action: () => { showPanel('terminal'); terminal.setInput('man '); terminal.focusInput() } },
      { id: 'dictionary.document', label: 'Shell Dictionary: Document a Command for This Workspace', detail: `Writes ${EXAMPLE_COMMAND_FILE.path}`, icon: FilePlus2, action: documentCommand },
      { id: 'builder.newPlugin', label: 'Builder: Add an Example Block Plugin', detail: `Writes ${PLUGIN_DIRECTORY}/notify${PLUGIN_SUFFIX}`, icon: PackagePlus, action: createExamplePlugin },
      { id: 'builder.writeFile', label: 'Builder: Write Generated Code to the Workspace', detail: builder.report.compilable ? `Write ${BUILDER_OUTPUT}` : 'Blocked: the graph has errors', icon: FileDown, when: 'builderOpen', action: () => { if (builder.report.compilable) exportBuilderCode(builder.program.code); else notify('Fix the integrity errors first') } },
      { id: 'workbench.action.toggleSidePreview', label: 'View: Toggle Side Preview', detail: sidePreview ? 'Close the live preview pane' : 'Open the live preview pane', icon: Eye, action: () => setSidePreview((value) => !value) },
      { id: 'workbench.action.closeEditorsInGroup', label: 'View: Close All Editors in Group', detail: `${openTabs.length} open`, icon: X, when: 'editorIsOpen', action: () => { openTabs.forEach((path) => closeTab(path)) } },
      // Tungsten uses a single editor group plus an optional side pane rather
      // than VS Code's arbitrary group tree, so the "focus group N" commands
      // map onto the main editor and that side pane.
      { id: 'workbench.action.focusFirstEditorGroup', label: 'View: Focus First Editor Group', detail: 'Focus the main editor', icon: Columns2, action: () => { editorInstance?.focus() } },
      { id: 'workbench.action.focusSecondEditorGroup', label: 'View: Focus Second Editor Group', detail: sidePreview ? 'Focus the side pane' : 'Open and focus the side pane', icon: SplitSquareHorizontal, when: 'editorIsOpen', action: () => { setSidePreview(true) } },
      { id: 'workbench.action.toggleFullScreen', label: 'View: Toggle Full Screen', detail: 'Enter or leave full screen', icon: Maximize2, action: toggleFullScreen },
      { id: 'workbench.action.openSettings', label: 'Preferences: Open Settings', detail: `${Object.keys(configurationSchema).length} settings`, icon: Settings, action: () => { setSettingsEditorQuery(''); setSettingsEditorOpen(true) } },
      { id: 'workbench.action.openSnippets', label: 'Snippets: Browse Snippets', detail: `${activeSnippets.length} for ${activeFile?.language ?? 'this language'}`, icon: Code, action: () => setSnippetsOpen(true) },
      { id: 'workbench.action.insertSnippet', label: 'Snippets: Insert Snippet', detail: 'Pick a snippet to insert', icon: Code, when: 'editorIsOpen', action: () => setSnippetsOpen(true) },
      { id: 'workbench.action.replaceInFiles', label: 'Search: Replace in Files', detail: 'Search and replace across the workspace', icon: Replace, action: () => { showView('search'); search.setShowReplace(true) } },
      { id: 'workbench.action.findInFiles', label: 'Search: Find in Files', detail: 'Full-text search with regex and globs', icon: Search, action: () => showView('search') },
      { id: 'workbench.action.toggleSearchRegex', label: 'Search: Toggle Regular Expression', detail: search.options.isRegex ? 'Currently on' : 'Currently off', icon: Search, action: () => search.toggleOption('isRegex') },
      { id: 'workbench.action.toggleSearchCaseSensitive', label: 'Search: Toggle Match Case', detail: search.options.matchCase ? 'Currently on' : 'Currently off', icon: Search, action: () => search.toggleOption('matchCase') },
      { id: 'workbench.action.toggleSearchWholeWord', label: 'Search: Toggle Whole Word', detail: search.options.wholeWord ? 'Currently on' : 'Currently off', icon: Search, action: () => search.toggleOption('wholeWord') },
      { id: 'workbench.action.zoomIn', label: 'View: Zoom In', detail: `Editor font ${settings.fontSize}px`, icon: Plus, action: () => setSettings((current) => ({ ...current, fontSize: Math.min(28, current.fontSize + 1) })) },
      { id: 'workbench.action.zoomOut', label: 'View: Zoom Out', detail: `Editor font ${settings.fontSize}px`, icon: Minus, action: () => setSettings((current) => ({ ...current, fontSize: Math.max(8, current.fontSize - 1) })) },
      { id: 'workbench.action.zoomReset', label: 'View: Reset Zoom', detail: 'Restore the default font size', icon: RotateCcw, action: () => setSettings((current) => ({ ...current, fontSize: defaultSettings.fontSize })) },

      // Terminal.
      { id: 'workbench.action.terminal.toggleTerminal', label: 'Terminal: Toggle Terminal', detail: 'Show or hide the integrated terminal', icon: TerminalSquare, action: () => { if (panelTab === 'TERMINAL' && panelOpen) setPanelOpen(false); else showPanel('TERMINAL') } },
      { id: 'workbench.action.terminal.new', label: 'Terminal: Create New Terminal', detail: 'Start another shell', icon: Plus, action: () => { if (window.tungsten) terminal.open(); else showPanel('TERMINAL') } },
      { id: 'workbench.action.terminal.split', label: 'Terminal: Split Terminal', detail: terminalSplit ? 'Return to a single pane' : 'Show two terminals side by side', icon: Columns2, action: terminal.toggleSplit },
      { id: 'workbench.action.terminal.kill', label: 'Terminal: Kill Active Terminal', detail: 'Close the focused terminal', icon: Trash2, when: 'isDesktop', action: () => terminal.close(activeTerminalId) },
      { id: 'workbench.action.terminal.clear', label: 'Terminal: Clear', detail: 'Clear the terminal buffer', icon: Trash2, action: terminal.restart },
      { id: 'workbench.action.terminal.focusNext', label: 'Terminal: Focus Next Terminal', detail: `${terminalTabs.length} terminals open`, icon: ChevronRight, when: 'isDesktop', action: () => terminal.focusByOffset(1) },
      { id: 'workbench.action.terminal.focusPrevious', label: 'Terminal: Focus Previous Terminal', detail: `${terminalTabs.length} terminals open`, icon: ChevronRight, when: 'isDesktop', action: () => terminal.focusByOffset(-1) },

      // Run, debug and tasks.
      { id: 'workbench.action.tungsten.runProject', label: 'Run: Open Live Preview', detail: 'Build and run the current workspace', icon: Play, action: runProject },
      { id: 'workbench.action.debug.start', label: 'Debug: Start Debugging', detail: 'Start from .tungsten/launch.json', icon: BugPlay, when: '!debugState', action: () => { void debug.start() } },
      { id: 'workbench.action.debug.stop', label: 'Debug: Stop Debugging', detail: 'Terminate the active session', icon: CircleStop, when: 'debugState', action: () => { void debug.stop() } },
      { id: 'workbench.action.debug.continue', label: 'Debug: Continue', detail: 'Resume execution', icon: Play, when: 'debugState', action: () => { void debug.control('continue') } },
      { id: 'workbench.action.debug.pause', label: 'Debug: Pause', detail: 'Pause the running program', icon: Pause, when: 'debugState', action: () => { void debug.control('pause') } },
      { id: 'workbench.action.debug.stepOver', label: 'Debug: Step Over', detail: 'Run the next statement', icon: StepForward, when: 'debugState', action: () => { void debug.control('next') } },
      { id: 'workbench.action.debug.stepInto', label: 'Debug: Step Into', detail: 'Step into the call', icon: CornerDownRight, when: 'debugState', action: () => { void debug.control('stepIn') } },
      { id: 'workbench.action.debug.stepOut', label: 'Debug: Step Out', detail: 'Finish the current frame', icon: Undo2, when: 'debugState', action: () => { void debug.control('stepOut') } },
      { id: 'workbench.action.debug.restart', label: 'Debug: Restart', detail: 'Restart the debug session', icon: RotateCcw, when: 'debugState', action: () => { void debug.stop().then(() => debug.start()) } },
      { id: 'editor.debug.action.toggleBreakpoint', label: 'Debug: Toggle Breakpoint', detail: activeFile ? `Line ${cursor.line} of ${fileName(activeFile.path)}` : 'No active file', icon: CircleAlert, when: 'editorIsOpen', action: () => { if (activeFile) void debug.toggleBreakpoint(activeFile.path, cursor.line) } },
      { id: 'workbench.action.tasks.runTask', label: 'Task: Run Task', detail: `${projectInfo.tasks.length} tasks detected`, icon: ListChecks, action: () => showView('tests') },

      // Source control.
      { id: 'tungsten.git.refresh', label: 'Git: Refresh', detail: 'Reload status, branches and history', icon: RefreshCw, action: () => { void refreshGit() } },
      { id: 'tungsten.git.commitStaged', label: 'Git: Commit Staged', detail: commitMessage ? commitMessage : 'Enter a commit message first', icon: GitCommitHorizontal, when: 'gitRepository', action: () => { void commitChanges() } },
      { id: 'tungsten.git.blame', label: 'Git: Show Blame for Active File', detail: activeFile?.path || 'No active file', icon: GitCommitHorizontal, when: 'editorIsOpen && gitRepository', action: openGitBlame },
      { id: 'tungsten.git.stash', label: 'Git: Stash Changes', detail: `${sourceChanges.length} changes`, icon: Archive, when: 'gitRepository', action: () => { void git.stash() } },

      // Preferences.
      { id: 'tungsten.action.openQuickSettings', label: 'Preferences: Open Quick Settings', detail: 'Editor and workspace toggles', icon: Settings, action: () => setSettingsOpen(true) },
      { id: 'workbench.action.openGlobalKeybindings', label: 'Preferences: Open Keyboard Shortcuts', detail: `${keybindingRules.length} bindings`, icon: Keyboard, action: () => setKeybindingsOpen(true) },
      { id: 'workbench.action.selectTheme', label: 'Preferences: Color Theme', detail: activeTheme.label, icon: Eye, action: () => { setThemePickerOpen(true); setPaletteQuery('') } },

      // Workspace, remote, extensions.
      { id: 'workbench.action.tungsten.newProject', label: 'Project: New From Template', detail: 'Web, Node.js, Python, Rust or Go', icon: Rocket, action: () => setProjectModal(true) },
      { id: 'workbench.action.addRootFolder', label: 'Workspace: Add Folder to Workspace', detail: `${workspaceRoots.length} roots currently open`, icon: FolderPlus, action: () => { void addWorkspaceFolder() } },
      { id: 'workbench.action.tungsten.refreshWorkspace', label: 'Workspace: Refresh From Disk', detail: 'Reload files changed by other programs', icon: RefreshCw, action: refreshWorkspace },
      { id: 'workbench.action.tungsten.resetWorkspace', label: 'Workspace: Reset Starter', detail: 'Restore all starter files', icon: RotateCcw, action: resetWorkspace },
      { id: 'workbench.action.tungsten.welcome', label: 'Help: Welcome', detail: 'Open the welcome dashboard', icon: Hammer, action: () => setActivePath('') },
      { id: 'workbench.action.remote.connect', label: 'Remote: Connect over SSH', detail: 'Open the remote development dashboard', icon: SquareCode, action: () => { remote.setOpen(true); remote.refreshProfiles() } },
      { id: 'workbench.action.collaboration.open', label: 'Collaboration: Open Live Share', detail: collaborationActive ? `${collaboration.participants.length} participants connected` : 'Host or join a Yjs room', icon: UsersRound, action: () => setCollaborationOpen(true) },
      { id: 'workbench.extensions.action.installFromFolder', label: 'Extensions: Install From Folder', detail: 'Install a declarative Tungsten extension', icon: PackagePlus, action: () => { void project.installExtension() } },
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
  }, [activeFile, activePath, activeTerminalId, activeTheme.label, activityBarVisible, centeredLayout, closedTabs, collaborationActive, commitMessage, cursor.line, debug, dirty.size, editorInstance, discoveredTests.length, extensionCommands, extensions.length, gitInfo.branch, gitInfo.isRepository, keybindingRules.length, notify, openDesktopFolder, openTabs.length, panelOpen, panelTab, collaboration, problems.length, projectInfo.tasks, refreshWorkspace, runEditorAction, runProject, settings.fontSize, settings.minimap, settings.wordWrap, sidebarVisible, sidePreview, sourceChanges.length, symbols.length, terminalSplit, terminalTabs.length, updateState, workspaceRoots.length, zenMode])

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
  const { mode: paletteMode, search: paletteSearch } = useMemo(
    () => parsePaletteQuery(paletteQuery, palette.mode),
    [palette.mode, paletteQuery],
  )

  const paletteItems: PaletteEntry[] = useMemo(() => buildPaletteItems(paletteMode, paletteSearch, {
    commands, files, openTabs, symbols, activeFile, whenContext, shortcutFor,
    icons: { file: FileCode2, symbol: Braces, line: CornerDownRight },
    actions: {
      openFile,
      revealLine,
      gotoLine: (line) => {
        editorInstance?.setPosition({ lineNumber: line, column: 1 })
        editorInstance?.revealLineInCenter(line)
        editorInstance?.focus()
      },
    },
  }), [activeFile, commands, editorInstance, files, openFile, openTabs, paletteMode, paletteSearch, revealLine, shortcutFor, symbols, whenContext])

  // The highlighted row is clamped rather than corrected after the fact, so a
  // shrinking result set can never render a selection that is out of range.
  const selectedPaletteIndex = paletteIndex < paletteItems.length ? paletteIndex : 0

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
  }, [applyDesktopWorkspace])

  useEffect(() => {
    toggleBreakpointRef.current = (path, line) => { void debug.toggleBreakpoint(path, line) }
    snippetsRef.current = allSnippets
    snippetContextRef.current = {
      filePath: activePath,
      languageId: activeFile?.language,
      lineNumber: cursor.line,
      currentLine: activeFile?.content.split('\n')[cursor.line - 1] ?? '',
      indent: ' '.repeat(2),
      workspaceName: workspaceName,
      workspacePath: workspaceRoot ?? '',
    }
  })

  useEffect(() => {
    if (!window.tungsten) return
    const unsubscribeWorkspace = window.tungsten.onWorkspaceFileEvent(({ path }) => setExternalChange(path))
    const unsubscribeRemote = window.tungsten.onRemoteStatus(({ connected, message }) => { setRemoteConnected(connected); notify(message) })
    const unsubscribeCollaborationDocument = window.tungsten.onCollaborationDocument(({ files: sharedFiles }) => handleRoomDocument(sharedFiles))
    const unsubscribeExtension = window.tungsten.onExtensionEvent((message) => { if (message.type === 'error') notify(`${message.extensionId}: ${message.message}`) })
    const unsubscribeCollaborationEvent = window.tungsten.onCollaborationEvent(handleRoomEvent)
    const unsubscribeLanguage = window.tungsten.onLanguageNotification(handleLanguageNotification)
    const unsubscribeStatus = window.tungsten.onLanguageStatus(handleLanguageStatus)
    const unsubscribeDebugMessage = window.tungsten.onDebugMessage(({ id, message }) => handleDebugMessage(id, message))
    const unsubscribeDebugOutput = window.tungsten.onDebugOutput(({ output }) => handleDebugOutput(output))
    const unsubscribeDebugExit = window.tungsten.onDebugExit(({ code }) => handleDebugExit(code))
    const unsubscribeUpdater = window.tungsten.onUpdaterStatus(({ event }) => {
      const labels: Record<string, string> = { 'checking-for-update': 'Checking for updates…', 'update-available': 'Update available', 'update-not-available': 'Up to date', 'download-progress': 'Downloading update…', 'update-downloaded': 'Restart to update', error: 'Update check failed' }
      setUpdateState(labels[event] || event)
      if (event === 'update-available') void window.tungsten?.downloadUpdate()
    })
    return () => { unsubscribeWorkspace(); unsubscribeRemote(); unsubscribeCollaborationDocument(); unsubscribeCollaborationEvent(); unsubscribeExtension(); unsubscribeLanguage(); unsubscribeStatus(); unsubscribeDebugMessage(); unsubscribeDebugOutput(); unsubscribeDebugExit(); unsubscribeUpdater() }
  }, [handleDebugExit, handleDebugMessage, handleDebugOutput, handleLanguageNotification, handleLanguageStatus, handleRoomDocument, handleRoomEvent, notify])

  useEffect(() => {
    if (!window.tungsten || !workspaceRoot || !dirty.size) return
    const timer = window.setTimeout(() => {
      const changedFiles = files.filter((file) => dirty.has(file.path))
      void window.tungsten!.saveRecovery({ workspaceRoot, savedAt: Date.now(), files: changedFiles })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [dirty, files, workspaceRoot])


  useEffect(() => {
    localStorage.setItem(KEYBINDINGS_KEY, JSON.stringify(userKeybindings))
  }, [userKeybindings])

  useEffect(() => {
    if (!editorInstance || !activeFile || activeFile.language === 'diff') return
    const decorations = [
      ...breakpoints.filter((point) => point.path === activeFile.path).map((point) => ({ range: new monacoApi.Range(point.line, 1, point.line, 1), options: { isWholeLine: true, glyphMarginClassName: 'debug-breakpoint-glyph', glyphMarginHoverMessage: { value: point.condition ? `Conditional breakpoint: ${point.condition}` : 'Breakpoint' } } })),
      ...(coverage[activeFile.path] || []).map((entry) => ({ range: new monacoApi.Range(entry.line, 1, entry.line, 1), options: { isWholeLine: true, linesDecorationsClassName: entry.hits > 0 ? 'coverage-hit-line' : 'coverage-miss-line', overviewRuler: { color: entry.hits > 0 ? '#628844' : '#a34e49', position: 1 } } })),
      ...cursorsInFile(collaboratorCursors, activeFile.path).map(([name, point]) => ({ range: new monacoApi.Range(point.line, point.column, point.line, point.column), options: { beforeContentClassName: 'collaboration-cursor', hoverMessage: { value: `${name} is editing here` } } })),
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
        // Dialogs close themselves -- Modal handles Escape and stops the event
        // -- so only the surfaces that are not modal are left here.
        if (pendingChords.length) { setPendingChords([]); return }
        setMenuOpen(null)
        setContextMenu(null)
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

  /** Settings matching the settings-editor search box, grouped by category. */
  const settingsEditorGroups = useMemo(() => {
    const matches = new Set(searchConfiguration(settingsEditorQuery))
    return configurationByCategory()
      .map((group) => ({ ...group, keys: group.keys.filter((key) => matches.has(key)) }))
      .filter((group) => group.keys.length > 0)
  }, [settingsEditorQuery])

  /**
   * Imports a VS Code `*.code-snippets` / `<language>.json` snippet file.
   * The language is taken from the filename, matching VS Code's convention.
   */
  const importSnippetsFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.code-snippets'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const source = await file.text()
      const languageId = file.name.replace(/\.(code-snippets|json)$/, '')
      const parsed = parseSnippetFile(source, languageId === 'global' ? '*' : languageId)
      if (parsed.length === 0) {
        notify('No snippets found in that file')
        return
      }
      setUserSnippets((current) => {
        // Re-importing the same language replaces its previous snippets.
        const next = [...current.filter((snippet) => snippet.languageId !== parsed[0].languageId), ...parsed]
        try {
          const byLanguage: Record<string, string> = JSON.parse(window.localStorage.getItem(SNIPPETS_KEY) ?? '{}')
          byLanguage[parsed[0].languageId] = source
          window.localStorage.setItem(SNIPPETS_KEY, JSON.stringify(byLanguage))
        } catch {
          // Persistence is best-effort; the session still gets the snippets.
        }
        return next
      })
      notify(`Imported ${parsed.length} snippet${parsed.length === 1 ? '' : 's'} for ${parsed[0].languageId}`)
    }
    input.click()
  }, [notify])

  /**
   * The bottom panel. Each tab is its own component; this only routes.
   */
  const panelContent = () => {
    if (panelTab === 'PROBLEMS') return (
      <ProblemsPanel
        groups={diagnostics.groups}
        totalCount={problems.length}
        filter={diagnostics.filter}
        onFilterChange={diagnostics.setFilter}
        severities={diagnostics.severities}
        onToggleSeverity={(severity) => diagnostics.setSeverities((current) => current ^ severity)}
        onReveal={(resource, line, column) => {
          openFile(resource)
          if (!line) return
          editorInstance?.setPosition({ lineNumber: line, column: column ?? 1 })
          editorInstance?.revealLineInCenter(line)
        }}
      />
    )
    if (panelTab === 'OUTPUT') return (
      <div className="output-panel"><span>[Tungsten]</span> Workspace index ready · {files.length} files<br /><span>[Project]</span> {projectInfo.frameworks.join(', ') || 'No framework detected'}<br /><span>[Language]</span> {diagnostics.status.message}<br /><span>[Git]</span> {gitInfo.isRepository ? `Watching ${gitInfo.branch}` : 'No repository detected'}</div>
    )
    if (panelTab === 'DEBUG CONSOLE') return (
      <div className="debug-console-output">{debugOutput.length ? debugOutput.map((line, index) => <div key={index}>{line}</div>) : <div className="empty-panel"><Bot size={24} /><strong>Debug console is ready</strong><span>Start a debug session to inspect values.</span></div>}</div>
    )
    return (
      <TerminalPanel
        desktop={Boolean(terminalBackend)}
        backend={terminalBackend}
        tabs={terminalTabs}
        activeId={activeTerminalId}
        split={terminalSplit}
        profiles={remote.profiles}
        command={terminalCommand}
        searchOpen={terminalSearchOpen}
        searchQuery={terminalSearchQuery}
        searchRequest={terminalSearchRequest}
        themeId={activeTheme.id}
        fontSize={Math.max(9, settings.fontSize - 1)}
        onSelectTab={terminal.focus}
        onCloseTab={terminal.close}
        onNewTerminal={terminal.open}
        onSearchQueryChange={terminal.setSearchQuery}
        onSearchSubmit={terminal.search}
        onCloseSearch={() => terminal.setSearchOpen(false)}
        onFocusChange={(focused) => setFocusedSurface((current) => focused ? 'terminal' : current === 'terminal' ? 'none' : current)}
        lines={terminalLines}
        input={terminalInput}
        onInputChange={terminal.setInput}
        onRun={runTerminalCommand}
        history={history}
        historyIndex={historyIndex}
        hint={terminalHint}
        onHistoryIndexChange={terminal.setHistoryIndex}
        workspaceName={workspaceName}
        inputRef={terminal.inputRef}
        endRef={terminalEndRef}
      />
    )
  }

  /**
   * The sidebar. Each activity has its own view component; this only routes to
   * one and supplies it with workbench state and callbacks.
   */
  const sidebarContent = () => {
    if (activity === 'search') return (
      <SearchView
        query={search.query}
        replace={search.replace}
        showReplace={search.showReplace}
        showDetails={search.showDetails}
        includes={search.includes}
        excludes={search.excludes}
        options={search.options}
        regexError={search.regexError}
        searching={search.searching}
        results={search.results}
        matchCount={search.matchCount}
        limitHit={search.limitHit}
        onQueryChange={search.setQuery}
        onReplaceChange={search.setReplace}
        onToggleReplace={() => search.setShowReplace(!search.showReplace)}
        onToggleDetails={() => search.setShowDetails(!search.showDetails)}
        onIncludesChange={search.setIncludes}
        onExcludesChange={search.setExcludes}
        onOptionsChange={search.setOptions}
        onReplaceAll={() => { void search.replaceAll() }}
        onOpenResult={(path, line, column) => {
          openFile(path)
          setCursor({ line, column })
          // The editor for a freshly opened file mounts on the next frame, so
          // the reveal has to wait for it.
          window.setTimeout(() => {
            editorInstance?.setPosition({ lineNumber: line, column })
            editorInstance?.revealLineInCenter(line)
          }, 30)
        }}
      />
    )
    if (activity === 'source') return (
      <SourceControlView
        desktop={Boolean(window.tungsten)}
        view={gitView}
        branch={gitInfo.branch}
        branches={gitBranches}
        isRepository={gitInfo.isRepository}
        error={gitInfo.error}
        operation={gitOperation}
        integrateBranch={gitIntegrateBranch}
        commitMessage={commitMessage}
        changes={sourceChanges}
        history={gitHistory}
        stashes={gitStashes}
        github={githubItems}
        onViewChange={setGitView}
        onCheckoutBranch={(branch) => { void git.checkout(branch) }}
        onOpenConflict={(path) => { void openGitConflict(path) }}
        onFinishOperation={(mode) => { void finishGitOperation(mode) }}
        onIntegrateBranchChange={setGitIntegrateBranch}
        onIntegrate={(mode) => { void integrateGitBranch(mode) }}
        onCommitMessageChange={setCommitMessage}
        onCommit={() => { void commitChanges() }}
        onRefresh={refreshGit}
        onOpenChange={(change) => {
          // Without a repository there is nothing to diff against, so the
          // browser demo just opens the file itself.
          if (!window.tungsten) {
            if (files.some((file) => file.path === change.path)) openFile(change.path)
            return
          }
          git.openChange(change)
        }}
        onStageChange={(change) => { void git.stageFile(change) }}
        onStash={() => { void git.stash() }}
        onPopStash={(reference) => { void git.popStash(reference) }}
        onOpenExternal={(url) => { void window.tungsten?.openExternal(url) }}
      />
    )
    if (activity === 'debug') return (
      <DebugView
        running={debugRunning}
        sessionId={debugSessionId}
        output={debugOutput}
        hasLaunchConfig={files.some((file) => file.path === '.tungsten/launch.json')}
        threads={debugThreads}
        frames={debugFrames}
        scopes={debugScopes}
        variables={debugVariables}
        watches={watches}
        watchInput={watchInput}
        watchValues={watchValues}
        breakpoints={breakpoints}
        canAddBreakpoint={Boolean(activeFile)}
        shortcutFor={shortcutFor}
        onStart={() => { void debug.start() }}
        onStop={() => { void debug.stop() }}
        onControl={(command) => { void debug.control(command) }}
        onSelectThread={debug.selectThread}
        onSelectFrame={(frame) => {
          // A frame reports the adapter's own absolute path; open the buffer
          // it corresponds to, if the workspace has one.
          const path = workspacePathForSource(frame.source, workspaceRoot, files.map((file) => file.path))
          if (path) {
            openFile(path)
            window.setTimeout(() => {
              editorInstance?.setPosition({ lineNumber: frame.line, column: 1 })
              editorInstance?.revealLineInCenter(frame.line)
            }, 30)
          }
          debug.selectFrame(frame.id)
        }}
        onWatchInputChange={setWatchInput}
        onAddWatch={() => { debug.addWatch(watchInput); setWatchInput('') }}
        onRemoveWatch={debug.removeWatch}
        onAddBreakpoint={() => { if (activeFile) void debug.toggleBreakpoint(activeFile.path, cursor.line) }}
        onEditBreakpointCondition={(path, line) => {
          const point = breakpoints.find((breakpoint) => breakpoint.path === path && breakpoint.line === line)
          const condition = window.prompt('Breakpoint condition (leave empty for unconditional)', point?.condition || '') ?? point?.condition
          void debug.setBreakpointCondition(path, line, condition)
        }}
        onRemoveBreakpoint={(path, line) => { void debug.toggleBreakpoint(path, line) }}
        onRevealBreakpoint={(path, line) => {
          openFile(path)
          setCursor({ line, column: 1 })
          editorInstance?.revealLineInCenter(line)
          editorInstance?.setPosition({ lineNumber: line, column: 1 })
        }}
      />
    )
    if (activity === 'tests') return (
      <TestingView
        frameworks={projectInfo.frameworks}
        testProfiles={projectInfo.tests}
        tasks={projectInfo.tasks}
        discovered={discoveredTests}
        results={project.results}
        activeResult={project.activeResult}
        coverageFileCount={Object.keys(coverage).length}
        onRefresh={project.refresh}
        onRunTask={runIntegratedCommand}
        onOpenTest={(test) => {
          project.setActiveResult(test.id)
          openFile(test.path)
          window.setTimeout(() => {
            editorInstance?.setPosition({ lineNumber: test.line, column: 1 })
            editorInstance?.revealLineInCenter(test.line)
          }, 30)
        }}
        onRunTest={(id) => { void project.runTest(id) }}
        onDebugTest={(test) => {
          runIntegratedCommand(test.command)
          notify('Test command started in a dedicated terminal; attach a launch configuration to debug')
        }}
      />
    )
    if (activity === 'extensions') return (
      <ExtensionsView
        extensions={extensions}
        languageCount={supportedLanguages.length}
        onInstall={() => { void project.installExtension() }}
        onToggleEnabled={(extension) => project.setExtensionEnabled(extension.id, extension.enabled === false)}
        onUninstall={project.uninstallExtension}
        onAddBlockPlugin={createExamplePlugin}
        onDocumentCommand={documentCommand}
      />
    )
    if (activity === 'dictionary') return (
      <DictionaryView
        dictionary={dictionary}
        contributed={workspaceCommands.entries.length}
        problems={workspaceCommands.problems}
        onRun={(command) => { showPanel('terminal'); terminal.run(command) }}
        onDocumentCommand={documentCommand}
      />
    )
    if (activity === 'builder') return (
      <BlockPalette
        registry={builder.registry}
        pluginCount={pluginLoad.blocks.length}
        pluginProblems={pluginLoad.problems}
        disabled={Boolean(builder.parseError)}
        onAdd={(type) => { setBuilderOpen(true); builder.addBlock(type) }}
        onAddExamplePlugin={createExamplePlugin}
      />
    )
    return (
      <ExplorerView
        workspaceName={workspaceName}
        externalChange={externalChange}
        roots={workspaceRoots}
        files={files}
        activePath={activePath}
        dirty={dirty}
        symbols={symbols}
        cursorLine={cursor.line}
        hasActiveFile={Boolean(activeFile)}
        onOpenFolder={openDesktopFolder}
        onAddRoot={() => { void addWorkspaceFolder() }}
        onRemoveRoot={(prefix) => { void removeWorkspaceFolder(prefix) }}
        onRefresh={() => { setExternalChange(null); void refreshWorkspace() }}
        onNewFile={openNewFileDialog}
        onOpenFile={openFile}
        onFileContext={(event, path) => {
          event.preventDefault()
          setContextMenu({ x: event.clientX, y: event.clientY, path })
        }}
        onRevealLine={revealLine}
      />
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
      { command: 'tungsten.action.openQuickSettings' },
      { command: 'workbench.action.openSnippets' },
    ],
    Run: [
      { command: 'workbench.action.tungsten.runProject' },
      { command: debugRunning ? 'workbench.action.debug.stop' : 'workbench.action.debug.start' },
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

  /**
   * The menu bar, resolved against the command table.
   *
   * Each entry is reduced to what the title bar needs -- a label, a keystroke
   * and whether it is currently allowed -- so menu state and command state can
   * never drift apart. The order is fixed here rather than taken from the
   * object above, because that is the order people expect to read.
   */
  const menuBar: AppMenu[] = MENU_ORDER.filter((name) => menus[name]).map((name) => ({
    name,
    entries: menus[name].map((item) => {
      const command = item.command ? commandsById.get(item.command) : undefined
      return {
        id: item.command || item.label || name,
        // Palette labels are prefixed with their category ("File: Save"), which
        // is redundant once the entry is sitting under the File menu.
        label: item.label || command?.label.replace(/^[^:]+:\s*/, '') || item.command || '',
        shortcut: item.command ? shortcutFor(item.command) : '',
        detail: command?.detail,
        enabled: !command?.when || parseWhenClause(command.when).evaluate(whenContext),
        divider: item.divider,
        run: () => {
          if (item.action) item.action()
          else if (item.command) void runCommandById(item.command)
        },
      }
    }),
  }))




  /**
   * Monaco wiring handed to every editor group.
   *
   * `register` runs on each editor mount and is idempotent: providers and
   * themes are keyed by language/name, so re-registering them when a second
   * split opens is harmless. `api` exposes the live namespace for the gutter
   * click handler, which has to compare against Monaco's MouseTargetType.
   */
  const monacoBridge = useMemo(() => ({
    register: (instance: unknown) => {
      const monaco = instance as any
      monacoApi = monaco
      registerLanguageProviders(monaco)
      registerSnippetProvider(monaco, () => snippetsRef.current, () => snippetContextRef.current)
      // Register every theme up front so switching is instant.
      for (const theme of themes) {
        monaco.editor.defineTheme(monacoThemeName(theme), {
          base: theme.base,
          inherit: true,
          rules: theme.rules,
          colors: theme.editor,
        })
      }
      applyMonacoTheme(monaco, activeTheme)
    },
    api: () => monacoApi,
  }), [activeTheme])

  /**
   * Everything an editor group can ask the workbench to do.
   *
   * Groups are presentational: they never touch application state directly,
   * they report intent through here. That is what lets four of them coexist
   * without fighting over who owns the layout.
   */
  const editorActions = useMemo(() => ({
    setLayout,
    closeTab: closeTabIn,
    updateFile: updateFileAt,
    openFile,
    notify,
    setEditorInstance,
    setCursor,
    setFocusedSurface: setFocusedSurface as (next: string | ((current: string) => string)) => void,
    toggleBreakpoint: (path: string, line: number) => toggleBreakpointRef.current(path, line),
    buildPreview,
    setSidePreview,
    runProject,
    openCommandPalette: (mode: 'commands' | 'files') => setPalette({ open: true, mode }),
    resolveGitConflict,
    stageGitHunk,
    openDesktopFolder,
    openNewFileDialog,
    openRemoteDialog: () => setRemoteOpen(true),
    openCollaborationDialog: () => setCollaborationOpen(true),
    openProjectDialog: () => setProjectModal(true),
  }), [buildPreview, closeTabIn, notify, openDesktopFolder, openFile, openNewFileDialog, resolveGitConflict, runProject, setCollaborationOpen, setRemoteOpen, setSidePreview, stageGitHunk, updateFileAt])


  return (
    <div className={`ide ${zenMode ? 'zen-mode' : ''} ${centeredLayout ? 'centered-layout' : ''} ${settings.reducedMotion ? 'reduced-motion' : ''} ${settings.highContrast ? 'high-contrast' : ''}`} onClick={() => { if (menuOpen) setMenuOpen(null); if (contextMenu) setContextMenu(null) }}>
      {!zenMode && <TitleBar
        title={`${workspaceName} — Tungsten`}
        menus={menuBar}
        openMenu={menuOpen}
        onOpenMenuChange={setMenuOpen}
        onOpenCommandCentre={() => setPalette({ open: true, mode: 'commands' })}
        collaborationActive={collaborationActive}
        participantCount={collaboration.participants.length}
        onOpenCollaboration={() => setCollaborationOpen(true)}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        sidePreview={sidePreview}
        onToggleSidePreview={() => setSidePreview((value) => !value)}
      />}

      <main className="workbench">
        {activityBarVisible && !zenMode && <ActivityBar
          active={activity}
          sidebarVisible={sidebarVisible}
          badges={{ source: sourceChanges.length, tests: projectInfo.tests.length }}
          onSelect={(id) => {
            if (id === 'source') void refreshGit()
            if (id === 'builder') setBuilderOpen(true)
            selectActivity(id)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />}

        {sidebarVisible && !zenMode && <aside className="sidebar" style={{ width: sidebarWidth }}>
          {sidebarContent()}
          <div className="resize-handle vertical" onMouseDown={startSidebarResize} />
        </aside>}

        <section className="main-stage">
          <div className="editor-and-panel">
            {builderOpen ? (
              <BuilderView
                builder={builder}
                editorOptions={editorOptions.editor}
                theme={monacoThemeName(activeTheme)}
                onExport={exportBuilderCode}
                onBuild={buildBuilderTarget}
                onClose={() => setBuilderOpen(false)}
              />
            ) : (
              <div className={`editor-groups ${layout.orientation}`}>
                {layout.groups.map((group) => (
                  <EditorGroup
                    key={group.id}
                    group={group}
                    layout={layout}
                    files={files}
                    dirty={dirty}
                    settings={editorOptions}
                    theme={activeTheme}
                    workspaceName={workspaceName}
                    gitComparison={gitComparison}
                    sidePreview={sidePreview}
                    monaco={monacoBridge}
                    actions={editorActions}
                  />
                ))}
              </div>
            )}

            {panelOpen && !zenMode && <section className="bottom-panel" style={{ height: panelHeight }}>
              <div className="resize-handle horizontal" onMouseDown={startPanelResize} />
              <PanelHeader
                activeTab={panelTab}
                onSelectTab={setPanelTab}
                problemCount={problems.length}
                terminalKind={terminalBackend ? 'pty' : 'sandbox'}
                onNewTerminal={() => {
                  if (window.tungsten) return void terminal.open()
                  // The emulated shell has a single buffer, so a "new
                  // terminal" is a rule in the scrollback and a focused input.
                  setPanelTab('TERMINAL')
                  terminal.appendLine({ text: '— new terminal session —', kind: 'muted' })
                  terminal.focusInput()
                }}
                splitActive={terminalSplit}
                onToggleSplit={terminal.toggleSplit}
                searchActive={terminalSearchOpen}
                onToggleSearch={() => terminal.setSearchOpen(!terminalSearchOpen)}
                onRestartTerminal={terminal.restart}
                onMaximize={togglePanelMaximized}
                onClose={() => setPanelOpen(false)}
              />
              {panelContent()}
            </section>}
          </div>
        </section>
      </main>

      {!zenMode && <StatusBar
        remoteConnected={remoteConnected}
        onOpenRemote={() => { remote.setOpen(true); remote.refreshProfiles() }}
        branch={gitInfo.branch}
        changeCount={sourceChanges.length}
        onOpenSourceControl={() => { showView('source'); void refreshGit() }}
        onRefreshGit={refreshGit}
        errorCount={diagnostics.counts.errors}
        warningCount={diagnostics.counts.warnings}
        onOpenProblems={() => showPanel('PROBLEMS')}
        pendingChord={pendingChords.length ? keybindingLabel(pendingChords) : ''}
        workspaceName={workspaceName}
        workspaceRoot={workspaceRoot}
        platform={window.tungsten?.platform ?? ''}
        showEditorStatus={activePath !== PREVIEW_PATH}
        cursor={cursor}
        language={activeFile?.language ?? ''}
        gotoLineShortcut={shortcutFor('workbench.action.gotoLine')}
        onGotoLine={() => { setPalette({ open: true, mode: 'line' }); setPaletteQuery(':') }}
        themeLabel={activeTheme.label}
        onPickTheme={() => { setThemePickerOpen(true); setPaletteQuery('') }}
        lsp={diagnostics.status}
        updateState={updateState}
        onUpdate={() => {
          if (updateState === 'Restart to update') void window.tungsten?.installUpdate()
          else void window.tungsten?.checkForUpdates()
        }}
      />}

      {palette.open && (
        <CommandPalette
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          items={paletteItems}
          index={selectedPaletteIndex}
          onIndexChange={setPaletteIndex}
          modeLabel={paletteModeLabel}
          placeholder={paletteModePlaceholder}
          onRun={executePaletteItem}
          onClose={() => setPalette((current) => ({ ...current, open: false }))}
        />
      )}

      {settingsEditorOpen && (
        <SettingsEditor
          query={settingsEditorQuery}
          onQueryChange={setSettingsEditorQuery}
          groups={settingsEditorGroups}
          schema={configurationSchema}
          values={configuration.values}
          modified={configuration.modified}
          onChange={configuration.set}
          onReset={configuration.reset}
          onClose={() => setSettingsEditorOpen(false)}
        />
      )}

      {snippetsOpen && (
        <SnippetsDialog
          snippets={activeSnippets}
          languageId={activeFile?.language}
          hasUserSnippets={userSnippets.length > 0}
          preview={(snippet) => resolveSnippet(snippet.body, {
            ...snippetContextRef.current,
            languageId: snippet.languageId === '*' ? activeFile?.language : snippet.languageId,
          }).text}
          onInsert={(snippet) => {
            if (!editorInstance) return
            // Let Monaco's snippet controller run the body so tabstops work.
            const contribution = editorInstance.getContribution('snippetController2')
            editorInstance.focus()
            if (contribution?.insert) contribution.insert(snippet.body)
            else editorInstance.trigger('tungsten', 'type', { text: resolveSnippet(snippet.body, snippetContextRef.current).text })
            setSnippetsOpen(false)
            notify(`Inserted ${snippet.name}`)
          }}
          onImport={importSnippetsFile}
          onClearUserSnippets={() => {
            setUserSnippets([])
            window.localStorage.removeItem(SNIPPETS_KEY)
            notify('Removed user snippets')
          }}
          onClose={() => setSnippetsOpen(false)}
        />
      )}

      {themePickerOpen && (
        <ThemePicker
          themes={filteredThemes}
          activeId={themeId}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          onPreview={setThemeId}
          onApply={(theme) => { setThemeId(theme.id); setThemePickerOpen(false); notify(`Color theme: ${theme.label}`) }}
          onCancel={() => { setThemePickerOpen(false); setThemeId(themeBeforePickerRef.current) }}
        />
      )}

      {collaboration.open && (
        <CollaborationDialog
          displayName={collaborationName}
          onDisplayNameChange={collaboration.setDisplayName}
          roomUrl={collaboration.roomUrl}
          onRoomUrlChange={collaboration.setRoomUrl}
          active={collaborationActive}
          participants={collaboration.participants}
          comments={collaboration.comments}
          commentInput={collaboration.commentInput}
          onCommentInputChange={collaboration.setCommentInput}
          onHost={() => { void collaboration.host() }}
          onJoin={() => { void collaboration.join() }}
          onLeave={collaboration.leave}
          onSendComment={collaboration.sendComment}
          onOpenComment={(comment) => {
            if (comment.path) openFile(comment.path)
            if (comment.line) window.setTimeout(() => editorInstance?.setPosition({ lineNumber: comment.line!, column: 1 }), 30)
          }}
          onAnnounceVoice={collaboration.announceVoice}
          onClose={() => setCollaborationOpen(false)}
        />
      )}

      {remote.open && (
        <RemoteDialog
          config={remote.config}
          onConfigChange={remote.setConfig}
          profiles={remote.profiles}
          connected={remoteConnected}
          onConnect={() => { void remote.connect() }}
          onDisconnect={() => { void remote.disconnect() }}
          onOpenWsl={(distribution) => {
            terminal.open({ kind: 'wsl', id: distribution, label: `WSL: ${distribution}` })
            remote.setOpen(false)
          }}
          onOpenContainer={(container) => {
            terminal.open({ kind: 'container', id: container.id, label: container.name })
            remote.setOpen(false)
          }}
          onClose={() => remote.setOpen(false)}
        />
      )}

      {projectModal && (
        <NewProjectDialog
          name={projectName}
          onNameChange={setProjectName}
          template={projectTemplate}
          onTemplateChange={setProjectTemplate}
          onCreate={() => { void createProjectFromTemplate() }}
          onClose={() => setProjectModal(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          keybindingShortcut={shortcutFor('workbench.action.openGlobalKeybindings')}
          onOpenKeybindings={() => { setSettingsOpen(false); setKeybindingsOpen(true) }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {keybindingsOpen && (
        <KeybindingsEditor
          rows={filteredKeybindings}
          filter={keybindingFilter}
          onFilterChange={setKeybindingFilter}
          recording={recordingCommand}
          onRecordingChange={setRecordingCommand}
          customised={Object.keys(userKeybindings)}
          activeBindingCount={keybindingRules.length}
          onBind={(commandId, chord) => {
            // A chord that already runs something else still binds, but the
            // user is told, the way VS Code reports "keybinding conflicts".
            const conflicting = keybindingResolver.conflicts(parseKeybinding(chord), whenContext, commandId)
            const label = commands.find((command) => command.id === commandId)?.label ?? commandId
            setUserKeybindings((current) => ({ ...current, [commandId]: chord }))
            setRecordingCommand(null)
            notify(conflicting.length
              ? `${keybindingLabel(chord)} also runs ${conflicting.length} other command${conflicting.length === 1 ? '' : 's'}`
              : `${label} bound to ${keybindingLabel(chord)}`)
          }}
          onUnbind={(commandId) => {
            setUserKeybindings((current) => ({ ...current, [commandId]: '' }))
            setRecordingCommand(null)
            notify(`${commands.find((command) => command.id === commandId)?.label ?? commandId} unbound`)
          }}
          onReset={(commandId) => {
            setUserKeybindings((current) => {
              const next = { ...current }
              delete next[commandId]
              return next
            })
            notify(`${commands.find((command) => command.id === commandId)?.label ?? commandId} reset`)
          }}
          onResetAll={() => { setUserKeybindings({}); notify('Keyboard shortcuts reset to defaults') }}
          onClose={() => { setKeybindingsOpen(false); setRecordingCommand(null) }}
        />
      )}

      {newFileOpen && (
        <NewFileDialog
          renameTarget={renameTarget}
          value={newFileName}
          onChange={setNewFileName}
          onSubmit={() => { void createFile() }}
          onCancel={() => { setNewFileOpen(false); setRenameTarget(null) }}
          inputRef={newFileInputRef}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          canReveal={Boolean(window.tungsten)}
          onOpen={() => { openFile(contextMenu.path); setContextMenu(null) }}
          onRename={() => renameFile(contextMenu.path)}
          onCopyPath={() => {
            void navigator.clipboard.writeText(contextMenu.path)
            setContextMenu(null)
            notify('Relative path copied')
          }}
          onReveal={() => { void window.tungsten?.revealPath(contextMenu.path); setContextMenu(null) }}
          onDelete={() => { void deleteFile(contextMenu.path) }}
        />
      )}

      {toast && <div className="toast"><CircleCheck size={15} /><span>{toast}</span></div>}
    </div>
  )
}
