// Cuenta regresiva por compás durante la cuenta previa (todos los equipos).

import type { CountInView } from "@letras/shared";

export function CountIn({ view, compact = false }: { view: CountInView | null; compact?: boolean }) {
  if (!view) return null;
  return (
    <div className={`countin ${compact ? "compact" : ""}`} aria-live="polite">
      <div className="countin-bar">
        Cuenta · compás {view.bar} de {view.bars}
      </div>
      <div className="countin-beats">
        {Array.from({ length: view.beatsPerBar }, (_, i) => (
          <span key={i} className={i + 1 === view.beat ? "on" : i + 1 < view.beat ? "past" : ""}>
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
