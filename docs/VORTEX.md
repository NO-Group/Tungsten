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
| Files | 2 GB | 50 GB | 250 GB | 2 TB |
| Uploads / month (Class A) | 10k | 1M | 10M | 100M |
| File reads / month (Class B) | 100k | 20M | 200M | 2B |
| Max single upload | 50 MB | 500 MB | 2 GB | 10 GB |
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

## 8. The mechanisms

Three of Gemini's ideas were worth keeping, and a policy nothing
enforces is a promise. These are the enforcement.

### A token bucket, not a window — `limiter.ts`

A fixed-window counter punishes the honest: a client that fires sixty
requests in the first second of a minute and nothing afterwards is
well inside a 120-per-minute quota and gets refused at exactly the
moment it is behaving reasonably. `take()` is a bucket of two numbers
that refills continuously — no scheduler, no cron, nothing to keep
warm for a sleeping tenant — so a burst goes through and the sustained
rate sits on the line. A refusal returns `retryAfterMs` rather than
just "no". Buckets that have refilled completely are swept, because a
full bucket is indistinguishable from no bucket.

### Sleep, stated out loud — `limiter.ts`

`sleepPlan()` returns the state, the days remaining, the wake cost and
a sentence for the project header: *"Asleep after 9 quiet days. The
next request wakes it in about 0.9s — nothing is lost."* A cold start
nobody warned you about is a bug report; the same cold start printed
next to "sleeps after 7 quiet days" is a tier. Waking queues the
request up to `wakeDeadlineMs`; past that the box is broken, not the
sleeper, and failing fast is the honest answer. Each sleeping project
hands **88 MB** back to the fleet.

### Client caching, for the right reason — `offload.ts`

`CACHE_RULES` caches by **who can change the row**, not by how hot it
is. Reference tables and your own rows go cache-first; rows other
people can edit go network-first on a 30-second TTL, because serving
those stale means showing one user another user's undone work; and
sessions, tokens and policy decisions are **never** cached, because a
cached authorisation is a revocation that did not happen.

The default hit rate is **0.6**, not the 90% these models usually
assume — real application caches land between a half and three
quarters once cold starts, first visits and invalidations are counted.
At 5,000 free projects a 60% cache avoids 15M reads and saves **$5.40
a month**, about 5% of the bill. `describeOffload()` says so in those
words. Do it for the latency, the offline support and the sleeping
tenants it does not wake; the invoice is a rounding error.

### Upgrade by capability, not by pain — `upgrade.ts`

Hosting a free project costs a penny and a half, so there is no
financial reason to make the free tier hurt. `nudgesFor()` stays
silent below 80% of any quota, then names **what the next plan can
do** — and a test asserts no message contains "delete", "lost",
"suspend", "lock" or "penalty". The seats trigger is allowed to skip
a plan, because Core also has one seat and selling somebody a second
thing that does not work either is worse than saying nothing.

The most honest trigger in the list is the cold start: a project that
went quiet and then got visited is precisely the project whose owner
has started caring, and "Core projects stay warm" is a sentence that
sells itself.

---

## 9. Should Vortex run Redis?

Asked directly, so answered directly: **not on one box, and when it
does, not as a cache.** The arithmetic is in `cache.ts` and the tests
enforce it.

### The break-even nobody computes

On a cache hit you still pay the round trip. On a miss you pay the
round trip, *then* the database, *then* the write-back. Setting that
equal to the uncached cost gives the hit rate a cache must beat:

```
breakEven = (cache + writeBack) / (database + writeBack)
```

For a managed Redis in the same region (~0.8 ms) in front of a warm
primary-key lookup (~1.2 ms), that is **80%** — against the **60%**
`offload.ts` already admits is the plausible hit rate for caches of
this shape. At 60% the expected latency is **1.6 ms against 1.2 ms**:
the cache is 400 µs *slower* than no cache, before the tail.

### The honest nuance

Redis over loopback on the same box is ~250 µs, which breaks even at a
**35%** hit rate and therefore genuinely wins on speed. A test asserts
this, so the "no" cannot be quoted without it.

