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
| Einstellungs-Backup: „In Datei speichern" (führt automatisch `diff all` aus) | ✅ funktioniert |
| Einstellungs-Restore: „Aus Datei laden" (speichert nach dem Übertragen automatisch) | ✅ funktioniert |
| Firmware flashen (DFU) | ❌ nicht unterstützt (eigenes USB-Protokoll) → am PC flashen; Tab ausgeblendet |
| SITL / TCP / UDP | ❌ nicht unterstützt (Stubs vorhanden); Tab ausgeblendet |
| Map Generator (neu in 10.0): Kartenkacheln für ETHOS/EdgeTX-Widgets und INAV-Terrain (`.TER`) | ✅ Export als ZIP über den Android-Speicherdialog (Terrain-ZIP komprimiert: 53 MB `.TER` → ca. 17 MB) **oder** „Sync to SD Card“ direkt in einen per Android-Ordnerdialog gewählten Ordner (z.B. SD-Karte im Handy; Berechtigung bleibt gespeichert); Kachel-Cache im App-Speicher. „Eject“ ausgeblendet |
| Blackbox-Download | ❌ noch nicht angebunden |

**Version 10.0.0-rc1:** Upstream-Stand `10.0.0-rc1` (Release Candidate). Baut und startet;
Test am Gerät mit FC steht noch aus. ⚠️ Ab 10.0 akzeptiert der Configurator **nur noch
Flugcontroller mit INAV 10.x** (Bereich wird aus der App-Version abgeleitet) — für FCs mit
INAV 9.x die App-Version 9.1.1 verwenden.

Getestet mit INAV Configurator 9.1.1 auf Android, FC: TBS_LUCID_H7_WING_MINI (INAV 9.1.0)
und MICOAIR743V2 (INAV 9.0.1). Der per „In Datei speichern" erzeugte Diff wurde
zeichengenau gegen die Windows-Version verglichen — identisch bis auf die
Sensor-Kalibrierwerte, die der FC bei jeder Kalibrierung neu ermittelt.

## Architektur: „Shim statt Fork"

Der INAV Configurator ist eine Electron-App — die gesamte UI ist Web-Technologie. Nur die
schmale Electron-Schicht wird ersetzt. **Keine Datei im Upstream-Repo wird verändert.**

1. **Git-Submodule** `inav-configurator/` — gepinnt auf einen Upstream-Release-Stand.
2. **`shim/electron-api.js`** — Nachbau der Preload-Brücke `window.electronAPI`
   (Original: `inav-configurator/js/main/preload.js`). Serial → natives USB-Plugin,
   Datei-Dialoge → natives FileDialog-Plugin, Settings → localStorage,
   App-Infos → Web-Äquivalente, nicht Unterstütztes → saubere Stubs.
3. **`vite.config.mobile.mjs`** — baut den Upstream-Code eigenständig (das
   Electron-Forge-Setup des Upstreams ist außerhalb von Forge nicht nutzbar).
   Enthält Aliase für Node-/Electron-Module → `shim/`, jQuery-Injektion,
   Asset-Inlining sowie **selbstüberwachende Build-Zeit-Patches**:
   - `upstream-patches`: ein Upstream-Bug (ungeschütztes `callback()` in
     `GUI.tab_switch_cleanup`). Der frühere `appUpdater.js`-Patch ist seit 10.0
     upstream behoben und entfernt.
   - `android-cli`: blendet auf Android sinnlose Bedienelemente aus
     (`.msc`, `.copy`, `.diffall`, Firmware-Flasher- und SITL-Tab, im Map Generator „Eject SD Card“) und ersetzt
     den CLI-Save-Handler durch das Ein-Knopf-Backup; ergänzt nach „Aus Datei
     laden" ein automatisches `save`.

   Findet ein Patch seine Code-Stelle nicht mehr, warnt der Build.
   Build-Target ist `es2022`, weil Upstream ab 10.0 Top-Level-`await` nutzt
   (`js/browser-entry.js`).
4. **`android-src/`** — native Capacitor-Plugins `UsbSerialPlugin.java`
   (USB Host API via [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android))
   und `FileDialogPlugin.java` (Storage Access Framework für Datei-Dialoge),
   dazu `MainActivity.java`. Wichtig: Der WebView-User-Agent bekommt den Zusatz
   `Electron/0.0.0-android`, weil der Upstream die Electron-Version aus dem
   User-Agent parst und sonst crasht.

Datenfluss: `UI (unverändert) → window.electronAPI (Shim) → Capacitor → natives Plugin → USB-OTG / SAF`

Wichtige Vertragsdetails, die der Shim exakt einhält (aus dem Upstream-Code abgeleitet):
- `listSerialDevices()` liefert ein Array **nackter Pfad-Strings ohne Doppelpunkt**
  (Format `usb-<deviceId>`); `port_handler.js` filtert alles mit `:` heraus.
- `serialConnect()` liefert `{error: false, id}` — ohne `id` sendet die App nichts.
- `serialSend()` → `{bytesWritten}` bzw. `{error, msg}`; `serialClose()` feuert
  zusätzlich das `serialClose`-Event (sonst bleibt der Disconnect wirkungslos).
