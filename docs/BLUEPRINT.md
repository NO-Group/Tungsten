# The visual builder blueprint, and where each part lives

The three-part specification — core engine and bidirectional sync, UI mapping
and compilation, integrity checking and extensibility — is built. This is the
line-by-line mapping, including the three places Tungsten deliberately does
something other than what the specification said, and why.

## How you actually build with it

Three ways in, because different hands reach for different ones:

- **Drag a block out of the library** and drop it where you want it. A dashed
  ghost shows where it will land, snapped to an 8px grid, centred on the
  cursor. Clicking a palette item still drops one below the last block, which
  is faster when you do not care where it goes.
- **Drag a wire** from an output pin; the wire follows the pointer and the
  pins it could legally land on light up. Let go on one to connect. Or click
  the two pins in turn — easier to hit on a trackpad, and Escape cancels.
- **Push two blocks together.** Drag a block so its *Run* pin comes within
  56px of a free *Then* pin and it snaps into alignment, joined, the way two
  puzzle pieces do. Only execution pins snap, and only free ones: an
  accidental data link is much harder to notice than an accidental step in
  the sequence, and snapping must never silently replace a connection you
  made on purpose.

## Properties are ports

The inspector is CorelDRAW's right-hand docker: whatever is selected, and
everything that can be changed about it. What makes it cheap is the
decision underneath it — **a style property is a port**, marked
`property: true`.

That one line means styling inherits everything ports already have, rather
than arriving as a second kind of state sitting beside the graph:

- the inspector edits it through `setValue`, so **undo covers it**
- the generator writes it, so it **lands in the file**
- the parser reads it back, so it **round-trips byte for byte**
- the file sync carries it, so **editing the code moves the control**
- the canvas filters properties out of its pins, so **the block stays the
  same size** and nothing can be wired to a colour

Only what differs from the default is written, so an unstyled button still
generates `render.button({ id: "submit", text: "Submit" })` and a styled one
adds exactly the properties you set. Colours are Graphene token names rather
than hex — `background: "accent"` resolves to `var(--app-accent)` in the
rendered output — so a generated app re-themes with the design system
instead of freezing today's palette into its source. Anything that is not a
token name passes through, so a hex value still works.

The inspector renders whatever ports a block declares. There is no list of
known block types in it, which is why a plugin's properties appear there
with no change to the file.

## The canvas as a camera

The first item in the CorelDRAW-style hierarchy is the one everything else
stands on: a canvas you can actually navigate. `src/builder/viewport.ts`
holds one equation —

    screen = canvas * zoom + offset

— and every pointer path in the canvas goes through it, which is what keeps
dropping, dragging, wiring, marqueeing and snapping correct at any zoom.
Node positions never change when the view does: a zoom is not an edit.

- **Zoom 10%–500%**, by button, by Ctrl+wheel about the pointer, and by
  Ctrl+plus / Ctrl+minus / Ctrl+0 through fixed stops. The property that
  makes it feel like a camera rather than a document jumping away from you
  — the pixel under the cursor does not move — is a test, not an intention.
- **Pan** with the Pan tool, with the middle button, or by holding space
  with any tool. The delta is measured from the pointer rather than read
  from `movementX`, which is only dependable under pointer lock and is
  scaled by the device pixel ratio on some platforms.
- **Fit** frames the whole graph, centred, and never zooms past 100%:
  filling the screen with four enormous blocks because that is all there is
  reads as broken.
- **Three tools, CorelDRAW-style**, each a real mode with its own cursor and
  single-key shortcut: Pick (V), Pan (H), Marquee (M). Pick marquees from
  bare canvas; the Marquee tool boxes even when the drag starts on a block.

And once a canvas has more than a handful of blocks on it:

- **Select many.** Drag a marquee across bare canvas, or shift-click to add
  and remove. Anything the box touches is caught — requiring full
  containment reads as broken. A plain click on a block that is already in
  the selection keeps the group, so picking a group up by one of its members
  does not collapse it first.
- **Move, duplicate and delete the group.** Dragging one selected block
  drags all of them by the same delta; Delete takes the lot; the arrows
  nudge them together.
- **Copy and paste, across windows.** The clipboard payload is JSON with a
  marker, so a selection can be pasted into another workspace, and text that
  came from somewhere else is recognised as not ours and refused. Wires are
  carried only when both of their ends were copied — half a wire is worse
  than none. A block type the receiving workspace does not have is skipped
  and named, which is exactly when a missing plugin shows up. The system
  clipboard is used when it will have us, and the builder keeps its own copy
  so a denied permission never means a broken paste.
- **Tidy.** One button lays the graph out the way it reads: flow left to
  right, one column per step of depth, blocks stacked in the order they
  already had. It is stable — tidying twice changes nothing the second time
  — it cannot lose a block even when the graph has a cycle in it, and it
  changes nothing about the program itself.

