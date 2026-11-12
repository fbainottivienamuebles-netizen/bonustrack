// Almacenamiento local de la app.
//
// - Ajustes (URL del panel y clave): localStorage, son chicos.
// - Paquetes offline: IndexedDB, persiste en el WebView de Capacitor y en el
//   navegador. Toda la app en modo show lee SOLO de acá, nunca de la red.
// - Videos de fondo (Pantalla): IndexedDB también, como archivos (Blob),
//   guardados por su URL.

import { isOfflineBundle, type OfflineBundle } from "@letras/shared";

export interface Settings {
  serverUrl: string;
  password: string;
}

const SETTINGS_KEY = "letras.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { serverUrl: "", password: "", ...JSON.parse(raw) };
  } catch {
    /* sin storage: valores por defecto */
  }
  return { serverUrl: import.meta.env.DEV ? "http://localhost:3000" : "https://bonustrack-panel.vercel.app", password: "" };
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ---------- IndexedDB ----------

const DB_NAME = "letras";
const STORE = "bundles";
const VIDEOS = "videos";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS);
    };
    req.onsuccess = () => {
      // Si otra pestaña con una versión nueva de la app necesita actualizar la
      // base, esta la suelta (y la vuelve a abrir en el próximo uso).
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
  store: string = STORE,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

export async function listBundles(): Promise<OfflineBundle[]> {
  const all = await tx<unknown[]>("readonly", (s) => s.getAll());
  return all
    .filter(isOfflineBundle)
    .sort((a, b) => a.setlist.nombre.localeCompare(b.setlist.nombre, "es"));
}

export async function getBundle(setlistId: string): Promise<OfflineBundle | null> {
  const b = await tx<unknown>("readonly", (s) => s.get(setlistId));
  return isOfflineBundle(b) ? b : null;
}

export async function putBundle(b: OfflineBundle) {
  await tx("readwrite", (s) => s.put(b, b.setlist.id));
}

export async function deleteBundle(setlistId: string) {
  await tx("readwrite", (s) => s.delete(setlistId));
}

/** Pide al sistema que no borre los datos por falta de espacio (best effort). */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

// ---------- Videos ----------

export async function getVideo(url: string): Promise<Blob | null> {
  const v = await tx<unknown>("readonly", (s) => s.get(url), VIDEOS);
  return v instanceof Blob ? v : null;
}

export async function putVideo(url: string, blob: Blob) {
  await tx("readwrite", (s) => s.put(blob, url), VIDEOS);
}

export async function listVideoUrls(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys(), VIDEOS);
  return keys.map(String);
}

export async function deleteVideo(url: string) {
  await tx("readwrite", (s) => s.delete(url), VIDEOS);
}
