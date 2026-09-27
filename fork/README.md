# The Tungsten fork of VS Code

This directory turns upstream Visual Studio Code into **Tungsten**, rebranded and
redesigned in the **Graphene** design language.

```
npm run fork            # fetch upstream, brand it, theme it, verify it  (~3s)
npm run fork:verify     # re-check an existing fork tree
npm run graphene:build  # regenerate the theme + stylesheet into dist/
```

---

## Why this is a patch layer and not a vendored tree

Upstream VS Code at the pinned commit is **19,443 files / 266 MB**. This
repository's artefact budget is roughly 10,000 files and 128 MB, so a vendored
copy does not fit — but even where it fits it is the wrong shape:

- The fork is about **2,000 lines**. Vendored, those 2,000 lines would be
  invisible inside a quarter-million-line import commit.
- Every upstream bump would land as an unreviewable diff.
- `git log` here would describe Microsoft's work, not ours.

So upstream is **pinned, fetched on demand, and transformed by checked-in
generators**. `git log` in this repo shows exactly what Tungsten changes about
VS Code and nothing else. This is the same model VSCodium and Cursor use.

The tradeoff is real and worth stating plainly: you cannot read the full
Tungsten source in this repository alone. You read the delta here and run
`npm run fork` to materialise the whole.

---

## Layout

| Path | What it is |
| --- | --- |
| `upstream.json` | The pin. One commit SHA — bumping VS Code is a one-line change. |
| `graphene/tokens.json` | **Single source of truth.** Every colour, size and font in the design language. |
| `graphene/buildTheme.mjs` | tokens → a 467-key VS Code colour theme. |
| `graphene/buildWorkbenchCss.mjs` | tokens → the structural stylesheet (geometry, type, density). |
| `graphene/buildPreview.mjs` | tokens + theme → a reviewable HTML render of the workbench. |
| `graphene/graphene.test.mjs` | 35 tests over all of the above. |
| `branding/product.overlay.json` | Deep-merged onto upstream `product.json`. |
| `../scripts/fork-vscode.mjs` | The orchestrator. |

Everything under `graphene/dist/` is generated. Do not edit it.

---

## The four stages

`scripts/fork-vscode.mjs` runs four stages, each independently invocable with
`--stage <name>`.

### 1. `fetch`

Clones `microsoft/vscode` at the pinned SHA. By default it does a
**blobless, sparse** checkout of only the paths the later stages touch:

```
580 of 19,443 files   ·   25 MB   ·   ~2.5s
```

`--full` widens this to the whole tree, which is what you need to actually
compile. (Note: a full Electron build needs far more RAM and disk than a
typical sandbox has. The script is capable of setting it up; whether the
machine can finish it is a separate question.)

### 2. `brand`

Deep-merges `branding/product.overlay.json` onto upstream's `product.json`.
The overlay contains **only the keys that differ**, so a version bump never
silently discards new upstream settings. `null` means "delete this key".

This renames the product, repoints issue/docs URLs at `NO-Group/Tungsten`,
**strips every Microsoft telemetry and crash-reporting endpoint**, and swaps
the extension gallery to **Open VSX** — Microsoft's marketplace is licensed for
official VS Code builds only.

### 3. `theme`

Generates `extensions/theme-graphene`, a real built-in theme extension, and
sets `defaultColorTheme` so it is what users see on first launch.

### 4. `shell`

This is the stage that makes it a **redesign** rather than a reskin.

A colour theme can only repaint VS Code. It cannot change row heights, tab
geometry, type scale, or how focus is expressed — and those are most of what
makes an editor feel like itself. So `buildWorkbenchCss.mjs` generates ~430
lines of CSS which are **spliced into upstream's own `style.css` between
sentinel markers**:

```css
/* >>> GRAPHENE BEGIN — generated. Do not edit by hand. <<< */
…
/* >>> GRAPHENE END <<< */
```

