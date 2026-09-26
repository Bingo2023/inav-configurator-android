# INAV Configurator for Android

Android version of the [INAV Configurator](https://github.com/iNavFlight/inav-configurator):
a Capacitor WebView app that embeds the original source code **unmodified, as a Git
submodule**. Connects to the flight controller via **USB OTG** (MSP over VCP/CP210x/FTDI/CH340).

*Deutsche Fassung: [README.md](README.md).*

## Status

| Feature | Status |
|---|---|
| Connect via USB OTG, all configuration tabs, disconnect | ✅ working |
| Mission Control (map requires internet) | ✅ working |
| Settings backup: "Save to file" (runs `diff all` automatically) | ✅ working |
| Settings restore: "Load from file" (saves automatically after transfer) | ✅ working |
| Firmware flashing (DFU) | ❌ unsupported (separate USB protocol) → flash on a PC; tab hidden |
| SITL / TCP / UDP | ❌ unsupported (stubs in place); tab hidden |
| Map Generator (new in 10.0, writes tiles to filesystem/SD card) | ❌ unsupported; tab hidden |
| Blackbox download | ❌ not wired up yet |

**Version 10.0.0-rc1:** upstream `10.0.0-rc1` (release candidate). Builds and starts;
on-device testing with an FC is still pending. ⚠️ From 10.0 on, the configurator **only
accepts flight controllers running INAV 10.x** (the range is derived from the app version) —
use app version 9.1.1 for FCs on INAV 9.x.

Tested with INAV Configurator 9.1.1 on Android, FC: TBS_LUCID_H7_WING_MINI (INAV 9.1.0)
and MICOAIR743V2 (INAV 9.0.1). The diff produced by "Save to file" was compared
character by character against the Windows version — identical except for the sensor
calibration values, which the FC re-measures on every calibration.

## Architecture: "shim, don't fork"

The INAV Configurator is an Electron app — the entire UI is web technology. Only the
thin Electron layer is replaced. **No file in the upstream repo is modified.**

1. **Git submodule** `inav-configurator/` — pinned to an upstream release state.
2. **`shim/electron-api.js`** — re-implementation of the preload bridge
   `window.electronAPI` (original: `inav-configurator/js/main/preload.js`).
   Serial → native USB plugin, file dialogs → native FileDialog plugin,
   settings → localStorage, app info → web equivalents, unsupported areas → clean stubs.
3. **`vite.config.mobile.mjs`** — builds the upstream code standalone (the upstream's
   Electron Forge setup cannot be used outside Forge). Contains aliases mapping
   Node/Electron modules → `shim/`, jQuery injection, asset inlining, plus
   **self-monitoring build-time patches**:
   - `upstream-patches`: one upstream bug (unguarded `callback()` in
     `GUI.tab_switch_cleanup`). The former `appUpdater.js` patch was fixed
     upstream in 10.0 and has been removed.
   - `android-cli`: hides controls that make no sense on Android (`.msc`, `.copy`,
     `.diffall`, the firmware flasher, SITL and map generator tabs), replaces the CLI save handler
     with the one-tap backup, and adds an automatic `save` after "Load from file".

   If a patch no longer finds its code location, the build prints a warning.
   The build target is `es2022` because upstream uses top-level `await` from 10.0 on
   (`js/browser-entry.js`).
4. **`android-src/`** — native Capacitor plugins `UsbSerialPlugin.java`
   (USB Host API via [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android))
   and `FileDialogPlugin.java` (Storage Access Framework for file dialogs),
   plus `MainActivity.java`. Important: the WebView user agent gets the suffix
   `Electron/0.0.0-android`, because upstream parses the Electron version from
   the user agent and crashes otherwise.

Data flow: `UI (unmodified) → window.electronAPI (shim) → Capacitor → native plugin → USB OTG / SAF`

Contract details the shim follows precisely (derived from the upstream code):
- `listSerialDevices()` returns an array of **bare path strings without a colon**
  (format `usb-<deviceId>`); `port_handler.js` filters out anything containing `:`.
- `serialConnect()` returns `{error: false, id}` — without an `id`, the app never sends.
- `serialSend()` → `{bytesWritten}` or `{error, msg}`; `serialClose()` additionally
  fires the `serialClose` event (otherwise the disconnect button has no effect).
- `writeFile()` resolves **falsy on success**; `readFile()` returns `{error, data}`;
  `showOpenDialog()` returns `filePaths` as an array. The `content://` URI from the
  Android dialog is passed through as the "path".

## Usage: backup & restore

**Backup:** CLI tab → "Save to file". The app runs `diff all` automatically, waits for
the complete output, then opens the Android save dialog — folder and filename freely
selectable, suggested name `cli_<board>_<date>.txt`. The status bar reports the number
of bytes written.

**Restore:** CLI tab → "Load from file" → pick a file (Android starts in the folder you
used last) → confirm the preview. The commands are sent to the FC, then the app sends
`save` automatically and the status bar reports "Settings applied and saved." If that
fails, a message asks you to press "Save settings" manually.

ℹ️ **Cloud folders:** If you pick a sync provider (e.g. Nextcloud) as the target, the
file manager may show the file as 0 bytes at first — the provider materialises it later,
often only after the apps are closed. The byte count in the status bar is the reliable
statement of what was actually written. For immediate access, save locally
(Downloads/Documents) and upload afterwards.

## Building

Prerequisites: Node ≥ 20, Android Studio (with SDK + bundled JDK), Git.

```bash
git clone --recursive https://github.com/Bingo2023/inav-configurator-android.git
cd inav-configurator-android
npm install                 # also installs submodule deps (postinstall)
npm run sync                # Vite build with shims + Capacitor sync
cd android && ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Windows/Git Bash: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
(best placed in `~/.bashrc`).

If the `android/` directory is regenerated (`npx cap add android`), the files from
`android-src/` must be applied again — see `android-src/manifest-snippet.xml` and
`android-src/gradle-snippet.txt`; both plugins are registered in `MainActivity.java`.

## Updating to a new upstream version

```bash
./scripts/update-upstream.sh <tag-or-commit>    # e.g. 9.1.1 or 19ba259
```

Note: INAV occasionally publishes releases **without a Git tag** — in that case, use the
commit hash from the GitHub release page.

The script checks out, installs, builds and syncs — and prints a checklist.
The three places where an update can cause friction:

1. **Preload diff** (the script does this automatically against the previous state):
   new/changed bridge functions → update `shim/electron-api.js`.
   (Example from 9.1.1: `confirmDialog` became asynchronous, three backup functions
   were added. Example from 10.0: `pathExists` and `ejectDrive` were added.) The script
   also lists every `electronAPI.*` call in the renderer that the shim does not know.
2. **Read the build warnings**: `[upstream-patches] …` or `[android-cli] …` saying
   "not found" means a patched location moved or was fixed upstream → check, adapt or
   remove the patch in `vite.config.mobile.mjs`.
3. **New Node/Electron imports** (the script greps for these): add a new alias/shim
   if needed.

After testing: commit the submodule pin (`git add inav-configurator && git commit …`).

⚠️ Never run `npm update`/`npm audit fix` **inside the submodule folder** — it modifies
its `package.json`/`yarn.lock` and breaks the "unmodified source" principle. If it
happens anyway: `git -C inav-configurator restore package.json yarn.lock`.

## Known quirks

- Entering the CLI tab briefly shows binary characters (`$X…`) in the console: MSP
  replies still in flight being rendered as text. Purely cosmetic, no effect on the
  diff — "Clear screen" removes them.
- The UI is built for desktop widths; a tablet or landscape orientation is recommended.
- The APK is debug-signed (not from the Play Store) — installing requires allowing
  "unknown sources" for your file manager.

## License

GPL-3.0, same as upstream.
