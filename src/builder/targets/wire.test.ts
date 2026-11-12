/**
 * The wire plan, and the Dart it turns into.
 *
 * The web runtime carries all four dialects and chooses at run time.
 * A phone app cannot: it is built for one project, whose backend is
 * known while it is being emitted. So the Flutter target writes the
 * code for that one backend — PostgREST paths for a Supabase project,
 * a PocketBase filter expression for a PocketBase one — and the
 * generated app contains no dialect table at all.
 *
 * What is worth testing is therefore not "does it compile" but "is the
 * emitted source the right source": the paths, the envelope each
 * backend wraps its rows in, where the token goes, and the three
 * places a value a user typed becomes syntax.
 */

import { describe, expect, it } from 'vitest'

import { pathParts, renderPath, wirePlan } from './wire'
import { runtimeProfileFor } from '../../backend/runtimeProfile'
import { flutterFiles } from './flutter'
import { DEFAULT_PROJECT, type Ir } from '../compile'
import type { BackendSettings } from '../../backend/registry'

const SUPABASE: BackendSettings = {
  adapter: 'supabase',
  config: { url: 'https://demo.supabase.co', anonKey: 'anon-key', serviceKey: 'service-key' },
}
const POCKETBASE: BackendSettings = { adapter: 'pocketbase', config: { url: 'http://127.0.0.1:8090' } }
const VORTEX: BackendSettings = { adapter: 'vortex', config: { projectKey: 'proj_1' } }
const SELF: BackendSettings = { adapter: 'self-hosted', config: { url: 'https://api.example.com' } }

const planFor = (settings?: BackendSettings) => wirePlan(settings ? runtimeProfileFor(settings) : undefined)

const EMPTY_IR: Ir = {
  version: 1,
  home: 'home',
  components: [],
  screens: [{ name: 'home', components: [], events: [] }],
  events: [],
  tables: [],
}

/** The runtime file a Flutter build would write for this backend. */
function dart(settings?: BackendSettings): string {
  const files = flutterFiles({
    root: 'mobile',
    ir: EMPTY_IR,
    project: DEFAULT_PROJECT,
    kind: 'mobile',
    profile: settings ? runtimeProfileFor(settings) : undefined,
  })
  return files.find((file) => file.path.endsWith('runtime.dart'))!.contents
}

/* ----------------------------------------------------------------- plans */

describe('the wire plan', () => {
  it('falls back to the generated service when a project has no backend', () => {
    const plan = planFor()
    expect(plan.dialect).toBe('tungsten')
    expect(plan.base).toBe('')
    expect(plan.list).toMatchObject({ method: 'GET', path: '/data/{table}', envelope: 'rows' })
    expect(plan.headers).toEqual([])
  })

  it('knows where each backend keeps its rows', () => {
    expect(planFor(SUPABASE).list.envelope).toBe('array')
    expect(planFor(POCKETBASE).list.envelope).toBe('items')
    expect(planFor(VORTEX).list.envelope).toBe('rows')
    expect(planFor(SELF).list.envelope).toBe('rows')
  })

  it('knows the two backends that do not hand a session straight back', () => {
    // PocketBase creates the record without signing it in; everybody
    // else answers sign-up with a token.
    expect(planFor(POCKETBASE).signUp).toMatchObject({ body: 'record', thenSignIn: true })
    expect(planFor(SUPABASE).signUp.thenSignIn).toBe(false)
    // And one where signing out is a local act with nothing to call.
    expect(planFor(POCKETBASE).signOut).toBeNull()
    expect(planFor(SUPABASE).signOut).toMatchObject({ path: '/auth/v1/logout' })
  })

  it('asks PostgREST for the row it just wrote', () => {
    // Without this header a POST answers 201 with an empty body and the
    // block's "saved row" output is nothing at all.
    expect(planFor(SUPABASE).create.prefer).toBe('return=representation')
    expect(planFor(SUPABASE).create.envelope).toBe('first')
    expect(planFor(VORTEX).create.wrap).toBe('row')
    expect(planFor(SELF).create.wrap).toBeNull()
  })

  it('fills the placeholders in a path, in whatever language asked', () => {
    expect(pathParts('/data/{table}/{id}', { table: 'table', id: 'id' })).toEqual([
      { text: '/data/' }, { slot: 'table' }, { text: '/' }, { slot: 'id' },
    ])
    expect(renderPath('/data/{table}', { table: 'table' }, {
      quote: (text) => `"${text}"`,
      escape: (expression) => `encode(${expression})`,
      join: ' + ',
    })).toBe('"/data/" + encode(table)')
  })

  it('refuses a path whose placeholder the call cannot fill', () => {
    // Better here, loudly, than as the literal text {bucket} in a URL
    // inside somebody's shipped app.
    expect(() => pathParts('/storage/{bucket}', { table: 'table' })).toThrowError(/uses \{bucket\}/)
  })
})

