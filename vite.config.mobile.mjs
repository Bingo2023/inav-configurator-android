// Mobile-Build des UNVERÄNDERTEN Upstream-Codes — Version 3.
//
// v3: window.electronAPI-Brücke (shim/electron-api.js) wird als erstes Modul
//     geladen; jQuery-Global über gebündeltes Pre-Script; App-Version aus dem
//     Upstream-package.json als __INAV_VERSION__ eingebrannt.
//
// PFLEGEHINWEIS bei Upstream-Updates:
//   1. inav-configurator/js/main/preload.js diffen → shim/electron-api.js nachziehen
//   2. inav-configurator/vite.base.config.js gegenlesen → Aliase/Plugins spiegeln

import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync, existsSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import inject from '@rollup/plugin-inject';

const here = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.resolve(here, 'inav-configurator');
const shim = (f) => path.resolve(here, 'shim', f);

const upstreamPkg = JSON.parse(readFileSync(path.join(upstream, 'package.json'), 'utf8'));

export default defineConfig({
  root: upstream,
  base: './',
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.mcm', '**/*.hex', '**/*.bin'],

  plugins: [
    // BUILD-ZEIT-PATCHES für Upstream-Bugs, die nur in unserer Umgebung zünden.
    // Das Submodule bleibt unberührt; findet ein Patch seine Stelle nach einem
    // Upstream-Update nicht mehr, warnt der Build laut (dann prüfen/entfernen).
    {
      name: 'upstream-patches',
      transform(code, id) {
        const file = id.replace(/\\/g, '/');
        const patches = [
          {
            // tab_switch_cleanup() wird u.a. in serial_backend.js OHNE callback
            // aufgerufen → callback() crasht, blockiert Tab-Wechsel & Disconnect.
            file: '/js/gui.js',
            find: 'GUI_control.prototype.tab_switch_cleanup = function (callback) {',
            insertAfter: "\n    if (typeof callback !== 'function') { callback = function () {}; }",
          },
          {
            // appGetVersion ist laut Preload SYNCHRON (sendSync), appUpdater ruft
            // trotzdem .then() darauf auf (Upstream-Bug, crasht auch am Desktop).
            file: '/js/appUpdater.js',
            find: 'window.electronAPI.appGetVersion().then(',
            replaceWith: 'Promise.resolve(window.electronAPI.appGetVersion()).then(',
          },
        ];
        let out = code;
        let touched = false;
        for (const p of patches) {
          if (!file.endsWith(p.file)) continue;
          if (!out.includes(p.find)) {
            this.warn(`[upstream-patches] Muster in ${p.file} nicht gefunden — Upstream geändert? Patch prüfen!`);
            continue;
          }
          out = p.insertAfter !== undefined
            ? out.replace(p.find, p.find + p.insertAfter)
            : out.replace(p.find, p.replaceWith);
          touched = true;
        }
        return touched ? out : null;
      },
    },
    // Lädt VOR allem anderen: jQuery-Global + electronAPI-Brücke.
    // order 'pre', damit Vite das Script mitbündelt (Modul-Imports auflösbar).
    {
      name: 'android-bootstrap',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          return [
            {
              tag: 'script',
              attrs: { type: 'module' },
              children:
                "import $ from 'jquery'; import 'inav-android-bridge'; window.$ = window.jQuery = $;",
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    },
    // Kopiert Dateien, die der Configurator zur LAUFZEIT nachlädt (Tab-HTMLs,
    // Sprachdateien, OSD-Fonts, Bilder). In der Electron-Version liegen diese
    // Ordner einfach neben der App — bei uns müssen sie in den Build.
    {
      name: 'copy-runtime-dirs',
      closeBundle() {
        const outDir = path.resolve(here, 'dist-mobile');
        for (const dir of ['tabs', 'images', 'resources', 'locale', 'locales', '_locales']) {
          const src = path.join(upstream, dir);
          if (existsSync(src)) {
            cpSync(src, path.join(outDir, dir), { recursive: true });
            console.log(`[copy-runtime-dirs] ${dir}/ → dist-mobile/${dir}/`);
          }
        }
      },
    },
    // $/jQuery als freie Variable in Modulen (inkl. jquery-ui, jBox in node_modules)
    inject({
      $: 'jquery',
      jQuery: 'jquery',
    }),
  ],

  build: {
    outDir: path.resolve(here, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020',
    // wie Upstream (vite.main-renderer.config.js): alle importierten Assets
    // inline einbetten — macht relative Pfade im gebauten Zustand robust
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 10240,
    rollupOptions: {
      input: path.resolve(upstream, 'index.html'),
    },
  },

  resolve: {
    alias: [
      // ---- Unsere electronAPI-Brücke (siehe android-bootstrap oben) ----
      { find: /^inav-android-bridge$/, replacement: shim('electron-api.js') },

      // ---- Falls Module serialport direkt importieren (Nebenpfade) ----
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
      { find: /^node:fs(\/promises)?$/, replacement: shim('fs.js') },
      { find: /^(node:)?path$/, replacement: 'path-browserify' },
      { find: /^(node:)?events$/, replacement: 'events' },
      { find: /^(node:)?buffer$/, replacement: 'buffer' },
      { find: /^(node:)?stream$/, replacement: shim('stream.js') },
      { find: /^(node:)?timers$/, replacement: shim('timers.js') },
      { find: /^(node:)?child_process$/, replacement: shim('empty.js') },
      { find: /^(node:)?os$/, replacement: shim('os.js') },
    ],
  },

  define: {
    'process.platform': JSON.stringify('android'),
    'process.env.NODE_ENV': JSON.stringify('production'),
    __INAV_VERSION__: JSON.stringify(upstreamPkg.version),
  },
});
