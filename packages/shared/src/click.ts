// Metrónomo: cálculo del clic y de la cuenta previa (sin audio; el sonido lo
// genera la app con Web Audio, ver apps/mobile/src/lib/metronome.ts).
//
// Convención: los "pulsos" son cada clic que suena. En compases simples
// (x/4) hay un pulso por tiempo; en compuestos (6/8, 9/8, 12/8) el BPM es el
// de la negra con puntillo y suenan las 3 corcheas de cada tiempo.
//
// El pulso 0 cae justo en el inicio del tema (posición 0). La cuenta previa
// son los pulsos negativos: con 2 compases de 4/4, los pulsos -8 a -1.
//
// Durante la cuenta, la posición del tema es NEGATIVA: el reloj se ancla en
// el instante en que arranca el tema (en el futuro) y cuenta hacia 0. Así la
// cuenta viaja sola a todos los equipos con el mismo estado de siempre.

import type { Song } from "./model";

/** Sonidos del clic del metrónomo (se generan en la app, no son archivos). */
export const CLICK_SOUNDS = ["madera", "cencerro", "beep"] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];
export const CLICK_SOUND_LABELS: Record<ClickSound, string> = {
  madera: "Madera",
  cencerro: "Cencerro",
  beep: "Beep",
};

/** Compases que ofrece el panel. En x/8 el BPM es el de la negra con puntillo. */
export const TIME_SIGNATURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "9/8", "12/8"] as const;
export const DEFAULT_COMPAS = "4/4";
export const DEFAULT_COMPASES_CUENTA = 2;
export const DEFAULT_SONIDO_CLIC: ClickSound = "madera";

export interface Meter {
  /** Tiempos por compás (lo que se cuenta: "1, 2, 3, 4"). */
  beatsPerBar: number;
  /** Clics por tiempo: 1 en x/4, 3 en compases compuestos x/8. */
  subdivision: number;
}

/** "4/4" → 4 tiempos; "6/8" → 2 tiempos de 3 corcheas. null si no se entiende. */
export function parseCompas(raw: string | null | undefined): Meter | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(2|4|8|16)\s*$/.exec(raw ?? "");
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (num < 1 || num > 16) return null;
  if (den >= 8 && num > 3 && num % 3 === 0) return { beatsPerBar: num / 3, subdivision: 3 };
  return { beatsPerBar: num, subdivision: 1 };
}

export function isValidCompas(raw: string): boolean {
  return parseCompas(raw) !== null;
}

export interface ClickPlan {
  bpm: number;
  meter: Meter;
  sound: ClickSound;
  countInBars: number;
  /** Duración de un pulso (ms de reloj real, no afectados por el tempo de la letra). */
  pulseMs: number;
  pulsesPerBar: number;
  /** Pulsos de la cuenta previa. */
  countInPulses: number;
  /** Duración de la cuenta previa (ms de reloj real). */
  countInMs: number;
}

/** Datos del clic de un tema. null si el tema no tiene BPM (no hay clic posible). */
export function clickPlan(
  song: Pick<Song, "bpmManual"> & Partial<Pick<Song, "compas" | "compasesCuenta" | "sonidoClic">>,
  soundOverride?: ClickSound | null,
): ClickPlan | null {
  if (!song.bpmManual || song.bpmManual <= 0) return null;
  const meter = parseCompas(song.compas) ?? parseCompas(DEFAULT_COMPAS)!;
  const bars = clampBars(song.compasesCuenta ?? DEFAULT_COMPASES_CUENTA);
  const sound =
    soundOverride ?? (CLICK_SOUNDS.includes(song.sonidoClic as ClickSound) ? song.sonidoClic! : DEFAULT_SONIDO_CLIC);
  const pulseMs = 60000 / song.bpmManual / meter.subdivision;
  const pulsesPerBar = meter.beatsPerBar * meter.subdivision;
  const countInPulses = bars * pulsesPerBar;
  return {
    bpm: song.bpmManual,
    meter,
    sound,
    countInBars: bars,
    pulseMs,
    pulsesPerBar,
    countInPulses,
    countInMs: countInPulses * pulseMs,
  };
}

export function clampBars(n: number): number {
  return Math.min(4, Math.max(1, Math.round(Number.isFinite(n) ? n : DEFAULT_COMPASES_CUENTA)));
}

/** 2 = primer tiempo del compás, 1 = tiempo, 0 = subdivisión. */
export type Accent = 0 | 1 | 2;

export function accentOf(plan: Pick<ClickPlan, "pulsesPerBar" | "meter">, pulseIndex: number): Accent {
  const inBar = ((pulseIndex % plan.pulsesPerBar) + plan.pulsesPerBar) % plan.pulsesPerBar;
  if (inBar === 0) return 2;
  return inBar % plan.meter.subdivision === 0 ? 1 : 0;
}

export interface CountInView {
  /** Compás de la cuenta (1-based) y total. */
  bar: number;
  bars: number;
  /** Tiempo dentro del compás (1-based) y total, para mostrar "1 2 3 4". */
  beat: number;
  beatsPerBar: number;
  /** ms de reloj real que faltan para que arranque el tema. */
  remainingMs: number;
}

/**
 * Qué mostrar durante la cuenta previa, o null si no está en cuenta.
 * `positionMs` negativo = faltan |positionMs|/rate ms reales para el inicio.
 */
export function countInAt(plan: ClickPlan | null, positionMs: number, rate: number): CountInView | null {
  if (!plan || positionMs >= 0) return null;
  const remainingMs = -positionMs / (rate > 0 ? rate : 1);
  if (remainingMs > plan.countInMs + 50) return null; // antes del primer clic
  const elapsed = Math.max(0, plan.countInMs - remainingMs);
  const beatMs = plan.pulseMs * plan.meter.subdivision;
  const beatIndex = Math.min(plan.countInBars * plan.meter.beatsPerBar - 1, Math.floor(elapsed / beatMs));
  return {
    bar: Math.floor(beatIndex / plan.meter.beatsPerBar) + 1,
    bars: plan.countInBars,
    beat: (beatIndex % plan.meter.beatsPerBar) + 1,
    beatsPerBar: plan.meter.beatsPerBar,
    remainingMs,
  };
}

/** Factor de velocidad del video de fondo según el tempo vigente. */
export function videoRate(
  song: Pick<Song, "bpmManual" | "videoBpmReferencia">,
  rate: number,
): number {
  const r =
    song.bpmManual && song.videoBpmReferencia ? (song.bpmManual * rate) / song.videoBpmReferencia : rate;
  return Math.min(4, Math.max(0.25, Number.isFinite(r) && r > 0 ? r : 1));
}
