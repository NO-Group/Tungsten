#!/usr/bin/env node
/**
 * Renders a reviewable preview of the Graphene workbench.
 *
 * Building Electron VS Code takes tens of minutes and several gigabytes, which
 * makes "did the redesign land?" an expensive question to ask. This script
 * answers it in milliseconds by rendering a faithful static mock of the
 * workbench using the *generated artefacts themselves* — every colour comes
 * out of graphene-dark.json and every measurement out of tokens.json.
 *
 * It is a preview, not a simulation: it proves the palette and the geometry
 * read correctly together. It does not prove VS Code compiles.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGrapheneTheme } from './buildTheme.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = JSON.parse(readFileSync(resolve(here, 'tokens.json'), 'utf8'))
const theme = buildGrapheneTheme()
const c = (key, fallback = 'transparent') => theme.colors[key] ?? fallback

const { syntax: s, typography: type, geometry: geo } = tokens

/** Escape, then wrap spans of code in token classes. */
const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const t = (cls, text) => `<span class="t-${cls}">${esc(text)}</span>`

/* A realistic TypeScript sample, hand-tokenised so the preview exercises
   every syntax colour the theme defines rather than a happy-path subset. */
const codeLines = [
  [[null, '']],
  [['comment', '/** Resolve the editor group that should receive `path`. */']],
  [['keyword', 'export'], [null, ' '], ['keyword', 'function'], [null, ' '], ['function', 'targetGroup'], ['punct', '('], ['param', 'layout'], ['punct', ':'], [null, ' '], ['type', 'Layout'], ['punct', ','], [null, ' '], ['param', 'path'], ['punct', ':'], [null, ' '], ['type', 'string'], ['punct', ')'], ['punct', ':'], [null, ' '], ['type', 'Group'], [null, ' '], ['punct', '{']],
  [[null, '  '], ['keyword', 'const'], [null, ' '], ['var', 'existing'], [null, ' '], ['op', '='], [null, ' '], ['var', 'layout'], ['punct', '.'], ['prop', 'groups'], ['punct', '.'], ['method', 'find'], ['punct', '(('], ['param', 'g'], ['punct', ')'], [null, ' '], ['op', '=>'], [null, ' '], ['param', 'g'], ['punct', '.'], ['prop', 'editors'], ['punct', '.'], ['method', 'some'], ['punct', '(('], ['param', 'e'], ['punct', ')'], [null, ' '], ['op', '=>'], [null, ' '], ['param', 'e'], ['punct', '.'], ['prop', 'path'], [null, ' '], ['op', '==='], [null, ' '], ['param', 'path'], ['punct', '))']],
  [[null, '  '], ['keyword', 'if'], [null, ' '], ['punct', '('], ['var', 'existing'], ['punct', ')'], [null, ' '], ['keyword', 'return'], [null, ' '], ['var', 'existing']],
  [[null, '']],
  [[null, '  '], ['comment', '// Never exceed the split ceiling; fall back to the active group.']],
  [[null, '  '], ['keyword', 'if'], [null, ' '], ['punct', '('], ['var', 'layout'], ['punct', '.'], ['prop', 'groups'], ['punct', '.'], ['prop', 'length'], [null, ' '], ['op', '>='], [null, ' '], ['const', 'MAX_GROUPS'], ['punct', ')'], [null, ' '], ['punct', '{']],
  [[null, '    '], ['function', 'telemetry'], ['punct', '.'], ['method', 'note'], ['punct', '('], ['str', "'split.ceiling'"], ['punct', ','], [null, ' '], ['punct', '{'], [null, ' '], ['prop', 'max'], ['punct', ':'], [null, ' '], ['num', '4'], [null, ' '], ['punct', '})']],
  [[null, '    '], ['keyword', 'return'], [null, ' '], ['function', 'activeGroup'], ['punct', '('], ['var', 'layout'], ['punct', ')']],
  [[null, '  '], ['punct', '}']],
  [[null, '']],
  [[null, '  '], ['keyword', 'const'], [null, ' '], ['var', 'slug'], [null, ' '], ['op', '='], [null, ' '], ['param', 'path'], ['punct', '.'], ['method', 'replace'], ['punct', '('], ['regexp', '/[^a-z0-9]+/gi'], ['punct', ','], [null, ' '], ['str', "'-"], ['escape', '\\n'], ['str', "'"], ['punct', ')']],
  [[null, '  '], ['keyword', 'return'], [null, ' '], ['function', 'splitGroup'], ['punct', '('], ['var', 'layout'], ['punct', ','], [null, ' '], ['str', "'right'"], ['punct', ','], [null, ' '], ['var', 'slug'], ['punct', ')']],
  [['punct', '}']],
  [[null, '']],
  [['deprecated', '// @deprecated — use targetGroup() instead']],
  [['storage', 'const'], [null, ' '], ['var', 'pickGroup'], [null, ' '], ['op', '='], [null, ' '], ['var', 'targetGroup']],
]

