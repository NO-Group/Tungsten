const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { exec, execFile, fork, spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const os = require('node:os')
const crypto = require('node:crypto')
const pty = require('@homebridge/node-pty-prebuilt-multiarch')
const { autoUpdater } = require('electron-updater')
const chokidar = require('chokidar')
const { Client: SshClient } = require('ssh2')
const { WebSocket, WebSocketServer } = require('ws')
const Y = require('yjs')

const isDevelopment = !app.isPackaged
let mainWindow = null
let workspaceRoot = null
let workspaceMounts = []
let terminalSequence = 0
const terminalSessions = new Map()
const languageServers = new Map()
const debugSessions = new Map()
let workspaceWatcher = null
let watcherDebounce = null
let remoteWorkspace = null
let collaborationServer = null
let collaborationSocket = null
let collaborationDocument = null
let collaborationToken = ''
let collaborationJoin = null
let collaborationReconnectTimer = null
const collaborationPeers = new Set()
let extensionHost = null
let extensionRequestSequence = 0
const extensionRequests = new Map()

const TEXT_EXTENSIONS = new Set([
  '.asm', '.astro', '.bat', '.c', '.cc', '.clj', '.cljs', '.cmake', '.coffee',
  '.conf', '.cpp', '.cs', '.css', '.csv', '.dart', '.diff', '.dockerfile', '.ex',
  '.exs', '.fs', '.fsx', '.go', '.graphql', '.gql', '.groovy', '.h', '.handlebars',
  '.hbs', '.hpp', '.hs', '.html', '.ini', '.ipynb', '.java', '.jl', '.js', '.jsx',
  '.json', '.jsonc', '.kt', '.kts', '.less', '.lua', '.m', '.md', '.mdx', '.mjs',
  '.mm', '.pas', '.php', '.pl', '.pm', '.properties', '.proto', '.ps1', '.pug',
  '.py', '.r', '.razor', '.rb', '.rs', '.sass', '.scala', '.scss', '.sh', '.sol',
  '.sql', '.svelte', '.svg', '.swift', '.tf', '.tfvars', '.toml', '.ts', '.tsx',
  '.txt', '.vue', '.xml', '.yaml', '.yml', '.zig',
])
const TEXT_NAMES = new Set([
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.npmrc',
  'CMakeLists.txt', 'Containerfile', 'Dockerfile', 'Gemfile', 'LICENSE', 'Makefile',
  'Procfile', 'README', 'Rakefile',
])
const IGNORED_DIRECTORIES = new Set([
  '.git', '.gradle', '.idea', '.next', '.nuxt', '.svelte-kit', '.turbo', '.venv',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor',
])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_FILES = 4000

function languageFor(filePath) {
  const filename = path.basename(filePath)
  if (filename === 'Dockerfile' || filename === 'Containerfile') return 'dockerfile'
  if (filename === 'CMakeLists.txt' || path.extname(filename) === '.cmake') return 'plaintext'
  if (filename.startsWith('.env') || filename === '.gitignore') return 'plaintext'

  const extension = path.extname(filePath).slice(1).toLowerCase()
  const languages = {
    asm: 'plaintext', astro: 'html', bat: 'bat', c: 'c', cc: 'cpp', clj: 'clojure',
    cljs: 'clojure', coffee: 'coffeescript', conf: 'ini', cpp: 'cpp', cs: 'csharp',
    css: 'css', dart: 'dart', diff: 'plaintext', ex: 'elixir', exs: 'elixir', fs: 'fsharp',
    fsx: 'fsharp', go: 'go', gql: 'graphql', graphql: 'graphql', groovy: 'plaintext',
    h: 'cpp', handlebars: 'handlebars', hbs: 'handlebars', hpp: 'cpp', hs: 'plaintext',
    html: 'html', ini: 'ini', ipynb: 'json', java: 'java', jl: 'julia', js: 'javascript',
    jsx: 'javascript', json: 'json', jsonc: 'json', kt: 'kotlin', kts: 'kotlin', less: 'less',
    lua: 'lua', m: 'objective-c', md: 'markdown', mdx: 'mdx', mjs: 'javascript',
    mm: 'objective-c', pas: 'pascal', php: 'php', pl: 'perl', pm: 'perl',
    properties: 'ini', proto: 'protobuf', ps1: 'powershell', pug: 'pug', py: 'python',
    r: 'r', razor: 'razor', rb: 'ruby', rs: 'rust', sass: 'scss', scala: 'scala',
    scss: 'scss', sh: 'shell', sol: 'solidity', sql: 'sql', svelte: 'html', svg: 'xml',
    swift: 'swift', tf: 'hcl', tfvars: 'hcl', toml: 'ini', ts: 'typescript',
    tsx: 'typescript', txt: 'plaintext', vue: 'html', xml: 'xml', yaml: 'yaml',
    yml: 'yaml', zig: 'plaintext',
  }
  return languages[extension] || 'plaintext'
}

function assertInsideRoot(root, absolutePath) {
  const relation = path.relative(root, absolutePath)
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('The requested path is outside the workspace.')
}

function resolveWorkspaceTarget(relativePath) {
  if (!workspaceRoot) throw new Error('Open a workspace before accessing files.')
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) throw new Error('Invalid file path.')
  const normalized = relativePath.replaceAll('\\', '/')
  const mount = workspaceMounts.find((candidate) => normalized === candidate.prefix || normalized.startsWith(`${candidate.prefix}/`))
  const root = mount?.path || workspaceRoot
  const nestedPath = mount ? normalized.slice(mount.prefix.length).replace(/^\//, '') : normalized
  const absolutePath = path.resolve(root, nestedPath)
  assertInsideRoot(root, absolutePath)
  return { absolutePath, root, mount }
}

function resolveWorkspacePath(relativePath) {
  return resolveWorkspaceTarget(relativePath).absolutePath
}

async function resolveExistingWorkspacePath(relativePath) {
  const { absolutePath, root } = resolveWorkspaceTarget(relativePath)
  const stats = await fs.lstat(absolutePath)
  if (stats.isSymbolicLink()) throw new Error('Accessing symbolic links is not allowed.')
  const realPath = await fs.realpath(absolutePath)
  assertInsideRoot(root, realPath)
  return absolutePath
}

async function resolveWritablePath(relativePath) {
  const { absolutePath, root } = resolveWorkspaceTarget(relativePath)
  let existingParent = path.dirname(absolutePath)

  while (existingParent !== path.dirname(existingParent)) {
    try {
      const realParent = await fs.realpath(existingParent)
      assertInsideRoot(root, realParent)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      existingParent = path.dirname(existingParent)
    }
  }

  try {
    const targetStats = await fs.lstat(absolutePath)
    if (targetStats.isSymbolicLink()) throw new Error('Writing through symbolic links is not allowed.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return absolutePath
}

async function readWorkspace(root) {
  const files = []

  async function visit(directory) {
    if (files.length >= MAX_WORKSPACE_FILES) return
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) break
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) continue

      const extension = path.extname(entry.name).toLowerCase()
      const isEnvironmentFile = entry.name === '.env' || entry.name.startsWith('.env.')
      if (!TEXT_EXTENSIONS.has(extension) && !TEXT_NAMES.has(entry.name) && !isEnvironmentFile) continue

      try {
        const stats = await fs.stat(absolutePath)
        if (stats.size > MAX_FILE_BYTES) continue
        const content = await fs.readFile(absolutePath, 'utf8')
        if (content.includes('\0')) continue
        files.push({ path: relativePath, content, language: languageFor(relativePath) })
      } catch {
        // An unreadable file should not prevent the rest of the folder from opening.
      }
    }
  }

  await visit(root)
  return files
}

async function workspacePayload() {
  if (!workspaceRoot) return { canceled: true }
  const primaryFiles = await readWorkspace(workspaceRoot)
  const files = [...primaryFiles]
  let truncated = primaryFiles.length >= MAX_WORKSPACE_FILES
  for (const mount of workspaceMounts) {
    const mountedFiles = await readWorkspace(mount.path)
    for (const file of mountedFiles) {
      if (files.length >= MAX_WORKSPACE_FILES) { truncated = true; break }
      files.push({ ...file, path: `${mount.prefix}/${file.path}` })
    }
  }
  return {
    canceled: false,
    name: path.basename(workspaceRoot),
    path: workspaceRoot,
    files,
    roots: [{ name: path.basename(workspaceRoot), path: workspaceRoot, prefix: '' }, ...workspaceMounts.map((mount) => ({ name: mount.name, path: mount.path, prefix: mount.prefix }))],
    truncated,
  }
}

