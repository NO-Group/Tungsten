# Backend sovereignty

Tungsten does not have a backend. It has a *contract*, and a list of
backends that satisfy it.

That distinction is the whole architecture. A user who builds on
Tungsten picks Supabase today because it is free, moves to Vortex when
we have servers, and takes their canvas with them — because the canvas
never knew which one it was talking to.

```
   blocks on the canvas
           │              db.select("orders", { where: … })
           ▼
┌───────────────────────────┐
│ Universal Data Contract   │  src/backend/contract.ts
│ auth · db · realtime ·    │  one set of TypeScript interfaces
│ storage · functions ·     │  JSON in, JSON out, capabilities declared
│ schema & policies         │
└───────────┬───────────────┘
            │
   ┌──────────┬───────────┴──┬─────────────┬──────────┬──────────┐
   ▼          ▼              ▼             ▼          ▼          ▼
 Vortex    Supabase    Self-hosted    PocketBase   Appwrite   Firebase
(preview)  (default)     (ready)        (ready)     (ready)   (planned)
```

## 1. The Universal Data Contract

`src/backend/contract.ts`. Six surfaces, one umbrella type
(`TungstenBackend`), and four rules that every adapter obeys.

| Surface | What it covers |
| --- | --- |
| `TungstenAuth` | sign up, sign in, sign out, session, refresh, OAuth URLs, magic links, code exchange, metadata, roles |
| `TungstenDb` | `select` with filters/embeds/order/paging/count, `find`, `insert`, `update`, `updateWhere`, `remove`, `removeWhere`, `upsert`, `count`, optional `rpc` |
| `TungstenRealtime` | table subscriptions with kinds, filters and **replay**, rooms with broadcast and presence, `disconnect` |
| `TungstenStorage` | buckets, upload, remove, list, public URLs, signed URLs, signed direct uploads, image transforms |
| `TungstenFunctions` | list, deploy, invoke, remove, and webhook registration |
| `TungstenSchema` | `inspect`, `plan`, `apply`, `policies` — all driven by a blueprint |

The four rules:

1. **Plain data in, plain data out.** A filter is a tree of objects
   (`{ all: [{ column: 'status', op: 'eq', value: 'open' }] }`), not a
   builder chain. It has to survive being saved in a project file, shown
   in an inspector, and translated into PostgREST parameters, a JSON
   query document and SQL — a fluent API survives none of that.
2. **Capabilities are declared, not discovered.** `AdapterInfo.capabilities`
   states up front what a backend cannot do, so the UI greys the block
   out instead of letting someone ship an app that throws.
3. **Failures are sentences.** `BackendError` carries a `code` for the
   program and a sentence for the person. `PGRST301` is not an error
   message.
4. **No SDKs.** Adapters speak HTTP and WebSocket through *injected*
   transports (`http`, `openSocket`). Tungsten stays dependency-free,
   every adapter is testable without a network, and adding a backend is
   a file rather than a supply chain.

## 2. The Tungsten Schema blueprint

`src/backend/blueprint.ts`. One JSON document describing tables,
columns, relationships, row-level security, buckets and functions. It is
what the AI Architect writes, what the approval gate renders, and the
only thing an adapter will provision from.

```json
{
  "version": 1,
  "name": "Delivery",
  "tables": [
    {
      "name": "orders",
      "realtime": true,
      "columns": [
        { "name": "total", "type": "number" },
        { "name": "driver_id", "type": "reference",
          "references": { "table": "drivers", "onDelete": "cascade" } }
      ],
      "policies": { "read": "owner", "create": "authenticated",
                    "update": "owner", "delete": "owner" }
    }
  ],
  "buckets": [{ "name": "receipts", "public": false }],
  "functions": [{ "name": "notify_driver", "trigger": "insert",
                  "table": "orders", "summary": "Pings the driver." }]
}
```

Types: `text`, `number`, `integer`, `boolean`, `timestamp`, `json`,
`uuid`, `reference`. `id` and `created_at` are implicit — listing them
is a warning, not an error.

