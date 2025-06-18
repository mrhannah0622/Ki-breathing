import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      manifest: '/manifest.webmanifest',
      injectRegister: 'auto',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: ({request}) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache'
            },
          },
          {
            urlPattern: ({ request }) =>
              ['style', 'script', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'asset-cache'
            }
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'image' || request.destination === 'audio',
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache'
            }
          }
        ],
        // ✅ オフライン時に fallback ページを返す
        navigateFallback: '/offline.html'
      },
      devOptions: {
        enabled: true
      }
    })
  ]
});