// Drop-in-Ersatz für das Node-Paket `serialport` (v10+-API, genutzte Teilmenge).
// Der Upstream-Code des INAV Configurators importiert weiterhin `serialport` —
// der Vite-Alias liefert stattdessen diese Datei, die alles ans native
// Capacitor-Plugin `UsbSerial` (Android USB Host API) weiterreicht.

import { registerPlugin } from '@capacitor/core';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

const UsbSerial = registerPlugin('UsbSerial');

// Es ist immer nur ein FC gleichzeitig verbunden — ein globaler Daten-Listener genügt.
let activePort = null;

UsbSerial.addListener('data', ({ data }) => {
  if (activePort) activePort.emit('data', Buffer.from(data, 'base64'));
});
UsbSerial.addListener('error', ({ message }) => {
  if (activePort) activePort.emit('error', new Error(message || 'USB error'));
});
UsbSerial.addListener('disconnected', () => {
  if (activePort) {
    const p = activePort;
    activePort = null;
    p.isOpen = false;
    p.emit('close');
  }
});

export class SerialPort extends EventEmitter {
  /**
   * @param {{path: string, baudRate: number, autoOpen?: boolean}} options
   * @param {(err: Error|null) => void} [openCallback]
   */
  constructor(options, openCallback) {
    super();
    this.path = options.path;
    this.baudRate = options.baudRate || 115200;
    this.isOpen = false;
    if (options.autoOpen !== false) this.open(openCallback);
  }

  /** Entspricht SerialPort.list() aus Node — Pfade haben die Form "usb:<deviceId>". */
  static async list() {
    const { ports } = await UsbSerial.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || p.name || 'USB Serial',
      vendorId: p.vendorId != null ? p.vendorId.toString(16).padStart(4, '0') : undefined,
      productId: p.productId != null ? p.productId.toString(16).padStart(4, '0') : undefined,
      serialNumber: p.serialNumber || undefined,
      pnpId: undefined,
      locationId: undefined,
    }));
  }

  open(callback) {
    UsbSerial.open({ path: this.path, baudRate: this.baudRate })
      .then(() => {
        this.isOpen = true;
        activePort = this;
        this.emit('open');
        callback?.(null);
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err?.message || err));
        this.emit('error', e);
        callback?.(e);
      });
  }

  write(data, callback) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    UsbSerial.write({ data: buf.toString('base64') })
      .then(() => callback?.(null))
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err?.message || err));
        this.emit('error', e);
        callback?.(e);
      });
    return true;
  }

  close(callback) {
    UsbSerial.close()
      .then(() => {
        this.isOpen = false;
        if (activePort === this) activePort = null;
        this.emit('close');
        callback?.(null);
      })
      .catch((err) => callback?.(err instanceof Error ? err : new Error(String(err))));
  }

  // No-Ops, die Upstream evtl. aufruft:
  flush(cb) { cb?.(null); }
  drain(cb) { cb?.(null); }
  set(_opts, cb) { cb?.(null); } // DTR/RTS: auf VCP-FCs i.d.R. irrelevant
  update({ baudRate } = {}, cb) {
    if (!baudRate) return cb?.(null);
    UsbSerial.setBaudRate({ baudRate }).then(() => cb?.(null)).catch((e) => cb?.(e));
  }
}

export default { SerialPort };
