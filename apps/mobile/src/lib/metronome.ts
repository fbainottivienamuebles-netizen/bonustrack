// Metrónomo del Controlador: genera el clic con Web Audio, con precisión de
// audio (cada clic se agenda en el reloj de la placa de sonido, no con
// temporizadores de pantalla).
//
// - El clic sale por la salida de audio elegida (auriculares / placa USB →
//   caja directa → consola). El nivel es fijo: lo regula el sonidista.
// - Los sonidos se sintetizan una vez al arrancar (no hay archivos).
// - Latencia: el sonido sale de la placa un rato después de agendarlo. Ese
//   tiempo (calibrable por equipo, en ms) se suma al arranque de la letra
//   para que letra, video y clic queden alineados con lo que se escucha.

import { accentOf, type Accent, type ClickPlan, type ClickSound } from "@letras/shared";

// ---------- Preferencias del equipo ----------

const AUDIO_KEY = "letras.audio";
const SONGS_KEY = "letras.clickSongs";

export interface AudioPrefs {
  /** Salida de audio elegida ("" = la del sistema). */
  sinkId: string;
  /** Latencia calibrada en ms; null = estimación automática del navegador. */
  latencyMs: number | null;
}

export function loadAudioPrefs(): AudioPrefs {
  try {
    return { sinkId: "", latencyMs: null, ...JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "{}") };
  } catch {
    return { sinkId: "", latencyMs: null };
  }
}

export function saveAudioPrefs(p: AudioPrefs) {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(p));
  } catch {
    /* no se recuerda */
  }
}

/** Lo que el operador cambia en vivo para un tema (se recuerda en este equipo). */
export interface SongClickPrefs {
  on: boolean;
  sound: ClickSound | null;
}

function readSongs(): Record<string, Partial<SongClickPrefs>> {
  try {
    return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function loadSongClick(songId: string): SongClickPrefs {
  return { on: true, sound: null, ...readSongs()[songId] };
}

export function saveSongClick(songId: string, p: SongClickPrefs) {
  try {
    const all = readSongs();
    all[songId] = p;
    localStorage.setItem(SONGS_KEY, JSON.stringify(all));
  } catch {
    /* no se recuerda */
  }
}

// ---------- Sonidos ----------

/** Nivel de salida fijo y limpio (≈ −3 dBFS de pico). */
const OUTPUT_GAIN = 0.7;

function render(ctx: BaseAudioContext, sound: ClickSound, accent: Accent): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * (sound === "cencerro" ? 0.18 : 0.08));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const amp = accent === 2 ? 1 : accent === 1 ? 0.75 : 0.45;
  const TAU = 2 * Math.PI;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const attack = Math.min(1, t / 0.001);
    let v = 0;
    if (sound === "beep") {
      const f = accent === 2 ? 1760 : accent === 1 ? 1320 : 990;
      v = Math.sin(TAU * f * t) * Math.exp(-t / 0.018);
    } else if (sound === "madera") {
      const f = accent === 2 ? 1250 : 880;
      v = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2.71 * t)) * Math.exp(-t / 0.012) * 0.75;
    } else {
      const k = accent === 2 ? 1.26 : 1;
      const sq = (f: number) => (Math.sin(TAU * f * t) >= 0 ? 1 : -1);
      v = (sq(587 * k) + sq(845 * k)) * 0.25 * (0.6 * Math.exp(-t / 0.012) + 0.4 * Math.exp(-t / 0.07));
    }
    d[i] = v * attack * amp;
  }
  return buf;
}

// ---------- Motor ----------

/** Cuánto antes se agendan los clics (s). Cubre pausas del navegador. */
const LOOKAHEAD = 1.5;
const TICK_MS = 100;

interface Run {
  plan: ClickPlan;
  sound: ClickSound;
  /** Hora de audio (s) del pulso `firstIndex`. */
  startAudio: number;
  firstIndex: number;
  nextIndex: number;
  /** Último pulso (excluido), o null = hasta que se pare. */
  endIndex: number | null;
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };

export const sinkSelectionSupported =
  typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

class Metronome {
  private ctx: SinkContext | null = null;
  private out: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private timer = 0;
  private run: Run | null = null;
  private tone: OscillatorNode | null = null;
  private prefs = loadAudioPrefs();
  private sinkError: string | null = null;

  /** Prepara el audio. La primera vez tiene que ser dentro de un toque/click. */
  async ready(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" }) as SinkContext;
      this.out = this.ctx.createGain();
      this.out.gain.value = OUTPUT_GAIN;
      this.out.connect(this.ctx.destination);
      await this.applySink();
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    return this.ctx;
  }

