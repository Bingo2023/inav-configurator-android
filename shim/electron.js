// Stub für `electron` / `@electron/remote` im WebView.
// Fenster-/Menü-Funktionen sind auf Android bedeutungslos (No-Op);
// Datei-Dialoge werden an window.electronAPI delegiert, damit die Logik
// nur an EINER Stelle lebt (shim/electron-api.js → FileDialog-Plugin).

const noop = () => {};
const asyncNoop = () => Promise.resolve();

export const ipcRenderer = {
  send: noop,
  on: noop,
  once: noop,
  removeListener: noop,
  removeAllListeners: noop,
  invoke: asyncNoop,
  sendSync: () => undefined,
};

export const shell = {
  // Externe Links im System-Browser öffnen — das funktioniert auch im WebView sinnvoll.
  openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve(); },
  openPath: asyncNoop,
};

export const clipboard = {
  writeText: (t) => navigator.clipboard?.writeText(t),
  readText: () => navigator.clipboard?.readText() ?? Promise.resolve(''),
};

export const app = {
  getVersion: () => (typeof __INAV_VERSION__ !== 'undefined' ? __INAV_VERSION__ : '0.0.0'),
  getPath: () => '/',
  getName: () => 'INAV Configurator',
  quit: noop,
};

// Delegiert an die Brücke → Android-Systemdialoge (Storage Access Framework)
export const dialog = {
  showOpenDialog: (...a) => window.electronAPI.showOpenDialog(...a),
  showSaveDialog: (...a) => window.electronAPI.showSaveDialog(...a),
  showMessageBox: ({ message } = {}) => { if (message) alert(message); return Promise.resolve({ response: 0 }); },
};

export const getCurrentWindow = () => ({
  close: noop, minimize: noop, maximize: noop, unmaximize: noop,
  isMaximized: () => false, setTitle: noop, on: noop,
});

export default { ipcRenderer, shell, clipboard, app, dialog, getCurrentWindow };