It loses anyway — on memory. `fleet.ts` reports `binding: 'memory'` at
every population, and Redis is a RAM-resident database. `displacedBy()`
prices a cache tier in the only currency that matters here: **150 free
projects per gigabyte**. An 8 GB Redis costs **1,201 free tenants**, or
another $49 machine to put them back. Adding a RAM store to a
memory-bound fleet to make it faster is adding passengers to make the
car lighter.

### And the thing actually worth optimising

A warm query is 1.2 ms. Waking a sleeping free tenant is **900 ms** —
**750×** larger. Optimising the 1.2 ms while the 900 ms stands is
motion, not progress.

### Where it does earn its place

Judged per job, not bought wholesale (`CACHE_VERDICTS`):

| Job | Verdict | Instead |
|---|---|---|
| Caching tenant rows | already-cached | Give the RAM to `shared_buffers` |
| Sessions and tokens | **never** | A cached authorisation is a revocation that did not happen |
| Rate limiting across boxes | cheaper-elsewhere | A Durable Object per tenant, on the Workers plan already in the fixed costs |
| Realtime fan-out across boxes | cheaper-elsewhere | Pin a tenant's sockets to the box its schema lives on |
| The awake/asleep routing table | cheaper-elsewhere | A table in the control-plane database |
| Background jobs | cheaper-elsewhere | `SELECT ... FOR UPDATE SKIP LOCKED` |
| **Per-tenant usage counters** | **worth it** | High-frequency integer increments are the one thing Postgres is bad at — each is a row version, and the vacuum bill lands on every tenant sharing the box |
| **Flattening p99 under write load** | **worth it** | A warm read is ~1.2 ms at p50 but ~19 ms at p99 when WAL flushes, the checkpointer and buffer-header contention collide. Redis has no planner, no MVCC, no vacuum |

Note the pattern: where a cache tier wins, it wins on **shared state
and tail latency**, never on "Redis is faster than Postgres".

### The bug that arrives with the second machine

`take()` keeps its buckets in process memory. Correct for one box,
quietly wrong for nine: **N boxes each enforcing L admit N×L**, so the
120-per-minute free quota becomes 1,080 across the nine boxes
`fleet.ts` reaches at fifty thousand free projects — and nothing
reports it, because every box believes it is doing its job.

`effectiveLimit()` and `limitIsHonest()` state that in code so a test
fails when somebody scales the fleet without scaling the limiter, and
`localBudget()` gives the two-tier shape for when it happens: a
generous per-box bucket that absorbs bursts with no network hop, and a
global tier holding the exact quota. Which store backs the global tier
— Redis with an atomic script, or a Durable Object — is an
implementation detail `GlobalLimiter` deliberately refuses to care
about.

Redis buys **correctness across machines**, not speed. That is a good
reason to adopt it, and a different one from the reason it is usually
adopted.

**Adopted.** `tieredLimiter()` composes the two tiers for real: local
first so a refusable request never costs a network hop, global second
and only for what got past it. Under an attack the global tier sees a
trickle rather than the flood, which is also what keeps it affordable.
It fails **open** and labels the decision `degraded`, because a
coordination outage must not become a total outage for every tenant at
once — and because enforcement quietly degrading is something a
dashboard should show rather than something discovered in a bill.

---

## 10. Getting paid, and not getting farmed

Four problems that look like one: empty cards at signup, real cards
that stop working later, overage too small to be worth charging for,
and a runaway loop turning somebody's bug into your invoice. The
arithmetic is in `billing.ts`.

### A $1 pre-authorisation is not free

The standard advice is a $1 charge, voided immediately, to prove the
card has funds. **Stripe has not returned processing fees on refunds
since 2019** — a $1 charge reversed one second later still costs
2.9% + 30c, and keeps costing it.

| Free signups / month | Cost of a $1 pre-auth | The entire free fleet |
|---|---|---|
| 1,000 | $329 | $81.78 |
| 5,000 | **$1,645** | **$105.65** |
| 20,000 | $6,580 | $357.34 |

Fifteen dollars spent to protect one. A **zero-amount card
authorisation** answers the same question — is this card real and
live — for nothing, which is precisely why the networks support it.

