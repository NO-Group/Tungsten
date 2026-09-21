type DesktopWorkspaceResult = {
  canceled: boolean
  name?: string
  path?: string
  files?: import('./workspace').WorkspaceFile[]
  truncated?: boolean
  remote?: boolean
  roots?: Array<{ name: string; path: string; prefix: string }>
}

type DesktopCommandResult = { code: number; stdout: string; stderr: string }
type GitStatusResult = {
  isRepository: boolean
  branch: string
  changes: Array<{ status: string; path: string; staged?: boolean; workingTree?: boolean }>
  error: string
}
type ProjectTask = { label: string; command: string; kind?: string }
type ProjectInfo = { tasks: ProjectTask[]; tests: ProjectTask[]; frameworks: string[] }
type ExtensionManifest = {
  id: string
  name: string
  version: string
  description: string
  publisher: string
  contributes: Record<string, unknown>
  permissions?: string[]
  entry?: string
  verification?: 'verified' | 'unsigned' | 'declarative'
  enabled?: boolean
  scope?: 'user' | 'workspace'
  location: string
}
type Unsubscribe = () => void

interface Window {
  tungsten?: {
    isDesktop: true
    platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32'
    versions: Readonly<{ electron: string; chromium: string; node: string }>

    openFolder: () => Promise<DesktopWorkspaceResult>
    addWorkspaceFolder: () => Promise<DesktopWorkspaceResult>
    removeWorkspaceFolder: (prefix: string) => Promise<DesktopWorkspaceResult>
    restoreWorkspace: () => Promise<DesktopWorkspaceResult>
    refreshWorkspace: () => Promise<DesktopWorkspaceResult>
    writeFile: (path: string, content: string) => Promise<{ ok: true }>
    renamePath: (source: string, destination: string) => Promise<{ ok: true }>
    deletePath: (path: string) => Promise<{ ok: true }>
    revealPath: (path: string) => Promise<{ ok: true }>
    absolutePath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<{ ok: true }>
    searchWorkspace: (query: string, limit?: number) => Promise<Array<{ path: string; line: number; column: number; preview: string }>>
    onWorkspaceFileEvent: (callback: (payload: { event: string; path: string }) => void) => Unsubscribe
    connectSsh: (configuration: { host: string; port?: number; username: string; root: string; password?: string; privateKeyPath?: string }) => Promise<DesktopWorkspaceResult>
    disconnectRemote: () => Promise<{ ok: true }>
    remoteProfiles: () => Promise<{ wsl: string[]; containers: Array<{ id: string; name: string; image: string }>; devcontainer: boolean }>
    onRemoteStatus: (callback: (payload: { connected: boolean; message: string }) => void) => Unsubscribe

    gitStatus: () => Promise<GitStatusResult>
    gitCommit: (message: string) => Promise<{ ok: true; output: string; status: GitStatusResult }>
    gitDiff: (path: string, staged?: boolean) => Promise<{ diff: string; hunks: Array<{ id: string; header: string; patch: string }> }>
    gitFileVersions: (path: string, staged?: boolean) => Promise<{ before: string; after: string; path: string; staged: boolean }>
    gitStageHunk: (patch: string, reverse?: boolean) => Promise<GitStatusResult>
    gitStage: (path: string, staged: boolean) => Promise<GitStatusResult>
    gitBranches: () => Promise<string[]>
    gitCheckout: (branch: string) => Promise<GitStatusResult>
    gitHistory: (limit?: number) => Promise<Array<{ hash: string; shortHash: string; author: string; date: string; subject: string; refs: string }>>
    gitBlame: (relativePath: string) => Promise<Array<{ line: number; hash: string; author: string; date: string; content: string }>>
    gitStashes: () => Promise<Array<{ ref: string; hash: string; subject: string }>>
    gitStashPush: (message?: string) => Promise<GitStatusResult>
    gitStashPop: (reference: string) => Promise<GitStatusResult>
    gitIntegrate: (operation: 'merge' | 'rebase', branch: string) => Promise<GitStatusResult>
    gitOperationStatus: () => Promise<{ operation: 'merge' | 'rebase' | null; conflicts: string[] }>
    gitConflictVersions: (path: string) => Promise<{ path: string; base: string; ours: string; theirs: string }>
    gitResolveConflict: (path: string, resolution: 'ours' | 'theirs' | 'both' | 'mark') => Promise<GitStatusResult>
    gitOperationAction: (operation: 'merge' | 'rebase', action: 'continue' | 'abort') => Promise<GitStatusResult>
    githubItems: () => Promise<{ pullRequests: Array<{ number: number; title: string; state: string; url: string }>; issues: Array<{ number: number; title: string; state: string; url: string }> }>

    createTerminal: (columns: number, rows: number, profile?: { kind: 'wsl' | 'container'; id: string }) => Promise<{ id: string }>
    writeTerminal: (id: string, data: string) => Promise<{ ok: true }>
    resizeTerminal: (id: string, columns: number, rows: number) => Promise<{ ok: true }>
    killTerminal: (id: string) => Promise<{ ok: true }>
    onTerminalData: (callback: (payload: { id: string; data: string }) => void) => Unsubscribe
    onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => Unsubscribe

    fileUri: (path: string) => Promise<string>
    startLanguageServer: (language: string) => Promise<{ running: boolean; language: string; capabilities?: Record<string, unknown>; error?: string }>
    languageRequest: (language: string, method: string, params: unknown) => Promise<any>
    languageNotify: (language: string, method: string, params: unknown) => Promise<{ ok: boolean }>
    stopLanguageServer: (language: string) => Promise<{ ok: true }>
    onLanguageNotification: (callback: (payload: { language: string; message: any }) => void) => Unsubscribe
    onLanguageStatus: (callback: (payload: { language: string; running: boolean; code?: number }) => void) => Unsubscribe

    startDebug: (configuration: Record<string, any>) => Promise<{ id: string }>
    sendDebug: (id: string, message: Record<string, any>) => Promise<{ ok: true }>
    stopDebug: (id: string) => Promise<{ ok: true }>
    onDebugMessage: (callback: (payload: { id: string; message: any }) => void) => Unsubscribe
    onDebugOutput: (callback: (payload: { id: string; output: string }) => void) => Unsubscribe
    onDebugExit: (callback: (payload: { id: string; code: number }) => void) => Unsubscribe

    detectProject: () => Promise<ProjectInfo>
    discoverTests: () => Promise<Array<{ id: string; name: string; path: string; line: number; command: string }>>
    runTest: (testId: string) => Promise<{ id: string; status: 'passed' | 'failed'; code: number; durationMs: number; stdout: string; stderr: string; output: string; failures: string[]; snapshots: string[]; coverage: Record<string, Array<{ line: number; hits: number }>> }>
    readCoverage: () => Promise<Record<string, Array<{ line: number; hits: number }>>>
    createProject: (template: string, name: string) => Promise<DesktopWorkspaceResult>
    scanExtensions: () => Promise<ExtensionManifest[]>
    installExtensionFolder: () => Promise<{ canceled: boolean; extensions: ExtensionManifest[] }>
    setExtensionEnabled: (extensionId: string, enabled: boolean) => Promise<ExtensionManifest[]>
    uninstallExtension: (extensionId: string) => Promise<ExtensionManifest[]>
    executeExtensionCommand: (command: string, args?: unknown[]) => Promise<unknown>
    onExtensionEvent: (callback: (payload: { type: string; id?: string; extensionId?: string; message?: string }) => void) => Unsubscribe

    hostCollaboration: (displayName: string) => Promise<{ url: string; port: number; token: string }>
    joinCollaboration: (url: string, displayName: string) => Promise<{ connected: true }>
    publishCollaborationFile: (path: string, content: string) => Promise<{ ok: true }>
    sendCollaborationEvent: (message: { type: 'presence' | 'comment' | 'signal'; [key: string]: unknown }) => Promise<{ ok: true }>
    leaveCollaboration: () => Promise<{ ok: true }>
    onCollaborationDocument: (callback: (payload: { files: Record<string, string> }) => void) => Unsubscribe
    onCollaborationEvent: (callback: (payload: { type: string; name?: string; state?: string; text?: string; path?: string; line?: number; column?: number }) => void) => Unsubscribe

    saveRecovery: (snapshot: unknown) => Promise<{ ok: true }>
    loadRecovery: () => Promise<any>
    clearRecovery: () => Promise<{ ok: true }>

    checkForUpdates: () => Promise<{ available: boolean; message?: string; info?: unknown }>
    downloadUpdate: () => Promise<unknown>
    installUpdate: () => Promise<unknown>
    onUpdaterStatus: (callback: (payload: { event: string; payload: any }) => void) => Unsubscribe

    runCommand: (command: string) => Promise<DesktopCommandResult>
  }
}
