import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'timex-offline',
      apply: 'build',
      generateBundle(_options, bundle) {
        const assets = [
          ...new Set([
            '/',
            '/index.html',
            '/manifest.webmanifest',
            ...Object.keys(bundle)
              .filter((name) => !name.endsWith('.map'))
              .map((name) => `/${name}`),
          ]),
        ];
        const cache = `timex-${Object.keys(bundle).sort().join('-')}`;
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('timex-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate') return (await cache.match('/index.html')) || fetch(event.request);
    return (await cache.match(event.request)) || fetch(event.request);
  }));
});`,
        });
      },
    },
  ],
  test: {
    css: { include: [/styles\.css/] },
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
