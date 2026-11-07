import { useEffect, useState } from "react";
import type { OfflineBundle } from "@letras/shared";
import { Home } from "./screens/Home";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Show } from "./screens/Show";
import { loadSettings, requestPersistence, saveSettings, type Settings } from "./lib/storage";

type Screen = { name: "home" } | { name: "settings" } | { name: "show"; bundle: OfflineBundle };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>(() =>
    loadSettings().serverUrl ? { name: "home" } : { name: "settings" },
  );

  useEffect(requestPersistence, []);

  switch (screen.name) {
    case "settings":
      return (
        <SettingsScreen
          settings={settings}
          onBack={() => setScreen({ name: "home" })}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            setScreen({ name: "home" });
          }}
        />
      );
    case "show":
      return <Show bundle={screen.bundle} onExit={() => setScreen({ name: "home" })} />;
    default:
      return (
        <Home
          settings={settings}
          onOpen={(bundle) => setScreen({ name: "show", bundle })}
          onSettings={() => setScreen({ name: "settings" })}
        />
      );
  }
}
