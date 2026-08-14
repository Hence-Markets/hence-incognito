/* =========================================================
   Minimal MessagePack decoder — just enough to read the
   binary payloads Hydromancer returns (l2Book, etc.).
   Covers: nil/bool, fix/u/i ints, float32/64, fix/str8/16,
   fix/array16/32, fix/map16. No ext/bin types (unused here).
   ========================================================= */
export function decode(buf) {
  if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const td = new TextDecoder();
  let p = 0;
  function str(n) { const s = td.decode(buf.subarray(p, p + n)); p += n; return s; }
  function arr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = rd(); return a; }
  function map(n) { const o = {}; for (let i = 0; i < n; i++) { const k = rd(); o[k] = rd(); } return o; }
  function rd() {
    const b = buf[p++];
    if (b < 0x80) return b;                 // positive fixint
    if (b >= 0xe0) return b - 256;          // negative fixint
    if (b <= 0x8f) return map(b & 0x0f);    // fixmap
    if (b <= 0x9f) return arr(b & 0x0f);    // fixarray
    if (b <= 0xbf) return str(b & 0x1f);    // fixstr
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return buf[p++];
      case 0xcd: { const v = dv.getUint16(p); p += 2; return v; }
      case 0xce: { const v = dv.getUint32(p); p += 4; return v; }
      case 0xcf: { const v = Number(dv.getBigUint64(p)); p += 8; return v; }
      case 0xd0: return dv.getInt8(p++);
      case 0xd1: { const v = dv.getInt16(p); p += 2; return v; }
      case 0xd2: { const v = dv.getInt32(p); p += 4; return v; }
      case 0xd3: { const v = Number(dv.getBigInt64(p)); p += 8; return v; }
      case 0xca: { const v = dv.getFloat32(p); p += 4; return v; }
      case 0xcb: { const v = dv.getFloat64(p); p += 8; return v; }
      case 0xd9: { const n = buf[p++]; return str(n); }
      case 0xda: { const n = dv.getUint16(p); p += 2; return str(n); }
      case 0xdb: { const n = dv.getUint32(p); p += 4; return str(n); }
      case 0xdc: { const n = dv.getUint16(p); p += 2; return arr(n); }
      case 0xdd: { const n = dv.getUint32(p); p += 4; return arr(n); }
      case 0xde: { const n = dv.getUint16(p); p += 2; return map(n); }
      case 0xdf: { const n = dv.getUint32(p); p += 4; return map(n); }
      default: throw new Error('msgpack: unsupported byte 0x' + b.toString(16));
    }
  }
  return rd();
}
