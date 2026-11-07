import { useState } from "react";
import { ApiError, testConnection } from "../lib/api";
import type { Settings } from "../lib/storage";

export function SettingsScreen({
  settings,
  onSave,
  onBack,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const n = await testConnection(draft);
      setStatus({ text: `Conectado. ${n} setlist${n === 1 ? "" : "s"} en el panel.` });
    } catch (e) {
      setStatus({ error: true, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="screen scroll">
      <header className="top">
        <button className="btn small" onClick={onBack}>← Volver</button>
        <h1>Ajustes</h1>
      </header>

      <label className="field">
        <span>URL del panel</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="https://mi-panel.vercel.app"
          value={draft.serverUrl}
          onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Clave</span>
        <input
          type="password"
          value={draft.password}
          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
        />
      </label>

      {status && <p className={`msg ${status.error ? "error" : ""}`}>{status.text}</p>}

      <div className="row">
        <button className="btn" disabled={testing} onClick={test}>
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        <button className="btn primary" onClick={() => onSave(draft)}>Guardar</button>
      </div>
      <p className="muted small">
        Internet sólo se usa para descargar. Durante el show la app funciona sin conexión.
      </p>
    </div>
  );
}
