/**
 * The wire plan, and the Dart, Kotlin and Swift it turns into.
 *
 * The web runtime carries every dialect and chooses at run time.
 * A phone app cannot: it is built for one project, whose backend is
 * known while it is being emitted. So each mobile target writes the
 * code for that one backend — PostgREST paths for a Supabase project,
 * a PocketBase filter expression for a PocketBase one — and the
 * generated app contains no dialect table at all.
 *
 * All three languages read the same plan, so the tests below are
 * deliberately the same tests three times over: whatever the plan says
 * about an envelope or a token has to come out of Dart, Kotlin and
 * Swift alike, or a project's Android build and its iOS build disagree
 * about the backend they share.
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
import { androidFiles } from './android'
import { iosFiles } from './ios'
import { DEFAULT_PROJECT, type Ir } from '../compile'
import type { BackendSettings } from '../../backend/registry'

const SUPABASE: BackendSettings = {
  adapter: 'supabase',
  config: { url: 'https://demo.supabase.co', anonKey: 'anon-key', serviceKey: 'service-key' },
}
const POCKETBASE: BackendSettings = { adapter: 'pocketbase', config: { url: 'http://127.0.0.1:8090' } }
const VORTEX: BackendSettings = { adapter: 'vortex', config: { projectKey: 'proj_1' } }
const SELF: BackendSettings = { adapter: 'self-hosted', config: { url: 'https://api.example.com' } }
const APPWRITE: BackendSettings = {
  adapter: 'appwrite',
  config: { url: 'https://cloud.appwrite.io/v1', projectId: 'proj1', databaseId: 'main', apiKey: 'server-key' },
}

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

/** The runtime file a Kotlin build would write for this backend. */
function kotlin(settings?: BackendSettings): string {
  const files = androidFiles(EMPTY_IR, DEFAULT_PROJECT, settings ? runtimeProfileFor(settings) : undefined)
  return files.find((file) => file.path.endsWith('Runtime.kt'))!.contents
}