Policies are **five words**: `public`, `authenticated`, `owner`,
`admin`, `nobody`. Not SQL. A policy that said
`auth.uid() = owner_id` would be a Postgres policy, and the point of
the format is that Firestore rules and Vortex's compiled policies come
out of the same document. Each adapter spells them its own way.

`parseBlueprint` validates untrusted JSON — an AI reply, a pasted file,
an older project — and returns problems as sentences. It refuses invented
types, duplicate tables, dangling references and unknown policy words. It
*fixes* one thing rather than refusing: an owner-scoped table with no
owner column gets `owner_id` added and a warning saying so, because that
is the mistake models actually make.

Defaults are locked down. A table with no policies gets
`PRIVATE_POLICIES` — owner reads, owner writes, signed-in users create.
Being public is something you choose, never something you forget.

### The bridge to the canvas

The visual Data tab stays the source of truth:

- `blueprintFromSchema(schema)` — drawn tables → blueprint, inferring
  `*_id` columns as references and dropping foreign keys to tables
  nobody drew.
- `schemaFromBlueprint(blueprint)` — back again.
- `blueprintFromDescription(text)` — the AI Architect's first half,
  built on the same `schemaPlanner` the **Draft** button uses. One
  vocabulary, two outputs; a second English-to-tables path would drift
  within a week.

### The approval gate

`summariseBlueprint` returns a data structure, not markup: the same
summary renders in the panel, goes into the notification and is asserted
in tests. It spells policies out in English (“read: the row’s owner”)
and raises `cautions` for anything worth a second look — a public read
policy, a world-writable table, a public bucket. Nothing is applied
until a human has seen it.

## 3. The adapters

`src/backend/registry.ts` is the dropdown. Five work today; one is
declared, listed and honest about not being built.

| Adapter | Status | Notes |
| --- | --- | --- |
| **Vortex** | `preview` | Our own. `/v1/sql`, compiled row policies, durable realtime with replay, R2 storage behind a signed-upload gateway. Flip to `default` the day the fleet is live — one line in `registry.ts`. |
| **Supabase** | `default` | Launch backend. PostgREST, GoTrue, Storage, Phoenix channels, `/functions/v1` — spoken over the wire, no `@supabase/supabase-js`. |
| **Self-hosted** | `ready` | The Node + SQLite service Tungsten itself generates (`Build the Backend Service`). localhost or a VPS; no account anywhere. |
| **PocketBase** | `ready` | One Go binary with SQLite inside it. Collections API, file fields, superuser-token schema. No realtime here: PocketBase streams over Server-Sent Events, which these transports do not carry. |
| **Appwrite** | `ready` | Open source and self-hostable. Databases of collections, accounts and sessions, buckets with image previews, functions, and realtime over a WebSocket. Creating collections and attributes needs a server API key, which stays in the IDE. |
| Firebase | `planned` | Firestore, Firebase Auth, Cloud Functions. |

A planned adapter throws a sentence naming what to use instead, never a
stack trace.

### Where they genuinely differ

These are the places the contract earned its keep, because two
implementations disagreed and the disagreement had to be settled in the
interface:

- **Filters.** Supabase flattens them into PostgREST parameters
  (`or=(a.eq.1,b.eq.2)`); Vortex takes the tree unchanged; the
  self-hosted service understands equality only, so `splitFilter` sends
  what it can and applies the rest to the rows that come back —
  documented, because at a million rows that would be the wrong trade.
  PocketBase is the awkward one: its filter is a **string expression**
  with no parameter binding on the wire, so `pocketbaseFilter` renders
  the literals itself and `pocketbaseLiteral` escapes quotes and
  backslashes. That escaping has its own tests, because it is the one
  place in the layer where something a user typed becomes syntax.
- **Paging.** PocketBase pages by number, not offset. An offset that
  lands on a page boundary becomes `page=N`; anything else is read from
  the top and sliced, which is slower and correct, rather than rounded
  to the nearest page and wrong.
- **Buckets.** In PocketBase a file is a field on a record, so a bucket
  is a collection and a path is `recordId/filename`. Creating one is a
  schema change, not a storage call, and `createBucket` says so instead
  of inventing a folder.
