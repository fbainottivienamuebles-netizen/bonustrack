// Cliente de la API del panel. Sólo se usa para descargar antes del show.

import {
  isOfflineBundle,
  missingSongs,
  type OfflineBundle,
  type SetlistSummary,
} from "@letras/shared";
import type { Settings } from "./storage";

export class ApiError extends Error {}

function baseUrl(s: Settings): string {
  const u = s.serverUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) throw new ApiError("Configurá la URL del panel en Ajustes");
  return u;
}

async function get(s: Settings, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(baseUrl(s) + path, {
      headers: { Authorization: `Bearer ${s.password}` },
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("No se pudo conectar con el panel. ¿Hay internet y la URL es correcta?");
  }
  if (res.status === 401) throw new ApiError("Clave incorrecta");
  if (res.status === 404) throw new ApiError("El setlist ya no existe en el panel");
  if (!res.ok) throw new ApiError(`El panel respondió ${res.status}`);
  return res.json();
}

export async function fetchSetlists(s: Settings): Promise<SetlistSummary[]> {
  const data = await get(s, "/api/setlists");
  if (!Array.isArray(data)) throw new ApiError("Respuesta inesperada del panel");
  return data as SetlistSummary[];
}

export async function fetchBundle(s: Settings, setlistId: string): Promise<OfflineBundle> {
  const data = await get(s, `/api/setlists/${encodeURIComponent(setlistId)}/bundle`);
  if (!isOfflineBundle(data)) throw new ApiError("El paquete descargado es inválido");
  const missing = missingSongs(data);
  if (missing.length) throw new ApiError(`Faltan ${missing.length} temas en el paquete`);
  return data;
}

export async function testConnection(s: Settings): Promise<number> {
  return (await fetchSetlists(s)).length;
}
