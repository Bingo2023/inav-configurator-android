# INAV Configurator für Android

Android-Version des [INAV Configurator](https://github.com/iNavFlight/inav-configurator):
eine Capacitor-WebView-App, die den Original-Quellcode **unverändert als Git-Submodule**
einbindet. Verbindung zum Flight Controller per **USB-OTG** (MSP über VCP/CP210x/FTDI/CH340).

*Read this in [English](README.en.md).*

## Status

| Funktion | Status |
|---|---|
| Verbinden per USB-OTG, alle Konfigurations-Tabs, Disconnect | ✅ funktioniert |
| Mission Control (Karte braucht Internet) | ✅ funktioniert |
| Firmware flashen (DFU) | ❌ bewusst nicht unterstützt (eigenes USB-Protokoll) → am PC flashen |
| SITL / TCP / UDP | ❌ nicht unterstützt (Stubs vorhanden, nachrüstbar) |
| Datei-Export (Blackbox-Download, CLI-Diff speichern) | ❌ noch nicht angebunden (→ @capacitor/filesystem) |

Getestet mit INAV Configurator 9.0.2 (Commit `19ba259`) auf Android, FC: MICOAIR743V2 (INAV 9.0.1).

## Architektur: „Shim statt Fork"

Der INAV Configurator ist eine Electron-App — die gesamte UI ist Web-Technologie. Nur die
schmale Electron-Schicht wird ersetzt. **Keine Datei im Upstream-Repo wird verändert.**

1. **Git-Submodule** `inav-configurator/` — gepinnt auf einen Upstream-Release-Stand.
2. **`shim/electron-api.js`** — Nachbau der Preload-Brücke `window.electronAPI`
   (Original: `inav-configurator/js/main/preload.js`). Serial-Aufrufe gehen an das
   native Capacitor-Plugin, Settings an localStorage, App-Infos an Web-Äquivalente.
   Enthält derzeit noch ein Debug-Overlay (rote Fehlerbox), das vor einem Release
   entfernt werden sollte.
3. **`vite.config.mobile.mjs`** — baut den Upstream-Code eigenständig (das
   Electron-Forge-Setup des Upstreams ist außerhalb von Forge nicht nutzbar).
   Enthält: Aliase für Node-/Electron-Module → `shim/`, jQuery-Injektion,
   Asset-Inlining und **selbstüberwachende Build-Zeit-Patches** für zwei
   Upstream-Bugs (ungeschütztes `callback()` in `GUI.tab_switch_cleanup`;
   `.then()` auf dem synchronen `appGetVersion()` in `appUpdater.js`).
   Findet ein Patch seine Code-Stelle nicht mehr, warnt der Build.
4. **`android-src/`** — natives Capacitor-Plugin `UsbSerialPlugin.java`
   (USB Host API via [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android))
   und `MainActivity.java`. Wichtig: Der WebView-User-Agent bekommt den Zusatz
   `Electron/0.0.0-android`, weil der Upstream die Electron-Version aus dem
   User-Agent parst und sonst crasht.

Datenfluss: `UI (unverändert) → window.electronAPI (Shim) → Capacitor → UsbSerialPlugin → USB-OTG → FC`

Wichtige Vertragsdetails, die der Shim exakt einhält (aus dem Upstream-Code abgeleitet):
- `listSerialDevices()` liefert ein Array **nackter Pfad-Strings ohne Doppelpunkt**
  (Format `usb-<deviceId>`); `port_handler.js` filtert alles mit `:` heraus.
- `serialConnect()` liefert `{error: false, id}` — ohne `id` sendet die App nichts.
- `serialSend()` → `{bytesWritten}` bzw. `{error, msg}`; `serialClose()` feuert
  zusätzlich das `serialClose`-Event (sonst bleibt der Disconnect wirkungslos).

## Bauen

Voraussetzungen: Node ≥ 20, Android Studio (mit SDK + mitgeliefertem JDK), Git.

```bash
git clone --recursive https://github.com/<user>/inav-configurator-android.git
cd inav-configurator-android
npm install                 # installiert auch Submodule-Deps (postinstall)
npm run build:mobile        # Vite-Build des Upstream-Codes mit Shims → dist-mobile/
npx cap add android         # nur beim allerersten Mal
# danach android-src/-Dateien einspielen (siehe android-src/manifest-snippet.xml
# und android-src/gradle-snippet.txt) — bei bereits eingerichtetem android/ entfällt das
npm run sync
cd android && ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Windows/Git Bash: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
(am besten in `~/.bashrc`).

## Update auf eine neue Upstream-Version

```bash
./scripts/update-upstream.sh <tag-oder-commit>    # z.B. 9.1.0 oder 19ba259
```

Hinweis: INAV veröffentlicht Releases gelegentlich **ohne Git-Tag** — dann den
Commit-Hash von der GitHub-Release-Seite verwenden.

Das Skript checkt aus, installiert, baut und synct — und druckt eine Prüfliste.
Die drei Stellen, an denen ein Update reiben kann:

1. **`js/main/preload.js` diffen** (macht das Skript automatisch gegen den vorherigen
   Stand): neue/geänderte Brücken-Funktionen → `shim/electron-api.js` nachziehen.
2. **Build-Warnungen lesen**: `[upstream-patches] Muster nicht gefunden` heißt, ein
   gepatchter Upstream-Bug wurde gefixt oder der Code ist umgezogen → Patch in
   `vite.config.mobile.mjs` entfernen bzw. anpassen.
3. **Neue Node-/Electron-Imports** (greppt das Skript): ggf. neuen Alias/Shim ergänzen.

Nach dem Test: Submodule-Pin committen (`git add inav-configurator && git commit …`).

⚠️ Niemals `npm update`/`npm audit fix` **im Submodule-Ordner** ausführen — das
verändert dessen `package.json`/`yarn.lock` und bricht das Prinzip „unveränderte
Quelle". Falls doch passiert: `git -C inav-configurator restore package.json yarn.lock`.

## Lizenz

GPL-3.0, wie der Upstream.
