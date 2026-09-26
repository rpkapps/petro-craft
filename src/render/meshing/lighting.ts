// Per-cell light for the padded chunk volume, computed in the mesher worker.
//  * Sky light: column heightmap with a soft lateral falloff (overhangs, cave mouths and canopies get a
//    smooth penumbra instead of hard steps) and exponential attenuation under water.
//  * Block light: Minecraft-style BFS flood from emitters (lamps, fire), 1 level per step.
import { B } from '../../core/blocks';
import { OPAQUE } from './blockTables';
import { PAD, PW, HM, HW, EMIT_RANGE } from './protocol';

const R = HM - 1; // lateral search radius
const DISK: { dx: number; dz: number; d: number }[] = [];
for (let dz = -R; dz <= R; dz++)
  for (let dx = -R; dx <= R; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= R + 0.25 && (dx || dz)) DISK.push({ dx, dz, d });
  }
DISK.sort((a, b) => a.d - b.d);

const LATERAL_FALLOFF = 0.15;
const DEPTH_FALLOFF = 0.28;
const WATER_ATTEN = 0.075;

export function computeSkyLight(blocks: Uint8Array, heights: Uint8Array, height: number): Uint8Array {
  const plane = PW * PW;
  const sky = new Uint8Array(plane * height);
  for (let pz = 0; pz < PW; pz++)
    for (let px = 0; px < PW; px++) {
      const hx = px - PAD + HM;
      const hz = pz - PAD + HM;
      const h0 = heights[hx + hz * HW];
      let waterAbove = 0;
      for (let y = height - 1; y >= 0; y--) {
        const i = px + pz * PW + y * plane;
        const id = blocks[i];
        if (id === B.WATER) waterAbove++;
        else if (waterAbove > 0 && id !== B.KELP && id !== B.SEAGRASS) waterAbove = 0;
        if (OPAQUE[id]) continue;
        let v: number;
        if (y >= h0) v = 1;
        else {
          v = 0;
          for (let k = 0; k < DISK.length; k++) {
            const s = DISK[k];
            const base = 1 - s.d * LATERAL_FALLOFF;
            if (base <= v) break; // DISK is sorted by distance: nothing further can beat v
            const hn = heights[hx + s.dx + (hz + s.dz) * HW];
            const under = hn > y ? hn - y : 0;
            const c = base - under * DEPTH_FALLOFF;
            if (c > v) v = c;
          }
          // Directly under cover: a little depth falloff from the own column too.
          const own = 1 - (h0 - y) * DEPTH_FALLOFF * 1.2;
          if (own > v) v = own;
        }
        if (waterAbove > 0) v *= Math.exp(-waterAbove * WATER_ATTEN);
        sky[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  return sky;
}

/** Returns per-cell block light 0..255 for the padded volume, or null when no emitter is in range. */
export function computeBlockLight(blocks: Uint8Array, emitters: Int16Array, height: number): Uint8Array | null {
  if (emitters.length === 0) return null;
  const E = EMIT_RANGE;
  const EW = 16 + E * 2; // extended grid, chunk-local x in [-E, 16+E)
  let minY = height;
  let maxY = 0;
  for (let i = 0; i < emitters.length; i += 4) {
    minY = Math.min(minY, emitters[i + 1]);
    maxY = Math.max(maxY, emitters[i + 1]);
  }
  const y0 = Math.max(0, minY - E);
  const y1 = Math.min(height - 1, maxY + E);
  const ny = y1 - y0 + 1;
  const plane = EW * EW;
  const level = new Uint8Array(plane * ny);
  const queue = new Int32Array(plane * ny);
  let qh = 0;
  let qt = 0;
  const idxOf = (x: number, y: number, z: number) => x + E + (z + E) * EW + (y - y0) * plane;
  const opaqueAt = (x: number, y: number, z: number) => {
    const px = x + PAD;
    const pz = z + PAD;
    if (px < 0 || pz < 0 || px >= PW || pz >= PW) return false; // unknown → treat as open
    return OPAQUE[blocks[px + pz * PW + y * PW * PW]] === 1;
  };
  for (let i = 0; i < emitters.length; i += 4) {
    const x = emitters[i];
    const y = emitters[i + 1];
    const z = emitters[i + 2];
    const l = emitters[i + 3];
    if (x < -E || z < -E || x >= 16 + E || z >= 16 + E || y < y0 || y > y1) continue;
    const k = idxOf(x, y, z);
    if (level[k] < l) {
      level[k] = l;
      queue[qt++] = k;
    }
  }
  const DIRS = [1, -1, EW, -EW, plane, -plane];
  while (qh < qt) {
    const k = queue[qh++];
    const l = level[k];
    if (l <= 1) continue;
    const ly = Math.floor(k / plane);
    const rem = k - ly * plane;
    const lz = Math.floor(rem / EW);
    const lx = rem - lz * EW;
    for (let d = 0; d < 6; d++) {
      let nx = lx;
      let ny2 = ly;
      let nz = lz;
      if (d === 0) nx++;
      else if (d === 1) nx--;
      else if (d === 2) nz++;
      else if (d === 3) nz--;
      else if (d === 4) ny2++;
      else ny2--;
      if (nx < 0 || nz < 0 || nx >= EW || nz >= EW || ny2 < 0 || ny2 >= ny) continue;
      const nk = k + DIRS[d];
      if (level[nk] >= l - 1) continue;
      if (opaqueAt(nx - E, ny2 + y0, nz - E)) continue;
      level[nk] = l - 1;
      queue[qt++] = nk;
    }
  }
  const out = new Uint8Array(PW * PW * height);
  for (let y = y0; y <= y1; y++)
    for (let pz = 0; pz < PW; pz++)
      for (let px = 0; px < PW; px++) {
        const l = level[idxOf(px - PAD, y, pz - PAD)];
        if (l) out[px + pz * PW + y * PW * PW] = Math.round((l / 15) * 255);
      }
  return out;
}
