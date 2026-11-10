# Credits, plans and the metered gateway

This is the commercial engine of Tungsten AI, written as code rather
than as a pricing page: `src/ai/`. Every number below is a constant in
a source file, every rule below is enforced by a test in
`src/ai/metering.test.ts` or `src/ai/gateway.test.ts`, and the two
claims that pricing documents usually make without evidence — "the
allowance cannot be abused" and "you are never charged for a failure" —
are assertions that fail the build when they stop being true.

| File | What lives there |
| --- | --- |
| `engines.ts` | The four engines, their token weights, their wholesale cost, and the provider fallback chains. |
| `pricing.ts` | Integer credit arithmetic, estimates, reservations, and the affordability clamp. |
| `plans.ts` | Spark / Core / Forge / Titan, their entitlements, refusals that name the right upgrade, and the margin invariant. |
| `wallet.ts` | Reserve, settle, release, grants, the rolling free window, the ledger. |
| `account.ts` | Identity-only session claims, entitlement reads with a short-TTL cache, billing webhooks, free-tier abuse rules. |
| `gateway.ts` | The vendor-free client: prompt composition, plan gate, hold, call, reconcile, streaming. |
| `meter.ts` | The wallet as a `Meter`, in memory or in `localStorage`. |

## Two layers, on purpose

A subscription buys **capability and capacity**: seats, hosted
projects, a custom domain, the right to call the expensive engines.
Credits buy **tokens**. Bundling the two gives you one of two bad
outcomes — light users subsidising heavy ones until the heavy ones
leave, or an unpredictable bill for everybody. Splitting them lets a
plan be cheap and a heavy month still pay for itself.

## Credits are tokens, not prompts

> `credits = ceil( (uncachedIn × wIn + cachedIn × wIn / 10 + out × wOut) / 1,000,000 )`

Weights are in milli-credits per thousand tokens, so every intermediate
value is an integer — no floating point touches money. One credit is
worth one cent at list price.

The per-prompt alternative prices a 200,000-token refactor the same as
"rename this variable". The test that pins this down:

```
short = 500 in, 200 out  on Balanced →   2 credits
long  = 200k in, 4k out  on Balanced → 220 credits
```

Both are "one prompt". One of them costs us 110 times more.

### The engines

| Engine | Min. plan | Credits / 1k in | Credits / 1k out | Wholesale in | Wholesale out | Markup |
| --- | --- | --- | --- | --- | --- | --- |
| Flash | Spark | 0.05 | 0.20 | $0.10 /M | $0.40 /M | 5.0× |
| Balanced | Spark | 1.00 | 5.00 | $3 /M | $15 /M | 3.3× |
| Precise | Core | 4.80 | 24.00 | $15 /M | $75 /M | 3.2× |
| Agent | Forge | 1.80 | 9.00 | $5 /M | $25 /M | 3.6× |

The engines are **not** named after the plans. "I'm on Forge using
Forge" is a sentence that makes every support conversation worse.

Cached input bills at a tenth, which is roughly what providers charge
for a cache hit — a discount passed on rather than pocketed. It only
exists if the prompt prefix is byte-stable, so `composePrompt` always
emits **system → block library → project schema → history → question**,
and `cachePrefix` is asserted to be identical across different
questions about the same project.

Model ids are configuration, not constants: each engine lists routes in
preference order, `validateRoutes` checks them against what the gateway
reports at boot, and a retired model costs a fallback rather than an
outage. An engine with no live route is hidden from the picker instead
of being offered and then refused.

## Plans

| Plan | Price | Included credits | Daily fallback | Engines | Seats | Max media | Hosted projects |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Spark | free | 250 / month | 10 per rolling 24h | Flash, Balanced | 1 | 25 MB | 1 (sleeps) |
| Core | $19 | 2,500 | — | + Precise | 1 | 100 MB | 5 |
| Forge | $49 | 9,000 | — | + Agent | 5 | 500 MB | 25 |
| Titan | $149 | 30,000 | — | all | 25 | 2 GB | 200 |

Top-ups never expire: 1,000 for $10, 5,000 for $45, 20,000 for $160.
Credits are spent perishable-first — this period's allowance, then
today's free grant, then purchased packs.

Three rules the tests enforce:

