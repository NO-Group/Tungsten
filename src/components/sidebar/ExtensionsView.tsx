/**
 * The Extensions view.
 *
 * Tungsten's extensions are declarative folders rather than executable
 * bundles, so this lists the four built-in contribution points alongside
 * whatever the user has installed, and surfaces the permissions each one
 * declares.
 */

import { CircleStop, PackagePlus, Play, Search, ShieldCheck, Trash2 } from 'lucide-react'
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
}

export function ExtensionsView({ extensions, languageCount, onInstall, onToggleEnabled, onUninstall }: ExtensionsViewProps) {
  return (
    <>
      <div className="sidebar-title">
        <span>EXTENSIONS</span>
        <TipButton label="Install extension from folder" onClick={onInstall}><PackagePlus size={15} /></TipButton>
      </div>

      <div className="search-box-wrap"><Search size={13} /><input placeholder="Search installed extensions" /></div>

      <div className="extension-install-banner">
        <PackagePlus size={17} />
        <div>
          <strong>Declarative extensions</strong>
          <p>Install commands, themes and language contributions from a local folder.</p>
        </div>
        <button onClick={onInstall}>Install</button>
      </div>

      <div className="section-heading"><span>BUILT IN</span><span className="count-pill">{builtIns.length}</span></div>
      {builtIns.map((extension) => (
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

      <div className="section-heading"><span>INSTALLED PACKAGES</span><span className="count-pill">{extensions.length}</span></div>
      {extensions.map((extension) => {
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
