// Detección automática de tiempos: prepara la grabación en el navegador,
// la manda a transcribir por pedazos y alinea las palabras escuchadas con la
// letra para sacar dónde empieza cada línea.

export interface HeardWord {
  w: string;
  s: number; // segundos
  e: number;
}

const RATE = 16000;
const CHUNK_S = 90; // ~2,9 MB por pedazo en WAV mono 16 kHz
const OVERLAP_S = 3; // para no cortar palabras en el borde

/** Decodifica el archivo y lo pasa a mono 16 kHz. */
async function decodeMono16k(file: Blob): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
  const length = Math.ceil(decoded.duration * RATE);
  const off = new OfflineAudioContext(1, length, RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

function toWav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Transcribe toda la grabación y devuelve las palabras con su tiempo. */
export async function transcribe(
  file: Blob,
  onProgress: (text: string) => void,
  language?: string,
): Promise<HeardWord[]> {
  onProgress("Preparando el audio…");
  const pcm = await decodeMono16k(file);
  const total = pcm.length / RATE;
  const parts = Math.max(1, Math.ceil(total / CHUNK_S));
  const words: HeardWord[] = [];
  for (let i = 0; i < parts; i++) {
    onProgress(parts > 1 ? `Escuchando la parte ${i + 1} de ${parts}…` : "Escuchando el tema…");
    const keepFrom = i * CHUNK_S; // de cada pedazo sólo se usan las palabras desde acá
    const from = Math.max(0, keepFrom - OVERLAP_S);
    const to = Math.min(total, (i + 1) * CHUNK_S);
    const fd = new FormData();
    fd.append("file", toWav(pcm.subarray(Math.floor(from * RATE), Math.floor(to * RATE))), "parte.wav");
    if (language) fd.append("language", language);
    const res = await fetch("/api/tiempos/transcribir", { method: "POST", body: fd });
    const data = (await res.json().catch(() => ({}))) as { words?: HeardWord[]; error?: string };
    if (!res.ok || !data.words) throw new Error(data.error ?? `Error ${res.status} al analizar el audio`);
    for (const w of data.words) {
      const s = w.s + from;
      if (i > 0 && s < keepFrom) continue;
      words.push({ w: w.w, s, e: w.e + from });
    }
  }
  return words;
}

// --- Alineación ---

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, "");
}

/** Palabras de una línea; `bg` = entre paréntesis (coros de fondo, suelen no escucharse). */
function tokens(text: string): { t: string; bg: boolean }[] {
  const out: { t: string; bg: boolean }[] = [];
  let depth = 0;
  for (const raw of text.split(/\s+/)) {
    const opens = (raw.match(/\(/g) ?? []).length;
    const closes = (raw.match(/\)/g) ?? []).length;
    const t = norm(raw);
    if (t) out.push({ t, bg: depth + opens > 0 });
    depth = Math.max(0, depth + opens - closes);
  }
  return out;
}

/** Parecido entre dos palabras, de 0 a 1 (Levenshtein normalizado). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

const GAP_LYRIC = -0.4; // palabra de la letra que no se escuchó
const GAP_BG = -0.05; // coro entre paréntesis que no se escuchó: casi gratis
const GAP_HEARD = -0.25; // palabra escuchada que no está en la letra (ruido, "uoh")
const GOOD = 0.6; // a partir de acá se considera la misma palabra
const MAX_WORD_S = 1.5;
const TYPICAL_WORD_S = 0.5;

export interface LineGuess {
  /** Inicio estimado en ms, o null si no se encontró. */
  ms: number | null;
  /** Qué parte de las palabras de la línea se reconocieron (0 a 1). */
  confidence: number;
}

/**
 * Alinea la letra (en orden) con lo escuchado y estima el inicio de cada
 * línea. Es una alineación global: respeta el orden de la letra, así un
 * estribillo repetido no se confunde con el anterior.
 */
