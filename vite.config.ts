import { readFileSync } from 'node:fs'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import { tungstenShell } from './server/shellPlugin.ts'

// package.json is the only place the version is written down; the About
// dialog, the terminal banner and the installer all read it from here.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The shell plugin gives the browser build a real PTY, the way the
  // desktop build gets one from Electron. Dev and preview only.
  plugins: [react(), tungstenShell()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('monaco-editor')) return 'editor-core'
          if (id.includes('@xterm/')) return 'terminal-core'
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor'
          return undefined
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  test: {
    // Most suites are pure logic and run fastest in Node. The theme service
    // writes CSS custom properties onto elements, so those files opt into jsdom
    // via a `@vitest-environment jsdom` docblock.
    environment: 'node',
  },
})