- **DDL.** Vortex has `/v1/sql`, so `schema.apply` runs. Supabase has no
  public DDL endpoint, so the plan comes back in `script` mode — the SQL
  to paste into the editor — unless the project has installed Tungsten's
  `exec_sql` function and supplied a service key. The self-hosted
  service applies `schema.sql` at boot, so its plan says to rebuild and
  restart.
- **Replay.** Only Vortex. `Subscription.cursor()` and
  `TableSubscribeOptions.since` exist in the contract because durable
  realtime is a real difference; Supabase declares
  `capabilities.realtime.replay: false` rather than quietly ignoring
  `since`.
- **Row-level security.** Postgres gets `enable row level security` and
  a dropped-and-recreated policy per action. SQLite has none, so the
  plan says so in a comment instead of pretending.
- **Documents versus rows.** Appwrite namespaces its own fields with a
  `$` and puts a write's fields inside `data`, so `rowFromDocument` and
  `documentData` translate both ways: the canvas keeps saying `row.id`,
  and a read-edit-save round trip does not fail on the fields the
  backend added itself.
- **Negation.** Appwrite's query language has no `not`. A negated test
  is inverted operator by operator — `eq` becomes `notEqual`, `lt`
  becomes `greaterThanEqual` — and refuses out loud when there is no
  opposite to use, because sending the un-negated query would return
  precisely the rows the user asked to exclude.
- **Two kinds of credential.** An Appwrite session secret acts as the
  signed-in person and an API key acts as the server; sent together the
  key wins, and `GET /account` then answers “missing scope” for someone
  who is in fact signed in. Every call picks one and sends only that.
- **Realtime without a filter.** Appwrite's channels are per
  collection, so `kinds` and `where` are applied as events arrive — the
  rows still travel — and `since` is refused, because there is no
  change log to replay from.

### The SQL

`src/backend/sql.ts` turns a blueprint into `SchemaOperation[]` — each
with the statement it would run and whether it is destructive — for both
Postgres and SQLite. Tables are topologically sorted so a foreign key
never points at something that does not exist yet. Every statement is
idempotent (`create table if not exists`, `drop policy if exists`)
because provisioning that cannot be re-run is provisioning nobody
trusts. Identifiers go through `quoteIdentifier`, which throws rather
than emits anything that is not an identifier; values are bound, never
inlined.

## 4. The AI Architect

`src/backend/architect.ts` and the **Architect** tab in the builder.
You describe the app in English; it returns a blueprint; you read what
applying it would do and approve or discard. It is deliberately boring
in four specific ways, each of which is a test.

**A missing policy fails closed.** `secureDefaults` fills an absent
`policies` block with `PRIVATE_POLICIES` and an absent `bucket.public`
with `false`. It only ever *adds* restrictions — a blueprint that
explicitly declares `read: 'public'` or a public bucket keeps it, so
`summariseBlueprint` can raise a caution about it. Silently locking
down something the model deliberately opened would be a lie of the same
family as silently opening it.

**An unparseable reply is a refusal, not a guess.** `extractJson`
pulls the one JSON object out of a reply that may be wrapped in prose
or a fenced block, and `parseBlueprint` validates it. If either fails,
the panel says the model replied with something that is not a
blueprint. A blueprint is a security document; repairing half-written
JSON into something plausible is how a `nobody` policy becomes a
`public` one.

**It works with no gateway at all.** With no AI configured,
`offlineDraft` runs the deterministic `planSchema` from the builder —
the same code path behind the Data tab's draft box — and labels the
result `offline`. The tab says `offline` rather than disappearing,
because a backend designer that only exists for people who have paid
for credits is a sales page, not a feature.

**It never applies anything.** `createArchitect().draft()` returns a
blueprint and spends credits; `apply()` exists but the panel calls it
only from the approve button, and only with the blueprint the user was
shown. `review(blueprint, plan?)` builds what the gate renders:

