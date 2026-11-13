import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /*
     * Installable app that opens without a connection. The service worker keeps a copy of the built app
     * (HTML, JS, CSS, icons) and of the Google Fonts it uses. Data never goes through it: /api and the live
     * socket always use the network; offline data lives in IndexedDB (src/offline).
     * A new version waits until the user chooses to reload (src/components/UpdatePrompt.tsx), so a deploy
     * never reloads the page in the middle of a bill.
     */
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registered from src/main.tsx: the server's CSP doesn't allow inline scripts
      includeAssets: ['favicon-32.png', 'favicon-180.png', 'favicon-192.png', 'logo.png'],
      manifest: {
        id: '/',
        name: 'AJ Rice Billing',
        short_name: 'AJ Billing',
        description: 'Billing, inventory and accounts for A.J RICE TRADERS. Works offline.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0f1e',
        theme_color: '#0a0f1e',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2,webmanifest}'],
        // the PDF/print libraries are large but needed offline for invoices
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // page loads (any screen, e.g. /#/create) get the app shell; the API and socket are never served from cache
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 10, maxAgeSeconds: 365 * 86400 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // API server (npm run dev:api) handles /api in development
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
