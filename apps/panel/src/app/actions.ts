"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CLICK_SOUNDS, clampBars, isValidCompas, parseLyrics, type ClickSound } from "@letras/shared";
import { deleteStoredVideo } from "@/lib/videos";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  isValidPassword,
  sessionToken,
} from "@/lib/auth-token";
import { requireSession } from "@/lib/session";
import {
  deleteSetlist,
  deleteSong,
  duplicateSetlist,
  getSong,
  saveSetlist,
  saveSong,
  type SetlistInput,
} from "@/lib/data";

export interface FormState {
  error?: string;
}

function safeFrom(from: FormDataEntryValue | null): string {
  const s = typeof from === "string" ? from : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/temas";
}

// ---------- Sesión ----------

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const pass = String(form.get("password") ?? "");
  if (!(await isValidPassword(pass))) return { error: "Clave incorrecta" };
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeFrom(form.get("from")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Temas ----------

/** "3:45", "03:45" o segundos sueltos ("225"). */
function parseDuration(raw: string): number | null {
  const t = raw.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

function optInt(raw: FormDataEntryValue | null, min: number, max: number): number | null | "error" {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= min && n <= max ? n : "error";
}

export async function saveSongAction(_: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const id = String(form.get("id") ?? "") || null;
  const titulo = String(form.get("titulo") ?? "").trim();
  const artistaOriginal = String(form.get("artistaOriginal") ?? "").trim();
  const duracionSegundos = parseDuration(String(form.get("duracion") ?? ""));
  const bpmManual = optInt(form.get("bpmManual"), 30, 300);
  const videoBpmReferencia = optInt(form.get("videoBpmReferencia"), 30, 300);
  const videoUrl = String(form.get("videoUrl") ?? "").trim() || null;
  const referenciaUrl = String(form.get("referenciaUrl") ?? "").trim() || null;
  const compas = String(form.get("compas") ?? "4/4").trim().replace(/\s+/g, "");
  const compasesCuenta = optInt(form.get("compasesCuenta"), 1, 4);
  const sonidoRaw = String(form.get("sonidoClic") ?? "madera");
  const sonidoClic: ClickSound = (CLICK_SOUNDS as readonly string[]).includes(sonidoRaw)
    ? (sonidoRaw as ClickSound)
    : "madera";

  if (!titulo) return { error: "Falta el título" };
  if (!artistaOriginal) return { error: "Falta el artista original" };
  if (!duracionSegundos) return { error: "Duración inválida (usá mm:ss)" };
  if (bpmManual === "error") return { error: "BPM inválido (30–300)" };
  if (videoBpmReferencia === "error") return { error: "BPM del video inválido (30–300)" };
  if (videoUrl && !/^https:\/\//i.test(videoUrl)) return { error: "La URL del video debe empezar con https://" };
  if (referenciaUrl && !/^https?:\/\//i.test(referenciaUrl))
    return { error: "El link de referencia debe empezar con http(s)://" };
  if (!isValidCompas(compas)) return { error: "Compás inválido (ej. 4/4, 3/4, 6/8)" };
  if (compasesCuenta === "error") return { error: "Compases de cuenta previa: de 1 a 4" };

  const { secciones, errores } = parseLyrics(String(form.get("letra") ?? ""), duracionSegundos);
  if (errores.length) return { error: errores.join("\n") };

  const before = id ? await getSong(id) : null;
  const savedId = await saveSong(id, {
    titulo,
    artistaOriginal,
    duracionSegundos,
    bpmManual,
    compas,
    compasesCuenta: clampBars(compasesCuenta ?? 2),
    sonidoClic,
    videoUrl,
    videoBpmReferencia,
    referenciaUrl,
    secciones,
  });
  // Si se cambió o se sacó el video, se borra el anterior del almacenamiento.
  if (before?.videoUrl && before.videoUrl !== videoUrl) await deleteStoredVideo(before.videoUrl);
  revalidatePath("/temas");
  revalidatePath("/setlists");
  redirect(id ? "/temas" : `/temas/${savedId}`);
}

export async function deleteSongAction(_: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const { ok, videoUrl } = await deleteSong(String(form.get("id")));
  if (ok && videoUrl) await deleteStoredVideo(videoUrl);
  if (!ok) return { error: "Este tema está en un setlist. Sacalo de ahí antes de borrarlo." };
  revalidatePath("/temas");
  redirect("/temas");
}

// ---------- Setlists ----------

function parseSetlistPayload(raw: string): SetlistInput | null {
  try {
    const v = JSON.parse(raw) as SetlistInput;
    if (typeof v?.nombre !== "string" || !Array.isArray(v.tandas)) return null;
    for (const t of v.tandas)
      if (typeof t?.nombre !== "string" || !Array.isArray(t.temas) || t.temas.some((s) => typeof s !== "string"))
        return null;
    return v;
  } catch {
    return null;
  }
}

export async function saveSetlistAction(_: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const id = String(form.get("id") ?? "") || null;
  const input = parseSetlistPayload(String(form.get("payload") ?? ""));
  if (!input) return { error: "Datos inválidos" };
  input.nombre = input.nombre.trim();
  if (!input.nombre) return { error: "Falta el nombre del setlist" };
  input.tandas = input.tandas.map((t, i) => ({ ...t, nombre: t.nombre.trim() || `Tanda ${i + 1}` }));

  try {
    await saveSetlist(id, input);
  } catch {
    return { error: "No se pudo guardar (¿algún tema fue borrado?). Recargá la página." };
  }
  revalidatePath("/setlists");
  revalidatePath("/temas");
  redirect("/setlists");
}

export async function duplicateSetlistAction(form: FormData) {
  await requireSession();
  const newId = await duplicateSetlist(String(form.get("id")));
  revalidatePath("/setlists");
  redirect(newId ? `/setlists/${newId}` : "/setlists");
}

export async function deleteSetlistAction(form: FormData) {
  await requireSession();
  await deleteSetlist(String(form.get("id")));
  revalidatePath("/setlists");
  revalidatePath("/temas");
  redirect("/setlists");
}

// ---------- Tiempos (marcados con la grabación) ----------

export interface SaveTimesResult {
  ok?: boolean;
  error?: string;
}

/**
 * Guarda los tiempos de todas las líneas (en orden, lista aplanada) y,
 * opcionalmente, la duración tomada de la grabación.
 */
export async function saveTimesAction(
  songId: string,
  tiempos: number[],
  duracionSegundos: number | null,
): Promise<SaveTimesResult> {
  await requireSession();
  const song = await getSong(songId);
  if (!song) return { error: "El tema ya no existe" };

  const total = song.secciones.reduce((n, s) => n + s.lineas.length, 0);
  if (!Array.isArray(tiempos) || tiempos.length !== total)
    return { error: "La letra cambió mientras marcabas. Recargá la página." };
  if (tiempos.some((t) => !Number.isFinite(t) || t < 0))
    return { error: "Hay tiempos inválidos" };
  for (let i = 1; i < tiempos.length; i++)
    if (tiempos[i] < tiempos[i - 1]) return { error: `La línea ${i + 1} quedó antes que la anterior` };

  let k = 0;
  const secciones = song.secciones.map((s) => ({
    tipo: s.tipo,
    lineas: s.lineas.map((l) => ({ texto: l.texto, tiempoInicioMs: Math.round(tiempos[k++]) })),
  }));
  const dur =
    duracionSegundos && Number.isInteger(duracionSegundos) && duracionSegundos > 0
      ? duracionSegundos
      : song.duracionSegundos;

  await saveSong(songId, {
    titulo: song.titulo,
    artistaOriginal: song.artistaOriginal,
    duracionSegundos: dur,
    bpmManual: song.bpmManual,
    compas: song.compas,
    compasesCuenta: song.compasesCuenta,
    sonidoClic: song.sonidoClic,
    videoUrl: song.videoUrl,
    videoBpmReferencia: song.videoBpmReferencia,
    referenciaUrl: song.referenciaUrl,
    secciones,
  });
  revalidatePath("/temas");
  revalidatePath(`/temas/${songId}`);
  return { ok: true };
}
