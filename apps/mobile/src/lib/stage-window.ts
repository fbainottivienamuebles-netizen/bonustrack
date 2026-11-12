// Abre una pantalla de escenario (letra grande) o la Pantalla de video para
// el público en otra ventana, ubicada en el próximo monitor libre si el
// navegador lo permite (Chrome/Edge).

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label?: string;
}
interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

let opened = 0;

export async function openStageWindow(mode: "escenario" | "video" = "escenario"): Promise<string> {
  const url = `${location.origin}/?modo=${mode}`;
  const name = `${mode}-${Date.now()}`;
  const getDetails = (window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> })
    .getScreenDetails;

  if (getDetails) {
    try {
      const d = await getDetails.call(window);
      const others = d.screens.filter((s) => s !== d.currentScreen);
      if (others.length) {
        const s = others[opened % others.length];
        opened++;
        const w = window.open(
          url,
          name,
          `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`,
        );
        if (!w) return "El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio.";
        return `Abierta en ${s.label || `el monitor ${others.indexOf(s) + 2}`}. Hacé click en ella para pantalla completa.${
          others.length > 1 ? " Volvé a tocar el botón para el otro monitor." : ""
        }`;
      }
    } catch {
      /* sin permiso: abrimos una ventana común */
    }
  }

  const w = window.open(url, name, "popup,width=1100,height=700");
  if (!w) return "El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio.";
  return "Arrastrá la ventana nueva al monitor y hacé click en ella para pantalla completa.";
}
