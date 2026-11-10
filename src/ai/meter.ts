/**
 * The meter the gateway talks to.
 *
 * In production the wallet lives on the billing service and this is
 * three authenticated calls. Everywhere else -- tests, the offline
 * preview, a self-hosted Tungsten with its own provider key -- it is
 * the pure wallet in `wallet.ts` behind a tiny store. Both sides obey
 * exactly the same reserve / settle / release rules, because they are
 * the same rules: one implementation, not two that drift.
 */

import type { Meter } from './gateway'
import {
  balance,
  newWallet,
  release,
  reserve,
  settle,
  type Wallet,
} from './wallet'
import type { PlanId } from './plans'

export type WalletStore = {
  read: () => Wallet
  write: (wallet: Wallet) => void
}

/** A store in a variable. The whole thing is synchronous and pure. */
export function memoryStore(wallet: Wallet): WalletStore {
  let current = wallet
  return {
    read: () => current,
    write: (next) => {
      current = next
    },
  }
}

export const WALLET_KEY = 'tungsten.wallet.v1'

type LocalLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

/**
 * A store over localStorage, for the preview and for a Tungsten
 * running against its owner's own key. This wallet is a convenience,
 * not a security boundary: anything a browser can write, a browser can
 * rewrite, which is precisely why the real balance is read and spent
 * server-side and this one only ever shadows it.
 */
export function browserStore(
  storage: LocalLike | undefined,
  options: { plan?: PlanId; now?: number } = {},
): WalletStore {
  const fresh = () => newWallet(options.plan ?? 'spark', options.now ?? Date.now())
  const load = (): Wallet => {
    try {
      const raw = storage?.getItem(WALLET_KEY)
      if (!raw) return fresh()
      const parsed = JSON.parse(raw) as Partial<Wallet>
      if (typeof parsed?.plan !== 'string' || typeof parsed?.included !== 'number') return fresh()
      return {
        ...fresh(),
        ...parsed,
        freeSpends: parsed.freeSpends ?? [],
        holds: parsed.holds ?? [],
        ledger: parsed.ledger ?? [],
        applied: parsed.applied ?? [],
      }
    } catch {
      return fresh()
    }
  }

  let current = load()
  return {
    read: () => current,
    write: (next) => {
      current = next
      try {
        storage?.setItem(WALLET_KEY, JSON.stringify(next))
      } catch {
        // A full or blocked storage is not a reason to stop working.
      }
    },
  }
}

/**
 * Wraps a wallet store as a `Meter`.
 *
 * Reads happen through the store on every call rather than being
 * captured once, so two gateways sharing a store -- an editor panel
 * and an agent loop, say -- cannot both spend the same credit.
 */
export function walletMeter(store: WalletStore): Meter {
  return {
    available: async (now) => balance(store.read(), now).total,

    reserve: async (request) => {
      const result = reserve(store.read(), request)
      store.write(result.wallet)
      return result.ok ? { ok: true } : { ok: false, refusal: result.refusal }
    },

    settle: async (request) => {
      const result = settle(store.read(), request)
      store.write(result.wallet)
      return result.charged
    },

    release: async (request) => {
      store.write(release(store.read(), request).wallet)
    },
  }
}
