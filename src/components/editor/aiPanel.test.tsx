/**
 * @vitest-environment jsdom
 *
 * The price beside the send button.
 *
 * The claim these tests defend is narrow and worth defending: a person
 * can see what a question costs *before* asking it, can see what they
 * have left, and cannot accidentally spend into a hole. Everything
 * else about the panel is covered by the model tests; this is about
 * the number.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiPanel, type AiPanelProps } from './AiPanel'
import { estimateTurn } from '../../editor/ai/meteredProvider'
import type { AiContext } from '../../editor/ai/aiModel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const noop = () => undefined

const context: AiContext = {
  path: 'src/cart.ts',
  buffer: 'export function total(items) {\n  return items.length\n}',
  selection: '',
  startLine: 1,
  endLine: 3,
  language: 'typescript',
}

const base: AiPanelProps = {
  mode: 'advisor',
  onModeChange: noop,
  turns: [],
  busy: false,
  context,
  providerLabel: 'Tungsten AI',
  theme: 'vs-dark',
  onAsk: noop,
  onAccept: noop,
  onDiscard: noop,
  onClear: noop,
  onClose: noop,
  preview: () => undefined,
}

function show(props: Partial<AiPanelProps> = {}) {
  act(() => root.render(<AiPanel {...base} {...props} />))
}

const input = () => container.querySelector('.ai-compose input') as HTMLInputElement
const sendButton = () => container.querySelector('.ai-compose button') as HTMLButtonElement
const cost = () => container.querySelector('.ai-cost')

function type(text: string) {
  const field = input()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const price = (prompt: string) => estimateTurn('balanced', { prompt, context })

describe('the assistant panel’s price line', () => {
  it('says nothing about money when the assistant is free', () => {
    show()
    expect(cost()).toBeNull()
  })

  it('waits for a question before quoting for one', () => {
    show({ priceOf: price, credits: 3_000 })
    expect(cost()?.textContent).toContain('Type a question to see what it costs')
    type('explain this function')
    expect(cost()?.textContent).toMatch(/about \d+, at most \d+ credits/)
  })

  it('shows the balance beside the price, as a way into the plans', () => {
    const onOpenCredits = vi.fn()
    show({ priceOf: price, credits: 2_940, onOpenCredits })
    const balance = container.querySelector('.ai-cost-balance') as HTMLButtonElement
    expect(balance.textContent).toBe('2,940 left')
    act(() => { balance.click() })
    expect(onOpenCredits).toHaveBeenCalled()
  })

  it('names the engine the quote is for', () => {
    // App passes one engine to both, so the label and the arithmetic
    // can never describe different engines.
    show({
      priceOf: (prompt: string) => estimateTurn('precise', { prompt, context }),
      credits: 3_000,
      engine: 'precise',
    })
    type('explain this')
    expect(cost()?.textContent).toContain('on Precise')
  })

  it('refuses to send a question the balance cannot cover', () => {
    const onAsk = vi.fn()
    show({ priceOf: price, credits: 1, onAsk })
    type('explain this function')

    expect(sendButton().disabled).toBe(true)
    expect(cost()?.className).toContain('short')
    expect(cost()?.textContent).toContain('Not enough credits')

    act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('sends once the balance can cover it', () => {
    const onAsk = vi.fn()
    show({ priceOf: price, credits: 3_000, onAsk })
    type('explain this function')
    expect(sendButton().disabled).toBe(false)
    act(() => { sendButton().click() })
    expect(onAsk).toHaveBeenCalledWith('explain this function')
  })

  it('quotes a long file higher than a short one', () => {
    show({ priceOf: price, credits: 3_000 })
    type('explain')
    const short = cost()?.textContent ?? ''

    const long = { ...context, buffer: context.buffer.repeat(2_000) }
    show({ priceOf: (prompt: string) => estimateTurn('balanced', { prompt, context: long }), credits: 3_000 })
    type('explain')
    expect(cost()?.textContent).not.toBe(short)
  })
})
