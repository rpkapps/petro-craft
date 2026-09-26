// Procedural, tileable PBR detail textures for entity surfaces (no asset files). Pure functions — run
// in a worker (texgen.worker.ts) or time-sliced on the main thread.
//
// Every surface class is one layer of two texture arrays:
//   detail (RGBA8): R albedo multiplier (×2, 128 = 1), G wear mask (paint worn/chipped to bare steel),
//                   B grime mask (rust / dirt streaks), A roughness multiplier (×2, 128 = 1)
//   normal (RG8):   tangent-space normal xy (z reconstructed), derived from a height field.
// Base colours stay the models' vertex colours; the layers add the material's micro structure.

/** Surface classes (layer indices). Keep in sync with SURFACE_PARAMS and the Builder inference. */
export const SURF = {
  PAINT: 0,
  STEEL: 1,
  CONCRETE: 2,
  GLASS: 3,
  CLAD: 4,
  GALV: 5,
  TANK: 6,
  HAZARD: 7,
  HULL: 8,
  INSULATION: 9,
  RUBBER: 10,
  WOOD: 11,
  GRAVEL: 12,
  AUTO: 13,
} as const;
export type SurfClass = (typeof SURF)[keyof typeof SURF];
export const SURF_LAYERS = 14;

/**
 * Per-layer shading parameters: tile size in blocks, albedo-detail, wear, grime and normal strengths,
 * and the wear/grime tint kinds (0 bare steel / 1 dark primer; 0 rust / 1 dirt).
 */
export const SURFACE_PARAMS: { tile: number; detail: number; wear: number; grime: number; normal: number; wearTint: number; grimeTint: number }[] = [
  { tile: 2, detail: 1, wear: 0.7, grime: 0.6, normal: 0.5, wearTint: 0, grimeTint: 0 }, // PAINT
  { tile: 2, detail: 1, wear: 0, grime: 0.45, normal: 0.3, wearTint: 0, grimeTint: 1 }, // STEEL
  { tile: 3, detail: 1, wear: 0, grime: 0.55, normal: 0.9, wearTint: 0, grimeTint: 1 }, // CONCRETE
  { tile: 2, detail: 0.4, wear: 0, grime: 0.25, normal: 0.1, wearTint: 0, grimeTint: 1 }, // GLASS
  { tile: 2, detail: 1, wear: 0.6, grime: 0.6, normal: 1, wearTint: 0, grimeTint: 1 }, // CLAD
  { tile: 1.5, detail: 1, wear: 0, grime: 0.35, normal: 0.35, wearTint: 0, grimeTint: 1 }, // GALV
  { tile: 4, detail: 1, wear: 0.4, grime: 0.85, normal: 0.7, wearTint: 0, grimeTint: 0 }, // TANK
  { tile: 2, detail: 1, wear: 1, grime: 0.5, normal: 0.6, wearTint: 1, grimeTint: 1 }, // HAZARD
  { tile: 4, detail: 1, wear: 0.35, grime: 0.7, normal: 0.6, wearTint: 1, grimeTint: 0 }, // HULL
  { tile: 2, detail: 1, wear: 0, grime: 0.4, normal: 0.8, wearTint: 0, grimeTint: 1 }, // INSULATION
  { tile: 1, detail: 1, wear: 0, grime: 0.3, normal: 0.7, wearTint: 0, grimeTint: 1 }, // RUBBER
  { tile: 2, detail: 1, wear: 0, grime: 0.45, normal: 0.8, wearTint: 0, grimeTint: 1 }, // WOOD
  { tile: 2, detail: 1, wear: 0, grime: 0.3, normal: 1, wearTint: 0, grimeTint: 1 }, // GRAVEL
  { tile: 2, detail: 0.5, wear: 0, grime: 0.35, normal: 0.25, wearTint: 0, grimeTint: 1 }, // AUTO
];

export interface SurfaceTextureData {
  size: number;
  layers: number;
  detail: Uint8Array;
  normal: Uint8Array;
}

