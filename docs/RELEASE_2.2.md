# Tungsten IDE 2.2

Tungsten 2.2 deepens the workstation workflows introduced in 2.1. This release focuses on Git integration operations, remote execution, debugger visibility, user-controlled keybindings, and extension lifecycle management.

## Git integration and conflicts

The Source Control view can now start a merge or rebase against another local branch. Tungsten detects Git's operation state directly from the repository metadata and exposes:

- the active merge or rebase;
- all unmerged paths from the index;
- stage 1 base, stage 2 current, and stage 3 incoming content;
- a side-by-side current/incoming Monaco comparison;
- accept-current, accept-incoming, accept-both, and manually edited mark-resolved actions;
- operation continue once conflicts are cleared; and
- safe abort for either merge or rebase.

Expected conflict exits are returned as repository state instead of being presented as transport failures. Git command arguments remain separated from the shell, and file paths are validated against the primary workspace root.

## Remote language, debug, task, and test services

An active SSH workspace can now host development processes, not only files and terminals:

- configured language servers launch through the existing authenticated SSH connection and speak LSP over a bounded stdio peer;
- TypeScript/JavaScript uses `typescript-language-server --stdio` when installed remotely;
- other language adapters use the same detected executable names as local workspaces;
- configured DAP adapters can run remotely over the SSH stream;
- `${workspaceFolder}` expands to the remote POSIX root;
- breakpoint paths and LSP file URIs map to remote absolute paths;
- package manifests, language project files, and `.tungsten/tasks.json` are detected over SFTP;
- individual discovered tests and general project commands execute in the remote root; and
- LCOV data can be read over SFTP and shown through the existing editor overlays.

External language servers, debug adapters, test runners, and build tools must be installed on the remote machine. Tungsten does not silently upload executables.

## Editable keyboard shortcuts

Core workbench shortcuts now use a persistent command-to-chord map. The keybinding editor captures platform-aware combinations, reports collisions, reassigns duplicate chords, supports reset to defaults, and survives application restarts. Escape remains a reserved safety action for closing transient UI.

## Inline debug values

When a DAP session supplies a stopped frame and variables, Tungsten renders a compact inline value summary beside the stopped source line. The Debug sidebar continues to provide the complete scope, variable, watch, thread, and call-stack views.

## Managed extensions

Installed packages now expose their verification state, scope, permissions, and enabled state. Users can:

- disable or enable a package persistently;
- reactivate the isolated extension host using only enabled, integrity-verified executable packages; and
- uninstall packages from the per-user extension directory with native confirmation.

Workspace-owned extensions can be disabled but cannot be deleted through the user-package uninstall action.

## Carried forward from 2.1

Tungsten 2.2 retains lazy Monaco/xterm delivery, persistent terminals and workbench layouts, multi-root workspaces, side-by-side Git and hunk staging, structured test results, collaborator cursors, reconnection, hardened path resolution, and cross-platform installer generation.
