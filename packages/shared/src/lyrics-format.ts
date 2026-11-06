// Formato de texto para cargar/editar la letra en el panel.
//
//   [intro]
//   [verso]
//   00:12.50 I call you when I need you
//   [00:16.00] my heart's on fire       <- también acepta estilo LRC
//   [estribillo]
//   You're simply the best               <- sin tiempo: se interpola
//
// - Un encabezado entre corchetes con un tipo de sección abre una sección.
// - Cada línea puede empezar con un tiempo mm:ss(.cc). Las que no tienen tiempo
//   se reparten de forma pareja entre la anterior y la siguiente con tiempo
//   (o hasta la duración del tema), así se "precargan" tiempos.

import { SECTION_TYPES, type Section, type SectionType } from "./model";

const TIME_RE = /^\[?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*/;
const HEADER_RE = /^\[([a-záéíóúñ\- ]+)\]$/i;

const ALIASES: Record<string, SectionType> = {
  "pre-estribillo": "preestribillo",
  "pre estribillo": "preestribillo",
  coro: "estribillo",
  chorus: "estribillo",
  verse: "verso",
  bridge: "puente",
  "pre-chorus": "preestribillo",
};

export function parseSectionType(raw: string): SectionType | null {
  const k = raw.trim().toLowerCase();
  if ((SECTION_TYPES as readonly string[]).includes(k)) return k as SectionType;
  return ALIASES[k] ?? null;
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function parseTime(raw: string): number | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  const frac = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + frac;
}

export interface ParseResult {
  secciones: Section[];
  errores: string[];
  /** Cantidad de líneas cuyo tiempo fue interpolado (no cargado a mano). */
  interpoladas: number;
}

interface DraftLine {
  texto: string;
  ms: number | null;
}

export function parseLyrics(text: string, duracionSegundos: number): ParseResult {
  const errores: string[] = [];
  const drafts: { tipo: SectionType; lineas: DraftLine[] }[] = [];

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;

    const header = HEADER_RE.exec(line);
    if (header && parseTime(line) === null) {
      const tipo = parseSectionType(header[1]);
      if (!tipo) {
        errores.push(`Línea ${i + 1}: sección desconocida "${header[1]}"`);
        return;
      }
      drafts.push({ tipo, lineas: [] });
      return;
    }

    const tm = TIME_RE.exec(line);
    const ms = tm ? parseTime(line) : null;
    const texto = tm ? line.slice(tm[0].length).trim() : line;
    if (!texto) {
      errores.push(`Línea ${i + 1}: tiempo sin texto`);
      return;
    }
    if (drafts.length === 0) drafts.push({ tipo: "verso", lineas: [] });
    drafts[drafts.length - 1].lineas.push({ texto, ms });
  });

  // Interpolar tiempos faltantes sobre la lista aplanada.
  const flat = drafts.flatMap((d) => d.lineas);
  const endMs = Math.max(duracionSegundos * 1000, 1000);
  let interpoladas = 0;
  let i = 0;
  while (i < flat.length) {
    if (flat[i].ms !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < flat.length && flat[j].ms === null) j++;
    const prev = i > 0 ? (flat[i - 1].ms as number) : 0;
    const next = j < flat.length ? (flat[j].ms as number) : endMs;
    // Si no hay tiempo previo, la primera línea arranca en 0; si no, repartimos
    // los huecos entre prev y next sin pisar ninguno de los dos extremos.
    const slots = i > 0 ? j - i + 1 : j - i;
    const step = Math.max(0, (next - prev) / Math.max(slots, 1));
    for (let k = i; k < j; k++) {
      const n = i > 0 ? k - i + 1 : k - i;
      flat[k].ms = Math.round(prev + step * n);
      interpoladas++;
    }
    i = j;
  }

  for (let k = 1; k < flat.length; k++) {
    if ((flat[k].ms as number) < (flat[k - 1].ms as number)) {
      errores.push(
        `"${flat[k].texto}" (${formatTime(flat[k].ms as number)}) está antes que la línea anterior`,
      );
    }
  }

  return {
    secciones: drafts.map((d) => ({
      tipo: d.tipo,
      lineas: d.lineas.map((l) => ({ texto: l.texto, tiempoInicioMs: l.ms as number })),
    })),
    errores,
    interpoladas,
  };
}

export function serializeLyrics(secciones: Section[]): string {
  const out: string[] = [];
  for (const s of secciones) {
    if (out.length) out.push("");
    out.push(`[${s.tipo}]`);
    for (const l of s.lineas) out.push(`${formatTime(l.tiempoInicioMs)} ${l.texto}`);
  }
  return out.join("\n");
}