// ---- tileable noise ---------------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** Value noise on a lattice of px × py cells over the unit tile (periodic). */
function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hash2(wrap(x0, px), wrap(y0, py), seed);
  const b = hash2(wrap(x0 + 1, px), wrap(y0, py), seed);
  const c = hash2(wrap(x0, px), wrap(y0 + 1, py), seed);
  const d = hash2(wrap(x0 + 1, px), wrap(y0 + 1, py), seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Periodic fBm; octaves above the texture's Nyquist limit are skipped. `sx`/`sy` stretch the axes. */
function fbm(u: number, v: number, freq: number, oct: number, seed: number, maxFreq: number, sx = 1, sy = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < oct; o++) {
    const fx = Math.max(1, Math.round(f * sx));
    const fy = Math.max(1, Math.round(f * sy));
    if (Math.max(fx, fy) > maxFreq) break;
    sum += vnoise(u, v, fx, fy, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

/** Periodic cellular noise: distance to the nearest jittered feature point (n × n cells) and its id. */
function cellular(u: number, v: number, n: number, seed: number, out: { d: number; id: number; d2: number }): void {
  const x = u * n;
  const y = v * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = 9;
  let second = 9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const gx = wrap(cx + ox, n);
      const gy = wrap(cy + oy, n);
      const px = cx + ox + hash2(gx, gy, seed);
      const py = cy + oy + hash2(gx, gy, seed + 17);
      const d = Math.hypot(px - x, py - y);
      if (d < best) {
        second = best;
        best = d;
        id = hash2(gx, gy, seed + 31);
      } else if (d < second) second = d;
    }
  out.d = best;
  out.d2 = second;
  out.id = id;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Distance from (u, v) to a periodic grid line every 1/n (0 on the line, in tile units). */
function lineDist(t: number, n: number): number {
  const f = t * n;
  return Math.abs(f - Math.round(f)) / n;
}

// ---- per-layer painters -----------------------------------------------------------------------------

interface Px {
  alb: number;
  wear: number;
  grime: number;
  rough: number;
  h: number;
}

type Painter = (u: number, v: number, o: Px, S: number) => void;

const _c = { d: 0, id: 0, d2: 0 };

/** Scratches: thin short strokes hashed per cell (value in 0..1). */
function scratches(u: number, v: number, n: number, seed: number, S: number): number {
  const x = u * n;
  const y = v * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let s = 0;
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const gx = wrap(cx + ox, n);
      const gy = wrap(cy + oy, n);
      if (hash2(gx, gy, seed + 5) > 0.3) continue;
      const px = cx + ox + hash2(gx, gy, seed);
      const py = cy + oy + hash2(gx, gy, seed + 1);
      const a = hash2(gx, gy, seed + 2) * Math.PI;
      const len = 0.3 + hash2(gx, gy, seed + 3) * 0.6;
      const dx = x - px;
      const dy = y - py;
      const along = dx * Math.cos(a) + dy * Math.sin(a);
      const across = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      const w = Math.max(0.012, (n * 1.2) / S);
      if (Math.abs(along) < len && across < w) s = Math.max(s, 1 - across / w);
    }
  return s;
}

const PAINTERS: Painter[] = [];

// PAINT: orange peel, faded blotches, scratches, chipped edges, small rust spots
PAINTERS[SURF.PAINT] = (u, v, o, S) => {
  const peel = fbm(u, v, 48, 2, 11, S / 3);
  const blot = fbm(u, v, 3, 4, 12, S / 3);
  const chip = fbm(u, v, 6, 5, 13, S / 3);
  const sc = scratches(u, v, 10, 14, S) * 0.6;
  cellular(u, v, 9, 15, _c);
  const rustSpot = _c.id > 0.86 ? sstep(0.14, 0.04, _c.d) : 0;
  o.alb = 0.94 + blot * 0.1 + sc * 0.06;
  o.wear = Math.max(sstep(0.75, 0.8, chip), sc * 0.7);
  o.grime = Math.max(rustSpot, sstep(0.62, 0.8, blot) * 0.35);
  o.rough = 0.9 + peel * 0.15 + blot * 0.1 + o.wear * 0.2;
  o.h = peel * 0.07 - o.wear * 0.45 - sc * 0.12;
};

// STEEL: brushed grain, pitting, faint stains
PAINTERS[SURF.STEEL] = (u, v, o, S) => {
  const brush = fbm(u, v, 3, 5, 21, S / 2, 1, 24);
  const stain = fbm(u, v, 3, 4, 22, S / 3);
  cellular(u, v, 28, 23, _c);
  const pit = _c.id > 0.7 ? sstep(0.12, 0.02, _c.d) : 0;
  o.alb = 0.9 + brush * 0.18 - pit * 0.25;
  o.wear = 0;
  o.grime = sstep(0.6, 0.85, stain) * 0.6 + pit * 0.5;
  o.rough = 0.8 + brush * 0.35 + o.grime * 0.3;
  o.h = brush * 0.15 - pit * 0.6;
};

// CONCRETE: aggregate, pores, water stains running down, hairline cracks
PAINTERS[SURF.CONCRETE] = (u, v, o, S) => {
  cellular(u, v, Math.min(64, Math.floor(S / 6)), 31, _c);
  const agg = _c.id;
  const edge = sstep(0.0, 0.12, _c.d2 - _c.d);
  const base = fbm(u, v, 4, 5, 32, S / 3);
  const streak = fbm(u, v, 2, 4, 33, S / 3, 6, 1);
  cellular(u, v, 60, 34, _c);
  const pore = _c.id > 0.75 ? sstep(0.14, 0.03, _c.d) : 0;
  const crackN = fbm(u, v, 5, 4, 35, S / 3);
  const crack = sstep(0.012, 0.0, Math.abs(crackN - 0.5)) * sstep(0.45, 0.7, fbm(u, v, 2, 3, 36, S / 3));
  o.alb = 0.84 + base * 0.2 + (agg - 0.5) * 0.12 * edge - pore * 0.35 - crack * 0.35;
  o.wear = 0;
  o.grime = sstep(0.55, 0.8, streak) * 0.7 + sstep(0.7, 0.9, base) * 0.3;
  o.rough = 0.95 + base * 0.1;
  o.h = base * 0.35 + (agg - 0.5) * 0.1 * edge - pore * 0.5 - crack * 0.7;
};

// GLASS: smudges only
PAINTERS[SURF.GLASS] = (u, v, o, S) => {
  const sm = fbm(u, v, 4, 4, 41, S / 3);
  o.alb = 0.97 + sm * 0.06;
  o.wear = 0;
  o.grime = sstep(0.62, 0.9, sm) * 0.6;
  o.rough = 0.6 + sm * 1.2;
  o.h = 0;
};

// CLAD: corrugated sheet (vertical ribs), sheet laps, streaky weathering
PAINTERS[SURF.CLAD] = (u, v, o, S) => {
  const ribs = Math.min(16, Math.floor(S / 6));
  const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * ribs);
  const lap = sstep(0.01, 0.0, lineDist(v, 1));
  const streak = fbm(u, v, 2, 4, 51, S / 3, 8, 1);
  const chip = fbm(u, v, 5, 5, 52, S / 3);
  o.alb = 0.92 + rib * 0.1 - lap * 0.2;
  o.wear = sstep(0.72, 0.78, chip) * 0.8;
  o.grime = sstep(0.5, 0.8, streak) * 0.6 + lap * 0.4;
  o.rough = 0.95 + (1 - rib) * 0.1;
  o.h = rib * 1.0 - lap * 0.4;
};

// GALV: spangle crystals, white-rust bloom
PAINTERS[SURF.GALV] = (u, v, o, S) => {
  cellular(u, v, 18, 61, _c);
  const sp = _c.id;
  const bloom = fbm(u, v, 3, 4, 62, S / 3);
  o.alb = 0.88 + sp * 0.16 + sstep(0.65, 0.85, bloom) * 0.12;
  o.wear = 0;
  o.grime = sstep(0.72, 0.9, fbm(u, v, 4, 4, 63, S / 3)) * 0.5;
  o.rough = 0.75 + sp * 0.4;
  o.h = sp * 0.12;
};

// TANK: welded plate courses (brick pattern), rust streaks bleeding down from seams
PAINTERS[SURF.TANK] = (u, v, o, S) => {
  const rows = 4;
  const row = Math.floor(v * rows);
  const off = (row % 2) * 0.25;
  const seamH = sstep(0.006, 0.0, lineDist(v, rows));
  const seamV = sstep(0.004, 0.0, lineDist(u + off, 2));
  const below = ((v * rows) % 1) as number; // 0 at the lower seam, 1 just under the next
  const drip = fbm(u, v, 3, 3, 71, S / 2, 14, 1);
  const streak = sstep(0.45, 0.85, drip) * Math.pow(below, 2.5);
  const chip = fbm(u, v, 6, 5, 72, S / 3);
  const blot = fbm(u, v, 2, 4, 73, S / 3);
  o.alb = 0.93 + blot * 0.1 - (seamH + seamV) * 0.08;
  o.wear = sstep(0.74, 0.8, chip) * 0.7;
  o.grime = Math.min(1, streak * 1.2 + (seamH + seamV) * 0.35 + sstep(0.7, 0.9, blot) * 0.3);
  o.rough = 0.9 + blot * 0.15 + o.grime * 0.2;
  o.h = (seamH + seamV) * 0.9 + blot * 0.1;
};

// HAZARD: heavily chipped hazard paint
PAINTERS[SURF.HAZARD] = (u, v, o, S) => {
  const chip = fbm(u, v, 5, 5, 81, S / 3);
  const sc = scratches(u, v, 12, 82, S);
  const blot = fbm(u, v, 3, 4, 83, S / 3);
  o.alb = 0.93 + blot * 0.1;
  o.wear = Math.max(sstep(0.6, 0.66, chip), sc);
  o.grime = sstep(0.6, 0.85, blot) * 0.5;
  o.rough = 0.9 + blot * 0.2 + o.wear * 0.2;
  o.h = -o.wear * 0.6 + fbm(u, v, 40, 2, 84, S / 3) * 0.15;
};

// HULL: large plates, rust weeping from plate edges, sea-spray blotches
PAINTERS[SURF.HULL] = (u, v, o, S) => {
  const seamH = sstep(0.005, 0.0, lineDist(v, 3));
  const seamV = sstep(0.004, 0.0, lineDist(u, 2));
  const weep = sstep(0.5, 0.85, fbm(u, v, 3, 3, 91, S / 2, 12, 1)) * sstep(0.2, 0.0, lineDist(v - 0.1, 3));
  const blot = fbm(u, v, 3, 4, 92, S / 3);
  o.alb = 0.93 + blot * 0.12;
  o.wear = sstep(0.76, 0.82, fbm(u, v, 6, 5, 93, S / 3)) * 0.6;
  o.grime = Math.min(1, weep + (seamH + seamV) * 0.3);
  o.rough = 0.9 + blot * 0.2;
  o.h = (seamH + seamV) * 0.8 + blot * 0.15;
};

// INSULATION: aluminium jacketing sheets with overlapping laps, dents and dull sheen
PAINTERS[SURF.INSULATION] = (u, v, o, S) => {
  const lapU = sstep(0.01, 0.0, lineDist(u, 2));
  const lapV = sstep(0.012, 0.0, lineDist(v, 4));
  const dent = fbm(u, v, 5, 3, 101, S / 3);
  const sheen = fbm(u, v, 2, 4, 102, S / 3, 1, 5);
  o.alb = 0.9 + sheen * 0.15 - (lapU + lapV) * 0.1;
  o.wear = 0;
  o.grime = sstep(0.68, 0.9, fbm(u, v, 3, 4, 103, S / 3)) * 0.5 + lapV * 0.3;
  o.rough = 0.8 + sheen * 0.3;
  o.h = dent * 0.18 + (lapU + lapV) * 0.7;
};

// RUBBER: fine grain, scuffs
PAINTERS[SURF.RUBBER] = (u, v, o, S) => {
  const g = fbm(u, v, 32, 3, 111, S / 2);
  const scuff = fbm(u, v, 4, 4, 112, S / 3);
  o.alb = 0.85 + g * 0.2 + sstep(0.7, 0.9, scuff) * 0.35;
  o.wear = 0;
  o.grime = sstep(0.55, 0.8, scuff) * 0.6;
  o.rough = 1.0 + g * 0.1;
  o.h = g * 0.5;
};

// WOOD: boards with gaps, grain lines, knots
PAINTERS[SURF.WOOD] = (u, v, o, S) => {
  const boards = 4;
  const bi = Math.floor(v * boards);
  const gap = sstep(0.01, 0.0, lineDist(v, boards));
  const tone = hash2(bi, 0, 121);
  const warp = fbm(u, v, 2, 3, 122, S / 3) * 0.08;
  const grain = 0.5 + 0.5 * Math.sin((v + warp) * Math.PI * 2 * 60 + fbm(u, v, 4, 3, 123 + bi, S / 3, 1, 1) * 6);
  cellular(u, v, 5, 124, _c);
  const knot = _c.id > 0.85 ? sstep(0.08, 0.02, _c.d) : 0;
  o.alb = 0.8 + tone * 0.25 + grain * 0.1 - knot * 0.35 - gap * 0.5;
  o.wear = 0;
  o.grime = sstep(0.6, 0.85, fbm(u, v, 3, 4, 125, S / 3)) * 0.5;
  o.rough = 0.95 + grain * 0.1;
  o.h = grain * 0.2 - gap * 1.2 - knot * 0.3;
};

// GRAVEL: packed pebbles
PAINTERS[SURF.GRAVEL] = (u, v, o, S) => {
  cellular(u, v, Math.min(26, S / 5), 131, _c);
  const peb = sstep(0.0, 0.16, _c.d2 - _c.d);
  const fine = fbm(u, v, 40, 2, 132, S / 2);
  o.alb = 0.7 + _c.id * 0.45 * peb + fine * 0.1 - (1 - peb) * 0.2;
  o.wear = 0;
  o.grime = sstep(0.6, 0.85, fbm(u, v, 3, 4, 133, S / 3)) * 0.5;
  o.rough = 1;
  o.h = peb * (1 - _c.d) * 1.2 + fine * 0.15;
};

// AUTO: glossy vehicle paint with metallic flake and road dirt
PAINTERS[SURF.AUTO] = (u, v, o, S) => {
  const flake = hash2(Math.floor(u * S), Math.floor(v * S), 141);
  const dirt = fbm(u, v, 3, 4, 142, S / 3);
  o.alb = 0.97 + flake * 0.05;
  o.wear = sstep(0.8, 0.84, fbm(u, v, 7, 4, 143, S / 3)) * 0.5;
  o.grime = sstep(0.55, 0.85, dirt) * 0.6;
  o.rough = 0.55 + flake * 0.25 + o.grime * 0.8;
  o.h = fbm(u, v, 48, 2, 144, S / 3) * 0.08;
};

/** Height-to-normal strength per layer (in pixels of tangent slope). */
const BUMP: number[] = [0.9, 0.5, 1.4, 0.2, 3.0, 0.6, 2.2, 1.5, 1.8, 1.3, 1.2, 2.4, 3.0, 0.4];

/** Paint rows [y0, y1) of one layer into the output arrays (for time slicing). */
export function paintRows(layer: number, S: number, y0: number, y1: number, height: Float32Array, detail: Uint8Array): void {
  const painter = PAINTERS[layer];
  const o: Px = { alb: 1, wear: 0, grime: 0, rough: 1, h: 0 };
  const base = layer * S * S;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < S; x++) {
      painter((x + 0.5) / S, (y + 0.5) / S, o, S);
      const i = base + y * S + x;
      height[y * S + x] = o.h;
      detail[i * 4] = Math.round(clamp01(o.alb / 2) * 255);
      detail[i * 4 + 1] = Math.round(clamp01(o.wear) * 255);
      detail[i * 4 + 2] = Math.round(clamp01(o.grime) * 255);
      detail[i * 4 + 3] = Math.round(clamp01(o.rough / 2) * 255);
    }
}

