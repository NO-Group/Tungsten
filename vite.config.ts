import { defineConfig } from 'vite'
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
})
