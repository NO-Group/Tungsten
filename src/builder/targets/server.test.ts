import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compile, type CompiledFile } from '../compile'
import { builtinBlocks } from '../blockLibrary'
import { addNode, createNode, resetIds } from '../graph'
import { createRegistry, type BlockGraph } from '../blockSchema'
import { createOrganization, createProject } from '../../project/targets'
import type { DataSchema } from '../dataSchema'

const registry = createRegistry(builtinBlocks)

const schema: DataSchema = {
  tables: [
    {
      name: 'notes',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'done', type: 'boolean' },
      ],
    },
  ],
}

/** The smallest graph that compiles: the backend does not depend on it. */
function graph(): BlockGraph {
  resetIds()
  return addNode({ nodes: [], connections: [] }, createNode('event.start', { x: 0, y: 0 }))
}

function emit(tables: DataSchema = schema): CompiledFile[] {
  const project = createProject(createOrganization('Acme'), 'Timer')
  const result = compile({ graph: graph(), registry, target: 'server', project, schema: tables })
  if (!result.ok) throw new Error(result.reason)
  return result.files
}

const read = (files: CompiledFile[], name: string) => {
  const file = files.find((entry) => entry.path.endsWith(name))
  if (!file) throw new Error(`No ${name} in ${files.map((entry) => entry.path).join(', ')}`)
  return file.contents
}

describe('the backend service, as source', () => {
  it('writes itself under the project, beside the targets that call it', () => {
    expect(emit().map((file) => file.path)).toEqual([
      'targets/timer/server/main.js',
      'targets/timer/server/schema.sql',
      'targets/timer/server/package.json',
      'targets/timer/server/.gitignore',
      'targets/timer/server/README.md',
    ])
  })

  it('has no dependencies to install', () => {
    const manifest = JSON.parse(read(emit(), 'package.json'))
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.devDependencies).toBeUndefined()
    expect(manifest.scripts.start).toBe('node main.js')
    expect(manifest.engines.node).toBe('>=22.5')
  })

  it('turns the drawn tables into SQLite, not Postgres', () => {
    const sql = read(emit(), 'schema.sql')
    expect(sql).toContain('create table if not exists notes (')
    expect(sql).toContain('  id integer primary key autoincrement')
    expect(sql).toContain('  title text not null')
    expect(sql).toContain('  done integer')
    // The Postgres spellings the migration file uses would all be syntax
    // errors here.
    expect(sql).not.toContain('bigserial')
    expect(sql).not.toContain('timestamptz')
    expect(sql).not.toContain('jsonb')
  })

  it('always has accounts, sessions and files, whatever was drawn', () => {
    const sql = read(emit({ tables: [] }), 'schema.sql')
    expect(sql).toContain('create table if not exists users (')
    expect(sql).toContain('create table if not exists sessions (')
    expect(sql).toContain('create table if not exists files (')
    expect(sql).toContain('No tables drawn yet')
  })

  it('will not touch a table that was never drawn', () => {
    const main = read(emit(), 'main.js')
    expect(main).toContain('"notes": [\'title\', \'done\'],')
    expect(main).toContain('No table called ')
  })

  it('never interpolates a value into SQL', () => {
    const main = read(emit(), 'main.js')
    // Identifiers come from the generated map; values are always bound.
    const statements = main.match(/'(select|insert|update|delete)[^']*'/g) ?? []
    expect(statements.length).toBeGreaterThan(5)
    for (const statement of statements) expect(statement).not.toContain('${')
  })

  it('hashes passwords with scrypt and compares them in constant time', () => {
    const main = read(emit(), 'main.js')
    expect(main).toContain('scryptSync(password, salt, 64)')
    expect(main).toContain('timingSafeEqual')
    expect(main).not.toContain('password_hash: password')
  })

  it('says how to close it up before it leaves the machine', () => {
    const readme = read(emit(), 'README.md')
    expect(readme).toContain('TUNGSTEN_REQUIRE_AUTH=1')
    expect(readme).toContain('TUNGSTEN_ORIGIN')
    expect(readme).toContain('/data/notes')
  })
})

