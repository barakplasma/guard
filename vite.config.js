import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base` is relative by default so the built `dist/` also works when opened
// straight off disk or served from an arbitrary sub-path. CI sets BASE_PATH
// (e.g. "/guard/") for the GitHub Pages project URL.
const base = process.env.BASE_PATH || './';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      // The whole app is static and every computation runs client-side, so
      // precaching the build output is all that offline support needs - there
      // is no API to fall back to.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'מתכנן משמרות',
        short_name: 'משמרות',
        description: 'תכנון וחלוקת משמרות בין עובדים, ללא שרת',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        start_url: './',
        scope: './',
        background_color: '#14170F',
        theme_color: '#7C8F4A',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
