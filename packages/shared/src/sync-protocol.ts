// Protocolo de estado en vivo (fase 2, BLE). Definido desde ya para que el
// modelo de la app no cambie cuando se agregue el transporte.
//
// El Controlador es la única fuente de verdad y transmite el estado completo
// (no eventos), de forma periódica y en cada cambio. Un Seguidor que se
// reconecta solo necesita el último mensaje para resincronizarse.

import type { PlayStatus } from "./timeline";
import type { TempoSource } from "./model";

export type DeviceRole = "controlador" | "seguidor" | "pantalla";

export interface ShowState {
  v: 1;
  /** Secuencia creciente; los Seguidores descartan mensajes viejos. */
  seq: number;
  /** Id del dispositivo que emite. Permite reasignar el Controlador a futuro. */
  controllerId: string;
  setlistId: string;
  /** Índice en la lista aplanada del setlist (ver flattenSetlist). */
  entryIndex: number;
  songId: string;
  status: PlayStatus;
  /** Posición del tema en el instante de envío. */
  positionMs: number;
  /** Factor tempo real / tempo de referencia. */
  rate: number;
  bpm: number | null;
  tempoSource: TempoSource;
}

export function encodeShowState(s: ShowState): string {
  return JSON.stringify(s);
}

export function decodeShowState(raw: string): ShowState | null {
  try {
    const s = JSON.parse(raw) as ShowState;
    if (s?.v !== 1 || typeof s.seq !== "number" || typeof s.songId !== "string") return null;
    return s;
  } catch {
    return null;
  }
}