const renderCode = () => codeLines.map((line, i) => {
  const n = i + 1
  const active = n === 4
  return `<div class="line${active ? ' active' : ''}">`
    + `<span class="gutter${active ? ' on' : ''}">${n}</span>`
    + `<span class="code">${line.map(([cls, text]) => (cls ? t(cls, text) : esc(text))).join('')}</span>`
    + '</div>'
}).join('')

const tree = [
  ['folder', 'src', 0, false, null],
  ['folder', 'editor', 1, false, null],
  ['ts', 'editorGroups.ts', 2, false, 'M'],
  ['ts', 'editorGroups.test.ts', 2, false, null],
  ['folder', 'theme', 1, false, null],
  ['ts', 'fileIcons.ts', 2, false, null],
  ['ts', 'themeService.ts', 2, false, 'M'],
  ['tsx', 'App.tsx', 1, true, null],
  ['css', 'styles.css', 1, false, null],
  ['folder', 'fork', 0, false, null],
  ['json', 'tokens.json', 1, false, 'A'],
  ['js', 'buildTheme.mjs', 1, false, 'A'],
  ['md', 'README.md', 0, false, null],
]

const glyphs = {
  folder: ['▸', c('symbolIcon.folderForeground', tokens.ink.muted)],
  ts: ['TS', '#6ba3d6'], tsx: ['TS', '#6ba3d6'], js: ['JS', tokens.signal.warning],
  json: ['{}', tokens.signal.warning], css: ['#', '#7fa8d6'], md: ['M↓', tokens.ink.muted],
}

const renderTree = () => tree.map(([kind, name, depth, active, git]) => {
  const [glyph, colour] = glyphs[kind]
  const gitColour = git === 'M' ? c('gitDecoration.modifiedResourceForeground') : c('gitDecoration.addedResourceForeground')
  return `<div class="row${active ? ' active' : ''}" style="padding-left:${6 + depth * 12}px">`
    + `<span class="glyph" style="color:${colour}">${glyph}</span>`
    + `<span class="name"${git ? ` style="color:${gitColour}"` : ''}>${name}</span>`
    + (git ? `<span class="git" style="color:${gitColour}">${git}</span>` : '')
    + '</div>'
}).join('')

const paletteRows = [
  ['Split Editor Right', '⌘ \\', true],
  ['Toggle Terminal', '⌃ `', false],
  ['Go to Symbol in Editor…', '⇧⌘ O', false],
  ['Format Document', '⇧⌥ F', false],
  ['Preferences: Color Theme', '', false],
]

const swatchGroups = [
  ['ramp', tokens.ramp], ['ink', tokens.ink], ['accent', tokens.accent], ['signal', tokens.signal],
]

const renderSwatches = () => swatchGroups.map(([group, values]) => {
  const chips = Object.entries(values)
    .filter(([k]) => k !== 'comment')
    .map(([k, v]) => `<div class="chip"><i style="background:${v}"></i><b>${k}</b><code>${v}</code></div>`)
    .join('')
  return `<section><h4>${group}</h4><div class="chips">${chips}</div></section>`
}).join('')

