import "server-only";
import { isAuthorizedRequest } from "./auth-token";

// La app móvil corre en otro origen (Vite / WebView), así que la API
// responde CORS. La protección real es el Bearer token, no el origen.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Devuelve una respuesta 401 si el request no trae la clave correcta. */
export async function requireApiAuth(req: Request): Promise<Response | null> {
  return (await isAuthorizedRequest(req)) ? null : json({ error: "No autorizado" }, 401);
}
