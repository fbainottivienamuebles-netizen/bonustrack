import { json, preflight, requireApiAuth } from "@/lib/api";
import { buildBundle } from "@/lib/data";

/** Paquete offline completo de un setlist (ver OfflineBundle). */
export async function GET(req: Request, ctx: RouteContext<"/api/setlists/[id]/bundle">) {
  const denied = await requireApiAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const bundle = await buildBundle(id);
  if (!bundle) return json({ error: "Setlist inexistente" }, 404);
  return json(bundle);
}

export const OPTIONS = preflight;
