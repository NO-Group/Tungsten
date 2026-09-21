import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'

const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage', 'target', 'build'])
const root = path.resolve(process.argv[2] || '.')
const started = performance.now()
let files = 0
let bytes = 0
const queue = [root]

while (queue.length && files < 100_000) {
  const directory = queue.shift()
  let entries = []
  try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { continue }
  for (const entry of entries) {
    if (entry.isDirectory() && !ignored.has(entry.name)) queue.push(path.join(directory, entry.name))
    else if (entry.isFile()) {
      files += 1
      bytes += (await fs.stat(path.join(directory, entry.name))).size
    }
  }
}

const elapsed = performance.now() - started
const result = { root, files, megabytes: Number((bytes / 1024 / 1024).toFixed(2)), milliseconds: Number(elapsed.toFixed(2)), filesPerSecond: Math.round(files / (elapsed / 1000)), heapMegabytes: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)) }
console.log(JSON.stringify(result, null, 2))
if (files && result.filesPerSecond < 100) process.exitCode = 1
