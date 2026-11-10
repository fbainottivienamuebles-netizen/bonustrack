// Bluetooth (solo en la app Android instalada; ver BleSyncPlugin.java).
//
// Un Android conectado al director por WiFi hace de "puente": transmite el
// estado del show en avisos BLE. Los demás Android con la app lo escuchan sin
// conectarse, así no hay límite de cuántos equipos siguen el aviso.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  decodeBlePayload,
  encodeBlePayload,
  type BlePacket,
} from "@letras/shared";

interface BleSyncPlugin {
  /** Pide permisos y verifica que el Bluetooth esté prendido. */
  requestAccess(): Promise<void>;
  /** Empieza a transmitir (o actualiza lo que se transmite). */
  advertise(opts: { payload: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(
    event: "packet",
    cb: (e: { payload: string; rssi: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const BleSync = registerPlugin<BleSyncPlugin>("BleSync");

export const bleAvailable = Capacitor.getPlatform() === "android";

function toB64(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function bleRequestAccess(): Promise<string | null> {
  try {
    await BleSync.requestAccess();
    return null;
  } catch (e) {
    return errorText(e);
  }
}

export async function bleAdvertise(p: BlePacket): Promise<void> {
  await BleSync.advertise({ payload: toB64(encodeBlePayload(p)) });
}

export async function bleStopAdvertising(): Promise<void> {
  await BleSync.stopAdvertising().catch(() => {});
}

/** Escucha avisos; devuelve la función para dejar de escuchar. */
export async function bleListen(onPacket: (p: BlePacket) => void): Promise<() => void> {
  const handle = await BleSync.addListener("packet", (e) => {
    const p = decodeBlePayload(fromB64(e.payload));
    if (p) onPacket(p);
  });
  await BleSync.startScan();
  return () => {
    handle.remove();
    BleSync.stopScan().catch(() => {});
  };
}

/**
 * Demora típica entre que el puente cambia el aviso y que un celular lo
 * recibe (intervalo de aviso ~100 ms → en promedio la mitad).
 */
export const BLE_LATENCY_MS = 60;
