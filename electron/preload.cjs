const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('tungsten', {
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  }),

  openFolder: () => ipcRenderer.invoke('desktop:open-folder'),
  addWorkspaceFolder: () => ipcRenderer.invoke('desktop:add-workspace-folder'),
  removeWorkspaceFolder: (prefix) => ipcRenderer.invoke('desktop:remove-workspace-folder', prefix),
  restoreWorkspace: () => ipcRenderer.invoke('desktop:restore-workspace'),
  refreshWorkspace: () => ipcRenderer.invoke('desktop:refresh-workspace'),
  writeFile: (path, content) => ipcRenderer.invoke('desktop:write-file', path, content),
  renamePath: (source, destination) => ipcRenderer.invoke('desktop:rename-path', source, destination),
  deletePath: (path) => ipcRenderer.invoke('desktop:delete-path', path),
  revealPath: (path) => ipcRenderer.invoke('desktop:reveal-path', path),
  absolutePath: (path) => ipcRenderer.invoke('desktop:absolute-path', path),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  searchWorkspace: (query, limit) => ipcRenderer.invoke('workspace:search', query, limit),
  onWorkspaceFileEvent: (callback) => subscribe('workspace:file-event', callback),
  connectSsh: (configuration) => ipcRenderer.invoke('remote:ssh-connect', configuration),
  disconnectRemote: () => ipcRenderer.invoke('remote:ssh-disconnect'),
  remoteProfiles: () => ipcRenderer.invoke('remote:profiles'),
  onRemoteStatus: (callback) => subscribe('remote:status', callback),

  gitStatus: () => ipcRenderer.invoke('desktop:git-status'),
  gitCommit: (message) => ipcRenderer.invoke('desktop:git-commit', message),
  gitDiff: (path, staged = false) => ipcRenderer.invoke('desktop:git-diff', path, staged),
  gitFileVersions: (path, staged = false) => ipcRenderer.invoke('desktop:git-file-versions', path, staged),
  gitStageHunk: (patch, reverse = false) => ipcRenderer.invoke('desktop:git-stage-hunk', patch, reverse),
  gitStage: (path, staged) => ipcRenderer.invoke('desktop:git-stage', path, staged),
  gitBranches: () => ipcRenderer.invoke('desktop:git-branches'),
  gitCheckout: (branch) => ipcRenderer.invoke('desktop:git-checkout', branch),
  gitHistory: (limit) => ipcRenderer.invoke('desktop:git-history', limit),
  gitBlame: (relativePath) => ipcRenderer.invoke('desktop:git-blame', relativePath),
  gitStashes: () => ipcRenderer.invoke('desktop:git-stashes'),
  gitStashPush: (message) => ipcRenderer.invoke('desktop:git-stash-push', message),
  gitStashPop: (reference) => ipcRenderer.invoke('desktop:git-stash-pop', reference),
  gitIntegrate: (operation, branch) => ipcRenderer.invoke('desktop:git-integrate', operation, branch),
  gitOperationStatus: () => ipcRenderer.invoke('desktop:git-operation-status'),
  gitConflictVersions: (path) => ipcRenderer.invoke('desktop:git-conflict-versions', path),
  gitResolveConflict: (path, resolution) => ipcRenderer.invoke('desktop:git-resolve-conflict', path, resolution),
  gitOperationAction: (operation, action) => ipcRenderer.invoke('desktop:git-operation-action', operation, action),
  githubItems: () => ipcRenderer.invoke('desktop:github-items'),

  createTerminal: (columns, rows, profile) => ipcRenderer.invoke('terminal:create', columns, rows, profile),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, columns, rows) => ipcRenderer.invoke('terminal:resize', id, columns, rows),
  killTerminal: (id) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (callback) => subscribe('terminal:data', callback),
  onTerminalExit: (callback) => subscribe('terminal:exit', callback),

  fileUri: (path) => ipcRenderer.invoke('lsp:file-uri', path),
  startLanguageServer: (language) => ipcRenderer.invoke('lsp:start', language),
  languageRequest: (language, method, params) => ipcRenderer.invoke('lsp:request', language, method, params),
  languageNotify: (language, method, params) => ipcRenderer.invoke('lsp:notify', language, method, params),
  stopLanguageServer: (language) => ipcRenderer.invoke('lsp:stop', language),
  onLanguageNotification: (callback) => subscribe('lsp:notification', callback),
  onLanguageStatus: (callback) => subscribe('lsp:status', callback),

  startDebug: (configuration) => ipcRenderer.invoke('debug:start', configuration),
  sendDebug: (id, message) => ipcRenderer.invoke('debug:send', id, message),
  stopDebug: (id) => ipcRenderer.invoke('debug:stop', id),
  onDebugMessage: (callback) => subscribe('debug:message', callback),
  onDebugOutput: (callback) => subscribe('debug:output', callback),
  onDebugExit: (callback) => subscribe('debug:exit', callback),

  detectProject: () => ipcRenderer.invoke('project:detect'),
  discoverTests: () => ipcRenderer.invoke('project:discover-tests'),
  runTest: (testId) => ipcRenderer.invoke('project:run-test', testId),
  readCoverage: () => ipcRenderer.invoke('project:coverage'),
  createProject: (template, name) => ipcRenderer.invoke('project:create', template, name),
  scanExtensions: () => ipcRenderer.invoke('extensions:scan'),
  installExtensionFolder: () => ipcRenderer.invoke('extensions:install-folder'),
  setExtensionEnabled: (extensionId, enabled) => ipcRenderer.invoke('extensions:set-enabled', extensionId, enabled),
  uninstallExtension: (extensionId) => ipcRenderer.invoke('extensions:uninstall', extensionId),
  executeExtensionCommand: (command, args) => ipcRenderer.invoke('extensions:execute', command, args),
  onExtensionEvent: (callback) => subscribe('extensions:event', callback),

  hostCollaboration: (displayName) => ipcRenderer.invoke('collaboration:host', displayName),
  joinCollaboration: (url, displayName) => ipcRenderer.invoke('collaboration:join', url, displayName),
  publishCollaborationFile: (path, content) => ipcRenderer.invoke('collaboration:publish', path, content),
  sendCollaborationEvent: (message) => ipcRenderer.invoke('collaboration:event', message),
  leaveCollaboration: () => ipcRenderer.invoke('collaboration:leave'),
  onCollaborationDocument: (callback) => subscribe('collaboration:document', callback),
  onCollaborationEvent: (callback) => subscribe('collaboration:event', callback),

  saveRecovery: (snapshot) => ipcRenderer.invoke('recovery:save', snapshot),
  loadRecovery: () => ipcRenderer.invoke('recovery:load'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),

  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => subscribe('updater:status', callback),

  runCommand: (command) => ipcRenderer.invoke('desktop:run-command', command),
})
