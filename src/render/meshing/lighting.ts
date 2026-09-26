// Per-cell light for a chunk, computed in the mesher worker on the LW×LW×H volume (chunk + LPAD margin).
//  * Sky light: every column is scanned from the top of the world. Cells with open sky above get full
//    light; leaves and building-occupancy (STRUCTURE) cells filter it (tree canopies and the space under
//    decks/tanks are shaded, never pitch black) and water attenuates it exponentially with depth. The
//    result is then flooded through open cells with a fixed cost per step (Dijkstra-style relaxation),
//    so light reaches under overhangs and into cave mouths but never passes through opaque walls.
//  * Block light: Minecraft-style BFS flood from emitters (lamps, fire), 1 level per step, blocked by
//    opaque cells inside the known volume.
import { LIGHT_CLASS, LC_OPAQUE, LC_LEAF, LC_STRUCT, LC_WATER } from './blockTables';
import { LPAD, LW, EMIT_RANGE } from './protocol';

/** Internal sky-light resolution: levels 0..SKY_MAX map to 0..255. */
const SKY_MAX = 40;
/** Cost of one step through open space (0.15 of full light per block). */
const STEP = 6;
/** Extra cost when light spreads sideways into building volume (dense equipment). */
const STRUCT_EXTRA = 2;
/** Each leaf block light passes straight down through removes this much. */
const LEAF_COST = 5;
/** Light straight down through building volume is capped at this level and decays to STRUCT_MIN. */
const STRUCT_CAP = 20;
const STRUCT_MIN = 12;
const WATER_ATTEN = 0.075;
const TO_BYTE = new Uint8Array(SKY_MAX + 1);
for (let i = 0; i <= SKY_MAX; i++) TO_BYTE[i] = Math.round((i / SKY_MAX) * 255);

/** Reusable scratch buffers (one set per worker). */
let level = new Uint8Array(0);
let inQueue = new Uint8Array(0);
let queue = new Int32Array(0);

function ensureScratch(n: number) {
  if (level.length >= n) return;
  level = new Uint8Array(n);
  inQueue = new Uint8Array(n);
  queue = new Int32Array(n);
}

/**
 * Sky light (0..255) for every cell of the LW×LW×height volume, index = lx + lz*LW + y*LW*LW.
 * Opaque cells are 0.
 */
