import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const isDev = process.env.NODE_ENV !== "production";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "hyoushigi.mp3"],
      manifest: {
        name: "氣の呼吸法",
        short_name: "呼吸法",
        start_url: ".",
        display: "standalone",
        theme_color: "#d1f2eb",
        background_color: "#ffffff",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: isDev ? {
        // 開発時は globPatterns 指定を避けてワーニングを抑える
        navigateFallback: "/offline.html",
        runtimeCaching: [
          {
            urlPattern: /\.(mp3)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-cache",
              expiration: { maxEntries: 10 },
            },
          },
        ]
      } : {
        globPatterns: ["**/*.{js,css,html,png,svg,mp3}"],
        navigateFallback: "/offline.html",
        runtimeCaching: [
          {
            urlPattern: /\.(mp3)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-cache",
              expiration: { maxEntries: 10 },
            },
          },
        ],
      },
      devOptions: { enabled: true }
    })
  ]
});
