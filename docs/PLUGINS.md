# Adding plugins to Tungsten

Tungsten has four extension points. They are deliberately different from each
other, because they carry different risk:

| I want to… | Put a file here | Needs a rebuild? | Runs code? |
| --- | --- | --- | --- |
| Add a block to the visual builder | `plugins/*.block.json` | no | no — it is a template |
| Add a block that needs real logic | `src/builder/blockLibrary.ts` | yes | yes, it is app source |
| Document a shell command | `dictionary/*.commands.json` | no | no — it is data |
| Add IDE commands, languages, themes | `extensions/<id>/extension.json` | no | only if you opt in |

The first three are read from the **workspace you have open**, so a plugin
appears the moment you save the file. Nothing is installed globally, nothing
is downloaded, and nothing from any of these files is ever `eval`'d.

---

## 1. A builder block, from the workspace

Create `plugins/notify.block.json` in your project:

```json
{
  "type": "acme.notify",
  "label": "Send Notification",
  "category": "Network",
  "description": "Posts a message to the team channel.",
  "isAsync": true,
  "inputs": [
    { "id": "channel", "label": "Channel", "type": "String", "default": "general", "required": true },
    { "id": "message", "label": "Message", "type": "String", "required": true }
  ],
  "outputs": [
    { "id": "sent", "label": "Sent", "type": "Boolean" }
  ],
  "template": "await notify.send(${channel}, ${message})"
}
```

Save it, open the **Builder** in the activity bar, and *Send Notification* is
in the palette under Network, with two input ports, an output port, and the
execution ports wired in for you.

Don't want to type it? The command palette has **Builder: Add an Example Block
Plugin**, which writes exactly this file and opens it.

### The fields

| Field | Meaning |
| --- | --- |
| `type` | Unique id, `namespace.name` (lowercase namespace). Overrides a built-in block of the same type. |
| `label` | What the palette and the block header show. |
| `category` | `Events`, `UI`, `Logic`, `Data`, `Network`, `Auth` or `Storage`. Anything else becomes `Data`. |
| `description` | One line, shown in the palette. |
| `isAsync` | `true` if the generated call must be awaited. |
| `inputs` / `outputs` | Ports: `{ id, label, type, default?, required? }`. |
| `template` | The code the block emits. `${portId}` holes are filled with the connected expression. |

Port types are `Exec`, `String`, `Number`, `Boolean`, `List`, `Object` and
`Any`. `Exec` ports are the execution chain — the white wires that say *what
happens next*. If you declare no `Exec` input, one called **Run** is added, and
if you declare no `Exec` output, a **Then** is added, so your block can never
float off the chain and silently never run.

If any output carries data, the generated line binds it to a name
(`const sent_1 = await notify.send(…)`) so later blocks can read it.

### Why a template and not a function

The blueprint's SDK sketch had a `codeGenerator: (node) => …` callback. In
Tungsten a workspace plugin is **data**, not code: the only thing ever
substituted into a `${hole}` is an expression the builder itself generated. A
block library that loads and executes JavaScript out of the open folder is a
supply-chain hole wearing a friendly name — cloning a repo would be enough to
run someone else's code. Templates cover what blocks actually do: call
something, with arguments.

When a template is genuinely not enough, use the TypeScript route below.

### When a plugin is wrong

The loader never fails silently. Every rejected file is listed in the Builder
palette with the reason:

- `A block needs a type like “acme.sendEmail”.`
- `“acme.notify” has no code template.`
- `“acme.notify” fills “messege” but has no input with that id.` — the typo
  catcher; every hole must match a declared input id.

---

## 2. A builder block in TypeScript

Blocks that need real logic live in `src/builder/blockLibrary.ts` and are
written with `defineBlock` — the same API the twenty built-in blocks use:

```ts
defineBlock({
  type: 'crypto.price',
  label: 'Crypto Price',
  category: 'Network',
  description: 'Fetches the current price for a symbol.',
  isAsync: true,
  inputs: [
    { id: 'exec', label: 'Run', type: 'Exec' },
    { id: 'symbol', label: 'Symbol', type: 'String', default: 'BTC', required: true },
  ],
  outputs: [
    { id: 'exec', label: 'Then', type: 'Exec' },
    { id: 'price', label: 'Price', type: 'Number' },
  ],
  generate: ({ input, symbol }) => `const ${symbol} = await fetchCryptoPrice(${input('symbol')})`,
  parse: (line) => /* optional: read this block back out of code */ undefined,
})
```

`generate` gets `input(portId)` (the expression connected to that port, or its
default) and `symbol` (a unique name for this node's result). Adding `parse`
keeps the round trip intact: without it the block can be written to code but
not read back from it, and editing that line by hand will put the canvas into
its read-only state instead of guessing.

---

## 3. Shell dictionary entries

`dictionary/team.commands.json` teaches the terminal your team's commands:

```json
{
  "commands": [
    {
      "name": "deploy",
      "group": "Development",
      "summary": "Ship the current branch to staging",
      "synopsis": "deploy [SERVICE]",
      "danger": "Staging is shared. Announce it first.",
      "options": [{ "flag": "--dry-run", "summary": "Print the plan and stop" }],
      "examples": [{ "command": "deploy api --dry-run", "summary": "Check before shipping" }],
      "seeAlso": ["git", "docker"]
    }
  ]
}
```

It is merged into the same index as the 592 built-in entries, so `man deploy`,
`whatis deploy`, `apropos ship` and `explain deploy api --dry-run` all answer
for it — in the sidebar **and** in the real shell. An entry with the same name
as a built-in one overrides it, which is how you document *your* `deploy`
rather than a generic one.

Command palette: **Shell Dictionary: Document a Command for This Workspace**
writes a starting point.

---

## 4. IDE extension packages

Commands, languages, themes and keybindings are contributed by a package
folder with an `extension.json`, installed from the Extensions view on the
desktop build. Declarative packages never execute JavaScript; an executable
one declares its entry point, its permissions and a SHA-256 integrity hash,
and runs in an isolated host. See **[EXTENSIONS.md](EXTENSIONS.md)**.

---

## Where each one is implemented

| Extension point | Loader | Tests |
| --- | --- | --- |
| Builder blocks (JSON) | `src/builder/pluginBlocks.ts` | `src/builder/builder.test.ts` |
| Builder blocks (TS) | `src/builder/blockSchema.ts`, `blockLibrary.ts` | `src/builder/builder.test.ts` |
| Dictionary entries | `src/shell/workspaceCommands.ts` | `src/shell/commandDictionary.test.ts` |
| IDE extensions | `electron/main.cjs`, `electron/extension-host.cjs` | `src/components/views.test.tsx` |
