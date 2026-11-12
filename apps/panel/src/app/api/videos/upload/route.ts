// Subida de videos de fondo desde el panel directo a Vercel Blob (el archivo
// no pasa por el servidor, así no hay límite de tamaño de la función).
// Esta ruta sólo firma el permiso de subida, y sólo con la sesión del panel.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth-token";
import { videoStorageReady } from "@/lib/videos";

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!(await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)))
    return NextResponse.json({ error: "Sesión vencida: volvé a entrar al panel" }, { status: 401 });
  if (!videoStorageReady())
    return NextResponse.json(
      { error: "Falta conectar el almacenamiento de videos (Vercel Blob) al proyecto del panel" },
      { status: 500 },
    );

  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("videos/")) throw new Error("Ruta inválida");
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
