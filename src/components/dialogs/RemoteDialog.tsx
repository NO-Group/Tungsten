/**
 * Remote development: SSH, WSL and development containers.
 *
 * Credentials are typed here but never stored -- they are handed straight to
 * the main process for the connection attempt, which is why the fields are
 * plain state owned by the workbench and this component only edits them.
 */

import { SquareCode, X } from 'lucide-react'
import { Modal } from '../Modal'

export type SshConfig = {
  host: string
  port: string
  username: string
  root: string
  password: string
  privateKeyPath: string
}

export type RemoteProfiles = {
  wsl: string[]
  containers: Array<{ id: string; name: string; image: string }>
  devcontainer: boolean
}

export type RemoteDialogProps = {
  config: SshConfig
  onConfigChange: (update: (config: SshConfig) => SshConfig) => void
  profiles: RemoteProfiles
  connected: boolean
  onConnect: () => void
  onDisconnect: () => void
  onOpenWsl: (distribution: string) => void
  onOpenContainer: (container: { id: string; name: string }) => void
  onClose: () => void
}

/** The SSH form, as label plus the config field it edits. */
const fields: Array<{ key: keyof SshConfig; label: string; placeholder?: string; type?: string; autoComplete?: string; inputMode?: 'numeric' }> = [
  { key: 'host', label: 'Host', placeholder: 'dev.example.com' },
  { key: 'port', label: 'Port', inputMode: 'numeric' },
  { key: 'username', label: 'Username', autoComplete: 'username' },
  { key: 'root', label: 'Remote folder' },
  { key: 'password', label: 'Password (optional)', type: 'password', autoComplete: 'current-password' },
  { key: 'privateKeyPath', label: 'Private key path (optional)', placeholder: '~/.ssh/id_ed25519' },
]

export function RemoteDialog({
  config, onConfigChange, profiles, connected, onConnect, onDisconnect, onOpenWsl, onOpenContainer, onClose,
}: RemoteDialogProps) {
  return (
    <Modal label="Remote development" className="remote-modal" onClose={onClose}>
      <header>
        <span className="modal-icon"><SquareCode size={18} /></span>
        <div><h2>Remote development</h2><p>Open code and terminals over SSH, WSL, or a development container.</p></div>
        <button onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>

      <div className="remote-form">
        {fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              value={config[field.key]}
              type={field.type}
              placeholder={field.placeholder}
              autoComplete={field.autoComplete}
              inputMode={field.inputMode}
              onChange={(event) => onConfigChange((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </label>
        ))}
      </div>

      <div className="remote-profiles">
        <div>
          <strong>WSL distributions</strong>
          {profiles.wsl.length
            ? profiles.wsl.map((distribution) => (
              <button key={distribution} onClick={() => onOpenWsl(distribution)}>{distribution}</button>
            ))
            : <span>No distributions detected</span>}
        </div>
        <div>
          <strong>Running containers</strong>
          {profiles.containers.length
            ? profiles.containers.map((container) => (
              <button key={container.id} onClick={() => onOpenContainer(container)}>{container.name} · {container.image}</button>
            ))
            : <span>No containers detected</span>}
        </div>
        <div>
          <strong>Dev Container</strong>
          <span>{profiles.devcontainer
            ? '.devcontainer/devcontainer.json detected; use a running container terminal below.'
            : 'No configuration in this workspace'}</span>
        </div>
      </div>

      <footer>
        {connected && <button className="secondary" onClick={onDisconnect}>Disconnect</button>}
        <span />
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!config.host || !config.username} onClick={onConnect}>Connect SSH</button>
      </footer>
    </Modal>
  )
}

export default RemoteDialog
