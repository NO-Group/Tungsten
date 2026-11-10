/**
 * The Tauri toolchain, for the Windows, macOS and Linux Desktop Targets.
 *
 * A sibling of the Electron emitter rather than a replacement for it. Both
 * put the same generated interface in a window; they disagree about what
 * the window is made of. Tauri uses the webview the operating system
 * already ships and a small Rust process around it, which is why it is the
 * default: an app that is three files of markup should not weigh ninety
 * megabytes. Electron stays one click away for anyone who needs Node in
 * the main process, or a build host that has no Rust on it.
 *
 * Like the Electron path, this renders with the web output. The window is
 * a window either way, and a second renderer for the desktop would be work
 * with no user on the other end of it.
 */

import { slug, targetInfo, type Project } from '../../project/targets'
import type { CompiledFile } from '../compile'
import type { DesktopKind } from './desktop'

/** What the bundler is asked to produce, per platform. */
const BUNDLES: Record<DesktopKind, { targets: string[]; artifact: string; host: string }> = {
  windows: {
    targets: ['nsis', 'msi'],
    artifact: 'an NSIS installer and an MSI',
    host: 'Windows — the WebView2 runtime and the MSVC toolchain are both Windows-only',
  },
  macos: {
    targets: ['dmg', 'app'],
    artifact: 'a .dmg and a .app',
    host: 'macOS — Apple will not let anything else sign or notarise a build',
  },
  linux: {
    targets: ['appimage', 'deb'],
    artifact: 'an AppImage and a .deb',
    host: 'Linux, with webkit2gtk and libayatana-appindicator installed',
  },
}

export type TauriInput = {
  /** The rendered interface, as produced for the web target. */
  html: string
  /** The program the blocks generated. */
  code: string
  /** The interface as data. */
  schema: string
  project: Project
  kind: DesktopKind
}

export function tauriFiles({ html, code, schema, project, kind }: TauriInput): CompiledFile[] {
  const bundle = BUNDLES[kind]
  const info = targetInfo(kind)
  const name = slug(project.name) || 'app'
  // Reverse-DNS on every platform, including Linux. electron-builder wants
  // a bare package name there and `appIdFor` obliges it; Tauri wants the
  // identifier with dots in it everywhere, and refuses to bundle without.
  const appId = project.identifier

  const config = {
    $schema: 'https://schema.tauri.app/config/2',
    productName: project.name,
    version: project.version,
    identifier: appId,
    build: {
      // No bundler step: the interface is already three static files, so
      // the frontend is a folder rather than a dev server to wait for.
      frontendDist: '../app',
    },
    app: {
      windows: [{
        title: project.name,
        width: 1100,
        height: 760,
        resizable: true,
      }],
      security: { csp: null },
    },
    bundle: {
      active: true,
      targets: bundle.targets,
      category: 'Productivity',
      shortDescription: `${project.name}, built by the Tungsten builder.`,
    },
  }

  const packageJson = {
    name,
    productName: project.name,
    version: project.version,
    private: true,
    scripts: {
      dev: 'tauri dev',
      build: 'tauri build',
      tauri: 'tauri',
    },
    devDependencies: {
      '@tauri-apps/cli': '^2.1.0',
    },
  }

  return [
    { path: 'app/index.html', contents: html },
    { path: 'app/app.ts', contents: code },
    { path: 'app/ui.schema.json', contents: schema },
    {
      path: 'src-tauri/Cargo.toml',
      contents: `[package]
name = "${name}"
version = "${project.version}"
description = "${project.name}, built by the Tungsten builder."
edition = "2021"
rust-version = "1.77.2"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }

# A desktop app is shipped once and run many times, so the slow build is
# the right trade: one codegen unit, link-time optimisation, no symbols.
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
strip = true
`,
    },
    {
      path: 'src-tauri/tauri.conf.json',
      contents: `${JSON.stringify(config, null, 2)}\n`,
    },
    {
      path: 'src-tauri/build.rs',
      contents: `fn main() {
    tauri_build::build()
}
`,
    },
    {
      path: 'src-tauri/src/main.rs',
      contents: `// The window. Everything else is in app/.
//
// There are no commands registered here and no filesystem access granted,
// which means the generated interface runs with no more privilege than a
// web page. When your app needs something from the machine, add one
// #[tauri::command] with a narrow signature and invoke it by name -- not a
// general escape hatch.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
`,
    },
    { path: 'package.json', contents: `${JSON.stringify(packageJson, null, 2)}\n` },
    {
      path: 'README.md',
      contents: `# ${project.name} — ${info.label}

Generated by the Tungsten builder with the Tauri toolchain: the system
webview, wrapped in a small Rust process.

\`\`\`bash
npm install
npm run dev            # run it
npm run build          # ${bundle.artifact}, into src-tauri/target/release/bundle/
\`\`\`

Build host: ${bundle.host}. You also need Rust — \`rustup\` from rust-lang.org.

- \`app/\` is the interface and the program, the same files the web target
  produces. The desktop targets render with the web renderer on purpose.
- \`src-tauri/\` is the shell: one window, no commands registered, nothing
  from the machine exposed to the page.
- Icons are not generated. \`npm run tauri icon path/to/icon.png\` writes the
  set every platform wants before you ship.

This folder was written by the Tauri toolchain. Switching this target to
Electron writes a different kind of project into the same folder, so delete
it first rather than building over the top.

Application id \`${appId}\`, version ${project.version}, from the project in
the Targets panel.
`,
    },
  ]
}