| Field | What it holds | Effect |
| --- | --- | --- |
| `destructive` | Operations flagged `destructive` by the adapter | Rendered first, in their own red block |
| `blockers` | `plan.problems`, or a blueprint with no tables | Approve is **disabled** |
| `cautions` | `summariseBlueprint` warnings, `mode: 'script'`, destructive work | Shown; approve stays enabled |
| `approvable` | `blockers.length === 0` | The button |

The split between blocker and caution is the only judgement call in the
file, and it goes this way on purpose: a gate that refuses judgement
calls — that blocks on anything mildly alarming — is a gate people
learn to route around. Destructive work is *shown loudly and allowed*,
because dropping a column is sometimes exactly the migration you asked
for. A plan the backend itself rejected is not approvable, because
there is nothing to approve.

Destructive operations are also pulled **out** of the collapsed
statement list and shown above the schema table. A `drop column` at
line 14 of a `<details>` nobody opened is a thing people approve by
accident exactly once.

### Landing it on the canvas

Approval calls `schema.apply` when a backend is configured, then
`adoptBlueprint` on the builder, which merges through
`mergeSchema` in `src/builder/dataSchema.ts`. The merge is **additive**:
an existing table keeps its name, its column order and every column it
has — including ones drawn by hand that the blueprint never mentioned —
and gains the new columns on the end. An existing column is not
retyped. Removal and renaming are discussed in the gate, in words, or
they do not happen.

## 5. The picker

The **Backend** tab in the builder, `src/components/builder/BackendPanel.tsx`.
Everything above this line existed with sixty tests and no way to reach
it from the product; this is the join.

Pick an adapter, paste what it asks for, press **Test connection** —
which calls `health()` on a real `createBackend(...)` rather than
validating the URL's shape. `BackendSettings` is saved with the project
in `tungsten.builder.v1`, so the choice survives a reload, and
`BuilderView` rebuilds the backend whenever those settings change.
Incomplete credentials are not an error: they are the normal state of a
project nobody has configured, so the backend is simply `undefined` and
the architect reviews without a plan.

Three things the panel refuses to do:

- **Hide what is not built.** Firebase is listed, disabled, with the
  fields it will need. A dropdown that silently omits Firebase answers
  “does Tungsten support Firebase?” with nothing at all.
- **Keep credentials across a change of backend.** Switching adapter
  clears the config. Carrying a Supabase service key into another
  vendor's field is useless and a way to paste it somewhere it does not
  belong.
- **Show a stale green tick.** Editing any field clears the last health
  result, because a tick beside an address that was never tested is the
  most misleading thing this panel could display.

The capability grid is rendered from `info.capabilities`, both halves:
what the adapter has, and `no replay, no transforms` for what it does
not. A backend's limits are cheaper to read here than to discover after
a feature is built on them.

## 6. What a built app talks to

Everything above is TypeScript the IDE imports. An exported app has no
IDE in it, and until recently it always called the routes of Tungsten's
own Node service — so a project on Supabase shipped an app calling
addresses nobody was serving.

`src/backend/runtimeProfile.ts` closes that. A **profile** is the
adapter's wire protocol reduced to JSON:

```ts
{ adapter, label, dialect, base, headers, token: { header, prefix }, users?, withheld }
```

`compile({ …, backend })` bakes it into `index.html`, and the runtime in
`previewRuntime.ts` carries one small encoder per dialect:

| Dialect | Reads rows with | Rows arrive as |
| --- | --- | --- |
| `tungsten` | `GET /data/:table?col=value` | `{ rows }` |
| `postgrest` | `GET /rest/v1/:table?select=*&col=eq.value` | a bare array |
| `pocketbase` | `GET /api/collections/:t/records?filter=col='v'` | `{ items }` |
| `vortex` | `POST /v1/data/:t/query` with a filter tree | `{ rows }` |

Three things this deliberately does:

- **Ships publishable credentials only.** A Supabase service-role key or
  a PocketBase superuser token in a page anyone can view-source is a
  database anyone can empty. Those fields are dropped from the profile
  and named in `withheld`, which the Backend panel prints in a sentence
  under the capability grid.