1. **An allowance cannot be spent into a loss.** Spend a plan's entire
   allowance on the most expensive engine that plan may call and the
   worst-case provider bill must still leave 25% of the price. Titan's
   worst possible month is about $94 of inference against $149 of
   revenue. The free plan's worst month, monthly allowance plus thirty
   daily grants, is $1.65.
2. **The free ladder is coherent.** The daily fallback is in the same
   order of magnitude as the monthly allowance ÷ 30. A tier that gives
   50 a month and 5 a day is really a 150-a-month tier for anyone who
   notices, which is eventually everyone.
3. **Nothing is gated that makes the product look broken.** Code export
   and bring-your-own-backend are on every plan including free — a
   builder you cannot leave is not a builder. Media is capped by
   *bytes*, not switched off: a refused 20 KB icon reads as a bug, a
   refused 80 MB video reads as a limit.

Every gate returns a `Refusal` carrying a sentence and the **cheapest**
plan that would allow it, computed rather than typed in, so nobody is
ever upsold two tiers for a one-tier feature.

## The call lifecycle

```
estimate → gate on plan → clamp output to the balance → reserve → call → settle
                                                             ↘ failure → release
```

1. **Gate on plan first.** Refusing after a network round trip wastes a
   second and a provider call.
2. **Clamp.** `affordableOutputTokens` works out how long a reply the
   remaining balance can pay for and sends that as the request's hard
   output limit. The call is then physically unable to overspend — not
   "should not", cannot. Below 256 affordable tokens the call is
   refused outright rather than answered uselessly.
3. **Reserve.** A hold is opened for the ceiling, against an
   idempotency key. The input side of the hold carries a 20% margin
   because tokenisers disagree and the gateway's count is the one that
   bills.
4. **Settle** against the usage the *gateway* reports, never the
   client's estimate. The difference comes back as a refund. If the
   gateway's count somehow exceeds the hold, the charge is clamped to
   the hold and we absorb the rest.
5. **Release** in full on failure. A provider outage is not also a
   billing incident.

**Idempotency keys** make all of this safe to retry: reserving twice
returns the first hold, settling twice returns the first charge, and a
key that has already settled gets a hold of zero so a retried request
cannot quietly cost twice.

**Streaming** has one rule, written down once: an abandoned stream is
billed for the tokens that actually arrived. The provider charged us
for those, and a user who can cancel a 10,000-token answer for free can
read the first 9,000 tokens of every answer for free. Nothing arrived,
nothing charged.

**Crashed clients** are swept: a hold older than five minutes is
released automatically, so money comes back without anybody filing a
ticket.

## Identity in the token, entitlements in the database

A Tungsten session token carries `sub`, `sid`, `iat`, `exp` — and a
test asserts that list, so the first well-meaning `plan: 'titan'` claim
fails the build. Plans in tokens mean a cancelled subscription keeps
working until the token expires, an upgrade takes an hour to arrive,
and a balance that changes every few seconds cannot live there at all.

Entitlements are read server-side from the account through a cache with
a 30-second TTL that the billing webhook invalidates by hand: an
upgrade is live in milliseconds, a cancellation is live in
milliseconds, and the worst case is thirty seconds of staleness if a
webhook is lost. Balances are never served from that cache for spending
decisions — a reservation always touches the real wallet.

Billing events are idempotent by key, because payment providers retry
webhooks as policy. Cancellation drops to the free plan immediately but
keeps purchased top-ups: those were bought, not rented.

## The free tier, and the people who farm it

A Spark wallet spent entirely on the dearest engine it may call costs
about $1.65 a month. That is affordable per real person and expensive
per thousand scripted signups, so `freeGrantRefusal` withholds the
*grant*, not the account, when the email is disposable or unverified or
the device has already collected several allowances. Somebody caught by
it can still build, export and bring their own key — refusing the
account instead punishes the shared-office case, which is a real case.

## What is not built here

This rung is the engine and its rules. Still to come, in order:

1. The gateway service itself — the thing on the other end of
   `POST /v1/complete`, holding the provider keys, doing the routing
   and reporting usage. Tungsten already speaks its wire format.
2. The billing integration: a payment provider's webhooks mapped onto
   `applyBillingEvent`.
3. The UI: a balance in the status bar, the estimate next to the send
   button, the usage list, and the upgrade sheet driven by
   `Refusal.upgradeTo`.
4. Wiring `src/editor/ai` and the AI Architect onto `createGateway`, so
   the assistant and the schema planner spend from the same wallet.
