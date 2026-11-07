import "server-only";
import type {
  OfflineBundle,
  Section,
  Setlist,
  SetlistSummary,
  Song,
} from "@letras/shared";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

const songInclude = {
  secciones: {
    orderBy: { orden: "asc" },
    include: { lineas: { orderBy: { orden: "asc" } } },
  },
} as const;

type SongRow = Prisma.SongGetPayload<{ include: typeof songInclude }>;

function toSong(r: SongRow): Song {
  return {
    id: r.id,
    titulo: r.titulo,
    artistaOriginal: r.artistaOriginal,
    duracionSegundos: r.duracionSegundos,
    bpmManual: r.bpmManual,
    fuenteTempo: r.fuenteTempo,
    videoUrl: r.videoUrl,
    videoBpmReferencia: r.videoBpmReferencia,
    secciones: r.secciones.map((s) => ({
      tipo: s.tipo,
      lineas: s.lineas.map((l) => ({ texto: l.texto, tiempoInicioMs: l.tiempoInicioMs })),
    })),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------- Temas ----------

export async function listSongs() {
  const rows = await db.song.findMany({
    orderBy: [{ titulo: "asc" }],
    select: {
      id: true,
      titulo: true,
      artistaOriginal: true,
      duracionSegundos: true,
      bpmManual: true,
      _count: { select: { tandaSongs: true } },
      secciones: { select: { _count: { select: { lineas: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    artistaOriginal: r.artistaOriginal,
    duracionSegundos: r.duracionSegundos,
    bpmManual: r.bpmManual,
    enSetlists: r._count.tandaSongs,
    lineas: r.secciones.reduce((n, s) => n + s._count.lineas, 0),
  }));
}

export async function getSong(id: string): Promise<Song | null> {
  const r = await db.song.findUnique({ where: { id }, include: songInclude });
  return r ? toSong(r) : null;
}

export interface SongInput {
  titulo: string;
  artistaOriginal: string;
  duracionSegundos: number;
  bpmManual: number | null;
  videoUrl: string | null;
  videoBpmReferencia: number | null;
  secciones: Section[];
}

function sectionsCreate(secciones: Section[]) {
  return secciones.map((s, si) => ({
    orden: si,
    tipo: s.tipo,
    lineas: {
      create: s.lineas.map((l, li) => ({
        orden: li,
        texto: l.texto,
        tiempoInicioMs: l.tiempoInicioMs,
      })),
    },
  }));
}

/** Crea o reemplaza un tema completo (la letra se reescribe entera). */
export async function saveSong(id: string | null, input: SongInput): Promise<string> {
  const { secciones, ...fields } = input;
  if (!id) {
    const s = await db.song.create({
      data: { ...fields, secciones: { create: sectionsCreate(secciones) } },
      select: { id: true },
    });
    return s.id;
  }
  await db.$transaction([
    db.section.deleteMany({ where: { songId: id } }),
    db.song.update({
      where: { id },
      data: { ...fields, secciones: { create: sectionsCreate(secciones) } },
    }),
  ]);
  return id;
}

/** Devuelve false si el tema está en algún setlist (no se puede borrar). */
export async function deleteSong(id: string): Promise<boolean> {
  const used = await db.tandaSong.count({ where: { songId: id } });
  if (used > 0) return false;
  await db.song.delete({ where: { id } });
  return true;
}

// ---------- Setlists ----------

const setlistInclude = {
  tandas: {
    orderBy: { orden: "asc" },
    include: { temas: { orderBy: { orden: "asc" }, select: { songId: true } } },
  },
} as const;

export async function listSetlists(): Promise<SetlistSummary[]> {
  const rows = await db.setlist.findMany({
    orderBy: { updatedAt: "desc" },
    include: { tandas: { select: { _count: { select: { temas: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    cantidadTandas: r.tandas.length,
    cantidadTemas: r.tandas.reduce((n, t) => n + t._count.temas, 0),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getSetlist(id: string): Promise<Setlist | null> {
  const r = await db.setlist.findUnique({ where: { id }, include: setlistInclude });
  if (!r) return null;
  return {
    id: r.id,
    nombre: r.nombre,
    tandas: r.tandas.map((t) => ({ nombre: t.nombre, temas: t.temas })),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface SetlistInput {
  nombre: string;
  tandas: { nombre: string; temas: string[] }[];
}

function tandasCreate(tandas: SetlistInput["tandas"]) {
  return tandas.map((t, ti) => ({
    orden: ti,
    nombre: t.nombre,
    temas: { create: t.temas.map((songId, i) => ({ orden: i, songId })) },
  }));
}

export async function saveSetlist(id: string | null, input: SetlistInput): Promise<string> {
  if (!id) {
    const s = await db.setlist.create({
      data: { nombre: input.nombre, tandas: { create: tandasCreate(input.tandas) } },
      select: { id: true },
    });
    return s.id;
  }
  await db.$transaction([
    db.tanda.deleteMany({ where: { setlistId: id } }),
    db.setlist.update({
      where: { id },
      data: { nombre: input.nombre, tandas: { create: tandasCreate(input.tandas) } },
    }),
  ]);
  return id;
}

export async function deleteSetlist(id: string) {
  await db.setlist.delete({ where: { id } });
}

/** Paquete offline: el setlist más cada tema completo que referencia. */
export async function buildBundle(setlistId: string): Promise<OfflineBundle | null> {
  const setlist = await getSetlist(setlistId);
  if (!setlist) return null;
  const ids = [...new Set(setlist.tandas.flatMap((t) => t.temas.map((r) => r.songId)))];
  const rows = await db.song.findMany({ where: { id: { in: ids } }, include: songInclude });
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    setlist,
    songs: rows.map(toSong),
  };
}
