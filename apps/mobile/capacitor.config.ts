import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bonustrack.letras",
  appName: "Letras en vivo",
  webDir: "dist",
  android: {
    // Para conectarse al director por WiFi local (http://192.168.x.x:8787),
    // que no tiene candado https.
    allowMixedContent: true,
  },
};

export default config;