export function computeSkyLight(blocks: Uint8Array, height: number): Uint8Array {
  const plane = LW * LW;
  const n = plane * height;
  ensureScratch(n);
  const lv = level;
  lv.fill(0, 0, n);

  // 1) vertical pass from the sky
  for (let lz = 0; lz < LW; lz++)
    for (let lx = 0; lx < LW; lx++) {
      let v = SKY_MAX;
      let water = 0;
      let i = lx + lz * LW + (height - 1) * plane;
      for (let y = height - 1; y >= 0; y--, i -= plane) {
        const cls = LIGHT_CLASS[blocks[i]];
        if (cls === LC_OPAQUE) break;
        if (cls === LC_LEAF) v = v > LEAF_COST ? v - LEAF_COST : 0;
        else if (cls === LC_STRUCT) v = v > STRUCT_CAP ? STRUCT_CAP : v > STRUCT_MIN ? v - 1 : v;
        if (cls === LC_WATER) water++;
        else if (water > 0) water = 0;
        lv[i] = water > 0 ? Math.round(v * Math.exp(-water * WATER_ATTEN)) : v;
      }
    }

  // 2) seed the flood with every lit cell that can still brighten a neighbour
  const q = queue;
  const inq = inQueue;
  inq.fill(0, 0, n);
  let qt = 0;
  for (let y = 0; y < height; y++)
    for (let lz = 0; lz < LW; lz++)
      for (let lx = 0; lx < LW; lx++) {
        const i = lx + lz * LW + y * plane;
        const l = lv[i];
        if (l <= STEP) continue;
        const lim = l - STEP;
        if (
          (lx > 0 && lv[i - 1] < lim && LIGHT_CLASS[blocks[i - 1]] !== LC_OPAQUE) ||
          (lx < LW - 1 && lv[i + 1] < lim && LIGHT_CLASS[blocks[i + 1]] !== LC_OPAQUE) ||
          (lz > 0 && lv[i - LW] < lim && LIGHT_CLASS[blocks[i - LW]] !== LC_OPAQUE) ||
          (lz < LW - 1 && lv[i + LW] < lim && LIGHT_CLASS[blocks[i + LW]] !== LC_OPAQUE) ||
          (y > 0 && lv[i - plane] < lim && LIGHT_CLASS[blocks[i - plane]] !== LC_OPAQUE) ||
          (y < height - 1 && lv[i + plane] < lim && LIGHT_CLASS[blocks[i + plane]] !== LC_OPAQUE)
        ) {
          q[qt++] = i;
          inq[i] = 1;
        }
      }

  // 3) relaxation flood (circular FIFO; a cell is queued at most once at a time)
  let qh = 0;
  let count = qt;
  if (qt === n) qt = 0;
  while (count > 0) {
    const i = q[qh];
    qh = qh + 1 === n ? 0 : qh + 1;
    count--;
    inq[i] = 0;
    const l = lv[i];
    if (l <= STEP) continue;
    const y = (i / plane) | 0;
    const rem = i - y * plane;
    const lz = (rem / LW) | 0;
    const lx = rem - lz * LW;
    for (let d = 0; d < 6; d++) {
      let j: number;
      if (d === 0) {
        if (lx === LW - 1) continue;
        j = i + 1;
      } else if (d === 1) {
        if (lx === 0) continue;
        j = i - 1;
      } else if (d === 2) {
        if (lz === LW - 1) continue;
        j = i + LW;
      } else if (d === 3) {
        if (lz === 0) continue;
        j = i - LW;
      } else if (d === 4) {
        if (y === height - 1) continue;
        j = i + plane;
      } else {
        if (y === 0) continue;
        j = i - plane;
      }
      const cls = LIGHT_CLASS[blocks[j]];
      if (cls === LC_OPAQUE) continue;
      const nl = l - STEP - (cls === LC_STRUCT ? STRUCT_EXTRA : cls === LC_LEAF ? 1 : 0);
      if (nl <= lv[j]) continue;
      lv[j] = nl;
      if (!inq[j]) {
        inq[j] = 1;
        q[qt] = j;
        qt = qt + 1 === n ? 0 : qt + 1;
        count++;
      }
    }
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = TO_BYTE[lv[i]];
  return out;
}

/**
 * Block light 0..255 for the LW×LW×height volume, or null when no emitter is in range. The flood runs on
 * a wider grid (EMIT_RANGE margin) so emitters in neighbouring chunks reach in; outside the shipped
 * LW volume the space is unknown and treated as open.
 */
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
  const lplane = LW * LW;
  const lvl = new Uint8Array(plane * ny);
  const q = new Int32Array(plane * ny);
  let qh = 0;
  let qt = 0;
  const idxOf = (x: number, y: number, z: number) => x + E + (z + E) * EW + (y - y0) * plane;
  // opacity of the extended grid (1 = opaque), derived once from the LW volume
  const opaque = new Uint8Array(plane * ny);
  for (let y = y0; y <= y1; y++)
    for (let lz = 0; lz < LW; lz++)
      for (let lx = 0; lx < LW; lx++) {
        if (LIGHT_CLASS[blocks[lx + lz * LW + y * lplane]] === LC_OPAQUE) opaque[idxOf(lx - LPAD, y, lz - LPAD)] = 1;
      }
  for (let i = 0; i < emitters.length; i += 4) {
    const x = emitters[i];
    const y = emitters[i + 1];
    const z = emitters[i + 2];
    const l = emitters[i + 3];
    if (x < -E || z < -E || x >= 16 + E || z >= 16 + E || y < y0 || y > y1) continue;
    const k = idxOf(x, y, z);
    if (lvl[k] < l) {
      lvl[k] = l;
      q[qt++] = k;
    }
  }
  const DIRS = [1, -1, EW, -EW, plane, -plane];
  while (qh < qt) {
    const k = q[qh++];
    const l = lvl[k];
    if (l <= 1) continue;
    const ly = (k / plane) | 0;
    const rem = k - ly * plane;
    const lz = (rem / EW) | 0;
    const lx = rem - lz * EW;
    for (let d = 0; d < 6; d++) {
      if (d === 0 ? lx === EW - 1 : d === 1 ? lx === 0 : d === 2 ? lz === EW - 1 : d === 3 ? lz === 0 : d === 4 ? ly === ny - 1 : ly === 0) continue;
      const nk = k + DIRS[d];
      if (lvl[nk] >= l - 1 || opaque[nk] || qt >= q.length) continue;
      lvl[nk] = l - 1;
      q[qt++] = nk;
    }
  }
  const out = new Uint8Array(lplane * height);
  let any = false;
  for (let y = y0; y <= y1; y++)
    for (let lz = 0; lz < LW; lz++)
      for (let lx = 0; lx < LW; lx++) {
        const l = lvl[idxOf(lx - LPAD, y, lz - LPAD)];
        if (l) {
          out[lx + lz * LW + y * lplane] = Math.round((l / 15) * 255);
          any = true;
        }
      }
  return any ? out : null;
}
