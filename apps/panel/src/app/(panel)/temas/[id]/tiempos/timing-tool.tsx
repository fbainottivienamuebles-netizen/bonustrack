"use client";

// Marcar los tiempos de cada línea escuchando una grabación propia o el tema
// en Spotify. El archivo local se reproduce desde la compu (no se sube a
// ningún lado, salvo que se use la detección automática: ahí se manda a
// Groq para transcribirla, sin guardarla); de Spotify se usa su reproductor
// embebido. Sólo se guardan los tiempos.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SECTION_LABELS, buildTimeline, formatTime, lineAt, type Song } from "@letras/shared";
import { saveTimesAction } from "@/app/actions";
import { fmtDuration } from "@/lib/format";
import { alignLines, transcribe } from "@/lib/auto-timing";

type Times = (number | null)[];
type Source = "file" | "spotify";

// --- Spotify iFrame API (https://developer.spotify.com/documentation/embeds) ---

interface SpotifyPlaybackUpdate {
  data: { isPaused: boolean; isBuffering: boolean; duration: number; position: number };
}
interface SpotifyController {
  addListener(event: "ready", cb: () => void): void;
  addListener(event: "playback_update", cb: (e: SpotifyPlaybackUpdate) => void): void;
  togglePlay(): void;
  seek(seconds: number): void;
  destroy(): void;
}
interface SpotifyIFrameAPI {
  createController(
    el: HTMLElement,
    opts: { uri: string; width?: string | number; height?: string | number },
    cb: (c: SpotifyController) => void,
  ): void;
}

let spotifyApi: Promise<SpotifyIFrameAPI> | null = null;
function loadSpotifyApi(): Promise<SpotifyIFrameAPI> {
  if (spotifyApi) return spotifyApi;
  spotifyApi = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    (window as unknown as { onSpotifyIframeApiReady: (api: SpotifyIFrameAPI) => void }).onSpotifyIframeApiReady = resolve;
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    s.onerror = () => {
      spotifyApi = null;
      s.remove();
      reject(new Error("spotify"));
    };
    document.body.appendChild(s);
  });
  return spotifyApi;
}

/** Saca el id del tema de un link (open.spotify.com/…/track/ID) o URI (spotify:track:ID). */
function spotifyTrackId(input: string): string | null {
  const m = input
    .trim()
    .match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

const now = () => performance.now();

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

interface Mark {
  index: number;
  prev: number | null;
  prevCursor: number;
}

/** Completa las líneas sin marcar repartiéndolas entre sus vecinas marcadas. */
function fillGaps(times: Times, endMs: number): number[] {
  const out = [...times];
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === null) j++;
    const prev = i > 0 ? (out[i - 1] as number) : 0;
    const next = j < out.length ? (out[j] as number) : endMs;
    const slots = i > 0 ? j - i + 1 : j - i;
    const step = Math.max(0, (next - prev) / Math.max(slots, 1));
    for (let k = i; k < j; k++) out[k] = Math.round(prev + step * (i > 0 ? k - i + 1 : k - i));
    i = j;
  }
  return out as number[];
}