And the things that make it fast:

- **Start from a recipe.** Six of them ship — a sign-in form, OAuth, listing a
  table, calling an API, sign-up writing a profile row, a session guard. One
  click drops the whole feature in, wired, and `recipes.test.ts` holds every
  one to the same bar as hand-built work: no refused link, no integrity
  error, and a clean round trip through the parser.
- **Quick add.** Drag a wire into empty space and a filtered menu opens
  offering *only* the blocks that pin can legally reach. Pick one and it is
  created, positioned and connected in a single gesture.
- **Undo everything**, Ctrl+Z / Ctrl+Shift+Z, with gestures coalesced: a drag
  is one step, not fifty frames.
- **Keyboard**: Ctrl+D duplicates the selection with its values, Delete
  removes it, the arrows nudge by a grid step and by four with Shift. Never
  while a field has focus.

The geometry, the snapping rules and the undo stack are pure functions in
`src/builder/canvasLayout.ts` and `src/builder/history.ts`, so they are tested
as rules rather than through a rendered canvas.

## The code is a file, not a preview

The canvas, the builder's code pane and `src/generated/blocks.ts` are one
program in three places. Move a block and the file changes. Open that file in
an ordinary editor tab, type into it, and 300ms after you stop the blocks
move. There is no export step in between, and the toolbar says **Synced** so
you can see the binding rather than trust it.

The whole difficulty is echoes: writing the file looks like an edit, which
would rewrite the blocks, which would rewrite the file. `fileSync.ts` settles
it by remembering the exact text both sides last agreed on — whichever side
no longer matches it is the side that changed, and the other follows. It is a
pure function, so every case is a row in a test rather than something to
watch for in a browser:

| Canvas | File | What happens |
| --- | --- | --- |
| changed | unchanged | the file is written |
| unchanged | changed | the blocks are rebuilt |
| changed | changed | the file wins, and says so |
| unparseable text | — | the canvas goes read-only; the file is left exactly as typed |
| sync off | — | nothing, and the agreement is remembered so turning it back on does not discard the canvas |

## The assistant, and who is allowed to write

`src/editor/ai/` adds an assistant to the editor with three permission
tiers, and the rule about who may write is one function — `mayMutate` —
rather than something spread through the UI:

| Mode | What it may do |
| --- | --- |
| **Advisor** | Answers in the floating panel. Cannot reach a buffer at all. |
| **Diff preview** | Prepares the edit, shows it as a real Monaco diff, applies it only when accepted. |
| **Autonomous** | Applies as it streams, and says what it did. |

A provider never writes anything. It returns text; the permission engine
decides what becomes of it. Edits reach the file through the workbench's
ordinary "this file changed" path, which is why propagation is free: an
accepted edit is indistinguishable from typing, so the tab goes dirty, the
language server re-checks it, and — if the file is the builder's — the blocks
move.

Two providers ship, and neither pretends to be the other. **The local rules
assistant** is offline and deterministic: it recognises concrete jobs (wrap
this in try/catch, document this function, log this value, add a TODO,
convert to an arrow function, explain this) and performs them exactly, the
same way every time. It cannot invent code it was not taught, and it does not
claim to. **The remote assistant** streams from any OpenAI-compatible
endpoint the user configures; Tungsten ships no key and no default endpoint,
so until one is set the local assistant answers. The SSE reader is tested
against split frames, keep-alives and `[DONE]`.

## Part 1 — Core engine and bidirectional sync

| Specified | Built | Where |
| --- | --- | --- |
| Split pane: puzzle canvas + live code view | Yes | `src/components/builder/BuilderView.tsx` |
| Drag, drop and snap pieces together | Yes | `src/components/builder/BuilderCanvas.tsx`, `src/builder/canvasLayout.ts` |
| Single source of truth graph model | Yes — one graph, one store | `src/builder/graph.ts`, `useBuilder.ts` |
| Flow A: blocks → AST → code | Yes, deterministic and ordered | `src/builder/codeGenerator.ts` |
| Monaco updated with an external-update marker | Yes, breaks the echo loop | `useBuilder.ts` |
| Flow B: code → blocks, 300 ms debounce | Yes, `PARSE_DEBOUNCE = 300` | `src/builder/codeParser.ts` |
| The program as a live workspace file, both ways | Yes | `src/builder/fileSync.ts`, `useBuilderFileSync.ts` |
| Canvas re-renders affected nodes | Yes | `BuilderView.tsx` |
| Static type/domain safety on ports | Yes, `type-mismatch` | `src/builder/integrity.ts` |
| Orphan and dead-code detection, dimmed and excluded | Yes, `orphan` | `integrity.ts`, `codeGenerator.ts` |
| Circular dependency / async deadlock prevention | Yes, `cycle`, over a DAG | `integrity.ts` |
| Syntax shield: safe read-only state, inline banner | Yes, never crashes the graph | `codeParser.ts`, `BuilderView.tsx` |