- **Stays silent when the project is half configured.** No profile is
  baked in, the emitted app falls back to the local Node service, and
  nothing fails at build time over a field somebody has not typed yet.
- **Leaves the preview alone.** Inside the IDE there is still no server
  and must not be one: the blocks simulate and say so in the log. The
  profile only reaches a build.

`window.TUNGSTEN_BACKEND` overrides the baked profile, so a built app
can be pointed at staging without a rebuild — the same escape hatch
`window.TUNGSTEN_API` has always been.

The tests in `src/builder/backendRuntime.test.ts` run the emitted page
in a real DOM with a recording `fetch`, so "a Supabase build calls
PostgREST" is a request that has happened rather than a claim about a
string.

### The same thing on a phone

A page can carry four dialects and choose at run time, because it is
also the preview and the preview can be repointed. An installed app
cannot and should not: it is built for one project, whose backend is
known while it is being emitted.

So `src/builder/targets/wire.ts` holds the same four protocols as
language-neutral data — paths with `{table}`/`{id}`/`{bucket}`
placeholders, the envelope each backend wraps rows in, where the token
goes — and each mobile emitter renders **only the chosen one**. A
Supabase build's `lib/runtime.dart` contains PostgREST paths and no
mention of `/api/collections/`; a PocketBase build contains the filter
escaping and a hand-built multipart body. No dialect table ships in the
app.

All three mobile languages now read that plan:

| Build | File | What a Supabase project gets |
| --- | --- | --- |
| Flutter | `lib/runtime.dart` | `dart:io` only — `HttpClient`, no package |
| Kotlin | `app/src/main/java/…/Runtime.kt` | `HttpURLConnection` + `org.json`, nothing in Gradle |
| Swift | `Sources/Runtime.swift` | `URLSession` + `JSONSerialization`, no SPM package |

They differ only where the platform does. Android rewrites a
`localhost` address to `10.0.2.2`, because that is the developer's
machine seen from inside the emulator and the first thing that fails
without it; iOS leaves it alone, because the simulator shares the Mac's
loopback. A real address is copied verbatim in both.

One thing the table is worth having for on its own: three languages
disagreeing about where `/rest/v1/` goes is a bug nobody finds until a
phone build is in somebody's hands. There is one table, with one set of
tests, and `wire.test.ts` asserts the same facts against the Dart, the
Kotlin and the Swift — so an Android build and an iOS build of one
project cannot drift apart about the backend they share.

### When a backend has no dialect

The adapter list and the dialect table are not the same list, and
Appwrite is currently in the first but not the second. The IDE talks to
an Appwrite project in full; a build of that project falls back to the
generated Node service, because emitting a runtime that calls routes
no one implemented would be worse than emitting one that works.
`runtimeProfileFor` returns `undefined` for it, and the Backend panel
says which of the two is happening — *“built apps cannot speak Appwrite
yet”*, not *“this project has no complete backend”*, which would send
someone hunting for a field they have already filled in.

## 7. What is next

In order:

1. **The Appwrite dialect for built apps.** The adapter shipped, so the
   IDE — the Data tab, the schema, the connection test — talks to
   Appwrite today. What a *built* app speaks is the separate table in
   `src/builder/targets/wire.ts`, which has no Appwrite entry yet, so a
   build still calls the generated Node service and the Backend panel
   says that in those words rather than implying the project is
   unfinished. Adding it is a filter style, a `data` wrapper on writes,
   a `documentId` field, and a two-step magic-link sign-in.
2. **Firebase.** The last planned adapter. Firestore has no schema to
   apply and its REST filters are structured queries, so it will cover
   less of the contract than the others — declared honestly in
   `capabilities`, rather than stubbed.
3. **PocketBase realtime**, which waits on a Server-Sent Events
   transport beside `HttpSend` and `SocketOpen`: a contract change, not
   an adapter one.
4. **The migration assistant** — `inspect()` on the old backend,
   `plan()` on the new one, and a diff in between. The shape is already
   there: both ends speak blueprints.