/** The runtime file a Swift build would write for this backend. */
function swift(settings?: BackendSettings): string {
  const files = iosFiles(EMPTY_IR, DEFAULT_PROJECT, settings ? runtimeProfileFor(settings) : undefined)
  return files.find((file) => file.path.endsWith('Runtime.swift'))!.contents
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
    expect(planFor(APPWRITE).list.envelope).toBe('documents')
  })

  it('puts an Appwrite database in the path, where it lives', () => {
    const plan = planFor(APPWRITE)
    expect(plan.list.path).toBe('/databases/main/collections/{table}/documents')
    expect(plan.list.filter).toBe('queries')
    // The fields go under `data`, and the id is the client's to invent.
    expect(plan.create.wrap).toBe('data')
    expect(plan.create.idField).toEqual({ key: 'documentId', value: 'unique()' })
    expect(plan.modify.idField).toBeNull()
    // The project travels in a URL opened outside the app, where none
    // of the app's headers go with it.
    expect(plan.oauth.suffix).toBe('?project=proj1')
  })

  it('renames the fields Appwrite owns, and only for Appwrite', () => {
    expect(planFor(APPWRITE).renames).toEqual([
      ['$id', 'id'],
      ['$createdAt', 'created_at'],
      ['$updatedAt', 'updated_at'],
    ])
    for (const settings of [SUPABASE, POCKETBASE, VORTEX, SELF, undefined]) {
      expect(planFor(settings).renames).toEqual([])
    }
  })

  it('knows the two backends that do not hand a session straight back', () => {
    // PocketBase creates the record without signing it in; everybody
    // else answers sign-up with a token.
    expect(planFor(POCKETBASE).signUp).toMatchObject({ body: 'record', thenSignIn: true })
    expect(planFor(SUPABASE).signUp.thenSignIn).toBe(false)
    // And one where signing out is a local act with nothing to call.
    expect(planFor(POCKETBASE).signOut).toBeNull()
    expect(planFor(SUPABASE).signOut).toMatchObject({ path: '/auth/v1/logout' })
    // Appwrite does neither: creating an account starts no session and
    // signing in answers with one rather than with a person.
    expect(planFor(APPWRITE).signUp).toMatchObject({ body: 'account', thenSignIn: true })
    expect(planFor(APPWRITE).signIn.then).toBe('session')
    expect(planFor(APPWRITE).signOut).toMatchObject({ method: 'DELETE', path: '/account/sessions/current' })
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
  it('is written for one backend, not for every one of them', () => {
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

  it('speaks Appwrite: JSON queries, a data wrapper, and row.id restored', () => {
    const source = dart(APPWRITE)
    expect(source).toContain("'/databases/main/collections/' + Uri.encodeComponent(table) + '/documents'")
    expect(source).toContain("jsonEncode({'method': 'equal', 'attribute': key, 'values': [value]})")
    expect(source).toContain("body: {'documentId': 'unique()', 'data': body}")
    expect(source).toContain("return _rows(_map(reply)['documents']).map(_doc).toList();")
    // A block says row.id whatever the backend calls it, and the
    // fields the backend owns are not written back to it.
    expect(source).toContain("row['id'] = document['\\$id']")
    expect(source).toContain('_data(row is Map')
    expect(source).toContain("request.headers.set('x-appwrite-session', token);")
    expect(source).not.toContain('server-key')
  })

  it('reads an Appwrite account after signing in, because a session is not a person', () => {
    const source = dart(APPWRITE)
    expect(source).toContain("body: {'userId': 'unique()', 'email': email, 'password': password}")
    expect(source).toContain("_accept(await _call('/account', method: 'GET'));")
    expect(source).toContain("await _call('/account/sessions/current', method: 'DELETE')")
    expect(source).toContain("'?project=proj1'")
  })
})

/* ---------------------------------------------------------- the Kotlin */

describe('the Kotlin runtime', () => {
  it('is written for one backend, not for every one of them', () => {
    const source = kotlin(SUPABASE)
    expect(source).toContain('"/rest/v1/" + encode(table)')
    expect(source).not.toContain('/api/collections/')
    expect(source).not.toContain('/v1/data/')
    expect(source).not.toContain('"/data/"')
  })

  it('sends the publishable key on every call, and the session token over it', () => {
    const source = kotlin(SUPABASE)
    expect(source).toContain('connection.setRequestProperty("apikey", "anon-key")')
    expect(source).toContain('Backend.token?.let { connection.setRequestProperty("authorization", "Bearer " + it) }')
    // The key that bypasses every row policy is not in an APK.
    expect(source).not.toContain('service-key')
  })

  it('sends PocketBase a bare token, because that is what it reads', () => {
    expect(kotlin(POCKETBASE)).toContain('Backend.token?.let { connection.setRequestProperty("authorization", it) }')
    expect(kotlin(POCKETBASE)).not.toContain('"" + it')
  })

  it('escapes a value that is about to become PocketBase syntax', () => {
    const source = kotlin(POCKETBASE)
    expect(source).toContain('.replace("\'", "\\\\\'")')
    expect(source).toContain('"?filter=" + encode(tests)')
  })

  it('posts a filter tree to Vortex and a query string to the local service', () => {
    expect(kotlin(VORTEX)).toContain('JSONObject().put("column", column).put("op", "eq").put("value", value)')
    expect(kotlin(SELF)).toContain('"?" + where.entries.joinToString("&")')
  })

  it('unwraps the reply where that backend actually puts it', () => {
    expect(kotlin(SUPABASE)).toContain('return rowsOf(reply)')
    expect(kotlin(POCKETBASE)).toContain('return rowsOf(asMap(reply)["items"])')
    expect(kotlin(VORTEX)).toContain('return rowsOf(asMap(reply)["rows"])')
  })

  it('signs a new PocketBase account in, and keeps its record as the user', () => {
    const source = kotlin(POCKETBASE)
    expect(source).toContain('return signIn(email, password)')
    expect(source).toContain('.put("passwordConfirm", password)')
    expect(source).toContain('map["record"]')
    expect(source).toContain('Signing out is local here')
  })

  it('builds the right URL for a file, per backend', () => {
    expect(kotlin(SUPABASE)).toContain('Backend.baseUrl + "/storage/v1/object/public/"')
    expect(kotlin(POCKETBASE)).toContain('"/api/files/"')
    expect(kotlin(POCKETBASE)).toContain('multipart/form-data; boundary=')
    expect(kotlin(VORTEX)).toContain('val url = toText(reply["url"])')
    expect(kotlin(SUPABASE)).not.toContain('x-file-name')
    expect(kotlin()).toContain('x-file-name')
  })

  it('does not bind a reply nobody reads', () => {
    // Supabase answers an upload with a key, not a URL, so the address is
    // worked out locally -- and an unused `val reply` is a warning in
    // every Android build after that.
    const storage = kotlin(SUPABASE).slice(kotlin(SUPABASE).indexOf('object Storage'))
    expect(storage).not.toContain('val reply')
    expect(kotlin(VORTEX).slice(kotlin(VORTEX).indexOf('object Storage'))).toContain('val reply = asMap(call(')
  })

  it('points an emulator at the host machine, and leaves a real address alone', () => {
    // 10.0.2.2 is the developer's own machine seen from inside the
    // emulator, and this is the first thing that fails without it.
    expect(kotlin(POCKETBASE)).toContain('var baseUrl: String = "http://10.0.2.2:8090"')
    expect(kotlin()).toContain('var baseUrl: String = "http://10.0.2.2:8787"')
    expect(kotlin(SELF)).toContain('var baseUrl: String = "https://api.example.com"')
  })

  it('reports the sentence the backend chose, whichever key it used', () => {
    expect(kotlin(SUPABASE)).toContain('it["error"] ?: it["message"] ?: it["msg"]')
  })

  it('speaks Appwrite: JSON queries, a data wrapper, and row.id restored', () => {
    const source = kotlin(APPWRITE)
    expect(source).toContain('"/databases/main/collections/" + encode(table) + "/documents"')
    expect(source).toContain('.put("method", "equal")')
    expect(source).toContain('JSONObject().put("documentId", "unique()").put("data", data(body))')
    expect(source).toContain('return rowsOf(asMap(reply)["documents"]).map(::document)')
    expect(source).toContain('row["id"] = document["\\$id"]')
    expect(source).toContain('Backend.token?.let { connection.setRequestProperty("x-appwrite-session", it) }')
    expect(source).not.toContain('server-key')
  })

  it('sends the file id Appwrite expects the client to invent', () => {
    const source = kotlin(APPWRITE)
    expect(source).toContain('name=\\"fileId\\"')
    expect(source).toContain('"/storage/buckets/" + encode(bucket) + "/files"')
    expect(source).toContain('encode(toText(reply["\\$id"]))')
    expect(source).toContain('/view?project=proj1')
  })

  it('imports only what Android already ships', () => {
    const source = kotlin(SUPABASE)
    expect(source).toContain('import org.json.JSONArray')
    expect(source).toContain('import org.json.JSONObject')
    // No Retrofit, no OkHttp, no Moshi: a generated app should build with
    // nothing added to its Gradle file.
    expect(source).not.toContain('okhttp')
    expect(source).not.toContain('retrofit')
  })
})

/* ----------------------------------------------------------- the Swift */

describe('the Swift runtime', () => {
  it('is written for one backend, not for every one of them', () => {
    const source = swift(SUPABASE)
    expect(source).toContain('"/rest/v1/" + encode(table)')
    expect(source).not.toContain('/api/collections/')
    expect(source).not.toContain('/v1/data/')
    expect(source).not.toContain('"/data/"')
  })

  it('sends the publishable key on every call, and the session token over it', () => {
    const source = swift(SUPABASE)
    expect(source).toContain('request.setValue("anon-key", forHTTPHeaderField: "apikey")')
    expect(source).toContain('request.setValue("Bearer " + token, forHTTPHeaderField: "authorization")')
    expect(source).not.toContain('service-key')
  })

  it('sends PocketBase a bare token, because that is what it reads', () => {
    expect(swift(POCKETBASE)).toContain('request.setValue(token, forHTTPHeaderField: "authorization")')
    expect(swift(POCKETBASE)).not.toContain('"" + token')
  })

  it('escapes a value that is about to become PocketBase syntax', () => {
    const source = swift(POCKETBASE)
    expect(source).toContain('replacingOccurrences(of: "\'", with: "\\\\\'")')
    expect(source).toContain('"?filter=" + encode(tests.joined(separator: " && "))')
  })

  it('posts a filter tree to Vortex and a query string to the local service', () => {
    expect(swift(VORTEX)).toContain('["column": key, "op": "eq", "value": value]')
    expect(swift(VORTEX)).toContain('method: "POST", body: whereBody(filters)')
    expect(swift(SELF)).toContain('encode(key) + "=" + encode(toText(value))')
  })

  it('unwraps the reply where that backend actually puts it', () => {
    expect(swift(SUPABASE)).toContain('return rowsOf(reply)')
    expect(swift(POCKETBASE)).toContain('return rowsOf(asMap(reply)["items"])')
    expect(swift(VORTEX)).toContain('return rowsOf(asMap(reply)["rows"])')
  })

  it('signs a new PocketBase account in, and keeps its record as the user', () => {
    const source = swift(POCKETBASE)
    expect(source).toContain('return try await signIn(email: email, password: password)')
    expect(source).toContain('"passwordConfirm": password')
    expect(source).toContain('map["record"]')
    expect(source).toContain('Signing out is local here')
  })

  it('builds the right URL for a file, per backend', () => {
    expect(swift(SUPABASE)).toContain('Backend.baseUrl + "/storage/v1/object/public/"')
    expect(swift(POCKETBASE)).toContain('"/api/files/"')
    expect(swift(POCKETBASE)).toContain('multipart/form-data; boundary=')
    expect(swift(VORTEX)).toContain('let url = reply["url"] as? String ?? ""')
    expect(swift(SUPABASE)).not.toContain('x-file-name')
    expect(swift()).toContain('x-file-name')
  })

  it('discards a reply nobody reads rather than binding it', () => {
    expect(swift(SUPABASE)).toContain('_ = try await call(')
    expect(swift(VORTEX)).toContain('let reply = asMap(try await call(')
  })

  it('leaves localhost alone, because the simulator shares it', () => {
    // The opposite of Android: no 10.0.2.2 rewrite belongs in an iOS
    // build, where the simulator and the Mac share a loopback.
    expect(swift()).toContain('nonisolated(unsafe) static var baseUrl = "http://localhost:8787"')
    expect(swift(POCKETBASE)).toContain('"http://127.0.0.1:8090"')
    expect(swift(POCKETBASE)).not.toContain('10.0.2.2')
    expect(swift(SELF)).toContain('"https://api.example.com"')
  })

  it('reports the sentence the backend chose, whichever key it used', () => {
    expect(swift(SUPABASE)).toContain('map["error"] ?? map["message"] ?? map["msg"]')
  })

  it('speaks Appwrite: JSON queries, a data wrapper, and row.id restored', () => {
    const source = swift(APPWRITE)
    expect(source).toContain('"/databases/main/collections/" + encode(table) + "/documents"')
    expect(source).toContain('["method": "equal", "attribute": entry.key, "values": [entry.value]]')
    expect(source).toContain('body: ["documentId": "unique()", "data": body]')
    expect(source).toContain('return rowsOf(asMap(reply)["documents"]).map(document)')
    expect(source).toContain('if let value = document["$id"] { row["id"] = value }')
    expect(source).toContain('request.setValue(token, forHTTPHeaderField: "x-appwrite-session")')
    expect(source).not.toContain('server-key')
  })

  it('needs nothing but Foundation', () => {
    const source = swift(SUPABASE)
    expect(source).toContain('import Foundation')
    expect(source).not.toContain('import Supabase')
    expect(source).not.toContain('Package.swift')
  })
})

/* ------------------------------------------------- the same plan, thrice */

describe('the three mobile runtimes together', () => {
  const cases: [string, BackendSettings | undefined][] = [
    ['Supabase', SUPABASE],
    ['PocketBase', POCKETBASE],
    ['Vortex', VORTEX],
    ['Appwrite', APPWRITE],
    ['the generated service', undefined],
  ]

  it.each(cases)('agrees with itself about %s', (_name, settings) => {
    const plan = wirePlan(settings ? runtimeProfileFor(settings) : undefined)
    const sources = [dart(settings), kotlin(settings), swift(settings)]
    for (const source of sources) {
      // The list path is the one thing every runtime must spell the same
      // way, because it is the route the app uses most.
      expect(source).toContain(plan.list.path.split('{')[0])
      // And none of them may carry a credential the server keeps.
      expect(source).not.toContain('service-key')
      expect(source).not.toContain('admin-token')
      expect(source).not.toContain('server-key')
    }
  })
})
