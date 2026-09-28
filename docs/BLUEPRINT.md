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

And once a canvas is moving, the things that make it fast:

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

## Part 1 — Core engine and bidirectional sync

| Specified | Built | Where |
| --- | --- | --- |
| Split pane: puzzle canvas + live code view | Yes | `src/components/builder/BuilderView.tsx` |
| Drag, drop and snap pieces together | Yes | `src/components/builder/BuilderCanvas.tsx`, `src/builder/canvasLayout.ts` |
| Single source of truth graph model | Yes — one graph, one store | `src/builder/graph.ts`, `useBuilder.ts` |
| Flow A: blocks → AST → code | Yes, deterministic and ordered | `src/builder/codeGenerator.ts` |
| Monaco updated with an external-update marker | Yes, breaks the echo loop | `useBuilder.ts` |
| Flow B: code → blocks, 300 ms debounce | Yes, `PARSE_DEBOUNCE = 300` | `src/builder/codeParser.ts` |
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

One thing in Part 3 is intentionally **not** done: the checker runs as a
memoised pure function rather than a background worker. It costs about 0.4 ms
on a 2,000-block graph, which is far below a frame; moving it to a worker would
add message-passing latency and a second copy of the graph in exchange for
nothing measurable. The seam is there if a graph ever gets big enough to need
it — the `report` memo in `useBuilder.ts` is the only thing that would move.

## Proving it

`npx vitest run src/builder src/components/builderView` — 109 builder tests
plus the view tests, covering generation, parsing, the round trip, every
integrity rule, the compile targets, the preview runtime and plugin loading.
