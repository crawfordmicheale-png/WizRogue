// Offline support. Network-first with a cache fallback: players online always
// get the latest build, players in a tunnel keep descending.
const VERSION = 'wizrogue-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './src/main.js',
  './src/config.js',
  './src/settings.js',
  './src/util/rng.js',
  './src/world/mapgen.js',
  './src/render/textures.js',
  './src/render/raycaster.js',
  './src/game/game.js',
  './src/game/player.js',
  './src/game/enemies.js',
  './src/game/spells.js',
  './src/game/archetypes.js',
  './src/game/rewards.js',
  './src/ui/input.js',
  './src/ui/touch.js',
  './src/ui/audio.js',
  './src/ui/haptics.js',
  './src/ui/hud.js',
  './src/ui/menus.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