async function startWorkspaceWatcher() {
  if (workspaceWatcher) await workspaceWatcher.close()
  workspaceWatcher = null
  if (!workspaceRoot || workspaceRoot.startsWith('ssh://')) return
  workspaceWatcher = chokidar.watch([workspaceRoot, ...workspaceMounts.map((mount) => mount.path)], {
    ignoreInitial: true,
    persistent: true,
    ignored: (candidate) => candidate.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part)),
    awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 50 },
  })
  workspaceWatcher.on('all', (event, changedPath) => {
    clearTimeout(watcherDebounce)
    watcherDebounce = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const mount = workspaceMounts.find((candidate) => changedPath === candidate.path || changedPath.startsWith(`${candidate.path}${path.sep}`))
      const root = mount?.path || workspaceRoot
      const relative = path.relative(root, changedPath).split(path.sep).join('/')
      mainWindow.webContents.send('workspace:file-event', { event, path: mount ? `${mount.prefix}/${relative}` : relative })
    }, 120)
  })
}

async function searchWorkspace(query, limit = 300) {
  if (!workspaceRoot && !remoteWorkspace) throw new Error('Open a workspace before searching.')
  if (typeof query !== 'string' || !query.trim() || query.length > 500) return []
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 300))
  if (remoteWorkspace) {
    const workspace = await readRemoteWorkspace()
    const needle = query.toLowerCase()
    return workspace.files.flatMap((file) => file.content.split('\n').map((line, index) => ({ path: file.path, line: index + 1, column: line.toLowerCase().indexOf(needle) + 1, preview: line.trim().slice(0, 600) })).filter((match) => match.column > 0)).slice(0, safeLimit)
  }

  try {
    const searchRoot = async (root, prefix = '') => {
      const output = await new Promise((resolve, reject) => {
        execFile('rg', ['--json', '--line-number', '--column', '--fixed-strings', '--hidden', '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!dist/**', query, '.'], {
          cwd: root,
          timeout: 15000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        }, (error, stdout) => {
          if (error && error.code !== 1) reject(error)
          else resolve(stdout || '')
        })
      })
      const results = []
      for (const line of output.split(/\r?\n/)) {
        if (!line || results.length >= safeLimit) continue
        try {
          const event = JSON.parse(line)
          if (event.type !== 'match') continue
          const data = event.data
          const relative = data.path.text.replace(/^\.\//, '').split(path.sep).join('/')
          results.push({ path: prefix ? `${prefix}/${relative}` : relative, line: data.line_number, column: (data.submatches?.[0]?.start || 0) + 1, preview: data.lines.text.trimEnd() })
        } catch { /* Ignore non-JSON rg output. */ }
      }
      return results
    }
    const batches = await Promise.all([searchRoot(workspaceRoot), ...workspaceMounts.map((mount) => searchRoot(mount.path, mount.prefix))])
    return batches.flat().slice(0, safeLimit)
  } catch {
    const payload = await workspacePayload()
    return payload.files.flatMap((file) => file.content.split('\n').flatMap((line, index) => {
      const column = line.toLowerCase().indexOf(query.toLowerCase())
      return column < 0 ? [] : [{ path: file.path, line: index + 1, column: column + 1, preview: line.trim() }]
    })).slice(0, safeLimit)
  }
}

function recentWorkspacePath() {
  return path.join(app.getPath('userData'), 'recent-workspace.json')
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)))
}

function safeRemotePath(relativePath = '') {
  if (!remoteWorkspace) throw new Error('No SSH workspace is connected.')
  const root = remoteWorkspace.root
  const resolved = path.posix.resolve(root, String(relativePath).replaceAll('\\', '/'))
  if (resolved !== root && !resolved.startsWith(`${root}/`)) throw new Error('Remote path escapes the SSH workspace.')
  return resolved
}

async function ensureRemoteDirectory(absoluteDirectory) {
  if (!remoteWorkspace) return
  const relative = path.posix.relative(remoteWorkspace.root, absoluteDirectory)
  let current = remoteWorkspace.root
  for (const segment of relative.split('/').filter(Boolean)) {
    current = path.posix.join(current, segment)
    const exists = await sftpCall(remoteWorkspace.sftp, 'stat', current).then((stats) => stats.isDirectory()).catch(() => false)
    if (!exists) await sftpCall(remoteWorkspace.sftp, 'mkdir', current, { mode: 0o755 })
  }
}

async function readRemoteWorkspace() {
  if (!remoteWorkspace) throw new Error('No SSH workspace is connected.')
  const files = []
  const queue = [{ absolute: remoteWorkspace.root, relative: '', depth: 0 }]
  let truncated = false
  while (queue.length && files.length < MAX_WORKSPACE_FILES) {
    const current = queue.shift()
    let entries = []
    try { entries = await sftpCall(remoteWorkspace.sftp, 'readdir', current.absolute) } catch { continue }
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.filename) || entry.filename === '.' || entry.filename === '..') continue
      const relative = current.relative ? `${current.relative}/${entry.filename}` : entry.filename
      const absolute = path.posix.join(current.absolute, entry.filename)
      if (entry.attrs?.isDirectory()) {
        if (current.depth < 20) queue.push({ absolute, relative, depth: current.depth + 1 })
        continue
      }
      if (!entry.attrs?.isFile() || (!TEXT_NAMES.has(entry.filename) && !TEXT_EXTENSIONS.has(path.posix.extname(entry.filename).toLowerCase())) || entry.attrs.size > MAX_FILE_BYTES) continue
      try {
        const content = await sftpCall(remoteWorkspace.sftp, 'readFile', absolute, { encoding: 'utf8' })
        files.push({ path: relative, content, language: languageFor(relative) })
      } catch { /* Ignore unreadable remote files. */ }
      if (files.length >= MAX_WORKSPACE_FILES) { truncated = true; break }
    }
  }
  return { canceled: false, name: path.posix.basename(remoteWorkspace.root) || remoteWorkspace.host, path: `ssh://${remoteWorkspace.username}@${remoteWorkspace.host}${remoteWorkspace.root}`, files, truncated, remote: true }
}

async function connectSshWorkspace(configuration) {
  const host = String(configuration?.host || '').trim()
  const username = String(configuration?.username || '').trim()
  const root = path.posix.resolve('/', String(configuration?.root || '/').trim())
  const port = Math.max(1, Math.min(65535, Number(configuration?.port) || 22))
  if (!/^[a-zA-Z0-9._:-]{1,255}$/.test(host) || !username || username.length > 128) throw new Error('Enter a valid SSH host and username.')
  if (remoteWorkspace?.client) remoteWorkspace.client.end()
  const client = new SshClient()
  const connectOptions = { host, port, username, readyTimeout: 15000, keepaliveInterval: 10000 }
  if (configuration.password) connectOptions.password = String(configuration.password)
  else if (configuration.privateKeyPath) {
    const keyPath = String(configuration.privateKeyPath).replace(/^~(?=[/\\])/, app.getPath('home'))
    connectOptions.privateKey = await fs.readFile(keyPath)
  }
  else if (process.env.SSH_AUTH_SOCK) connectOptions.agent = process.env.SSH_AUTH_SOCK
  const sftp = await new Promise((resolve, reject) => {
    client.once('ready', () => client.sftp((error, channel) => error ? reject(error) : resolve(channel)))
    client.once('error', reject)
    client.connect(connectOptions)
  })
  const rootStats = await sftpCall(sftp, 'stat', root).catch(() => null)
  if (!rootStats?.isDirectory()) {
    client.end()
    throw new Error('The requested SSH workspace folder does not exist or is not accessible.')
  }
  resetWorkspaceLanguageServers()
  workspaceRoot = null
  workspaceMounts = []
  remoteWorkspace = { client, sftp, host, port, username, root }
  if (workspaceWatcher) { await workspaceWatcher.close(); workspaceWatcher = null }
  client.once('close', () => {
    if (remoteWorkspace?.client === client) remoteWorkspace = null
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote:status', { connected: false, message: 'SSH connection closed' })
  })
  return readRemoteWorkspace()
}

