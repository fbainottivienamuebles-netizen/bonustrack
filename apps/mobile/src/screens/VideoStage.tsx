// Pantalla para el público (proyector o TV): video de fondo del tema en loop,
// sin audio, con la velocidad ajustada al tempo vigente. Sigue al director
// como cualquier Seguidor (WiFi o Bluetooth).
//
// - Arranca junto con la letra, al terminar la cuenta previa. La cuenta NO se
//   muestra acá (es para el público): solo en los equipos de la banda.
// - En pausa, el video se congela. Sin video: pantalla neutra con el nombre.
// - Un click: pantalla completa. Los controles se esconden solos.

import { useEffect, useMemo, useRef, useState } from "react";
import { flattenSetlist, videoRate, type PlaybackClock } from "@letras/shared";
import { useVideoSrc } from "../lib/videos";
import type { Where } from "./Follow";

export function VideoStage({
  where,
  clock,
  position,
  director,
  onExit,
}: {
  where: Where;
  clock: PlaybackClock;
  position: number;
  director: string | null;
  onExit: () => void;
}) {
  const { bundle } = where;
  const entries = useMemo(() => (bundle ? flattenSetlist(bundle.setlist.tandas) : []), [bundle]);
  const entry = entries[Math.min(where.entryIndex, entries.length - 1)];
  const song = entry && bundle ? bundle.songs.find((s) => s.id === entry.songId) : undefined;
  const src = useVideoSrc(song?.videoUrl ?? null, director);
  const [failed, setFailed] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const running = clock.status === "playing" && position >= 0;
  const rate = song ? videoRate(song, clock.rate) : 1;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate, src]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (running) v.play().catch(() => {});
    else v.pause();
  }, [running, src]);

  // Controles: aparecen con un toque y se esconden a los 4 s.
  const [pokedAt, setPokedAt] = useState(() => performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const showControls = performance.now() - pokedAt < 4000;
  const poke = () => {
    setPokedAt(performance.now());
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const hasVideo = !!(song?.videoUrl && src && failed !== song.videoUrl);

  return (
    <div className={`video-stage ${showControls ? "" : "idle"}`} onClick={poke}>
      {hasVideo ? (
        <video
          key={song!.id}
          ref={video}
          className="video-bg"
          src={src!}
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setFailed(song!.videoUrl)}
          onLoadedMetadata={(e) => {
            e.currentTarget.playbackRate = rate;
            if (running) e.currentTarget.play().catch(() => {});
          }}
        />
      ) : (
        <div key={song?.id ?? "none"} className="video-neutral">
          {song ? (
            <>
              <div className="video-title">{song.titulo}</div>
              <div className="video-artist">{song.artistaOriginal}</div>
            </>
          ) : (
            <div className="video-artist">{where.missing ?? "Esperando al director…"}</div>
          )}
        </div>
      )}

      {showControls && (
        <div className="video-controls" onClick={(e) => e.stopPropagation()}>
          <span className={`room-badge ${where.conn.ok ? "ok" : "bad"}`}>
            {where.conn.ok ? `● ${where.conn.text}` : `○ ${where.conn.text}`}
          </span>
          {song && (
            <span className="muted small">
              {song.titulo}
              {hasVideo ? ` · video ×${rate.toFixed(2).replace(".", ",")}` : song.videoUrl ? " · video no disponible" : " · sin video"}
            </span>
          )}
          <button className="btn small danger" onClick={onExit}>Salir</button>
        </div>
      )}
    </div>
  );
}
