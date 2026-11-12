// Seguidor: muestra la letra que marca el director, sin controles de show.
//
// - "lista": celulares y tablets.
// - "escenario": monitores para las cantantes (letra más grande, sin botones
//   a la vista; un click pone pantalla completa).
// - "video": la Pantalla para el público (proyector): video de fondo del
//   tema, sin letra (ver VideoStage).
//
// Fuentes: WiFi local (servidor del director) o Bluetooth (puente Android).
// Si la conexión se corta, la letra sigue avanzando con el reloj propio.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTimeline,
  clickPlan,
  clockFromState,
  countInAt,
  clockPosition,
  flattenSetlist,
  hash32,
  lineAt,
  songDurationMs,
  type OfflineBundle,
  type PlaybackClock,
} from "@letras/shared";
import { CountIn } from "../components/CountIn";
import { Lyrics } from "../components/Lyrics";
import {
  BLE_LATENCY_MS,
  bleAdvertise,
  bleAvailable,
  bleListen,
  bleRequestAccess,
  bleStopAdvertising,
} from "../lib/ble";
import { loadFollowPrefs, saveFollowPrefs, type FollowPrefs } from "../lib/device";
import { fmt } from "../lib/format";
import { useLocalLink } from "../lib/local-link";
import { listBundles, putBundle } from "../lib/storage";
import { useFollowClock } from "../lib/use-follow-clock";
import { saveBundleVideos } from "../lib/videos";
import { VideoStage } from "./VideoStage";
import { allowScreenOff, keepScreenOn } from "../lib/wake";

export type FollowMode = "lista" | "escenario" | "video";
export type FollowSource = { kind: "wifi"; base: string } | { kind: "ble" };

type Conn = { ok: boolean; text: string };

export interface Where {
  bundle: OfflineBundle | null;
  entryIndex: number;
  conn: Conn;
  missing?: string;
}

interface Props {
  mode: FollowMode;
  onExit: () => void;
}

export function Follow({ source, ...props }: Props & { source: FollowSource }) {
  useEffect(() => {
    keepScreenOn();
    return () => void allowScreenOff();
  }, []);
  return source.kind === "wifi" ? <FollowWifi base={source.base} {...props} /> : <FollowBle {...props} />;
}

function FollowBle({ mode, onExit }: Props) {
  const { clock, position, apply } = useFollowClock();
  const where = useBle(apply);
  if (mode === "video")
    return <VideoStage where={where} clock={clock} position={position} director={null} onExit={onExit} />;
  return <FollowView where={where} position={position} playing={clock.status === "playing"} rate={clock.rate} mode={mode} onExit={onExit} />;
}

function FollowWifi({ base, mode, onExit }: Props & { base: string }) {
  const { clock, position, apply } = useFollowClock();
  const where = useWifi(base, mode, apply);

  const [bridge, setBridge] = useState(false);
  const [bridgeMsg, setBridgeMsg] = useState<string | null>(null);
  useBridge(bridge, where, clock);

  if (mode === "video")
    return <VideoStage where={where} clock={clock} position={position} director={base} onExit={onExit} />;

  return (
    <FollowView
      where={where}
      position={position}
      playing={clock.status === "playing"} rate={clock.rate}
      mode={mode}
      onExit={onExit}
      extra={
        bleAvailable && (
          <>
            <button
              className={`btn small ${bridge ? "primary" : ""}`}
              onClick={async () => {
                if (bridge) {
                  setBridge(false);
                  setBridgeMsg(null);
                  return;
                }
                const err = await bleRequestAccess();
                if (err) setBridgeMsg(err);
                else {
                  setBridge(true);
                  setBridgeMsg("Transmitiendo por Bluetooth a los Android cercanos.");
                }
              }}
            >
              {bridge ? "Puente BT: sí" : "Puente BT: no"}
            </button>
            {bridgeMsg && <span className="muted small">{bridgeMsg}</span>}
          </>
        )
      }
    />
  );
}

// ---------- WiFi ----------