  /** Para llamar en el primer toque de la pantalla: deja el audio listo. */
  unlock() {
    this.ready().catch(() => {});
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  // ----- salida y latencia -----

  get audioPrefs(): AudioPrefs {
    return this.prefs;
  }

  async setAudioPrefs(p: AudioPrefs) {
    const sinkChanged = p.sinkId !== this.prefs.sinkId;
    this.prefs = p;
    saveAudioPrefs(p);
    if (sinkChanged) await this.applySink();
  }

  /** Error al elegir la salida (p. ej. se desconectó la placa). */
  get outputError(): string | null {
    return this.sinkError;
  }

  private async applySink() {
    this.sinkError = null;
    const ctx = this.ctx;
    if (!ctx?.setSinkId) return;
    try {
      if ((ctx.sinkId ?? "") !== this.prefs.sinkId) await ctx.setSinkId(this.prefs.sinkId);
    } catch {
      this.sinkError = "No se encontró la salida de audio elegida: el clic sale por la del sistema.";
      await ctx.setSinkId("").catch(() => {});
    }
  }

  /** Re-aplica la salida elegida (al reconectar una placa USB, por ejemplo). */
  async refreshSink() {
    await this.applySink();
  }

  /** Estimación del navegador (ms), si la da. */
  get autoLatencyMs(): number {
    const c = this.ctx;
    if (!c) return 0;
    return Math.round(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000);
  }

  /** Latencia que se usa: la calibrada, o la estimación automática. */
  get latencyMs(): number {
    return this.prefs.latencyMs ?? this.autoLatencyMs;
  }

  // ----- relojes -----

  /** Hora de pantalla (performance.now) que corresponde a una hora de audio. */
  perfAt(audioTime: number): number {
    const c = this.ctx!;
    return performance.now() + (audioTime - c.currentTime) * 1000;
  }

  get audioNow(): number {
    return this.ctx?.currentTime ?? 0;
  }

  // ----- clic -----

  /**
   * Agenda clics: el pulso `firstIndex` suena en `startAudio` (hora de audio)
   * y siguen cada `plan.pulseMs` hasta `endIndex` (excluido) o hasta stop().
   */
  start(plan: ClickPlan, startAudio: number, firstIndex: number, endIndex: number | null = null) {
    this.stop();
    if (!this.ctx) return;
    this.run = { plan, sound: plan.sound, startAudio, firstIndex, nextIndex: firstIndex, endIndex };
    this.pump();
    this.timer = window.setInterval(() => this.pump(), TICK_MS);
  }

  /** Corta el clic, incluidos los que ya estaban agendados. */
  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.run = null;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* ya terminó */
      }
    }
    this.sources.clear();
  }

  /** Cambia el sonido de lo que viene sonando (lo ya agendado, ~1 s, sigue igual). */
  setSound(sound: ClickSound) {
    if (this.run) this.run.sound = sound;
  }

  get clicking(): boolean {
    return this.run !== null;
  }

  private buffer(sound: ClickSound, accent: Accent): AudioBuffer {
    const key = `${sound}-${accent}`;
    let b = this.buffers.get(key);
    if (!b) {
      b = render(this.ctx!, sound, accent);
      this.buffers.set(key, b);
    }
    return b;
  }

  private pump() {
    const r = this.run;
    const ctx = this.ctx;
    if (!r || !ctx || !this.out) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    const pulseSec = r.plan.pulseMs / 1000;
    for (;;) {
      if (r.endIndex !== null && r.nextIndex >= r.endIndex) {
        // Terminó (cuenta sola): se deja de bombear, los agendados suenan igual.
        clearInterval(this.timer);
        this.timer = 0;
        this.run = null;
        return;
      }
      const t = r.startAudio + (r.nextIndex - r.firstIndex) * pulseSec;
      if (t > horizon) return;
      if (t >= ctx.currentTime - 0.005) {
        const src = ctx.createBufferSource();
        src.buffer = this.buffer(r.sound, accentOf(r.plan, r.nextIndex));
        src.connect(this.out);
        src.onended = () => this.sources.delete(src);
        src.start(Math.max(t, ctx.currentTime));
        this.sources.add(src);
      }
      r.nextIndex++;
    }
  }

  /** Un clic suelto ya (para probar el sonido). */
  async preview(sound: ClickSound, accent: Accent = 2) {
    const ctx = await this.ready();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(sound, accent);
    src.connect(this.out!);
    src.start();
  }

  // ----- tono de prueba -----

  /** Tono de 1 kHz continuo, para que el sonidista ajuste la ganancia. */
  async setTone(on: boolean) {
    if (!on) {
      this.tone?.stop();
      this.tone?.disconnect();
      this.tone = null;
      return;
    }
    if (this.tone) return;
    const ctx = await this.ready();
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const g = ctx.createGain();
    g.gain.value = 0.5; // ≈ −9 dBFS con la ganancia de salida
    osc.connect(g).connect(this.out!);
    osc.start();
    this.tone = osc;
  }

  get toneOn(): boolean {
    return this.tone !== null;
  }
}

/** Un solo metrónomo por equipo. */
export const metronome = new Metronome();

// ---------- Salidas de audio ----------

export interface OutputDevice {
  id: string;
  label: string;
}

export async function listOutputs(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Salida ${i + 1}` }));
}

/** Los nombres de las salidas solo se ven después de dar permiso de micrófono. */
export async function unlockDeviceLabels(): Promise<string | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return null;
  } catch {
    return "Sin permiso de micrófono no se ven los nombres de las salidas.";
  }
}

/** Avisa cuando se conecta o desconecta algo de audio (cable, placa USB, BT). */
export function onOutputsChange(fn: () => void): () => void {
  const md = navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  md.addEventListener("devicechange", fn);
  return () => md.removeEventListener("devicechange", fn);
}
