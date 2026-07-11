import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.inav.configurator.mobile',
  appName: 'INAV Configurator',
  // Ergebnis von `npm run build:mobile` (Vite-Build des Upstream-Submodules)
  webDir: 'dist-mobile',
  android: {
    // MSP-Traffic läuft über das native Plugin, nicht über HTTP — kein Cleartext nötig.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
