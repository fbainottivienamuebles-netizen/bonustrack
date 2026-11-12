import Link from "next/link";
import { notFound } from "next/navigation";
import { getSong } from "@/lib/data";
import { SongEditor } from "../song-editor";
import { videoStorageReady } from "@/lib/videos";
import { DeleteSongButton } from "./delete-song-button";

export default async function EditSongPage({ params }: PageProps<"/temas/[id]">) {
  const { id } = await params;
  const song = await getSong(id);
  if (!song) notFound();
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="truncate text-xl font-semibold">{song.titulo}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/temas/${song.id}/tiempos`} className="btn-primary">
            ♪ Marcar tiempos con la grabación
          </Link>
          <DeleteSongButton id={song.id} />
        </div>
      </div>
      <SongEditor song={song} videoUploadReady={videoStorageReady()} />
    </>
  );
}
