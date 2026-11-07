// Mantiene la pantalla encendida durante el show.
import { KeepAwake } from "@capacitor-community/keep-awake";

export async function keepScreenOn() {
  try {
    if ((await KeepAwake.isSupported()).isSupported) await KeepAwake.keepAwake();
  } catch {
    /* no soportado: seguimos igual */
  }
}

export async function allowScreenOff() {
  try {
    await KeepAwake.allowSleep();
  } catch {
    /* idem */
  }
}
