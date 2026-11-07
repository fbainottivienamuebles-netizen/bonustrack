"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { Setlist } from "@letras/shared";
import { saveSetlistAction, type FormState } from "@/app/actions";
import { fmtDuration } from "@/lib/format";

interface SongOption {
  id: string;
  titulo: string;
  artistaOriginal: string;
  duracionSegundos: number;
}

interface DraftTanda {
  key: number;
  nombre: string;
  temas: string[];
}

let nextKey = 1;

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const out = [...arr];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function SetlistEditor({ setlist, songs }: { setlist: Setlist | null; songs: SongOption[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSetlistAction, {});
  const [nombre, setNombre] = useState(setlist?.nombre ?? "");
  const [tandas, setTandas] = useState<DraftTanda[]>(() =>
    setlist && setlist.tandas.length
      ? setlist.tandas.map((t) => ({ key: nextKey++, nombre: t.nombre, temas: t.temas.map((r) => r.songId) }))
      : [{ key: nextKey++, nombre: "Tanda 1", temas: [] }],
  );

  const byId = new Map(songs.map((s) => [s.id, s]));
  const update = (i: number, f: (t: DraftTanda) => DraftTanda) =>
    setTandas((ts) => ts.map((t, j) => (j === i ? f(t) : t)));

  const totalSeg = tandas.flatMap((t) => t.temas).reduce((n, id) => n + (byId.get(id)?.duracionSegundos ?? 0), 0);
  const payload = JSON.stringify({ nombre, tandas: tandas.map(({ nombre, temas }) => ({ nombre, temas })) });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={setlist?.id ?? ""} />
      <input type="hidden" name="payload" value={payload} />

      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-60 flex-1">
          <label className="label" htmlFor="nombre">Nombre del setlist</label>
          <input
            id="nombre"
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Show sábado 14"
            required
          />
        </div>
        <div className="pb-2 text-sm text-muted">Duración total: {fmtDuration(totalSeg)}</div>
      </div>

      {tandas.map((t, ti) => {
        const seg = t.temas.reduce((n, id) => n + (byId.get(id)?.duracionSegundos ?? 0), 0);
        return (
          <section key={t.key} className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                className="input max-w-xs font-medium"
                value={t.nombre}
                onChange={(e) => update(ti, (x) => ({ ...x, nombre: e.target.value }))}
                aria-label="Nombre de la tanda"
              />
              <span className="text-sm text-muted">{fmtDuration(seg)}</span>
              <div className="ml-auto flex gap-1">
                <button type="button" className="btn px-2" onClick={() => setTandas((ts) => move(ts, ti, ti - 1))} disabled={ti === 0} aria-label="Subir tanda">↑</button>
                <button type="button" className="btn px-2" onClick={() => setTandas((ts) => move(ts, ti, ti + 1))} disabled={ti === tandas.length - 1} aria-label="Bajar tanda">↓</button>
                <button
                  type="button"
                  className="btn-danger px-2"
                  onClick={() => setTandas((ts) => ts.filter((_, j) => j !== ti))}
                  aria-label="Quitar tanda"
                >
                  ✕
                </button>
              </div>
            </div>

            <ol className="mb-3 divide-y divide-border rounded-md border border-border">
              {t.temas.length === 0 && <li className="px-3 py-2 text-sm text-muted">Sin temas.</li>}
              {t.temas.map((id, si) => {
                const s = byId.get(id);
                return (
                  <li key={`${id}-${si}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="w-5 text-right tabular-nums text-muted">{si + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s ? (
                        <>
                          {s.titulo} <span className="text-muted">— {s.artistaOriginal}</span>
                        </>
                      ) : (
                        <span className="text-danger">Tema borrado</span>
                      )}
                    </span>
                    <span className="font-mono text-xs text-muted">{s && fmtDuration(s.duracionSegundos)}</span>
                    <button type="button" className="px-1 text-muted hover:text-foreground disabled:opacity-30" disabled={si === 0} onClick={() => update(ti, (x) => ({ ...x, temas: move(x.temas, si, si - 1) }))} aria-label="Subir">↑</button>
                    <button type="button" className="px-1 text-muted hover:text-foreground disabled:opacity-30" disabled={si === t.temas.length - 1} onClick={() => update(ti, (x) => ({ ...x, temas: move(x.temas, si, si + 1) }))} aria-label="Bajar">↓</button>
                    <button type="button" className="px-1 text-muted hover:text-danger" onClick={() => update(ti, (x) => ({ ...x, temas: x.temas.filter((_, j) => j !== si) }))} aria-label="Quitar">✕</button>
                  </li>
                );
              })}
            </ol>

            <select
              className="input max-w-md"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) update(ti, (x) => ({ ...x, temas: [...x.temas, id] }));
              }}
              disabled={songs.length === 0}
            >
              <option value="">{songs.length ? "+ Agregar tema…" : "No hay temas cargados"}</option>
              {songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.titulo} — {s.artistaOriginal}
                </option>
              ))}
            </select>
          </section>
        );
      })}

      <button
        type="button"
        className="btn"
        onClick={() => setTandas((ts) => [...ts, { key: nextKey++, nombre: `Tanda ${ts.length + 1}`, temas: [] }])}
      >
        + Agregar tanda
      </button>

      {state.error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2 border-t border-border pt-4">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar setlist"}
        </button>
        <Link href="/setlists" className="btn">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
