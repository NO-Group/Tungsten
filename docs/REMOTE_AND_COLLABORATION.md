# Remote development and collaboration

## SSH workspaces

Choose the remote indicator in the lower-left status bar, then enter a host, username, remote folder, and authentication method. Tungsten supports SSH-agent authentication, an optional private-key path, or a password entered for the current connection. Passwords are not persisted.

The SSH workspace browser uses SFTP for bounded text-file indexing and safe reads, writes, renames, and deletes. Integrated terminal tabs use an interactive SSH shell. Search falls back to the remote text index when local ripgrep is unavailable.

Tungsten also detects remote project manifests and tasks, executes structured tests and commands in the remote root, reads remote LCOV reports, and can launch LSP or DAP executables through the authenticated SSH stream. Development tools must be installed on the host; Tungsten does not upload or silently provision them.

## WSL and containers

The remote dashboard detects WSL distributions on Windows, running Docker containers, and `.devcontainer/devcontainer.json`. Select a detected WSL distribution or container to open it in a dedicated terminal profile. Dev Container detection intentionally relies on the locally installed Docker/devcontainer ecosystem instead of bundling a container runtime.

## Collaboration rooms

The collaboration button in the title bar can host or join a token-protected WebSocket room. Tungsten synchronizes shared file text through a Yjs document and relays:

- participant presence,
- file and line review comments,
- visible collaborator cursor positions,
- automatic client reconnection with Yjs resynchronization, and
- voice-room signaling messages.

The voice action establishes only the signaling foundation; it does not capture a microphone or transmit media without a future explicit media-permission flow. Room URLs carry a random capability token. Use trusted networks or a `wss://` reverse proxy when collaborating across machines.

Collaboration is available in the Electron desktop app. Browser mode remains a local demonstration workspace and does not expose privileged host services.
