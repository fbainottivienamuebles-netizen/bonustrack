// Modo show: la letra avanza con el reloj, todo desde el paquete local.
//
// Si la app la sirve el director (notebook con apps/director), este equipo es
// el Controlador: manda el setlist y el estado a todos los de la sala WiFi.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  STOPPED_CLOCK,
  buildTimeline,
  clockFromState,
  clockPosition,
  flattenSetlist,
  lineAt,
  songDurationMs,
  type OfflineBundle,
  type PlaybackClock,
  type ShowState,
} from "@letras/shared";
import { Lyrics } from "../components/Lyrics";
import { RoomInfo } from "../components/RoomInfo";
import { deviceId } from "../lib/device";
import { fmt } from "../lib/format";
import { useLocalLink, type DirectorInfo } from "../lib/local-link";
import { usePlayer } from "../lib/use-player";
import { allowScreenOff, keepScreenOn } from "../lib/wake";

interface Current {
  index: number;
  /** Reloj con el que arranca el tema (al retomar); null = desde cero. */
  clock: PlaybackClock | null;
  /** Cambia en cada arranque para reiniciar el reproductor. */
  token: number;
}

export function Show({
  bundle,
  director,
  onExit,
}: {
  bundle: OfflineBundle;
  director: DirectorInfo | null;
  onExit: () => void;
}) {
  const entries = useMemo(() => flattenSetlist(bundle.setlist.tandas), [bundle]);
  const songs = useMemo(() => new Map(bundle.songs.map((s) => [s.id, s])), [bundle]);
  const [cur, setCur] = useState<Current>({ index: 0, clock: null, token: 0 });
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    keepScreenOn();
    return () => void allowScreenOff();
  }, []);

  // ---------- Sala WiFi (solo si hay director) ----------
  const { link, snap } = useLocalLink(director ? director.base : null, "controlador");
  const clockRef = useRef<PlaybackClock>(STOPPED_CLOCK);
  const indexRef = useRef(0);
  // Empieza en la hora actual: si la página se recarga, los seguidores no
  // descartan los mensajes nuevos por tener un número menor.
  const seqRef = useRef(Date.now());
  /** Mientras se pregunta "¿retomar?", no se pisa el estado guardado. */
  const holdRef = useRef(false);
  const actedRef = useRef(false);
  const [offer, setOffer] = useState<{ state: ShowState; at: number } | null>(null);

  const sendState = useCallback(() => {
    if (!link || holdRef.current) return;
    const entry = entries[indexRef.current];
    const song = entry && songs.get(entry.songId);
    if (!song) return;
    const c = clockRef.current;
    link.send({
      t: "state",
      at: link.serverNow(),
      state: {
        v: 1,
        seq: ++seqRef.current,
        controllerId: deviceId(),
        setlistId: bundle.setlist.id,
        entryIndex: indexRef.current,
        songId: song.id,
        status: c.status,
        positionMs: Math.round(clockPosition(c, performance.now())),
        rate: c.rate,
        bpm: song.bpmManual ? Math.round(song.bpmManual * c.rate) : null,
        tempoSource: song.fuenteTempo,
      },
    });
  }, [link, entries, songs, bundle]);

  // Al (re)conectar: mandar el setlist y el estado. Si el servidor tenía este
  // mismo setlist en curso (p. ej. se recargó la página), ofrecer retomar.
  useEffect(() => {
    if (!link) return;
    link.onOpen = () => {
      link.send({ t: "bundle", bundle });
      const prev = link.snap.state;
      const resumable =
        !actedRef.current &&
        prev &&
        prev.state.setlistId === bundle.setlist.id &&
        prev.state.entryIndex < entries.length &&
        (prev.state.entryIndex > 0 || prev.state.positionMs > 1000);
      if (resumable) {
        holdRef.current = true;
        setOffer(prev);
      } else sendState();
    };
    return () => {
      link.onOpen = null;
    };
  }, [link, bundle, entries, sendState]);

  // Latido: cada segundo, por si alguien se perdió un mensaje.
  useEffect(() => {
    if (!link) return;
    const id = window.setInterval(sendState, 1000);
    return () => clearInterval(id);
  }, [link, sendState]);

  const goTo = (index: number, clock: PlaybackClock | null = null) => {
    actedRef.current = true;
    holdRef.current = false;
    setOffer(null);
    indexRef.current = index;
    clockRef.current = clock ?? STOPPED_CLOCK;
    setCur((c) => ({ index, clock, token: c.token + 1 }));
    sendState();
  };

  const onClock = useCallback(
    (c: PlaybackClock) => {
      actedRef.current = true;
      holdRef.current = false;
      setOffer(null);
      clockRef.current = c;
      sendState();
    },
    [sendState],
  );

  function resume() {
    if (!offer || !link) return;
    const clock = clockFromState(offer.state, offer.at, link.serverNow(), performance.now());
    goTo(offer.state.entryIndex, clock);
  }

  if (entries.length === 0) {
    return (
      <div className="screen center">
        <p>Este setlist no tiene temas.</p>
        <button className="btn" onClick={onExit}>Volver</button>
      </div>
    );
  }

  const entry = entries[cur.index];
  const song = songs.get(entry.songId)!;
  const followers = (snap?.peers ?? []).filter((p) => p.role !== "controlador").length;

  return (
    <SongView
      key={cur.token}
      song={song}
      entry={entry}
      initialClock={cur.clock}
      index={cur.index}
      total={entries.length}
      next={entries[cur.index + 1] ? songs.get(entries[cur.index + 1].songId)!.titulo : null}
      onPrev={() => goTo(Math.max(0, cur.index - 1))}
      onNext={() => goTo(Math.min(entries.length - 1, cur.index + 1))}
      onOpenList={() => setShowList(true)}
      onClock={onClock}
      badge={
        director && (
          <span className={`room-badge ${snap?.status === "online" ? "ok" : "bad"}`}>
            {snap?.status === "online" ? `📡 ${followers}` : "📡 sin sala"}
          </span>
        )
      }
    >
      {offer && (
        <div className="resume">
          <span className="grow">
            El show estaba en <strong>{songs.get(offer.state.songId)?.titulo ?? "otro tema"}</strong> (
            {fmt(offer.state.positionMs)}).
          </span>
          <button className="btn small primary" onClick={resume}>Retomar</button>
          <button className="btn small" onClick={() => goTo(cur.index)}>Empezar de cero</button>
        </div>
      )}
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
                      className={`song-item ${i === cur.index ? "current" : ""}`}
                      onClick={() => {
                        goTo(i);
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
            {director && <RoomInfo director={director} snap={snap} />}
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
  initialClock: PlaybackClock | null;
  index: number;
  total: number;
  next: string | null;
  onPrev: () => void;
  onNext: () => void;
  onOpenList: () => void;
  /** Cada cambio del reloj hecho en este tema (play, pausa, saltos, tempo). */
  onClock: (c: PlaybackClock) => void;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

function SongView({
  song,
  entry,
  initialClock,
  index,
  total,
  next,
  onPrev,
  onNext,
  onOpenList,
  onClock,
  badge,
  children,
}: SongViewProps) {
  const duration = songDurationMs(song);
  const timeline = useMemo(() => buildTimeline(song.secciones), [song]);
  const player = usePlayer(duration, initialClock ?? undefined);
  const active = lineAt(timeline, player.position);
  const playing = player.clock.status === "playing";

  // Avisar cambios del reloj (no el inicial: ese ya lo conoce quien monta).
  const firstClock = useRef(player.clock);
  useEffect(() => {
    if (player.clock !== firstClock.current) onClock(player.clock);
  }, [player.clock, onClock]);

  // Tempo: si el tema tiene BPM, se ajusta de a 1 BPM; si no, de a 2 %.
  const baseBpm = song.bpmManual;
  const bpm = baseBpm ? Math.round(baseBpm * player.clock.rate) : null;
  const stepRate = (dir: 1 | -1) => {
    const r = baseBpm ? (Math.round(baseBpm * player.clock.rate) + dir) / baseBpm : player.clock.rate + dir * 0.02;
    player.setRate(Math.min(2, Math.max(0.5, r)));
  };

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
        {badge}
        <div className="time">
          {fmt(player.position)}
          <span className="muted"> / {fmt(duration)}</span>
        </div>
      </header>
      <div className="progress">
        <div style={{ width: `${(player.position / duration) * 100}%` }} />
      </div>

      <Lyrics timeline={timeline} active={active} onSeek={player.seek}>
        {player.atEnd && next && (
          <button className="next-up" onClick={onNext}>
            Siguiente: <strong>{next}</strong> →
          </button>
        )}
      </Lyrics>

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
