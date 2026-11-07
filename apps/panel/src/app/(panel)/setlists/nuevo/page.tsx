import type { Metadata } from "next";
import { connection } from "next/server";
import { listSongs } from "@/lib/data";
import { SetlistEditor } from "../setlist-editor";

export const metadata: Metadata = { title: "Nuevo setlist" };

export default async function NewSetlistPage() {
  await connection();
  const songs = await listSongs();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Nuevo setlist</h1>
      <SetlistEditor setlist={null} songs={songs} />
    </>
  );
}