function useWifi(base: string, mode: FollowMode, apply: (c: PlaybackClock, tol?: number) => void): Where {
  const { link, snap } = useLocalLink(base, mode === "video" ? "pantalla" : "seguidor");
  const bundle = snap?.bundle ?? null;
  const st = snap?.state ?? null;

  // Guardar el setlist en el equipo (sirve después para seguir por Bluetooth).
  // La Pantalla también se guarda los videos (los baja del director).
  useEffect(() => {
    if (!bundle) return;
    putBundle(bundle).catch(() => {});
    if (mode === "video") saveBundleVideos(bundle, { director: base }).catch(() => {});
  }, [bundle, mode, base]);

  const ready = !!link && snap?.status === "online";
  useEffect(() => {
    if (!link || !st || !link.sync.ready) return;
    apply(clockFromState(st.state, st.at, link.serverNow(), performance.now()));
  }, [link, st, ready, apply]);

  const matches = bundle && st && st.state.setlistId === bundle.setlist.id;
  return {
    bundle,
    entryIndex: matches ? st.state.entryIndex : 0,
    conn:
      snap?.status === "online"
        ? { ok: true, text: "WiFi" }
        : snap?.status === "offline"
          ? { ok: false, text: "Sin conexión con el director · siguiendo solo" }
          : { ok: false, text: "Conectando…" },
  };
}

// ---------- Bluetooth ----------