export function buildPreview() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Graphene — Tungsten workbench preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --void:${tokens.ramp.void};--base:${tokens.ramp.base};--sidebar:${tokens.ramp.sidebar};
  --chrome:${tokens.ramp.chrome};--raised:${tokens.ramp.raised};--overlay:${tokens.ramp.overlay};
  --hover:${tokens.ramp.hover};--selected:${tokens.ramp.selected};--border:${tokens.ramp.border};
  --border-strong:${tokens.ramp.borderStrong};
  --faint:${tokens.ink.faint};--muted:${tokens.ink.muted};--body:${tokens.ink.body};
  --strong:${tokens.ink.strong};--inverse:${tokens.ink.inverse};
  --accent:${tokens.accent.base};--accent-dim:${tokens.accent.dim};--accent-border:${tokens.accent.border};
  --mono:${type.mono};--sans:${type.sans};--radius:${geo.radius}px;--radius-lg:${geo.radiusLarge}px;
}
body{background:var(--void);color:var(--body);font-family:var(--sans);font-size:${type.uiSize}px;
  letter-spacing:${type.letterSpacing};-webkit-font-smoothing:antialiased;padding:28px;line-height:1.5}
.wrap{max-width:1180px;margin:0 auto}
.lede{margin-bottom:20px}
.lede h1{font-size:19px;font-weight:600;color:var(--strong);letter-spacing:-0.01em}
.lede h1 em{font-style:normal;color:var(--accent)}
.lede p{color:var(--muted);font-size:12px;margin-top:5px;max-width:74ch}
.meta{display:flex;gap:7px;margin-top:11px;flex-wrap:wrap}
.meta span{font-family:var(--mono);font-size:10px;padding:3px 8px;border:1px solid var(--border);
  border-radius:999px;color:var(--muted);background:var(--chrome)}
.meta span b{color:var(--accent);font-weight:600}

/* ---- workbench shell ---- */
.wb{border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;
  box-shadow:0 24px 70px rgba(0,0,0,.65);background:var(--base);position:relative}
.titlebar{height:34px;background:${c('titleBar.activeBackground')};border-bottom:1px solid var(--border);
  display:flex;align-items:center;padding:0 10px;gap:9px}
.dots{display:flex;gap:6px}.dots i{width:11px;height:11px;border-radius:50%;display:block}
.cmdcenter{margin:0 auto;width:min(380px,44%);height:21px;border:1px solid var(--border);border-radius:var(--radius);
  background:var(--base);display:flex;align-items:center;justify-content:center;gap:6px;
  font-size:10px;color:var(--faint);font-family:var(--mono)}
.cmdcenter b{color:var(--muted);font-weight:500}

.body{display:flex;height:472px}
.activity{width:${geo.activityBarWidth}px;background:${c('activityBar.background')};
  border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding-top:6px;gap:2px}
.act{width:${geo.activityBarWidth}px;height:44px;display:grid;place-items:center;color:var(--faint);
  font-size:16px;position:relative;cursor:default}
.act.on{color:${c('activityBar.foreground')}}
.act.on::before{content:"";position:absolute;left:0;top:25%;bottom:25%;border-left:2px solid var(--accent)}
.act .badge{position:absolute;right:7px;bottom:7px;min-width:14px;height:14px;border-radius:var(--radius);
  background:${c('activityBarBadge.background')};color:${c('activityBarBadge.foreground')};
  font-family:var(--mono);font-size:9px;font-weight:600;display:grid;place-items:center;padding:0 3px}
.spacer{flex:1}

.side{width:224px;background:${c('sideBar.background')};border-right:1px solid var(--border);
  display:flex;flex-direction:column}
.side h3{font-size:${type.microSize}px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted);padding:9px 11px 6px}
.pane-head{font-size:${type.microSize}px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);padding:5px 11px;display:flex;align-items:center;gap:5px;
  border-top:1px solid var(--border);margin-top:4px}
.pane-head span{color:var(--faint);font-weight:400}
.row{height:${geo.rowHeight}px;display:flex;align-items:center;gap:6px;font-family:var(--mono);
  font-size:${type.denseSize}px;color:var(--muted);padding-right:8px;cursor:default;position:relative}