/** Derive a layer's normals from its (fully painted) height field. */
export function normalsFromHeight(layer: number, S: number, height: Float32Array, normal: Uint8Array): void {
  // bump strength is defined per tile pixel at 256 px; scale so the slope is resolution independent
  const k = BUMP[layer] * (S / 256) * 4;
  const base = layer * S * S;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const hl = height[y * S + wrap(x - 1, S)];
      const hr = height[y * S + wrap(x + 1, S)];
      const hd = height[wrap(y - 1, S) * S + x];
      const hu = height[wrap(y + 1, S) * S + x];
      let nx = (hl - hr) * k;
      let ny = (hd - hu) * k;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const i = base + y * S + x;
      normal[i * 2] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i * 2 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    }
}

/** Generate every layer at resolution S (blocking — call from a worker). */
export function generateSurfaceTextures(S: number): SurfaceTextureData {
  const detail = new Uint8Array(S * S * 4 * SURF_LAYERS);
  const normal = new Uint8Array(S * S * 2 * SURF_LAYERS);
  const height = new Float32Array(S * S);
  for (let l = 0; l < SURF_LAYERS; l++) {
    paintRows(l, S, 0, S, height, detail);
    normalsFromHeight(l, S, height, normal);
  }
  return { size: S, layers: SURF_LAYERS, detail, normal };
}