/* ------------------------------------------------------------ the Dart */

describe('the Flutter runtime', () => {
  it('is written for one backend, not for all four', () => {
    const source = dart(SUPABASE)
    expect(source).toContain("'/rest/v1/' + Uri.encodeComponent(table)")
    // No dialect table, no branching on a profile: this app has one
    // backend and the code says which.
    expect(source).not.toContain('/api/collections/')
    expect(source).not.toContain('/v1/data/')
    expect(source).not.toContain('/data/')
  })

  it('sends the publishable key on every call, and the session token over it', () => {
    const source = dart(SUPABASE)
    expect(source).toContain("request.headers.set('apikey', 'anon-key');")
    expect(source).toContain("if (token != null) request.headers.set('authorization', 'Bearer ' + token);")
    // The key that bypasses every row policy is not in a phone app.
    expect(source).not.toContain('service-key')
  })

  it('sends PocketBase a bare token, because that is what it reads', () => {
    expect(dart(POCKETBASE)).toContain("request.headers.set('authorization', token);")
    expect(dart(POCKETBASE)).not.toContain("'' + token")
  })

  it('escapes a value that is about to become PocketBase syntax', () => {
    const source = dart(POCKETBASE)
    expect(source).toContain('.replaceAll("\'", "\\\\\'")')
    expect(source).toContain("'?filter=' + Uri.encodeQueryComponent(tests)")
  })

  it('posts a filter tree to Vortex and a query string to the local service', () => {
    expect(dart(VORTEX)).toContain("{'column': entry.key, 'op': 'eq', 'value': entry.value}")
    expect(dart(VORTEX)).toContain("method: 'POST', body: _where(where)");
    expect(dart(SELF)).toContain("'?' + where.entries")
  })

  it('unwraps the reply where that backend actually puts it', () => {
    expect(dart(SUPABASE)).toContain('return _rows(reply);')
    expect(dart(POCKETBASE)).toContain("return _rows(_map(reply)['items']);")
    expect(dart(VORTEX)).toContain("return _rows(_map(reply)['rows']);")
  })

  it('signs a new PocketBase account in, and keeps its record as the user', () => {
    const source = dart(POCKETBASE)
    expect(source).toContain('return signIn(email, password);')
    expect(source).toContain("body: {'email': email, 'password': password, 'passwordConfirm': password}")
    expect(source).toContain("final user = map['record'];")
    // Nothing to call: the refusal is a comment, not a request that 404s.
    expect(source).toContain('Signing out is local here')
  })

  it('builds the right URL for a file, per backend', () => {
    expect(dart(SUPABASE)).toContain("Backend.baseUrl + '/storage/v1/object/public/'")
    // PocketBase keeps files on records, so the id comes back with the
    // upload and goes into the address.
    expect(dart(POCKETBASE)).toContain("'/api/files/'")
    expect(dart(POCKETBASE)).toContain('multipart/form-data; boundary=')
    expect(dart(VORTEX)).toContain("final url = toText(reply['url']);")
    // A name in the path means it does not also need a header.
    expect(dart(SUPABASE)).not.toContain('x-file-name')
    expect(dart()).toContain('x-file-name')
  })

  it('still knows an emulator cannot see localhost', () => {
    // 10.0.2.2 is the host machine from inside the Android emulator, and
    // this is the most common first-run failure there — including when
    // the backend is a PocketBase binary on the developer's own laptop.
    expect(dart(POCKETBASE)).toContain("? 'http://10.0.2.2:8090'")
    expect(dart(POCKETBASE)).toContain(": 'http://127.0.0.1:8090'")
    // A real address is taken literally, with no platform guessing.
    expect(dart(SELF)).toContain("static String baseUrl = 'https://api.example.com';")
    expect(dart(SUPABASE)).not.toContain('Platform.isAndroid')
  })

  it('reports the sentence the backend chose, whichever key it used', () => {
    expect(dart(SUPABASE)).toContain("map['error'] ?? map['message'] ?? map['msg']")
  })
})
