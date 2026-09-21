# Tungsten 2 extension packages

Tungsten supports declarative contributions and integrity-verified executable extensions. Install a folder from the Extensions sidebar. Every package starts with `extension.json`.

The Extensions view displays package scope, permissions, integrity state, and enabled state. Enable/disable choices persist across restarts and reactivate the isolated host. Per-user packages can be uninstalled after native confirmation; workspace-owned packages remain under repository control.

## Declarative package

```json
{
  "id": "acme.team-tools",
  "name": "Team Tools",
  "version": "1.0.0",
  "publisher": "Acme",
  "description": "Shared commands and language metadata.",
  "contributes": {
    "commands": [
      { "title": "Verify workspace", "command": "npm run check" }
    ],
    "languages": [
      { "id": "acme-config", "extensions": [".acme"] }
    ],
    "themes": [],
    "keybindings": [],
    "sidebar": []
  }
}
```

Declarative packages never execute JavaScript. A command with a `command` field is sent to the user's integrated terminal only after the user chooses it.

## Isolated executable package

An executable extension declares its entry point, permissions, and SHA-256 integrity:

```json
{
  "id": "acme.runtime-tools",
  "name": "Runtime Tools",
  "version": "2.2.0",
  "main": "extension.js",
  "integrity": "sha256-<hex digest of extension.js>",
  "permissions": ["commands"],
  "contributes": {
    "commands": [
      { "id": "acme.runtime-tools.hello", "title": "Say hello" }
    ]
  }
}
```

`extension.js` runs in Tungsten's separate extension-host process and a restricted VM context:

```js
tungsten.registerCommand('acme.runtime-tools.hello', () => 'Hello from the extension host')
```

The host does not expose `require`, Node filesystem APIs, Electron, or renderer globals. Activation is timed, command results must be serializable, and executable code remains disabled when its integrity declaration does not match. Installation displays requested permissions before copying the package.

Per-user extensions live under Tungsten's application-data `extensions` directory. Workspace packages may be placed under `.tungsten/extensions/<extension-id>`.
