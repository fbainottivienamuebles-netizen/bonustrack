// Protocolo de estado en vivo: un Controlador (el director) y muchos Seguidores.
//
// El Controlador es la única fuente de verdad y transmite el estado completo
// (no eventos), de forma periódica y en cada cambio. Un Seguidor que se
// reconecta solo necesita el último mensaje para resincronizarse, y si se
// corta la conexión sigue calculando la posición con su propio reloj.
//
// Transportes:
//  - WiFi local: WebSocket contra el servidor del director (apps/director).
//  - Bluetooth: un Android "puente" retransmite el estado en avisos BLE
//    (ver encodeBlePayload). Sin conexión, así no hay límite de aparatos.
//
// Este archivo no importa nada en tiempo de ejecución (solo tipos), así lo
// pueden usar los tests con Node directamente.

import type { PlaybackClock, PlayStatus } from "./timeline";
import type { OfflineBundle, TempoSource } from "./model";

export type DeviceRole = "controlador" | "seguidor" | "pantalla";

/** Puerto por defecto del servidor del director en la red local. */
export const LOCAL_PORT = 8787;

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
    return isShowState(s) ? s : null;
  } catch {
    return null;
  }
}

export function isShowState(s: unknown): s is ShowState {
  const x = s as ShowState | null;
  return !!x && x.v === 1 && typeof x.seq === "number" && typeof x.songId === "string";
}

// ---------- Mensajes por WiFi (WebSocket /sync) ----------

export interface PeerInfo {
  deviceId: string;
  name: string;
  role: DeviceRole;
}

/** `at`: reloj del servidor (ms) en el instante en que vale `state.positionMs`. */
export type ClientMsg =
  | ({ t: "hello" } & PeerInfo)
  | { t: "ping"; c: number }
  | { t: "bundle"; bundle: OfflineBundle }
  | { t: "state"; state: ShowState; at: number };

export type ServerMsg =
  | { t: "welcome" }
  | { t: "pong"; c: number; s: number }
  | { t: "bundle"; bundle: OfflineBundle }
  | { t: "state"; state: ShowState; at: number }
  | { t: "peers"; peers: PeerInfo[] };

// ---------- Sincronía de relojes (estilo NTP) ----------

/**
 * Estima la diferencia entre el reloj local y el del servidor a partir de
 * pings. Se queda con la muestra de menor ida y vuelta (la menos afectada
 * por demoras de la red) entre las últimas `keep`.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  private keep: number;
  constructor(keep = 10) {
    this.keep = keep;
  }

  /** c: hora local al enviar el ping; s: hora del servidor; now: hora local al recibir. */
  add(c: number, s: number, now: number) {
    const rtt = Math.max(0, now - c);
    this.samples.push({ rtt, offset: s - (c + rtt / 2) });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** Ida y vuelta de la mejor muestra (ms), o null si no hay. */
  get rtt(): number | null {
    return this.best()?.rtt ?? null;
  }

  /** servidor = local + offset */
  get offset(): number {
    return this.best()?.offset ?? 0;
  }

  serverNow(localNow: number): number {
    return localNow + this.offset;
  }

  private best() {
    let b: { rtt: number; offset: number } | undefined;
    for (const x of this.samples) if (!b || x.rtt < b.rtt) b = x;
    return b;
  }
}

/**
 * Convierte el estado recibido en un reloj local: si está sonando, adelanta
 * la posición lo que pasó desde `at` (hora del servidor) hasta ahora.
 */
export function clockFromState(
  s: Pick<ShowState, "status" | "positionMs" | "rate">,
  atServerMs: number,
  serverNowMs: number,
  localNowMs: number,
): PlaybackClock {
  const elapsed = s.status === "playing" ? Math.max(0, serverNowMs - atServerMs) * s.rate : 0;
  return {
    status: s.status,
    anchorPositionMs: Math.max(0, s.positionMs + elapsed),
    anchorWallMs: localNowMs,
    rate: s.rate,
  };
}

// ---------- Bluetooth (aviso BLE, 16 bytes) ----------
//
//  0     versión (1)
//  1-2   seq (uint16, da la vuelta)
//  3-6   hash del setlistId (uint32)
//  7-8   entryIndex (uint16)
//  9     status (0 stopped, 1 playing, 2 paused)
//  10-13 positionMs (uint32)
//  14-15 rate × 1000 (uint16)
//
// La letra NO viaja por Bluetooth: cada celular ya tiene que tener el setlist
// descargado; el hash permite encontrarlo.

export const BLE_VERSION = 1;
export const BLE_PAYLOAD_BYTES = 16;

export interface BlePacket {
  seq: number;
  setlistHash: number;
  entryIndex: number;
  status: PlayStatus;
  positionMs: number;
  rate: number;
}

const STATUS_CODES: PlayStatus[] = ["stopped", "playing", "paused"];

/** FNV-1a de 32 bits: hash corto y estable para identificar el setlist. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function encodeBlePayload(p: BlePacket): Uint8Array {
  const buf = new Uint8Array(BLE_PAYLOAD_BYTES);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, BLE_VERSION);
  dv.setUint16(1, p.seq & 0xffff);
  dv.setUint32(3, p.setlistHash >>> 0);
  dv.setUint16(7, Math.max(0, Math.min(0xffff, p.entryIndex)));
  dv.setUint8(9, Math.max(0, STATUS_CODES.indexOf(p.status)));
  dv.setUint32(10, Math.max(0, Math.min(0xffffffff, Math.round(p.positionMs))));
  dv.setUint16(14, Math.max(0, Math.min(0xffff, Math.round(p.rate * 1000))));
  return buf;
}

export function decodeBlePayload(buf: Uint8Array): BlePacket | null {
  if (buf.length < BLE_PAYLOAD_BYTES) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(0) !== BLE_VERSION) return null;
  const status = STATUS_CODES[dv.getUint8(9)];
  const rate = dv.getUint16(14) / 1000;
  if (!status || rate <= 0) return null;
  return {
    seq: dv.getUint16(1),
    setlistHash: dv.getUint32(3),
    entryIndex: dv.getUint16(7),
    status,
    positionMs: dv.getUint32(10),
    rate,
  };
}
