// Línea de tiempo del tema y reloj de reproducción.
//
// El reloj es la pieza central de la sincronía: en la fase 2 el Controlador
// transmite exactamente este estado por BLE y cada Seguidor calcula la
// posición localmente, así un corte breve no congela la letra.

import type { Section, SectionType, Song } from "./model";

export interface TimelineLine {
  /** Índice global (aplanado) de la línea dentro del tema. */
  index: number;
  sectionIndex: number;
  sectionType: SectionType;
  /** true en la primera línea de cada sección. */
  sectionStart: boolean;
  texto: string;
  tiempoInicioMs: number;
}

export function buildTimeline(secciones: Section[]): TimelineLine[] {
  const out: TimelineLine[] = [];
  secciones.forEach((s, si) =>
    s.lineas.forEach((l, li) =>
      out.push({
        index: out.length,
        sectionIndex: si,
        sectionType: s.tipo,
        sectionStart: li === 0,
        texto: l.texto,
        tiempoInicioMs: l.tiempoInicioMs,
      }),
    ),
  );
  return out;
}

/** Índice de la línea activa para una posición dada; -1 si todavía no empezó. */
export function lineAt(timeline: TimelineLine[], positionMs: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].tiempoInicioMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export type PlayStatus = "stopped" | "playing" | "paused";

/**
 * Estado del reloj. La posición se calcula como
 *   anchorPositionMs + (ahora - anchorWallMs) * rate   (si está en play)
 * `rate` = tempo real / tempo de referencia (1 = tempo cargado).
 */
export interface PlaybackClock {
  status: PlayStatus;
  anchorPositionMs: number;
  anchorWallMs: number;
  rate: number;
}

export const STOPPED_CLOCK: PlaybackClock = {
  status: "stopped",
  anchorPositionMs: 0,
  anchorWallMs: 0,
  rate: 1,
};

export function clockPosition(c: PlaybackClock, nowMs: number): number {
  if (c.status !== "playing") return c.anchorPositionMs;
  return Math.max(0, c.anchorPositionMs + (nowMs - c.anchorWallMs) * c.rate);
}

export function clockPlay(c: PlaybackClock, nowMs: number): PlaybackClock {
  if (c.status === "playing") return c;
  return { ...c, status: "playing", anchorWallMs: nowMs };
}

export function clockPause(c: PlaybackClock, nowMs: number): PlaybackClock {
  if (c.status !== "playing") return c;
  return { ...c, status: "paused", anchorPositionMs: clockPosition(c, nowMs), anchorWallMs: nowMs };
}

export function clockSeek(c: PlaybackClock, positionMs: number, nowMs: number): PlaybackClock {
  return { ...c, anchorPositionMs: Math.max(0, positionMs), anchorWallMs: nowMs };
}

/** Cambia el tempo sin salto: re-ancla en la posición actual. */
export function clockSetRate(c: PlaybackClock, rate: number, nowMs: number): PlaybackClock {
  return { ...c, anchorPositionMs: clockPosition(c, nowMs), anchorWallMs: nowMs, rate };
}

/** Lista plana de temas del setlist con su tanda, para navegar anterior/siguiente. */
export interface PlaylistEntry {
  tandaIndex: number;
  tandaNombre: string;
  songId: string;
  /** Posición dentro de la tanda (0-based). */
  position: number;
}

export function flattenSetlist(tandas: { nombre: string; temas: { songId: string }[] }[]): PlaylistEntry[] {
  return tandas.flatMap((t, ti) =>
    t.temas.map((r, p) => ({ tandaIndex: ti, tandaNombre: t.nombre, songId: r.songId, position: p })),
  );
}

export function songDurationMs(song: Pick<Song, "duracionSegundos">): number {
  return song.duracionSegundos * 1000;
}