function emitCollaboration(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function initializeCollaborationDocument() {
  collaborationDocument?.destroy()
  collaborationDocument = new Y.Doc()
  collaborationDocument.on('update', (update, origin) => {
    const message = JSON.stringify({ type: 'update', update: Buffer.from(update).toString('base64') })
    for (const peer of collaborationPeers) if (peer !== origin && peer.readyState === WebSocket.OPEN) peer.send(message)
    if (collaborationSocket && collaborationSocket !== origin && collaborationSocket.readyState === WebSocket.OPEN) collaborationSocket.send(message)
    emitCollaboration('collaboration:document', { files: Object.fromEntries(collaborationDocument.getMap('files').entries()) })
  })
  return collaborationDocument
}

function handleCollaborationMessage(raw, origin) {
  let message
  try { message = JSON.parse(raw.toString()) } catch { return }
  if ((message.type === 'sync' || message.type === 'update') && typeof message.update === 'string') {
    Y.applyUpdate(collaborationDocument, Buffer.from(message.update, 'base64'), origin)
    return
  }
  if (!['presence', 'comment', 'signal'].includes(message.type)) return
  emitCollaboration('collaboration:event', message)
  const serialized = JSON.stringify(message)
  for (const peer of collaborationPeers) if (peer !== origin && peer.readyState === WebSocket.OPEN) peer.send(serialized)
  if (collaborationSocket && collaborationSocket !== origin && collaborationSocket.readyState === WebSocket.OPEN) collaborationSocket.send(serialized)
}

async function hostCollaborationRoom(displayName) {
  collaborationJoin = null
  clearTimeout(collaborationReconnectTimer)
  collaborationSocket?.close()
  collaborationServer?.close()
  collaborationPeers.clear()
  initializeCollaborationDocument()
  collaborationToken = crypto.randomBytes(24).toString('base64url')
  collaborationServer = new WebSocketServer({ host: '0.0.0.0', port: 0 })
  collaborationServer.on('connection', (socket, request) => {
    if (request.url !== `/${collaborationToken}`) { socket.close(1008, 'Invalid room token'); return }
    collaborationPeers.add(socket)
    socket.send(JSON.stringify({ type: 'sync', update: Buffer.from(Y.encodeStateAsUpdate(collaborationDocument)).toString('base64') }))
    socket.on('message', (message) => handleCollaborationMessage(message, socket))
    socket.once('close', () => collaborationPeers.delete(socket))
  })
  await new Promise((resolve, reject) => { collaborationServer.once('listening', resolve); collaborationServer.once('error', reject) })
  const port = collaborationServer.address().port
  const address = Object.values(os.networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal)?.address || 'localhost'
  const url = `ws://${address}:${port}/${collaborationToken}`
  emitCollaboration('collaboration:event', { type: 'presence', name: displayName || 'Host', state: 'joined', self: true })
  return { url, port, token: collaborationToken }
}

function scheduleCollaborationReconnect(url, displayName) {
  if (!collaborationJoin) return
  emitCollaboration('collaboration:event', { type: 'presence', name: displayName || 'You', state: 'reconnecting', self: true })
  clearTimeout(collaborationReconnectTimer)
  collaborationReconnectTimer = setTimeout(() => {
    if (!collaborationJoin) return
    connectCollaborationRoom(url, displayName, true).catch(() => scheduleCollaborationReconnect(url, displayName))
  }, 1500)
}

async function connectCollaborationRoom(url, displayName, reconnecting = false) {
  const socket = new WebSocket(url)
  collaborationSocket = socket
  socket.on('message', (message) => handleCollaborationMessage(message, socket))
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  if (collaborationSocket !== socket) return { connected: false }
  emitCollaboration('collaboration:event', { type: 'presence', name: displayName || 'You', state: reconnecting ? 'reconnected' : 'joined', self: true })
  handleCollaborationMessage(JSON.stringify({ type: 'presence', name: displayName || 'Guest', state: 'joined' }), null)
  socket.once('close', () => {
    if (collaborationSocket !== socket || !collaborationJoin) return
    scheduleCollaborationReconnect(url, displayName)
  })
  return { connected: true }
}

async function joinCollaborationRoom(url, displayName) {
  if (typeof url !== 'string' || !/^wss?:\/\/[a-z0-9.:[\]-]+(?::\d+)?\/[A-Za-z0-9_-]{20,}$/i.test(url)) throw new Error('Enter a valid Tungsten collaboration URL.')
  collaborationJoin = null
  clearTimeout(collaborationReconnectTimer)
  collaborationSocket?.close()
  initializeCollaborationDocument()
  collaborationJoin = { url, displayName: displayName || 'Guest' }
  return connectCollaborationRoom(url, displayName)
}

function resetWorkspaceLanguageServers() {
  languageServers.forEach((server) => server.peer.dispose())
  languageServers.clear()
}

async function addWorkspaceMount(rootPath) {
  if (workspaceMounts.length >= 8) throw new Error('A Tungsten workspace supports up to eight additional roots.')
  const resolved = await fs.realpath(rootPath)
  if (resolved === workspaceRoot || workspaceMounts.some((mount) => mount.path === resolved)) return null
  const baseName = path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, '-') || 'root'
  let name = baseName
  let sequence = 2
  const nameUnavailable = async (candidate) => workspaceMounts.some((mount) => mount.name === candidate) || await fs.access(path.join(workspaceRoot, `@${candidate}`)).then(() => true).catch(() => false)
  while (await nameUnavailable(name)) name = `${baseName}-${sequence++}`
  const mount = { name, prefix: `@${name}`, path: resolved }
  workspaceMounts.push(mount)
  return mount
}

async function rememberWorkspace() {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(recentWorkspacePath(), JSON.stringify({ path: workspaceRoot, mounts: workspaceMounts.map((mount) => mount.path) }), 'utf8')
}

async function runFileInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspaceRoot || app.getPath('home'), windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' } })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr || `${command} exited with ${code}`), { stdout, stderr })))
    child.stdin?.end(input)
  })
}

async function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: workspaceRoot || app.getPath('home'),
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || ''
        error.stderr = stderr || ''
        reject(error)
        return
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

class StdioJsonPeer {
  constructor(processHandle, notificationHandler) {
    this.process = processHandle
    this.notificationHandler = notificationHandler
    this.buffer = Buffer.alloc(0)
    this.sequence = 0
    this.pending = new Map()
    processHandle.stdout.on('data', (chunk) => this.consume(chunk))
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const headers = this.buffer.subarray(0, headerEnd).toString('ascii')
      const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(lengthMatch[1])
      const messageEnd = headerEnd + 4 + length
      if (this.buffer.length < messageEnd) return
      const payload = this.buffer.subarray(headerEnd + 4, messageEnd).toString('utf8')
      this.buffer = this.buffer.subarray(messageEnd)
      try {
        const message = JSON.parse(payload)
        if (message.id !== undefined && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)
          this.pending.delete(message.id)
          clearTimeout(pending.timer)
          if (message.error) pending.reject(new Error(message.error.message || 'Language service request failed.'))
          else pending.resolve(message.result)
        } else {
          this.notificationHandler(message)
        }
      } catch {
        // Ignore malformed adapter output and continue parsing the stream.
      }
    }
  }

  send(message) {
    const payload = JSON.stringify(message)
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  request(method, params, timeout = 20000) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  dispose() {
    this.pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Language service stopped.')) })
    this.pending.clear()
    this.process.kill()
  }
}

