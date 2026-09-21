import { spawn } from 'node:child_process'
import process from 'node:process'

const port = 4178
const server = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
})
let logs = ''
server.stdout.on('data', (chunk) => { logs += chunk })
server.stderr.on('data', (chunk) => { logs += chunk })

try {
  let response
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (!response?.ok) throw new Error(`Preview did not become ready.\n${logs}`)
  const html = await response.text()
  if (!html.includes('<title>Tungsten IDE</title>') || !html.includes('id="root"')) throw new Error('The production shell is missing Tungsten bootstrap markup.')
  const asset = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
  if (!asset) throw new Error('The production shell did not include an application bundle.')
  const bundle = await fetch(new URL(asset, `http://127.0.0.1:${port}/`))
  const bundleBytes = bundle.ok ? (await bundle.arrayBuffer()).byteLength : 0
  if (!bundle.ok || bundleBytes < 1000) throw new Error('The application bundle could not be loaded.')
  console.log('Tungsten production E2E smoke passed')
} finally {
  server.kill('SIGTERM')
}
