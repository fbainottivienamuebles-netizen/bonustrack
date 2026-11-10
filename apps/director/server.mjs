// Servidor del director (corre en la notebook, sin internet).
//
// - Sirve la app (apps/mobile/dist) a todos los equipos de la red WiFi local.
// - /sync (WebSocket): el Controlador manda el setlist y el estado del show;
//   el servidor guarda el último de cada uno y lo reparte a los Seguidores.
//   No interpreta el show: solo retransmite y guarda, así es muy simple.
// - /api/local/info y /api/local/qr.svg: para que la app sepa que está en una
//   sala local y muestre el código QR para unirse.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT) || 8787;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../mobile/dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Direcciones IPv4 de la notebook en la red local (WiFi / cable). */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Las placas virtuales (VirtualBox, WSL, VPN) no sirven para los celulares.
      if (/virtual|vmware|vethernet|wsl|hyper-v|loopback|tailscale|zerotier/i.test(name)) continue;
      out.push({ name, address: a.address });
    }
  }
  // Primero las redes típicas de routers hogareños.
  return out.sort((a, b) => score(b.address) - score(a.address));
}
function score(ip) {
  return ip.startsWith("192.168.") ? 3 : ip.startsWith("10.") ? 2 : ip.startsWith("172.") ? 1 : 0;
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://x");

  if (url.pathname === "/api/local/info") {
    return json(res, 200, {
      app: "letras-director",
      version: 1,
      port: PORT,
      urls: lanAddresses().map((a) => `http://${a.address}:${PORT}`),
      peers: peerList().length,
    });
  }

  if (url.pathname === "/api/local/qr.svg") {
    const target = url.searchParams.get("u") ?? "";
    if (!/^http:\/\/[\d.]+:\d+\/?/.test(target)) return json(res, 400, { error: "url inválida" });
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    return res.end(svg);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }

  // Archivos de la app; cualquier otra ruta devuelve la app (index.html).
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Falta compilar la app: ejecutá  npm run director  desde la carpeta del proyecto.");
  }
  const ext = path.extname(file);
  const hashed = /assets[\\/]/.test(file);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- Sala en vivo ----------

/** @type {Map<import("ws").WebSocket, {deviceId: string, name: string, role: string} | null>} */
const clients = new Map();
let lastBundle = null; // texto del último mensaje {t:"bundle"}
let lastState = null; // texto del último mensaje {t:"state"}

function peerList() {
  return [...clients.values()].filter(Boolean);
}

function broadcast(text, except) {
  for (const ws of clients.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(text);
}

function sendPeers() {
  broadcast(JSON.stringify({ t: "peers", peers: peerList() }));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

const wss = new WebSocketServer({ server, path: "/sync", maxPayload: 50 * 1024 * 1024 });

wss.on("connection", (ws) => {
  clients.set(ws, null);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (data) => {
    const text = data.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const me = clients.get(ws);
    switch (msg.t) {
      case "ping":
        ws.send(JSON.stringify({ t: "pong", c: msg.c, s: performance.now() }));
        break;
      case "hello": {
        const info = {
          deviceId: String(msg.deviceId ?? "").slice(0, 64),
          name: String(msg.name ?? "Equipo").slice(0, 40),
          role: ["controlador", "seguidor", "pantalla"].includes(msg.role) ? msg.role : "seguidor",
        };
        const first = me === null;
        clients.set(ws, info);
        // Primero lo guardado y después el saludo: así quien llega ya sabe en
        // qué estaba el show (el director lo usa para ofrecer "retomar").
        if (lastBundle) ws.send(lastBundle);
        if (lastState) ws.send(lastState);
        ws.send(JSON.stringify({ t: "welcome" }));
        sendPeers();
        if (first) console.log(`  + ${info.name} (${info.role})  — ${peerList().length} conectados`);
        break;
      }
      case "bundle":
        if (me?.role !== "controlador") return;
        lastBundle = text;
        broadcast(text, ws);
        console.log(`  ♪ Setlist abierto: ${msg.bundle?.setlist?.nombre ?? "?"}`);
        break;
      case "state":
        if (me?.role !== "controlador") return;
        lastState = text;
        broadcast(text, ws);
        break;
    }
  });

  ws.on("close", () => {
    const me = clients.get(ws);
    clients.delete(ws);
    if (me) {
      console.log(`  - ${me.name} (${me.role})  — ${peerList().length} conectados`);
      sendPeers();
    }
  });
});

// Corta conexiones muertas (celular que se fue de la red sin avisar).
setInterval(() => {
  for (const ws of clients.keys()) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 5000).unref();

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nEl puerto ${PORT} ya está en uso: ¿el director ya está abierto en otra ventana?\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = lanAddresses();
  console.log("\n  ==============================================");
  console.log("   LETRAS EN VIVO — Director");
  console.log("  ==============================================\n");
  console.log(`   En esta notebook:   http://localhost:${PORT}`);
  if (lan.length) {
    console.log("   Celulares y tablets (misma red WiFi):");
    for (const a of lan) console.log(`      http://${a.address}:${PORT}    (${a.name})`);
  } else {
    console.log("   ⚠ No se encontró ninguna red WiFi/cable. Conectá la notebook al router.");
  }
  console.log("\n   No cierres esta ventana durante el show.\n");
  if (!process.env.NO_OPEN && process.platform === "win32") exec(`start "" "http://localhost:${PORT}"`);
});
