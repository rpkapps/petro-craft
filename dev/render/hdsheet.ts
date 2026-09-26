// @ts-nocheck -- Node-only dev script (the project has no Node typings).
// HD material contact sheet (no browser): paints layers and writes a PNG with, per layer, the albedo and a
// relit preview (albedo × N·L from the packed normal map, light from the upper left) side by side.
//   node --experimental-strip-types --no-warnings --import ./dev/world/register.mjs dev/render/hdsheet.ts [size=256] [keys,...|all] [out]
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { LAYERS } from '../../src/render/textures/layers';
import { paintHDLayer } from '../../src/render/textures/hd/painters';
import { hashString } from '../../src/render/util/noise';

declare const process: { argv: string[] };
const size = Number(process.argv[2] ?? 256);
const sel = process.argv[3] ?? 'all';
const out = process.argv[4] ?? `dev-screens/hd-sheet-${size}.png`;
const layers = LAYERS.filter((l) => sel === 'all' || sel.split(',').includes(l.key));
const cols = Math.min(6, layers.length);
const tile = size;
const W = cols * tile * 2;
const rowsN = Math.ceil(layers.length / cols);
const H = rowsN * tile;
const img = new Uint8Array(W * H * 3);
let total = 0;
const times: [string, number][] = [];
layers.forEach((l, k) => {
  const t0 = performance.now();
  const p = paintHDLayer(l.key, l.source?.palette ?? [], size, hashString(l.key) % 100000);
  const dt = performance.now() - t0;
  total += dt;
  times.push([l.key, dt]);
  const ox = (k % cols) * tile * 2;
  const oy = Math.floor(k / cols) * tile;
  const L = [-0.5, -0.5, 0.7];
  const ll = Math.hypot(L[0], L[1], L[2]);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = p.albedo[i + 3] / 255;
      const bg = ((x >> 4) + (y >> 4)) % 2 ? 90 : 60;
      const nx = p.material[i] / 127.5 - 1;
      const ny = p.material[i + 1] / 127.5 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const ndl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
      const lit = 0.35 + ndl * 0.9;
      for (let c = 0; c < 3; c++) {
        const al = p.albedo[i + c];
        const o1 = ((oy + y) * W + ox + x) * 3 + c;
        const o2 = ((oy + y) * W + ox + tile + x) * 3 + c;
        img[o1] = Math.round(al * a + bg * (1 - a));
        img[o2] = Math.min(255, Math.round(al * lit * a + bg * (1 - a)));
      }
    }
});
function png(w: number, h: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b: Buffer) => {
    let c = -1;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('dev-screens', { recursive: true });
writeFileSync(out, png(W, H, img));
times.sort((a, b) => b[1] - a[1]);
console.log(`${layers.length} layers @${size}: ${total.toFixed(0)} ms total; slowest: ${times.slice(0, 6).map(([k, t]) => `${k} ${t.toFixed(0)}`).join(', ')}`);
console.log('wrote', out);
