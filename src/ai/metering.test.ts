import { describe, expect, it } from 'vitest'

import {
  BALANCED,
  ENGINES,
  FLASH,
  MINIMUM_MARKUP,
  PRECISE,
  engineById,
  resolveEngine,
  routeKey,
  unpricedRoutes,
  validateRoutes,
  worstRatesFor,
} from './engines'
import { PRICES_READ_ON, costOf, priceFor, ratesFor, worstRates } from './costs'
import {
  MINIMUM_OUTPUT_TOKENS,
  affordableOutputTokens,
  creditsFor,
  describeSpend,
  estimateFor,
  markupOf,
  microCreditsFor,
  reservationFor,
  wholesalePerCredit,
} from './pricing'
import {
  MINIMUM_PLAN_MARGIN,
  CORE,
  FORGE,
  PLANS,
  SPARK,
  TITAN,
  TOP_UPS,
  annualCents,
  economicsOf,
  includedValueRatio,
  engineRefusal,
  featureRefusal,
  mediaRefusal,
  perCreditCents,
  planOr,
  seatRefusal,
} from './plans'
import {
  FREE_WINDOW_MS,
  HOLD_TTL_MS,
  applyGrant,
  balance,
  changePlan,
  expire,
  newWallet,
  recent,
  release,
  reserve,
  settle,
  settleAbort,
  spentThisPeriod,
  summarise,
  type Wallet,
} from './wallet'
import {
  DEVICE_ACCOUNT_LIMIT,
  IDENTITY_CLAIMS,
  applyBillingEvent,
  claimsFor,
  createEntitlementCache,
  entitlementsFor,
  freeGrantRefusal,
  mayUseEngine,
  newAccount,
  type Account,
} from './account'

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)
const HOUR = 60 * 60 * 1000

/* ------------------------------------------------------------- engines */

describe('the engine catalogue', () => {
  it('never sells a token for less than it costs', () => {
    for (const engine of ENGINES) {
      expect(markupOf(engine), `${engine.label} markup`).toBeGreaterThanOrEqual(MINIMUM_MARKUP)
    }
  })

  it('does not reuse the plan names, so support can tell them apart', () => {
    const planWords = PLANS.map((plan) => plan.label.toLowerCase())
    for (const engine of ENGINES) {
      expect(planWords).not.toContain(engine.label.toLowerCase())
    }
  })

  it('is optimistic before the gateway has been asked', () => {
    expect(resolveEngine(BALANCED)).toEqual(BALANCED.routes[0])
    expect(validateRoutes([])[0].missing).toEqual([])
  })

  it('falls back to the next provider when the preferred model is gone', () => {
    const available = [routeKey(BALANCED.routes[1])]
    expect(resolveEngine(BALANCED, available)).toEqual(BALANCED.routes[1])
    const report = validateRoutes(available).find((line) => line.engine === 'balanced')!
    expect(report.dark).toBe(false)
    expect(report.missing).toContain(routeKey(BALANCED.routes[0]))
  })

  it('calls an engine dark when no route survives, rather than failing later', () => {
    const report = validateRoutes(['openai:something-else']).find((line) => line.engine === 'precise')!
    expect(report.dark).toBe(true)
    expect(report.route).toBeUndefined()
  })
})

/* ----------------------------------------------------------- wholesale */

