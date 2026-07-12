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
| Firmware flashing (DFU) | ❌ intentionally unsupported (separate USB protocol) → flash on a PC |
| SITL / TCP / UDP | ❌ unsupported (stubs in place, can be added) |
| File export (blackbox download, saving CLI diffs) | ❌ not wired up yet (→ @capacitor/filesystem) |

Tested with INAV Configurator 9.0.2 (commit `19ba259`) on Android, FC: MICOAIR743V2 (INAV 9.0.1).

## Architecture: "shim, don't fork"

The INAV Configurator is an Electron app — the entire UI is web technology. Only the
thin Electron layer is replaced. **No file in the upstream repo is modified.**

1. **Git submodule** `inav-configurator/` — pinned to an upstream release state.
2. **`shim/electron-api.js`** — re-implementation of the preload bridge
   `window.electronAPI` (original: `inav-configurator/js/main/preload.js`).
   Serial calls go to the native Capacitor plugin, settings to localStorage,
   app info to web equivalents. Currently still contains a debug overlay
   (red error box) that should be removed before a release.
3. **`vite.config.mobile.mjs`** — builds the upstream code standalone (the
   upstream's Electron Forge setup cannot be used outside Forge). Contains:
   aliases mapping Node/Electron modules → `shim/`, jQuery injection, asset
   inlining, and **self-monitoring build-time patches** for two upstream bugs
   (unguarded `callback()` in `GUI.tab_switch_cleanup`; `.then()` on the
   synchronous `appGetVersion()` in `appUpdater.js`). If a patch no longer
   finds its code location, the build prints a warning.
4. **`android-src/`** — native Capacitor plugin `UsbSerialPlugin.java`
   (USB Host API via [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android))
   and `MainActivity.java`. Important: the WebView user agent gets the suffix
   `Electron/0.0.0-android`, because upstream parses the Electron version from
   the user agent and crashes otherwise.

Data flow: `UI (unmodified) → window.electronAPI (shim) → Capacitor → UsbSerialPlugin → USB OTG → FC`

Contract details the shim follows precisely (derived from the upstream code):
- `listSerialDevices()` returns an array of **bare path strings without a colon**
  (format `usb-<deviceId>`); `port_handler.js` filters out anything containing `:`.
- `serialConnect()` returns `{error: false, id}` — without an `id`, the app never sends.
- `serialSend()` → `{bytesWritten}` or `{error, msg}`; `serialClose()` additionally
  fires the `serialClose` event (otherwise the disconnect button has no effect).

## Building

Prerequisites: Node ≥ 20, Android Studio (with SDK + bundled JDK), Git.

```bash
git clone --recursive https://github.com/<user>/inav-configurator-android.git
cd inav-configurator-android
npm install                 # also installs submodule deps (postinstall)
npm run build:mobile        # Vite build of the upstream code with shims → dist-mobile/
npx cap add android         # first time only
# then apply the android-src/ files (see android-src/manifest-snippet.xml and
# android-src/gradle-snippet.txt) — not needed if android/ is already set up
npm run sync
cd android && ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Windows/Git Bash: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
(best placed in `~/.bashrc`).

## Updating to a new upstream version

```bash
./scripts/update-upstream.sh <tag-or-commit>    # e.g. 9.1.0 or 19ba259
```

Note: INAV occasionally publishes releases **without a Git tag** — in that case,
use the commit hash from the GitHub release page.

The script checks out, installs, builds and syncs — and prints a checklist.
The three places where an update can cause friction:

1. **Diff `js/main/preload.js`** (the script does this automatically against the
   previous state): new/changed bridge functions → update `shim/electron-api.js`.
2. **Read the build warnings**: `[upstream-patches] pattern not found` means a
   patched upstream bug was fixed or the code moved → remove or adapt the patch
   in `vite.config.mobile.mjs`.
3. **New Node/Electron imports** (the script greps for these): add a new
   alias/shim if needed.

After testing: commit the submodule pin (`git add inav-configurator && git commit …`).

⚠️ Never run `npm update`/`npm audit fix` **inside the submodule folder** — it
modifies its `package.json`/`yarn.lock` and breaks the "unmodified source"
principle. If it happens anyway: `git -C inav-configurator restore package.json yarn.lock`.

## License

GPL-3.0, same as upstream.
