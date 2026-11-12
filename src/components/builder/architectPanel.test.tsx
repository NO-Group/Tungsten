/**
 * @vitest-environment jsdom
 *
 * The architect panel.
 *
 * The thing worth testing here is the gate, not the markup. An AI that
 * writes a schema is a convenience; an AI that applies a schema is a
 * privilege, and the whole value of this panel is the gap between the
 * two. So: nothing is applied on arrival, a destructive operation is
 * shown before the pretty table rather than after it, a plan the
 * backend rejected cannot be approved at all, and discarding leaves
 * the project exactly as it was.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ArchitectPanel } from './ArchitectPanel'
import type { Draft } from '../../backend/architect'
import type { Blueprint } from '../../backend/blueprint'
import type { SchemaPlan } from '../../backend/contract'
import { BLUEPRINT_VERSION, summariseBlueprint } from '../../backend/blueprint'

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

const BLUEPRINT: Blueprint = {
  version: BLUEPRINT_VERSION,
  name: 'Recipes',
  tables: [
    {
      name: 'recipes',
      columns: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'text' },
      ],
      policies: { read: 'public', create: 'authenticated', update: 'owner', delete: 'owner' },
    },
  ],
  buckets: [],
  functions: [],
}

function okDraft(blueprint: Blueprint = BLUEPRINT): Draft {
  return { ok: true, blueprint, summary: summariseBlueprint(blueprint), source: 'ai', credits: 14 }
}

const SAFE_PLAN: SchemaPlan = {
  mode: 'apply',
  problems: [],
  operations: [
    { kind: 'create-table', subject: 'recipes', statement: 'create table recipes (id uuid primary key)' },
  ],
}

/** Types a description and presses the design button. */
async function design(text = 'a recipe site') {
  const area = container.querySelector('textarea')
  if (!area) throw new Error('no textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(area, text)
  await act(async () => {
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    button('Design the backend')?.click()
  })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label))
}

describe('the architect panel', () => {
  it('applies nothing until the approve button is pressed', async () => {
    const applied: Blueprint[] = []
    await act(async () => {
      root.render(
        <ArchitectPanel
          onDraft={async () => okDraft()}
          onPlan={async () => SAFE_PLAN}
          onApply={(gate) => void applied.push(gate.blueprint)}
        />,
      )
    })

    await design()

    // The gate is up, the schema is described, and nothing has run.
    expect(container.querySelector('.architect-gate')?.textContent).toContain('Nothing has been applied yet')
    expect(container.querySelector('.architect-tables')?.textContent).toContain('recipes')
    expect(applied).toHaveLength(0)

    await act(async () => {
      button('Approve and apply')?.click()
    })
    expect(applied).toHaveLength(1)
    expect(container.querySelector('.architect-done')?.textContent).toContain('Applied 1 operation')
  })

  it('discards without applying, and clears the gate', async () => {
    let applies = 0
    await act(async () => {
      root.render(
        <ArchitectPanel onDraft={async () => okDraft()} onPlan={async () => SAFE_PLAN} onApply={() => { applies += 1 }} />,
      )
    })

    await design()
    await act(async () => {
      button('Discard')?.click()
    })

    expect(applies).toBe(0)
    expect(container.querySelector('.architect-gate')).toBeNull()
  })

  it('puts a destructive operation above the schema, not inside the list of statements', async () => {
    const plan: SchemaPlan = {
      mode: 'apply',
      problems: [],
      operations: [
        { kind: 'drop-column', subject: 'recipes.notes', statement: 'alter table recipes drop column notes', destructive: true },
        { kind: 'add-column', subject: 'recipes.body', statement: 'alter table recipes add column body text' },
      ],
    }
    await act(async () => {
      root.render(<ArchitectPanel onDraft={async () => okDraft()} onPlan={async () => plan} onApply={() => undefined} />)
    })
    await design()

    const warning = container.querySelector('.architect-destructive')
    expect(warning?.textContent).toContain('could lose data')
    expect(warning?.textContent).toContain('recipes.notes')

    // The collapsed statement list holds only the safe operation, so
    // the dangerous one cannot hide behind a closed <details>.
    const sql = container.querySelector('.architect-sql')
    expect(sql?.textContent).toContain('add column body')
    expect(sql?.textContent).not.toContain('drop column')

    // Destructive work is a caution, not a blocker: it is still approvable.
    expect(button('Approve and apply')?.disabled).toBe(false)
  })

  it('refuses to approve a plan the backend rejected', async () => {
    const plan: SchemaPlan = {
      mode: 'apply',
      problems: ['`order` is a reserved word in this database.'],
      operations: [],
    }
    await act(async () => {
      root.render(<ArchitectPanel onDraft={async () => okDraft()} onPlan={async () => plan} onApply={() => undefined} />)
    })
    await design()

    expect(container.querySelector('.architect-blockers')?.textContent).toContain('reserved word')
    expect(button('Approve and apply')?.disabled).toBe(true)
  })

  it('shows a refusal as a refusal rather than an empty gate', async () => {
    await act(async () => {
      root.render(
        <ArchitectPanel
          onDraft={async () => ({ ok: false, source: 'ai', reason: 'The model replied with something that is not a blueprint.' })}
          onApply={() => undefined}
        />,
      )
    })
    await design()

    expect(container.querySelector('.architect-failed')?.textContent).toContain('not a blueprint')
    expect(container.querySelector('.architect-gate')).toBeNull()
  })

  it('works with no backend configured: no plan, still reviewable', async () => {
    const applied: Blueprint[] = []
    await act(async () => {
      root.render(<ArchitectPanel onDraft={async () => okDraft()} onApply={(gate) => void applied.push(gate.blueprint)} />)
    })
    await design()

    expect(container.querySelector('.architect-sql')).toBeNull()
    await act(async () => {
      button('Approve and apply')?.click()
    })
    expect(applied).toHaveLength(1)
    expect(container.querySelector('.architect-done')?.textContent).toContain('Applied the canvas schema')
  })

  it('names what is at stake and what the draft cost', async () => {
    await act(async () => {
      root.render(
        <ArchitectPanel
          onDraft={async () => okDraft()}
          onApply={() => undefined}
          credits={2_940}
          existingTables={['cooks', 'comments']}
        />,
      )
    })

    expect(container.querySelector('.architect-credits')?.textContent).toBe('2,940 credits')
    expect(container.querySelector('.architect-existing')?.textContent).toBe('Extends 2 existing tables')

    await design()
    expect(container.querySelector('.architect-source')?.textContent).toContain('14 credits')
  })

  it('will not draft from an empty description', async () => {
    let drafts = 0
    await act(async () => {
      root.render(
        <ArchitectPanel
          onDraft={async () => {
            drafts += 1
            return okDraft()
          }}
          onApply={() => undefined}
        />,
      )
    })

    expect(button('Design the backend')?.disabled).toBe(true)
    await act(async () => {
      button('Design the backend')?.click()
    })
    expect(drafts).toBe(0)
  })
})
