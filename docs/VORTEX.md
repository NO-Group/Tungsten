# Vortex hosting economics

Vortex is Tungsten's own managed backend — the adapter at
`src/backend/adapters/vortex.ts`. It serves auth, a row store with
compiled policies, realtime fan-out, object storage, functions and
schema apply. Running it for people who pay nothing is a real monthly
invoice, and the only honest way to design a free tier is to price the
invoice first and the tier second.

This document is the reasoning. The arithmetic lives in `src/vortex/`
and is enforced by `src/vortex/vortex.test.ts`, so if the rate card
and the plan sheet ever disagree, a test fails rather than a quarter.

Rates read **20 November 2026**, in US dollars. `RATES_READ_ON` carries
that date in code, because infrastructure prices move and an undated
cost model is a rumour.

---

## 1. The two prices that decide the architecture

**Hetzner's June 2026 adjustment broke the per-tenant-instance model.**
Dedicated-vCPU cloud rose about 170% while bare metal barely moved. A
CCX13 — 2 dedicated vCPU, 8 GB — went from €15.99 to €42.99, roughly
$50.49. An AX42 — Ryzen 8c/16t, 64 GB of ECC, ~1.9 TB of NVMe — is
about $49.

That is 64 GB of metal for less than 8 GB of cloud. Per gigabyte of
RAM the gap is about **7.5×**, and after June 2026 giving every free
project its own small instance is the single most expensive thing you
could choose to do. Supabase could afford that generosity in 2021
because it had raised money to pay for it; nobody bootstrapped can
afford it in 2026. `perTenantInstanceUsd()` exists in `fleet.ts`
purely to keep the counterfactual priced and in front of us.

**Cloudflare R2 charges nothing for egress.** $0.015/GB-month of
storage, $4.50 per million writes, $0.36 per million reads, and
**$0.00** per gigabyte out, against roughly $0.09/GB on S3. Egress is
the line item that kills bootstrapped infrastructure, and it is
avoidable by picking a provider rather than by rationing what users
are allowed to download. The model tracks `egressAvoidedUsd` so the
size of that decision stays visible: at 5,000 free projects it is
**$900 a month** that never appears on the invoice — nearly nine times
the entire fleet bill.

---

## 2. Housing

Three kinds, in `tenancy.ts`:

| Housing | Who | What they get |
|---|---|---|
| `shared` | Spark (free) | One Postgres cluster on owned metal, one schema per tenant, pooled connections, asleep when idle |
| `reserved` | Core, Forge | A warm, reserved slice of a shared box; never sleeps |
| `dedicated` | Titan | Its own machine |

The per-tenant cost difference between the first and the last is about
two orders of magnitude. That difference *is* the free tier.

### Isolation is not one thing

"We use RLS" is a sentence. This is a checklist. `ISOLATION_CONTROLS`
lists seven layers, each recorded with the specific failure it exists
to survive, and a test asserts the free tier uses all of them:

| Control | Survives |
|---|---|
| One Postgres schema per tenant | A query that forgets its tenant filter finds nothing rather than everything |
| A database role per tenant with a forced `search_path` | A pooled connection reused across tenants |
| Row-level security compiled from the blueprint | An application bug that builds the wrong `WHERE` clause |
| Tenant id on every query, checked at the gateway | A stolen or stale API key aimed at another project |
| No arbitrary SQL on shared housing | A query written to read the catalogue or burn the box |
| Statement timeouts and per-tenant connection caps | One tenant's cartesian join taking five thousand others down |
| Nightly per-schema dumps alongside cluster PITR | Restoring one tenant without rolling everybody back |

Row-level security is never the only thing between two customers'
data, because it is always one bug away from being exactly that.

---

## 3. Quotas, and what happens when you hit one

| Quota | Spark | Core | Forge | Titan |
|---|---|---|---|---|
| Database | 500 MB | 8 GB | 32 GB | 256 GB |
| Files | 1 GB | 50 GB | 250 GB | 2 TB |
| Egress / month | 5 GB | 250 GB | 1 TB | 10 TB |
| Requests / minute | 120 | 1,200 | 6,000 | 30,000 |
| Requests / month | 1M | 20M | 100M | 1B |
| Realtime sockets | 20 | 500 | 2,500 | 20,000 |
| Rows | 100k | 10M | 50M | 500M |
| Statement timeout | 5 s | 30 s | 60 s | 120 s |
| Sleeps after | 7 idle days | never | never | never |
| Cold start | ~900 ms | — | — | — |

**Breaching a quota never deletes data and never takes a project
offline.** `quotaBreaches()` returns one of three effects:

- `block-writes` — database or row ceiling. Reads keep serving.
- `block-uploads` — storage full. Existing files still download.
- `throttle` — egress, request rate, monthly requests, sockets.
  Requests are queued and downloads slowed, not cut.

A free tier whose penalty is data loss is a free tier nobody starts a
real project on, and the entire commercial case rests on real projects
starting there.

Realtime sockets are in that table deliberately: persistent
connections are the limit everyone forgets to meter, and twenty
thousand idle websockets will exhaust a box long before its disk does.

---

## 4. Sleep is the whole trick

