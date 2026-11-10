// Conexión por WiFi local con el servidor del director (apps/director).
//
// - Se reconecta sola si se corta (cada 1 a 5 s).
// - Mide la diferencia de reloj con el servidor (pings) para que todos los
//   equipos marquen la misma línea al mismo tiempo.
// - Mientras está desconectada, quien la usa sigue con su reloj local: la
//   letra no se congela.

import { useEffect, useState } from "react";
import {
  ClockSync,
  isOfflineBundle,
  isShowState,
  type ClientMsg,
  type DeviceRole,
  type OfflineBundle,
  type PeerInfo,
  type ServerMsg,
  type ShowState,
} from "@letras/shared";
import { Capacitor } from "@capacitor/core";
import { deviceId, deviceName } from "./device";

export type LinkStatus = "connecting" | "online" | "offline";

export interface LinkSnapshot {
  status: LinkStatus;
  peers: PeerInfo[];
  bundle: OfflineBundle | null;
  /** Último estado recibido y la hora del servidor en que valía. */
  state: { state: ShowState; at: number } | null;
  /** Ida y vuelta con el servidor (ms). */
  rtt: number | null;
}

export class LocalLink {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryMs = 1000;
  private pingTimer = 0;
  private retryTimer = 0;
  private listeners = new Set<(s: LinkSnapshot) => void>();
  readonly sync = new ClockSync();
  snap: LinkSnapshot = { status: "connecting", peers: [], bundle: null, state: null, rtt: null };
  /** Se llama cada vez que se (re)conecta, para reenviar lo propio. */
  onOpen: (() => void) | null = null;

  private readonly baseUrl: string;
  private readonly role: DeviceRole;

  constructor(baseUrl: string, role: DeviceRole) {
    this.baseUrl = baseUrl;
    this.role = role;
    this.connect();
  }

  /** Hora del servidor ahora mismo (ms), estimada. */
  serverNow(): number {
    return this.sync.serverNow(performance.now());
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  subscribe(fn: (s: LinkSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  private welcomed = false;

  /** "En línea" recién cuando el servidor saludó y ya medimos su reloj. */
  private maybeOnline() {
    if (!this.welcomed || !this.sync.ready || this.snap.status === "online") return;
    this.update({ status: "online" });
    this.onOpen?.();
  }

  private update(p: Partial<LinkSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn(this.snap);
  }

  private connect() {
    if (this.closed) return;
    const url = this.baseUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/sync";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retryMs = 1000;
      // El servidor pudo reiniciarse: su reloj ya no es el mismo.
      // Por eso también se descarta el último estado: su hora quedó en el
      // reloj viejo. Mientras llega el nuevo, cada equipo sigue con el propio.
      this.sync.reset();
      this.welcomed = false;
      this.update({ state: null });
      this.send({ t: "hello", deviceId: deviceId(), name: deviceName(), role: this.role });
      // Ráfaga de pings al conectar para tener rápido una buena medición.
      let burst = 0;
      const ping = () => this.send({ t: "ping", c: performance.now() });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        ping();
        if (++burst === 6) {
          clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(ping, 3000);
        }
      }, 150);
      ping();
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.welcomed = true;
          this.maybeOnline();
          break;
        case "pong":
          this.sync.add(msg.c, msg.s, performance.now());
          this.update({ rtt: this.sync.rtt });
          this.maybeOnline();
          break;
        case "bundle":
          if (isOfflineBundle(msg.bundle)) this.update({ bundle: msg.bundle });
          break;
        case "state":
          if (!isShowState(msg.state)) break;
          // Descarta mensajes viejos del mismo controlador.
          if (
            this.snap.state &&
            this.snap.state.state.controllerId === msg.state.controllerId &&
            msg.state.seq < this.snap.state.state.seq
          )
            break;
          this.update({ state: { state: msg.state, at: msg.at } });
          break;
        case "peers":
          this.update({ peers: msg.peers });
          break;
      }
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      if (!this.closed) {
        this.update({ status: "offline" });
        this.scheduleRetry();
      }
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(5000, this.retryMs * 1.5);
  }
}

/** Abre la conexión mientras el componente está montado (si baseUrl no es null). */
export function useLocalLink(baseUrl: string | null, role: DeviceRole) {
  const [link, setLink] = useState<LocalLink | null>(null);
  const [snap, setSnap] = useState<LinkSnapshot | null>(null);
  useEffect(() => {
    if (!baseUrl) return;
    const l = new LocalLink(baseUrl, role);
    setLink(l);
    const off = l.subscribe(setSnap);
    return () => {
      off();
      l.close();
      setLink(null);
      setSnap(null);
    };
  }, [baseUrl, role]);
  return { link, snap };
}

// ---------- Detectar la sala ----------

export interface DirectorInfo {
  /** Dirección con la que llegamos al director (p. ej. http://192.168.0.10:8787). */
  base: string;
  /** Direcciones de la notebook en la red local, para mostrar/compartir. */
  urls: string[];
  /** true si esta pantalla corre en la misma notebook del director. */
  isHost: boolean;
}

/** Normaliza lo que escribe el usuario: "192.168.0.10" → "http://192.168.0.10:8787". */
export function normalizeDirectorAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    if (!u.port) u.port = "8787";
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function probeDirector(base: string, timeoutMs = 2500): Promise<DirectorInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(base.replace(/\/+$/, "") + "/api/local/info", {
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const info = (await res.json()) as { app?: string; urls?: string[] };
    if (info.app !== "letras-director") return null;
    const host = new URL(base).hostname;
    return {
      base,
      urls: info.urls ?? [],
      isHost: host === "localhost" || host === "127.0.0.1",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** ¿Esta página la está sirviendo el director? (solo en navegador). */
export function detectDirectorHere(): Promise<DirectorInfo | null> {
  if (Capacitor.isNativePlatform() || !/^https?:$/.test(location.protocol)) return Promise.resolve(null);
  // La app publicada en internet nunca es el director.
  if (location.hostname.endsWith(".vercel.app")) return Promise.resolve(null);
  return probeDirector(location.origin);
}
