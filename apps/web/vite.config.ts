import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MuniChat',
        short_name: 'MuniChat',
        description: 'Real-time municipal chat platform — Prefeitura Municipal de Nova Serrana',
        theme_color: '#171717',
        background_color: '#171717',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Precache only the built app shell (JS/CSS/fonts/static images).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // Deliberately no runtimeCaching entries for the API: every request
        // is authenticated and can carry per-user data, so it must always
        // hit the network rather than ever being cached (and reused across
        // sessions/users) or serving stale message history. WebSocket
        // connections aren't `fetch` events, so the service worker can't
        // intercept them either way.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  envDir: '../../',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['@munichat/shared'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
