import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '^/s/[^/]+$': { target: 'http://localhost:3001', rewrite: (path) => path },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        not_found: resolve(__dirname, '404.html'),
        // Existing pages (keep for backward compatibility)
        embed: resolve(__dirname, 'embed.html'),
        models: resolve(__dirname, 'models.html'),
        // Share link landing page
        play: resolve(__dirname, 'play.html'),
        // Compatibility redirect for existing V2 links.
        v2: resolve(__dirname, 'v2.html'),
        // SEO landing pages
        gameboy_maker: resolve(__dirname, 'gameboy-music-maker.html'),
        midi_to_8_bit: resolve(__dirname, 'midi-to-8-bit.html'),
        synth_online: resolve(__dirname, '8-bit-synth-online.html'),
        wario_8_bit: resolve(__dirname, 'wario-8-bit-music.html'),
        // Note: internal test/diagnostic pages (ux-test, v2-test,
        // v2-diagnostic) stay out of the production build. The .html files
        // remain in the repo for local development; add them back to ship.
      },
    },
  },
})