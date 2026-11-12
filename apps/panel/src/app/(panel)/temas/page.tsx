import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { listSongs } from "@/lib/data";
import { fmtDuration } from "@/lib/format";

export const metadata: Metadata = { title: "Temas" };

export default async function SongsPage() {
  await connection();
  const songs = await listSongs();
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Temas</h1>
        <Link href="/temas/nuevo" className="btn-primary">
          + Nuevo tema
        </Link>
      </div>
      {songs.length === 0 ? (
        <p className="card p-6 text-sm text-muted">Todavía no hay temas cargados.</p>
      ) : (
        <ul className="card divide-y divide-border">
          {songs.map((s) => (
            <li key={s.id}>
              <Link href={`/temas/${s.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-accent/5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.titulo}</div>
                  <div className="truncate text-sm text-muted">{s.artistaOriginal}</div>
                </div>
                <div className="hidden text-right text-xs text-muted sm:block">
                  {s.lineas} líneas
                  {s.enSetlists > 0 && ` · en ${s.enSetlists} tanda${s.enSetlists > 1 ? "s" : ""}`}
                </div>
                <div className="w-20 text-right font-mono text-sm tabular-nums text-muted">
                  {fmtDuration(s.duracionSegundos)}
                  {s.bpmManual ? (
                    <div className="text-xs">
                      {s.bpmManual} bpm · {s.compas}
                    </div>
                  ) : null}
                  {s.tieneVideo ? <div className="text-xs">🎞 video</div> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