A free project is built in one evening and visited a handful of times
afterwards. `averageRamMb()` blends awake and asleep memory across the
730 hours in a month:

- Awake: 90 MB — pooled connections, cache, the router's state.
- Asleep: 2 MB — the schema on disk and an entry in a routing table.
- A typical free project is awake about **40 hours a month**.

That averages **6.8 MB per free tenant**, against 90 MB if it never
slept. Sleep is a **13×** reduction in the resource that turns out to
bind the fleet, and it is the difference between 5,000 free projects
on one machine and 5,000 free projects on twelve.

The cost of it is a ~900 ms cold start on the first request after a
week of silence. That is a real tax, and it is charged to the people
paying nothing.

---

## 5. The fleet

`fleetFor()` takes a population of tenants and returns the bill. Boxes
round up, because machines are whole things; the *binding constraint*
is read off unrounded demand, so you can always see which resource
actually ran out. Cost is then attributed by that constraint — if
memory is what forced the purchase, the box is divided by memory.

Headroom is 70% (`USABLE_FRACTION`), minus 6 GB per box for the
operating system, Postgres and the router. A box packed to its last
gigabyte is a box that falls over on a Tuesday. Disk carries a 1.5×
overhead for WAL, indexes and vacuum room.

Fixed costs that do not scale with tenants: backups $4, edge workers
$5, observability $15, network $6 — **$30 a month**.

### The free fleet, modelled

Typical free project: 120 MB of database, 200 MB of files, 2 GB out,
500 writes, 5,000 reads, 40 awake hours.

| Free projects | Boxes | Monthly | Per project | Binding | Instead, one instance each |
|---|---|---|---|---|---|
| 1,000 | 1 | $81.78 | $0.052 | memory | $50,490 |
| 5,000 | 1 | $105.65 | **$0.015** | memory | $252,450 |
| 20,000 | 4 | $357.34 | $0.016 | memory | $1,009,800 |
| 50,000 | 9 | $811.73 | $0.016 | memory | $2,524,500 |

Five thousand free projects fit on **one $49 machine** and cost about
**a penny and a half each per month**, most of which is R2 storage
rather than compute. The per-instance alternative is **2,389×** more
expensive. Memory binds before disk, even with most projects asleep,
which is why sleep matters more than compaction.

A stress case is modelled too: every free project simultaneously at
its full quota and permanently awake comes to about $1,495 a month —
twelve boxes — and is still covered by a few hundred subscribers. The
free tier survives being taken seriously by everyone at once; it just
costs more that month.

---

## 6. Who pays for it

`fundingFor()` subtracts each plan's true cost — worst-case inference
from `src/ai/plans.ts`, plus its hosting allowance and payment
processing — from its price, and divides the free fleet by what is
left. Two columns, because a plan has to survive its worst month:
**worst case** is every subscriber burning their entire AI allowance
on the dearest engine they are allowed; **normal** is 35% utilisation.

At 5,000 free projects ($75.65 of attributed cost):

| Plan | Contribution, worst case | Free projects funded | Payers needed | Payers needed, normal month |
|---|---|---|---|---|
| Core $20 | $6.41 | 423 | **12** | 6 |
| Forge $60 | $18.82 | 1,243 | 5 | 2 |
| Titan $200 | $74.61 | 4,931 | 2 | 1 |

**Twelve Core subscribers pay for five thousand free projects** in the
worst month anyone can construct. The break-even conversion rate is
**0.24%** — against the 1–3% that self-serve developer tools actually
convert at, and the 3–5% optimists quote.

The model also cross-checks itself against the plan sheet: a fleet of
100 Core tenants costs $1.03 each in hosting against the $2.00
`infraCents` already budgeted per Core subscriber, and 50 Forge
tenants cost $3.29 against $7.00 budgeted. Both fit. If a future edit
breaks that, `vortex.test.ts` fails.

---

## 7. What this means for the free tier

The free tier is not charity and it is not a loss leader to be
rationed. At a penny and a half a month it is **cheaper than the
signup email**, and the constraint on how generous it can be is not
money — it is abuse, and the blast radius of a shared box.

Which reframes every design question:

- Don't ration storage to save money; ration it so one project cannot
  eat a box the other 4,999 live on.
- Don't throttle to save egress; R2's egress is free. Throttle because
  a runaway loop is indistinguishable from a denial-of-service.
- Don't make the free tier annoying to force upgrades. The upgrade
  trigger should be **capability**, not pain: team seats, no cold
  start, custom domains, backups you can restore yourself, and the
  AI credits in `docs/CREDITS.md` — which are the genuinely expensive
  thing, costing more per paying user per month than the entire free
  hosting fleet costs for five thousand people.

That last point is the real finding. Hosting is nearly free; inference
is not. Vortex's limits exist to contain blast radius. The paywall
belongs where the money actually goes.

---

## 8. Not built yet

This is a cost model and a policy, not a running control plane. Still
to build: the tenant router that wakes a sleeping schema, the sleeper
itself, the per-tenant metering pipeline that feeds `Usage`, and the
provisioning that turns a blueprint into a schema and a role. The
numbers above tell us what to build toward; they do not pretend it
exists.