function languageServerSpec(language) {
  if (language === 'javascript' || language === 'typescript') {
    const packageRoot = path.dirname(require.resolve('typescript-language-server/package.json'))
    return {
      command: process.execPath,
      args: [path.join(packageRoot, 'lib', 'cli.mjs'), '--stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const servers = {
    python: ['pylsp'], rust: ['rust-analyzer'], go: ['gopls'],
    c: ['clangd'], cpp: ['clangd'], java: ['jdtls'],
    csharp: ['omnisharp', '--languageserver'], ruby: ['solargraph', 'stdio'],
    php: ['intelephense', '--stdio'], kotlin: ['kotlin-language-server'],
    lua: ['lua-language-server'],
  }
  const spec = servers[language]
  return spec ? { command: spec[0], args: spec.slice(1), env: {} } : null
}

function remoteFileUri(absolutePath) {
  return `file://${absolutePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
}

function remoteLanguageServerSpec(language) {
  if (language === 'javascript' || language === 'typescript') return { command: 'typescript-language-server', args: ['--stdio'], env: {} }
  return languageServerSpec(language)
}

function spawnRemoteLanguageServer(spec) {
  const processHandle = new EventEmitter()
  processHandle.stdin = new PassThrough()
  processHandle.stdout = new PassThrough()
  processHandle.stderr = new PassThrough()
  processHandle.kill = () => processHandle.stream?.close()
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
  const command = `cd ${quote(remoteWorkspace.root)} && ${[spec.command, ...spec.args].map(quote).join(' ')}`
  remoteWorkspace.client.exec(command, (error, stream) => {
    if (error) { processHandle.emit('error', error); return }
    processHandle.stream = stream
    processHandle.stdin.pipe(stream)
    stream.pipe(processHandle.stdout)
    stream.stderr.pipe(processHandle.stderr)
    stream.once('close', (code) => processHandle.emit('exit', code))
    processHandle.emit('spawn')
  })
  return processHandle
}

async function startLanguageServer(language) {
  if (!workspaceRoot && !remoteWorkspace) throw new Error('Open a workspace before starting a language server.')
  const existing = languageServers.get(language)
  if (existing) return { running: true, language, capabilities: existing.capabilities }
  const spec = remoteWorkspace ? remoteLanguageServerSpec(language) : languageServerSpec(language)
  if (!spec) return { running: false, language, error: `No language-server adapter is configured for ${language}.` }

  return new Promise((resolve) => {
    const child = remoteWorkspace ? spawnRemoteLanguageServer(spec) : spawn(spec.command, spec.args, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...spec.env },
    })
    let settled = false
    const peer = new StdioJsonPeer(child, (message) => {
      if (message.id !== undefined && message.method) {
        const result = message.method === 'workspace/configuration'
          ? (message.params?.items || []).map(() => null)
          : message.method === 'workspace/applyEdit'
            ? { applied: false, failureReason: 'Workspace edits require user confirmation.' }
            : null
        peer.send({ jsonrpc: '2.0', id: message.id, result })
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lsp:notification', { language, message })
    })
    const entry = { child, peer, capabilities: {} }

    child.once('error', (error) => {
      languageServers.delete(language)
      if (!settled) {
        settled = true
        resolve({ running: false, language, error: `${spec.command} is not available: ${error.message}` })
      }
    })
    child.once('spawn', async () => {
      try {
        const rootUri = remoteWorkspace ? remoteFileUri(remoteWorkspace.root) : pathToFileURL(workspaceRoot).href
        const result = await peer.request('initialize', {
          processId: process.pid,
          rootUri,
          capabilities: {
            textDocument: {
              completion: { completionItem: { snippetSupport: true } },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              publishDiagnostics: { relatedInformation: true },
            },
            workspace: { workspaceFolders: true },
          },
          workspaceFolders: remoteWorkspace ? [{ uri: rootUri, name: path.posix.basename(remoteWorkspace.root) || remoteWorkspace.host }] : [
            { uri: rootUri, name: path.basename(workspaceRoot) },
            ...workspaceMounts.map((mount) => ({ uri: pathToFileURL(mount.path).href, name: mount.name })),
          ],
        })
        entry.capabilities = result?.capabilities || {}
        languageServers.set(language, entry)
        peer.notify('initialized', {})
        settled = true
        resolve({ running: true, language, capabilities: entry.capabilities })
      } catch (error) {
        peer.dispose()
        if (!settled) {
          settled = true
          resolve({ running: false, language, error: error.message })
        }
      }
    })
    child.once('exit', (code) => {
      languageServers.delete(language)
      if (!settled) { settled = true; resolve({ running: false, language, error: `${spec.command} exited with code ${code} before initialization.` }) }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lsp:status', { language, running: false, code })
    })
  })
}

async function gitStatus() {
  if (!workspaceRoot) return { isRepository: false, branch: '', changes: [], error: 'Open a folder first.' }
  try {
    const { stdout } = await runFile('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch'])
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    const heading = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : 'HEAD'
    const branch = heading.split('...')[0].split(' ')[0]
    const changes = lines.map((line) => ({
      status: line.slice(0, 2).trim() || 'M',
      staged: line[0] !== ' ' && line[0] !== '?',
      workingTree: line[1] !== ' ',
      path: line.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, ''),
    }))
    return { isRepository: true, branch, changes, error: '' }
  } catch (error) {
    return { isRepository: false, branch: '', changes: [], error: error.stderr?.trim() || 'This folder is not a Git repository.' }
  }
}

async function detectProject() {
  if (!workspaceRoot && !remoteWorkspace) return { tasks: [], tests: [], frameworks: [] }
  const tasks = []
  const tests = []
  const frameworks = []
  const readProjectFile = async (name) => remoteWorkspace
    ? sftpCall(remoteWorkspace.sftp, 'readFile', safeRemotePath(name), { encoding: 'utf8' })
    : fs.readFile(path.join(workspaceRoot, name), 'utf8')
  const has = async (name) => remoteWorkspace
    ? sftpCall(remoteWorkspace.sftp, 'stat', safeRemotePath(name)).then(() => true).catch(() => false)
    : fs.access(path.join(workspaceRoot, name)).then(() => true).catch(() => false)

  if (await has('package.json')) {
    try {
      const manifest = JSON.parse(await readProjectFile('package.json'))
      Object.keys(manifest.scripts || {}).forEach((script) => tasks.push({ label: `npm: ${script}`, command: `npm run ${script}`, kind: script.includes('test') ? 'test' : 'task' }))
      if (manifest.scripts?.test) tests.push({ label: 'npm test', command: 'npm test' })
      frameworks.push('Node.js')
    } catch { /* Ignore an invalid package manifest. */ }
  }
  if (await has('pyproject.toml') || await has('pytest.ini') || await has('requirements.txt')) {
    frameworks.push('Python')
    tasks.push({ label: 'Python: run module', command: 'python -m main', kind: 'task' })
    tests.push({ label: 'pytest', command: 'python -m pytest', kind: 'test' })
  }
  if (await has('Cargo.toml')) {
    frameworks.push('Rust')
    tasks.push({ label: 'Cargo: build', command: 'cargo build', kind: 'build' })
    tests.push({ label: 'Cargo: test', command: 'cargo test', kind: 'test' })
  }
  if (await has('go.mod')) {
    frameworks.push('Go')
    tasks.push({ label: 'Go: build', command: 'go build ./...', kind: 'build' })
    tests.push({ label: 'Go: test', command: 'go test ./...', kind: 'test' })
  }
  if (await has('pom.xml')) {
    frameworks.push('Maven')
    tasks.push({ label: 'Maven: package', command: 'mvn package', kind: 'build' })
    tests.push({ label: 'Maven: test', command: 'mvn test', kind: 'test' })
  }
  if (await has('build.gradle') || await has('build.gradle.kts')) {
    frameworks.push('Gradle')
    const gradle = !remoteWorkspace && process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
    tasks.push({ label: 'Gradle: build', command: `${gradle} build`, kind: 'build' })
    tests.push({ label: 'Gradle: test', command: `${gradle} test`, kind: 'test' })
  }
  try {
    const custom = JSON.parse(await readProjectFile('.tungsten/tasks.json'))
    for (const task of custom.tasks || []) {
      if (typeof task.label === 'string' && typeof task.command === 'string') tasks.push({ label: task.label, command: task.command, kind: task.kind || 'task' })
    }
  } catch { /* Custom tasks are optional. */ }
  return { tasks, tests, frameworks }
}

async function discoverTests() {
  if (!workspaceRoot && !remoteWorkspace) return []
  const files = remoteWorkspace ? (await readRemoteWorkspace()).files : await readWorkspace(workspaceRoot)
  const candidates = files.filter((file) => /(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\.[^.]+$/i.test(file.path) || /_test\.(go|py)$|tests?\.rs$/i.test(file.path))
  const tests = []
  for (const file of candidates.slice(0, 1000)) {
    const content = file.content || ''
    content.split('\n').forEach((line, index) => {
      const script = line.match(/\b(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/)
      const python = line.match(/^\s*def\s+(test_[A-Za-z0-9_]+)/)
      const go = line.match(/^\s*func\s+(Test[A-Za-z0-9_]+)/)
      const rust = line.match(/^\s*fn\s+(test_[A-Za-z0-9_]+)/)
      const name = script?.[1] || python?.[1] || go?.[1] || rust?.[1]
      if (!name) return
      const escapedName = name.replace(/["$`\\]/g, '\\$&')
      const escapedPath = file.path.replace(/["$`\\]/g, '\\$&')
      let command = `npm test -- --run "${escapedPath}" -t "${escapedName}"`
      if (python) command = `pytest "${escapedPath}::${escapedName}"`
      else if (go) command = `go test ./... -run "^${escapedName}$"`
      else if (rust) command = `cargo test "${escapedName}"`
      tests.push({ id: `${file.path}:${index + 1}:${name}`, name, path: file.path, line: index + 1, command })
    })
  }
  return tests.slice(0, 5000)
}

