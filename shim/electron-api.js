// Nachbau der Electron-Preload-Brücke (inav-configurator/js/main/preload.js)
// für die Android-WebView. Wird per vite.config.mobile.mjs als erstes Modul geladen.
//
// Mapping:
//   listSerialDevices / serialConnect / serialSend / onSerialData / ...
//       → natives Capacitor-Plugin "UsbSerial" (Android USB Host API)
//   showSaveDialog / showOpenDialog / writeFile / readFile
//       → natives Capacitor-Plugin "FileDialog" (Storage Access Framework)
//   storeGet/Set/Delete → localStorage (synchron, wie das sendSync-Original)
//   appGetLocale/Version/Path → Web-Äquivalente
//   TCP/UDP (SITL), Kindprozesse, Firmware-Backup → nicht unterstützt (saubere Stubs)
//
// PFLEGEHINWEIS bei Upstream-Updates: js/main/preload.js im Submodule diffen —
// neue Brücken-Funktionen hier ergänzen.

import { registerPlugin } from '@capacitor/core';

const UsbSerial = registerPlugin('UsbSerial');
const FileDialog = registerPlugin('FileDialog');
const STORE_PREFIX = 'inav-store:';

/* ---------- Base64-Helfer (Binärdaten <-> natives Plugin) ---------- */

function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new Error('serialSend: unsupported data type ' + Object.prototype.toString.call(data));
}

