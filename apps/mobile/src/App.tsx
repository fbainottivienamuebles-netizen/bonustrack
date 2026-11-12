import { useEffect, useState } from "react";
import type { OfflineBundle } from "@letras/shared";
import { Check } from "./screens/Check";
import { Follow, type FollowMode, type FollowSource } from "./screens/Follow";
import { Home } from "./screens/Home";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Show } from "./screens/Show";
import { detectDirectorHere, type DirectorInfo } from "./lib/local-link";
import { loadSettings, requestPersistence, saveSettings, type Settings } from "./lib/storage";

type Screen =
  | { name: "home" }
  | { name: "settings" }
  | { name: "check" }
  | { name: "show"; bundle: OfflineBundle }
  | { name: "follow"; source: FollowSource; mode: FollowMode };

/** El QR del director abre ?modo=seguir; los monitores, ?modo=escenario; el proyector, ?modo=video. */
function initialScreen(): Screen {
  const modo = new URLSearchParams(location.search).get("modo");
  if (modo === "seguir" || modo === "escenario" || modo === "video")
    return {
      name: "follow",
      source: { kind: "wifi", base: location.origin },
      mode: modo === "seguir" ? "lista" : modo,
    };
  return loadSettings().serverUrl ? { name: "home" } : { name: "settings" };
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [director, setDirector] = useState<DirectorInfo | null>(null);

  useEffect(requestPersistence, []);
  useEffect(() => {
    detectDirectorHere().then(setDirector);
  }, []);

  const goHome = () => {
    if (location.search) history.replaceState(null, "", location.pathname);
    setScreen({ name: "home" });
  };

  switch (screen.name) {
    case "settings":
      return (
        <SettingsScreen
          settings={settings}
          onBack={goHome}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            goHome();
          }}
        />
      );
    case "check":
      return <Check director={director} onClose={goHome} />;
    case "show":
      return <Show bundle={screen.bundle} director={director?.isHost ? director : null} onExit={goHome} />;
    case "follow":
      return <Follow key={JSON.stringify(screen)} source={screen.source} mode={screen.mode} onExit={goHome} />;
    default:
      return (
        <Home
          settings={settings}
          director={director}
          onOpen={(bundle) => setScreen({ name: "show", bundle })}
          onFollow={(source, mode) => setScreen({ name: "follow", source, mode })}
          onSettings={() => setScreen({ name: "settings" })}
          onCheck={() => setScreen({ name: "check" })}
        />
      );
  }
}
