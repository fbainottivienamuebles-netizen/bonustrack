// Transcribe un pedazo de la grabación con Whisper (Groq, plan gratuito) y
// devuelve cada palabra con su tiempo. El navegador parte el audio en pedazos
// chicos (WAV mono 16 kHz) para no pasar el límite de 4,5 MB por pedido.
// La grabación no se guarda en ningún lado.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth-token";

export const maxDuration = 60;

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

export async function POST(req: NextRequest) {
  if (!(await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)))
    return NextResponse.json({ error: "Sesión vencida: volvé a entrar al panel" }, { status: 401 });

  const key = process.env.GROQ_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: "Falta configurar la clave de Groq (GROQ_API_KEY) en el panel" },
      { status: 500 },
    );

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Falta el audio" }, { status: 400 });

  const body = new FormData();
  body.append("file", file, "parte.wav");
  body.append("model", "whisper-large-v3");
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");
  body.append("temperature", "0");
  const lang = form.get("language");
  if (typeof lang === "string" && /^[a-z]{2}$/.test(lang)) body.append("language", lang);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const text =
      res.status === 429
        ? "Se llegó al límite gratuito de Groq por ahora. Probá de nuevo en un rato."
        : res.status === 401
          ? "La clave de Groq no es válida."
          : `Groq respondió con error ${res.status}.`;
    console.error("groq", res.status, detail.slice(0, 500));
    return NextResponse.json({ error: text }, { status: 502 });
  }
  const data = (await res.json()) as { words?: GroqWord[] };
  const words = (data.words ?? []).map((w) => ({ w: w.word, s: w.start, e: w.end }));
  return NextResponse.json({ words });
}
