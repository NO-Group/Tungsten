# Language servers

Tungsten bundles the TypeScript language server for local workspaces and can connect to language servers installed on the computer or active SSH host.

| Language | Executable |
| --- | --- |
| JavaScript / TypeScript | Bundled `typescript-language-server` |
| Python | `pylsp` |
| Rust | `rust-analyzer` |
| Go | `gopls` |
| C / C++ | `clangd` |
| Java | `jdtls` |
| C# | `omnisharp` |
| Ruby | `solargraph` |
| PHP | `intelephense` |
| Kotlin | `kotlin-language-server` |
| Lua | `lua-language-server` |

When a supported file is opened, Tungsten starts the matching server on demand. Completion, hover, diagnostics, definitions, references, rename, signatures, semantic tokens, and code actions are bridged into Monaco. Multi-root local workspaces initialize and update `workspaceFolders`.

For SSH workspaces, Tungsten starts the executable on the remote host through the authenticated SSH transport and maps document URIs to the remote POSIX root. `typescript-language-server` must therefore be installed on the remote host for JavaScript/TypeScript intelligence. If any external server is unavailable, editing and bundled syntax highlighting continue normally.
