/**
 * The Extensions view.
 *
 * Tungsten's extensions are declarative folders rather than executable
 * bundles, so this lists the four built-in contribution points alongside
 * whatever the user has installed, and surfaces the permissions each one
 * declares.
 */

import { useMemo, useState } from 'react'
import { BookOpen, CircleStop, PackagePlus, Play, Puzzle, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { TipButton } from '../TipButton'

/** The contribution points that ship inside the workbench itself. */
const builtIns = [
  { id: 'core.languages', name: 'Language Core', icon: 'L' },
  { id: 'core.format', name: 'Formatter Core', description: 'Monaco document formatting bridge', icon: 'P' },
  { id: 'core.git', name: 'Git Tools', description: 'Diffs, staging, branches and commits', icon: 'G' },
  { id: 'core.debug', name: 'Debug Adapter Core', description: 'Debug Adapter Protocol transport', icon: 'D' },
] as const

export type ExtensionsViewProps = {
  extensions: ExtensionManifest[]
  /** How many grammars the bundled language core provides. */
  languageCount: number
  onInstall: () => void
  onToggleEnabled: (extension: ExtensionManifest) => void
  onUninstall: (id: string) => void
  /** Writes the worked example for a builder block into `plugins/`. */
  onAddBlockPlugin: () => void
  /** Writes the worked example for a shell command into `dictionary/`. */
  onDocumentCommand: () => void
}

/** Matches a query against everything a card actually shows. */
function matches(haystack: Array<string | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return haystack.some((value) => value?.toLowerCase().includes(needle))
}

export function ExtensionsView({
  extensions, languageCount, onInstall, onToggleEnabled, onUninstall,
  onAddBlockPlugin, onDocumentCommand,
}: ExtensionsViewProps) {
  // The box used to have a placeholder and no state, which is the one
  // search field guaranteed to waste your time. It filters both lists,
  // because an extension you cannot find is an extension you reinstall.
  const [query, setQuery] = useState('')
  const visibleBuiltIns = useMemo(
    () => builtIns.filter((extension) => matches([extension.id, extension.name, 'description' in extension ? extension.description : ''], query)),
    [query],
  )
  const visibleExtensions = useMemo(
    () => extensions.filter((extension) => matches(
      [extension.id, extension.name, extension.description, extension.publisher, extension.scope, ...(extension.permissions ?? [])],
      query,
    )),
    [extensions, query],
  )
  const hiddenCount = (builtIns.length - visibleBuiltIns.length) + (extensions.length - visibleExtensions.length)

  return (
    <>
      <div className="sidebar-title">
        <span>EXTENSIONS</span>
        <TipButton label="Install extension from folder" onClick={onInstall}><PackagePlus size={15} /></TipButton>
      </div>

      <div className="search-box-wrap">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search installed extensions"
          aria-label="Search installed extensions"
        />
      </div>
      {Boolean(query.trim()) && (
        <p className="extension-filter-note">
          {hiddenCount ? `${hiddenCount} hidden by the filter` : 'Everything matches'}
        </p>
      )}

      <div className="extension-install-banner">
        <PackagePlus size={17} />
        <div>
          <strong>Declarative extensions</strong>
          <p>Install commands, themes and language contributions from a local folder.</p>
        </div>
        <button onClick={onInstall}>Install</button>
      </div>

      {/*
        The other two extension points are files in the workspace rather than
        installed packages, so they would otherwise be invisible here -- which
        is exactly where someone looks for "how do I add one?".
      */}
      <div className="section-heading"><span>WORKSPACE CONTRIBUTIONS</span></div>
      <div className="contribution-card">
        <Puzzle size={13} />
        <div>
          <strong>Builder blocks</strong>
          <p><code>plugins/*.block.json</code> — a block appears in the builder palette as soon as the file is saved.</p>
        </div>
        <button onClick={onAddBlockPlugin}>Add example</button>
      </div>
      <div className="contribution-card">
        <BookOpen size={13} />
        <div>
          <strong>Shell commands</strong>
          <p><code>dictionary/*.commands.json</code> — documents your own commands for <code>man</code>, <code>apropos</code> and <code>explain</code>.</p>
        </div>
        <button onClick={onDocumentCommand}>Add example</button>
      </div>

      <div className="section-heading"><span>BUILT IN</span><span className="count-pill">{visibleBuiltIns.length}</span></div>
      {visibleBuiltIns.map((extension) => (
        <div className="extension-card" key={extension.id}>
          <div className={`extension-icon ext-${extension.icon.toLowerCase()}`}>{extension.icon}</div>
          <div>
            <strong>{extension.name}</strong>
            <p>{'description' in extension ? extension.description : `${languageCount} bundled language grammars`}</p>
            <span>Tungsten · Enabled</span>
          </div>
          <ShieldCheck size={13} />
        </div>
      ))}

      <div className="section-heading"><span>INSTALLED PACKAGES</span><span className="count-pill">{visibleExtensions.length}</span></div>
      {visibleExtensions.map((extension) => {
        const enabled = extension.enabled !== false
        return (
          <div className={`extension-card managed ${enabled ? '' : 'disabled'}`} key={extension.id}>
            <div className="extension-icon">{extension.name[0] || 'E'}</div>
            <div>
              <strong>{extension.name}</strong>
              <p>{extension.description}</p>
              <span>{extension.publisher} · {extension.scope || 'user'} · {extension.verification || 'declarative'} · {enabled ? 'Enabled' : 'Disabled'}</span>
              <small>{extension.permissions?.length ? `Permissions: ${extension.permissions.join(', ')}` : 'No runtime permissions'}</small>
            </div>
            <div className="extension-actions">
              <button title={enabled ? 'Disable extension' : 'Enable extension'} onClick={() => onToggleEnabled(extension)}>
                {enabled ? <CircleStop size={11} /> : <Play size={11} />}
              </button>
              {extension.scope !== 'workspace' && (
                <button title="Uninstall extension" onClick={() => onUninstall(extension.id)}><Trash2 size={11} /></button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default ExtensionsView
