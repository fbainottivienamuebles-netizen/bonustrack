"use client";

// Video de fondo para la Pantalla: se sube directo a Vercel Blob desde el
// navegador (o se pega un link https a un .mp4). El formulario guarda la URL.

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { Song } from "@letras/shared";

function slug(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "tema"
  );
}

export function VideoField({ song, uploadReady }: { song: Song | null; uploadReady: boolean }) {
  const [url, setUrl] = useState(song?.videoUrl ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) {
      setError("Formato no soportado: usá un video .mp4 (o .webm / .mov).");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError("El video pesa más de 200 MB. Para un loop de 5 a 8 s, 1080p, debería pesar menos de 30 MB.");
      return;
    }
    setProgress(0);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const blob = await upload(`videos/${slug(song?.titulo ?? file.name)}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/videos/upload",
        contentType: file.type,
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      setUrl(blob.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="card grid gap-4 p-4 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <div className="text-sm font-semibold">Video de fondo (Pantalla para el público)</div>
        <p className="text-xs text-muted">
          Loop de 5 a 8 s, 16:9, 1080p, sin texto ni logos. Se reproduce sin sonido, en loop, a la velocidad del tempo
          real. Recordá <strong>Guardar</strong> el tema después de subirlo.
        </p>
      </div>

      <div className="sm:col-span-4 space-y-2">
        {url ? (
          <video
            key={url}
            src={url}
            className="aspect-video w-full rounded-md bg-black object-cover"
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">
            Sin video: la Pantalla muestra el nombre del tema
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {uploadReady ? (
            <label className={`btn cursor-pointer ${progress !== null ? "pointer-events-none opacity-50" : ""}`}>
              {progress !== null ? `Subiendo… ${Math.round(progress)} %` : url ? "Cambiar video…" : "Subir video…"}
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </label>
          ) : (
            <span className="text-xs text-muted">
              Para subir videos falta conectar el almacenamiento (Vercel Blob). Mientras, podés pegar un link https a
              un .mp4.
            </span>
          )}
          {url && (
            <button type="button" className="btn-danger" onClick={() => setUrl("")}>
              Quitar video
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-danger/10 p-2 text-xs text-danger">{error}</p>}
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">o pegar un link al video</summary>
          <input
            name="videoUrl"
            type="url"
            className="input mt-1"
            placeholder="https://…/video.mp4"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </details>
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor="videoBpmReferencia">BPM del video</label>
        <input
          id="videoBpmReferencia"
          name="videoBpmReferencia"
          type="number"
          min={30}
          max={300}
          className="input font-mono"
          placeholder="= BPM del tema"
          defaultValue={song?.videoBpmReferencia ?? ""}
        />
        <p className="mt-1 text-xs text-muted">
          El tempo al que se ve “bien” el video. Si el tema va más rápido o más lento, el video se acelera o frena en
          la misma proporción. Vacío = igual al BPM del tema.
        </p>
      </div>
    </div>
  );
}
