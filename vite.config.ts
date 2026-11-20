import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import pkg from './package.json';
import { precachePlugin } from './src/pwa/precache';

// The seller's yönetim page goes only into the web deploys, which ask for it with RK_YONETIM=1
// (vercel.json, and the release's GitHub Pages build). The desktop and Android apps, built with a
// plain `vite build`, never carry it.
const withYonetim = process.env.RK_YONETIM === '1';

/** Without the yönetim page, its redirect page (public/yonetim/) has nothing to send anyone to. */
function dropYonetimRedirect(): Plugin {
  let outDir = 'dist';
  return {
    name: 'restoran-kasa-drop-yonetim-redirect',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, 'yonetim'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the Electron build can load dist/ over file://
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    precachePlugin(),
    ...(withYonetim ? [] : [dropYonetimRedirect()]),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      // The app, and the guests' QR menu as a page of its own: dist/menu.html loads only its
      // small bundle and never opens the register's data, pairing or service worker. The
      // seller's yönetim page (dist/yonetim.html) is a third, as apart from the registers, and
      // only in the web deploys.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        menu: fileURLToPath(new URL('./menu.html', import.meta.url)),
        ...(withYonetim
          ? { yonetim: fileURLToPath(new URL('./yonetim.html', import.meta.url)) }
          : {}),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          // A local .env.local must not change what the tests see: no server unless a test says so.
          env: {
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_PUBLISHABLE_KEY: '',
            VITE_SUPPORT_WHATSAPP: '',
          },
          // Screen tests that pass alone in a second can pass 5 s when every worker is busy.
          testTimeout: 15_000,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
        },
      },
      // The server's SQL runs on PGlite in Node, without the browser setup.
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['supabase/tests/**/*.test.ts'] },
      },
    ],
  },
});
