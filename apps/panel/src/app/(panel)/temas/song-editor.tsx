"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  SECTION_LABELS,
  formatTime,
  parseLyrics,
  serializeLyrics,
  type Song,
} from "@letras/shared";
import { saveSongAction, type FormState } from "@/app/actions";
import { fmtDuration } from "@/lib/format";

const PLACEHOLDER = `[intro]
[verso]
00:12.50 Primera línea del verso
00:16.00 Segunda línea
Línea sin tiempo (se interpola)
[estribillo]
00:30.00 Arranca el estribillo`;

function durationToSeconds(raw: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(raw.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 0;
}

export function SongEditor({ song }: { song: Song | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSongAction, {});
  const [duracion, setDuracion] = useState(song ? fmtDuration(song.duracionSegundos) : "");
  const [letra, setLetra] = useState(song ? serializeLyrics(song.secciones) : "");

  const parsed = useMemo(
    () => parseLyrics(letra, durationToSeconds(duracion) || 240),
    [letra, duracion],
  );
  const totalLineas = parsed.secciones.reduce((n, s) => n + s.lineas.length, 0);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={song?.id ?? ""} />

      <div className="card grid gap-4 p-4 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className="label" htmlFor="titulo">Título</label>
          <input id="titulo" name="titulo" className="input" defaultValue={song?.titulo} required />
        </div>
        <div className="sm:col-span-3">
          <label className="label" htmlFor="artistaOriginal">Artista original</label>
          <input
            id="artistaOriginal"
            name="artistaOriginal"
            className="input"
            defaultValue={song?.artistaOriginal}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="duracion">Duración (mm:ss)</label>
          <input
            id="duracion"
            name="duracion"
            className="input font-mono"
            placeholder="3:45"
            value={duracion}
            onChange={(e) => setDuracion(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="bpmManual">BPM</label>
          <input
            id="bpmManual"
            name="bpmManual"
            type="number"
            min={30}
            max={300}
            className="input font-mono"
            defaultValue={song?.bpmManual ?? ""}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="videoBpmReferencia">BPM de la grabación</label>
          <input
            id="videoBpmReferencia"
            name="videoBpmReferencia"
            type="number"
            min={30}
            max={300}
            className="input font-mono"
            defaultValue={song?.videoBpmReferencia ?? ""}
          />
        </div>
        <div className="sm:col-span-6">
          <label className="label" htmlFor="videoUrl">Video de referencia (URL, opcional)</label>
          <input
            id="videoUrl"
            name="videoUrl"
            type="url"
            className="input"
            placeholder="https://www.youtube.com/watch?v=…"
            defaultValue={song?.videoUrl ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="label" htmlFor="letra">
            Letra — <code>[sección]</code> abre una sección; <code>mm:ss.cc</code> al inicio marca el tiempo
          </label>
          <textarea
            id="letra"
            name="letra"
            className="input min-h-[28rem] font-mono text-[13px] leading-6"
            placeholder={PLACEHOLDER}
            value={letra}
            onChange={(e) => setLetra(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div>
          <div className="label">
            Vista previa — {parsed.secciones.length} secciones, {totalLineas} líneas
            {parsed.interpoladas > 0 && `, ${parsed.interpoladas} con tiempo interpolado`}
          </div>
          <div className="card max-h-[28rem] overflow-y-auto p-3 text-sm">
            {parsed.errores.length > 0 && (
              <ul className="mb-3 space-y-1 rounded-md bg-danger/10 p-2 text-xs text-danger">
                {parsed.errores.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {parsed.secciones.length === 0 && <p className="text-muted">Sin letra todavía.</p>}
            {parsed.secciones.map((s, si) => (
              <div key={si} className="mb-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                  {SECTION_LABELS[s.tipo]}
                </div>
                {s.lineas.map((l, li) => (
                  <div key={li} className="flex gap-3">
                    <span className="font-mono text-xs leading-6 tabular-nums text-muted">
                      {formatTime(l.tiempoInicioMs)}
                    </span>
                    <span className="leading-6">{l.texto}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {state.error && (
        <p className="whitespace-pre-line rounded-md bg-danger/10 p-3 text-sm text-danger">{state.error}</p>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <Link href="/temas" className="btn">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
