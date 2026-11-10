/**
 * @vitest-environment jsdom
 *
 * The credits panel.
 *
 * What is worth testing here is not the layout, it is the honesty:
 * that a locked engine is shown and priced rather than hidden, that
 * the upgrade button names the cheapest plan that would unlock it,
 * that money moves only when a button is pressed, and that the number
 * on the screen is the number in the wallet.
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiUsagePanel } from './AiUsagePanel'
import { describeEntry } from '../../ai/receipt'
import { useAiWallet } from '../../ai/useAiWallet'
import { memoryStore } from '../../ai/meter'
import { newWallet, reserve, settle, type Wallet } from '../../ai/wallet'
import type { EngineId } from '../../ai'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Harness({ wallet }: { wallet: Wallet }) {
  const store = memoryStore(wallet)
  return <Panel store={store} />
}

function Panel({ store }: { store: ReturnType<typeof memoryStore> }) {
  const purse = useAiWallet({ store, now: () => T0 })
  const [engine, setEngine] = useState<EngineId>('balanced')
  return (
    <AiUsagePanel
      wallet={purse}
      engine={engine}
      onChooseEngine={setEngine}
      onChoosePlan={purse.choosePlan}
      onBuyTopUp={purse.buyTopUp}
    />
  )
}

// A fresh key each time: the hook deliberately keeps its store for the
// life of the component, so a new wallet means a new mount.
let mounts = 0
const show = (wallet: Wallet) => act(() => root.render(<Harness key={(mounts += 1)} wallet={wallet} />))

const text = () => container.textContent ?? ''

const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (node) => node.getAttribute('aria-label') === label || node.textContent?.trim().startsWith(label),
  )

const click = (node: Element | undefined) => {
  if (!node) throw new Error('no such button')
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('the credits panel', () => {
  it('shows the plan and what is actually spendable', () => {
    show(newWallet('spark', T0))
    expect(text()).toContain('Spark')
    // 250 of allowance plus today's 10 free credits.
    expect(text()).toContain('260 credits')
  })

  it('prices every engine, including the ones this plan cannot call', () => {
    show(newWallet('spark', T0))
    expect(text()).toContain('Flash')
    expect(text()).toContain('Precise')
    expect(text()).toContain('credits a turn')
    // Locked, but visible, priced, and explained.
    expect(text()).toContain('The Precise engine is part of Core')
  })

  it('will not let a locked engine be chosen', () => {
    show(newWallet('spark', T0))
    expect((button('Use the Precise engine') as HTMLButtonElement).disabled).toBe(true)
    expect((button('Use the Balanced engine') as HTMLButtonElement).disabled).toBe(false)
  })

  it('moves plan when the upgrade button is pressed, and the balance follows', () => {
    show(newWallet('spark', T0))
    click(button('Move to Core'))
    expect(text()).toContain('3,000 credits')
    expect((button('Use the Precise engine') as HTMLButtonElement).disabled).toBe(false)
  })

  it('adds bought credits to the balance', () => {
    show(newWallet('core', T0))
    expect(text()).toContain('3,000 credits')
    click(button('5,000 credits'))
    expect(text()).toContain('8,000 credits')
  })

  it('shows held credits while a call is in flight, and the receipt after it', () => {
    const held = reserve(newWallet('core', T0), { key: 'call', engine: 'balanced', credits: 60, now: T0 })
    if (!held.ok) throw new Error('expected a hold')
    show(held.wallet)
    expect(text()).toContain('2,940 credits')

    const done = settle(held.wallet, {
      key: 'call',
      credits: 6,
      usage: { inputTokens: 4_000, outputTokens: 1_000 },
      now: T0 + 1_000,
    })
    show(done.wallet)
    expect(text()).toContain('2,994 credits')
    expect(text()).toContain('4k in, 1k out on Balanced')
  })
})

describe('ledger lines', () => {
  it('reads a spend as a receipt and a failure as a sentence', () => {
    expect(
      describeEntry({
        key: 'a',
        kind: 'spend',
        at: T0,
        credits: 6,
        engine: 'balanced',
        usage: { inputTokens: 4_000, outputTokens: 1_000 },
      }),
    ).toBe('6 credits — 4k in, 1k out on Balanced')
    expect(describeEntry({ key: 'b', kind: 'release', at: T0, credits: 0, note: 'Call failed; not charged.' })).toBe(
      'Call failed; not charged.',
    )
    expect(describeEntry({ key: 'c', kind: 'grant', at: T0, credits: 5_000, note: 'Top-up' })).toBe(
      '+5,000 credits — Top-up',
    )
  })
})
