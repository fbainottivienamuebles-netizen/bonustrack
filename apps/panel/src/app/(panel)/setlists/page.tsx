import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { listSetlists } from "@/lib/data";

export const metadata: Metadata = { title: "Setlists" };

export default async function SetlistsPage() {
  await connection();
  const setlists = await listSetlists();
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Setlists</h1>
        <Link href="/setlists/nuevo" className="btn-primary">
          + Nuevo setlist
        </Link>
      </div>
      {setlists.length === 0 ? (
        <p className="card p-6 text-sm text-muted">Todavía no hay setlists.</p>
      ) : (
        <ul className="card divide-y divide-border">
          {setlists.map((s) => (
            <li key={s.id}>
              <Link href={`/setlists/${s.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-accent/5">
                <div className="min-w-0 flex-1 truncate font-medium">{s.nombre}</div>
                <div className="text-sm text-muted">
                  {s.cantidadTandas} tanda{s.cantidadTandas !== 1 && "s"} · {s.cantidadTemas} tema
                  {s.cantidadTemas !== 1 && "s"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
