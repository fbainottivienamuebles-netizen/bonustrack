// Autenticación con una única clave (PANEL_PASSWORD).
//
// - Panel web: la cookie guarda un HMAC derivado de la clave, nunca la clave.
//   Cambiar PANEL_PASSWORD invalida todas las sesiones.
// - App móvil: manda la clave en `Authorization: Bearer <clave>`.
//
// Usa sólo Web Crypto para funcionar igual en proxy y en rutas.

export const SESSION_COOKIE = "panel_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const enc = new TextEncoder();

function password(): string {
  const p = process.env.PANEL_PASSWORD;
  if (!p) throw new Error("Falta PANEL_PASSWORD en el entorno");
  return p;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante (comparando HMACs de ambos lados). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const salt = "cmp";
  const [ha, hb] = await Promise.all([hmacHex(salt, a), hmacHex(salt, b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function sessionToken(): Promise<string> {
  return hmacHex(password(), "panel-session-v1");
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return safeEqual(token, await sessionToken());
}

export function isValidPassword(candidate: string): Promise<boolean> {
  return safeEqual(candidate, password());
}

/** Para la API de la app: valida `Authorization: Bearer <clave>`. */
export async function isAuthorizedRequest(req: Request): Promise<boolean> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return !!m && isValidPassword(m[1]);
}