/** Idioma probable de la letra (ayuda a Whisper a no confundirse en la intro). */
function guessLanguage(lines: string[]): string | undefined {
  const es = new Set(["que", "de", "la", "el", "y", "en", "mi", "te", "no", "me", "tu", "lo", "por", "con", "se", "es", "un", "una"]);
  const en = new Set(["the", "you", "i", "and", "to", "my", "me", "it", "in", "your", "is", "of", "on", "that", "we", "be", "don't"]);
  let a = 0;
  let b = 0;
  for (const w of lines.join(" ").toLowerCase().split(/[\s,.;:!?¡¿"()]+/)) {
    if (es.has(w)) a++;
    if (en.has(w)) b++;
  }
  if (a + b < 5) return undefined;
  return a >= b * 2 ? "es" : b >= a * 2 ? "en" : undefined;
}

export function TimingTool({ song }: { song: Song }) {
  const router = useRouter();
  const timeline = useMemo(() => buildTimeline(song.secciones), [song]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const fileName = file?.name ?? null;
  const [src, setSrc] = useState<string | null>(null);
  const [audioDur, setAudioDur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [rate, setRate] = useState(1);

  const [source, setSource] = useState<Source>("file");
  const spKey = `letras:spotify:${song.id}`;
  const [spInput, setSpInput] = useState("");
  const [spId, setSpId] = useState<string | null>(null);
  const [spReady, setSpReady] = useState(false);
  const spWrapRef = useRef<HTMLDivElement>(null);
  // Última posición informada por Spotify; entre avisos se estima con el reloj.
  const sp = useRef({ controller: null as SpotifyController | null, pos: 0, at: 0, paused: true, dur: 0 });

  const [times, setTimes] = useState<Times>(() => timeline.map((l) => l.tiempoInicioMs));
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<Mark[]>([]);
  const [useAudioDur, setUseAudioDur] = useState(true);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [detecting, setDetecting] = useState<string | null>(null);
  /** Confianza (0 a 1) de las líneas detectadas solas; null si no hubo detección. */
  const [auto, setAuto] = useState<(number | null)[] | null>(null);

  // Liberar el archivo al cambiarlo o salir.
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  /** Posición actual de la fuente elegida, en ms. */
  function currentMs(): number {
    if (source === "file") return (audioRef.current?.currentTime ?? 0) * 1000;
    const s = sp.current;
    const ms = s.paused ? s.pos : s.pos + (performance.now() - s.at);
    return s.dur ? Math.min(ms, s.dur) : ms;
  }

  // Posición en cada frame mientras suena.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setPosMs(currentMs());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, source]);

  // Reproductor de Spotify.
  useEffect(() => {
    if (source !== "spotify" || !spId) return;
    const wrap = spWrapRef.current;
    if (!wrap) return;
    let cancelled = false;
    let controller: SpotifyController | null = null;
    loadSpotifyApi()
      .then((api) => {
        if (cancelled) return;
        // El API reemplaza el elemento por el iframe: usamos uno propio, fuera de React.
        const host = document.createElement("div");
        wrap.appendChild(host);
        api.createController(host, { uri: `spotify:track:${spId}`, width: "100%", height: 152 }, (c) => {
          if (cancelled) return c.destroy();
          controller = c;
          sp.current = { controller: c, pos: 0, at: performance.now(), paused: true, dur: 0 };
          c.addListener("ready", () => setSpReady(true));
          c.addListener("playback_update", (e) => {
            const { isPaused, isBuffering, position, duration } = e.data;
            const s = sp.current;
            s.pos = position;
            s.at = performance.now();
            s.paused = isPaused || isBuffering;
            if (duration > 0 && duration !== s.dur) {
              s.dur = duration;
              setAudioDur(duration / 1000);
            }
            setPlaying(!isPaused);
            if (s.paused) setPosMs(position);
          });
        });
      })
      .catch(() => {
        if (!cancelled) setStatus({ error: true, text: "No se pudo cargar el reproductor de Spotify. Revisá la conexión." });
      });
    return () => {
      cancelled = true;
      controller?.destroy();
      sp.current.controller = null;
      wrap.innerHTML = "";
      setSpReady(false);
      setPlaying(false);
      setAudioDur(null);
      setPosMs(0);
    };
  }, [source, spId]);

  // Si se hace clic en el reproductor de Spotify, el foco queda en su iframe y
  // los atajos dejan de llegar: lo devolvemos a la página.
  useEffect(() => {
    if (source !== "spotify") return;
    const onBlur = () =>
      setTimeout(() => {
        const el = document.activeElement;
        if (el instanceof HTMLIFrameElement && spWrapRef.current?.contains(el)) el.blur();
      }, 0);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [source]);

  function switchSource(s: Source) {
    if (s === source) return;
    audioRef.current?.pause(); // un <audio> desmontado puede seguir sonando
    setPlaying(false);
    setPosMs(0);
    setAudioDur(null);
    setSource(s);
    // Recordar el último link de Spotify usado para este tema.
    if (s === "spotify" && !spInput) {
      const saved = storageGet(spKey);
      if (saved) {
        setSpInput(saved);
        setSpId(spotifyTrackId(saved));
      }
    }
  }

  function loadSpotify() {
    const id = spotifyTrackId(spInput);
    if (!id) {
      setStatus({ error: true, text: "Ese link no parece de un tema de Spotify (open.spotify.com/track/…)." });
      return;
    }
    setStatus(null);
    storageSet(spKey, spInput.trim());
    setSpId(id);
  }

  const ready = source === "file" ? !!src : spReady;

  // Avisar si se sale con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const endMs = (useAudioDur && audioDur ? audioDur : song.duracionSegundos) * 1000;
  const filled = useMemo(() => fillGaps(times, endMs), [times, endMs]);
  const playingLine = useMemo(
    () => lineAt(timeline.map((l, i) => ({ ...l, tiempoInicioMs: filled[i] })), posMs),
    [timeline, filled, posMs],
  );

  // Mantener visible la próxima línea a marcar.
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor]);

  const audio = () => audioRef.current;

  function togglePlay() {
    if (source === "spotify") {
      sp.current.controller?.togglePlay();
      return;
    }
    const a = audio();
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function seek(ms: number) {
    if (source === "spotify") {
      const s = sp.current;
      if (!s.controller) return;
      const t = Math.max(0, s.dur ? Math.min(ms, s.dur) : ms);
      s.controller.seek(t / 1000);
      s.pos = t;
      s.at = now();
      setPosMs(t);
      return;
    }
    const a = audio();
    if (!a) return;
    a.currentTime = Math.max(0, ms / 1000);
    setPosMs(a.currentTime * 1000);
  }

  function mark() {
    if (!ready || cursor >= timeline.length) return;
    const t = Math.round(currentMs());
    setHistory((h) => [...h, { index: cursor, prev: times[cursor], prevCursor: cursor }]);
    setTimes((ts) => ts.map((x, i) => (i === cursor ? t : x)));
    setSelected(cursor);
    reviewed(cursor);
    setCursor((c) => c + 1);
    setDirty(true);
    setStatus(null);
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setTimes((ts) => ts.map((x, i) => (i === last.index ? last.prev : x)));
    setCursor(last.prevCursor);
    setSelected(last.index);
    setDirty(true);
  }

  function nudge(deltaMs: number) {
    if (selected === null) return;
    setTimes((ts) => ts.map((x, i) => (i === selected ? Math.max(0, (x ?? filled[i]) + deltaMs) : x)));
    reviewed(selected);
    setDirty(true);
  }

  function clearAll() {
    if (!confirm("¿Borrar todos los tiempos y marcar desde cero?")) return;
    setHistory([]);
    setTimes(timeline.map(() => null));
    setCursor(0);
    setSelected(null);
    setAuto(null);
    seek(0);
    setDirty(true);
  }

  function reviewed(i: number) {
    setAuto((a) => (a ? a.map((x, k) => (k === i ? null : x)) : a));
  }

  async function detect() {
    if (!file || detecting) return;
    if (markedCount > 0 && !confirm("La detección automática reemplaza los tiempos que hay ahora. ¿Seguir?")) return;
    setStatus(null);
    try {
      const words = await transcribe(file, setDetecting, guessLanguage(timeline.map((l) => l.texto)));
      setDetecting("Buscando dónde empieza cada línea…");
      const guesses = alignLines(timeline.map((l) => l.texto), words);
      const found = guesses.filter((g) => g.ms !== null).length;
      if (found === 0) {
        setStatus({ error: true, text: "No se pudo reconocer la letra en la grabación. Probá con otra grabación o marcá a mano." });
        return;
      }
      setHistory([]);
      setTimes(guesses.map((g) => g.ms));
      setAuto(guesses.map((g) => (g.ms === null ? null : g.confidence)));
      setCursor(Math.max(0, guesses.findIndex((g) => g.ms === null)));
      setSelected(null);
      setDirty(true);
      const missing = timeline.length - found;
      setStatus({
        text:
          `Listo: se detectaron ${found} de ${timeline.length} líneas.` +
          (missing ? ` Las ${missing} en gris no se encontraron: marcalas a mano.` : "") +
          " Revisá las marcadas con ⚠ y guardá.",
      });
    } catch (e) {
      setStatus({ error: true, text: e instanceof Error ? e.message : "No se pudo analizar la grabación." });
    } finally {
      setDetecting(null);
    }
  }

  function selectLine(i: number) {
    setSelected(i);
    setCursor(i);
    seek(Math.max(0, filled[i] - 2000)); // 2 s antes, para escuchar la entrada
  }

  async function save() {
    for (let i = 1; i < filled.length; i++)
      if (filled[i] < filled[i - 1]) {
        setStatus({ error: true, text: `La línea ${i + 1} (“${timeline[i].texto}”) quedó antes que la anterior. Corregila antes de guardar.` });
        setSelected(i);
        return;
      }
    setSaving(true);
    const res = await saveTimesAction(
      song.id,
      filled,
      useAudioDur && audioDur ? Math.round(audioDur) : null,
    );
    setSaving(false);
    if (res.error) setStatus({ error: true, text: res.error });
    else {
      setStatus({ text: "Tiempos guardados." });
      setDirty(false);
      router.refresh();
    }
  }

  // Atajos de teclado.
  const keys = useRef({ mark, undo, togglePlay, seek, posMs, nudge });
  useEffect(() => {
    keys.current = { mark, undo, togglePlay, seek, posMs, nudge };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignorar sólo mientras se escribe texto; en el resto (archivo, barra de
      // posición, velocidad, botones) los atajos tienen que funcionar igual.
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "TEXTAREA" ||
        (el?.tagName === "INPUT" && ["text", "number", "search", "url", "email", "password"].includes((el as HTMLInputElement).type));
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys.current;
      if (e.code === "Space") k.mark();
      else if (e.key === "Enter") k.togglePlay();
      else if (e.key === "Backspace") k.undo();
      else if (e.key === "ArrowLeft") k.seek(k.posMs - 3000);
      else if (e.key === "ArrowRight") k.seek(k.posMs + 3000);
      else if (e.key === "ArrowUp") k.nudge(-100);
      else if (e.key === "ArrowDown") k.nudge(100);
      else return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const markedCount = times.filter((t) => t !== null).length;

  if (timeline.length === 0) {
    return <p className="card p-6 text-sm text-muted">Este tema no tiene letra. Cargala primero en la ficha del tema.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        {/* Reproductor */}
        <div className="card space-y-3 p-4">
          <div className="flex gap-1 rounded-lg bg-accent/5 p-1 text-sm" role="tablist">
            {(
              [
                ["file", "Grabación propia"],
                ["spotify", "Spotify"],
              ] as const
            ).map(([s, label]) => (
              <button
                key={s}
                role="tab"
                aria-selected={source === s}
                onClick={(e) => {
                  switchSource(s);
                  e.currentTarget.blur();
                }}
                className={`flex-1 rounded-md px-3 py-1.5 ${source === s ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {source === "spotify" && (
            <>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  loadSpotify();
                  (document.activeElement as HTMLElement | null)?.blur?.();
                }}
              >
                <input
                  type="url"
                  className="input min-w-0 flex-1"
                  placeholder="Pegá el link del tema: https://open.spotify.com/track/…"
                  value={spInput}
                  onChange={(e) => setSpInput(e.target.value)}
                />
                <button className="btn" type="submit">Cargar</button>
              </form>
              <div ref={spWrapRef} />
              {spId && (
                <p className="text-xs text-muted">
                  Si sólo suena una muestra de 30 s, iniciá sesión en Spotify en este navegador y recargá la página.
                </p>
              )}
            </>
          )}

          {source === "file" && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn cursor-pointer">
              {fileName ? "Cambiar grabación" : "Elegir grabación…"}
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  setAuto(null);
                  setSrc(URL.createObjectURL(f));
                  setPlaying(false);
                  setPosMs(0);
                  e.target.blur();
                }}
              />
            </label>
            <span className="min-w-0 truncate text-sm text-muted">
              {fileName ?? "mp3, m4a, wav… se reproduce desde tu compu, no se sube"}
            </span>
          </div>
          )}

          {source === "file" && file && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent/5 p-3">
              <button className="btn-primary" onClick={(e) => { e.currentTarget.blur(); void detect(); }} disabled={!!detecting}>
                {detecting ? "Detectando…" : "✨ Detectar tiempos automáticamente"}
              </button>
              <span className="min-w-0 flex-1 text-xs text-muted">
                {detecting ??
                  "La app escucha la grabación y busca dónde empieza cada línea. Tarda menos de un minuto; después revisás y corregís. (El audio se manda a Groq para analizarlo, no se guarda.)"}
              </span>
            </div>
          )}

          {source === "spotify" && (
            <p className="text-xs text-muted">
              La detección automática necesita una grabación en archivo: Spotify no deja que otras apps escuchen su audio.
            </p>
          )}

          {source === "file" && src && (
            <audio
                ref={audioRef}
                src={src}
                preload="auto"
                onLoadedMetadata={(e) => {
                  setAudioDur(e.currentTarget.duration);
                  e.currentTarget.playbackRate = rate;
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onSeeked={(e) => setPosMs(e.currentTarget.currentTime * 1000)}
              />
          )}

          {ready && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary w-24" onClick={togglePlay}>
                  {playing ? "❚❚ Pausa" : "▶ Play"}
                </button>
                <button className="btn" onClick={() => seek(posMs - 3000)}>−3 s</button>
                <button className="btn" onClick={() => seek(posMs + 3000)}>+3 s</button>
                <span className="font-mono text-sm tabular-nums">
                  {formatTime(posMs)} <span className="text-muted">/ {audioDur ? fmtDuration(Math.round(audioDur)) : "–"}</span>
                </span>
                {source === "file" && (
                <label className="ml-auto flex items-center gap-2 text-sm text-muted">
                  Velocidad
                  <select
                    className="input w-auto py-1"
                    value={rate}
                    onChange={(e) => {
                      const r = Number(e.target.value);
                      setRate(r);
                      if (audioRef.current) audioRef.current.playbackRate = r;
                    }}
                  >
                    <option value={1}>100 %</option>
                    <option value={0.85}>85 %</option>
                    <option value={0.7}>70 %</option>
                    <option value={0.5}>50 %</option>
                  </select>
                </label>
                )}
              </div>
              <input
                type="range"
                className="w-full accent-[var(--accent)]"
                min={0}
                max={(audioDur ?? 0) * 1000}
                step={100}
                value={posMs}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Posición"
              />
            </>
          )}
        </div>

        {/* Botón grande de marcar */}
        <button
          className="btn-primary w-full py-5 text-lg"
          onClick={mark}
          disabled={!ready || cursor >= timeline.length}
        >
          {cursor >= timeline.length ? "Todas las líneas marcadas ✓" : `MARCAR  ·  “${timeline[cursor].texto}”`}
        </button>

        {/* Letra */}
        <ol ref={listRef} className="card max-h-[60vh] overflow-y-auto p-2">
          {timeline.map((l, i) => {
            const isCursor = i === cursor;
            const isPlaying = i === playingLine && playing;
            return (
              <li key={i} data-i={i}>
                {l.sectionStart && (
                  <div className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-accent">
                    {SECTION_LABELS[l.sectionType]}
                  </div>
                )}
                <button
                  onClick={() => selectLine(i)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm ${
                    isPlaying ? "bg-yellow-400/20" : selected === i ? "bg-accent/10" : "hover:bg-accent/5"
                  } ${isCursor ? "ring-2 ring-accent" : ""}`}
                >
                  <span className="w-4 text-accent">{isCursor ? "▸" : ""}</span>
                  <span
                    className={`w-20 font-mono text-xs tabular-nums ${times[i] === null ? "text-muted/60 italic" : ""}`}
                    title={times[i] === null ? "Sin marcar: se calcula entre las vecinas" : undefined}
                  >
                    {formatTime(filled[i])}
                  </span>
                  <span className={`flex-1 ${isPlaying ? "font-semibold" : ""}`}>{l.texto}</span>
                  {auto?.[i] != null && (
                    <span
                      className={`text-xs ${auto[i]! < 0.6 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}
                      title={
                        auto[i]! < 0.6
                          ? "Detectada con dudas: escuchala y corregila si hace falta"
                          : "Detectada automáticamente"
                      }
                    >
                      {auto[i]! < 0.6 ? "⚠ revisar" : "auto"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Panel lateral */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="card space-y-2 p-4 text-sm">
          <div className="font-medium">Teclado</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
            <dt><kbd>Espacio</kbd></dt><dd>marcar línea</dd>
            <dt><kbd>Enter</kbd></dt><dd>play / pausa</dd>
            <dt><kbd>Borrar</kbd></dt><dd>deshacer última marca</dd>
            <dt><kbd>← →</kbd></dt><dd>retroceder / adelantar 3 s</dd>
            <dt><kbd>↑ ↓</kbd></dt><dd>correr la línea elegida 0,1 s</dd>
          </dl>
        </div>

        <div className="card space-y-3 p-4 text-sm">
          <div>
            <span className="font-medium">{markedCount}</span>
            <span className="text-muted"> de {timeline.length} líneas con tiempo</span>
          </div>
          {selected !== null && (
            <div className="flex items-center gap-2">
              <span className="text-muted">Línea {selected + 1}:</span>
              <button className="btn px-2 py-1" onClick={() => nudge(-100)}>−0,1 s</button>
              <button className="btn px-2 py-1" onClick={() => nudge(100)}>+0,1 s</button>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn flex-1" onClick={undo} disabled={history.length === 0}>Deshacer</button>
            <button className="btn-danger flex-1" onClick={clearAll}>Desde cero</button>
          </div>
          {audioDur && Math.round(audioDur) !== song.duracionSegundos && (
            <label className="flex items-start gap-2 text-muted">
              <input type="checkbox" checked={useAudioDur} onChange={(e) => setUseAudioDur(e.target.checked)} className="mt-1" />
              <span>
                Usar la duración {source === "spotify" ? "de Spotify" : "de la grabación"} ({fmtDuration(Math.round(audioDur))}) en vez de {fmtDuration(song.duracionSegundos)}
              </span>
            </label>
          )}
          {status && (
            <p className={`rounded-md p-2 ${status.error ? "bg-danger/10 text-danger" : "bg-green-500/10 text-green-600 dark:text-green-400"}`}>
              {status.text}
            </p>
          )}
          <button className="btn-primary w-full" onClick={save} disabled={saving || !dirty}>
            {saving ? "Guardando…" : dirty ? "Guardar tiempos" : "Sin cambios"}
          </button>
        </div>

        <div className="text-xs leading-relaxed text-muted">
          <p className="mb-1 font-medium text-foreground">Cómo usarlo</p>
          Con una grabación podés apretar <b>✨ Detectar tiempos</b> y después corregir sólo las que fallen (las marcadas con ⚠). O a mano:
          Elegí la grabación (o pegá el link de Spotify), dale play y apretá <b>Espacio</b> justo cuando empieza cada línea. Si te equivocás,
          <b> Borrar</b> deshace. Hacé clic en una línea para escucharla desde 2 s antes y volver a marcarla desde
          ahí. Las líneas sin marcar (en gris) se reparten solas entre las vecinas.
        </div>
      </aside>
    </div>
  );
}
