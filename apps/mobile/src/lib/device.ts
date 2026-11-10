// Identidad y preferencias de este equipo (se guardan en el propio equipo).

const ID_KEY = "letras.deviceId";
const NAME_KEY = "letras.deviceName";
const PREFS_KEY = "letras.followPrefs";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin storage: no se recuerda */
  }
}

export function deviceId(): string {
  let id = read(ID_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    write(ID_KEY, id);
  }
  return id;
}

function defaultName(): string {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Celular Android" : "Tablet Android";
  return "Computadora";
}

export function deviceName(): string {
  return read(NAME_KEY) || defaultName();
}

export function setDeviceName(name: string) {
  write(NAME_KEY, name.trim());
}

/** Preferencias de la vista de seguidor, distintas para pantalla grande y celular. */
export interface FollowPrefs {
  /** Tamaño de letra (1 = normal). */
  scale: number;
  /** Adelanto en ms: positivo = la letra se marca antes. */
  leadMs: number;
}

export function loadFollowPrefs(mode: string): FollowPrefs {
  const def: FollowPrefs = { scale: mode === "escenario" ? 1.6 : 1, leadMs: 0 };
  try {
    return { ...def, ...JSON.parse(read(`${PREFS_KEY}.${mode}`) ?? "{}") };
  } catch {
    return def;
  }
}

export function saveFollowPrefs(mode: string, p: FollowPrefs) {
  write(`${PREFS_KEY}.${mode}`, JSON.stringify(p));
}
