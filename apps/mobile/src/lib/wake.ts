// Mantiene la pantalla encendida durante el show.
//
// En la app instalada y en páginas seguras (https / localhost) se usa el
// bloqueo de pantalla del sistema. Los seguidores por WiFi local abren la
// app por http (sin candado) y ahí el navegador no lo permite: como respaldo
// se reproduce un video mudo e invisible, que en la mayoría de los celulares
// también evita que la pantalla se apague.
import { KeepAwake } from "@capacitor-community/keep-awake";

let video: HTMLVideoElement | null = null;

function startVideoFallback() {
  if (video) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(1);
    let on = false;
    // Un video sin cambios puede considerarse "quieto": lo hacemos parpadear.
    const timer = window.setInterval(() => {
      if (!ctx) return;
      on = !on;
      ctx.fillStyle = on ? "#000" : "#010101";
      ctx.fillRect(0, 0, 2, 2);
    }, 1000);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.srcObject = stream;
    v.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;left:0";
    document.body.appendChild(v);
    v.dataset.timer = String(timer);
    video = v;
    const play = () => v.play().catch(() => {});
    play();
    // Algunos navegadores solo dejan reproducir después de un toque.
    document.addEventListener("pointerdown", play, { once: true });
  } catch {
    /* sin respaldo */
  }
}

function stopVideoFallback() {
  if (!video) return;
  clearInterval(Number(video.dataset.timer));
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  video.remove();
  video = null;
}

export async function keepScreenOn() {
  try {
    if ((await KeepAwake.isSupported()).isSupported) {
      await KeepAwake.keepAwake();
      return;
    }
  } catch {
    /* no soportado: probamos el respaldo */
  }
  startVideoFallback();
}

export async function allowScreenOff() {
  stopVideoFallback();
  try {
    await KeepAwake.allowSleep();
  } catch {
    /* idem */
  }
}
