// Modo show: la letra avanza con el reloj, todo desde el paquete local.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SECTION_LABELS,
  buildTimeline,
  flattenSetlist,
  lineAt,
  songDurationMs,
  type OfflineBundle,
} from "@letras/shared";
import { usePlayer } from "../lib/use-player";
import { allowScreenOff, keepScreenOn } from "../lib/wake";

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Show({ bundle, onExit }: { bundle: OfflineBundle; onExit: () => void }) {
  const entries = useMemo(() => flattenSetlist(bundle.setlist.tandas), [bundle]);
  const songs = useMemo(() => new Map(bundle.songs.map((s) => [s.id, s])), [bundle]);
  const [entryIndex, setEntryIndex] = useState(0);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    keepScreenOn();
    return () => void allowScreenOff();
  }, []);

  if (entries.length === 0) {
    return (
      <div className="screen center">
        <p>Este setlist no tiene temas.</p>
        <button className="btn" onClick={onExit}>Volver</button>
      </div>
    );
  }

  const entry = entries[entryIndex];
  const song = songs.get(entry.songId)!;

  return (
    // key: al cambiar de tema se reinicia el reloj.
    <SongView
      key={entryIndex}
      song={song}
      entry={entry}
      index={entryIndex}
      total={entries.length}
      next={entries[entryIndex + 1] ? songs.get(entries[entryIndex + 1].songId)!.titulo : null}
      onPrev={() => setEntryIndex((i) => Math.max(0, i - 1))}
      onNext={() => setEntryIndex((i) => Math.min(entries.length - 1, i + 1))}
      onOpenList={() => setShowList(true)}
      onExit={onExit}
    >
      {showList && (
        <div className="overlay" onClick={() => setShowList(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>{bundle.setlist.nombre}</strong>
              <button className="btn small" onClick={() => setShowList(false)}>Cerrar</button>
            </div>
            <ol className="song-list">
              {entries.map((e, i) => {
                const s = songs.get(e.songId)!;
                const tandaStart = i === 0 || entries[i - 1].tandaIndex !== e.tandaIndex;
                return (
                  <li key={i}>
                    {tandaStart && <div className="tanda-label">{e.tandaNombre}</div>}
                    <button
                      className={`song-item ${i === entryIndex ? "current" : ""}`}
                      onClick={() => {
                        setEntryIndex(i);
                        setShowList(false);
                      }}
                    >
                      <span className="num">{e.position + 1}</span>
                      <span className="grow">{s.titulo}</span>
                      <span className="muted">{fmt(songDurationMs(s))}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <button className="btn danger full" onClick={onExit}>Salir del show</button>
          </div>
        </div>
      )}
    </SongView>
  );
}

interface SongViewProps {
  song: OfflineBundle["songs"][number];
  entry: ReturnType<typeof flattenSetlist>[number];
  index: number;
  total: number;
  next: string | null;
  onPrev: () => void;
  onNext: () => void;
  onOpenList: () => void;
  onExit: () => void;
  children?: React.ReactNode;
}

function SongView({ song, entry, index, total, next, onPrev, onNext, onOpenList, children }: SongViewProps) {
  const duration = songDurationMs(song);
  const timeline = useMemo(() => buildTimeline(song.secciones), [song]);
  const player = usePlayer(duration);
  const active = lineAt(timeline, player.position);
  const activeRef = useRef<HTMLDivElement>(null);
  const playing = player.clock.status === "playing";

  // Tempo: si el tema tiene BPM, se ajusta de a 1 BPM; si no, de a 2 %.
  const baseBpm = song.bpmManual;
  const bpm = baseBpm ? Math.round(baseBpm * player.clock.rate) : null;
  const stepRate = (dir: 1 | -1) => {
    const r = baseBpm ? (Math.round(baseBpm * player.clock.rate) + dir) / baseBpm : player.clock.rate + dir * 0.02;
    player.setRate(Math.min(2, Math.max(0.5, r)));
  };

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  // Atajos de teclado (pedaleras bluetooth suelen mandar flechas/AvPág/espacio).
  const keys = useRef({ player, onPrev, onNext });
  useEffect(() => {
    keys.current = { player, onPrev, onNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === " " || e.key === "Enter") k.player.toggle();
      else if (e.key === "ArrowRight" || e.key === "PageDown") k.onNext();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") k.onPrev();
      else if (e.key === "ArrowDown") k.player.seek(k.player.position + 5000);
      else if (e.key === "ArrowUp") k.player.seek(k.player.position - 5000);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="screen show">
      <header className="show-head" onClick={onOpenList}>
        <div className="grow">
          <div className="muted small">
            {entry.tandaNombre} · {index + 1}/{total}
          </div>
          <div className="title">{song.titulo}</div>
          <div className="muted small">{song.artistaOriginal}</div>
        </div>
        <div className="time">
          {fmt(player.position)}
          <span className="muted"> / {fmt(duration)}</span>
        </div>
      </header>
      <div className="progress">
        <div style={{ width: `${(player.position / duration) * 100}%` }} />
      </div>

      <main className="lyrics">
        <div className="spacer" />
        {timeline.length === 0 && <p className="muted center">Este tema no tiene letra cargada.</p>}
        {timeline.map((l) => (
          <div key={l.index}>
            {l.sectionStart && <div className="section-label">{SECTION_LABELS[l.sectionType]}</div>}
            <div
              ref={l.index === active ? activeRef : undefined}
              className={`line ${l.index === active ? "active" : l.index < active ? "past" : ""}`}
              onClick={() => player.seek(l.tiempoInicioMs)}
            >
              {l.texto}
            </div>
          </div>
        ))}
        {player.atEnd && next && (
          <button className="next-up" onClick={onNext}>
            Siguiente: <strong>{next}</strong> →
          </button>
        )}
        <div className="spacer" />
      </main>

      <footer className="controls">
        <div className="tempo">
          <button className="btn small" onClick={() => stepRate(-1)} aria-label="Más lento">−</button>
          <button className="tempo-value" onClick={() => player.setRate(1)} title="Volver al tempo original">
            {bpm ? `${bpm} BPM` : `${Math.round(player.clock.rate * 100)} %`}
            {player.clock.rate !== 1 && <span className="muted small"> ↺</span>}
          </button>
          <button className="btn small" onClick={() => stepRate(1)} aria-label="Más rápido">+</button>
        </div>
        <div className="transport">
          <button className="btn" onClick={onPrev} disabled={index === 0} aria-label="Tema anterior">⏮</button>
          <button className="btn" onClick={() => player.seek(player.position - 5000)} aria-label="Atrás 5 s">−5s</button>
          <button className="btn play" onClick={player.toggle}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="btn" onClick={() => player.seek(player.position + 5000)} aria-label="Adelante 5 s">+5s</button>
          <button className="btn" onClick={onNext} disabled={index === total - 1} aria-label="Tema siguiente">⏭</button>
        </div>
      </footer>
      {children}
    </div>
  );
}
