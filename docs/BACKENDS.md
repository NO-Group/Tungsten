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
   ┌────────┴─────────┬──────────────┬───────────┬───────────┐
   ▼                  ▼              ▼           ▼           ▼
 Vortex           Supabase      Self-hosted   Firebase    Appwrite
 (preview)        (default)      (ready)      (planned)   (planned)
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

`src/backend/registry.ts` is the dropdown. Three work today; three are
declared, listed and honest about not being built.

| Adapter | Status | Notes |
| --- | --- | --- |
| **Vortex** | `preview` | Our own. `/v1/sql`, compiled row policies, durable realtime with replay, R2 storage behind a signed-upload gateway. Flip to `default` the day the fleet is live — one line in `registry.ts`. |
| **Supabase** | `default` | Launch backend. PostgREST, GoTrue, Storage, Phoenix channels, `/functions/v1` — spoken over the wire, no `@supabase/supabase-js`. |
| **Self-hosted** | `ready` | The Node + SQLite service Tungsten itself generates (`Build the Backend Service`). localhost or a VPS; no account anywhere. |
| Firebase | `planned` | Firestore, Firebase Auth, Cloud Functions. |
| Appwrite | `planned` | Open source, self-hostable. |
| PocketBase | `planned` | One Go binary, SQLite, realtime. |

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

## 4. What is next

In order:

1. **The project backend picker** — the dropdown, the credential fields,
   a Test Connection button, and `BackendSettings` saved with the
   project.
2. **The blocks on the contract** — the canvas's `db.*`, `auth.*` and
   `storage.*` blocks call the active adapter instead of the generated
   service's routes directly. The generated runtimes get the same
   treatment, one language at a time.
3. **The AI Architect panel** — prompt → blueprint → the approval gate →
   `schema.apply`, with the plan on screen before anything runs.
4. **Firebase, Appwrite, PocketBase**, in that order.
5. **The migration assistant** — `inspect()` on the old backend,
   `plan()` on the new one, and a diff in between. The shape is already
   there: both ends speak blueprints.
