// Nachbau der Electron-Preload-Brücke (inav-configurator/js/main/preload.js)
// für die Android-WebView. Wird per vite.config.mobile.mjs als erstes Modul geladen.
//
// Mapping:
//   listSerialDevices / serialConnect / serialSend / onSerialData / ...
//       → natives Capacitor-Plugin "UsbSerial" (Android USB Host API)
//   showSaveDialog / showOpenDialog / writeFile / readFile
//       → natives Capacitor-Plugin "FileDialog" (Storage Access Framework)
//   appGetPath('userData') + writeFile/readFile/rm/pathExists darunter
//       → @capacitor/filesystem (privater App-Speicher; z.B. Map-Generator-Kachel-Cache)
//   showOpenDialog({properties:['openDirectory']}) → Ordnerwahl (SAF-Tree); Pfade
//       "<tree-URI>/a/b.TER" darunter → FileDialog.tree* (Map Generator "Sync to SD")
//   storeGet/Set/Delete → localStorage (synchron, wie das sendSync-Original)
//   appGetLocale/Version/Path → Web-Äquivalente
//   TCP/UDP (SITL), Kindprozesse, Firmware-Backup → nicht unterstützt (saubere Stubs)
//
// PFLEGEHINWEIS bei Upstream-Updates: js/main/preload.js im Submodule diffen —
// neue Brücken-Funktionen hier ergänzen.

import { registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

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

/* ---------- Privater App-Speicher (statt Electron userData) ---------- */
// appGetPath('userData') liefert dieses Präfix; alle Pfade darunter landen per
// @capacitor/filesystem im App-Datenverzeichnis (wird mit der App deinstalliert).
const APPDATA = 'android-appdata:';
const isAppData = (p) => typeof p === 'string' && p.startsWith(APPDATA);
const appDataPath = (p) => p.slice(APPDATA.length).replace(/^\/+/, '');

// Binärdaten werden in Stücken durch die Brücke geschickt (Base64 bläht um 33 %
// auf; ein 200-MB-ZIP am Stück würde die WebView sprengen).
const WRITE_CHUNK = 1024 * 1024;

const MIME_BY_EXT = {
  zip: 'application/zip', txt: 'text/plain', cli: 'text/plain', json: 'application/json',
  csv: 'text/csv', mcm: 'application/octet-stream', ter: 'application/octet-stream',
};
function mimeForSave(options) {
  const ext = String(options.defaultPath || '').split('.').pop().toLowerCase()
    || options.filters?.[0]?.extensions?.[0];
  return MIME_BY_EXT[ext] || MIME_BY_EXT[options.filters?.[0]?.extensions?.[0]] || 'application/octet-stream';
}

/* ---------- Ordnerzugriff (SAF-Tree) ---------- */
// Eine Tree-URI enthält nach "/tree/" nur EIN Segment (Schrägstriche sind als %2F
// kodiert) — alles dahinter ist der relative Pfad, den der Configurator anhängt.
const TREE_RE = /^(content:\/\/[^/]+\/tree\/[^/]+)(?:\/(.*))?$/;
function splitTree(p) {
  if (typeof p !== 'string') return null;
  const m = p.match(TREE_RE);
  if (!m || (m[2] || '').startsWith('document/')) return null; // Dokument-URI, kein Ordnerpfad
  return { tree: m[1], path: (m[2] || '').replace(/^\/+|\/+$/g, '') };
}
// Lesbare Anzeige statt roher URI: "primary:Download/INAV" → "Interner Speicher/Download/INAV"
function displayTree(p) {
  const t = splitTree(p);
  if (!t) return p;
  const id = decodeURIComponent(t.tree.split('/tree/')[1]);
  const [vol, ...rest] = id.split(':');
  const where = vol === 'primary' ? 'Interner Speicher' : `SD-Karte (${vol})`;
  return [where, rest.join(':'), t.path].filter(Boolean).join('/');
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
  appGetPath: (name) => (name === 'userData' ? APPDATA : '/'),
  // MUSS ein gültiger semver-String sein: ab 10.0 leitet js/data_storage.js
  // daraus den akzeptierten Firmware-Bereich ab (Major X → >= X.0.0, < X+1.0.0).
  appGetVersion: () => (typeof __INAV_VERSION__ !== 'undefined' ? __INAV_VERSION__ : '0.0.0'),
  appGetLocale: () => navigator.language || 'en',

  /* --- Datei-Dialoge (→ Android Storage Access Framework) --- */
  // Vertrag lt. tabs/cli.js: { canceled, filePath } bzw. { canceled, filePaths: [] }.
  // Als "Pfad" wird die content://-URI durchgereicht, die writeFile/readFile nutzen.
  showSaveDialog: async (options = {}) => {
    try {
      const res = await FileDialog.showSaveDialog({
        defaultName: options.defaultPath || 'inav-cli.txt',
        mimeType: mimeForSave(options),
      });
      return res.canceled ? { canceled: true, filePath: undefined }
                          : { canceled: false, filePath: res.uri };
    } catch (e) {
      console.error('[electronAPI-Shim] showSaveDialog:', e);
      return { canceled: true, filePath: undefined };
    }
  },
  showOpenDialog: async (options = {}) => {
    try {
      if ((options.properties || []).includes('openDirectory')) {
        try {
          const res = await FileDialog.pickDirectory();
          console.info('[electronAPI-Shim] Ordnerwahl:', JSON.stringify(res));
          if (res.canceled) return { canceled: true, filePaths: [] };
          const st = await FileDialog.treeStat({ tree: res.uri, path: '' });
          console.info('[electronAPI-Shim] Ordner-Prüfung:', JSON.stringify(st));
          if (!st.exists) {
            window.alert('Auf den gewählten Ordner kann nicht zugegriffen werden.\n\n' + res.uri +
              (st.error ? '\n\n' + st.error : ''));
            return { canceled: true, filePaths: [] };
          }
          if (res.persisted === false) {
            window.alert('Hinweis: Android hat für diesen Ordner keine dauerhafte Berechtigung vergeben. ' +
              'Er muss nach einem Neustart der App erneut gewählt werden.');
          }
          return { canceled: false, filePaths: [res.uri] };
        } catch (e) {
          console.error('[electronAPI-Shim] Ordnerwahl:', e);
          window.alert('Ordnerwahl fehlgeschlagen: ' + (e?.message || e));
          return { canceled: true, filePaths: [] };
        }
      }
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
  // Strings (CLI-Diff) werden wie bisher als UTF-8-Text geschrieben, Binärdaten
  // (Uint8Array/ArrayBuffer, z.B. Map-Generator-ZIP) unverändert als Bytes.
  writeFile: async (filename, data) => {
    try {
      const binary = typeof data !== 'string';
      const t = splitTree(filename);
      if (t) {
        // Ordnerpfade (Map Generator → SD): Fehler WERFEN — der Aufrufer zählt
        // Fehlschläge per catch und ignoriert Rückgabewerte.
        const u8 = binary ? toUint8(data) : null;
        if (!binary || u8.length <= WRITE_CHUNK) {
          await FileDialog.treeWrite({ ...t, data: binary ? toBase64(u8) : data, ...(binary ? { encoding: 'base64' } : {}) });
          return null;
        }
        const { uri } = await FileDialog.treeResolve(t);
        const { id } = await FileDialog.openWrite({ uri });
        try {
          for (let off = 0; off < u8.length; off += WRITE_CHUNK) {
            await FileDialog.writeChunk({ id, data: toBase64(u8.subarray(off, off + WRITE_CHUNK)) });
          }
        } finally {
          await FileDialog.closeWrite({ id }).catch(() => {});
        }
        return null;
      }
      if (isAppData(filename)) {
        await Filesystem.writeFile({
          path: appDataPath(filename),
          directory: Directory.Data,
          data: binary ? toBase64(data) : data,
          ...(binary ? {} : { encoding: 'utf8' }),
          recursive: true,
        });
        return null;
      }
      if (!binary) {
        await FileDialog.writeFile({ uri: filename, data: String(data) });
        return null;
      }
      const u8 = toUint8(data);
      if (u8.length <= WRITE_CHUNK) {
        await FileDialog.writeFile({ uri: filename, data: toBase64(u8), encoding: 'base64' });
        return null;
      }
      const { id } = await FileDialog.openWrite({ uri: filename });
      try {
        for (let off = 0; off < u8.length; off += WRITE_CHUNK) {
          await FileDialog.writeChunk({ id, data: toBase64(u8.subarray(off, off + WRITE_CHUNK)) });
        }
      } finally {
        await FileDialog.closeWrite({ id }).catch(() => {});
      }
      return null;
    } catch (e) {
      if (splitTree(filename)) throw e;
      if (!isAppData(filename)) console.error('[electronAPI-Shim] writeFile:', e);
      return String(e?.message || e);
    }
  },
  // encoding === null → Binärdaten als Uint8Array (wie Node-Buffer im Original)
  readFile: async (filename, encoding = 'utf8') => {
    const binary = encoding === null;
    try {
      const t = splitTree(filename);
      if (t) {
        const st = await FileDialog.treeStat(t);
        if (!st.exists || st.isDir) return { error: 'not found: ' + filename, data: null };
        const { data } = await FileDialog.readFile({ uri: st.uri, ...(binary ? { encoding: 'base64' } : {}) });
        return { error: null, data: binary ? fromBase64(data) : data };
      }
      if (isAppData(filename)) {
        const { data } = await Filesystem.readFile({
          path: appDataPath(filename),
          directory: Directory.Data,
          ...(binary ? {} : { encoding: 'utf8' }),
        });
        return { error: null, data: binary ? fromBase64(data) : data };
      }
      const { data } = await FileDialog.readFile({ uri: filename, ...(binary ? { encoding: 'base64' } : {}) });
      return { error: null, data: binary ? fromBase64(data) : data };
    } catch (e) {
      // Cache-Fehltreffer im App-Speicher sind normal → nicht loggen
      if (!isAppData(filename) && !splitTree(filename)) console.error('[electronAPI-Shim] readFile:', e);
      return { error: String(e?.message || e), data: null };
    }
  },
  appendFile: async (f) => { notSupported('appendFile'); throw new Error('appendFile not available on Android: ' + f); },
  rm: async (path) => {
    const t = splitTree(path);
    if (t) { if (t.path) await FileDialog.treeDelete(t).catch(() => {}); return undefined; }
    if (!isAppData(path)) return notSupported('rm', undefined);
    const target = { path: appDataPath(path), directory: Directory.Data };
    try {
      const { type } = await Filesystem.stat(target);
      if (type === 'directory') await Filesystem.rmdir({ ...target, recursive: true });
      else await Filesystem.deleteFile(target);
    } catch { /* existiert nicht → nichts zu tun */ }
    return undefined;
  },
  chmod: async () => undefined,
  // ab 10.0 (Map-Generator). SD-Karten-Direktsync ist auf Android ausgeblendet.
  pathExists: async (path) => {
    const t = splitTree(path);
    if (t) {
      try {
        const st = await FileDialog.treeStat(t);
        if (!st.exists && !t.path) console.warn('[electronAPI-Shim] Ordner nicht erreichbar:', t.tree, JSON.stringify(st));
        return st.exists;
      } catch (e) { console.warn('[electronAPI-Shim] treeStat:', e); return false; }
    }
    if (!isAppData(path)) return false;
    try { await Filesystem.stat({ path: appDataPath(path), directory: Directory.Data }); return true; }
    catch { return false; }
  },
  ejectDrive: async () => notSupported('ejectDrive', 'not supported on Android'),
  // --- Android-Zusätze (nicht im Original-Preload; per Build-Patch genutzt) ---
  // Dateigröße ohne die Datei zu lesen (-1 = existiert nicht). Map Generator prüft
  // damit "schon vorhanden?" — sonst würde jede 30-MB-.TER komplett gelesen.
  fileSize: async (path) => {
    try {
      const t = splitTree(path);
      if (t) { const st = await FileDialog.treeStat(t); return st.exists && !st.isDir ? st.size : -1; }
      if (isAppData(path)) {
        const st = await Filesystem.stat({ path: appDataPath(path), directory: Directory.Data });
        return st.type === 'file' ? st.size : -1;
      }
    } catch { /* existiert nicht */ }
    return -1;
  },
  // Lesbarer Name für Ordner-URIs in der Oberfläche
  displayPath: (p) => displayTree(p),

  /* --- Kindprozesse (SITL-Binary) — auf Android prinzipbedingt unmöglich --- */
  startChildProcess: () => notSupported('startChildProcess', undefined),
  killChildProcess: () => {},
  onChildProcessStdout: (cb) => cb, offChildProcessStdout: () => {},
  onChildProcessStderr: (cb) => cb, offChildProcessStderr: () => {},
  onChildProcessError: (cb) => cb, offChildProcessError: () => {},
};

console.info('[electronAPI-Shim] Brücke initialisiert (Android/Capacitor)');
