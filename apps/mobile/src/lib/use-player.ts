// Reloj de reproducción del tema actual, basado en PlaybackClock (shared).
// La posición nunca se acumula: se calcula desde el ancla, así no deriva.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STOPPED_CLOCK,
  clockPause,
  clockPlay,
  clockPosition,
  clockSeek,
  clockSetRate,
  type PlaybackClock,
} from "@letras/shared";

export function usePlayer(durationMs: number, initial: PlaybackClock = STOPPED_CLOCK) {
  const [clock, setClock] = useState<PlaybackClock>(initial);
  const [now, setNow] = useState(() => performance.now());
  const raf = useRef(0);

  // Mientras suena, re-render en cada frame; al llegar al final, pausa ahí.
  useEffect(() => {
    if (clock.status !== "playing") return;
    const tick = () => {
      const t = performance.now();
      if (clockPosition(clock, t) >= durationMs) {
        setNow(t);
        setClock((c) => clockSeek(clockPause(c, t), durationMs, t));
        return;
      }
      setNow(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [clock, durationMs]);

  const position = Math.min(clockPosition(clock, now), durationMs);

  const act = useCallback((f: (c: PlaybackClock, t: number) => PlaybackClock) => {
    const t = performance.now();
    setNow(t);
    setClock((c) => f(c, t));
  }, []);

  const atEnd = position >= durationMs && clock.status !== "playing";

  return {
    clock,
    position,
    atEnd,
    /** Play/pausa; en el final del tema, vuelve a empezar. */
    toggle: () =>
      act((c, t) =>
        c.status === "playing"
          ? clockPause(c, t)
          : atEnd
            ? clockPlay({ ...STOPPED_CLOCK, rate: c.rate }, t)
            : clockPlay(c, t),
      ),
    seek: (ms: number) => act((c, t) => clockSeek(c, Math.min(Math.max(0, ms), durationMs), t)),
    setRate: (rate: number) => act((c, t) => clockSetRate(c, rate, t)),
  };
}
