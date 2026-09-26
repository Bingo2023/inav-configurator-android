// Mobile-Build des UNVERÄNDERTEN Upstream-Codes — Version 7.
//
// v3: window.electronAPI-Brücke (shim/electron-api.js) wird als erstes Modul
//     geladen; jQuery-Global über gebündeltes Pre-Script; App-Version aus dem
//     Upstream-package.json als __INAV_VERSION__ eingebrannt.
// v4: android-cli-Block — blendet auf Android nicht unterstützte Bedienelemente
//     aus (CLI-Buttons, Firmware Flasher, SITL) und macht "In Datei speichern"
//     zum Ein-Knopf-Backup (führt automatisch erst 'diff all' aus).
// v6: Upstream 10.0: Build-Target es2022 (Top-Level-await), appUpdater-Patch
//     entfernt (upstream gefixt), __INAV_WEB_VERSION__ definiert.
// v7: Map Generator aktiv (ZIP-Export + Kachel-Cache im App-Speicher);
//     nur der SD-Karten-Bereich und "Sync to SD Card" sind ausgeblendet.
// v5: "Einstellungen speichern" wieder sichtbar; nach "Aus Datei laden" wird
//     automatisch 'save' gesendet (mit Fehlermeldung bei Zeitüberschreitung).
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
    // Android-CLI: nicht unterstützte Bedienelemente ausblenden; "In Datei
    // speichern" führt automatisch erst 'diff all' aus (Ein-Knopf-Backup).
    {
      name: 'android-cli',
      transformIndexHtml() {
        return [
          {
            tag: 'style',
            children:
              '.tab-cli .msc, .tab-cli .copy, .tab-cli .diffall, ' +
              '#tabs .tab_firmware_flasher, #tabs .tab_sitl { display: none !important; } ' +
              // Map Generator: nur ZIP-Export; SD-Karten-Direktsync braucht auf
              // Android einen eigenen Ordnerzugriff (SAF-Tree) → ausgeblendet.
              '.gui_box:has(#mapgen_link_sd), #mapgen_sync_btn { display: none !important; }',
            injectTo: 'head',
          },
        ];
      },
      transform(code, id) {
        if (!id.replace(/\\/g, '/').endsWith('/tabs/cli.js')) return null;
        // "In Datei speichern" komplett ersetzen: erst 'diff all', dann direkt
        // Dialog + Schreiben im selben Kontext (kein simulierter Klick — der
        // führte dazu, dass self.outputHistory leer war → 0-Byte-Dateien).
        const needle = "$('.tab-cli .save').on('click', function () {";
        if (!code.includes(needle)) {
          this.warn('[android-cli] Save-Handler in tabs/cli.js nicht gefunden — Upstream geändert? Patch prüfen!');
          return null;
        }
        const saveStart = code.indexOf(needle);
        const saveEnd = code.indexOf("        $('.tab-cli .exit')", saveStart);
        if (saveEnd === -1) {
          this.warn('[android-cli] Ende des Save-Handlers nicht gefunden — Patch prüfen!');
          return null;
        }
        const androidSave = `        $('.tab-cli .save').on('click', function () {
            // [android] Ein-Knopf-Backup: 'diff all' ausführen, dann speichern
            GUI.log('Collecting settings (diff all) ...');
            self.outputHistory = "";
            $('.tab-cli .window .wrapper').empty();
            self.send(getCliCommand('diff all\\n', cliTab.cliBuffer));

            var __last = -1, __stable = 0, __tries = 0;
            var __timer = setInterval(function () {
                __tries++;
                var len = (self.outputHistory || "").length;
                __stable = (len > 0 && len === __last) ? __stable + 1 : 0;
                __last = len;

                if (__stable < 2 && __tries < 40) return;
                clearInterval(__timer);

                var text = self.outputHistory || "";
                if (!text.length) {
                    GUI.log('Save failed: no CLI output received.');
                    return;
                }

                var options = {
                    defaultPath: generateFilename(FC.CONFIG, 'cli', 'txt'),
                    filters: [
                        { name: 'TXT', extensions: ['txt'] },
                        { name: 'CLI', extensions: ['cli'] }
                    ],
                };
                dialog.showSaveDialog(options).then(function (result) {
                    if (result.canceled) {
                        GUI.log(i18n.getMessage('cliSaveToFileAborted'));
                        return;
                    }
                    window.electronAPI.writeFile(result.filePath, text).then(function (err) {
                        if (err) {
                            GUI.log(i18n.getMessage('ErrorWritingFile'));
                            return console.error(err);
                        }
                        GUI.log(i18n.getMessage('FileSaved') + ' (' + text.length + ' bytes)');
                    });
                }).catch(function (err) {
                    console.error('[android-cli] showSaveDialog:', err);
                    GUI.log('Save failed.');
                });
            }, 700);
        });
`;

        let out = code.slice(0, saveStart) + androidSave + code.slice(saveEnd);

        // [android] Nach "Aus Datei laden": automatisch 'save' senden, sobald
        // executeCommands() sein Promise auflöst (alle Befehle quittiert).
        // Schlägt das fehl, klare Meldung im Log statt stillem Aufgeben —
        // der Nutzer kann dann "Einstellungen speichern" manuell drücken.
        const snippetNeedle = `                function executeSnippet() {
                    const commands = previewArea.val();
                    executeCommands(commands);
                    self.GUI.snippetPreviewWindow.close();
                }`;
        if (!out.includes(snippetNeedle)) {
          this.warn('[android-cli] executeSnippet nicht gefunden — Auto-Save nach Laden inaktiv. Upstream geändert? Patch prüfen!');
          return out;
        }
        const snippetReplacement = `                function executeSnippet() {
                    const commands = previewArea.val();
                    var __savePending = setTimeout(function () {
                        __savePending = null;
                        GUI.log('Auto-save timed out - please press "Save settings" manually.');
                    }, 60000);
                    Promise.resolve(executeCommands(commands)).then(function () {
                        if (!__savePending) return;
                        clearTimeout(__savePending);
                        __savePending = null;
                        self.send(getCliCommand('save\\n', cliTab.cliBuffer));
                        GUI.log('Settings applied and saved.');
                    }).catch(function (e) {
                        if (__savePending) { clearTimeout(__savePending); __savePending = null; }
                        console.error('[android-cli] executeCommands:', e);
                        GUI.log('Auto-save failed - please press "Save settings" manually.');
                    });
                    self.GUI.snippetPreviewWindow.close();
                }`;
        out = out.replace(snippetNeedle, snippetReplacement);
        return out;
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
    // es2022: Upstream nutzt ab 10.0 Top-Level-await (js/browser-entry.js)
    target: 'es2022',
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
    // ab 10.0: js/browser/platform.js (Web-Build) referenziert das ohne Fallback.
    // Wird bei uns nicht ausgeführt (Shim setzt electronAPI vorher), aber mitgebündelt.
    __INAV_WEB_VERSION__: JSON.stringify(upstreamPkg.version),
  },
});
