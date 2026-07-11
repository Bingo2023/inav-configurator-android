// Mobile-Build des UNVERÄNDERTEN Upstream-Codes.
//
// Kernidee: Wir übernehmen die Upstream-Vite-Config per mergeConfig() und legen nur
// Aliase darüber, die Node-/Electron-Module auf unsere Shims umleiten. Ändert Upstream
// seinen Build, wandert das hier automatisch mit — wir pflegen nur die Alias-Liste.
//
// Nach jedem Upstream-Update kurz prüfen:
//   grep -rn "from 'serialport'\|require('serialport')\|from 'electron'" inav-configurator/js
// und fehlende Module unten ergänzen.

import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.resolve(here, 'inav-configurator');
const shim = (f) => path.resolve(here, 'shim', f);

// Upstream-Config laden, falls vorhanden (Dateiname kann sich zwischen Releases ändern).
async function loadUpstreamConfig() {
  for (const name of ['vite.config.mjs', 'vite.config.js', 'vite.config.ts']) {
    try {
      const mod = await import(path.join(upstream, name));
      const cfg = mod.default ?? mod;
      return typeof cfg === 'function' ? await cfg({ command: 'build', mode: 'production' }) : cfg;
    } catch {
      /* nächsten Namen probieren */
    }
  }
  console.warn('[mobile] Keine Upstream-Vite-Config gefunden – baue mit Standardwerten.');
  return {};
}

export default defineConfig(async () => {
  const upstreamConfig = await loadUpstreamConfig();

  const mobileOverrides = {
    root: upstream,
    base: './',
    build: {
      outDir: path.resolve(here, 'dist-mobile'),
      emptyOutDir: true,
      target: 'es2020',
    },
    resolve: {
      alias: [
        // ---- Der entscheidende Tausch: Node-serialport → Android-USB-Shim ----
        { find: /^serialport$/, replacement: shim('serialport.js') },
        { find: /^@serialport\/.*/, replacement: shim('empty.js') },

        // ---- Electron-APIs (Dialoge, IPC, Shell) → Stubs / Capacitor ----
        { find: /^electron$/, replacement: shim('electron.js') },
        { find: /^@electron\/remote$/, replacement: shim('electron.js') },

        // ---- Node-Builtins, die im Renderer auftauchen können ----
        { find: /^(node:)?fs(\/promises)?$/, replacement: shim('fs.js') },
        { find: /^(node:)?path$/, replacement: 'path-browserify' },
        { find: /^(node:)?events$/, replacement: 'events' },
        { find: /^(node:)?buffer$/, replacement: 'buffer' },
        { find: /^(node:)?child_process$/, replacement: shim('empty.js') },
        { find: /^(node:)?os$/, replacement: shim('os.js') },
      ],
    },
    define: {
      'process.platform': JSON.stringify('android'),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  };

  return mergeConfig(upstreamConfig, mobileOverrides);
});
