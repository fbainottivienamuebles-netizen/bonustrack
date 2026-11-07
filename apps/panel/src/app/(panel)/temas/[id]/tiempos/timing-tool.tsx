"use client";

// Marcar los tiempos de cada línea escuchando una grabación propia.
// El audio se reproduce desde el archivo local: no se sube a ningún lado,
// sólo se guardan los tiempos.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SECTION_LABELS, buildTimeline, formatTime, lineAt, type Song } from "@letras/shared";
import { saveTimesAction } from "@/app/actions";
import { fmtDuration } from "@/lib/format";

type Times = (number | null)[];

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

export function TimingTool({ song }: { song: Song }) {
  const router = useRouter();
  const timeline = useMemo(() => buildTimeline(song.secciones), [song]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [audioDur, setAudioDur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [rate, setRate] = useState(1);

  const [times, setTimes] = useState<Times>(() => timeline.map((l) => l.tiempoInicioMs));
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<Mark[]>([]);
  const [useAudioDur, setUseAudioDur] = useState(true);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Liberar el archivo al cambiarlo o salir.
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  // Posición en cada frame mientras suena.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current) setPosMs(audioRef.current.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

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
    const a = audio();
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function seek(ms: number) {
    const a = audio();
    if (!a) return;
    a.currentTime = Math.max(0, ms / 1000);
    setPosMs(a.currentTime * 1000);
  }

  function mark() {
    const a = audio();
    if (!a || cursor >= timeline.length) return;
    const t = Math.round(a.currentTime * 1000);
    setHistory((h) => [...h, { index: cursor, prev: times[cursor], prevCursor: cursor }]);
    setTimes((ts) => ts.map((x, i) => (i === cursor ? t : x)));
    setSelected(cursor);
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
    setDirty(true);
  }

  function clearAll() {
    if (!confirm("¿Borrar todos los tiempos y marcar desde cero?")) return;
    setHistory([]);
    setTimes(timeline.map(() => null));
    setCursor(0);
    setSelected(null);
    seek(0);
    setDirty(true);
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
                  setFileName(f.name);
                  setSrc(URL.createObjectURL(f));
                  setPlaying(false);
                  setPosMs(0);
                }}
              />
            </label>
            <span className="min-w-0 truncate text-sm text-muted">
              {fileName ?? "mp3, m4a, wav… se reproduce desde tu compu, no se sube"}
            </span>
          </div>

          {src && (
            <>
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
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary w-24" onClick={togglePlay}>
                  {playing ? "❚❚ Pausa" : "▶ Play"}
                </button>
                <button className="btn" onClick={() => seek(posMs - 3000)}>−3 s</button>
                <button className="btn" onClick={() => seek(posMs + 3000)}>+3 s</button>
                <span className="font-mono text-sm tabular-nums">
                  {formatTime(posMs)} <span className="text-muted">/ {audioDur ? fmtDuration(Math.round(audioDur)) : "–"}</span>
                </span>
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
          disabled={!src || cursor >= timeline.length}
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
                  <span className={isPlaying ? "font-semibold" : ""}>{l.texto}</span>
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
                Usar la duración de la grabación ({fmtDuration(Math.round(audioDur))}) en vez de {fmtDuration(song.duracionSegundos)}
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
          Elegí la grabación, dale play y apretá <b>Espacio</b> justo cuando empieza cada línea. Si te equivocás,
          <b> Borrar</b> deshace. Hacé clic en una línea para escucharla desde 2 s antes y volver a marcarla desde
          ahí. Las líneas sin marcar (en gris) se reparten solas entre las vecinas.
        </div>
      </aside>
    </div>
  );
}