function useBle(apply: (c: PlaybackClock, tol?: number) => void): Where {
  const [bundles, setBundles] = useState<Map<number, OfflineBundle> | null>(null);
  const [cur, setCur] = useState<{ hash: number; entryIndex: number } | null>(null);
  const [lastAt, setLastAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const lastSeq = useRef(-1);

  useEffect(() => {
    listBundles().then((list) => setBundles(new Map(list.map((b) => [hash32(b.setlist.id), b]))));
  }, []);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const err = await bleRequestAccess();
      if (err) return setError(err);
      try {
        const off = await bleListen((p) => {
          setLastAt(performance.now());
          if (p.seq === lastSeq.current) return; // el mismo aviso repetido
          lastSeq.current = p.seq;
          setCur((c) => (c && c.hash === p.setlistHash && c.entryIndex === p.entryIndex ? c : { hash: p.setlistHash, entryIndex: p.entryIndex }));
          const extra = p.status === "playing" ? BLE_LATENCY_MS * p.rate : 0;
          apply(
            { status: p.status, anchorPositionMs: p.positionMs + extra, anchorWallMs: performance.now(), rate: p.rate },
            150,
          );
        });
        if (cancelled) off();
        else stop = off;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [apply]);

  // Re-evaluar cada segundo si seguimos recibiendo.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const receiving = lastAt > 0 && performance.now() - lastAt < 3000;
  const bundle = cur && bundles ? (bundles.get(cur.hash) ?? null) : null;
  return {
    bundle,
    entryIndex: cur?.entryIndex ?? 0,
    conn: error
      ? { ok: false, text: error }
      : receiving
        ? { ok: true, text: "Bluetooth" }
        : lastAt
          ? { ok: false, text: "Sin señal Bluetooth · siguiendo solo" }
          : { ok: false, text: "Buscando la señal Bluetooth…" },
    missing:
      cur && bundles && !bundle
        ? "El director está usando un setlist que este equipo no tiene. Descargalo del panel (con internet) y volvé a entrar."
        : undefined,
  };
}

/** Puente: retransmite por Bluetooth lo que llega por WiFi. */
function useBridge(on: boolean, where: Where, clock: PlaybackClock) {
  const ref = useRef({ where, clock });
  useEffect(() => {
    ref.current = { where, clock };
  });
  const seq = useRef(Math.floor(Math.random() * 0xffff));

  useEffect(() => {
    if (!on) return;
    const send = () => {
      const { where: w, clock: c } = ref.current;
      if (!w.bundle) return;
      bleAdvertise({
        seq: ++seq.current,
        setlistHash: hash32(w.bundle.setlist.id),
        entryIndex: w.entryIndex,
        status: c.status,
        positionMs: clockPosition(c, performance.now()),
        rate: c.rate,
      }).catch(() => {});
    };
    send();
    const id = window.setInterval(send, 1000);
    return () => {
      clearInterval(id);
      bleStopAdvertising();
    };
  }, [on]);

  // Cambios (play, pausa, tema) salen al instante, sin esperar el segundo.
  useEffect(() => {
    if (!on || !where.bundle) return;
    bleAdvertise({
      seq: ++seq.current,
      setlistHash: hash32(where.bundle.setlist.id),
      entryIndex: where.entryIndex,
      status: clock.status,
      positionMs: clockPosition(clock, performance.now()),
      rate: clock.rate,
    }).catch(() => {});
  }, [on, clock, where.bundle, where.entryIndex]);
}

// ---------- Vista ----------

function FollowView({
  where,
  position,
  playing,
  rate,
  mode,
  onExit,
  extra,
}: {
  where: Where;
  position: number;
  playing: boolean;
  rate: number;
  mode: FollowMode;
  onExit: () => void;
  extra?: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<FollowPrefs>(() => loadFollowPrefs(mode));
  const update = (p: Partial<FollowPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveFollowPrefs(mode, next);
  };

  // En escenario los botones se esconden solos; un toque los muestra.
  const stage = mode === "escenario";
  const [controlsAt, setControlsAt] = useState(() => performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (!stage) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [stage]);
  const showControls = !stage || performance.now() - controlsAt < 5000;
  const poke = () => {
    setControlsAt(performance.now());
    if (stage && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const { bundle } = where;
  const entries = useMemo(() => (bundle ? flattenSetlist(bundle.setlist.tandas) : []), [bundle]);
  const songs = useMemo(() => new Map((bundle?.songs ?? []).map((s) => [s.id, s])), [bundle]);
  const entry = entries[Math.min(where.entryIndex, entries.length - 1)];
  const song = entry ? songs.get(entry.songId) : undefined;
  const timeline = useMemo(() => (song ? buildTimeline(song.secciones) : []), [song]);
  const plan = useMemo(() => (song ? clickPlan(song) : null), [song]);

  const status = (
    <span className={`room-badge ${where.conn.ok ? "ok" : "bad"}`} title={where.conn.text}>
      {where.conn.ok ? `● ${where.conn.text}` : `○ ${where.conn.text}`}
    </span>
  );

  if (!bundle || !song || !entry) {
    return (
      <div className="screen center" onClick={poke}>
        <h1>Letras en vivo</h1>
        {status}
        <p className="muted">
          {where.missing ?? "Esperando que el director abra un setlist…"}
        </p>
        <button className="btn" onClick={onExit}>Salir</button>
      </div>
    );
  }

  const duration = songDurationMs(song);
  const shown = Math.min(Math.max(0, position), duration);
  // Durante la cuenta previa (posición negativa) todavía no se marca ninguna línea.
  const active = lineAt(timeline, Math.min(position, duration) + prefs.leadMs);
  const nextEntry = entries[where.entryIndex + 1];

  return (
    <div className={`screen show follow ${stage ? "stage" : ""} ${showControls ? "" : "idle"}`} onClick={poke}>
      <header className="show-head">
        <div className="grow">
          <div className="muted small">
            {entry.tandaNombre} · {where.entryIndex + 1}/{entries.length}
            {!playing && " · en pausa"}
          </div>
          <div className="title">{song.titulo}</div>
        </div>
        {status}
        <div className="time">
          {fmt(shown)}
          <span className="muted"> / {fmt(duration)}</span>
        </div>
      </header>
      <div className="progress">
        <div style={{ width: `${(shown / duration) * 100}%` }} />
      </div>

      <Lyrics timeline={timeline} active={active} scale={prefs.scale}>
        {nextEntry && shown >= duration - 15000 && (
          <div className="next-up static">
            Siguiente: <strong>{songs.get(nextEntry.songId)?.titulo}</strong>
          </div>
        )}
      </Lyrics>
      <CountIn view={countInAt(plan, position, rate)} />

      {showControls && (
        <footer className="follow-bar" onClick={(e) => e.stopPropagation()}>
          <div className="group">
            <span className="muted small">Letra</span>
            <button className="btn small" onClick={() => update({ scale: Math.max(0.6, +(prefs.scale - 0.1).toFixed(2)) })}>A−</button>
            <button className="btn small" onClick={() => update({ scale: Math.min(3, +(prefs.scale + 0.1).toFixed(2)) })}>A+</button>
          </div>
          <div className="group" title="Si la letra se marca tarde, adelantala">
            <span className="muted small">Adelanto</span>
            <button className="btn small" onClick={() => update({ leadMs: Math.max(-1000, prefs.leadMs - 50) })}>−</button>
            <span className="lead">{(prefs.leadMs / 1000).toFixed(2).replace(".", ",")} s</span>
            <button className="btn small" onClick={() => update({ leadMs: Math.min(1000, prefs.leadMs + 50) })}>+</button>
          </div>
          {extra && <div className="group">{extra}</div>}
          <button className="btn small danger" onClick={onExit}>Salir</button>
        </footer>
      )}
    </div>
  );
}
