/**
 * Remote development: SSH workspaces, WSL distributions and containers.
 *
 * Owns the connection dialog's state and the discovered profiles. Whether the
 * workspace currently on screen is remote is the workbench's business, not
 * this service's -- it arrives with the workspace, so it is passed in.
 */

import { useCallback, useEffect, useState } from 'react'

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

export const EMPTY_SSH_CONFIG: SshConfig = { host: '', port: '22', username: '', root: '/', password: '', privateKeyPath: '' }
const NO_PROFILES: RemoteProfiles = { wsl: [], containers: [], devcontainer: false }

export type RemoteHost = {
  notify: (message: string) => void
  /** Adopts the workspace a successful connection returned. */
  applyWorkspace: (result: DesktopWorkspaceResult) => void
  /** Tears the workspace down again when the connection ends. */
  clearWorkspace: () => void
}

export function useRemoteWorkspace({ notify, applyWorkspace, clearWorkspace }: RemoteHost) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<SshConfig>(EMPTY_SSH_CONFIG)
  const [profiles, setProfiles] = useState<RemoteProfiles>(NO_PROFILES)

  const refreshProfiles = useCallback(() => {
    window.tungsten?.remoteProfiles().then(setProfiles).catch(() => undefined)
  }, [])

  // What is installed rarely changes, so one look at startup is enough; the
  // dialog refreshes it when opened.
  useEffect(() => { refreshProfiles() }, [refreshProfiles])

  const connect = useCallback(async () => {
    if (!window.tungsten) return notify('Remote workspaces require the desktop app')
    try {
      applyWorkspace(await window.tungsten.connectSsh({
        host: config.host,
        port: Number(config.port),
        username: config.username,
        root: config.root,
        password: config.password || undefined,
        privateKeyPath: config.privateKeyPath || undefined,
      }))
      setOpen(false)
      // Never keep a password around after it has been used.
      setConfig((current) => ({ ...current, password: '' }))
      notify(`Connected to ${config.host}`)
    } catch (error) {
      notify(`SSH connection failed: ${(error as Error).message}`)
    }
  }, [applyWorkspace, config, notify])

  const disconnect = useCallback(async () => {
    await window.tungsten?.disconnectRemote().catch(() => undefined)
    clearWorkspace()
    setOpen(false)
    notify('Remote workspace disconnected')
  }, [clearWorkspace, notify])

  return { open, setOpen, config, setConfig, profiles, refreshProfiles, connect, disconnect }
}

export type RemoteService = ReturnType<typeof useRemoteWorkspace>