async function executeWorkspaceCommand(command, timeout = 120000) {
  if (remoteWorkspace) {
    return new Promise((resolve) => {
      const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
      remoteWorkspace.client.exec(`cd ${quote(remoteWorkspace.root)} && ${command}`, (error, stream) => {
        if (error) { resolve({ code: 1, stdout: '', stderr: error.message }); return }
        let stdout = ''
        let stderr = ''
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; stderr += '\nCommand timed out.'; stream.close() }, timeout)
        stream.on('data', (chunk) => { stdout += chunk.toString() })
        stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        stream.once('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : Number(code) || 0, stdout, stderr }) })
      })
    })
  }
  return new Promise((resolve) => {
    exec(command, { cwd: workspaceRoot, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', CI: '1' } }, (error, stdout, stderr) => resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout: stdout || '', stderr: stderr || '' }))
  })
}

async function runDiscoveredTest(testId) {
  if (typeof testId !== 'string' || testId.length > 2000) throw new Error('Invalid test id.')
  const test = (await discoverTests()).find((candidate) => candidate.id === testId)
  if (!test) throw new Error('The selected test is no longer available.')
  const startedAt = Date.now()
  const execution = await executeWorkspaceCommand(test.command)
  const output = `${execution.stdout}${execution.stderr}`.trim()
  const lines = output.split(/\r?\n/).filter(Boolean)
  const failures = lines.filter((line) => /(?:\bfail(?:ed|ure)?\b|\berror\b|assertionerror|expected.+received)/i.test(line)).slice(0, 100)
  const snapshots = lines.filter((line) => /snapshot/i.test(line)).slice(0, 100)
  const result = { id: test.id, status: execution.code === 0 ? 'passed' : 'failed', code: execution.code, durationMs: Date.now() - startedAt, stdout: execution.stdout, stderr: execution.stderr, output, failures, snapshots }
  return { ...result, coverage: await readCoverage() }
}

async function readCoverage() {
  if (!workspaceRoot && !remoteWorkspace) return {}
  for (const candidate of ['coverage/lcov.info', 'lcov.info']) {
    const content = remoteWorkspace
      ? await sftpCall(remoteWorkspace.sftp, 'readFile', safeRemotePath(candidate), { encoding: 'utf8' }).catch(() => '')
      : await fs.readFile(resolveWorkspacePath(candidate), 'utf8').catch(() => '')
    if (!content) continue
    const coverage = {}
    let source = ''
    for (const line of content.split('\n')) {
      if (line.startsWith('SF:')) source = remoteWorkspace
        ? path.posix.relative(remoteWorkspace.root, path.posix.resolve(remoteWorkspace.root, line.slice(3)))
        : path.relative(workspaceRoot, path.resolve(workspaceRoot, line.slice(3))).replaceAll(path.sep, '/')
      if (source && line.startsWith('DA:')) {
        const [lineNumber, hits] = line.slice(3).split(',').map(Number)
        if (!coverage[source]) coverage[source] = []
        coverage[source].push({ line: lineNumber, hits })
      }
    }
    return coverage
  }
  return {}
}

function extensionStatePath() {
  return path.join(app.getPath('userData'), 'extension-state.json')
}

async function disabledExtensionIds() {
  try { return new Set(JSON.parse(await fs.readFile(extensionStatePath(), 'utf8')).filter((id) => typeof id === 'string')) }
  catch { return new Set() }
}

async function scanExtensions() {
  const userExtensionRoot = path.join(app.getPath('userData'), 'extensions')
  const roots = [userExtensionRoot]
  if (workspaceRoot) roots.push(path.join(workspaceRoot, '.tungsten', 'extensions'))
  const disabled = await disabledExtensionIds()
  const extensions = []

  for (const root of roots) {
    let entries = []
    try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root, entry.name, 'extension.json'), 'utf8'))
        if (typeof manifest.id !== 'string' || typeof manifest.name !== 'string') continue
        const extensionEntry = typeof manifest.main === 'string' ? manifest.main : ''
        let verification = 'declarative'
        if (extensionEntry) {
          const entryPath = path.resolve(root, entry.name, extensionEntry)
          if (!entryPath.startsWith(`${path.resolve(root, entry.name)}${path.sep}`)) continue
          const digest = await fs.readFile(entryPath).then((content) => crypto.createHash('sha256').update(content).digest('hex')).catch(() => '')
          verification = manifest.integrity === `sha256-${digest}` ? 'verified' : 'unsigned'
        }
        extensions.push({
          id: manifest.id,
          name: manifest.name,
          version: String(manifest.version || '0.0.0'),
          description: String(manifest.description || ''),
          publisher: String(manifest.publisher || 'Local'),
          contributes: manifest.contributes || {},
          permissions: Array.isArray(manifest.permissions) ? manifest.permissions.filter((permission) => typeof permission === 'string').slice(0, 50) : [],
          entry: extensionEntry,
          verification,
          enabled: !disabled.has(manifest.id),
          scope: root === userExtensionRoot ? 'user' : 'workspace',
          location: path.join(root, entry.name),
        })
      } catch { /* Skip invalid extension folders. */ }
    }
  }
  return extensions
}

function startExtensionHost(extensions) {
  const previousHost = extensionHost
  if (previousHost?.connected) previousHost.kill()
  for (const { reject } of extensionRequests.values()) reject(new Error('Extension host restarted.'))
  extensionRequests.clear()
  const host = fork(path.join(__dirname, 'extension-host.cjs'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  extensionHost = host
  host.on('message', (message) => {
    if (message?.type === 'ready') host.send({ type: 'activate', extensions: extensions.filter((extension) => extension.enabled && extension.entry && extension.verification === 'verified' && extension.permissions.every((permission) => ['commands', 'themes', 'languages', 'keybindings', 'sidebar'].includes(permission))) })
    if (message?.type === 'result' && extensionRequests.has(message.requestId)) {
      const { resolve, reject } = extensionRequests.get(message.requestId)
      extensionRequests.delete(message.requestId)
      if (message.error) reject(new Error(message.error)); else resolve(message.value)
    }
    if (mainWindow && !mainWindow.isDestroyed() && ['activated', 'registered-command', 'log', 'error'].includes(message?.type)) mainWindow.webContents.send('extensions:event', message)
  })
  host.once('exit', () => {
    if (extensionHost !== host) return
    extensionHost = null
    for (const { reject } of extensionRequests.values()) reject(new Error('Extension host stopped.'))
    extensionRequests.clear()
  })
}

async function createProject(template, projectName) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(projectName)) throw new Error('Use a simple project name without spaces or path separators.')
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose a parent folder', properties: ['openDirectory', 'createDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
  const root = path.join(selection.filePaths[0], projectName)
  await fs.mkdir(root, { recursive: false })

  const templates = {
    web: {
      'index.html': '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New project</title><link rel="stylesheet" href="./src/styles.css"></head>\n<body><main id="app"></main><script type="module" src="./src/main.js"></script></body>\n</html>\n',
      'src/main.js': "document.querySelector('#app').innerHTML = '<h1>Forged with Tungsten</h1>'\n",
      'src/styles.css': ':root { font-family: system-ui; color-scheme: dark; }\nbody { margin: 0; padding: 3rem; background: #111; color: #eee; }\n',
      'package.json': JSON.stringify({ name: projectName, private: true, version: '0.1.0', scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: 'latest' } }, null, 2) + '\n',
    },
    node: {
      'src/index.js': "console.log('Forged with Tungsten')\n",
      'package.json': JSON.stringify({ name: projectName, private: true, version: '0.1.0', type: 'module', scripts: { start: 'node src/index.js', test: 'node --test' } }, null, 2) + '\n',
    },
    python: {
      'main.py': "def main():\n    print('Forged with Tungsten')\n\nif __name__ == '__main__':\n    main()\n",
      'pyproject.toml': `[project]\nname = "${projectName}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n`,
      'tests/test_main.py': 'def test_truth():\n    assert True\n',
    },
    rust: {
      'src/main.rs': 'fn main() {\n    println!("Forged with Tungsten");\n}\n',
      'Cargo.toml': `[package]\nname = "${projectName}"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\n`,
    },
    go: {
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Forged with Tungsten")\n}\n',
      'go.mod': `module ${projectName}\n\ngo 1.24\n`,
    },
  }
  const selectedTemplate = templates[template]
  if (!selectedTemplate) throw new Error('Unknown project template.')
  for (const [relativePath, content] of Object.entries(selectedTemplate)) {
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\ndist/\ntarget/\n.venv/\n.env\n', 'utf8')
  if (remoteWorkspace?.client) remoteWorkspace.client.end()
  remoteWorkspace = null
  resetWorkspaceLanguageServers()
  workspaceRoot = await fs.realpath(root)
  workspaceMounts = []
  await rememberWorkspace()
  await startWorkspaceWatcher()
  return workspacePayload()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111311',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    autoHideMenuBar: true,
    title: 'Tungsten IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDevelopment) {
    mainWindow.loadURL(process.env.TUNGSTEN_DEV_URL || 'http://localhost:5173')
    if (process.env.TUNGSTEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('desktop:open-folder', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a folder in Tungsten',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
  if (remoteWorkspace?.client) remoteWorkspace.client.end()
  remoteWorkspace = null
  resetWorkspaceLanguageServers()
  workspaceRoot = await fs.realpath(selection.filePaths[0])
  workspaceMounts = []
  await rememberWorkspace()
  await startWorkspaceWatcher()
  return workspacePayload()
})

ipcMain.handle('desktop:add-workspace-folder', async () => {
  if (!workspaceRoot || remoteWorkspace) throw new Error('Open a local workspace before adding another root.')
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Add folder to workspace', properties: ['openDirectory', 'createDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
  const mount = await addWorkspaceMount(selection.filePaths[0])
  if (!mount) return workspacePayload()
  for (const server of languageServers.values()) server.peer.notify('workspace/didChangeWorkspaceFolders', { event: { added: [{ uri: pathToFileURL(mount.path).href, name: mount.name }], removed: [] } })
  await rememberWorkspace()
  await startWorkspaceWatcher()
  return workspacePayload()
})
ipcMain.handle('desktop:remove-workspace-folder', async (_event, prefix) => {
  if (typeof prefix !== 'string' || !prefix.startsWith('@')) throw new Error('Invalid workspace root.')
  const removed = workspaceMounts.find((mount) => mount.prefix === prefix)
  workspaceMounts = workspaceMounts.filter((mount) => mount.prefix !== prefix)
  if (removed) for (const server of languageServers.values()) server.peer.notify('workspace/didChangeWorkspaceFolders', { event: { added: [], removed: [{ uri: pathToFileURL(removed.path).href, name: removed.name }] } })
  await rememberWorkspace()
  await startWorkspaceWatcher()
  return workspacePayload()
})

ipcMain.handle('desktop:restore-workspace', async () => {
  try {
    const recent = JSON.parse(await fs.readFile(recentWorkspacePath(), 'utf8'))
    if (remoteWorkspace?.client) remoteWorkspace.client.end()
    remoteWorkspace = null
    resetWorkspaceLanguageServers()
    workspaceRoot = await fs.realpath(recent.path)
    workspaceMounts = []
    for (const mountPath of Array.isArray(recent.mounts) ? recent.mounts.slice(0, 8) : []) await addWorkspaceMount(mountPath).catch(() => null)
    await startWorkspaceWatcher()
    return workspacePayload()
  } catch {
    workspaceRoot = null
    workspaceMounts = []
    return { canceled: true }
  }
})

ipcMain.handle('desktop:refresh-workspace', () => remoteWorkspace ? readRemoteWorkspace() : workspacePayload())
ipcMain.handle('remote:ssh-connect', (_event, configuration) => connectSshWorkspace(configuration))
ipcMain.handle('remote:ssh-disconnect', () => {
  resetWorkspaceLanguageServers()
  debugSessions.forEach((session) => session.peer.dispose())
  debugSessions.clear()
  if (remoteWorkspace?.client) remoteWorkspace.client.end()
  remoteWorkspace = null
  return { ok: true }
})
ipcMain.handle('remote:profiles', async () => {
  const result = { wsl: [], containers: [], devcontainer: false }
  if (process.platform === 'win32') result.wsl = await runFile('wsl.exe', ['-l', '-q']).then(({ stdout }) => stdout.replaceAll('\0', '').split(/\r?\n/).filter(Boolean)).catch(() => [])
  result.containers = await runFile('docker', ['ps', '--format', '{{.ID}}\x1f{{.Names}}\x1f{{.Image}}']).then(({ stdout }) => stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [id, name, image] = line.split('\x1f'); return { id, name, image } })).catch(() => [])
  if (workspaceRoot) result.devcontainer = await fs.access(path.join(workspaceRoot, '.devcontainer', 'devcontainer.json')).then(() => true).catch(() => false)
  return result
})