### And the card does not belong at signup

A free tenant costs **$0.015 a month**. Card-gating a free tier
reliably removes most of the people who would have signed up, to
defend a penny and a half. `VERIFICATION.requiredAt` is
`'first-overage'`: the card is asked for the moment somebody wants to
spend money, which is the upgrade trigger `upgrade.ts` already
describes and the one moment the request is obviously reasonable.

Abuse is contained the way §7 says it should be — by quotas and blast
radius, not by a credit check at the door.

### Controls that are worse than the problem

`REJECTED_CONTROLS` keeps these in code, with reasons, because each
gets proposed again every six months:

- **Blocking prepaid and virtual card BINs.** Prepaid and virtual
  cards are how much of the world pays — most of Africa and Latin
  America, and anyone using their bank's own single-use card for
  safety. BIN prefixes are shared between legitimate fintechs and
  burners, so the rule blocks real customers while a determined abuser
  changes BIN in an afternoon.
- **Blocking "high-risk jurisdictions".** A country blocklist with a
  compliance word in front of it. It excludes entire markets to stop a
  cost measured in cents, and the excluded are disproportionately the
  people a developer tool should want.
- **Deleting on a failed payment.** Cards fail for expiry, bank fraud
  holds and travel far more often than for fraud.

### Overage: twice wholesale, and the margin stated honestly

| Metric | R2 wholesale | Vortex overage |
|---|---|---|
| Storage / GB-month | $0.015 | $0.030 |
| Uploads / million | $4.50 | $9.00 |
| Reads / million | $0.36 | $0.72 |
| Egress / GB | $0.00 | **$0.00** |

Doubling the rate looks like a 50% margin and is not, because the card
fee lands on the *invoice* rather than on the resource. `marginOf()`
returns both numbers:

| Invoice | Headline margin | Real margin |
|---|---|---|
| $1.11 (light) | 50% | **21%** |
| $11.10 (medium) | 50% | 45% |
| $111 (heavy) | 50% | 48% |

A fixed thirty cents does not care how small the invoice is — which is
the whole argument for the next part.

### Never charge a card for fifteen cents

Below **$0.31** the fee exceeds the revenue outright. Balances roll
forward until they reach **$5**, or until the quarter ends — because a
balance that rolls forever is a receivable nobody collects and a
surprise the first time somebody does.

### A spending cap, on by default

$0 on Spark, $20 on Core, $100 on Forge, $1,000 on Titan, all
raisable in a minute by anyone who means it. A user whose app is in a
retry storm at 3am cannot lower it and will not be awake to. Hitting
the cap pauses writes and uploads; everything already stored keeps
serving.

### When a real card stops working

| Stage | After | Reads | Writes |
|---|---|---|---|
| `current` | — | yes | yes |
| `grace` | 72 h | yes | yes |
| `frozen` | 7 days | **yes** | no |
| `archived` | 90 days | cold storage | no |

The ladder never deletes, and a test asserts no stage even threatens
to. Settling the balance restores everything immediately. This is the
same rule `quotaBreaches` follows, for the same reason: a platform
whose penalty is data loss is one nobody starts a real project on.

### Operations cost more than storage

The free tier is **2 GB** — twice what Vercel Blob and Upstash give
away, and affordable because files live in R2 rather than on the box.
But at 1,000 active free users the *operations* bill beats the storage
bill, so `Quota` now meters `writesPerMonth` (10k) and `readsPerMonth`
(100k) alongside bytes, with a 50 MB cap on any single upload. A free
tier with unlimited requests is a free tier whose cost nobody can
predict.

---

## 11. Not built yet

This is a cost model and a policy, not a running control plane. The limiter,
the sleep policy, the cache rules and the upgrade triggers are real
code with tests; what is missing is the plumbing around them. Still to
build: the tenant router that calls `take()` on the way in and wakes a
sleeping schema, the per-tenant metering pipeline that feeds `Usage`, and the
provisioning that turns a blueprint into a schema and a role. The
numbers above tell us what to build toward; they do not pretend it
exists.
