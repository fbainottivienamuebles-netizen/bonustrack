import { notFound } from "next/navigation";
import { deleteSetlistAction, duplicateSetlistAction } from "@/app/actions";
import { getSetlist, listSongs } from "@/lib/data";
import { SetlistEditor } from "../setlist-editor";

export default async function EditSetlistPage({ params }: PageProps<"/setlists/[id]">) {
  const { id } = await params;
  const [setlist, songs] = await Promise.all([getSetlist(id), listSongs()]);
  if (!setlist) notFound();
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="truncate text-xl font-semibold">{setlist.nombre}</h1>
        <div className="flex items-center gap-2">
          <form action={duplicateSetlistAction}>
            <input type="hidden" name="id" value={setlist.id} />
            <button className="btn" title="Crea una copia para armar otro evento a partir de este">
              Duplicar
            </button>
          </form>
          <form action={deleteSetlistAction}>
            <input type="hidden" name="id" value={setlist.id} />
            <button className="btn-danger">Borrar setlist</button>
          </form>
        </div>
      </div>
      <SetlistEditor setlist={setlist} songs={songs} />
    </>
  );
}
