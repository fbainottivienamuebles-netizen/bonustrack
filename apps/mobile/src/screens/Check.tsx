// Chequeo previo al show: valida en este equipo lo necesario para tocar.
//
// - Setlists descargados (y videos, para la Pantalla).
// - Pantalla siempre encendida, batería, datos guardados.
// - Conexión con el director y Bluetooth.
// - Salida de audio hacia la consola: elegir salida, tono de prueba y clic.
// - Calibración de latencia: alinear lo que se ve con lo que se escucha.

import { useEffect, useRef, useState } from "react";
import {
  CLICK_SOUNDS,
  CLICK_SOUND_LABELS,
  clickPlan,
  flattenSetlist,
  type ClickPlan,
  type ClickSound,
  type OfflineBundle,
} from "@letras/shared";
import { bleAvailable, bleRequestAccess } from "../lib/ble";
import { probeDirector, type DirectorInfo } from "../lib/local-link";
import {
  listOutputs,
  metronome,
  onOutputsChange,
  sinkSelectionSupported,
  unlockDeviceLabels,
  type OutputDevice,
} from "../lib/metronome";
import { listBundles } from "../lib/storage";
import { videoStatus } from "../lib/videos";

type Level = "ok" | "warn" | "bad" | "info";

function Item({ level, title, children }: { level: Level; title: string; children?: React.ReactNode }) {
  const icon = { ok: "✓", warn: "!", bad: "✕", info: "·" }[level];
  return (
    <li className={`check-item ${level}`}>
      <span className="check-icon">{icon}</span>
      <div className="grow">
        <div className="check-title">{title}</div>
        {children && <div className="muted small">{children}</div>}
      </div>
    </li>
  );
}

export function Check({ director, onClose }: { director: DirectorInfo | null; onClose: () => void }) {
  return (
    <div className="screen scroll check">
      <header className="top">
        <h1>Chequeo previo</h1>
        <button className="btn small" onClick={onClose}>Listo</button>
      </header>
      <h2>Este equipo</h2>
      <ul className="check-list">
        <SetlistsCheck />
        <DeviceChecks />
        <ConnectionCheck director={director} />
      </ul>
      <h2>Salida de audio hacia la consola (Controlador)</h2>
      <AudioOutput />
      <h2>Latencia (alinear letra, video y clic)</h2>
      <Latency />
    </div>
  );
}

// ---------- Setlists ----------

function SetlistsCheck() {
  const [rows, setRows] = useState<
    { b: OfflineBundle; temas: number; sinBpm: number; videos: { total: number; saved: number } }[] | null
  >(null);
  useEffect(() => {
    (async () => {
      const list = await listBundles();
      setRows(
        await Promise.all(
          list.map(async (b) => {
            const ids = new Set(flattenSetlist(b.setlist.tandas).map((e) => e.songId));
            const songs = b.songs.filter((s) => ids.has(s.id));
            return { b, temas: ids.size, sinBpm: songs.filter((s) => !s.bpmManual).length, videos: await videoStatus(b) };
          }),
        ),
      );
    })().catch(() => setRows([]));
  }, []);

  if (!rows) return <Item level="info" title="Setlists: revisando…" />;
  if (rows.length === 0)
    return (
      <Item level="bad" title="No hay setlists descargados">
        Bajá el setlist del panel (con internet) antes de salir.
      </Item>
    );
  return (
    <>
      {rows.map(({ b, temas, sinBpm, videos }) => (
        <Item
          key={b.setlist.id}
          level={sinBpm || videos.saved < videos.total ? "warn" : "ok"}
          title={`“${b.setlist.nombre}” listo para usar sin internet`}
        >
          {temas} temas
          {sinBpm > 0 && ` · ${sinBpm} sin BPM (sin clic ni cuenta)`}
          {videos.total > 0 && ` · videos en este equipo: ${videos.saved} de ${videos.total}`}
          {videos.saved < videos.total && " (si este equipo es la Pantalla, volvé a bajar el setlist con internet)"}
        </Item>
      ))}
    </>
  );
}

// ---------- Pantalla, batería, almacenamiento, Bluetooth ----------

interface BatteryLike {
  level: number;
  charging: boolean;
}

