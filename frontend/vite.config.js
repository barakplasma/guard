import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

// Builds straight into pb_public/, the static dir PocketBase serves. Relative
// base (no History API routing is used - see src/App.jsx) so the bundle works
// whether PocketBase is reached via localhost, a forwarded port, or a hotspot IP.
// tests.html is a second entry point so the scheduler test suite can run on the
// phone with zero tooling (open pb_public/tests.html in a browser).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../pb_public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tests: resolve(__dirname, 'tests.html'),
      },
    },
  },
})
