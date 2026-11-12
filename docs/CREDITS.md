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
| `costs.ts` | The wholesale price table: every provider model we route to, with the date it was read, the long-context cliffs and the published future rises. |
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
short = 500 in, 200 out  on Balanced →   1 credit
long  = 200k in, 4k out  on Balanced → 132 credits
```

Both are "one prompt". One of them costs us 110 times more.

### The engines

An engine is a **price band with a fallback chain inside it**. The
retail weight is set against the *dearest* route in the chain, so
failing over from Claude to GPT to Gemini changes the flavour of the
answer and never changes the bill.

| Engine | Min. plan | Credits / 1k in | Credits / 1k out | Routes, in preference order | Dearest route | Markup |
| --- | --- | --- | --- | --- | --- | --- |
| Flash | Spark | 0.10 | 0.40 | Gemini 2.5 Flash-Lite → Claude Haiku 5.5 → GPT-5.4 Nano → DeepSeek V4 | $0.30 / $1.25 per M | 3.2× |
| Balanced | Spark | 0.60 | 3.00 | Claude Sonnet 5.5 → GPT-5 → Gemini 3.8 Flash | $2 / $10 per M | 3.0× |
| Precise | Core | 1.40 | 8.40 | Claude Opus 5.5 → GPT-5.5 → Gemini 3.1 Pro | $5 / $30 per M | 2.8× |
| Agent | Forge | 0.75 | 4.50 | Claude Sonnet 5.5 → GPT-5.4 → DeepSeek V4 | $2.50 / $15 per M | 3.0× |

Wholesale rates were read from published provider pricing in **November
2026** and live in `costs.ts` with that date attached. Three details
that pricing pages bury, and that a margin calculation gets wrong if it
ignores them:

- **Long-context cliffs.** Claude Haiku 5.5 reprices the whole request
  five-fold above 100k tokens; Gemini 3.1 Pro doubles above 200k. Each
  engine therefore carries a `contextCap` that keeps it below its
  chain's cliffs, and `worstRates` only counts a cliff we are willing
  to cross.
- **Announced rises.** Google has published that Gemini 3.8 Flash goes
  from $0.75/$3.75 to $1.50/$7.50 on 1 January 2027. A price rise we
  already know about is part of today's worst case.
- **Cache reads are not all 10%.** Anthropic's flagships read cache at
  5% of input, Haiku at 10%, Gemini Flash at about 4%. We bill cached
  input at a flat 10% of our input weight, and a test asserts that is
  still a 2.75× markup on every chain.

Precise runs at 2.8× rather than 3× on purpose: at the top of the
market people buy capability, and a thinner slice of a bigger number is
still a bigger number.

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

| Plan | Price | Annual | Included credits | List value | Daily fallback | Engines | Seats | Max media | Hosted projects |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Spark | free | — | 250 / month | — | 10 per rolling 24h | Flash, Balanced | 1 | 25 MB | 1 (sleeps) |
| Core | $20 | $200 | 3,000 | $30 | — | + Precise | 1 | 100 MB | 5 |
| Forge | $60 | $600 | 9,000 | $90 | — | + Agent | 5 | 500 MB | 25 |
| Titan | $200 | $2,000 | 25,000 | $250 | — | all | 25 | 2 GB | 200 |

Annual billing charges ten months for twelve. Top-ups never expire:
1,000 for $10, 5,000 for $45, 20,000 for $160 — all comfortably above
the $0.0036 a credit can cost us at worst.

The market this is priced into, as of late 2026: Cursor Pro $20, Replit
Core $20–25, Lovable Pro $25 (100 credits), Bolt Pro $25–29, Lovable
Business $50, Cursor Pro+ $60, Cursor Ultra and Bolt Pro 200 at $200.
Core sits at the bottom of the entry band and includes roughly 500
Balanced turns a month rather than 100 messages.

### Where the money goes

Worst case means *every* included credit spent on the dearest engine
the plan allows, at the dearest route that engine may fall back to,
with cliffs and announced rises counted — plus hosting and the card
network's 2.9% + 30¢.

| Plan | Price | Inference (worst) | Hosting | Card fees | Total | Margin (worst) | Margin at 35% use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Spark | $0 | $1.83 | $0.40 | — | $2.23 | — | ≈ $0.77 |
| Core | $20 | $10.71 | $2.00 | $0.88 | $13.59 | 32% | 67% |
| Forge | $60 | $32.14 | $7.00 | $2.04 | $41.18 | 31% | 67% |
| Titan | $200 | $89.29 | $30.00 | $6.10 | $125.39 | 37% | 74% |

Those worst-case rows are what makes the hard stop meaningful: there is
no month, no prompt and no fallback chain in which a plan costs more
than it charges. `economicsOf(plan)` returns the whole breakdown, and
`metering.test.ts` fails the build below a 30% worst-case margin.

Note what the top tier does *not* get: the deepest discount. Core and
Forge include 1.5× their price in credits; Titan includes 1.25×. The
biggest allowance is the most farmable one, so the top plan is sold on
seats, audit log and support instead of on the cheapest token.

Three rules the tests enforce:

1. **An allowance cannot be spent into a loss.** Spend a plan's entire
   allowance on the dearest engine it may call, at the dearest route
   that engine may fall back to, and 30% of the price must still
   survive hosting and card fees. The free plan's worst month —
   monthly allowance plus thirty daily grants, plus hosting — is
   $2.23, which is the number an abuse model needs.
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
about $2.23 a month including hosting, and about $0.77 at realistic
use. That is affordable per real person and expensive
per thousand scripted signups, so `freeGrantRefusal` withholds the
*grant*, not the account, when the email is disposable or unverified or
the device has already collected several allowances. Somebody caught by
it can still build, export and bring their own key — refusing the
account instead punishes the shared-office case, which is a real case.

## What is not built here

### Built since

**The UI.** The balance is in the status bar — and turns amber below
300, which is a tenth of a Core month: enough warning to act on,
infrequent enough not to nag from the day the plan renews. The usage
list, the plans and the top-ups are in the builder's AI tab. The
estimate sits under the assistant's question box, as two numbers
rather than one: *"about 6, at most 24 credits on Balanced"*, with the
remaining balance beside it as a button into the plans. The Ask button
disables itself when the balance cannot cover the ceiling, so the
refusal arrives before the request rather than after it.

**The editor assistant, on the gateway.** `meteredAssistant` in
`src/editor/ai/meteredProvider.ts` is a third provider beside the
offline rules engine and the bring-your-own-endpoint one. It composes
the prompt in cache order — a constant system block, then constant
house rules, then the file — so the cached prefix is byte-identical
between turns and the repeated part bills at a tenth. The file itself
stays *out* of that prefix, because it changes on every keystroke and
a cache entry that never hits costs more to write than it saves.

The quote and the hold come from one place: `estimateTurn` prices the
same `promptFor` output the call will send, with the same 2,048-token
output clamp, so the number on the button and the number in the ledger
cannot disagree. A refusal comes back as the assistant's *answer* —
running out of credits is an ordinary state with a sentence and an
upgrade attached, not a stack trace in a red box. And the money does
not buy permissions: the metered provider returns an `AiProposal` like
the other two, and `aiModel.ts` still decides whether it may touch a
buffer.

One wallet for the whole workbench. `App.tsx` owns `useAiWallet()` and
hands it to the builder, so the editor assistant and the builder's
panel spend from the same ledger.

### Still to come

This rung is the engine and its rules. Still outstanding:

1. The gateway service itself — the thing on the other end of
   `POST /v1/complete`, holding the provider keys, doing the routing
   and reporting usage. Tungsten already speaks its wire format, and
   points at it with `VITE_AI_GATEWAY`; without that variable there is
   nothing to call, the offline assistant answers, and no price is
   quoted for work that costs nothing.
2. The billing integration: a payment provider's webhooks mapped onto
   `applyBillingEvent`.
3. The upgrade sheet driven by `Refusal.upgradeTo`.
4. Wiring the AI Architect onto `createGateway`, so the schema planner
   spends from the same wallet the assistant does.
