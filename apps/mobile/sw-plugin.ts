// Plugin de Vite que genera /sw.js con la lista de archivos del build.
//
// El service worker guarda TODA la app en el dispositivo al instalarse, así
// abre sin internet. Los datos (setlists) ya viven en IndexedDB. Cada build
// cambia la versión del cache, y la app nueva se activa en la próxima apertura.

import type { Plugin } from "vite";

export function serviceWorker(): Plugin {
  return {
    name: "letras-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).map((f) => "/" + f);
      const precache = [
        "/",
        "/manifest.webmanifest",
        "/icon-192.png",
        "/icon-512.png",
        "/apple-touch-icon.png",
        "/favicon-48.png",
        ...files.filter((f) => f !== "/index.html"),
      ];
      const version = Date.now().toString(36);
      this.emitFile({ type: "asset", fileName: "sw.js", source: swSource(version, precache) });
    },
  };
}

function swSource(version: string, precache: string[]) {
  return `// Generado por sw-plugin.ts
const CACHE = "letras-${version}";
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Sólo la app propia; la API del panel (otro dominio) va siempre a la red.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Página: red primero (para tomar versiones nuevas), y si no hay red, la guardada.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // Archivos (JS/CSS/íconos con hash): cache primero.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`;
}