export function alignLines(lines: string[], heard: HeardWord[]): LineGuess[] {
  const lyric: { t: string; bg: boolean; line: number; pos: number }[] = [];
  lines.forEach((l, li) => tokens(l).forEach((tk, pos) => lyric.push({ ...tk, line: li, pos })));
  // Whisper le pone a la primera palabra después de un silencio el inicio del
  // silencio (ej. un "Oh" que dura 20 s): una palabra cantada casi nunca dura
  // más de ~1,5 s, así que se corre su inicio hacia el final.
  const h = heard
    .map((w) => ({ ...w, s: w.e - w.s > MAX_WORD_S ? w.e - TYPICAL_WORD_S : w.s, t: norm(w.w) }))
    .filter((w) => w.t);
  const m = lyric.length;
  const n = h.length;
  if (!m || !n) return lines.map(() => ({ ms: null, confidence: 0 }));

  // Puntajes (DP) y camino de vuelta: 0 = diagonal, 1 = salta letra, 2 = salta escuchada.
  const W = n + 1;
  const score = new Float32Array((m + 1) * W);
  const back = new Uint8Array((m + 1) * W);
  for (let i = 1; i <= m; i++) {
    score[i * W] = score[(i - 1) * W] + (lyric[i - 1].bg ? GAP_BG : GAP_LYRIC);
    back[i * W] = 1;
  }
  // Lo escuchado antes del primer verso (presentación, intro) no se penaliza.
  for (let j = 1; j <= n; j++) back[j] = 2;
  const sims = new Float32Array((m + 1) * W);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = similarity(lyric[i - 1].t, h[j - 1].t);
      sims[i * W + j] = sim;
      const bg = lyric[i - 1].bg;
      const diag = score[(i - 1) * W + j - 1] + (2 * sim - 0.8) * (bg ? 0.5 : 1);
      const up = score[(i - 1) * W + j] + (bg ? GAP_BG : GAP_LYRIC);
      const left = score[i * W + j - 1] + (i === m ? 0 : GAP_HEARD); // lo de después del final, gratis
      if (diag >= up && diag >= left) {
        score[i * W + j] = diag;
        back[i * W + j] = 0;
      } else if (up >= left) {
        score[i * W + j] = up;
        back[i * W + j] = 1;
      } else {
        score[i * W + j] = left;
        back[i * W + j] = 2;
      }
    }
  }

  // Qué palabra escuchada le tocó a cada palabra de la letra.
  const match: (number | null)[] = new Array(m).fill(null);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const b = back[i * W + j];
    if (b === 0) {
      if (sims[i * W + j] >= GOOD) match[i - 1] = j - 1;
      i--;
      j--;
    } else if (b === 1) i--;
    else j--;
  }

  // Inicio de cada línea: su primera palabra reconocida, corrida hacia atrás
  // según cuántas palabras de la línea vienen antes.
  const guesses: LineGuess[] = lines.map(() => ({ ms: null, confidence: 0 }));
  const count = lines.map(() => ({ total: 0, ok: 0 }));
  let prevEnd = 0; // fin de la última palabra reconocida
  for (let k = 0; k < m; k++) {
    const { line, pos } = lyric[k];
    count[line].total++;
    const hj = match[k];
    if (hj === null) continue;
    count[line].ok++;
    if (guesses[line].ms === null) {
      const s = Math.max(prevEnd, h[hj].s - pos * 0.35);
      guesses[line].ms = Math.round(s * 1000);
    }
    prevEnd = h[hj].e;
  }
  count.forEach((c, li) => (guesses[li].confidence = c.total ? c.ok / c.total : 0));

  // En una tira de frases repetidas (ej. "I'll be watching you" x10) es fácil
  // equivocarse de repetición: esas líneas quedan como dudosas para revisar.
  const keyOf = lines.map((l) => tokens(l).filter((t) => !t.bg).map((t) => t.t).join(" "));
  keyOf.forEach((k, li) => {
    if (!k) return;
    for (let d = -3; d <= 3; d++)
      if (d && keyOf[li + d] === k) {
        guesses[li].confidence = Math.min(guesses[li].confidence, 0.5);
        break;
      }
  });

  // Una línea con pocas palabras reconocidas no es confiable; y los tiempos
  // tienen que ir siempre para adelante.
  let last = -1;
  for (const g of guesses) {
    if (g.ms !== null && (g.confidence < 0.34 || g.ms <= last)) g.ms = null;
    if (g.ms !== null) last = g.ms;
  }
  return guesses;
}