describe('the backend service, running', () => {
  let child: ChildProcess | undefined
  let base = ''

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'tungsten-server-'))
    for (const file of emit()) {
      const out = join(root, file.path.split('/server/')[1])
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, file.contents)
    }

    const port = 8900 + Math.floor(Math.random() * 400)
    base = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, ['main.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const response = await fetch(`${base}/health`)
        if (response.ok) return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    throw new Error('The generated backend never came up.')
  }, 30_000)

  afterAll(() => {
    child?.kill('SIGTERM')
  })

  const post = (path: string, body: unknown, token?: string) => fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  it('knows which tables it is answering for', async () => {
    const health = await (await fetch(`${base}/health`)).json()
    expect(health).toMatchObject({ ok: true, service: 'Timer', tables: ['notes'] })
  })

  it('signs a user up, remembers the session, and signs them out', async () => {
    const created = await post('/auth/sign-up', { email: 'ada@example.com', password: 'correct horse' })
    expect(created.status).toBe(201)
    const { token, user } = await created.json()
    expect(user).toMatchObject({ email: 'ada@example.com', provider: 'password' })
    expect(token).toHaveLength(64)

    const session = await (await fetch(`${base}/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()
    expect(session.user.email).toBe('ada@example.com')

    await post('/auth/sign-out', {}, token)
    const after = await (await fetch(`${base}/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()
    expect(after.user).toBeUndefined()
  })

  it('refuses a second account on the same email', async () => {
    await post('/auth/sign-up', { email: 'grace@example.com', password: 'correct horse' })
    const again = await post('/auth/sign-up', { email: 'grace@example.com', password: 'correct horse' })
    expect(again.status).toBe(409)
  })

  it('says the same thing whether the email or the password was wrong', async () => {
    await post('/auth/sign-up', { email: 'alan@example.com', password: 'correct horse' })
    const wrongPassword = await post('/auth/sign-in', { email: 'alan@example.com', password: 'nope' })
    const noSuchUser = await post('/auth/sign-in', { email: 'nobody@example.com', password: 'nope' })
    expect(wrongPassword.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(await wrongPassword.json()).toEqual(await noSuchUser.json())
  })

  it('inserts, reads back, changes and deletes a row of a drawn table', async () => {
    const created = await post('/data/notes', { title: 'Write it down', done: false })
    expect(created.status).toBe(201)
    const { row } = await created.json()
    expect(row).toMatchObject({ title: 'Write it down', done: 0 })

    const list = await (await fetch(`${base}/data/notes?title=Write%20it%20down`)).json()
    expect(list.rows).toHaveLength(1)

    const changed = await (await fetch(`${base}/data/notes/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })).json()
    expect(changed.row.done).toBe(1)

    await fetch(`${base}/data/notes/${row.id}`, { method: 'DELETE' })
    const gone = await fetch(`${base}/data/notes/${row.id}`)
    expect(gone.status).toBe(404)
  })

  it('drops a field that is not a column, rather than writing it', async () => {
    const { row } = await (await post('/data/notes', { title: 'Fine', sneaky: 'rm -rf' })).json()
    expect(row.sneaky).toBeUndefined()
    expect(row.title).toBe('Fine')
  })

  it('has nothing to say about a table nobody drew', async () => {
    const missing = await fetch(`${base}/data/secrets`)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toContain('secrets')
  })

  it('takes a file and gives it back', async () => {
    const uploaded = await fetch(`${base}/storage/avatars`, {
      method: 'POST',
      headers: { 'x-file-name': 'face.png' },
      body: 'some bytes',
    })
    expect(uploaded.status).toBe(201)
    const { url, name, size } = await uploaded.json()
    expect(size).toBe(10)
    // The name is generated, never the one the caller sent: an upload must
    // not choose where on disk it lands.
    expect(name).not.toContain('face')
    expect(name.endsWith('.png')).toBe(true)
    expect(await (await fetch(url.replace(/^http:\/\/[^/]+/, base))).text()).toBe('some bytes')
  })

  it('will not serve its way out of the uploads folder', async () => {
    const escape = await fetch(`${base}/storage/avatars/..%2F..%2Fmain.js`)
    expect(escape.status).toBe(404)
  })

  it('refuses an OAuth provider it has no keys for, and says which', async () => {
    const refused = await post('/auth/oauth', { provider: 'github' })
    expect(refused.status).toBe(501)
    expect((await refused.json()).error).toContain('GITHUB_CLIENT_ID')

    const unknown = await post('/auth/oauth', { provider: 'myspace' })
    expect(unknown.status).toBe(400)
  })

  it('answers a browser preflight', async () => {
    const options = await fetch(`${base}/data/notes`, { method: 'OPTIONS' })
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-headers')).toContain('authorization')
  })
})
