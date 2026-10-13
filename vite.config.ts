import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'NEXUS — Segundo Cérebro',
        short_name: 'NEXUS',
        description: 'Segundo Cérebro, agenda unificada e tasks multi-workspace.',
        lang: 'pt-BR',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        categories: ['productivity'],
        orientation: 'portrait',
        background_color: '#0D0D0D',
        theme_color: '#0D0D0D',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'Captura rápida', short_name: 'Capturar', url: './#/inbox', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Hoje', url: './#/hoje', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Busca', url: './#/busca', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
        share_target: {
          action: './',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