.row:hover{background:var(--hover)}
.row.active{background:var(--selected);color:var(--strong);box-shadow:inset 2px 0 0 0 var(--accent)}
.row .glyph{font-size:9px;font-weight:700;width:15px;flex:none;text-align:center}
.row .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .git{margin-left:auto;font-size:9px;font-weight:700}

.main{flex:1;display:flex;flex-direction:column;min-width:0;background:${c('editor.background')}}
.tabs{height:${geo.tabHeight}px;background:${c('editorGroupHeader.tabsBackground')};display:flex;
  border-bottom:1px solid var(--border)}
.tab{display:flex;align-items:center;gap:6px;padding:0 11px;font-family:var(--mono);
  font-size:${type.denseSize}px;color:var(--muted);border-right:1px solid var(--border);
  position:relative;cursor:default;white-space:nowrap}
.tab.on{background:${c('tab.activeBackground')};color:var(--strong);font-weight:500;
  box-shadow:inset 0 2px 0 0 var(--accent)}
.tab.prev{font-style:italic;opacity:.82}
.tab .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.tab .x{color:var(--faint);font-size:12px}
.crumbs{height:22px;display:flex;align-items:center;gap:5px;padding:0 12px;
  font-family:var(--mono);font-size:${type.denseSize}px;color:var(--faint);
  border-bottom:1px solid ${tokens.ramp.border}80}
.crumbs b{font-weight:400;color:var(--muted)}
.crumbs i{font-style:normal;color:var(--faint)}

.editor{flex:1;position:relative;overflow:hidden;font-family:var(--mono);
  font-size:${type.editorSize}px;line-height:${type.lineHeight};padding:8px 0}
.line{display:flex;white-space:pre}
.line.active{background:${c('editor.lineHighlightBackground', tokens.ramp.base)}}
.gutter{width:44px;flex:none;text-align:right;padding-right:14px;color:var(--faint);
  font-size:${type.microSize + 2}px;-webkit-user-select:none;user-select:none}
.gutter.on{color:var(--accent);font-weight:600}
.code{padding-right:16px}
.minimap{position:absolute;top:0;right:0;width:56px;height:100%;
  background:${tokens.ramp.base};border-left:1px solid ${tokens.ramp.border}66;padding:10px 6px;
  display:flex;flex-direction:column;gap:3px;opacity:.5}
.minimap i{height:2px;border-radius:1px;display:block}

.t-comment{color:${s.comment_};font-style:italic}
.t-keyword{color:${s.keyword}}.t-storage{color:${s.storage}}
.t-str{color:${s.string}}.t-num{color:${s.number}}.t-const{color:${s.constant}}
.t-function{color:${s.function}}.t-method{color:${s.method}}
.t-type{color:${s.type}}.t-var{color:${s.variable}}.t-param{color:${s.parameter}}
.t-prop{color:${s.property}}.t-op{color:${s.operator}}.t-punct{color:${s.punctuation}}
.t-regexp{color:${s.regexp}}.t-escape{color:${s.escape}}
.t-deprecated{color:${s.deprecated};text-decoration:line-through;font-style:italic}

.panel{height:124px;border-top:1px solid var(--border);background:${c('panel.background')};
  display:flex;flex-direction:column}
.panel .switch{height:26px;display:flex;align-items:center;gap:16px;padding:0 12px;
  border-bottom:1px solid ${tokens.ramp.border}80}
.panel .switch span{font-size:${type.microSize}px;font-weight:600;letter-spacing:.1em;
  text-transform:uppercase;color:var(--faint);padding:5px 0;cursor:default}
.panel .switch span.on{color:var(--strong);box-shadow:inset 0 -2px 0 0 var(--accent)}
.panel .switch .err{color:${tokens.signal.danger}}
.term{flex:1;padding:7px 12px;font-family:var(--mono);font-size:${type.denseSize}px;line-height:1.65;
  color:${c('terminal.foreground', tokens.ink.body)};overflow:hidden}
