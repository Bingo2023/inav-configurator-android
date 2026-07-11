// Stub für node:fs — im WebView gibt es kein direktes Dateisystem.
// Aufrufe loggen eine Warnung statt zu crashen; wo Upstream fs wirklich braucht
// (Blackbox-Logs, CLI-Diff speichern), auf @capacitor/filesystem umstellen.
const warn = (fn) => (...args) => {
  console.warn(`[shim/fs] ${fn}() im WebView nicht verfügbar`, args[0]);
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(new Error('fs not available on Android'));
};
export const readFile = warn('readFile');
export const writeFile = warn('writeFile');
export const readFileSync = (p) => { console.warn('[shim/fs] readFileSync', p); return ''; };
export const writeFileSync = (p) => console.warn('[shim/fs] writeFileSync', p);
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const promises = {
  readFile: async (p) => { throw new Error(`fs not available on Android: ${p}`); },
  writeFile: async (p) => { throw new Error(`fs not available on Android: ${p}`); },
};
export default { readFile, writeFile, readFileSync, writeFileSync, existsSync, mkdirSync, promises };