ipcMain.handle('desktop:write-file', async (_event, relativePath, content) => {
  if (typeof content !== 'string') throw new Error('File content must be text.')
  if (remoteWorkspace) {
    const destination = safeRemotePath(relativePath)
    const parent = path.posix.dirname(destination)
    await ensureRemoteDirectory(parent)
    await sftpCall(remoteWorkspace.sftp, 'writeFile', destination, content, { encoding: 'utf8', mode: 0o644 })
    return { ok: true }
  }
  const absolutePath = await resolveWritablePath(relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, content, 'utf8')
  return { ok: true }
})

ipcMain.handle('desktop:rename-path', async (_event, sourcePath, destinationPath) => {
  if (remoteWorkspace) {
    await sftpCall(remoteWorkspace.sftp, 'rename', safeRemotePath(sourcePath), safeRemotePath(destinationPath))
    return { ok: true }
  }
  const source = await resolveExistingWorkspacePath(sourcePath)
  const destination = await resolveWritablePath(destinationPath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.rename(source, destination)
  return { ok: true }
})

ipcMain.handle('desktop:delete-path', async (_event, relativePath) => {
  if (remoteWorkspace) {
    await sftpCall(remoteWorkspace.sftp, 'unlink', safeRemotePath(relativePath))
    return { ok: true }
  }
  const absolutePath = await resolveExistingWorkspacePath(relativePath)
  const stats = await fs.lstat(absolutePath)
  if (!stats.isFile()) throw new Error('Only files can be deleted from the explorer.')
  await fs.unlink(absolutePath)
  return { ok: true }
})

ipcMain.handle('desktop:reveal-path', async (_event, relativePath) => {
  shell.showItemInFolder(await resolveExistingWorkspacePath(relativePath))
  return { ok: true }
})
ipcMain.handle('desktop:absolute-path', (_event, relativePath) => remoteWorkspace ? safeRemotePath(relativePath) : resolveExistingWorkspacePath(relativePath))

ipcMain.handle('desktop:git-status', () => gitStatus())

ipcMain.handle('desktop:git-commit', async (_event, message) => {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw new Error('Enter a valid commit message.')
  await runFile('git', ['add', '--all'])
  const result = await runFile('git', ['commit', '-m', message.trim()])
  return { ok: true, output: `${result.stdout}${result.stderr}`.trim(), status: await gitStatus() }
})

ipcMain.handle('desktop:git-diff', async (_event, relativePath, staged = false) => {
  resolveWorkspacePath(relativePath)
  const args = ['diff']
  if (staged) args.push('--cached')
  args.push('--', relativePath)
  const result = await runFile('git', args)
  const diff = result.stdout || 'No textual differences.'
  const lines = diff.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
  const hunks = []
  if (firstHunk >= 0) {
    const header = lines.slice(0, firstHunk).join('\n')
    let start = firstHunk
    for (let index = firstHunk + 1; index <= lines.length; index += 1) {
      if (index === lines.length || lines[index].startsWith('@@')) {
        const body = lines.slice(start, index).join('\n')
        hunks.push({ id: `${relativePath}:${hunks.length}`, header: lines[start], patch: `${header}\n${body}\n` })
        start = index
      }
    }
  }
  return { diff, hunks }
})

ipcMain.handle('desktop:git-file-versions', async (_event, relativePath, staged = false) => {
  const { mount } = resolveWorkspaceTarget(relativePath)
  if (mount) throw new Error('Git comparison is currently scoped to the primary workspace root.')
  const readGitVersion = async (spec) => runFile('git', ['show', spec]).then((result) => result.stdout).catch(() => '')
  const before = await readGitVersion(staged ? `HEAD:${relativePath}` : `:${relativePath}`)
  let after = ''
  if (staged) after = await readGitVersion(`:${relativePath}`)
  else {
    try { after = await fs.readFile(await resolveExistingWorkspacePath(relativePath), 'utf8') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return { before, after, path: relativePath, staged }
})

ipcMain.handle('desktop:git-stage-hunk', async (_event, patch, reverse = false) => {
  if (typeof patch !== 'string' || patch.length > 1024 * 1024 || !patch.startsWith('diff --git ')) throw new Error('Invalid Git patch.')
  const args = ['apply', '--cached', '--recount', '--unidiff-zero', '--whitespace=nowarn']
  if (reverse) args.push('--reverse')
  await runFileInput('git', args, patch)
  return gitStatus()
})

ipcMain.handle('desktop:git-stage', async (_event, relativePath, staged) => {
  resolveWorkspacePath(relativePath)
  if (staged) await runFile('git', ['add', '--', relativePath])
  else await runFile('git', ['restore', '--staged', '--', relativePath])
  return gitStatus()
})

ipcMain.handle('desktop:git-branches', async () => {
  const { stdout } = await runFile('git', ['branch', '--format=%(refname:short)'])
  return stdout.split(/\r?\n/).filter(Boolean)
})

ipcMain.handle('desktop:git-checkout', async (_event, branch) => {
  if (typeof branch !== 'string' || !/^[\w./-]{1,200}$/.test(branch)) throw new Error('Invalid branch name.')
  await runFile('git', ['checkout', branch])
  return gitStatus()
})

ipcMain.handle('desktop:git-history', async (_event, limit = 100) => {
  const count = Math.max(1, Math.min(500, Number(limit) || 100))
  const { stdout } = await runFile('git', ['log', `-${count}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1e'])
  return stdout.split('\x1e').filter(Boolean).map((entry) => {
    const [hash, shortHash, author, date, subject, refs] = entry.trim().split('\x1f')
    return { hash, shortHash, author, date, subject, refs }
  })
})

ipcMain.handle('desktop:git-blame', async (_event, relativePath) => {
  resolveWorkspacePath(relativePath)
  const { stdout } = await runFile('git', ['blame', '--date=short', '--', relativePath])
  return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const match = line.match(/^(\^?[0-9a-f]+)\s+\((.*?)\s+(\d{4}-\d{2}-\d{2})\s+\d+\)\s?(.*)$/)
    return { line: index + 1, hash: match?.[1] || '', author: match?.[2]?.trim() || '', date: match?.[3] || '', content: match?.[4] || line }
  })
})

ipcMain.handle('desktop:git-stashes', async () => {
  const { stdout } = await runFile('git', ['stash', 'list', '--pretty=format:%gd%x1f%h%x1f%s'])
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [ref, hash, subject] = line.split('\x1f'); return { ref, hash, subject } })
})
ipcMain.handle('desktop:git-stash-push', async (_event, message) => {
  const args = ['stash', 'push', '--include-untracked']
  if (typeof message === 'string' && message.trim()) args.push('-m', message.trim().slice(0, 200))
  await runFile('git', args)
  return gitStatus()
})
ipcMain.handle('desktop:git-stash-pop', async (_event, reference = 'stash@{0}') => {
  if (typeof reference !== 'string' || !/^stash@\{\d+\}$/.test(reference)) throw new Error('Invalid stash reference.')
  await runFile('git', ['stash', 'pop', reference])
  return gitStatus()
})
ipcMain.handle('desktop:git-integrate', async (_event, operation, branch) => {
  if (!['merge', 'rebase'].includes(operation) || typeof branch !== 'string' || !/^[\w./-]{1,200}$/.test(branch)) throw new Error('Invalid Git integration request.')
  try { await runFile('git', [operation, branch]) } catch (error) {
    const status = await gitStatus()
    if (status.changes.some((change) => change.status.includes('U') || change.status === 'AA' || change.status === 'DD')) return status
    throw error
  }
  return gitStatus()
})
ipcMain.handle('desktop:git-operation-status', async () => {
  if (!workspaceRoot) return { operation: null, conflicts: [] }
  const gitDirectory = await runFile('git', ['rev-parse', '--git-dir']).then(({ stdout }) => path.resolve(workspaceRoot, stdout.trim())).catch(() => '')
  if (!gitDirectory) return { operation: null, conflicts: [] }
  const exists = (candidate) => fs.access(path.join(gitDirectory, candidate)).then(() => true).catch(() => false)
  const operation = await exists('MERGE_HEAD') ? 'merge' : await exists('rebase-merge') || await exists('rebase-apply') ? 'rebase' : null
  const { stdout } = await runFile('git', ['diff', '--name-only', '--diff-filter=U', '-z']).catch(() => ({ stdout: '' }))
  return { operation, conflicts: stdout.split('\0').filter(Boolean) }
})
ipcMain.handle('desktop:git-conflict-versions', async (_event, relativePath) => {
  const { mount } = resolveWorkspaceTarget(relativePath)
  if (mount) throw new Error('Git conflicts are scoped to the primary workspace root.')
  const show = (stage) => runFile('git', ['show', `:${stage}:${relativePath}`]).then(({ stdout }) => stdout).catch(() => '')
  const [base, ours, theirs] = await Promise.all([show(1), show(2), show(3)])
  return { path: relativePath, base, ours, theirs }
})
ipcMain.handle('desktop:git-resolve-conflict', async (_event, relativePath, resolution) => {
  if (!['ours', 'theirs', 'both', 'mark'].includes(resolution)) throw new Error('Invalid conflict resolution.')
  const { mount } = resolveWorkspaceTarget(relativePath)
  if (mount) throw new Error('Git conflicts are scoped to the primary workspace root.')
  const absolutePath = await resolveWritablePath(relativePath)
  if (resolution === 'ours' || resolution === 'theirs') await runFile('git', ['checkout', `--${resolution}`, '--', relativePath])
  if (resolution === 'both') {
    const show = (stage) => runFile('git', ['show', `:${stage}:${relativePath}`]).then(({ stdout }) => stdout).catch(() => '')
    const [ours, theirs] = await Promise.all([show(2), show(3)])
    await fs.writeFile(absolutePath, `${ours}${ours.endsWith('\n') || !ours ? '' : '\n'}${theirs}`, 'utf8')
  }
  await runFile('git', ['add', '--', relativePath])
  return gitStatus()
})
ipcMain.handle('desktop:git-operation-action', async (_event, operation, action) => {
  if (!['merge', 'rebase'].includes(operation) || !['continue', 'abort'].includes(action)) throw new Error('Invalid Git operation action.')
  const args = operation === 'merge' && action === 'continue' ? ['commit', '--no-edit'] : ['-c', 'core.editor=true', operation, `--${action}`]
  await runFile('git', args)
  return gitStatus()
})
ipcMain.handle('desktop:github-items', async () => {
  const [pullRequests, issues] = await Promise.all([
    runFile('gh', ['pr', 'list', '--limit', '30', '--json', 'number,title,state,author,url']).then(({ stdout }) => JSON.parse(stdout)).catch(() => []),
    runFile('gh', ['issue', 'list', '--limit', '30', '--json', 'number,title,state,author,url']).then(({ stdout }) => JSON.parse(stdout)).catch(() => []),
  ])
  return { pullRequests, issues }
})

ipcMain.handle('terminal:create', async (_event, columns = 80, rows = 24, profile = null) => {
  const id = `terminal-${++terminalSequence}`
  if (remoteWorkspace) {
    const stream = await new Promise((resolve, reject) => remoteWorkspace.client.shell({ term: 'xterm-256color', cols: columns, rows }, { cwd: remoteWorkspace.root }, (error, channel) => error ? reject(error) : resolve(channel)))
    const session = {
      write: (data) => stream.write(data),
      resize: (cols, nextRows) => stream.setWindow(nextRows, cols, 0, 0),
      kill: () => stream.close(),
    }
    terminalSessions.set(id, session)
    stream.on('data', (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', { id, data: data.toString() }) })
    stream.stderr?.on('data', (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', { id, data: data.toString() }) })
    stream.once('close', () => { terminalSessions.delete(id); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:exit', { id, code: 0 }) })
    stream.write(`cd -- '${remoteWorkspace.root.replaceAll("'", "'\\''")}'\r`)
    return { id, remote: true }
  }
  let shellPath = process.platform === 'win32' ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/bash'
  let shellArgs = process.platform === 'win32' ? [] : ['-l']
  if (profile?.kind === 'wsl' && process.platform === 'win32' && typeof profile.id === 'string' && profile.id.length < 200) {
    shellPath = 'wsl.exe'
    shellArgs = ['-d', profile.id]
  } else if (profile?.kind === 'container' && typeof profile.id === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(profile.id)) {
    shellPath = 'docker'
    shellArgs = ['exec', '-it', profile.id, '/bin/sh']
  }
  const session = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: Math.max(20, Math.min(400, Number(columns) || 80)),
    rows: Math.max(5, Math.min(200, Number(rows) || 24)),
    cwd: workspaceRoot || app.getPath('home'),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TUNGSTEN_IDE: '1' },
  })
  terminalSessions.set(id, session)
  session.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', { id, data })
  })
  session.onExit(({ exitCode }) => {
    terminalSessions.delete(id)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:exit', { id, code: exitCode })
  })
  return { id }
})

ipcMain.handle('terminal:write', (_event, id, data) => {
  if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid terminal input.')
  const session = terminalSessions.get(id)
  if (!session) throw new Error('Terminal session not found.')
  session.write(data)
  return { ok: true }
})

ipcMain.handle('terminal:resize', (_event, id, columns, rows) => {
  const session = terminalSessions.get(id)
  if (session) session.resize(Math.max(20, Math.min(400, Number(columns) || 80)), Math.max(5, Math.min(200, Number(rows) || 24)))
  return { ok: true }
})

ipcMain.handle('terminal:kill', (_event, id) => {
  const session = terminalSessions.get(id)
  if (session) session.kill()
  terminalSessions.delete(id)
  return { ok: true }
})

ipcMain.handle('lsp:file-uri', async (_event, relativePath) => remoteWorkspace ? remoteFileUri(safeRemotePath(relativePath)) : pathToFileURL(await resolveExistingWorkspacePath(relativePath)).href)
ipcMain.handle('lsp:start', (_event, language) => startLanguageServer(language))
ipcMain.handle('lsp:request', async (_event, language, method, params) => {
  if (typeof method !== 'string' || !/^[\w$/]+$/.test(method)) throw new Error('Invalid language service method.')
  const server = languageServers.get(language)
  if (!server) throw new Error(`The ${language} language server is not running.`)
  return server.peer.request(method, params)
})
ipcMain.handle('lsp:notify', (_event, language, method, params) => {
  const server = languageServers.get(language)
  if (!server) return { ok: false }
  server.peer.notify(method, params)
  return { ok: true }
})
ipcMain.handle('lsp:stop', (_event, language) => {
  const server = languageServers.get(language)
  if (server) server.peer.dispose()
  languageServers.delete(language)
  return { ok: true }
})

function expandDebugVariables(value) {
  if (typeof value === 'string') return value.replaceAll('${workspaceFolder}', remoteWorkspace?.root || workspaceRoot || '')
  if (Array.isArray(value)) return value.map(expandDebugVariables)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandDebugVariables(item)]))
  return value
}

ipcMain.handle('debug:start', async (_event, configuration) => {
  if (!workspaceRoot && !remoteWorkspace) throw new Error('Open a workspace before debugging.')
  const adapter = configuration?.adapter
  if (!adapter || typeof adapter.command !== 'string' || !adapter.command) throw new Error('The launch configuration needs an adapter command.')
  const id = `debug-${Date.now()}`
  const args = Array.isArray(adapter.args) ? adapter.args : []
  const child = remoteWorkspace ? spawnRemoteLanguageServer({ command: adapter.command, args, env: {} }) : spawn(adapter.command, args, {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...(adapter.env || {}) },
  })
  let session
  const peer = new StdioJsonPeer(child, (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:message', { id, message })
    if (message.type === 'response' && message.command === 'initialize' && message.success !== false) {
      peer.send({ type: 'request', seq: ++session.sequence, command: configuration.request || 'launch', arguments: expandDebugVariables(configuration.arguments || {}) })
    }
  })
  session = { child, peer, sequence: 0 }
  debugSessions.set(id, session)
  child.stderr.on('data', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:output', { id, output: data.toString() })
  })
  child.on('exit', (code) => {
    debugSessions.delete(id)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:exit', { id, code })
  })
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    return { id }
  } catch (error) {
    debugSessions.delete(id)
    peer.dispose()
    throw error
  }
})

ipcMain.handle('debug:send', (_event, id, message) => {
  const session = debugSessions.get(id)
  if (!session) throw new Error('Debug session not found.')
  session.peer.send({ ...message, seq: ++session.sequence })
  return { ok: true }
})

ipcMain.handle('debug:stop', (_event, id) => {
  const session = debugSessions.get(id)
  if (session) session.peer.dispose()
  debugSessions.delete(id)
  return { ok: true }
})

ipcMain.handle('workspace:search', (_event, query, limit) => searchWorkspace(query, limit))
ipcMain.handle('project:detect', () => detectProject())
ipcMain.handle('project:discover-tests', () => discoverTests())
ipcMain.handle('project:run-test', (_event, testId) => runDiscoveredTest(testId))
ipcMain.handle('project:coverage', () => readCoverage())
ipcMain.handle('project:create', (_event, template, name) => createProject(template, name))

ipcMain.handle('extensions:scan', async () => {
  const extensions = await scanExtensions()
  startExtensionHost(extensions)
  return extensions
})
ipcMain.handle('extensions:install-folder', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Install a Tungsten extension', properties: ['openDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true, extensions: await scanExtensions() }
  const source = selection.filePaths[0]
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'extension.json'), 'utf8'))
  if (typeof manifest.id !== 'string' || !/^[a-z0-9._-]+$/i.test(manifest.id)) throw new Error('The extension has an invalid id.')
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.filter((permission) => typeof permission === 'string') : []
  const approval = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Install'],
    defaultId: 0,
    cancelId: 0,
    title: 'Review extension permissions',
    message: `Install ${manifest.name || manifest.id}?`,
    detail: `${permissions.length ? `Requested permissions: ${permissions.join(', ')}` : 'No runtime permissions requested.'}\n\nExecutable extensions run only when their entry point has a matching SHA-256 integrity declaration.`,
  })
  if (approval.response !== 1) return { canceled: true, extensions: await scanExtensions() }
  const destinationRoot = path.join(app.getPath('userData'), 'extensions')
  const destination = path.join(destinationRoot, manifest.id)
  await fs.mkdir(destinationRoot, { recursive: true })
  await fs.rm(destination, { recursive: true, force: true })
  await fs.cp(source, destination, { recursive: true })
  const extensions = await scanExtensions()
  startExtensionHost(extensions)
  return { canceled: false, extensions }
})

ipcMain.handle('extensions:set-enabled', async (_event, extensionId, enabled) => {
  if (typeof extensionId !== 'string' || !/^[a-z0-9._-]+$/i.test(extensionId) || typeof enabled !== 'boolean') throw new Error('Invalid extension state.')
  const disabled = await disabledExtensionIds()
  if (enabled) disabled.delete(extensionId); else disabled.add(extensionId)
  await fs.writeFile(extensionStatePath(), JSON.stringify([...disabled], null, 2), 'utf8')
  const extensions = await scanExtensions()
  startExtensionHost(extensions)
  return extensions
})
ipcMain.handle('extensions:uninstall', async (_event, extensionId) => {
  if (typeof extensionId !== 'string' || !/^[a-z0-9._-]+$/i.test(extensionId)) throw new Error('Invalid extension id.')
  const extensions = await scanExtensions()
  const extension = extensions.find((candidate) => candidate.id === extensionId)
  const userRoot = path.join(app.getPath('userData'), 'extensions')
  if (!extension || !extension.location.startsWith(`${userRoot}${path.sep}`)) throw new Error('Only user-installed extensions can be uninstalled here.')
  const approval = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Cancel', 'Uninstall'], defaultId: 0, cancelId: 0, title: 'Uninstall extension', message: `Uninstall ${extension.name}?` })
  if (approval.response !== 1) return extensions
  await fs.rm(extension.location, { recursive: true, force: true })
  const updated = await scanExtensions()
  startExtensionHost(updated)
  return updated
})

ipcMain.handle('extensions:execute', (_event, command, args = []) => {
  if (!extensionHost?.connected || typeof command !== 'string') throw new Error('Extension host is unavailable.')
  const requestId = ++extensionRequestSequence
  return new Promise((resolve, reject) => {
    extensionRequests.set(requestId, { resolve, reject })
    extensionHost.send({ type: 'execute', requestId, command, args: Array.isArray(args) ? args.slice(0, 20) : [] })
    setTimeout(() => {
      if (!extensionRequests.has(requestId)) return
      extensionRequests.delete(requestId)
      reject(new Error('Extension command timed out.'))
    }, 12000)
  })
})

ipcMain.handle('collaboration:host', (_event, displayName) => hostCollaborationRoom(String(displayName || '').slice(0, 80)))
ipcMain.handle('collaboration:join', (_event, url, displayName) => joinCollaborationRoom(url, String(displayName || '').slice(0, 80)))
ipcMain.handle('collaboration:publish', (_event, relativePath, content) => {
  if (!collaborationDocument || typeof relativePath !== 'string' || typeof content !== 'string' || content.length > MAX_FILE_BYTES) throw new Error('Invalid collaboration update.')
  collaborationDocument.getMap('files').set(relativePath.slice(0, 1000), content)
  return { ok: true }
})
ipcMain.handle('collaboration:event', (_event, message) => {
  if (!message || !['presence', 'comment', 'signal'].includes(message.type)) throw new Error('Invalid collaboration event.')
  handleCollaborationMessage(JSON.stringify({ ...message, text: typeof message.text === 'string' ? message.text.slice(0, 5000) : message.text }), null)
  return { ok: true }
})
ipcMain.handle('collaboration:leave', () => {
  collaborationJoin = null
  clearTimeout(collaborationReconnectTimer)
  collaborationSocket?.close()
  collaborationServer?.close()
  collaborationSocket = null
  collaborationServer = null
  collaborationPeers.clear()
  collaborationDocument?.destroy()
  collaborationDocument = null
  return { ok: true }
})

ipcMain.handle('recovery:save', async (_event, snapshot) => {
  const serialized = JSON.stringify(snapshot)
  if (serialized.length > 10 * 1024 * 1024) throw new Error('Recovery snapshot is too large.')
  await fs.writeFile(path.join(app.getPath('userData'), 'recovery.json'), serialized, 'utf8')
  return { ok: true }
})
ipcMain.handle('recovery:load', async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'recovery.json'), 'utf8')) } catch { return null }
})
ipcMain.handle('recovery:clear', async () => {
  await fs.rm(path.join(app.getPath('userData'), 'recovery.json'), { force: true })
  return { ok: true }
})

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { available: false, message: 'Updates are checked in packaged builds.' }
  const result = await autoUpdater.checkForUpdates()
  return { available: Boolean(result?.updateInfo), info: result?.updateInfo || null }
})
ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())

ipcMain.handle('desktop:run-command', async (_event, command) => {
  if (!workspaceRoot && !remoteWorkspace) throw new Error('Open a workspace before running commands.')
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Invalid command.')
  return executeWorkspaceCommand(command)
})

ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only HTTP links can be opened.')
  await shell.openExternal(url)
  return { ok: true }
})

for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
  autoUpdater.on(event, (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:status', { event, payload: payload instanceof Error ? { message: payload.message } : payload })
  })
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => undefined), 5000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (workspaceWatcher) void workspaceWatcher.close()
  if (remoteWorkspace?.client) remoteWorkspace.client.end()
  collaborationJoin = null
  clearTimeout(collaborationReconnectTimer)
  collaborationSocket?.close()
  collaborationServer?.close()
  if (extensionHost?.connected) extensionHost.kill()
  clearTimeout(watcherDebounce)
  terminalSessions.forEach((session) => session.kill())
  languageServers.forEach((server) => server.peer.dispose())
  debugSessions.forEach((session) => session.peer.dispose())
  terminalSessions.clear()
  languageServers.clear()
  debugSessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