.term .p{color:var(--accent)}.term .ok{color:${tokens.signal.added}}
.term .dim{color:var(--faint)}.term .warn{color:${tokens.signal.warning}}
.cursor{display:inline-block;width:7px;height:12px;background:var(--accent);vertical-align:-2px;
  box-shadow:0 0 6px ${tokens.accent.base}80}

.status{height:${geo.statusBarHeight}px;background:${c('statusBar.background')};
  border-top:1px solid var(--border);display:flex;align-items:center;
  font-family:var(--mono);font-size:${type.denseSize}px;color:${c('statusBar.foreground', tokens.ink.muted)}}
.status .it{padding:0 7px;height:100%;display:flex;align-items:center;gap:4px;cursor:default}
.status .it:hover{background:var(--hover);color:var(--strong)}
.status .it.brand{background:var(--accent);color:var(--inverse);font-weight:600}
.status .gap{flex:1}
.status .err{color:${tokens.signal.danger}}.status .warn{color:${tokens.signal.warning}}

/* command palette */
.palette{position:absolute;top:44px;left:50%;transform:translateX(-50%);width:min(520px,62%);
  background:${c('quickInput.background', tokens.ramp.raised)};border:1px solid var(--border-strong);
  border-radius:var(--radius-lg);box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;z-index:5}
.palette .in{height:30px;display:flex;align-items:center;padding:0 11px;gap:7px;
  border-bottom:1px solid var(--border);font-family:var(--mono);font-size:${type.uiSize}px;color:var(--body)}
.palette .in .chev{color:var(--accent);font-weight:700}
.palette .r{height:26px;display:flex;align-items:center;padding:0 11px;gap:8px;font-size:${type.denseSize}px;
  color:var(--muted);cursor:default}
.palette .r.on{background:var(--selected);color:var(--strong);box-shadow:inset 2px 0 0 0 var(--accent)}
.palette .r .hi{color:var(--accent);font-weight:600}
.palette .r kbd{margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--faint);
  border:1px solid var(--border);border-radius:var(--radius);padding:1px 5px}

/* token reference */
.ref{margin-top:24px}
.ref > h2{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted);margin-bottom:11px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(224px,1fr));gap:12px}
.grid section{background:var(--chrome);border:1px solid var(--border);border-radius:var(--radius-lg);padding:11px}
.grid h4{font-family:var(--mono);font-size:10px;color:var(--accent);margin-bottom:8px;
  letter-spacing:.06em;text-transform:uppercase}
.chips{display:flex;flex-direction:column;gap:5px}
.chip{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px}
.chip i{width:15px;height:15px;border-radius:3px;border:1px solid var(--border-strong);flex:none}
.chip b{font-weight:500;color:var(--body);min-width:82px}
.chip code{color:var(--faint)}
.foot{margin-top:18px;font-size:11px;color:var(--faint);border-top:1px solid var(--border);padding-top:12px}
.foot code{font-family:var(--mono);color:var(--muted)}
</style></head><body><div class="wrap">

<div class="lede">
  <h1>Graphene <em>·</em> Tungsten workbench</h1>
  <p>Every colour below is read from the generated <code>graphene-dark.json</code> and every measurement from
     <code>tokens.json</code>. Change a token, re-run the build, and this page changes with it.</p>
  <div class="meta">
    <span>upstream <b>vscode@1b7223a</b></span>
    <span><b>${Object.keys(theme.colors).length}</b> workbench colours</span>
    <span><b>${theme.tokenColors.length}</b> TextMate rules</span>
    <span><b>${Object.keys(theme.semanticTokenColors ?? {}).length}</b> semantic rules</span>
    <span>telemetry <b>off</b></span>
    <span>gallery <b>Open VSX</b></span>
  </div>
</div>