Splicing rather than patching matters. A line-based `.patch` against upstream
source breaks on almost every rebase. Marker splicing is **idempotent** — re-run
it any number of times and the block is *replaced*, never stacked — and it
survives upstream editing the surrounding file freely. It also appends, so no
upstream rule is ever deleted; Graphene wins purely on cascade order.

---

## What Graphene actually changes

Beyond the palette:

- **Typography split.** DM Sans for prose-like chrome; JetBrains Mono for
  anything naming a machine artefact — filenames, tabs, breadcrumbs, the status
  bar. Naming a file is a technical act and should look like one.
- **Selection is an edge, not a wash.** Selected rows get a 2px lime inset bar
  instead of a flood fill, so the text stays readable.
- **Tabs stop wobbling.** Upstream reserves space for a close button that is
  invisible until hover, so labels shift on mouseover. Graphene removes the
  reservation and marks the active tab with a lime top rule.
- **Focus is 1px, not 3px.** Clearly visible, never the loudest thing onscreen —
  and the same lime in both the theme and the stylesheet.
- **Section headers become instrumentation labels.** 9px, 600 weight, 0.12em
  tracking, uppercase.
- **The status bar never strobes.** Upstream turns the whole bar blue during
  debug or remote sessions; Graphene keeps the surface stable and lets
  individual items carry the colour.
- **Motion on state, never layout.** Panels do not slide; their contents fade.
  All of it behind `prefers-reduced-motion`.

---

## Tests

`npm test` includes 35 tests over this layer. The interesting ones assert
invariants rather than hex values, so the tokens stay free to change:

- **Contrast is enforced, not hoped for.** Real WCAG relative-luminance maths.
  Body and strong ink clear **7:1** on the editor surface; the accent and the
  ink that sits on it clear 4.5:1; every syntax colour clears 4:1 (2.5:1 for
  deliberately recessive comments and deprecated tokens).
- **The neutral ramp must be monotonically lighter** from `void` to `hover`.
- **"One accent" is enforced.** The focus ring, badge, primary button and
  progress bar must all be the *same* colour, and their foreground must be the
  inverse ink — never white.
- **No VS Code blue survives.** The stock signature blues (`#007acc`,
  `#0078d4`, `#569cd6`, …) are asserted absent. If any remain, a surface was
  missed and will look grafted on.
- **No TextMate scope is claimed twice** — a silent way for theme rules to
  shadow each other.
- **Every CSS selector is scoped to `.monaco-workbench`**, so Graphene cannot
  leak into webviews or the issue reporter.
- **Injection is idempotent**, survives retuned tokens, and throws on a
  begin-marker with no end-marker.
- **The splash colours must match the ramp.** VS Code paints
  `initialColorTheme` before the theme extension loads; if these drift the
  window flashes stock grey on launch.

These caught a genuine bug during development: `focusBorder` was the *dim*
accent stop in the theme while the stylesheet used the full-strength lime, so
focus rendered as two different colours depending on which widget had it.

---

## Previewing without building

Building Electron VS Code takes tens of minutes, which makes "did the redesign
land?" an expensive question. So:

```
node fork/graphene/buildPreview.mjs
npx http-server fork/graphene/dist -p 4180
```

This renders a faithful static mock of the workbench — activity bar, explorer,
tab strip, syntax-highlighted editor, minimap, terminal panel, status bar,
command palette — where **every colour is read from the generated
`graphene-dark.json`** and every measurement from `tokens.json`. Change a token,
rebuild, and the page changes with it.

It is a preview, not a simulation. It proves the palette and geometry read
correctly together. It does not prove upstream compiles.

---

## Bumping upstream

1. Edit `commit` in `upstream.json`.
2. `npm run fork`.
3. Read the verifier output. All 19 checks must pass.

If `shell` reports that the workbench stylesheet is missing, upstream moved the
file; update `WORKBENCH_CSS` in `scripts/fork-vscode.mjs`.
