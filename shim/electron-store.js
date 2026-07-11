// Ersatz für `electron-store` (Einstellungen des Configurators).
// Bildet die genutzte API auf window.localStorage ab — Einstellungen
// überleben so App-Neustarts auf dem Android-Gerät.

const PREFIX = 'inav-store:';

export default class Store {
  constructor(options = {}) {
    this.defaults = options.defaults || {};
  }

  get(key, defaultValue) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) {
      return defaultValue !== undefined ? defaultValue : this.defaults[key];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  set(key, value) {
    if (typeof key === 'object') {
      for (const [k, v] of Object.entries(key)) this.set(k, v);
      return;
    }
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }

  has(key) {
    return localStorage.getItem(PREFIX + key) !== null;
  }

  delete(key) {
    localStorage.removeItem(PREFIX + key);
  }

  clear() {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  }

  get store() {
    const out = { ...this.defaults };
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = this.get(k.slice(PREFIX.length));
    }
    return out;
  }

  onDidChange() { /* no-op */ }
  openInEditor() { /* no-op */ }
}
