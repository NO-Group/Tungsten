import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
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
