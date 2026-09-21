'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')

const commands = new Map()

function post(message) {
  if (process.send) process.send(message)
}

async function activateExtension(extension) {
  if (!extension.entry) return
  const entry = path.resolve(extension.location, extension.entry)
  if (!entry.startsWith(`${path.resolve(extension.location)}${path.sep}`)) throw new Error('Extension entry escapes its package.')
  const source = await fs.readFile(entry, 'utf8')
  const api = Object.freeze({
    registerCommand(id, handler) {
      if (typeof id !== 'string' || !id.startsWith(`${extension.id}.`) || typeof handler !== 'function') throw new Error('Invalid extension command registration.')
      commands.set(id, { extensionId: extension.id, handler })
      post({ type: 'registered-command', id, extensionId: extension.id })
    },
    log(message) { post({ type: 'log', extensionId: extension.id, message: String(message).slice(0, 4000) }) },
  })
  const context = vm.createContext(Object.freeze({
    tungsten: api,
    console: Object.freeze({ log: api.log, warn: api.log, error: api.log }),
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
  }), { name: `extension:${extension.id}`, codeGeneration: { strings: false, wasm: false } })
  const wrapped = `(async (tungsten) => { "use strict"; ${source}\n })`
  const activate = new vm.Script(wrapped, { filename: entry }).runInContext(context, { timeout: 1000 })
  await Promise.race([activate(api), new Promise((_, reject) => setTimeout(() => reject(new Error('Extension activation timed out.')), 5000))])
}

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'activate') {
    for (const extension of message.extensions || []) {
      try { await activateExtension(extension); post({ type: 'activated', extensionId: extension.id }) }
      catch (error) { post({ type: 'error', extensionId: extension.id, message: error.message }) }
    }
  }
  if (message.type === 'execute') {
    const command = commands.get(message.command)
    if (!command) return post({ type: 'result', requestId: message.requestId, error: 'Extension command not found.' })
    try {
      const value = await Promise.race([Promise.resolve(command.handler(...(Array.isArray(message.args) ? message.args : []))), new Promise((_, reject) => setTimeout(() => reject(new Error('Extension command timed out.')), 10000))])
      post({ type: 'result', requestId: message.requestId, value: JSON.parse(JSON.stringify(value ?? null)) })
    } catch (error) {
      post({ type: 'result', requestId: message.requestId, error: error.message })
    }
  }
})

post({ type: 'ready' })
