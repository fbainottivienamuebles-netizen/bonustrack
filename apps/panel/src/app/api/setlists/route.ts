import { json, preflight, requireApiAuth } from "@/lib/api";
import { listSetlists } from "@/lib/data";

/** Setlists disponibles para descargar (resumen liviano). */
export async function GET(req: Request) {
  const denied = await requireApiAuth(req);
  if (denied) return denied;
  return json(await listSetlists());
}

export const OPTIONS = preflight;
