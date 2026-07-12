// Mini-Shim für node:stream — sax (XML-Parser von xml2js, genutzt u.a. von
// Mission Control) leitet seine Streams von Stream ab (Stream.prototype).
// Eine EventEmitter-Basisklasse genügt dafür vollständig.
import { EventEmitter } from 'events';

export class Stream extends EventEmitter {
  pipe(dest) { return dest; }
}
export class Readable extends Stream {}
export class Writable extends Stream {}
export class Duplex extends Stream {}
export class Transform extends Duplex {}
export class PassThrough extends Transform {}

export default { Stream, Readable, Writable, Duplex, Transform, PassThrough };
