// Mobile-Build des UNVERÄNDERTEN Upstream-Codes — Version 2.
//
// Änderung gegenüber v1: Wir laden die Upstream-Vite-Config NICHT mehr dynamisch.
// Der Upstream nutzt ein Electron-Forge-Setup (vite.base.config.js,
// vite.main-renderer.config.js, ...), dessen Configs an Forge-interne Variablen
// gekoppelt sind — außerhalb von Forge sind sie nicht ladbar (und der dynamische
// Import scheiterte unter Windows zusätzlich am Pfadformat).
//
// Diese Datei ist daher eine eigenständige, minimale Renderer-Config.
// PFLEGEHINWEIS bei Upstream-Updates: einmal inav-configurator/vite.base.config.js
// gegenlesen, ob dort neue Aliase/Plugins dazugekommen sind, und sie hier spiegeln.

import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inject from '@rollup/plugin-inject';

const here = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.resolve(here, 'inav-configurator');
const shim = (f) => path.resolve(here, 'shim', f);

export default defineConfig({
  root: upstream,
  base: './',
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.mcm', '**/*.hex', '**/*.bin'],

  plugins: [
    // Der Configurator-Code nutzt $/jQuery als Globals; Upstream macht dieselbe
    // Injektion über @rollup/plugin-inject in seiner Forge-Config.
    inject({
      $: 'jquery',
      jQuery: 'jquery',
      include: ['**/*.js', '**/*.mjs'],
      exclude: ['**/node_modules/**'],
    }),
  ],

  build: {
    outDir: path.resolve(here, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: path.resolve(upstream, 'index.html'),
    },
  },

  resolve: {
    alias: [
      // ---- Der entscheidende Tausch: Node-serialport → Android-USB-Shim ----
      { find: /^serialport$/, replacement: shim('serialport.js') },
      { find: /^@serialport\/.*/, replacement: shim('empty.js') },

      // ---- USB-Rohzugriff (DFU-Flashen) — auf Android v1 nicht unterstützt ----
      { find: /^usb$/, replacement: shim('empty.js') },

      // ---- Electron-APIs → Stubs / Web-Äquivalente ----
      { find: /^electron$/, replacement: shim('electron.js') },
      { find: /^@electron\/remote$/, replacement: shim('electron.js') },
      { find: /^electron-store$/, replacement: shim('electron-store.js') },
      { find: /^electron-window-state$/, replacement: shim('empty.js') },
      { find: /^electron-squirrel-startup$/, replacement: shim('empty.js') },

      // ---- Node-Builtins, die im Renderer auftauchen können ----
      // ('fs' löst Upstream selbst über die npm-Pakete fs/browserify-fs auf,
      //  wir leiten node:-Varianten trotzdem sicherheitshalber um)
      { find: /^node:fs(\/promises)?$/, replacement: shim('fs.js') },
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
});