function toBase64(data) {
  const u8 = toUint8(data);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ---------- Serial-Events: Plugin → registrierte Handler ---------- */

const serialDataHandlers = new Set();
const serialCloseHandlers = new Set();
const serialErrorHandlers = new Set();

UsbSerial.addListener('data', ({ data }) => {
  const u8 = fromBase64(data);
  serialDataHandlers.forEach((h) => { try { h(u8); } catch (e) { console.error(e); } });
});
UsbSerial.addListener('disconnected', () => {
  serialCloseHandlers.forEach((h) => { try { h(); } catch (e) { console.error(e); } });
});
UsbSerial.addListener('error', ({ message }) => {
  console.error('[UsbSerial]', message);
  serialErrorHandlers.forEach((h) => { try { h(message || 'USB error'); } catch (e) { console.error(e); } });
});

/* ---------- Stubs für nicht unterstützte Bereiche ---------- */

const warned = new Set();
function notSupported(name, returnValue) {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[electronAPI-Shim] ${name}() wird auf Android (noch) nicht unterstützt`);
  }
  return returnValue;
}

/* ---------- WebUSB-Stub: port_handler.check_usb_devices ruft navigator.usb auf ---------- */

if (!('usb' in navigator)) {
  try {
    Object.defineProperty(navigator, 'usb', {
      value: {
        getDevices: async () => [],
        requestDevice: async () => { throw new Error('WebUSB not available on Android WebView'); },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      configurable: true,
    });
  } catch (e) {
    console.warn('[electronAPI-Shim] navigator.usb-Stub fehlgeschlagen:', e);
  }
}

/* ---------- Die Brücke ---------- */

window.electronAPI = {
  /* --- Serial (→ USB-OTG) --- */
  // Der Original-Hauptprozess liefert ein Array nackter Pfad-STRINGS (js/main/serial.js),
  // und port_handler.js filtert alles mit ':' heraus → Format hier: "usb-<deviceId>".
  listSerialDevices: async () => {
    try {
      const { ports } = await UsbSerial.list();
      return ports.map((p) => String(p.path).replace(':', '-'));
    } catch (e) {
      console.error('[electronAPI-Shim] listSerialDevices:', e);
      return [];
    }
  },
  serialConnect: async (path, options = {}) => {
    try {
      // UI-Pfad "usb-<id>" → natives Format "usb:<id>"
      const nativePath = String(path).replace(/^usb-/, 'usb:');
      await UsbSerial.open({ path: nativePath, baudRate: options.baudRate || options.bitrate || 115200 });
      // connectionSerial.js erwartet { error: false, id: <connectionId> } —
      // response.id wird zur _connectionId, ohne die sendet die App NICHTS.
      return { error: false, id: nativePath };
    } catch (e) {
      console.error('[electronAPI-Shim] serialConnect:', e);
      return { error: true, msg: String(e?.message || e) };
    }
  },
  serialClose: async () => {
    try {
      await UsbSerial.close();
    } catch { /* war schon zu */ }
    // Das Original feuert nach dem Schließen ein 'serialClose'-Event, auf das
    // die App mit abort() und GUI-Aufräumen reagiert — ohne dieses Event
    // bleibt der Disconnect-Button wirkungslos.
    serialCloseHandlers.forEach((h) => { try { h(); } catch (e) { console.error(e); } });
    return { error: false };
  },
  serialSend: async (data) => {
    try {
      const u8 = toUint8(data);
      await UsbSerial.write({ data: toBase64(u8) });
      return { bytesWritten: u8.length };
    } catch (e) {
      console.error('[electronAPI-Shim] serialSend:', e);
      return { error: true, msg: String(e?.message || e), bytesWritten: 0 };
    }
  },
  onSerialData: (cb) => { serialDataHandlers.add(cb); return cb; },
  offSerialData: (h) => serialDataHandlers.delete(h),
  onSerialClose: (cb) => { serialCloseHandlers.add(cb); return cb; },
  offSerialClose: (h) => serialCloseHandlers.delete(h),
  onSerialError: (cb) => { serialErrorHandlers.add(cb); return cb; },
  offSerialError: (h) => serialErrorHandlers.delete(h),

  /* --- Settings-Store (synchron, wie das Original) --- */
  storeGet: (key, defaultValue) => {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (raw === null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  storeSet: (key, value) => localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)),
  storeDelete: (key) => localStorage.removeItem(STORE_PREFIX + key),

  /* --- App-Infos --- */
  appGetPath: () => '/',
  // MUSS ein gültiger semver-String sein: ab 10.0 leitet js/data_storage.js
  // daraus den akzeptierten Firmware-Bereich ab (Major X → >= X.0.0, < X+1.0.0).
  appGetVersion: () => (typeof __INAV_VERSION__ !== 'undefined' ? __INAV_VERSION__ : '0.0.0'),
  appGetLocale: () => navigator.language || 'en',

  /* --- Datei-Dialoge (→ Android Storage Access Framework) --- */
  // Vertrag lt. tabs/cli.js: { canceled, filePath } bzw. { canceled, filePaths: [] }.
  // Als "Pfad" wird die content://-URI durchgereicht, die writeFile/readFile nutzen.
  showSaveDialog: async (options = {}) => {
    try {
      const res = await FileDialog.showSaveDialog({ defaultName: options.defaultPath || 'inav-cli.txt' });
      return res.canceled ? { canceled: true, filePath: undefined }
                          : { canceled: false, filePath: res.uri };
    } catch (e) {
      console.error('[electronAPI-Shim] showSaveDialog:', e);
      return { canceled: true, filePath: undefined };
    }
  },
  showOpenDialog: async () => {
    try {
      const res = await FileDialog.showOpenDialog({});
      return res.canceled ? { canceled: true, filePaths: [] }
                          : { canceled: false, filePaths: res.uris };
    } catch (e) {
      console.error('[electronAPI-Shim] showOpenDialog:', e);
      return { canceled: true, filePaths: [] };
    }
  },
  alertDialog: (message) => { window.alert(message); },
  // Seit Upstream 9.1.1 asynchron (invoke statt sendSync) — Aufrufer erwarten ein Promise
  confirmDialog: async (message) => window.confirm(message),

  /* --- Firmware-Backup (seit 9.1.1; Flashen auf Android nicht unterstützt) --- */
  getBackupDir: async () => notSupported('getBackupDir', '/'),
  openBackupDir: async () => notSupported('openBackupDir', undefined),
  listBackups: async () => notSupported('listBackups', []),

  /* --- TCP/UDP (SITL) — nicht unterstützt --- */
  tcpConnect: async () => notSupported('tcpConnect', false),
  tcpClose: () => {},
  tcpSend: async () => notSupported('tcpSend', 0),
  onTcpError: (cb) => cb, offTcpError: () => {},
  onTcpData: (cb) => cb, offTcpData: () => {},
  onTcpEnd: (cb) => cb, offTcpEnd: () => {},
  udpConnect: async () => notSupported('udpConnect', false),
  udpClose: async () => {},
  udpSend: async () => notSupported('udpSend', 0),
  onUdpError: (cb) => cb, offUdpError: () => {},
  onUdpMessage: (cb) => cb, offUdpMessage: () => {},

  /* --- Datei-API (→ FileDialog-Plugin, content://-URIs) --- */
  // Vertrag lt. tabs/cli.js: writeFile löst mit FALSY bei Erfolg auf
  // (`.then(err => { if (err) ... })`); readFile liefert { error, data }.
  writeFile: async (filename, data) => {
    try {
      await FileDialog.writeFile({ uri: filename, data: String(data) });
      return null;
    } catch (e) {
      console.error('[electronAPI-Shim] writeFile:', e);
      return String(e?.message || e);
    }
  },
  readFile: async (filename) => {
    try {
      const { data } = await FileDialog.readFile({ uri: filename });
      return { error: null, data };
    } catch (e) {
      console.error('[electronAPI-Shim] readFile:', e);
      return { error: String(e?.message || e), data: null };
    }
  },
  appendFile: async (f) => { notSupported('appendFile'); throw new Error('appendFile not available on Android: ' + f); },
  rm: async () => notSupported('rm', undefined),
  chmod: async () => undefined,
  // ab 10.0 (Map-Generator, SD-Karte) — auf Android nicht unterstützt
  pathExists: async () => false,
  ejectDrive: async () => notSupported('ejectDrive', 'not supported on Android'),

  /* --- Kindprozesse (SITL-Binary) — auf Android prinzipbedingt unmöglich --- */
  startChildProcess: () => notSupported('startChildProcess', undefined),
  killChildProcess: () => {},
  onChildProcessStdout: (cb) => cb, offChildProcessStdout: () => {},
  onChildProcessStderr: (cb) => cb, offChildProcessStderr: () => {},
  onChildProcessError: (cb) => cb, offChildProcessError: () => {},
};

console.info('[electronAPI-Shim] Brücke initialisiert (Android/Capacitor)');
