// Modo show: la letra avanza con el reloj, todo desde el paquete local.
//
// Si la app la sirve el director (notebook con apps/director), este equipo es
// el Controlador: manda el setlist y el estado a todos los de la sala WiFi.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLICK_SOUNDS,
  CLICK_SOUND_LABELS,
  STOPPED_CLOCK,
  buildTimeline,
  clickPlan,
  countInAt,
  type ClickSound,
  clockFromState,
  clockPosition,
  flattenSetlist,
  lineAt,
  songDurationMs,
  type OfflineBundle,
  type PlaybackClock,
  type ShowState,
} from "@letras/shared";
import { CountIn } from "../components/CountIn";
import { Lyrics } from "../components/Lyrics";
import { RoomInfo } from "../components/RoomInfo";
import { deviceId } from "../lib/device";
import { fmt } from "../lib/format";
import { useLocalLink, type DirectorInfo } from "../lib/local-link";
import {
  listOutputs,
  loadSongClick,
  metronome,
  onOutputsChange,
  saveSongClick,
  type SongClickPrefs,
} from "../lib/metronome";
import { Check } from "./Check";
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

  const [showCheck, setShowCheck] = useState(false);
  const [audioWarn, setAudioWarn] = useState<string | null>(null);

  useEffect(() => {
    keepScreenOn();
    // El audio se habilita con el primer toque (regla de los navegadores):
    // así el primer play ya sale con la latencia medida.
    const unlock = () => metronome.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      void allowScreenOff();
    };
  }, []);

  // Aviso si se conecta o desconecta algo de audio (cable a la consola, placa USB).
  useEffect(
    () =>
      onOutputsChange(async () => {
        await metronome.refreshSink();
        const sel = metronome.audioPrefs.sinkId;
        const outs = await listOutputs().catch(() => []);
        setAudioWarn(
          sel && !outs.some((o) => o.id === sel)
            ? "⚠ Se desconectó la salida de audio del clic. Revisá el cable o la placa: mientras, el clic sale por la salida del sistema."
            : "⚠ Cambió la salida de audio (se conectó o desconectó algo). Revisá que el clic siga llegando a la consola.",
        );
      }),
    [],
  );

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
      {audioWarn && (
        <div className="resume warn">
          <span className="grow">{audioWarn}</span>
          <button className="btn small" onClick={() => setAudioWarn(null)}>OK</button>
        </div>
      )}
      {showCheck && (
        <div className="overlay full">
          <Check director={director} onClose={() => setShowCheck(false)} />
        </div>
      )}
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
            <button
              className="btn full"
              style={{ marginBottom: ".5rem" }}
              onClick={() => {
                setShowList(false);
                setShowCheck(true);
              }}
            >
              Chequeo previo · salida de audio y latencia
            </button>
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
  const shown = Math.max(0, player.position);

  // Avisar cambios del reloj (no el inicial: ese ya lo conoce quien monta).
  const firstClock = useRef(player.clock);
  useEffect(() => {
    if (player.clock !== firstClock.current) onClock(player.clock);
  }, [player.clock, onClock]);

  // ---------- Clic ----------
  const [clickPrefs, setClickPrefsState] = useState<SongClickPrefs>(() => loadSongClick(song.id));
  const setClickPrefs = (p: SongClickPrefs) => {
    setClickPrefsState(p);
    saveSongClick(song.id, p);
  };
  const plan = useMemo(() => clickPlan(song, clickPrefs.sound), [song, clickPrefs.sound]);
  const clickOn = !!plan && clickPrefs.on;
  /** "Repetir cuenta": hora (performance.now) en que terminaría la cuenta. */
  const [countOnly, setCountOnly] = useState<number | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Sin reproducción no hay clic (salvo la cuenta suelta). Al cambiar de tema, se corta.
  useEffect(() => {
    if (player.clock.status !== "playing" && countOnly === null) metronome.stop();
  }, [player.clock.status, countOnly]);
  useEffect(() => () => metronome.stop(), []);

  /**
   * Arranca en `pos`. Con cuenta previa: suena solo el clic durante los
   * compases de cuenta y la letra arranca justo en el primer tiempo del tema.
   * El arranque se agenda contra la salida real del audio (+ latencia).
   */
  async function startAt(pos: number, withCount: boolean) {
    setCountOnly(null);
    if (!clickOn || !plan) {
      metronome.stop();
      player.playAt(pos, performance.now());
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = await metronome.ready();
      setAudioError(null);
    } catch {
      setAudioError("No se pudo usar el audio de este equipo: el tema arrancó sin clic.");
      player.playAt(pos, performance.now());
      return;
    }
    const lat = metronome.latencyMs;
    const t0 = ctx.currentTime + 0.12;
    if (withCount) {
      metronome.start(plan, t0, -plan.countInPulses);
      player.playAt(0, metronome.perfAt(t0 + plan.countInMs / 1000) + lat);
    } else {
      // Retomar en el medio: el clic sigue la grilla del tema desde ahí.
      const rate = player.clock.rate;
      const n = Math.ceil(pos / plan.pulseMs - 1e-6);
      metronome.start(plan, t0 + (n * plan.pulseMs - pos) / rate / 1000, n);
      player.playAt(pos, metronome.perfAt(t0) + lat);
    }
  }

  function togglePlay() {
    if (playing) {
      metronome.stop();
      if (player.position < 0) player.stop(); // pausa durante la cuenta: vuelve al principio
      else player.pause();
      return;
    }
    if (player.atEnd || player.position <= 0) void startAt(0, true);
    else void startAt(player.position, false);
  }

  function seek(ms: number) {
    if (player.position < 0) return; // durante la cuenta no se salta
    const to = Math.min(Math.max(0, ms), duration);
    if (playing) void startAt(to, false);
    else player.seek(to);
  }

  async function repeatCount() {
    if (!plan || playing) return;
    try {
      const ctx = await metronome.ready();
      const t0 = ctx.currentTime + 0.12;
      metronome.start(plan, t0, -plan.countInPulses, 0);
      setCountOnly(metronome.perfAt(t0 + plan.countInMs / 1000) + metronome.latencyMs);
    } catch {
      setAudioError("No se pudo usar el audio de este equipo.");
    }
  }

  function toggleClick() {
    const on = !clickPrefs.on;
    setClickPrefs({ ...clickPrefs, on });
    if (!on) {
      metronome.stop();
      setCountOnly(null);
    } else if (playing && player.position >= 0) void startAt(player.position, false);
  }

  function changeSound(s: ClickSound) {
    setClickPrefs({ ...clickPrefs, sound: s === song.sonidoClic ? null : s });
    metronome.setSound(s);
    if (!metronome.clicking) void metronome.preview(s);
  }

  // Cuenta suelta: refrescar la pantalla mientras dura.
  const [nowTick, setNowTick] = useState(() => performance.now());
  useEffect(() => {
    if (countOnly === null) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setNowTick(t);
      if (t > countOnly + 150) setCountOnly(null);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [countOnly]);

  const countView =
    countOnly !== null
      ? countInAt(plan, nowTick - countOnly, 1)
      : countInAt(plan, player.position, player.clock.rate);
  const sound: ClickSound = plan?.sound ?? song.sonidoClic ?? "madera";

  // Tempo de la letra: si el tema tiene BPM, se ajusta de a 1 BPM; si no, de a 2 %.
  // (El clic NO cambia: siempre va al BPM cargado.)
  const baseBpm = song.bpmManual;
  const bpm = baseBpm ? Math.round(baseBpm * player.clock.rate) : null;
  const stepRate = (dir: 1 | -1) => {
    const r = baseBpm ? (Math.round(baseBpm * player.clock.rate) + dir) / baseBpm : player.clock.rate + dir * 0.02;
    player.setRate(Math.min(2, Math.max(0.5, r)));
  };

  // Atajos de teclado (pedaleras bluetooth suelen mandar flechas/AvPág/espacio).
  const keys = useRef({ togglePlay, seek, position: shown, onPrev, onNext });
  useEffect(() => {
    keys.current = { togglePlay, seek, position: shown, onPrev, onNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.target instanceof HTMLSelectElement) return;
      if (e.target instanceof Element && e.target.closest(".overlay")) return;
      if (e.key === " " || e.key === "Enter") k.togglePlay();
      else if (e.key === "ArrowRight" || e.key === "PageDown") k.onNext();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") k.onPrev();
      else if (e.key === "ArrowDown") k.seek(k.position + 5000);
      else if (e.key === "ArrowUp") k.seek(k.position - 5000);
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
          {fmt(shown)}
          <span className="muted"> / {fmt(duration)}</span>
        </div>
      </header>
      <div className="progress">
        <div style={{ width: `${(shown / duration) * 100}%` }} />
      </div>

      <Lyrics timeline={timeline} active={active} onSeek={seek}>
        {player.atEnd && next && (
          <button className="next-up" onClick={onNext}>
            Siguiente: <strong>{next}</strong> →
          </button>
        )}
      </Lyrics>
      <CountIn view={countView} />

      <footer className="controls">
        {audioError && <p className="msg error small">{audioError}</p>}
        <div className="click-bar">
          {plan ? (
            <>
              <button
                className={`btn small ${clickOn ? "primary" : ""}`}
                onClick={toggleClick}
                title={clickOn ? "Silenciar el clic en este tema" : "Activar el clic en este tema"}
              >
                {clickOn ? "Clic: sí" : "Clic: no"}
              </button>
              <span className="muted small click-info">
                {plan.bpm} · {song.compas || "4/4"}
                {clickOn ? ` · cuenta ${plan.countInBars}` : " · sin cuenta"}
              </span>
              <select
                className="select"
                value={sound}
                onChange={(e) => changeSound(e.target.value as ClickSound)}
                aria-label="Sonido del clic"
              >
                {CLICK_SOUNDS.map((s) => (
                  <option key={s} value={s}>
                    {CLICK_SOUND_LABELS[s]}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={repeatCount} disabled={!clickOn || playing}>
                Cuenta
              </button>
            </>
          ) : (
            <span className="muted small">Este tema no tiene BPM: no hay clic ni cuenta previa.</span>
          )}
        </div>
        <div className="tempo">
          <span className="muted small">Letra</span>
          <button className="btn small" onClick={() => stepRate(-1)} aria-label="Más lento">−</button>
          <button className="tempo-value" onClick={() => player.setRate(1)} title="Volver al tempo original">
            {bpm ? `${bpm} BPM` : `${Math.round(player.clock.rate * 100)} %`}
            {player.clock.rate !== 1 && <span className="muted small"> ↺</span>}
          </button>
          <button className="btn small" onClick={() => stepRate(1)} aria-label="Más rápido">+</button>
        </div>
        <div className="transport">
          <button className="btn" onClick={onPrev} disabled={index === 0} aria-label="Tema anterior">⏮</button>
          <button className="btn" onClick={() => seek(shown - 5000)} aria-label="Atrás 5 s">−5s</button>
          <button className="btn play" onClick={togglePlay}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="btn" onClick={() => seek(shown + 5000)} aria-label="Adelante 5 s">+5s</button>
          <button className="btn" onClick={onNext} disabled={index === total - 1} aria-label="Tema siguiente">⏭</button>
        </div>
      </footer>
      {children}
    </div>
  );
}
