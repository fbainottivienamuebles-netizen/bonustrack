import type { Metadata } from "next";
import { SongEditor } from "../song-editor";
import { videoStorageReady } from "@/lib/videos";

export const metadata: Metadata = { title: "Nuevo tema" };

export default function NewSongPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Nuevo tema</h1>
      <SongEditor song={null} videoUploadReady={videoStorageReady()} />
    </>
  );
}