describe('what inference costs us', () => {
  it('has a price for every route an engine can fall back to', () => {
    expect(unpricedRoutes()).toEqual([])
    expect(PRICES_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('counts the long-context cliff when we are willing to cross it', () => {
    const haiku = priceFor('anthropic', 'claude-haiku-5.5')!
    // Past 100k, the whole request reprices five-fold.
    expect(ratesFor(haiku, 50_000).outputPerK).toBe(500)
    expect(ratesFor(haiku, 150_000).outputPerK).toBe(2_500)
    // Flash caps its context below the cliff, so the cliff is not in
    // Flash's worst case -- which is the only reason the band is cheap.
    expect(worstRates(haiku, 100_000).outputPerK).toBe(500)
    expect(worstRates(haiku).outputPerK).toBe(2_500)
    expect(worstRatesFor(FLASH).outputPerK).toBeLessThan(2_500)
  })

  it('counts a price rise a provider has already announced', () => {
    const gemini = priceFor('google', 'gemini-3.8-flash')!
    expect(gemini.scheduled?.from).toBe('2027-01-01')
    expect(worstRates(gemini).outputPerK).toBe(gemini.scheduled!.outputPerK)
    expect(worstRates(gemini).outputPerK).toBeGreaterThan(gemini.outputPerK)
  })

  it('adds a call up the way the invoice will', () => {
    const sonnet = priceFor('anthropic', 'claude-sonnet-5.5')!
    // 10k fresh input at $2/M is $0.020, 50k cached at $0.10/M is
    // $0.005, 2k output at $10/M is $0.020: four and a half cents.
    expect(costOf(sonnet, { inputTokens: 10_000, cachedInputTokens: 50_000, outputTokens: 2_000 })).toBe(45_000)
  })

  it('never bills cached input below what a cache read costs us', () => {
    for (const engine of ENGINES) {
      // We charge a tenth of the input weight for cached tokens.
      const retailPerK = engine.creditsIn
      expect(retailPerK / worstRatesFor(engine).cachedInputPerK, `${engine.label} cache markup`).toBeGreaterThanOrEqual(
        MINIMUM_MARKUP,
      )
    }
  })
})

/* ------------------------------------------------------------- pricing */

describe('credit arithmetic', () => {
  it('bills per token, not per prompt', () => {
    const short = creditsFor(BALANCED, { inputTokens: 500, outputTokens: 200 })
    const long = creditsFor(BALANCED, { inputTokens: 200_000, outputTokens: 4_000 })
    expect(short).toBe(1)
    expect(long).toBe(132)
    // The thing the per-prompt model gets wrong, in one assertion.
    expect(long / short).toBeGreaterThan(30)
  })

  it('charges a tenth for cached input', () => {
    const fresh = creditsFor(BALANCED, { inputTokens: 10_000, outputTokens: 0 })
    const cached = creditsFor(BALANCED, { inputTokens: 0, cachedInputTokens: 10_000, outputTokens: 0 })
    expect(fresh).toBe(6)
    expect(cached).toBe(1)
  })

  it('keeps every intermediate value a whole number', () => {
    const micro = microCreditsFor(FLASH, { inputTokens: 1_234, cachedInputTokens: 77, outputTokens: 999 })
    expect(Number.isInteger(micro)).toBe(true)
  })

  it('charges nothing for a call that produced nothing, and at least one credit for one that did', () => {
    expect(creditsFor(BALANCED, { inputTokens: 0, outputTokens: 0 })).toBe(0)
    expect(creditsFor(FLASH, { inputTokens: 10, outputTokens: 1 })).toBe(1)
  })

  it('reserves the ceiling and estimates below it', () => {
    const estimate = estimateFor(BALANCED, { inputTokens: 8_000, maxOutputTokens: 4_000 })
    const hold = reservationFor(BALANCED, { inputTokens: 8_000, maxOutputTokens: 4_000 })
    expect(estimate.credits).toBeLessThan(estimate.ceiling)
    expect(hold).toBe(estimate.ceiling)
    expect(hold).toBe(creditsFor(BALANCED, { inputTokens: 8_000, outputTokens: 4_000 }))
  })

  it('works out how long a reply the balance can pay for', () => {
    // 100 credits, 4k of input: 96 credits of output left at 5 per 1k.
    expect(affordableOutputTokens(BALANCED, 100, { inputTokens: 4_000 })).toBe(16_384)
    expect(affordableOutputTokens(BALANCED, 10, { inputTokens: 4_000 })).toBe(2_533)
    expect(affordableOutputTokens(BALANCED, 2, { inputTokens: 4_000 })).toBe(0)
  })

  it('reads a spend back in English', () => {
    const usage = { inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 16_000 }
    expect(describeSpend(PRECISE, usage, creditsFor(PRECISE, usage))).toBe(
      '415 credits — 200k in, 16k out on Precise',
    )
  })
})

/* --------------------------------------------------------------- plans */

describe('plans', () => {
  it('cannot have their allowance spent into a loss', () => {
    for (const plan of PLANS.filter((candidate) => candidate.priceCents > 0)) {
      const economics = economicsOf(plan)
      expect(economics.margin, `${plan.label} worst-case margin`).toBeGreaterThanOrEqual(MINIMUM_PLAN_MARGIN)
    }
  })

  it('keeps the free plan cheap enough to give away', () => {
    const economics = economicsOf(SPARK)
    // Worst case, in dollars, for one farmed free account for a month:
    // every credit and every daily top-up spent on Balanced, plus the
    // hosting its one sleeping project uses.
    expect(economics.totalCostCents / 100).toBeLessThan(2.5)
    // What it realistically costs, which is the number that scales.
    expect(economicsOf(SPARK, { utilisation: 0.2 }).totalCostCents / 100).toBeLessThan(1)
  })

  it('still clears the margin once hosting and card fees are counted', () => {
    for (const plan of PLANS.filter((candidate) => candidate.priceCents > 0)) {
      const economics = economicsOf(plan)
      expect(economics.processingCents).toBeGreaterThan(0)
      expect(economics.infraCents).toBeGreaterThan(0)
      expect(economics.totalCostCents).toBeGreaterThan(economics.inferenceCents)
      // And the realistic month is a very different business.
      expect(economicsOf(plan, { utilisation: 0.35 }).margin).toBeGreaterThan(0.6)
    }
  })

  it('does not hand the biggest allowance the biggest discount', () => {
    // The deepest included discount is the most farmable one, so it
    // does not live on the plan with the most credits.
    expect(includedValueRatio(CORE)).toBeCloseTo(1.5, 2)
    expect(includedValueRatio(FORGE)).toBeCloseTo(1.5, 2)
    expect(includedValueRatio(TITAN)).toBeLessThan(includedValueRatio(CORE))
    expect(includedValueRatio(TITAN)).toBeGreaterThan(1)
  })

  it('prices against the market it is sold into', () => {
    // Cursor Pro $20, Replit Core $20-25, Lovable Pro $25, Bolt Pro
    // $25-29 at entry; Lovable Business $50, Cursor Pro+ $60 in the
    // middle; Cursor Ultra and Bolt Pro 200 at $200 on top.
    expect(CORE.priceCents).toBeLessThanOrEqual(2_500)
    expect(FORGE.priceCents).toBeLessThanOrEqual(6_500)
    expect(TITAN.priceCents).toBeLessThanOrEqual(20_000)
    expect(annualCents(CORE)).toBe(CORE.priceCents * 10)
  })

  it('has a coherent free ladder', () => {
    // The daily fallback must be the same shape as the monthly
    // allowance, not three times it.
    expect(SPARK.dailyCredits).toBeLessThanOrEqual((2 * SPARK.monthlyCredits) / 30)
    expect(SPARK.dailyCredits).toBeGreaterThan(0)
    for (const plan of PLANS.filter((candidate) => candidate.priceCents > 0)) {
      expect(plan.dailyCredits).toBe(0)
    }
  })

  it('never holds the code or the backend hostage', () => {
    for (const plan of PLANS) {
      expect(plan.features.exportCode).toBe(true)
      expect(plan.features.ownBackend).toBe(true)
    }
  })

  it('refuses an engine by naming the cheapest plan that has it', () => {
    const refusal = engineRefusal(SPARK, 'precise')!
    expect(refusal.upgradeTo).toBe('core')
    expect(refusal.message).toContain('Precise')
    expect(engineRefusal(planOr('core'), 'precise')).toBeUndefined()
    expect(engineRefusal(planOr('core'), 'agent')!.upgradeTo).toBe('forge')
  })

  it('gates media on bytes, so a small file is never refused', () => {
    expect(mediaRefusal(SPARK, 20 * 1024)).toBeUndefined()
    const refusal = mediaRefusal(SPARK, 60 * 1024 * 1024)!
    expect(refusal.reason).toBe('size')
    expect(refusal.upgradeTo).toBe('core')
  })

  it('gates features and seats the same way', () => {
    expect(featureRefusal(SPARK, 'customDomain', 'A custom domain')!.upgradeTo).toBe('core')
    expect(featureRefusal(SPARK, 'teamSharing', 'Sharing a project')!.upgradeTo).toBe('forge')
    expect(featureRefusal(planOr('titan'), 'auditLog', 'The audit log')).toBeUndefined()
    expect(seatRefusal(SPARK, 4)!.upgradeTo).toBe('forge')
  })

  it('prices top-ups above cost and below the list credit', () => {
    const dearest = Math.max(...ENGINES.map(wholesalePerCredit)) / 10_000
    for (const pack of TOP_UPS) {
      expect(perCreditCents(pack)).toBeLessThanOrEqual(1)
      expect(perCreditCents(pack)).toBeGreaterThan(dearest)
    }
  })
})

/* -------------------------------------------------------------- wallet */

const spark = () => newWallet('spark', T0)

describe('the wallet', () => {
  it('charges what was used, not what was held', () => {
    const held = reserve(spark(), { key: 'call-1', engine: 'balanced', credits: 90, now: T0 })
    expect(held.ok).toBe(true)
    if (!held.ok) return
    expect(balance(held.wallet, T0).total).toBe(170)
    expect(balance(held.wallet, T0).held).toBe(90)

    const done = settle(held.wallet, {
      key: 'call-1',
      credits: creditsFor(BALANCED, { inputTokens: 4_000, outputTokens: 1_000 }),
      usage: { inputTokens: 4_000, outputTokens: 1_000 },
      now: T0 + 2_000,
    })
    expect(done.charged).toBe(6)
    expect(done.refunded).toBe(84)
    expect(balance(done.wallet, T0 + 2_000).total).toBe(254)
    expect(balance(done.wallet, T0 + 2_000).held).toBe(0)
  })

  it('never bills a failed call', () => {
    const held = reserve(spark(), { key: 'call-2', engine: 'balanced', credits: 120, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    const given = release(held.wallet, { key: 'call-2', now: T0 + 500, reason: 'The gateway timed out.' })
    expect(given.charged).toBe(0)
    expect(balance(given.wallet, T0 + 500).total).toBe(260)
    expect(recent(given.wallet)[0].kind).toBe('release')
  })

  it('charges once however many times the same key is retried', () => {
    const first = reserve(spark(), { key: 'same', engine: 'flash', credits: 20, now: T0 })
    if (!first.ok) throw new Error('expected a hold')
    const second = reserve(first.wallet, { key: 'same', engine: 'flash', credits: 20, now: T0 + 10 })
    expect(second.ok && second.replayed).toBe(true)
    if (!second.ok) return
    expect(balance(second.wallet, T0).total).toBe(240)

    const once = settle(second.wallet, { key: 'same', credits: 7, usage: { inputTokens: 1, outputTokens: 1 }, now: T0 + 20 })
    const twice = settle(once.wallet, { key: 'same', credits: 7, usage: { inputTokens: 1, outputTokens: 1 }, now: T0 + 30 })
    expect(twice.replayed).toBe(true)
    expect(balance(twice.wallet, T0 + 30).total).toBe(253)
    expect(spentThisPeriod(twice.wallet)).toBe(7)
  })

  it('spends the perishable money first', () => {
    const topped = applyGrant(spark(), { key: 'pack', at: T0, kind: 'topUp', credits: 500 })
    const held = reserve(topped, { key: 'big', engine: 'balanced', credits: 300, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    const after = balance(held.wallet, T0)
    // 250 of allowance, then 10 of today's free grant, then 40 of top-up.
    expect(after.included).toBe(0)
    expect(after.free).toBe(0)
    expect(after.topUp).toBe(460)
  })

  it('refills the free grant on a rolling 24 hours, not at midnight', () => {
    const drained: Wallet = { ...spark(), included: 0 }
    const held = reserve(drained, { key: 'free-1', engine: 'flash', credits: 10, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    const used = settle(held.wallet, { key: 'free-1', credits: 10, usage: { inputTokens: 1, outputTokens: 1 }, now: T0 })
    expect(balance(used.wallet, T0).free).toBe(0)
    expect(balance(used.wallet, T0 + 23 * HOUR).free).toBe(0)
    expect(balance(used.wallet, T0 + FREE_WINDOW_MS + 1).free).toBe(10)
  })

  it('stops hard when the money is gone, and says what to do about it', () => {
    const refused = reserve(spark(), { key: 'too-big', engine: 'balanced', credits: 400, now: T0 })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.refusal.reason).toBe('credits')
    expect(refused.refusal.upgradeTo).toBe('core')
    expect(refused.refusal.message).toContain('260')
  })

  it('sweeps the holds of clients that never came back', () => {
    const held = reserve(spark(), { key: 'orphan', engine: 'balanced', credits: 100, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    const swept = expire(held.wallet, T0 + HOLD_TTL_MS + 1)
    expect(balance(swept, T0 + HOLD_TTL_MS + 1).total).toBe(260)
    expect(swept.holds).toHaveLength(0)
  })

  it('bills an abandoned stream for what it delivered', () => {
    const held = reserve(spark(), { key: 'stream', engine: 'balanced', credits: 100, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    const stopped = settleAbort(held.wallet, {
      key: 'stream',
      credits: creditsFor(BALANCED, { inputTokens: 1_000, outputTokens: 600 }),
      usage: { inputTokens: 1_000, outputTokens: 600 },
      now: T0 + 1_000,
    })
    expect(stopped.charged).toBe(3)
    expect(stopped.entry?.note).toContain('billed for what was delivered')
  })

  it('will not charge against a hold it no longer has', () => {
    const late = settle(spark(), { key: 'ghost', credits: 50, usage: { inputTokens: 1, outputTokens: 1 }, now: T0 })
    expect(late.charged).toBe(0)
    expect(late.entry?.kind).toBe('adjust')
    expect(balance(late.wallet, T0).total).toBe(260)
  })

  it('applies a replayed billing webhook exactly once', () => {
    const once = applyGrant(spark(), { key: 'evt_1', at: T0, kind: 'topUp', credits: 1_000 })
    const twice = applyGrant(once, { key: 'evt_1', at: T0, kind: 'topUp', credits: 1_000 })
    expect(twice.topUp).toBe(1_000)
  })

  it('makes an upgrade effective immediately', () => {
    const upgraded = changePlan(spark(), 'core', T0 + HOUR)
    expect(upgraded.plan).toBe('core')
    // The difference lands at once; the free daily grant goes away,
    // because a paid plan that keeps handing out free credits is a
    // plan nobody tops up.
    expect(balance(upgraded, T0 + HOUR).total).toBe(3_000)
  })

  it('reads its own balance out loud', () => {
    expect(summarise(spark(), T0).sentence).toBe(
      "260 credits on Spark. 10 of today's 10 free credits left.",
    )
  })
})

/* ------------------------------------------------------------ accounts */

describe('accounts and entitlements', () => {
  it('puts nothing but identity in the session token', () => {
    const account = newAccount('acc_1', 'dev@example.com', T0, 'titan')
    const claims = claimsFor(account, { sessionId: 'sess_1', now: T0 })
    expect(Object.keys(claims).sort()).toEqual([...IDENTITY_CLAIMS].sort())
    const serialised = JSON.stringify(claims)
    expect(serialised).not.toContain('titan')
    expect(serialised).not.toContain('credit')
  })

  it('reads the plan from the account, so a downgrade is instant', () => {
    let account = newAccount('acc_2', 'dev@example.com', T0, 'forge')
    expect(mayUseEngine(entitlementsFor(account, T0), 'agent')).toBeUndefined()
    account = applyBillingEvent(account, { type: 'subscription.cancelled', accountId: 'acc_2', key: 'evt_c', at: T0 })
    expect(mayUseEngine(entitlementsFor(account, T0), 'agent')!.upgradeTo).toBe('forge')
    expect(entitlementsFor(account, T0).plan.id).toBe('spark')
  })

  it('keeps purchased credits through a cancellation', () => {
    let account = newAccount('acc_3', 'dev@example.com', T0, 'core')
    account = applyBillingEvent(account, {
      type: 'topup.purchased',
      accountId: 'acc_3',
      key: 'evt_t',
      at: T0,
      credits: 5_000,
    })
    account = applyBillingEvent(account, { type: 'subscription.cancelled', accountId: 'acc_3', key: 'evt_c', at: T0 })
    const after = entitlementsFor(account, T0).balance
    expect(after.topUp).toBe(5_000)
    expect(after.included).toBe(0)
  })

  it('caches entitlements briefly and drops them the moment billing says so', () => {
    const accounts = new Map<string, Account>([['acc_4', newAccount('acc_4', 'dev@example.com', T0, 'core')]])
    let reads = 0
    const cache = createEntitlementCache({
      ttlMs: 30_000,
      load: (id) => {
        reads += 1
        return accounts.get(id)
      },
    })

    expect(cache.get('acc_4', T0)!.plan.id).toBe('core')
    cache.get('acc_4', T0 + 1_000)
    expect(reads).toBe(1)

    accounts.set('acc_4', applyBillingEvent(accounts.get('acc_4')!, {
      type: 'plan.changed',
      accountId: 'acc_4',
      key: 'evt_p',
      at: T0,
      plan: 'titan',
    }))
    cache.invalidate('acc_4')
    expect(cache.get('acc_4', T0 + 1_100)!.plan.id).toBe('titan')
    expect(reads).toBe(2)
  })

  it('goes stale on its own after the TTL, even if nobody tells it', () => {
    const account = newAccount('acc_5', 'dev@example.com', T0)
    let reads = 0
    const cache = createEntitlementCache({
      ttlMs: 30_000,
      load: () => {
        reads += 1
        return account
      },
    })
    cache.get('acc_5', T0)
    cache.get('acc_5', T0 + 31_000)
    expect(reads).toBe(2)
  })

  it('withholds the free grant from farms without refusing the account', () => {
    const clean = { emailVerified: true, accountsOnDevice: 1, accountsOnNetwork: 2, disposableEmail: false }
    expect(freeGrantRefusal(clean)).toBeUndefined()
    expect(freeGrantRefusal({ ...clean, emailVerified: false })!.message).toContain('Verify your email')
    expect(freeGrantRefusal({ ...clean, disposableEmail: true })!.upgradeTo).toBe('core')
    expect(freeGrantRefusal({ ...clean, accountsOnDevice: DEVICE_ACCOUNT_LIMIT + 1 })!.upgradeTo).toBe('core')
  })
})

/* ------------------------------------------------- the whole sum, twice */

describe('the numbers behind the pitch', () => {
  it('survives the month a Titan customer spends the whole allowance on the dearest engine', () => {
    const titan = planOr('titan')
    const economics = economicsOf(titan)
    expect(economics.dearestEngine).toBe('precise')
    // $200 in; $89 of inference, $30 of hosting and $6 to the card
    // network out, in the worst month that is physically possible.
    expect(Math.round(economics.inferenceCents / 100)).toBe(89)
    expect(Math.round(economics.totalCostCents / 100)).toBe(125)
    expect(economics.margin).toBeGreaterThan(0.37)
  })

  it('agrees with itself: one engine, two ways of pricing the same month', () => {
    const engine = engineById('precise')!
    const creditsPerCall = creditsFor(engine, { inputTokens: 200_000, outputTokens: 16_000 })
    const calls = Math.floor(planOr('titan').monthlyCredits / creditsPerCall)
    const wholesaleCents = (calls * creditsPerCall * wholesalePerCredit(engine)) / 10_000
    expect(calls).toBe(60)
    expect(wholesaleCents).toBeLessThan(planOr('titan').priceCents)
  })

  it('refuses to start an answer too small to be worth charging for', () => {
    expect(affordableOutputTokens(PRECISE, 2, { inputTokens: 1_000 })).toBeLessThan(MINIMUM_OUTPUT_TOKENS)
  })
})