- `writeFile()` löst mit **falsy bei Erfolg** auf; `readFile()` liefert `{error, data}`;
  `showOpenDialog()` liefert `filePaths` als Array. Als „Pfad" wird die
  `content://`-URI aus dem Android-Dialog durchgereicht.

## Bedienung: Backup & Restore

**Sichern:** CLI-Tab → „In Datei speichern". Die App führt automatisch `diff all` aus,
wartet auf die vollständige Ausgabe und öffnet dann den Android-Speicherdialog —
Ordner und Dateiname frei wählbar, Vorschlag `cli_<board>_<datum>.txt`. Die Statuszeile
meldet die geschriebene Größe in Bytes.

**Wiederherstellen:** CLI-Tab → „Aus Datei laden" → Datei wählen (Android startet im
zuletzt benutzten Ordner) → Vorschau bestätigen. Die Befehle gehen an den FC, danach
sendet die App automatisch `save`; die Statuszeile meldet „Settings applied and saved."
Schlägt das fehl, erscheint ein Hinweis, „Einstellungen speichern" manuell zu drücken.

ℹ️ **Cloud-Ordner:** Wird als Ziel ein Sync-Anbieter (z.B. Nextcloud) gewählt, zeigt der
Dateimanager die Datei zunächst mit 0 Bytes — der Anbieter materialisiert sie erst
verzögert, oft erst nach Beenden der Apps. Die Byte-Angabe in der Statuszeile ist die
verlässliche Auskunft darüber, was tatsächlich geschrieben wurde. Wer es sofort greifbar
will, speichert lokal (Downloads/Dokumente) und lädt anschließend hoch.

## Bauen

Voraussetzungen: Node ≥ 20, Android Studio (mit SDK + mitgeliefertem JDK), Git.

```bash
git clone --recursive https://github.com/Bingo2023/inav-configurator-android.git
cd inav-configurator-android
npm install                 # installiert auch Submodule-Deps (postinstall)
npm run sync                # Vite-Build mit Shims + Capacitor-Sync
cd android && ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Windows/Git Bash: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
(am besten in `~/.bashrc`).

Wird das `android/`-Verzeichnis neu erzeugt (`npx cap add android`), müssen die Dateien
aus `android-src/` erneut eingespielt werden — siehe `android-src/manifest-snippet.xml`
und `android-src/gradle-snippet.txt`; beide Plugins werden in `MainActivity.java`
registriert.

## Update auf eine neue Upstream-Version

```bash
./scripts/update-upstream.sh <tag-oder-commit>    # z.B. 9.1.1 oder 19ba259
```

Hinweis: INAV veröffentlicht Releases gelegentlich **ohne Git-Tag** — dann den
Commit-Hash von der GitHub-Release-Seite verwenden.

Das Skript checkt aus, installiert, baut und synct — und druckt eine Prüfliste.
Die drei Stellen, an denen ein Update reiben kann:

1. **Preload-Diff** (macht das Skript automatisch gegen den vorherigen Stand):
   neue/geänderte Brücken-Funktionen → `shim/electron-api.js` nachziehen.
   (Beispiel 9.1.1: `confirmDialog` wurde asynchron, drei Backup-Funktionen kamen dazu.
   Beispiel 10.0: `pathExists` und `ejectDrive` kamen dazu.) Zusätzlich listet das Skript
   alle `electronAPI.*`-Aufrufe im Renderer, die der Shim nicht kennt.
2. **Build-Warnungen lesen**: `[upstream-patches] …` oder `[android-cli] …` mit
   „nicht gefunden" heißt, eine gepatchte Stelle ist umgezogen oder wurde upstream
   gefixt → Patch in `vite.config.mobile.mjs` prüfen, anpassen oder entfernen.
3. **Neue Node-/Electron-Imports** (greppt das Skript): ggf. neuen Alias/Shim ergänzen.

Nach dem Test: Submodule-Pin committen (`git add inav-configurator && git commit …`).

⚠️ Niemals `npm update`/`npm audit fix` **im Submodule-Ordner** ausführen — das
verändert dessen `package.json`/`yarn.lock` und bricht das Prinzip „unveränderte
Quelle". Falls doch passiert: `git -C inav-configurator restore package.json yarn.lock`.

## Bekannte Eigenheiten

- Beim Betreten des CLI-Tabs erscheinen kurz Binärzeichen (`$X…`) in der Konsole:
  noch unterwegs befindliche MSP-Antworten, die als Text dargestellt werden. Rein
  optisch, ohne Auswirkung auf den Diff — „Bildschirm leeren" räumt sie weg.
- Die Oberfläche ist für Desktop-Breiten gebaut; Tablet oder Querformat empfohlen.
- Die APK ist Debug-signiert (nicht aus dem Play Store) — bei der Installation muss
  „Unbekannte Quellen" für den Datei-Manager erlaubt werden.

## Lizenz

GPL-3.0, wie der Upstream.
