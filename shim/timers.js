// Mini-Shim für node:timers (von xml2js importiert) — im Browser sind das
// schlicht die window-Timer.
export const setTimeout = globalThis.setTimeout.bind(globalThis);
export const clearTimeout = globalThis.clearTimeout.bind(globalThis);
export const setInterval = globalThis.setInterval.bind(globalThis);
export const clearInterval = globalThis.clearInterval.bind(globalThis);
export const setImmediate = (fn, ...args) => globalThis.setTimeout(fn, 0, ...args);
export const clearImmediate = (id) => globalThis.clearTimeout(id);
export default { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate };
