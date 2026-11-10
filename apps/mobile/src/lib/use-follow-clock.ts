// Reloj de un Seguidor: lo fija lo que manda el director, pero corre solo
// entre mensajes (y si se corta la conexión, sigue avanzando igual).

import { useCallback, useEffect, useRef, useState } from "react";
import { STOPPED_CLOCK, clockPosition, type PlaybackClock } from "@letras/shared";

export function useFollowClock() {
  const [clock, setClockState] = useState<PlaybackClock>(STOPPED_CLOCK);
  const [now, setNow] = useState(() => performance.now());
  const ref = useRef(clock);

  useEffect(() => {
    if (clock.status !== "playing") return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  /**
   * Aplica un reloj recibido. Si solo difiere en menos de `toleranceMs` de lo
   * que ya marcamos, se ignora: evita saltitos por la variación de la red.
   */
  const apply = useCallback((next: PlaybackClock, toleranceMs = 25) => {
    const cur = ref.current;
    const t = performance.now();
    const same =
      cur.status === next.status &&
      cur.rate === next.rate &&
      Math.abs(clockPosition(cur, t) - clockPosition(next, t)) < toleranceMs;
    if (same) return;
    ref.current = next;
    setNow(t);
    setClockState(next);
  }, []);

  return { clock, position: clockPosition(clock, now), apply };
}
