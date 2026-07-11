// Stub für `electron` / `@electron/remote` im WebView.
// Ziel: Der Upstream-Code läuft, ohne zu crashen. Fenster-/Menü-Funktionen sind auf
// Android bedeutungslos (No-Op); Datei-Dialoge werden auf Capacitor abgebildet, sobald
// benötigt (Blackbox-Export etc.) — siehe TODO unten.

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
  getVersion: () => '0.0.0-android',
  getPath: () => '/',
  getName: () => 'INAV Configurator',
  quit: noop,
};

// TODO: Für Blackbox-/Diff-Export auf @capacitor/filesystem + Share-Sheet mappen.
export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: ({ message } = {}) => { if (message) alert(message); return Promise.resolve({ response: 0 }); },
};

export const getCurrentWindow = () => ({
  close: noop, minimize: noop, maximize: noop, unmaximize: noop,
  isMaximized: () => false, setTitle: noop, on: noop,
});

export default { ipcRenderer, shell, clipboard, app, dialog, getCurrentWindow };
