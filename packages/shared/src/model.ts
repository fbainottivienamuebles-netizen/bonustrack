// Modelo de datos compartido entre el panel (online) y la app móvil (offline).
// Refleja la sección 6 del spec.

export const SECTION_TYPES = [
  "intro",
  "verso",
  "preestribillo",
  "estribillo",
  "puente",
  "solo",
  "outro",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType, string> = {
  intro: "Intro",
  verso: "Verso",
  preestribillo: "Pre-estribillo",
  estribillo: "Estribillo",
  puente: "Puente",
  solo: "Solo",
  outro: "Outro",
};

export type TempoSource = "manual" | "detectadoEnVivo";

export interface Line {
  texto: string;
  /** Milisegundo (relativo al inicio del tema) en que la línea se resalta. */
  tiempoInicioMs: number;
}

export interface Section {
  tipo: SectionType;
  lineas: Line[];
}

export interface Song {
  id: string;
  titulo: string;
  artistaOriginal: string;
  duracionSegundos: number;
  bpmManual: number | null;
  fuenteTempo: TempoSource;
  videoUrl: string | null;
  videoBpmReferencia: number | null;
  secciones: Section[];
  /** ISO timestamp de la última edición, para detectar cambios en la descarga. */
  updatedAt: string;
}

export interface SongRef {
  songId: string;
}

export interface Tanda {
  nombre: string;
  temas: SongRef[];
}

export interface Setlist {
  id: string;
  nombre: string;
  tandas: Tanda[];
  updatedAt: string;
}

/** Resumen liviano para listar setlists disponibles antes de descargar. */
export interface SetlistSummary {
  id: string;
  nombre: string;
  cantidadTandas: number;
  cantidadTemas: number;
  updatedAt: string;
}

/**
 * Paquete que la app descarga antes del show. Contiene TODO lo necesario
 * para funcionar sin internet: el setlist y cada tema completo.
 */
export interface OfflineBundle {
  formatVersion: 1;
  generatedAt: string;
  setlist: Setlist;
  songs: Song[];
}

export function isOfflineBundle(x: unknown): x is OfflineBundle {
  if (!x || typeof x !== "object") return false;
  const b = x as Partial<OfflineBundle>;
  return (
    b.formatVersion === 1 &&
    !!b.setlist &&
    Array.isArray(b.setlist.tandas) &&
    Array.isArray(b.songs)
  );
}

/** Verifica que todos los temas referenciados por el setlist estén en el paquete. */
export function missingSongs(bundle: OfflineBundle): string[] {
  const ids = new Set(bundle.songs.map((s) => s.id));
  const missing: string[] = [];
  for (const t of bundle.setlist.tandas)
    for (const r of t.temas) if (!ids.has(r.songId)) missing.push(r.songId);
  return missing;
}
