// Inicio → "Show en grupo": ser director, seguir por WiFi o por Bluetooth.

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { bleAvailable } from "../lib/ble";
import { normalizeDirectorAddress, probeDirector, type DirectorInfo } from "../lib/local-link";
import type { FollowMode, FollowSource } from "../screens/Follow";
import { RoomInfo } from "./RoomInfo";

const ADDR_KEY = "letras.directorAddress";

export function GroupSection({
  director,
  onFollow,
}: {
  director: DirectorInfo | null;
  onFollow: (source: FollowSource, mode: FollowMode) => void;
}) {
  if (director?.isHost) {
    return (
      <>
        <p className="msg">
          Esta notebook es el <strong>director</strong>. Abrí un setlist y todos los equipos conectados siguen lo que
          marques acá.
        </p>
        <RoomInfo director={director} />
      </>
    );
  }

  if (director) {
    return (
      <>
        <h2>Show en grupo</h2>
        <button className="btn primary full big" onClick={() => onFollow({ kind: "wifi", base: director.base }, "lista")}>
          Seguir al director
        </button>
        <button className="btn full" onClick={() => onFollow({ kind: "wifi", base: director.base }, "escenario")}>
          Usar como pantalla de escenario (letra grande)
        </button>
      </>
    );
  }

  if (Capacitor.isNativePlatform()) return <NativeJoin onFollow={onFollow} />;

  return (
    <>
      <h2>Show en grupo</h2>
      <p className="muted small">
        Para seguir al director por WiFi, conectate al WiFi del show y escaneá el código QR que aparece en la notebook
        del director.
      </p>
    </>
  );
}

function NativeJoin({ onFollow }: { onFollow: (s: FollowSource, m: FollowMode) => void }) {
  const [addr, setAddr] = useState(() => {
    try {
      return localStorage.getItem(ADDR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    const base = normalizeDirectorAddress(addr);
    if (!base) return setError("Escribí la dirección que muestra la notebook, por ejemplo 192.168.0.10");
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(ADDR_KEY, addr.trim());
    } catch {
      /* no se recuerda */
    }
    const info = await probeDirector(base);
    setBusy(false);
    if (!info) return setError("No se encontró al director. ¿Este equipo está en el mismo WiFi y la notebook tiene el director abierto?");
    onFollow({ kind: "wifi", base }, "lista");
  }

  return (
    <>
      <h2>Show en grupo</h2>
      <label className="field">
        <span>Dirección del director (la muestra la notebook)</span>
        <input
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="192.168.0.10"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
      </label>
      {error && <p className="msg error">{error}</p>}
      <button className="btn primary full" disabled={busy} onClick={join}>
        {busy ? "Buscando…" : "Seguir por WiFi"}
      </button>
      {bleAvailable && (
        <>
          <button className="btn full" style={{ marginTop: ".5rem" }} onClick={() => onFollow({ kind: "ble" }, "lista")}>
            Seguir por Bluetooth
          </button>
          <p className="muted small">
            Bluetooth: otro Android con la app tiene que estar siguiendo por WiFi con “Puente BT” prendido. Este equipo
            necesita tener el setlist descargado.
          </p>
        </>
      )}
    </>
  );
}
