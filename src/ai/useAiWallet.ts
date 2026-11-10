/**
 * The wallet, as React sees it.
 *
 * One hook over the pure state machine in `wallet.ts`, holding the
 * balance that the credits panel renders and the AI assistant spends
 * from. It persists to `localStorage` so a reload does not look like a
 * refund, and it is explicit about what that means: a browser-held
 * balance is a *shadow* of the real one. When a gateway is configured,
 * the server's wallet is the truth and this one is refreshed from it;
 * until then it is the only wallet there is, and it is honest enough
 * for an offline build and for every test in the suite.
 */

import { useCallback, useMemo, useState } from 'react'

import { browserStore, walletMeter, type WalletStore } from './meter'
import { planOr, topUpById, type PlanId } from './plans'
import {
  applyGrant,
  balance,
  changePlan as movePlan,
  recent,
  spentThisPeriod,
  summarise,
  type Balance,
  type LedgerEntry,
  type Wallet,
  type WalletSummary,
} from './wallet'
import type { Meter } from './gateway'

export type AiWallet = {
  wallet: Wallet
  plan: ReturnType<typeof planOr>
  balance: Balance
  summary: WalletSummary
  /** Newest first, for the usage list. */
  history: LedgerEntry[]
  spentThisPeriod: number
  /** The meter to hand `createGateway`. Stable across renders. */
  meter: Meter
  choosePlan: (plan: PlanId) => void
  buyTopUp: (packId: string) => void
  /** Re-reads the store after something else has spent from it. */
  refresh: () => void
}

export function useAiWallet(options: { store?: WalletStore; now?: () => number } = {}): AiWallet {
  // Memoised so the callbacks below do not get a new identity on every
  // render just because the caller wrote an inline clock.
  const clock = useMemo(() => options.now ?? (() => Date.now()), [options.now])
  // Lazy state rather than a ref: the store has to be created exactly
  // once, and reading a ref during render is a rule React's compiler
  // enforces for good reasons.
  const [store] = useState<WalletStore>(
    () =>
      options.store ??
      browserStore(typeof localStorage === 'undefined' ? undefined : localStorage, { now: clock() }),
  )

  const [wallet, setWallet] = useState<Wallet>(() => store.read())

  const write = useCallback(
    (next: Wallet) => {
      store.write(next)
      setWallet(next)
    },
    [store],
  )

  const refresh = useCallback(() => setWallet(store.read()), [store])

  // The gateway spends through the store directly; `refresh` is how the
  // panel finds out. Wrapping the meter keeps that one line in one place.
  const meter = useMemo<Meter>(() => {
    const underlying = walletMeter(store)
    return {
      available: underlying.available,
      reserve: async (request) => {
        const result = await underlying.reserve(request)
        refresh()
        return result
      },
      settle: async (request) => {
        const charged = await underlying.settle(request)
        refresh()
        return charged
      },
      release: async (request) => {
        await underlying.release(request)
        refresh()
      },
    }
  }, [store, refresh])

  const choosePlan = useCallback(
    (plan: PlanId) => write(movePlan(store.read(), plan, clock())),
    [clock, store, write],
  )

  const buyTopUp = useCallback(
    (packId: string) => {
      const pack = topUpById(packId)
      if (!pack) return
      const at = clock()
      write(
        applyGrant(store.read(), { key: `topup:${packId}:${at}`, at, kind: 'topUp', credits: pack.credits }),
      )
    },
    [clock, store, write],
  )

  const now = clock()
  const plan = planOr(wallet.plan)

  return {
    wallet,
    plan,
    balance: balance(wallet, now, plan),
    summary: summarise(wallet, now),
    history: recent(wallet, 12),
    spentThisPeriod: spentThisPeriod(wallet),
    meter,
    choosePlan,
    buyTopUp,
    refresh,
  }
}
