/**
 * The project's backend.
 *
 * Everything under `src/backend/` — the contract, the working
 * adapters, the blueprint and the schema planner — existed with sixty
 * tests and no way to reach it from the product. This panel is the
 * missing half: pick a backend, paste what it needs, press Test
 * Connection, and the architect's plan and apply have something real
 * to run against.
 *
 * Two things it deliberately does not do. It does not hide the
 * adapters that are not built yet; it lists them with what they will need
 * and refuses to select them, because a dropdown that silently omits
 * Firebase answers "does Tungsten support Firebase?" with nothing at
 * all. And it does not claim a capability an adapter does not have:
 * the grid is drawn from `info.capabilities`, so a backend with no
 * realtime replay says so before you build a feature on it.
 */

import { useState } from 'react'
import { CircleAlert, CircleCheck, Loader2, PackageOpen, Plug, ShieldQuestion } from 'lucide-react'

import type { AdapterInfo, Capabilities } from '../../backend/contract'
import { missingFields, type BackendSettings } from '../../backend/registry'
import { describeRuntimeProfile, runtimeProfileFor } from '../../backend/runtimeProfile'

export type HealthResult = { ok: boolean; detail: string }

export type BackendPanelProps = {
  choices: AdapterInfo[]
  settings: BackendSettings
  onChange: (settings: BackendSettings) => void
  /** Builds the backend and calls `health()`. Rejects with a readable sentence. */
  onTest: (settings: BackendSettings) => Promise<HealthResult>
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; result: HealthResult; adapter: string }

/** The capability grid, in the order a person asks about them. */
const GROUPS: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'auth', label: 'Auth' },
  { key: 'db', label: 'Database' },
  { key: 'realtime', label: 'Realtime' },
  { key: 'storage', label: 'Storage' },
  { key: 'functions', label: 'Functions' },
  { key: 'schema', label: 'Schema' },
]

/** `cursorPaging` reads badly in a table; `cursor paging` does not. */
function words(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

export function BackendPanel({ choices, settings, onChange, onTest }: BackendPanelProps) {
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const selected = choices.find((choice) => choice.id === settings.adapter)
  const missing = missingFields(settings)
  const planned = selected?.status === 'planned'
  // What a *built* app will do, which is a different question from
  // what the IDE can reach: a server credential is usable here and
  // must not be shipped in a page anyone can read.
  const shipped = describeRuntimeProfile(runtimeProfileFor(settings))

  const choose = (id: string) => {
    setTest({ kind: 'idle' })
    // Credentials are per adapter; carrying a Supabase service key over
    // to PocketBase would be both useless and a way to leak it.
    onChange({ adapter: id, config: {} })
  }

  const edit = (key: string, value: string) => {
    setTest({ kind: 'idle' })
    onChange({ ...settings, config: { ...settings.config, [key]: value } })
  }

  async function runTest() {
    if (!selected || planned || missing.length) return
    setTest({ kind: 'testing' })
    const result = await onTest(settings).catch((error: unknown) => ({
      ok: false,
      detail: error instanceof Error ? error.message : 'The connection failed for a reason the adapter did not name.',
    }))
    setTest({ kind: 'done', result, adapter: settings.adapter })
  }

  return (
    <div className="backend-panel" aria-label="Project backend">
      <ul className="backend-choices">
        {choices.map((choice) => (
          <li key={choice.id} className={`${choice.id === settings.adapter ? 'chosen' : ''} ${choice.status === 'planned' ? 'planned' : ''}`.trim()}>
            <button onClick={() => choose(choice.id)} disabled={choice.status === 'planned'}>
              <span className="backend-name">
                {choice.label}
                <em>{choice.status}</em>
              </span>
              <span className="backend-summary">{choice.summary}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <section className="backend-detail">
          <h4>{selected.label}</h4>

          {planned ? (
            <p className="backend-planned">
              <ShieldQuestion size={12} /> Not built yet. It will need {selected.fields.map((field) => field.label).join(', ')}.
              Supabase and the self-hosted service work today, and the canvas does not change when you move between them.
            </p>
          ) : (
            <>
              <div className="backend-fields">
                {selected.fields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}{field.optional ? ' (optional)' : ''}</span>
                    <input
                      type={field.secret ? 'password' : 'text'}
                      value={settings.config[field.key] ?? ''}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => edit(field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="backend-actions">
                <button className="primary" onClick={() => void runTest()} disabled={Boolean(missing.length) || test.kind === 'testing'}>
                  {test.kind === 'testing' ? <Loader2 size={12} className="spin" /> : <Plug size={12} />}
                  {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {missing.length > 0 && <span className="backend-missing">Needs {missing.join(' and ')}</span>}
              </div>

              {test.kind === 'done' && test.adapter === settings.adapter && (
                <p className={`backend-health ${test.result.ok ? 'ok' : 'failed'}`}>
                  {test.result.ok ? <CircleCheck size={12} /> : <CircleAlert size={12} />} {test.result.detail}
                </p>
              )}

              <p className="backend-shipped">
                <PackageOpen size={12} /> {shipped}
              </p>
            </>
          )}

          <table className="backend-capabilities">
            <tbody>
              {GROUPS.map((group) => {
                const flags = selected.capabilities[group.key] as Record<string, boolean>
                const has = Object.entries(flags).filter(([, value]) => value).map(([key]) => words(key))
                const lacks = Object.entries(flags).filter(([, value]) => !value).map(([key]) => words(key))
                return (
                  <tr key={group.key}>
                    <th>{group.label}</th>
                    <td className="backend-has">{has.length ? has.join(', ') : '—'}</td>
                    <td className="backend-lacks">{lacks.length ? `no ${lacks.join(', no ')}` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

export default BackendPanel