<div class="wb">
  <div class="titlebar">
    <div class="dots"><i style="background:${tokens.signal.danger}"></i><i style="background:${tokens.signal.warning}"></i><i style="background:${tokens.signal.added}"></i></div>
    <div class="cmdcenter">⌕ <b>editorGroups.ts</b> — Tungsten</div>
  </div>

  <div class="body">
    <div class="activity">
      <div class="act on">▤</div>
      <div class="act">⌕</div>
      <div class="act">⑂<span class="badge">7</span></div>
      <div class="act">▷</div>
      <div class="act">▣<span class="badge">2</span></div>
      <div class="spacer"></div>
      <div class="act">⚙</div>
    </div>

    <div class="side">
      <h3>Explorer</h3>
      <div class="pane-head">▾ Tungsten <span>— 24 files</span></div>
      ${renderTree()}
      <div class="pane-head">▸ Outline</div>
      <div class="pane-head">▸ Timeline</div>
    </div>

    <div class="main">
      <div class="tabs">
        <div class="tab on"><span style="color:#6ba3d6;font-size:9px;font-weight:700">TS</span>editorGroups.ts<span class="dot"></span></div>
        <div class="tab"><span style="color:#6ba3d6;font-size:9px;font-weight:700">TS</span>App.tsx<span class="x">×</span></div>
        <div class="tab prev"><span style="color:${tokens.signal.warning};font-size:9px;font-weight:700">{}</span>tokens.json</div>
      </div>
      <div class="crumbs"><b>src</b><i>›</i><b>editor</b><i>›</i><b>editorGroups.ts</b><i>›</i><b style="color:${s.function}">targetGroup</b></div>
      <div class="editor">
        ${renderCode()}
        <div class="minimap">
          ${['58%','82%','41%','67%','30%','74%','52%','88%','36%','61%','45%','79%','25%','56%'].map((w, i) => `<i style="width:${w};background:${i % 3 === 0 ? s.keyword : i % 3 === 1 ? s.string : tokens.ink.faint}"></i>`).join('')}
        </div>
      </div>
      <div class="panel">
        <div class="switch">
          <span>Problems <b class="err">2</b></span><span>Output</span><span class="on">Terminal</span><span>Ports</span>
        </div>
        <div class="term">
<span class="p">tungsten</span> <span class="dim">~/Tungsten</span> $ npm run fork
<span class="ok">✓</span> brand    product.json — 42 keys overlaid
<span class="ok">✓</span> theme    ${Object.keys(theme.colors).length} colours, ${theme.tokenColors.length} TextMate rules
<span class="ok">✓</span> shell    style.css — Graphene block spliced
<span class="warn">·</span> verify   19 checks passed<span class="cursor"></span></div>
      </div>
      <div class="status">
        <div class="it brand">⑂ arena/01a0d03d</div>
        <div class="it"><span class="err">✗ 2</span> <span class="warn">⚠ 5</span></div>
        <div class="gap"></div>
        <div class="it">Ln 4, Col 31</div>
        <div class="it">Spaces: 2</div>
        <div class="it">UTF-8</div>
        <div class="it">TypeScript</div>
        <div class="it">Graphene Dark</div>
      </div>
    </div>
  </div>

  <div class="palette">
    <div class="in"><span class="chev">›</span>split<span class="cursor" style="width:6px;height:13px"></span></div>
    ${paletteRows.map(([label, kbd, on]) => {
      const html = on ? `<span class="hi">Split</span> Editor Right` : label
      return `<div class="r${on ? ' on' : ''}">${html}${kbd ? `<kbd>${kbd}</kbd>` : ''}</div>`
    }).join('')}
  </div>
</div>

<div class="ref">
  <h2>Design tokens</h2>
  <div class="grid">${renderSwatches()}</div>
</div>

<div class="foot">
  Generated by <code>fork/graphene/buildPreview.mjs</code>. This is a static render of the Graphene design
  layer, not a running VS Code build — it verifies the palette and geometry, not that upstream compiles.
</div>

</div></body></html>
`
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = resolve(here, 'dist')
  mkdirSync(out, { recursive: true })
  const html = buildPreview()
  writeFileSync(resolve(out, 'index.html'), html)
  console.log(`wrote ${resolve(out, 'index.html')} (${(html.length / 1024).toFixed(1)} kB)`)
}
