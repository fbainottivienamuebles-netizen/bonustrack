// Videos de fondo de la Pantalla, guardados en el equipo para el show.
//
// Se bajan junto con el setlist (con internet) y quedan en IndexedDB. Si el
// equipo sigue al director por WiFi, el director también los guarda en la
// notebook y los sirve en la red local (/api/local/video), así una Pantalla
// nueva los puede bajar ahí mismo, sin internet.

import { useEffect, useState } from "react";
import type { OfflineBundle } from "@letras/shared";
import { deleteVideo, getVideo, listBundles, listVideoUrls, putVideo } from "./storage";

export function bundleVideoUrls(bundle: OfflineBundle): string[] {
  return [...new Set(bundle.songs.map((s) => s.videoUrl).filter((u): u is string => !!u))];
}

/** Dirección del video a través del director (red local). */
export function viaDirector(base: string, url: string): string {
  return `${base.replace(/\/+$/, "")}/api/local/video?u=${encodeURIComponent(url)}`;
}

export interface VideoSaveResult {
  total: number;
  saved: number;
  failed: number;
}

/**
 * Guarda en el equipo los videos del setlist que todavía no estén.
 * `director`: si hay, se prueban primero por ahí (y así el director también
 * se los guarda); si no responde, directo de internet.
 */
export async function saveBundleVideos(
  bundle: OfflineBundle,
  opts: { director?: string | null; onProgress?: (done: number, total: number) => void } = {},
): Promise<VideoSaveResult> {
  const urls = bundleVideoUrls(bundle);
  const have = new Set(await listVideoUrls().catch(() => []));
  let saved = 0;
  let failed = 0;
  let done = 0;
  opts.onProgress?.(0, urls.length);
  for (const url of urls) {
    if (have.has(url)) saved++;
    else {
      const blob = await fetchVideo(url, opts.director ?? null);
      if (blob) {
        await putVideo(url, blob);
        saved++;
      } else failed++;
    }
    opts.onProgress?.(++done, urls.length);
  }
  return { total: urls.length, saved, failed };
}

async function fetchVideo(url: string, director: string | null): Promise<Blob | null> {
  const sources = director ? [viaDirector(director, url), url] : [url];
  for (const src of sources) {
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size > 0 && (blob.type.startsWith("video/") || blob.type === "application/octet-stream" || !blob.type))
        return blob;
    } catch {
      /* sin red o bloqueado: probar la siguiente */
    }
  }
  return null;
}

/** Cuántos videos del setlist ya están en el equipo. */
export async function videoStatus(bundle: OfflineBundle): Promise<{ total: number; saved: number }> {
  const urls = bundleVideoUrls(bundle);
  const have = new Set(await listVideoUrls().catch(() => []));
  return { total: urls.length, saved: urls.filter((u) => have.has(u)).length };
}

/** Borra los videos que ya no usa ningún setlist guardado. */
export async function pruneVideos() {
  const used = new Set((await listBundles()).flatMap(bundleVideoUrls));
  for (const url of await listVideoUrls()) if (!used.has(url)) await deleteVideo(url);
}

/**
 * Fuente para el <video>: el archivo guardado en el equipo; si no está, el
 * del director (red local); si tampoco, directo de internet.
 */
export function useVideoSrc(url: string | null, director: string | null): string | null {
  const [src, setSrc] = useState<{ url: string; src: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    getVideo(url)
      .catch(() => null)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setSrc({ url, src: objectUrl });
        } else setSrc({ url, src: director ? viaDirector(director, url) : url });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, director]);
  return url && src?.url === url ? src.src : null;
}
