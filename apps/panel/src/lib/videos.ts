import "server-only";
import { del } from "@vercel/blob";

/** ¿Está configurado el almacenamiento de videos (Vercel Blob)? */
export function videoStorageReady(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Los videos subidos desde el panel viven en Vercel Blob. */
export function isStoredVideo(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Borra un video subido desde el panel (si es un link externo, no hace nada). */
export async function deleteStoredVideo(url: string) {
  if (!isStoredVideo(url) || !videoStorageReady()) return;
  try {
    await del(url);
  } catch (e) {
    console.error("No se pudo borrar el video", url, e);
  }
}
