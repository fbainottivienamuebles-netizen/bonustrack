// Setlists guardados en el dispositivo + descarga desde el panel.

import { useCallback, useEffect, useState } from "react";
import { flattenSetlist, type OfflineBundle, type SetlistSummary } from "@letras/shared";
import { ApiError, fetchBundle, fetchSetlists } from "../lib/api";
import { deleteBundle, listBundles, putBundle, type Settings } from "../lib/storage";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function Home({
  settings,
  onOpen,
  onSettings,
}: {
  settings: Settings;
  onOpen: (b: OfflineBundle) => void;
  onSettings: () => void;
}) {
  const [local, setLocal] = useState<OfflineBundle[] | null>(null);
  const [remote, setRemote] = useState<SetlistSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);

  const reloadLocal = useCallback(() => listBundles().then(setLocal), []);
  useEffect(() => {
    reloadLocal();
  }, [reloadLocal]);

  const remoteById = new Map((remote ?? []).map((r) => [r.id, r]));

  async function checkRemote() {
    setBusy("list");
    setMsg(null);
    try {
      setRemote(await fetchSetlists(settings));
    } catch (e) {
      setMsg({ error: true, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function download(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const b = await fetchBundle(settings, id);
      await putBundle(b);
      await reloadLocal();
      setMsg({ text: `“${b.setlist.nombre}” listo para usar sin internet (${b.songs.length} temas).` });
    } catch (e) {
      setMsg({ error: true, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: OfflineBundle) {
    if (!confirm(`¿Borrar “${b.setlist.nombre}” del dispositivo?`)) return;
    await deleteBundle(b.setlist.id);
    await reloadLocal();
  }

  const localIds = new Set((local ?? []).map((b) => b.setlist.id));
  const notDownloaded = (remote ?? []).filter((r) => !localIds.has(r.id));

  return (
    <div className="screen scroll">
      <header className="top">
        <h1>Letras en vivo</h1>
        <button className="btn small" onClick={onSettings}>Ajustes</button>
      </header>

      {msg && <p className={`msg ${msg.error ? "error" : ""}`}>{msg.text}</p>}

      <h2>En este dispositivo</h2>
      {local === null ? (
        <p className="muted">Cargando…</p>
      ) : local.length === 0 ? (
        <p className="muted">No hay setlists descargados. Bajá uno del panel antes del show.</p>
      ) : (
        <ul className="cards">
          {local.map((b) => {
            const r = remoteById.get(b.setlist.id);
            const outdated = r && r.updatedAt > b.setlist.updatedAt;
            const gone = remote && !r;
            return (
              <li key={b.setlist.id} className="card">
                <button className="card-main" onClick={() => onOpen(b)}>
                  <div className="title">{b.setlist.nombre}</div>
                  <div className="muted small">
                    {b.setlist.tandas.length} tandas · {flattenSetlist(b.setlist.tandas).length} temas · bajado{" "}
                    {fmtDate(b.generatedAt)}
                  </div>
                  {outdated && <div className="badge warn">Hay cambios en el panel</div>}
                  {gone && <div className="badge">Ya no está en el panel</div>}
                </button>
                <div className="card-actions">
                  {r && (
                    <button className="btn small" disabled={!!busy} onClick={() => download(b.setlist.id)}>
                      {busy === b.setlist.id ? "Bajando…" : "Actualizar"}
                    </button>
                  )}
                  <button className="btn small danger" onClick={() => remove(b)}>Borrar</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2>En el panel</h2>
      <button className="btn full" disabled={!!busy} onClick={checkRemote}>
        {busy === "list" ? "Consultando…" : remote ? "Volver a consultar" : "Buscar setlists en el panel"}
      </button>
      {remote && notDownloaded.length === 0 && <p className="muted">No hay otros setlists para bajar.</p>}
      <ul className="cards">
        {notDownloaded.map((r) => (
          <li key={r.id} className="card">
            <div className="card-main">
              <div className="title">{r.nombre}</div>
              <div className="muted small">
                {r.cantidadTandas} tandas · {r.cantidadTemas} temas
              </div>
            </div>
            <div className="card-actions">
              <button className="btn small primary" disabled={!!busy} onClick={() => download(r.id)}>
                {busy === r.id ? "Bajando…" : "Descargar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