function DeviceChecks() {
  const [battery, setBattery] = useState<BatteryLike | null | "none">(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [ble, setBle] = useState<string | null | "ok">(null);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (nav.getBattery) nav.getBattery().then((b) => setBattery({ level: b.level, charging: b.charging }), () => setBattery("none"));
    else setBattery("none");
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  return (
    <>
      <Item level={"wakeLock" in navigator ? "ok" : "warn"} title="Pantalla siempre encendida">
        {"wakeLock" in navigator
          ? "Durante el show la pantalla no se apaga."
          : "Este navegador no lo garantiza: configurá el equipo para que no apague la pantalla."}
      </Item>
      {battery === null ? null : battery === "none" ? (
        <Item level="info" title="Batería: este navegador no la informa">
          Para un show de dos tandas, llegá con el equipo cargado o enchufado.
        </Item>
      ) : (
        <Item
          level={battery.charging || battery.level >= 0.6 ? "ok" : battery.level >= 0.3 ? "warn" : "bad"}
          title={`Batería ${Math.round(battery.level * 100)} %${battery.charging ? " · cargando" : ""}`}
        >
          {!battery.charging && battery.level < 0.6 && "Para un show de dos tandas conviene cargarlo o enchufarlo."}
        </Item>
      )}
      {persisted === false && (
        <Item level="warn" title="Datos guardados sin protección">
          El sistema podría borrar los setlists si se queda sin espacio. Instalá la app (Agregar a inicio) para evitarlo.
        </Item>
      )}
      {bleAvailable && (
        <Item level={ble === "ok" ? "ok" : ble ? "bad" : "info"} title="Bluetooth">
          {ble === "ok" ? (
            "Permisos dados y Bluetooth prendido."
          ) : (
            <>
              {ble && <span>{ble} </span>}
              <button className="btn small" onClick={async () => setBle((await bleRequestAccess()) ?? "ok")}>
                Probar Bluetooth
              </button>
            </>
          )}
        </Item>
      )}
    </>
  );
}

function ConnectionCheck({ director }: { director: DirectorInfo | null }) {
  const [alive, setAlive] = useState<boolean | null>(null);
  useEffect(() => {
    if (!director) return;
    probeDirector(director.base).then((i) => setAlive(!!i));
  }, [director]);

  if (!director)
    return (
      <Item level="info" title="Sin director en esta red">
        Para el show en grupo, abrí la app desde la dirección (o el QR) que muestra la notebook del director.
      </Item>
    );
  if (director.isHost)
    return (
      <Item level={alive === false ? "bad" : "ok"} title="Esta notebook es el director">
        {alive === false ? "El servidor del director no responde: volvé a abrir Director.bat." : "Los equipos se conectan por WiFi a esta notebook."}
      </Item>
    );
  return (
    <Item
      level={alive === null ? "info" : alive ? "ok" : "bad"}
      title={alive === false ? "No se llega al director" : "Conectado al director"}
    >
      {director.base.replace(/^https?:\/\//, "")}
    </Item>
  );
}

// ---------- Salida de audio ----------

function AudioOutput() {
  const [outs, setOuts] = useState<OutputDevice[]>([]);
  const [sinkId, setSinkId] = useState(metronome.audioPrefs.sinkId);
  const [tone, setTone] = useState(metronome.toneOn);
  const [sound, setSound] = useState<ClickSound>("madera");
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => listOutputs().then(setOuts, () => setOuts([]));
  useEffect(() => {
    refresh();
    return onOutputsChange(refresh);
  }, []);
  useEffect(() => () => void metronome.setTone(false), []);

  const noLabels = outs.length > 0 && outs.every((o) => /^Salida \d+$/.test(o.label));

  return (
    <div className="check-box">
      <p className="muted small">
        Conectá la salida de auriculares (o la placa USB) a una <strong>caja directa (DI)</strong> y de ahí a un canal
        de la consola. El clic sale a nivel fijo: el volumen lo maneja el sonidista. Si el equipo tiene parlante, bajalo
        o conectá el cable antes, así el clic no suena en el escenario.
      </p>
      {sinkSelectionSupported && outs.length > 0 ? (
        <label className="field">
          <span>Salida del clic</span>
          <select
            className="select full"
            value={sinkId}
            onChange={async (e) => {
              setSinkId(e.target.value);
              await metronome.setAudioPrefs({ ...metronome.audioPrefs, sinkId: e.target.value });
              setMsg(metronome.outputError);
            }}
          >
            <option value="">La del sistema</option>
            {outs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {noLabels && (
            <button
              className="btn small"
              style={{ marginTop: ".4rem" }}
              onClick={async () => {
                setMsg(await unlockDeviceLabels());
                refresh();
              }}
            >
              Mostrar los nombres de las salidas
            </button>
          )}
        </label>
      ) : (
        <p className="muted small">El clic sale por la salida de audio del sistema (la que esté conectada).</p>
      )}
      <div className="row wrap">
        <button
          className={`btn ${tone ? "primary" : ""}`}
          onClick={async () => {
            await metronome.setTone(!tone);
            setTone(!tone);
          }}
        >
          {tone ? "■ Parar tono de prueba" : "▶ Tono de prueba (1 kHz)"}
        </button>
        <select className="select" value={sound} onChange={(e) => setSound(e.target.value as ClickSound)}>
          {CLICK_SOUNDS.map((s) => (
            <option key={s} value={s}>
              {CLICK_SOUND_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => metronome.preview(sound, 2)}>Probar clic</button>
      </div>
      {msg && <p className="msg error small">{msg}</p>}
    </div>
  );
}

// ---------- Latencia ----------

const CAL_BPM = 90;

function Latency() {
  const [latency, setLatency] = useState<number>(() => metronome.latencyMs);
  const [auto, setAuto] = useState(metronome.audioPrefs.latencyMs === null);
  const [run, setRun] = useState<{ startPerf: number; plan: ClickPlan } | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [flash, setFlash] = useState(false);
  const busy = metronome.clicking && !run;

  const save = (ms: number | null) => {
    const v = ms === null ? null : Math.max(0, Math.min(500, Math.round(ms)));
    void metronome.setAudioPrefs({ ...metronome.audioPrefs, latencyMs: v });
    setAuto(v === null);
    setLatency(metronome.latencyMs);
  };

  async function start() {
    const ctx = await metronome.ready();
    const plan = clickPlan({ bpmManual: CAL_BPM, compas: "4/4", compasesCuenta: 1 }, "madera")!;
    const t0 = ctx.currentTime + 0.2;
    metronome.start(plan, t0, 0);
    setTaps([]);
    setLatency(metronome.latencyMs);
    setRun({ startPerf: metronome.perfAt(t0), plan });
  }
  function stop() {
    metronome.stop();
    setRun(null);
  }
  useEffect(() => () => metronome.stop(), []);

  // Destello en el momento en que se tendría que escuchar cada clic.
  const latRef = useRef(latency);
  useEffect(() => {
    latRef.current = latency;
  }, [latency]);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const tick = () => {
      const since = performance.now() - run.startPerf - latRef.current;
      const inBeat = ((since % run.plan.pulseMs) + run.plan.pulseMs) % run.plan.pulseMs;
      setFlash(since >= 0 && inBeat < 90);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  // Medir tocando: diferencia entre cada toque y el clic agendado más cercano.
  function tap() {
    if (!run) return;
    const since = performance.now() - run.startPerf;
    const k = Math.round(since / run.plan.pulseMs);
    const offset = since - k * run.plan.pulseMs;
    const next = [...taps, offset].slice(-12);
    setTaps(next);
    if (next.length >= 8) {
      const sorted = [...next].sort((a, b) => a - b);
      save(sorted[Math.floor(sorted.length / 2)]);
    }
  }

  return (
    <div className="check-box">
      <p className="muted small">
        Con el clic sonando por la consola (o con auriculares en este equipo), mirá el círculo: tiene que encenderse{" "}
        <strong>justo</strong> cuando escuchás cada clic. Si se enciende antes, subí los ms; si se enciende después,
        bajalos. También podés tocar “Medir” al ritmo de lo que escuchás 8 veces.
      </p>
      <div className="latency">
        <div className={`latency-dot ${flash ? "on" : ""}`} />
        <div className="latency-value">
          {latency} ms <span className="muted small">{auto ? "(automático)" : "(calibrado)"}</span>
        </div>
      </div>
      <div className="row wrap">
        {run ? (
          <button className="btn" onClick={stop}>■ Parar</button>
        ) : (
          <button className="btn primary" onClick={start} disabled={busy}>
            ▶ Probar
          </button>
        )}
        <button className="btn small" onClick={() => save(latency - 20)}>−20</button>
        <button className="btn small" onClick={() => save(latency - 5)}>−5</button>
        <button className="btn small" onClick={() => save(latency + 5)}>+5</button>
        <button className="btn small" onClick={() => save(latency + 20)}>+20</button>
        <button className="btn small" onClick={() => save(null)} disabled={auto}>Automático</button>
      </div>
      {run && (
        <button className="btn full big" onPointerDown={tap}>
          Medir: tocá acá con cada clic que escuchás {taps.length > 0 && `(${Math.min(taps.length, 8)}/8)`}
        </button>
      )}
      {busy && <p className="muted small">Hay un tema sonando: pausalo para calibrar.</p>}
    </div>
  );
}
