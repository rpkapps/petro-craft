// Compact encoding of per-chunk block edits: little-endian records of (index:uint32, id:uint8),
// deflate-compressed with fflate and stored as base64 text.
import { deflateSync, inflateSync } from 'fflate';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  let i = 0;
  const n = bytes.length;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8);
    chunk += B64[v >> 18] + B64[(v >> 12) & 63] + (i + 1 < n ? B64[(v >> 6) & 63] : '=') + '=';
  }
  parts.push(chunk);
  return parts.join('');
}

export function fromBase64(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && (s[len - 1] === '=' || s[len - 1] === '\n' || s[len - 1] === ' ')) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_INV[s.charCodeAt(i) & 255];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Encode a chunk's edit map (local index → block id). */
export function encodeEdits(map: Map<number, number>): string {
  const buf = new Uint8Array(map.size * 5);
  let p = 0;
  for (const [idx, id] of map) {
    buf[p] = idx & 255;
    buf[p + 1] = (idx >>> 8) & 255;
    buf[p + 2] = (idx >>> 16) & 255;
    buf[p + 3] = (idx >>> 24) & 255;
    buf[p + 4] = id;
    p += 5;
  }
  return toBase64(deflateSync(buf, { level: 6 }));
}

/** Decode into `into` (later entries override earlier ones). Malformed input yields no entries. */
export function decodeEdits(s: string, into: Map<number, number>, maxIndex: number): void {
  let raw: Uint8Array;
  try {
    raw = inflateSync(fromBase64(s));
  } catch {
    return;
  }
  const n = Math.floor(raw.length / 5);
  for (let k = 0; k < n; k++) {
    const p = k * 5;
    const idx = (raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16) | (raw[p + 3] << 24)) >>> 0;
    if (idx < maxIndex) into.set(idx, raw[p + 4]);
  }
}