Round-tripping is enforced by test, not by hope: generate → parse → generate is
byte-stable for every block in the library.

## Part 2 — UI mapping and compilation

| Specified | Built | Where |
| --- | --- | --- |
| Universal JSON component schema (`id`, `type`, `properties`, `layout`, `events`) | Yes | `src/builder/uiSchema.ts` |
| Live sandbox preview, clicks and typing without a build | Yes, sandboxed iframe | `src/builder/previewRuntime.ts` |
| Auth blocks: email sign-up, OAuth, session validation | Yes | `auth.signUp`, `auth.oauth`, `auth.session` |
| Database blocks: visual schema → migrations + query fetchers | Yes | `src/builder/dataSchema.ts`, `data.query`, `data.insert` |
| Storage and media blocks | Yes | `storage.upload` |
| IR → target transpilation | Yes, `IR_VERSION = 1` | `src/builder/compile.ts` |
| Web bundle output | Yes → `build/web/*` | `compile.ts` |
| Mobile source export | Yes → `build/mobile/lib/*.dart` | `compile.ts` |
| One-click local runner | Yes → `build/node/server.mjs`, port 4173 | `compile.ts` |

## Part 3 — Integrity, debugging, extensibility

| Specified | Built | Where |
| --- | --- | --- |
| Checker runs on every state mutation | Yes | `useBuilder.ts` |
| …as a background worker, off the main thread | Yes, with an inline fallback | `integrityWorker.ts`, `useIntegrityCheck.ts` |
| Compiler/runtime diagnostics mapped to blocks, compilation frozen | Yes | `externalDiagnostics.ts` |
| Strongly-typed port matching, bad links red, compilation blocked | Yes | `integrity.ts`, `BuilderView.tsx` |
| Tarjan's SCC for loops and unawaited promises | Yes | `integrity.ts` |
| Orphan pruning as a non-blocking warning | Yes | `integrity.ts` |
| Compiler/runtime line → block id via source maps | Yes | `codeGenerator.ts` (`lineOfNode`, `nodeAtLine`) |
| Canvas pans to the faulty block, glowing red border | Yes | `src/builder/traceback.ts`, `BuilderView.tsx` |
| Plain-English fix text | Yes — every diagnostic carries a mandatory `fix` | `integrity.ts` |
| Plugin SDK: `defineBlock({ type, category, inputs, outputs, codeGenerator })` | Yes | `src/builder/blockSchema.ts` |
| Undo, quick add, duplicate, recipes | Yes | `history.ts`, `recipes.ts`, `BuilderCanvas.tsx` |
| Local plugins directory scanned and registered at startup | Yes, `plugins/*.block.json` | `src/builder/pluginBlocks.ts` |

The eight integrity rules are `unknown-block`, `type-mismatch`,
`missing-input`, `cycle`, `orphan`, `unreachable-value`, `out-of-scope` and
`unused-result`. Diagnostics are sorted by node then rule so the list is
stable, and each one names the fix.

## The three deliberate deviations

**Tauri and Rust → Electron.** Tungsten already had a working Electron shell
with PTYs, language servers, debug adapters, Git, SSH remotes and signed
installers for three platforms. Rewriting that shell in Rust would have
replaced a large amount of working, tested code with new untested code, and
bought nothing the builder needed. The saving Tauri offers is binary size and
idle memory; the cost was the entire desktop integration surface.

**Zustand → the existing store.** A second state library alongside the one the
workbench already uses would mean two ways to do everything and two places to
look when state is wrong. The builder's state is a hook over the same
primitives as the rest of the app.

**React Flow → a purpose-built canvas.** React Flow is excellent at generic
node graphs. The builder needs typed ports that refuse bad links, execution
chains distinct from data flow, and diagnostics rendered on the wires — all of
which would have meant fighting its model. The canvas is about four hundred
lines of SVG and pointer handling, with no dependency to track.

The checker now runs in a real worker where one exists, and inline where one
does not (jsdom, server rendering). Only data crosses the boundary: a block's
generator and parser are functions and cannot be cloned, so the worker
rebuilds an identical registry from the built-in library plus the workspace's
plugin manifests — which are JSON by design. Answers are keyed by
`docVersion`, so a reply that arrives after the graph moved on is discarded
rather than shown, and the previous report stays on screen meanwhile. A canvas
is never left without a report, because rendering "no problems" while the
answer is in flight would be a lie.

## Proving it

`npx vitest run src/builder src/components/builderView` — 109 builder tests
plus the view tests, covering generation, parsing, the round trip, every
integrity rule, the compile targets, the preview runtime and plugin loading.
