# INAV Configurator für Android

Android-Version des [INAV Configurator](https://github.com/iNavFlight/inav-configurator) als
**Capacitor-WebView-App**, die den Original-Quellcode **unverändert als Git-Submodule** einbindet.

## Grundprinzip: „Shim statt Fork"

Der INAV Configurator ist eine Electron-App: Die gesamte UI ist Web-Technologie (HTML/JS/CSS,
gebaut mit Vite) – nur der Zugriff auf serielle Ports, Dateisystem und Fenster läuft über
Electron/Node. Genau diese schmale Schicht wird hier ausgetauscht:

```
┌─────────────────────────────────────────────────┐
│ Android App (Capacitor)                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ WebView                                     │ │
│ │ ┌─────────────────────────────────────────┐ │ │
│ │ │ inav-configurator (Submodule,           │ │ │
│ │ │ UNVERÄNDERT, gebaut mit Vite)           │ │ │
│ │ └───────────────┬─────────────────────────┘ │ │
│ │        Vite-Alias: serialport → shim/       │ │
│ │ ┌───────────────▼─────────────────────────┐ │ │
│ │ │ shim/serialport.js (SerialPort-API-     │ │ │
│ │ │ kompatibel, ruft Capacitor-Plugin auf)  │ │ │
│ │ └───────────────┬─────────────────────────┘ │ │
│ └─────────────────┼───────────────────────────┘ │
│ ┌─────────────────▼───────────────────────────┐ │
│ │ UsbSerialPlugin.java                        │ │
│ │ (Android USB Host API via                   │ │
│ │  usb-serial-for-android)                    │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                      │ USB-OTG
                ┌─────▼─────┐
                │ Flight    │
                │ Controller│
                └───────────┘
```

**Es wird keine einzige Datei im Upstream-Repo geändert.** Alle Anpassungen passieren über:

1. **Git-Submodule** – `inav-configurator/` ist auf einen Release-Tag gepinnt.
2. **Vite-Aliase** (`vite.config.mobile.mjs`) – Node-/Electron-Module werden beim Build
   auf die Shims in `shim/` umgeleitet. Der Upstream-Code importiert weiterhin `serialport`,
   bekommt aber unsere Android-Implementierung.
3. **Capacitor-Plugin** (`android-src/`) – natives Android-USB, API-kompatibel zum
   Node-`serialport`-Paket (Teilmenge: `list`, `open`, `write`, `close`, `data`-Events).

## Setup (einmalig)

Voraussetzungen: Node ≥ 20, Android Studio + SDK, JDK 17.

```bash
git clone <dieses-repo> && cd inav-configurator-android

# Upstream als Submodule holen und auf Release-Tag pinnen
git submodule add https://github.com/iNavFlight/inav-configurator.git inav-configurator
git -C inav-configurator checkout 9.0.2   # aktuellen Tag wählen

npm install                                # installiert auch Submodule-Deps (postinstall)
npm run build:mobile                       # Vite-Build des Upstream-Codes mit Shims
npx cap add android                        # generiert android/-Projekt

# Native Dateien einspielen (nur nach `cap add android` nötig, nicht bei Updates):
cp android-src/java/org/inav/configurator/mobile/*.java \
   android/app/src/main/java/org/inav/configurator/mobile/
cp android-src/res/xml/device_filter.xml android/app/src/main/res/xml/
# → android-src/manifest-snippet.xml in AndroidManifest.xml einfügen
# → android-src/gradle-snippet.txt in android/app/build.gradle einfügen

npx cap sync android
npx cap open android                       # in Android Studio bauen/deployen
```

## Update auf neue Upstream-Version (der eigentliche Pflege-Workflow)

```bash
./scripts/update-upstream.sh 9.1.0
```

Das Skript macht: Tag auschecken → Submodule-Deps installieren → Mobile-Build → `cap sync`.
Danach in Android Studio bauen. **Das native Android-Projekt und die Shims bleiben
unangetastet** – nur wenn Upstream seine Serial-/Electron-Schnittstelle ändert (selten),
muss `shim/` nachgezogen werden. Prüfpunkte dafür:

- `inav-configurator/js/serial*.js` bzw. `js/connection/` – welche `serialport`-APIs werden genutzt?
- `inav-configurator/vite.config.*` – hat sich der Build geändert? (`vite.config.mobile.mjs`
  merged die Upstream-Config, Änderungen werden also meist automatisch übernommen)
- `inav-configurator/package.json` – neue native Node-Dependencies? → ggf. neuer Alias/Shim.

## Was funktioniert / was (noch) nicht

| Bereich | Status |
|---|---|
| Konfiguration per USB-OTG (MSP über VCP/CP210x/FTDI/CH340) | ✅ Ziel dieser App |
| UI (Tabs, Setup, Mixer, OSD, Modes, …) | ✅ läuft 1:1 aus Upstream |
| Firmware flashen (DFU) | ❌ v1: bewusst außen vor — DFU ist ein eigenes USB-Protokoll, kein Serial. Workaround: am PC flashen |
| TCP/UDP (SITL) & BLE | ⚠️ braucht je ein weiteres kleines Plugin + Shim (gleiches Muster) |
| Blackbox-Log-Download auf Gerät | ⚠️ Datei-Dialoge sind Electron-spezifisch → `shim/electron.js` erweitern (Capacitor Filesystem/Share) |

## Wichtige Hinweise

- Die Shims decken die **typische** `serialport`-v10+-API ab. Nach dem Pinnen eines Tags
  einmal gegen den tatsächlichen Code prüfen (grep nach `from 'serialport'` /
  `require('serialport')` und `electron`-Imports) und Aliase in `vite.config.mobile.mjs`
  ergänzen, falls Upstream weitere Node-Module direkt im Renderer nutzt.
- Tablet im Querformat empfohlen — die UI ist für Desktop-Breiten gemacht. Für Handys ggf.
  `MainActivity` mit initialem WebView-Zoom-Out (bereits vorbereitet).
- Lizenz: GPL-3.0 (wie Upstream). Dieses Wrapper-Projekt ist damit ebenfalls GPL-3.0.
