"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseLyrics } from "@letras/shared";
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

  if (!titulo) return { error: "Falta el título" };
  if (!artistaOriginal) return { error: "Falta el artista original" };
  if (!duracionSegundos) return { error: "Duración inválida (usá mm:ss)" };
  if (bpmManual === "error") return { error: "BPM inválido (30–300)" };
  if (videoBpmReferencia === "error") return { error: "BPM del video inválido (30–300)" };
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) return { error: "La URL del video debe empezar con http(s)://" };

  const { secciones, errores } = parseLyrics(String(form.get("letra") ?? ""), duracionSegundos);
  if (errores.length) return { error: errores.join("\n") };

  const savedId = await saveSong(id, {
    titulo,
    artistaOriginal,
    duracionSegundos,
    bpmManual,
    videoUrl,
    videoBpmReferencia,
    secciones,
  });
  revalidatePath("/temas");
  revalidatePath("/setlists");
  redirect(id ? "/temas" : `/temas/${savedId}`);
}

export async function deleteSongAction(_: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const ok = await deleteSong(String(form.get("id")));
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

export async function deleteSetlistAction(form: FormData) {
  await requireSession();
  await deleteSetlist(String(form.get("id")));
  revalidatePath("/setlists");
  revalidatePath("/temas");
  redirect("/setlists");
}
