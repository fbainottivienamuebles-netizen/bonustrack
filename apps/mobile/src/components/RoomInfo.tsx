// Datos de la sala WiFi: código QR para unirse, quiénes están conectados y
// (en la notebook del director) el botón para abrir pantallas de escenario.

import { useState } from "react";
import type { LinkSnapshot, DirectorInfo } from "../lib/local-link";
import { openStageWindow } from "../lib/stage-window";

const ROLE_LABEL = { controlador: "director", seguidor: "sigue", pantalla: "pantalla" } as const;

export function RoomInfo({ director, snap }: { director: DirectorInfo; snap?: LinkSnapshot | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  // En la notebook la dirección es "localhost": a los celulares hay que darles la de la red.
  const joinBase = director.isHost ? director.urls[0] : director.base;
  const joinUrl = joinBase ? `${joinBase}/?modo=seguir` : null;

  return (
    <section className="room">
      <h2>Sala WiFi</h2>
      {joinUrl ? (
        <div className="room-join">
          <img
            className="qr"
            src={`/api/local/qr.svg?u=${encodeURIComponent(joinUrl)}`}
            alt="Código QR para unirse"
          />
          <div>
            <p>
              Conectá el celu o la tablet <strong>al mismo WiFi</strong> y escaneá el código, o escribí en el
              navegador:
            </p>
            <p className="join-url">{joinBase!.replace(/^http:\/\//, "")}</p>
            {director.urls.length > 1 && (
              <p className="muted small">
                Otras direcciones: {director.urls.slice(1).map((u) => u.replace(/^http:\/\//, "")).join(" · ")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="msg error">La notebook no está conectada a ninguna red WiFi o cable.</p>
      )}

      {snap && (
        <>
          <p className="muted small">
            {snap.status === "online"
              ? `Conectados: ${snap.peers.length}`
              : "Reconectando con el servidor del director…"}
          </p>
          <ul className="peers">
            {snap.peers.map((p) => (
              <li key={p.deviceId}>
                {p.name} <span className="muted">· {ROLE_LABEL[p.role]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {director.isHost && (
        <>
          <button className="btn full" onClick={async () => setMsg(await openStageWindow())}>
            Abrir pantalla de escenario (monitor)
          </button>
          {msg && <p className="muted small">{msg}</p>}
        </>
      )}
    </section>
  );
}
