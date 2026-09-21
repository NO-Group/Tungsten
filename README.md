# Tungsten IDE 2.2

A rugged, installable development environment built with Electron, React, Monaco, xterm, Language Server Protocol, Debug Adapter Protocol, SSH, and Yjs. Tungsten targets Windows, macOS, and Linux while retaining a safe browser workspace for development and demonstrations.

<img src="resources/icon.png" alt="Tungsten IDE icon" width="120" />

## Tungsten 2.2 highlights

- Full merge and rebase controls with operation detection, conflict lists, three-stage conflict loading, side-by-side current/incoming review, resolution actions, continue, and abort
- Remote LSP and DAP adapter processes over the active SSH transport, plus remote project detection, tasks, structured tests, commands, and LCOV loading
- Editable, persistent keyboard shortcuts with collision handling and platform-aware labels
- Inline DAP variable values beside the stopped source line
- Managed extension lifecycle with persisted enable/disable state, user-package uninstall, scope visibility, permission display, and isolated host reactivation
- The Tungsten 2.1 performance, multi-root, terminal, Git hunk, testing, and collaboration improvements remain included

See the [Tungsten 2.2 release notes](docs/RELEASE_2.2.md) and [2.1 performance notes](docs/RELEASE_2.1.md).

## Tungsten 2.2 workstation

### Editing and workspace engine

- Monaco editing for more than 40 languages and formats, with tabs, minimap, sticky scopes, formatting, autosave, accessible editor modes, and side-by-side preview
- Native Chokidar workspace watching with external-change indication across persisted multi-root local workspaces
- Ripgrep-backed asynchronous content search across every local root, with bounded in-process and remote fallbacks
- Bounded, lazy folder rendering; ignored dependency/build trees; 2 MB per-file and 4,000-file desktop safety limits
- Quick-open, symbol outline, command palette, dashboard, workspace profiles, settings, editable persistent keybindings, recovery snapshots, and responsive resizable panels

### Language intelligence

The generic multi-root LSP client supports completion, hover, diagnostics, go-to-definition, references, rename/workspace edits, signature help, code actions, semantic tokens, and live `workspaceFolders` updates.

- TypeScript/JavaScript language service is included
- Python, Rust, Go, C/C++, Java, C#, Ruby, PHP, Kotlin, and Lua servers are detected from `PATH`
- Syntax editing remains available if an optional external server is absent

See [Language servers](docs/LANGUAGE_SERVERS.md).

### Industrial terminals and debugging

- Persistent PTY terminal tabs and layouts, split views, buffer search, per-tab restart, dedicated task terminals, WSL profiles, Docker profiles, and interactive SSH shells
- DAP launch/configuration lifecycle with gutter breakpoints, conditional breakpoints, threads, call stacks, scopes, variables, inline stopped-line values, watches, continue, pause, step-over, step-in, and step-out
- Project launch configurations under `.tungsten/launch.json`

See [Debugging](docs/DEBUGGING.md).

### Testing and coverage

- Project test-profile detection for npm, pytest, Cargo, Go, Maven, and Gradle
- Individual test discovery for JavaScript/TypeScript, Python, Go, and Rust
- Per-test open, structured run, and debug-terminal actions with pass/fail state, duration, failure excerpts, and snapshot output
- LCOV parsing with editor gutter/overview coverage overlays
- Unit, desktop bridge-contract, production HTTP E2E smoke, and workspace benchmark commands

### Git and GitHub

- Branch/worktree status, side-by-side diffs, line-hunk and whole-file staging/unstaging, commits, checkout, and conflict visibility
- Commit graph/history, stash push/pop, blame buffers, and complete merge/rebase workflows with conflict resolution, continue, and abort
- GitHub pull-request and issue lists through the authenticated `gh` CLI

### Extension host

- Per-user and workspace package discovery
- Declarative commands, themes, languages, keybindings, and sidebar metadata
- Separate extension-host process for executable packages
- Restricted VM API, activation/command timeouts, permission review, SHA-256 entry-point verification, persisted enable/disable state, and managed uninstall

See [extension packages](docs/EXTENSIONS.md).

### Remote development and collaboration

- SFTP-backed SSH workspaces with safe file operations, indexed search, remote terminals, project/task/test detection, LCOV, and SSH-hosted LSP/DAP processes
- WSL distribution, Docker container, and Dev Container detection with dedicated terminal profiles
- Yjs shared documents over token-protected WebSocket rooms
- Visible collaborator cursors, presence, review comments, reconnection-ready room events, and voice-room signaling foundations

See [remote development and collaboration](docs/REMOTE_AND_COLLABORATION.md).

### Product and release engineering

- Welcome dashboard, settings presets, accessibility controls, reduced motion, high contrast, and screen-reader editor mode
- Telemetry disabled by default and explicit crash-report preference
- Context-isolated, sandboxed Electron renderer; narrow typed preload bridge; path/symlink protection; isolated previews
- Automatic packaged-app updates and Windows NSIS/portable, macOS DMG/ZIP, and Linux AppImage/DEB targets
- GitHub Actions cross-platform installer builds with optional signing/notarization secrets and generated release notes

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

A graphical desktop session is required. External tools such as Git, ripgrep, `gh`, Docker, language servers, and debug adapters are detected and integrated when installed; Tungsten does not silently bundle those ecosystems.

## Browser development

```bash
npm run dev
```

The Vite server binds to `0.0.0.0`. Browser mode includes the editor and simulated local workspace. Native filesystem, PTY, Git, LSP/DAP processes, SSH, executable extensions, collaboration hosting, and updates remain behind Electron's preload boundary.

## Build installers

```bash
npm run desktop:dist
```

Installers are written to `out/`. Build on each target OS or use the included `Build desktop installers` GitHub Actions workflow. Optional signing environment variables are documented in the workflow. Create an unpacked current-platform app with `npm run desktop:pack`. See the [laptop testing guide](docs/LAPTOP_TESTING.md) for installation notes and the acceptance checklist.

## Validation

```bash
npm run check
npm run test:e2e
npm run bench:workspace
npm audit
```

`check` runs ESLint, Vitest, TypeScript, and the production Vite build. The E2E smoke boots the production server and validates its shell and application bundle. The benchmark reports indexed files, bytes, throughput, elapsed time, and heap use.
