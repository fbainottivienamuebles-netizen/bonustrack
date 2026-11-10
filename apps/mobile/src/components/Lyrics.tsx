// Letra del tema con la línea activa centrada. La usan el modo show, los
// seguidores y las pantallas de escenario.

import { useEffect, useRef, type ReactNode } from "react";
import { SECTION_LABELS, type TimelineLine } from "@letras/shared";

export function Lyrics({
  timeline,
  active,
  onSeek,
  scale = 1,
  children,
}: {
  timeline: TimelineLine[];
  active: number;
  /** Si se pasa, tocar una línea salta a ese momento. */
  onSeek?: (ms: number) => void;
  /** Tamaño de letra relativo (1 = normal). */
  scale?: number;
  children?: ReactNode;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, scale]);

  return (
    <main className="lyrics" style={{ ["--lyric-scale" as string]: scale }}>
      <div className="spacer" />
      {timeline.length === 0 && <p className="muted center">Este tema no tiene letra cargada.</p>}
      {timeline.map((l) => (
        <div key={l.index}>
          {l.sectionStart && <div className="section-label">{SECTION_LABELS[l.sectionType]}</div>}
          <div
            ref={l.index === active ? activeRef : undefined}
            className={`line ${l.index === active ? "active" : l.index < active ? "past" : ""} ${onSeek ? "" : "static"}`}
            onClick={onSeek ? () => onSeek(l.tiempoInicioMs) : undefined}
          >
            {l.texto}
          </div>
        </div>
      ))}
      {children}
      <div className="spacer" />
    </main>
  );
}
