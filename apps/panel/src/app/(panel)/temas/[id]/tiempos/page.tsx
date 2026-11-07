import Link from "next/link";
import { notFound } from "next/navigation";
import { getSong } from "@/lib/data";
import { TimingTool } from "./timing-tool";

export default async function TimingPage({ params }: PageProps<"/temas/[id]/tiempos">) {
  const { id } = await params;
  const song = await getSong(id);
  if (!song) notFound();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Marcar tiempos <span className="text-muted">· {song.titulo}</span>
        </h1>
        <Link href={`/temas/${song.id}`} className="text-sm text-muted hover:text-foreground">
          ← Volver al tema
        </Link>
      </div>
      <TimingTool song={song} />
    </>
  );
}
