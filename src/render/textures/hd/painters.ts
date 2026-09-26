// Procedural "realistic" block materials for the HD texture qualities. Each painter fills a tileable
// Surface (albedo, height, roughness) at any resolution — all features are defined in texture units, so
// 'high' (64²) and 'ultra' (256²) show the same material. Pure & worker-safe.
import { Surface, type RGB, type PackedLayer } from './Surface';
import { fbm, fbm2, gnoise, gnoise2, ridged, worley, warp, rng, hash01, clamp01, smooth, lerp, type Cell } from './noise';

type Pal = RGB[];
interface Result {
  /** Physical relief of the height field in blocks. */
  depth: number;
  cavity?: number;
}
type Painter = (s: Surface, pal: Pal, seed: number) => Result;

// ---- colour helpers (sRGB 0..1) -------------------------------------------------------------------

const hex = (v: number): RGB => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const lum = (c: RGB) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
const sat = (c: RGB, k: number): RGB => {
  const l = lum(c);
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
};
/** Game palettes are stylised; real materials are less saturated and a touch darker. */
const nat = (c: RGB, s = 0.78, k = 0.94): RGB => mul(sat(c, s), k);

// ---- building blocks --------------------------------------------------------------------------------

interface RockOpts {
  cells: number;
  crack: number;
  grain: number;
  mottle: number;
  warp: number;
  rough: number;
  colors: [RGB, RGB, RGB];
}

/** Generic massive rock: warped mottling, mineral grain, pits and a network of fine fractures. */
function rockField(s: Surface, seed: number, o: RockOpts) {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const c2: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 3, o.warp, seed);
    const m = fbm(u + wu, v + wv, 3, 5, seed + 1);
    const g = fbm(u, v, 48, 2, seed + 2);
    const micro = gnoise(u, v, 128, seed + 3) * 0.5 + 0.5;
    worley(u + wu * 0.6, v + wv * 0.6, o.cells, seed + 4, c, 0.9);
    const edge = c.f2 - c.f1;
    // fractures are discontinuous: faded out along their length by noise, so no closed polygons
    const crackVis = smooth(0.45, 0.6, fbm(u, v, 5, 3, seed + 12));
    const crack = (1 - smooth(0, o.crack, edge)) * crackVis;
    worley(u + wu, v + wv, o.cells * 3, seed + 5, c2, 1);
    const fine = (1 - smooth(0, o.crack * 0.6, c2.f2 - c2.f1)) * smooth(0.55, 0.7, fbm(u, v, 9, 2, seed + 13));
    const pit = smooth(0.62, 0.8, fbm(u, v, 24, 2, seed + 6));
    const facet = c.id; // per fragment tone
    let col = mix(o.colors[0], o.colors[1], smooth(0.25, 0.75, m));
    col = mix(col, o.colors[2], smooth(0.55, 0.95, g) * o.grain);
    col = mul(col, 0.92 + (facet - 0.5) * 0.12 * o.mottle + (micro - 0.5) * 0.08);
    col = mul(col, 1 - crack * 0.45 - fine * 0.15 - pit * 0.2);
    s.setCol(i, col);
    s.h[i] = 0.55 + (m - 0.5) * 0.5 + (facet - 0.5) * 0.25 + (g - 0.5) * 0.1 + (micro - 0.5) * 0.06 - crack * 0.5 - fine * 0.12 - pit * 0.15;
    s.r[i] = clamp01(o.rough + (micro - 0.5) * 0.1 + crack * 0.05);
  });
}

/** Horizontal sedimentary layering; returns per-texel band info through the callback. */
function strata(s: Surface, seed: number, bands: number, wav: number, fn: (i: number, u: number, v: number, band: number, inBand: number, bandId: number) => void) {
  s.each((u, v, i) => {
    const w = (fbm(u, v, 2, 3, seed) - 0.5) * wav + gnoise(u, 0.5, 1, seed + 3) * wav * 0.3;
    const L = (v + w) * bands;
    const b = Math.floor(L);
    const bandId = hash01(((b % bands) + bands) % bands, 0, seed + 9);
    fn(i, u, v, b, L - b, bandId);
  });
}

/** Rounded pebbles/stones from Voronoi cells; returns height dome & per-stone id. */
function stones(s: Surface, seed: number, cells: number, fill: number, fn: (i: number, dome: number, id: number, gap: number, u: number, v: number) => void) {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, cells / 2, 0.25 / cells, seed + 11);
    worley(u + wu, v + wv, cells, seed, c, 0.85);
    const edge = c.f2 - c.f1;
    const gap = 1 - smooth(0.02, 0.02 + 0.25 * fill, edge);
    const r = Math.min(1, c.f1 / (0.5 + 0.35 * fill));
    const dome = Math.sqrt(Math.max(0, 1 - r * r)) * (1 - gap);
    fn(i, dome, c.id, gap, u, v);
  });
}

function scatterPebbles(s: Surface, seed: number, count: number, rmin: number, rmax: number, palette: RGB[], lift = 0.35) {
  const R = rng(seed);
  for (let k = 0; k < count; k++) {
    const cu = R();
    const cv = R();
    const r = rmin + (rmax - rmin) * R() * R();
    const col = mul(palette[Math.floor(R() * palette.length)], 0.8 + R() * 0.35);
    const sq = 0.7 + R() * 0.6;
    s.disk(cu, cv, r * 1.15, (i, du, dv) => {
      const d = Math.sqrt((du * sq) ** 2 + (dv / sq) ** 2) / r;
      if (d > 1) {
        // contact shadow ring
        if (d < 1.15) s.mulCol(i, 0.85 + (d - 1) * 1);
        return;
      }
      const dome = Math.sqrt(1 - d * d);
      const hh = 0.5 + dome * lift;
      if (hh > s.h[i]) {
        s.h[i] = hh;
        s.setCol(i, mul(col, 0.8 + dome * 0.35 - (du + dv) * 1.5 * (0.1 / r) * 0.1));
        s.r[i] = 0.6;
      }
    });
  }
}

// ---- soils & sediments ---------------------------------------------------------------------------------

function soil(s: Surface, pal: Pal, seed: number, o: { clods: number; pebbles: number; roots: number; wet?: number; base?: RGB[] }) {
  const base = o.base ?? [nat(pal[1], 0.8, 0.8), nat(pal[0], 0.8, 0.9), nat(pal[2], 0.8, 0.95)];
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 4, 0.06, seed);
    const m = fbm(u + wu, v + wv, 4, 5, seed + 1);
    const g = fbm(u, v, 40, 3, seed + 2);
    worley(u + wu * 2, v + wv * 2, 22, seed + 3, c, 1);
    const crumb = fbm(u, v, 24, 3, seed + 4);
    const clod = smooth(0.1, 0.9, 1 - c.f1) * o.clods * (0.5 + crumb * 0.5);
    const crev = (1 - smooth(0.0, 0.12, c.f2 - c.f1)) * smooth(0.45, 0.65, crumb) * 0.8;
    let col = mix(base[0], base[1], smooth(0.2, 0.8, m));
    col = mix(col, base[2], smooth(0.6, 0.95, g) * 0.6);
    col = mul(col, 0.9 + (c.id - 0.5) * 0.12 - crev * 0.25 * o.clods);
    s.setCol(i, col);
    s.h[i] = 0.4 + m * 0.2 + g * 0.1 + clod * 0.25 - crev * 0.15 * o.clods;
    s.r[i] = 0.9 - (o.wet ?? 0) * smooth(0.55, 0.8, 1 - m) * 0.6;
  });
  if (o.roots > 0) {
    const R = rng(seed + 5);
    const rc = mul(base[0], 0.55);
    for (let k = 0; k < o.roots; k++) {
      s.stroke(R(), R(), R() * Math.PI * 2, 0.08 + R() * 0.2, 0.006, 0.002, (i, _t, sv) => {
        const k2 = 1 - Math.abs(sv);
        s.blend(i, rc, k2 * 0.7);
        s.h[i] = Math.max(s.h[i], 0.55 + k2 * 0.05);
      }, (R() - 0.5) * 0.1);
    }
  }
  if (o.pebbles > 0) scatterPebbles(s, seed + 7, o.pebbles, 0.008, 0.035, [hex(0x8a8580), hex(0x6e675e), hex(0xa39a8c), hex(0x5d5249)]);
}

const paintDirt: Painter = (s, pal, seed) => {
  soil(s, pal, seed, { clods: 1, pebbles: Math.round(s.n * 0.18), roots: 10 });
  return { depth: 0.05 };
};

const paintMud: Painter = (s, pal, seed) => {
  soil(s, pal, seed, { clods: 0.3, pebbles: Math.round(s.n * 0.05), roots: 4, wet: 1 });
  // glossy puddles in the low spots
  s.each((u, v, i) => {
    const p = smooth(0.58, 0.66, fbm(u, v, 3, 4, seed + 21));
    if (p > 0) {
      s.blend(i, mul(s.getCol(i), 0.7), p);
      s.h[i] = lerp(s.h[i], 0.35, p);
      s.r[i] = lerp(s.r[i], 0.12, p);
    }
  });
  return { depth: 0.035 };
};

const paintClay: Painter = (s, pal, seed) => {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const a = nat(pal[1], 0.7, 0.9);
  const b = nat(pal[2], 0.7, 1);
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 5, seed);
    worley(u, v, 5, seed + 1, c, 0.9);
    const crack = 1 - smooth(0.0, 0.035, c.f2 - c.f1);
    const curl = smooth(0.3, 1, c.f1) * 0.08; // plates curl up at their rims
    s.setCol(i, mul(mix(a, b, m), 0.95 + (c.id - 0.5) * 0.1 - crack * 0.5));
    s.h[i] = 0.6 + m * 0.1 + curl - crack * 0.55;
    s.r[i] = 0.75 + crack * 0.2;
  });
  return { depth: 0.04 };
};

function sandField(s: Surface, pal: Pal, seed: number, ripples: number, shells: boolean) {
  const a = nat(pal[1], 0.75, 0.92);
  const b = nat(pal[0], 0.75, 0.97);
  const light = nat(pal[2] ?? pal[0], 0.7, 1.02);
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 2, 0.12, seed);
    const ph = (v + wv + gnoise(u, v, 2, seed + 5) * 0.04) * ripples * Math.PI * 2 + (u + wu) * 2 * Math.PI;
    const rip = Math.sin(ph) * 0.5 + 0.5;
    const ripA = Math.pow(rip, 1.6); // asymmetric (lee side steeper)
    const grain = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    const grain2 = gnoise(u, v, s.n / 4, seed + 2) * 0.5 + 0.5;
    const m = fbm(u, v, 4, 3, seed + 3);
    let col = mix(a, b, smooth(0.2, 0.8, m * 0.6 + ripA * 0.4));
    col = mix(col, light, smooth(0.75, 1, grain) * 0.5);
    col = mul(col, 0.93 + (grain2 - 0.5) * 0.14);
    if (grain > 0.93) col = mix(col, hex(0x3b3530), 0.5); // dark mineral grains
    s.setCol(i, col);
    s.h[i] = ripA * 0.55 + m * 0.2 + grain * 0.1;
    s.r[i] = 0.92;
  });
  if (shells) scatterPebbles(s, seed + 9, Math.round(s.n * 0.05), 0.006, 0.02, [hex(0xe8dcc8), hex(0xcfc0a6), hex(0x9c8c78)], 0.2);
}

const paintSand: Painter = (s, pal, seed) => {
  sandField(s, pal, seed, 5, true);
  return { depth: 0.03, cavity: 0.3 };
};
const paintRedSand: Painter = (s, pal, seed) => {
  sandField(s, pal, seed, 4, false);
  return { depth: 0.03, cavity: 0.3 };
};
const paintSilt: Painter = (s, pal, seed) => {
  sandField(s, pal, seed, 3, true);
  s.each((u, v, i) => {
    s.blend(i, mul(s.getCol(i), 0.85), fbm(u, v, 5, 3, seed + 30) * 0.5);
    s.r[i] = 0.85;
  });
  return { depth: 0.025, cavity: 0.3 };
};

function gravelField(s: Surface, pal: Pal, seed: number, cells: number, angular: boolean) {
  const tones = [nat(pal[0], 0.7), nat(pal[1], 0.7), nat(pal[2], 0.7), hex(0x8b7d6b), hex(0x6b6660), hex(0xa79f95), hex(0x5e5750), hex(0xb2a894)];
  // sandy / dusty matrix between the stones
  s.each((u, v, i) => {
    const g = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    s.setCol(i, mul(mix(hex(0x5a5248), nat(pal[1], 0.5, 0.7), fbm(u, v, 6, 3, seed + 2)), 0.7 + g * 0.2));
    s.h[i] = 0.1 + g * 0.05;
    s.r[i] = 0.95;
  });
  const R = rng(seed + 3);
  // big stones first, then smaller ones filling the gaps (drawn only where they sit higher)
  for (const [count, rmin, rmax] of [[cells * cells * 0.9, 0.035, 0.07], [cells * cells * 2.5, 0.015, 0.035], [cells * cells * 5, 0.006, 0.015]] as const) {
    for (let k = 0; k < count; k++) {
      const cu = R();
      const cv = R();
      const r = rmin + (rmax - rmin) * R();
      const sq = 0.65 + R() * 0.7;
      const rot = R() * Math.PI;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const t = tones[Math.floor(R() * tones.length)];
      const lift = 0.5 + R() * 0.5;
      const sd = Math.floor(R() * 1000);
      s.disk(cu, cv, r * 1.5, (i, du, dv) => {
        const x = (du * cr + dv * sr) / (r * sq);
        const y = (-du * sr + dv * cr) / (r / sq);
        let d = Math.sqrt(x * x + y * y);
        if (angular) d = Math.max(Math.abs(x) * 0.8 + Math.abs(y) * 0.45, Math.abs(y) * 0.9 + Math.abs(x) * 0.35) * 1.05;
        if (d > 1) return;
        const dome = Math.sqrt(1 - d * d);
        const hh = 0.2 + dome * 0.8 * lift;
        if (hh <= s.h[i]) return;
        const speck = gnoise(cu + du, cv + dv, s.n / 3, sd) * 0.5 + 0.5;
        s.h[i] = hh + (speck - 0.5) * 0.03;
        s.setCol(i, mul(t, 0.7 + dome * 0.4 + (speck - 0.5) * 0.18));
        s.r[i] = 0.55 + speck * 0.2;
      });
    }
  }
}

const paintGravel: Painter = (s, pal, seed) => {
  gravelField(s, pal, seed, 9, false);
  return { depth: 0.07, cavity: 0.9 };
};
const paintGravelPad: Painter = (s, pal, seed) => {
  gravelField(s, pal, seed, 12, true);
  return { depth: 0.05, cavity: 0.9 };
};

const paintSnow: Painter = (s, pal, seed) => {
  const w = hex(0xf6f9fc);
  const blue = hex(0xc9d8ea);
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 5, seed);
    const g = gnoise(u, v, s.n / 2, seed + 2) * 0.5 + 0.5;
    const dune = smooth(0.3, 0.8, m);
    s.setCol(i, mul(mix(blue, w, 0.55 + dune * 0.45), 0.97 + (g - 0.5) * 0.05));
    s.h[i] = dune * 0.8 + g * 0.05;
    s.r[i] = 0.55 + (g - 0.5) * 0.3;
  });
  return { depth: 0.035, cavity: 0.5 };
};

const paintIce: Painter = (s, _pal, seed) => {
  const a = hex(0x9ec8e8);
  const b = hex(0xd6ecfa);
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    const m = fbm(u, v, 2, 5, seed);
    worley(u, v, 4, seed + 1, c, 1);
    const crack = 1 - smooth(0.0, 0.012, c.f2 - c.f1);
    const bubble = smooth(0.92, 0.97, gnoise(u, v, 40, seed + 3) * 0.5 + 0.5);
    s.setCol(i, mix(mix(a, b, m), hex(0xffffff), crack * 0.7 + bubble * 0.5));
    s.alpha[i] = 0.82 + crack * 0.15;
    s.h[i] = 0.8 - crack * 0.4 + m * 0.1;
    s.r[i] = 0.06 + crack * 0.3;
  });
  return { depth: 0.01, cavity: 0 };
};

const paintAsh: Painter = (s, pal, seed) => {
  s.each((u, v, i) => {
    const m = fbm(u, v, 4, 5, seed);
    const g = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    s.setCol(i, mul(mix(nat(pal[1], 0.2), nat(pal[2], 0.2), m), 0.9 + (g - 0.5) * 0.2));
    s.h[i] = m * 0.6 + g * 0.1;
    s.r[i] = 0.95;
  });
  scatterPebbles(s, seed + 3, Math.round(s.n * 0.06), 0.006, 0.02, [hex(0x1a1614), hex(0x2a2320)], 0.25);
  return { depth: 0.03 };
};

const paintScorched: Painter = (s, pal, seed) => {
  soil(s, pal, seed, { clods: 0.8, pebbles: Math.round(s.n * 0.08), roots: 0, base: [hex(0x14110f), hex(0x221c18), hex(0x3a322c)] });
  s.each((u, v, i) => {
    const e = smooth(0.8, 0.9, ridged(u, v, 4, 3, seed + 40));
    if (e > 0) s.blend(i, hex(0x5a5550), e * 0.6); // grey ash veils
  });
  return { depth: 0.05 };
};

const paintPermafrost: Painter = (s, pal, seed) => {
  soil(s, pal, seed, { clods: 0.9, pebbles: Math.round(s.n * 0.1), roots: 0, base: [nat(pal[2], 0.5, 0.8), nat(pal[0], 0.5, 0.9), hex(0x8a8580)] });
  s.each((u, v, i) => {
    const lens = smooth(0.6, 0.68, fbm2(u, v, 2, 8, 3, seed + 50));
    if (lens > 0) {
      s.blend(i, hex(0xdde9f2), lens * 0.85);
      s.r[i] = lerp(s.r[i], 0.12, lens);
      s.h[i] = lerp(s.h[i], 0.6, lens);
    }
  });
  return { depth: 0.045 };
};

// ---- vegetation on ground ----------------------------------------------------------------------------

function grassBlades(s: Surface, seed: number, density: number, greens: RGB[], soilCol: RGB, lenScale = 1) {
  // soil + thatch underneath
  s.each((u, v, i) => {
    const m = fbm(u, v, 5, 4, seed + 1);
    s.setCol(i, mul(mix(mul(soilCol, 0.55), mix(soilCol, greens[0], 0.35), m), 0.8));
    s.h[i] = 0.1 + m * 0.1;
    s.r[i] = 0.85;
  });
  const R = rng(seed);
  const count = Math.round(s.n * s.n * density);
  for (let k = 0; k < count; k++) {
    const cu = R();
    const cv = R();
    const ang = R() * Math.PI * 2;
    const len = (0.04 + R() * 0.07) * lenScale;
    const g0 = greens[Math.floor(R() * greens.length)];
    const patch = fbm(cu, cv, 3, 3, seed + 3); // lusher / drier patches
    const col = mul(mix(g0, hex(0xb3a45a), smooth(0.62, 0.85, patch) * 0.55), 0.8 + R() * 0.35);
    const top = 0.45 + R() * 0.55;
    s.stroke(cu, cv, ang, len, 0.012, 0.002, (i, t, sv) => {
      const hh = top * (0.35 + t * 0.65) * (1 - Math.abs(sv) * 0.3);
      if (hh <= s.h[i]) return;
      s.h[i] = hh;
      const shade = 0.72 + t * 0.4 - Math.abs(sv) * 0.12 + (sv > 0 ? 0.06 : 0); // midrib highlight
      s.setCol(i, mul(col, shade));
      s.r[i] = 0.6 + (1 - t) * 0.2;
    }, (R() - 0.5) * 0.03);
  }
}

const GRASS = (pal: Pal): RGB[] => [nat(pal[0], 0.82, 0.86), nat(pal[1], 0.82, 0.86), nat(mix(pal[0], hex(0x8aa04a), 0.4), 0.8, 0.9), nat(mix(pal[1], hex(0x3d5a2a), 0.5), 0.8, 0.85)];

const paintGrassTop: Painter = (s, pal, seed) => {
  grassBlades(s, seed, 0.11, GRASS(pal), nat(pal[2], 0.8, 0.9));
  // a few clover leaves & fallen seeds
  scatterPebbles(s, seed + 12, Math.round(s.n * 0.03), 0.006, 0.012, [mul(nat(pal[1]), 0.9)], 0.6);
  return { depth: 0.05, cavity: 0.7 };
};

/** Side of a covered soil block: `under` painter, then an irregular fringe of the top material. */
function fringeSide(s: Surface, seed: number, under: Painter, pal: Pal, cover: (i: number, u: number, v: number, depthIn: number) => void, depth: number, jag: number) {
  under(s, pal, seed);
  s.each((u, v, i) => {
    const edge = depth + (fbm(u, 0.5, 8, 3, seed + 77) - 0.5) * jag + Math.abs(gnoise(u, 0.3, 24, seed + 78)) * jag * 0.6;
    if (v < edge) cover(i, u, v, (edge - v) / edge);
    else if (v < edge + 0.03) s.mulCol(i, 0.7 + ((v - edge) / 0.03) * 0.3); // overhang shadow
  });
}

const paintGrassSide: Painter = (s, pal, seed) => {
  const greens = GRASS(pal);
  fringeSide(s, seed, (ss, p, sd) => {
    soil(ss, [p[2], mul(p[2], 0.85), mul(p[2], 1.1)], sd, { clods: 1, pebbles: Math.round(ss.n * 0.12), roots: 16 });
    return { depth: 0.05 };
  }, pal, (i, u, v, d) => {
    const g = greens[Math.floor(hash01(Math.floor(u * s.n * 0.5), Math.floor(v * s.n * 0.25), seed) * greens.length)];
    const blade = gnoise2(u, v, s.n / 3, 4, seed + 5) * 0.5 + 0.5;
    s.setCol(i, mul(g, 0.7 + blade * 0.4 + d * 0.1));
    s.h[i] = 0.65 + blade * 0.3;
    s.r[i] = 0.65;
  }, 0.16, 0.12);
  return { depth: 0.05 };
};

const paintPodzolTop: Painter = (s, pal, seed) => {
  soil(s, pal, seed, { clods: 0.4, pebbles: Math.round(s.n * 0.04), roots: 6 });
  // needle & leaf litter
  const R = rng(seed + 3);
  const tones = [hex(0x6b4a26), hex(0x8a6232), hex(0x4f3a22), hex(0x9c7a44), hex(0x3f4a26)];
  const count = Math.round(s.n * s.n * 0.03);
  for (let k = 0; k < count; k++) {
    const col = mul(tones[Math.floor(R() * tones.length)], 0.8 + R() * 0.3);
    const top = 0.5 + R() * 0.5;
    s.stroke(R(), R(), R() * Math.PI * 2, 0.03 + R() * 0.05, 0.006, 0.004, (i, t, sv) => {
      const hh = top * (1 - Math.abs(sv) * 0.4);
      if (hh <= s.h[i]) return;
      s.h[i] = hh;
      s.setCol(i, mul(col, 0.85 + t * 0.2));
      s.r[i] = 0.7;
    });
  }
  return { depth: 0.04 };
};

const paintPodzolSide: Painter = (s, pal, seed) => {
  fringeSide(s, seed, paintDirt, [pal[2], pal[1], pal[2]], (i, u, v) => {
    const m = fbm(u, v, 12, 3, seed);
    s.setCol(i, mul(mix(hex(0x4a3319), hex(0x6b4a26), m), 0.9));
    s.h[i] = 0.7 + m * 0.2;
  }, 0.12, 0.08);
  return { depth: 0.05 };
};

const paintSnowSide: Painter = (s, pal, seed) => {
  fringeSide(s, seed, paintDirt, [pal[2], mul(pal[2], 0.85), mul(pal[2], 1.1)], (i, u, v, d) => {
    const g = gnoise(u, v, s.n / 2, seed + 2) * 0.5 + 0.5;
    s.setCol(i, mul(mix(hex(0xc9d8ea), hex(0xf6f9fc), 0.5 + d * 0.5), 0.97 + g * 0.05));
    s.h[i] = 0.8 + d * 0.15;
    s.r[i] = 0.55;
  }, 0.22, 0.1);
  return { depth: 0.05 };
};

const paintMossyStone: Painter = (s, pal, seed) => {
  cobble(s, [hex(0x7d7d80), hex(0x6a6a6d), hex(0x8e8e91)], seed);
  s.each((u, v, i) => {
    const moss = smooth(0.48, 0.62, fbm(u, v, 3, 5, seed + 60) + (s.h[i] < 0.4 ? 0.08 : 0));
    if (moss <= 0) return;
    const fuzz = gnoise(u, v, s.n / 2, seed + 61) * 0.5 + 0.5;
    s.blend(i, mul(mix(nat(pal[1], 0.9), nat(pal[0], 0.9, 1), fuzz), 0.8 + fuzz * 0.3), moss);
    s.h[i] += moss * (0.08 + fuzz * 0.06);
    s.r[i] = lerp(s.r[i], 0.9, moss);
  });
  return { depth: 0.08 };
};

/** Irregular fitted stones with mortar/soil joints. */
function cobble(s: Surface, tones: RGB[], seed: number) {
  stones(s, seed, 4, 0.35, (i, dome, id, gap, u, v) => {
    const g = fbm(u, v, 32, 2, seed + 3);
    const t = mix(tones[Math.floor(id * tones.length)], tones[(Math.floor(id * 7) + 1) % tones.length], g * 0.4);
    s.setCol(i, mul(mix(t, hex(0x3a3833), gap), 0.8 + dome * 0.3 + (g - 0.5) * 0.15));
    s.h[i] = Math.pow(dome, 0.5) * 0.8 + (g - 0.5) * 0.08;
    s.r[i] = 0.8;
  });
}

// ---- rocks -----------------------------------------------------------------------------------------------

const paintStone: Painter = (s, pal, seed) => {
  rockField(s, seed, { cells: 3, crack: 0.035, grain: 0.5, mottle: 1, warp: 0.25, rough: 0.78, colors: [nat(pal[1], 0.6, 0.92), nat(pal[0], 0.6, 1), nat(pal[2], 0.6, 1.05)] });
  return { depth: 0.07 };
};

const paintBedrock: Painter = (s, pal, seed) => {
  rockField(s, seed, { cells: 5, crack: 0.08, grain: 0.7, mottle: 2, warp: 0.35, rough: 0.9, colors: [nat(pal[2], 0.5, 0.9), nat(pal[0], 0.5, 1), nat(pal[1], 0.5, 1.1)] });
  return { depth: 0.1 };
};

const paintGranite: Painter = (s, pal, seed) => {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const feld = nat(pal[0], 0.7, 1);
  const feld2 = nat(pal[2], 0.7, 1);
  const quartz = hex(0xc8c4bc);
  const biot = hex(0x1c1a1a);
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 12, 0.012, seed + 5);
    worley(u + wu, v + wv, 34, seed, c, 1);
    const id = c.id;
    const edge = smooth(0, 0.08, c.f2 - c.f1);
    let col = id < 0.45 ? mix(feld, feld2, hash01(Math.floor(id * 1000), 1, seed)) : id < 0.75 ? quartz : id < 0.93 ? mix(biot, hex(0x3a3431), 0.3) : hex(0x6b6a66);
    const m = fbm(u, v, 4, 3, seed + 3);
    col = mul(col, 0.85 + m * 0.2 + (edge - 1) * 0.12);
    s.setCol(i, col);
    s.h[i] = 0.6 + (id < 0.75 && id >= 0.45 ? 0.06 : 0) + m * 0.2 - (1 - edge) * 0.1;
    s.r[i] = id >= 0.45 && id < 0.75 ? 0.35 : 0.7; // quartz glints
  });
  return { depth: 0.03 };
};

const paintBasalt: Painter = (s, pal, seed) => {
  rockField(s, seed, { cells: 2, crack: 0.02, grain: 0.3, mottle: 0.6, warp: 0.1, rough: 0.8, colors: [nat(pal[1], 0.5, 0.95), nat(pal[0], 0.5, 1), nat(pal[2], 0.5, 1.05)] });
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    // vesicles: gas bubble holes, elongated by flow
    worley(u, v, 18, seed + 8, c, 1);
    const r = 0.08 + c.id * 0.14;
    const hole = 1 - smooth(r * 0.7, r, c.f1);
    if (c.id > 0.55 && hole > 0) {
      s.mulCol(i, 1 - hole * 0.6);
      s.h[i] -= hole * 0.45;
    }
  });
  return { depth: 0.07 };
};

function sedimentary(s: Surface, pal: Pal, seed: number, o: { bands: number; wav: number; cross: number; fissile: number; rough: number; sat?: number }) {
  const cols = [nat(pal[1], o.sat ?? 0.75, 0.92), nat(pal[0], o.sat ?? 0.75, 1), nat(pal[2], o.sat ?? 0.75, 1.04)];
  strata(s, seed, o.bands, o.wav, (i, u, v, _b, inBand, id) => {
    const g = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    const m = fbm(u, v, 6, 3, seed + 2);
    // cross-bedding: inclined laminae inside each bed
    const lam = o.cross > 0 ? Math.sin((inBand * 9 + u * o.cross * (id > 0.5 ? 1 : -1) + (m - 0.5) * 0.8) * Math.PI * 2) * 0.5 + 0.5 : 0.5;
    // fissility: very thin partings that split the rock
    const fis = o.fissile > 0 ? smooth(0.82, 0.97, Math.abs(Math.sin((v + (m - 0.5) * 0.02) * o.fissile * Math.PI))) : 0;
    const bedEdge = smooth(0.0, 0.06, inBand) * smooth(0.0, 0.06, 1 - inBand);
    let col = mix(cols[0], cols[1], id);
    col = mix(col, cols[2], lam * 0.25 + (g > 0.8 ? 0.3 : 0));
    col = mul(col, 0.9 + (m - 0.5) * 0.2 - fis * 0.25 - (1 - bedEdge) * 0.12);
    s.setCol(i, col);
    s.h[i] = 0.55 + id * 0.25 + lam * 0.08 + g * 0.05 - fis * 0.2 - (1 - bedEdge) * 0.3 + (m - 0.5) * 0.15;
    s.r[i] = o.rough + (g - 0.5) * 0.1;
  });
}

const paintSandstone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 4, wav: 0.08, cross: 2.5, fissile: 0, rough: 0.9 });
  return { depth: 0.06 };
};
const paintShale: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 7, wav: 0.03, cross: 0, fissile: 26, rough: 0.7, sat: 0.6 });
  return { depth: 0.05 };
};
const paintMudstone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 3, wav: 0.05, cross: 0, fissile: 8, rough: 0.85 });
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    worley(u, v, 4, seed + 70, c, 1);
    const fr = 1 - smooth(0, 0.03, c.f2 - c.f1);
    if (fr > 0) {
      s.mulCol(i, 1 - fr * 0.35);
      s.h[i] -= fr * 0.3;
    }
  });
  return { depth: 0.06 };
};

const paintLimestone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 3, wav: 0.04, cross: 0, fissile: 0, rough: 0.75, sat: 0.6 });
  // stylolites: dark jagged seams
  s.each((u, v, i) => {
    const y = 0.37 + Math.abs(gnoise(u, 0.1, 40, seed + 5)) * 0.03 + (gnoise(u, 0.2, 6, seed + 6)) * 0.03;
    const d = Math.abs(v - y);
    if (d < 0.006) s.blend(i, hex(0x5a5448), 0.8 * (1 - d / 0.006));
    const pit = smooth(0.7, 0.8, fbm(u, v, 20, 2, seed + 7));
    if (pit > 0) {
      s.mulCol(i, 1 - pit * 0.25);
      s.h[i] -= pit * 0.2;
    }
  });
  // fossil shells: small ribbed discs & spirals
  const R = rng(seed + 11);
  const n = Math.max(3, Math.round(s.n / 20));
  for (let k = 0; k < n; k++) {
    const cu = R();
    const cv = R();
    const r = 0.02 + R() * 0.03;
    s.disk(cu, cv, r, (i, du, dv, d) => {
      const ang = Math.atan2(dv, du);
      const ribs = Math.sin(ang * 14) * 0.5 + 0.5;
      const spiral = Math.sin((d / r) * 10 + ang) * 0.5 + 0.5;
      const t = 1 - d / r;
      s.blend(i, mul(hex(0xe2dccb), 0.8 + ribs * 0.2), 0.6 * smooth(0, 0.2, t));
      s.h[i] += (ribs * 0.05 + spiral * 0.04) * t;
    });
  }
  return { depth: 0.05 };
};

const paintDolomite: Painter = (s, pal, seed) => {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const a = nat(pal[1], 0.7);
  const b = nat(pal[2], 0.7, 1.04);
  s.each((u, v, i) => {
    worley(u, v, s.n > 100 ? 40 : 20, seed, c, 1); // sugary rhombs
    const m = fbm(u, v, 4, 4, seed + 1);
    const vug = smooth(0.72, 0.8, fbm(u, v, 8, 3, seed + 2));
    s.setCol(i, mul(mix(a, b, c.id * 0.6 + m * 0.4), 0.9 + (c.f2 - c.f1) * 0.5 - vug * 0.45));
    s.h[i] = 0.5 + c.id * 0.1 + m * 0.2 - vug * 0.5 + (c.f2 - c.f1) * 0.3;
    s.r[i] = 0.72 - (c.id > 0.9 ? 0.3 : 0);
  });
  return { depth: 0.05 };
};

const paintSalt: Painter = (s, pal, seed) => {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    worley(u, v, 6, seed, c, 0.6);
    const edge = smooth(0, 0.05, c.f2 - c.f1);
    // cubic crystal faces: shade by cell & a fake facet direction
    const facet = Math.abs(c.dx) > Math.abs(c.dy) ? 0.95 : 1.05;
    const m = fbm(u, v, 5, 3, seed + 1);
    s.setCol(i, mul(mix(nat(pal[1], 0.9), nat(pal[2], 0.9, 1.03), c.id), (0.85 + edge * 0.15) * facet * (0.95 + m * 0.1)));
    s.h[i] = 0.4 + edge * 0.4 + c.id * 0.2;
    s.r[i] = 0.25 + (1 - edge) * 0.5;
  });
  return { depth: 0.04 };
};

const paintChalk: Painter = (s, pal, seed) => {
  rockField(s, seed, { cells: 3, crack: 0.02, grain: 0.2, mottle: 0.4, warp: 0.2, rough: 0.95, colors: [nat(pal[1], 0.4), nat(pal[0], 0.4), mul(nat(pal[0], 0.4), 1.03)] });
  // flint nodules
  const R = rng(seed + 4);
  for (let k = 0; k < 3; k++) {
    const cu = R();
    const cv = R();
    const r = 0.04 + R() * 0.05;
    s.disk(cu, cv, r, (i, du, dv, d) => {
      const t = 1 - d / r;
      const warp2 = gnoise(du * 10 + cu, dv * 10 + cv, 4, seed) * 0.3;
      if (t + warp2 < 0.15) return;
      s.blend(i, mul(hex(0x2e2b2a), 0.8 + t * 0.4), 0.95);
      s.h[i] += 0.1 * t;
      s.r[i] = 0.4;
    });
  }
  return { depth: 0.04 };
};

const paintCoal: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 6, wav: 0.03, cross: 0, fissile: 18, rough: 0.35, sat: 0.3 });
  // cleat: perpendicular fracture sets, glossy vitrain bands
  s.each((u, v, i) => {
    const cl = 1 - smooth(0.0, 0.015, Math.abs(Math.sin(u * 7 * Math.PI + gnoise(u, v, 4, seed) * 0.8)));
    if (cl > 0) {
      s.mulCol(i, 1 - cl * 0.5);
      s.h[i] -= cl * 0.3;
    }
    const gloss = smooth(0.55, 0.75, gnoise2(u, v, 2, 12, seed + 3) * 0.5 + 0.5);
    s.r[i] = lerp(s.r[i], 0.12, gloss);
    s.blend(i, hex(0x4a4a4e), gloss * 0.2);
  });
  return { depth: 0.04 };
};

function oily(s: Surface, seed: number, amount: number) {
  s.each((u, v, i) => {
    const o = smooth(0.4, 0.75, fbm(u, v, 4, 4, seed + 90)) * amount;
    if (o <= 0) return;
    s.blend(i, mul(s.getCol(i), 0.45), o);
    s.r[i] = lerp(s.r[i], 0.18, o);
  });
}

const paintOilSandstone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 4, wav: 0.08, cross: 2.5, fissile: 0, rough: 0.6 });
  oily(s, seed, 0.8);
  return { depth: 0.05 };
};
const paintOilLimestone: Painter = (s, pal, seed) => {
  paintLimestone(s, pal, seed);
  oily(s, seed, 0.6);
  return { depth: 0.05 };
};
const paintGasSandstone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 4, wav: 0.08, cross: 2.5, fissile: 0, rough: 0.9 });
  s.each((u, v, i) => s.blend(i, nat(pal[1], 0.6), smooth(0.55, 0.8, fbm(u, v, 5, 3, seed + 44)) * 0.45));
  return { depth: 0.06 };
};
const paintGasShale: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 7, wav: 0.03, cross: 0, fissile: 26, rough: 0.6, sat: 0.7 });
  return { depth: 0.05 };
};
const paintTightOilShale: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 8, wav: 0.03, cross: 0, fissile: 30, rough: 0.5, sat: 0.6 });
  oily(s, seed, 0.5);
  return { depth: 0.05 };
};
const paintBrineSandstone: Painter = (s, pal, seed) => {
  sedimentary(s, pal, seed, { bands: 4, wav: 0.08, cross: 2.5, fissile: 0, rough: 0.8 });
  s.each((u, v, i) => {
    const eff = smooth(0.7, 0.85, fbm(u, v, 8, 3, seed + 33)); // salt efflorescence
    s.blend(i, hex(0xe9e6de), eff * 0.7);
    s.h[i] += eff * 0.06;
    s.r[i] = lerp(s.r[i], 0.45, smooth(0.4, 0.6, fbm(u, v, 3, 3, seed + 34)));
  });
  return { depth: 0.06 };
};

const paintCaprock: Painter = (s, pal, seed) => {
  // anhydrite "chicken-wire": white nodules in thin dark mesh
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 3, 0.08, seed);
    worley(u + wu, v * 1.4 + wv, 7, seed + 1, c, 1);
    const mesh = 1 - smooth(0, 0.06, c.f2 - c.f1);
    const m = fbm(u, v, 12, 3, seed + 2);
    s.setCol(i, mul(mix(nat(pal[0], 0.5), mix(nat(pal[1], 0.5), hex(0x6a645c), 0.6), mesh), 0.92 + m * 0.1));
    s.h[i] = 0.6 + (1 - mesh) * Math.sqrt(Math.max(0, 1 - c.f1)) * 0.3 - mesh * 0.3;
    s.r[i] = 0.8;
  });
  return { depth: 0.05 };
};

const paintTerracotta: Painter = (s, pal, seed) => {
  const bandCols = [nat(pal[0], 0.7), nat(pal[1], 0.7), nat(pal[2], 0.7), hex(0xb89878), hex(0x8e6a50)];
  strata(s, seed, 5, 0.03, (i, u, v, b, inBand, id) => {
    const m = fbm(u, v, 5, 4, seed + 1);
    const g = gnoise(u, v, s.n / 2, seed + 2) * 0.5 + 0.5;
    const col = mix(bandCols[Math.floor(id * bandCols.length)], bandCols[(b + 5) % bandCols.length], smooth(0.8, 1, inBand) * 0.3);
    s.setCol(i, mul(col, 0.88 + m * 0.15 + (g - 0.5) * 0.08));
    s.h[i] = 0.5 + m * 0.3 + g * 0.05 - (1 - smooth(0, 0.05, inBand)) * 0.2;
    s.r[i] = 0.9;
  });
  return { depth: 0.04 };
};

function paintOreFn(flecks: RGB[], metallic: boolean): Painter {
  return (s, pal, seed) => {
    paintStone(s, pal, seed);
    const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
    s.each((u, v, i) => {
      worley(u, v, 5, seed + 20, c, 1);
      if (c.id < 0.55) return;
      const r = 0.25 + (c.id - 0.55) * 0.6;
      const [wu, wv] = warp(u, v, 8, 0.03, seed + 21);
      worley(u + wu, v + wv, 5, seed + 20, c, 1);
      const ore = 1 - smooth(r * 0.6, r, c.f1);
      if (ore <= 0) return;
      const g = gnoise(u, v, s.n / 3, seed + 22) * 0.5 + 0.5;
      s.blend(i, mul(flecks[g > 0.6 ? 1 : 0], 0.8 + g * 0.4), ore * 0.9);
      s.h[i] += ore * 0.12;
      if (metallic) s.r[i] = lerp(s.r[i], 0.3, ore * g);
    });
    return { depth: 0.07 };
  };
}

// ---- wood --------------------------------------------------------------------------------------------------

function bark(s: Surface, pal: Pal, seed: number, plates: number) {
  const dark = nat(pal[1], 0.6, 0.75);
  const mid = nat(pal[0], 0.6, 0.9);
  const light = mix(nat(pal[0], 0.5, 1), hex(0x8f8a80), 0.35);
  s.each((u, v, i) => {
    const wu = (fbm2(u, v, 2, 3, 3, seed) - 0.5) * 0.12;
    // vertical furrows: anisotropic noise, many cells across u, few along v
    let rr = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      const nn = 1 - Math.abs(gnoise2(u + wu, v, plates * (1 << o), 1 << o, seed + 1 + o));
      rr += nn * nn * amp;
      norm += amp;
      amp *= 0.5;
    }
    const r = rr / norm;
    const cross = gnoise2(u, v, plates, 6, seed + 2) * 0.5 + 0.5;
    const ridge = smooth(0.25, 0.8, r) * (0.75 + cross * 0.25);
    const g = fbm(u, v, 40, 2, seed + 3);
    const lichen = smooth(0.7, 0.8, fbm(u, v, 4, 4, seed + 4)) * ridge;
    let col = mix(dark, mid, ridge);
    col = mix(col, light, smooth(0.6, 1, ridge) * 0.4 * g);
    col = mix(col, hex(0x8a9a6a), lichen * 0.6);
    s.setCol(i, mul(col, 0.9 + (g - 0.5) * 0.2));
    s.h[i] = ridge * 0.85 + g * 0.1;
    s.r[i] = 0.85;
  });
}

const paintLogOak: Painter = (s, pal, seed) => {
  bark(s, pal, seed, 7);
  return { depth: 0.08 };
};
const paintLogPine: Painter = (s, pal, seed) => {
  bark(s, pal, seed, 5);
  // flaky plates
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  s.each((u, v, i) => {
    worley(u * 1, v * 0.6, 6, seed + 9, c, 1);
    const e = 1 - smooth(0, 0.05, c.f2 - c.f1);
    s.mulCol(i, 1 - e * 0.35);
    s.h[i] -= e * 0.25;
    s.blend(i, hex(0x8a5a38), (1 - e) * c.id * 0.25);
  });
  return { depth: 0.08 };
};
const paintBirchLog: Painter = (s, pal, seed) => {
  const white = hex(0xe6e2d8);
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 4, seed);
    const g = gnoise(u, v, 60, seed + 1) * 0.5 + 0.5;
    s.setCol(i, mul(mix(white, hex(0xcfc7b4), m * 0.6), 0.95 + g * 0.05));
    s.h[i] = 0.6 + m * 0.1;
    s.r[i] = 0.55;
  });
  // horizontal lenticels & black patches
  const R = rng(seed + 2);
  const n = Math.round(s.n * 0.12);
  for (let k = 0; k < n; k++) {
    const len = 0.05 + R() * 0.2;
    s.stroke(R(), R(), (R() - 0.5) * 0.08, len, 0.012 + R() * 0.01, 0.006, (i, _t, sv) => {
      s.blend(i, hex(0x2a2826), 0.85 * (1 - Math.abs(sv)));
      s.h[i] = Math.min(s.h[i], 0.45);
    });
  }
  for (let k = 0; k < 4; k++) {
    const cu = R();
    const cv = R();
    const r = 0.04 + R() * 0.06;
    s.disk(cu, cv, r, (i, du, dv, d) => {
      const t = 1 - d / r + gnoise(du * 8 + cu, dv * 8, 3, seed) * 0.4;
      if (t > 0.3) {
        s.blend(i, hex(0x2b2724), 0.9);
        s.h[i] = 0.35 + t * 0.1;
        s.r[i] = 0.8;
      }
    });
  }
  return { depth: 0.04 };
};

function endGrain(s: Surface, pal: Pal, seed: number, barkCol: RGB, heart: RGB) {
  const sap = nat(pal[2], 0.7, 0.95);
  s.each((u, v, i) => {
    const du = u - 0.5;
    const dv = v - 0.5;
    const [wu, wv] = warp(u, v, 3, 0.04, seed);
    const r = Math.sqrt((du + wu) ** 2 + (dv + wv) ** 2) * 2;
    const ring = Math.sin(r * 34 * Math.PI) * 0.5 + 0.5;
    const late = smooth(0.7, 0.95, ring);
    const ang = Math.atan2(dv, du);
    const check = 1 - smooth(0, 0.02, Math.abs(Math.sin(ang * 3 + seed)) * r); // radial checks
    let col = mix(sap, heart, smooth(0.35, 0.75, 1 - r));
    col = mul(col, 1 - late * 0.22);
    const edge = smooth(0.86, 0.94, Math.max(Math.abs(du), Math.abs(dv)) * 2);
    col = mix(col, barkCol, edge);
    col = mul(col, 1 - check * 0.5 * (r > 0.1 && r < 0.8 ? 1 : 0));
    s.setCol(i, col);
    s.h[i] = 0.6 - late * 0.06 - check * 0.3 * (r < 0.8 ? 1 : 0) + edge * 0.2;
    s.r[i] = 0.7;
  });
}

const paintLogTop = (barkHex: number, heartMix: number): Painter => (s, pal, seed) => {
  endGrain(s, pal, seed, nat(hex(barkHex), 0.6, 0.8), mix(nat(pal[2], 0.7, 0.85), nat(pal[0], 0.7), heartMix));
  return { depth: 0.03 };
};

const paintPlanks: Painter = (s, pal, seed) => {
  const boards = 4;
  const tones = [nat(pal[0], 0.75), nat(pal[1], 0.75), nat(pal[2], 0.75, 0.95)];
  s.each((u, v, i) => {
    const b = Math.floor(v * boards);
    const inB = v * boards - b;
    const id = hash01(b, 3, seed);
    const off = id * 3.7;
    const grain = fbm2(u + off, v, 1, 24, 4, seed + b); // long fibres along u
    const knotC = hash01(b, 5, seed);
    const kdx = (((u - knotC + 1.5) % 1) - 0.5) * 4;
    const kdy = (inB - 0.5) * 1.2;
    const kd = Math.sqrt(kdx * kdx + kdy * kdy);
    const knot = id > 0.6 ? 1 - smooth(0.05, 0.25, kd) : 0;
    const rings = Math.sin((grain * 8 + kd * (knot > 0 ? 18 : 0)) * Math.PI) * 0.5 + 0.5;
    let col = mix(tones[Math.floor(id * 3)], tones[(Math.floor(id * 3) + 1) % 3], grain * 0.5);
    col = mul(col, 0.85 + rings * 0.18 - knot * 0.35);
    const gap = 1 - smooth(0, 0.05, inB) * smooth(0, 0.05, 1 - inB);
    const endJoint = Math.abs(((u + id) % 1) - 0.02) < 0.006 && id > 0.3 ? 1 : 0; // butt joints
    const nail = [0.08, 0.92].some((nu) => Math.hypot((u - nu) * 1, (inB - 0.5) / boards) < 0.012) ? 1 : 0;
    col = mul(col, 1 - gap * 0.7 - endJoint * 0.6);
    if (nail) col = hex(0x3a3a3c);
    s.setCol(i, col);
    s.h[i] = 0.7 + rings * 0.04 + (grain - 0.5) * 0.08 - gap * 0.6 - endJoint * 0.4 + nail * 0.05 - (id - 0.5) * 0.06;
    s.r[i] = nail ? 0.4 : 0.7 - rings * 0.1;
  });
  return { depth: 0.04 };
};

// ---- foliage & plants (alpha) ---------------------------------------------------------------------------

function leaves(s: Surface, pal: Pal, seed: number, needle: boolean, cover = 0.72) {
  const greens = [nat(pal[0], 0.85, 0.9), nat(pal[1], 0.85, 0.85), nat(pal[2], 0.85, 0.95)];
  for (let i = 0; i < s.alpha.length; i++) {
    s.alpha[i] = 0;
    s.h[i] = 0;
    s.setCol(i, mul(greens[1], 0.5));
  }
  const R = rng(seed);
  const count = needle ? 1700 : 620;
  for (let k = 0; k < count; k++) {
    const cu = R();
    const cv = R();
    const ang = R() * Math.PI * 2;
    const len = needle ? 0.06 + R() * 0.05 : 0.05 + R() * 0.05;
    const wid = needle ? 0.008 : len * (0.45 + R() * 0.2);
    const col = mul(greens[Math.floor(R() * 3)], 0.75 + R() * 0.4);
    const top = R();
    const sun = 0.8 + R() * 0.4;
    s.stroke(cu, cv, ang, len, wid, needle ? wid * 0.6 : wid, (i, t, sv) => {
      // leaf outline: widest in the middle
      const prof = needle ? 1 : Math.sin(Math.PI * Math.min(1, t * 1.1));
      if (Math.abs(sv) > prof) return;
      const hh = 0.3 + top * 0.7 - Math.abs(sv) * 0.1;
      if (hh <= s.h[i] && s.alpha[i] > 0) return;
      s.h[i] = hh;
      s.alpha[i] = 1;
      const vein = !needle && Math.abs(sv) < 0.1 ? 1.15 : 1;
      s.setCol(i, mul(col, sun * vein * (0.85 + t * 0.2) * (sv > 0 ? 1.05 : 0.95)));
      s.r[i] = 0.55;
    }, needle ? 0 : (R() - 0.5) * 0.04);
  }
  // keep roughly the classic coverage: thin out where the layer density is highest
  void cover;
}

const paintLeaves = (needle: boolean): Painter => (s, pal, seed) => {
  leaves(s, pal, seed, needle);
  return { depth: 0.06, cavity: 0.8 };
};

function plant(s: Surface, seed: number, fn: (R: () => number) => void) {
  for (let i = 0; i < s.alpha.length; i++) {
    s.alpha[i] = 0;
    s.h[i] = 0;
  }
  fn(rng(seed));
}

/** Upward blade from the bottom edge (v = 1) with a curve. */
function blade(s: Surface, u0: number, len: number, w: number, lean: number, col: RGB, tip: RGB) {
  const ang = -Math.PI / 2 + lean;
  s.stroke(u0, 0.995, ang, len, w, w * 0.15, (i, t, sv) => {
    s.alpha[i] = 1;
    s.setCol(i, mul(mix(col, tip, t * t), 0.8 + t * 0.35 + (sv > 0 ? 0.08 : -0.04)));
    s.h[i] = Math.max(s.h[i], 0.5 + (1 - Math.abs(sv)) * 0.4);
    s.r[i] = 0.55;
  }, lean * 0.2);
}

const paintTallGrass: Painter = (s, pal, seed) => {
  const g = GRASS(pal);
  plant(s, seed, (R) => {
    for (let k = 0; k < 16; k++) blade(s, 0.08 + R() * 0.84, 0.45 + R() * 0.5, 0.035 + R() * 0.02, (R() - 0.5) * 0.7, g[Math.floor(R() * 4)], mix(g[0], hex(0xc2b46a), 0.4));
  });
  return { depth: 0.02, cavity: 0 };
};

const flower = (petal: number): Painter => (s, pal, seed) => {
  const stem = nat(pal[1], 0.8, 0.8);
  plant(s, seed, (R) => {
    blade(s, 0.5, 0.62, 0.035, (R() - 0.5) * 0.1, stem, stem);
    for (let k = 0; k < 3; k++) blade(s, 0.3 + R() * 0.4, 0.2 + R() * 0.2, 0.05, (R() - 0.5) * 1.4, stem, mul(stem, 1.1));
    const col = nat(pal[0], 0.9, 1);
    const cu = 0.5;
    const cv = 0.3;
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2 + R() * 0.3;
      s.stroke(cu, cv, a, 0.13, 0.08, 0.03, (i, t) => {
        s.alpha[i] = 1;
        s.setCol(i, mul(col, 0.8 + t * 0.35));
        s.h[i] = 0.8 - t * 0.2;
        s.r[i] = 0.5;
      });
    }
    s.disk(cu, cv, 0.045, (i, _du, _dv, d) => {
      s.alpha[i] = 1;
      s.setCol(i, mul(petal === 1 ? hex(0x3a2a14) : hex(0xd9a520), 0.8 + (1 - d / 0.045) * 0.3));
      s.h[i] = 0.95;
    });
  });
  return { depth: 0.02, cavity: 0 };
};

const paintDeadBush: Painter = (s, pal, seed) => {
  const col = nat(pal[0], 0.6, 0.9);
  plant(s, seed, (R) => {
    const branch = (u: number, v: number, ang: number, len: number, w: number, depth: number) => {
      s.stroke(u, v, ang, len, w, w * 0.6, (i) => {
        s.alpha[i] = 1;
        s.setCol(i, mul(col, 0.8 + R() * 0.3));
        s.h[i] = 0.6;
        s.r[i] = 0.8;
      });
      if (depth > 0) {
        const eu = u + Math.cos(ang) * len;
        const ev = v + Math.sin(ang) * len;
        branch(eu, ev, ang - 0.5 - R() * 0.3, len * 0.65, w * 0.7, depth - 1);
        branch(eu, ev, ang + 0.5 + R() * 0.3, len * 0.65, w * 0.7, depth - 1);
      }
    };
    branch(0.5, 0.99, -Math.PI / 2, 0.3, 0.03, 3);
  });
  return { depth: 0.02, cavity: 0 };
};

const paintReeds: Painter = (s, pal, seed) => {
  const g = [nat(pal[0], 0.8, 0.85), nat(pal[1], 0.8, 0.85)];
  plant(s, seed, (R) => {
    for (let k = 0; k < 9; k++) {
      const u0 = 0.1 + R() * 0.8;
      blade(s, u0, 0.7 + R() * 0.28, 0.03, (R() - 0.5) * 0.15, g[k % 2], mix(g[0], hex(0xb8a060), 0.3));
      if (k % 3 === 0) {
        const cv = 0.12 + R() * 0.1;
        s.disk(u0, cv, 0.03, (i) => {
          s.alpha[i] = 1;
          s.setCol(i, hex(0x5a3a1e));
          s.h[i] = 0.9;
        });
        s.stroke(u0, cv - 0.02, -Math.PI / 2, 0.12, 0.045, 0.04, (i) => {
          s.alpha[i] = 1;
          s.setCol(i, mul(hex(0x5e3d20), 0.9 + R() * 0.2));
          s.h[i] = 0.95;
        });
      }
    }
  });
  return { depth: 0.02, cavity: 0 };
};

const paintSeagrass: Painter = (s, pal, seed) => {
  const g = [nat(pal[0], 0.8), nat(pal[1], 0.8)];
  plant(s, seed, (R) => {
    for (let k = 0; k < 10; k++) blade(s, 0.1 + R() * 0.8, 0.5 + R() * 0.45, 0.05, (R() - 0.5) * 0.9, g[k % 2], mix(g[0], hex(0x9aa860), 0.3));
  });
  return { depth: 0.02, cavity: 0 };
};

const paintKelp: Painter = (s, pal, seed) => {
  const g = [nat(pal[0], 0.8, 0.8), nat(pal[1], 0.8, 0.8)];
  plant(s, seed, (R) => {
    for (let k = 0; k < 3; k++) {
      const u0 = 0.25 + k * 0.25;
      s.stroke(u0, 0.999, -Math.PI / 2, 1, 0.07, 0.07, (i, t, sv) => {
        const wav = Math.sin(t * 12 + k) * 0.35;
        if (Math.abs(sv - wav) > 0.9) return;
        s.alpha[i] = 1;
        s.setCol(i, mul(g[k % 2], 0.75 + Math.abs(Math.sin(t * 20)) * 0.3));
        s.h[i] = 0.6;
        s.r[i] = 0.35;
      });
      for (let b = 0; b < 3; b++) {
        s.disk(u0 + (R() - 0.5) * 0.06, 0.2 + b * 0.25 + R() * 0.1, 0.03, (i, _a, _b, d) => {
          s.alpha[i] = 1;
          s.setCol(i, mul(hex(0x8a8a3a), 0.8 + (1 - d / 0.03) * 0.4));
          s.h[i] = 0.9;
          s.r[i] = 0.25;
        });
      }
    }
  });
  return { depth: 0.02, cavity: 0 };
};

const paintCactus: Painter = (s, pal, seed) => {
  const a = nat(pal[1], 0.75, 0.9);
  const b = nat(pal[2], 0.75, 1);
  s.each((u, v, i) => {
    const rib = Math.cos(u * Math.PI * 2 * 4) * 0.5 + 0.5;
    const m = fbm(u, v, 3, 4, seed);
    s.setCol(i, mul(mix(a, b, rib * 0.7 + m * 0.3), 0.85 + rib * 0.25));
    s.h[i] = rib * 0.8 + m * 0.1;
    s.r[i] = 0.45;
  });
  // areoles with spines along the ridges
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 6; k++) {
      const cu = (r + 0.5) / 4 - 0.125 + 0.125;
      const cv = (k + 0.5 + (r % 2) * 0.5) / 6;
      s.disk(cu, cv, 0.018, (i) => {
        s.setCol(i, hex(0xd8d0b0));
        s.h[i] = 1;
        s.r[i] = 0.8;
      });
    }
  return { depth: 0.05 };
};

const paintCactusTop: Painter = (s, pal, seed) => {
  const a = nat(pal[1], 0.75, 0.9);
  const b = nat(pal[2], 0.75, 1);
  s.each((u, v, i) => {
    const du = u - 0.5;
    const dv = v - 0.5;
    const ang = Math.atan2(dv, du);
    const r = Math.sqrt(du * du + dv * dv) * 2;
    const rib = Math.cos(ang * 8) * 0.5 + 0.5;
    const m = fbm(u, v, 3, 3, seed);
    s.setCol(i, mul(mix(a, b, rib * 0.6 + m * 0.2), 0.8 + (1 - r) * 0.25 + rib * 0.15));
    s.h[i] = rib * 0.4 + (1 - r) * 0.4;
    s.r[i] = 0.45;
  });
  return { depth: 0.05 };
};

const paintCoral: Painter = (s, pal, seed) => {
  const c: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const cols = [nat(pal[0], 0.8), nat(pal[1], 0.8), nat(pal[2], 0.8)];
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 3, 0.12, seed);
    worley(u + wu, v + wv, 8, seed + 1, c, 1);
    const bump = Math.sqrt(Math.max(0, 1 - c.f1 * 1.4));
    const polyp = 1 - smooth(0.04, 0.09, c.f1);
    const m = fbm(u, v, 4, 3, seed + 2);
    s.setCol(i, mul(mix(cols[Math.floor(m * 2.99)], cols[2], 0.2), 0.7 + bump * 0.35 - polyp * 0.4));
    s.h[i] = bump * 0.8 - polyp * 0.5;
    s.r[i] = 0.7;
  });
  return { depth: 0.08 };
};

// ---- industrial ----------------------------------------------------------------------------------------------

function concreteField(s: Surface, pal: Pal, seed: number, stains: number, aggregate: number) {
  const a = nat(pal[1], 0.3, 0.95);
  const b = nat(pal[0], 0.3, 1);
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 5, seed);
    const g = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    const pore = smooth(0.9, 0.97, gnoise(u, v, s.n / 3, seed + 2) * 0.5 + 0.5);
    const stain = smooth(0.55, 0.8, fbm(u, v, 2, 4, seed + 3)) * stains;
    const drip = smooth(0.7, 0.95, fbm2(u, v, 10, 1, 3, seed + 4)) * smooth(0.2, 1, v) * stains;
    let col = mix(a, b, m);
    col = mul(col, 0.94 + (g - 0.5) * 0.1 - pore * 0.35);
    col = mix(col, hex(0x5a5448), stain * 0.35);
    col = mix(col, hex(0x6b5038), drip * 0.25);
    s.setCol(i, col);
    s.h[i] = 0.6 + m * 0.08 + g * 0.05 - pore * 0.3;
    s.r[i] = 0.82 - stain * 0.15;
  });
  if (aggregate > 0) {
    const R = rng(seed + 6);
    const cnt = Math.round(s.n * aggregate);
    for (let k = 0; k < cnt; k++) {
      const cu = R();
      const cv = R();
      const r = 0.004 + R() * R() * 0.018;
      const col = mul([hex(0x8a8580), hex(0x6b6660), hex(0xa09a90), hex(0x7a6a5a)][Math.floor(R() * 4)], 0.9 + R() * 0.2);
      s.disk(cu, cv, r, (i, _du, _dv, d) => {
        s.blend(i, col, 0.8);
        s.h[i] += (1 - d / r) * 0.08;
      });
    }
  }
}

const paintConcrete: Painter = (s, pal, seed) => {
  concreteField(s, pal, seed, 1, 0.25);
  // formwork tie holes
  for (const [cu, cv] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const)
    s.disk(cu, cv, 0.018, (i, _a, _b, d) => {
      s.mulCol(i, 0.55 + (d / 0.018) * 0.3);
      s.h[i] -= 0.3 * (1 - d / 0.018);
    });
  return { depth: 0.02 };
};

const paintConcretePad: Painter = (s, pal, seed) => {
  concreteField(s, pal, seed, 1.3, 0.6);
  // saw-cut joints along two edges + a hairline crack
  s.each((u, v, i) => {
    const j = Math.min(u, v);
    if (j < 0.012) {
      s.mulCol(i, 0.45);
      s.h[i] = 0.2;
    }
    const cr = Math.abs(v - 0.62 + u * 0.25 - (fbm(u, 0.3, 16, 4, seed + 9) - 0.5) * 0.08);
    if (cr < 0.0025 && u > 0.3 && u < 0.8) {
      s.mulCol(i, 0.55);
      s.h[i] -= 0.25;
    }
  });
  return { depth: 0.03 };
};

const paintAsphalt: Painter = (s, pal, seed) => {
  const a = nat(pal[1], 0.3, 1);
  const b = nat(pal[0], 0.3, 1.05);
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 5, seed);
    const g = gnoise(u, v, s.n / 2, seed + 1) * 0.5 + 0.5;
    const stone = smooth(0.78, 0.9, gnoise(u, v, s.n / 3, seed + 2) * 0.5 + 0.5);
    const crack = smooth(0.93, 0.97, ridged(u, v, 3, 4, seed + 3));
    let col = mix(a, b, m);
    col = mix(col, hex(0x6b6863), stone * 0.6);
    col = mul(col, 0.95 + (g - 0.5) * 0.15 - crack * 0.5);
    s.setCol(i, col);
    s.h[i] = 0.5 + stone * 0.25 + g * 0.1 - crack * 0.4;
    s.r[i] = 0.9 - stone * 0.25;
  });
  // worn centre line (dashed along v)
  const line = nat(pal[2], 0.7, 0.95);
  s.each((u, v, i) => {
    if (Math.abs(u - 0.5) > 0.035 || v > 0.62) return;
    const wear = fbm(u, v, 16, 3, seed + 5);
    if (wear < 0.35) return;
    s.blend(i, line, smooth(0.35, 0.55, wear) * 0.9);
    s.h[i] += 0.05;
    s.r[i] = 0.6;
  });
  return { depth: 0.03 };
};

/** Paint layer with chips revealing base metal / primer, plus rust bleeding from edges & rivets. */
function wornPaint(s: Surface, seed: number, paint: RGB, amount: number, rustAmt: number, rivets: [number, number][]) {
  const metal = hex(0x6f7377);
  const rust = hex(0x7a4424);
  s.each((u, v, i) => {
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const wearN = fbm(u, v, 6, 4, seed + 1);
    const chip = smooth(0.62, 0.66, wearN + (0.05 - Math.min(0.05, edge)) * 3 * amount) * amount;
    const scratch = smooth(0.985, 1, Math.abs(Math.sin((u * 0.8 + v * 0.3) * 90 + gnoise(u, v, 3, seed) * 6))) * amount * 0.6;
    const rustN = smooth(0.55, 0.8, fbm(u, v, 5, 4, seed + 2) + (0.04 - Math.min(0.04, edge)) * 6) * rustAmt;
    const streak = smooth(0.7, 0.95, fbm2(u, v, 14, 1, 2, seed + 3)) * rustAmt * smooth(0.3, 1, v) * 0.6;
    const g = gnoise(u, v, s.n / 2, seed + 4) * 0.5 + 0.5;
    let col = mul(paint, 0.95 + (g - 0.5) * 0.06);
    col = mix(col, metal, Math.max(chip, scratch));
    col = mix(col, mul(rust, 0.8 + g * 0.4), Math.max(rustN, streak));
    s.setCol(i, col);
    s.h[i] = 0.6 - chip * 0.08 - scratch * 0.05 + rustN * 0.06 * g;
    s.r[i] = lerp(lerp(0.45, 0.3, Math.max(chip, scratch)), 0.9, Math.max(rustN, streak));
  });
  for (const [cu, cv] of rivets) {
    const r = 0.022;
    s.disk(cu, cv, r * 2, (i, du, dv, d) => {
      if (d < r) {
        const dome = Math.sqrt(1 - (d / r) ** 2);
        s.h[i] = 0.6 + dome * 0.35;
        s.setCol(i, mul(mix(paint, metal, 0.3), 0.8 + dome * 0.3 - (du + dv) * 4));
        s.r[i] = 0.4;
      } else s.blend(i, rust, (1 - (d - r) / r) * rustAmt * 0.6);
    });
  }
}

const paintSteelPlate: Painter = (s, pal, seed) => {
  const rivets: [number, number][] = [];
  for (let k = 0; k < 4; k++) {
    rivets.push([0.06, 0.12 + k * 0.25], [0.94, 0.12 + k * 0.25]);
  }
  wornPaint(s, seed, nat(pal[0], 0.5, 0.95), 0.9, 0.5, rivets);
  // diamond tread in the field
  s.each((u, v, i) => {
    if (u < 0.1 || u > 0.9) return;
    const a = ((u * 10 + v * 10) % 1) - 0.5;
    const b = ((u * 10 - v * 10 + 10) % 1) - 0.5;
    const cellu = Math.floor(u * 10 + v * 10) + Math.floor(u * 10 - v * 10 + 10);
    const lozenge = cellu % 2 === 0 ? 1 - smooth(0.12, 0.2, Math.abs(a) + Math.abs(b) * 0.3) : 0;
    s.h[i] += lozenge * 0.25;
    if (lozenge > 0) s.mulCol(i, 1 + lozenge * 0.08);
  });
  s.each((u, v, i) => {
    if (Math.min(u, v, 1 - u, 1 - v) < 0.012) {
      s.mulCol(i, 0.6);
      s.h[i] = 0.3;
    }
  });
  return { depth: 0.015, cavity: 0.4 };
};

const paintSteelGrate: Painter = (s, pal, seed) => {
  const galv = nat(pal[0], 0.3, 1.1);
  s.each((u, v, i) => {
    const bars = 6;
    const bu = Math.abs(((u * bars) % 1) - 0.5);
    const bv = Math.abs(((v * bars * 2) % 1) - 0.5);
    const bearing = bu > 0.4; // bearing bars along v
    const cross = bv > 0.43; // twisted cross rods
    const frame = Math.min(u, v, 1 - u, 1 - v) < 0.03;
    const solid = bearing || cross || frame;
    const g = fbm(u, v, 8, 3, seed);
    s.alpha[i] = solid ? 1 : 0;
    s.setCol(i, mul(mix(galv, hex(0x6a5a48), smooth(0.6, 0.9, g) * 0.6), 0.8 + (bearing ? (bu - 0.4) * 2 : 0.1) + g * 0.1));
    s.h[i] = frame ? 0.9 : bearing ? 0.8 : cross ? 0.65 : 0;
    s.r[i] = 0.45 + g * 0.3;
  });
  return { depth: 0.05, cavity: 0.3 };
};

const paintBrick: Painter = (s, pal, seed) => {
  const rows = 4;
  const cols = 2;
  const mortar = mix(nat(pal[2], 0.4, 0.95), hex(0x9a948a), 0.3);
  s.each((u, v, i) => {
    const r = Math.floor(v * rows);
    const off = r % 2 ? 0.5 / cols : 0;
    const uu = u * cols + off * cols;
    const c = Math.floor(uu);
    const bx = uu - c;
    const by = v * rows - r;
    const id = hash01(((c % cols) + cols) % cols, r, seed);
    const [wu, wv] = warp(u, v, 8, 0.01, seed + 3);
    const ex = Math.min(bx + wu * 8, 1 - bx - wu * 8) / cols;
    const ey = Math.min(by + wv * 8, 1 - by - wv * 8) / rows;
    const e = Math.min(ex * 2.2, ey * 1.2);
    const inMortar = 1 - smooth(0.006, 0.014, e);
    const chip = smooth(0.7, 0.75, fbm(u, v, 12, 3, seed + 4)) * (1 - smooth(0.01, 0.03, e));
    const g = gnoise(u, v, s.n / 2, seed + 5) * 0.5 + 0.5;
    const m = fbm(u, v, 6, 4, seed + 6);
    let brick = mix(nat(pal[0], 0.7, 0.95), nat(pal[1], 0.7, 0.95), id);
    brick = mix(brick, hex(0x3a2420), smooth(0.8, 1, id) * 0.4); // over-fired brick
    brick = mul(brick, 0.85 + m * 0.2 + (g - 0.5) * 0.12);
    brick = mix(brick, hex(0xd8d2c4), smooth(0.7, 0.9, fbm(u, v, 4, 3, seed + 8)) * 0.18); // efflorescence
    const mcol = mul(mortar, 0.85 + g * 0.2);
    s.setCol(i, mix(mul(brick, 1 - chip * 0.3), mcol, inMortar));
    s.h[i] = lerp(0.75 + m * 0.1 + g * 0.04 - chip * 0.25, 0.25 + g * 0.1, inMortar);
    s.r[i] = inMortar > 0.5 ? 0.95 : 0.85;
  });
  return { depth: 0.035 };
};

const paintGlass: Painter = (s, _pal, seed) => {
  s.each((u, v, i) => {
    const frame = Math.min(u, v, 1 - u, 1 - v) < 0.045;
    const smudge = fbm(u, v, 4, 4, seed);
    const streak = smooth(0.6, 0.9, Math.sin((u + v) * 12 + smudge * 4) * 0.5 + 0.5);
    if (frame) {
      s.setCol(i, mul(hex(0x8e969c), 0.9 + smudge * 0.2));
      s.alpha[i] = 1;
      s.h[i] = 1;
      s.r[i] = 0.4;
    } else {
      s.setCol(i, mix(hex(0xcfe6ef), hex(0xffffff), streak * 0.4));
      s.alpha[i] = 0.12 + smooth(0.6, 0.85, smudge) * 0.12 + streak * 0.06;
      s.h[i] = 0.5;
      s.r[i] = 0.05 + smooth(0.6, 0.85, smudge) * 0.25;
    }
  });
  return { depth: 0.01, cavity: 0 };
};

const paintHazard: Painter = (s, pal, seed) => {
  const y = nat(pal[0], 0.85, 0.95);
  const k = mul(pal[1], 0.9);
  s.each((u, v, i) => {
    const d = ((u + v) * 2.5) % 1;
    const col = d < 0.5 ? y : k;
    s.setCol(i, col);
  });
  wornPaintOver(s, seed);
  return { depth: 0.012, cavity: 0.3 };
};

/** Scuffs, chips and grime over whatever is painted already. */
function wornPaintOver(s: Surface, seed: number) {
  s.each((u, v, i) => {
    const wearN = fbm(u, v, 5, 5, seed + 1);
    const chip = smooth(0.66, 0.7, wearN);
    const grime = smooth(0.45, 0.85, fbm(u, v, 3, 4, seed + 2)) * 0.3;
    const g = gnoise(u, v, s.n / 2, seed + 3) * 0.5 + 0.5;
    s.blend(i, hex(0x5d5f60), chip);
    s.blend(i, hex(0x3a3228), grime);
    s.mulCol(i, 0.95 + (g - 0.5) * 0.08);
    s.h[i] = 0.6 - chip * 0.1;
    s.r[i] = lerp(0.5, 0.35, chip) + grime * 0.2;
  });
}

const paintLamp: Painter = (s, pal, seed) => {
  const frame = nat(pal[2], 0.4, 1);
  s.each((u, v, i) => {
    const e = Math.min(u, v, 1 - u, 1 - v);
    const g = fbm(u, v, 12, 2, seed);
    if (e < 0.12) {
      const bevel = smooth(0.08, 0.12, e);
      s.setCol(i, mul(frame, 0.75 + g * 0.2 + bevel * 0.1));
      s.h[i] = 0.7 + (1 - bevel) * 0.2;
      s.r[i] = 0.5;
      return;
    }
    // frosted diffuser behind a wire guard
    const guard = Math.abs(((u * 4) % 1) - 0.5) > 0.46 || Math.abs(((v * 4) % 1) - 0.5) > 0.46;
    const glow = 1 - Math.hypot(u - 0.5, v - 0.5) * 0.9;
    s.setCol(i, guard ? mul(frame, 0.6) : mix(nat(pal[1], 0.9), nat(pal[0], 0.9, 1.05), glow));
    s.h[i] = guard ? 0.95 : 0.4 + g * 0.05;
    s.r[i] = guard ? 0.4 : 0.2;
  });
  return { depth: 0.03, cavity: 0.3 };
};

const paintContainerSide: Painter = (s, pal, seed) => {
  const paint = nat(pal[0], 0.7, 0.9);
  wornPaint(s, seed, paint, 0.5, 0.7, []);
  s.each((u, v, i) => {
    // trapezoidal corrugation
    const p = (u * 5) % 1;
    const prof = smooth(0.1, 0.25, p) * (1 - smooth(0.6, 0.75, p));
    const rail = v < 0.08 || v > 0.92;
    s.h[i] = rail ? 0.9 : 0.35 + prof * 0.5 + (s.h[i] - 0.6);
    const face = p > 0.1 && p < 0.25 ? 0.85 : p > 0.6 && p < 0.75 ? 1.08 : 1;
    s.mulCol(i, rail ? 0.8 : face);
  });
  return { depth: 0.06, cavity: 0.5 };
};

const paintContainerTop: Painter = (s, pal, seed) => {
  wornPaint(s, seed, nat(pal[2], 0.4, 0.9), 0.4, 0.8, []);
  s.each((u, v, i) => {
    const p = (v * 6) % 1;
    const prof = Math.sin(p * Math.PI * 2) * 0.5 + 0.5;
    s.h[i] = 0.4 + prof * 0.3 + (s.h[i] - 0.6);
  });
  return { depth: 0.03 };
};

function pipeSkin(s: Surface, seed: number, body: RGB, band: RGB, chevron: RGB | null, bare = false) {
  if (bare) {
    s.each((u, v, i) => {
      const brushed = fbm2(u, v, 40, 1, 3, seed);
      s.setCol(i, mul(body, 0.85 + brushed * 0.25));
      s.h[i] = 0.6 + brushed * 0.05;
      s.r[i] = 0.35 + brushed * 0.1;
    });
  } else wornPaint(s, seed, body, 0.35, 0.35, []);
  s.each((u, v, i) => {
    // colour band around the pipe with a weld seam next to it
    if (Math.abs(u - 0.5) < 0.09) {
      s.setCol(i, mul(band, 0.9 + (fbm(u, v, 12, 2, seed + 7) - 0.5) * 0.1));
      s.r[i] = 0.45;
    }
    const seam = Math.abs(u - 0.2);
    if (seam < 0.012) {
      s.h[i] = 0.75 + (1 - seam / 0.012) * 0.2;
      s.mulCol(i, 0.85);
    }
  });
  if (chevron) {
    for (const cv of [0.2, 0.7])
      s.each((u, v, i) => {
        const du = Math.abs(u - 0.5);
        const dv = v - cv;
        if (du < 0.06 && dv > -0.04 && dv < 0.04 && Math.abs(dv - du * 0.5) < 0.012) s.setCol(i, chevron);
      });
  }
}

const pipe = (chev: 'black' | 'body' | 'dark'): Painter => (s, pal, seed) => {
  const body = nat(pal[0], 0.8, 0.95);
  pipeSkin(s, seed, body, nat(pal[2], 0.8, 0.95), chev === 'black' ? hex(0x111111) : chev === 'body' ? body : nat(pal[1], 0.8));
  return { depth: 0.01, cavity: 0.3 };
};

const paintCasing: Painter = (s, pal, seed) => {
  pipeSkin(s, seed, nat(pal[0], 0.4, 0.95), nat(pal[1], 0.4, 0.9), null, true);
  s.each((u, v, i) => {
    if (u < 0.2) {
      // threaded collar
      const th = Math.sin(v * 80 * Math.PI) * 0.5 + 0.5;
      s.h[i] = 0.8 + th * 0.15;
      s.mulCol(i, 0.85 + th * 0.15);
    }
    const mud = smooth(0.6, 0.8, fbm(u, v, 4, 3, seed + 3));
    s.blend(i, hex(0x6a4a2a), mud * 0.5);
    s.r[i] = lerp(s.r[i], 0.8, mud);
  });
  return { depth: 0.015, cavity: 0.4 };
};

const paintOilPool: Painter = (s, pal, seed) => {
  s.each((u, v, i) => {
    const m = fbm(u, v, 3, 5, seed);
    const sheen = fbm(u, v, 2, 4, seed + 1);
    let col = mix(mul(pal[0], 1), mul(pal[1], 1), m * 0.6);
    const hue = sheen * 12;
    const irid: RGB = [0.35 + 0.25 * Math.sin(hue), 0.3 + 0.25 * Math.sin(hue + 2.1), 0.35 + 0.25 * Math.sin(hue + 4.2)];
    col = mix(col, irid, smooth(0.55, 0.75, sheen) * 0.3);
    s.setCol(i, col);
    s.h[i] = 0.5 + m * 0.05;
    s.r[i] = 0.05;
  });
  return { depth: 0.005, cavity: 0 };
};

const paintWater: Painter = (s, pal, seed) => {
  s.each((u, v, i) => {
    const w = fbm(u, v, 3, 5, seed);
    const r = ridged(u, v, 4, 3, seed + 1);
    s.setCol(i, mix(mul(pal[0], 0.9), pal[1] ?? pal[0], w));
    s.alpha[i] = 0.75;
    s.h[i] = w * 0.6 + r * 0.4;
    s.r[i] = 0.02;
  });
  return { depth: 0.02, cavity: 0 };
};

const paintFire: Painter = (s, pal, seed) => {
  s.each((u, v, i) => {
    const [wu, wv] = warp(u, v, 3, 0.2, seed);
    const f = fbm2(u + wu, v + wv, 4, 2, 5, seed + 1);
    const heat = f * 1.2 - (1 - v) * 0.9 + 0.35;
    const a = smooth(0.25, 0.4, heat);
    const col = heat > 0.85 ? mix(pal[0], pal[2], smooth(0.85, 1.1, heat)) : mix(pal[1], pal[0], smooth(0.3, 0.85, heat));
    s.setCol(i, col);
    s.alpha[i] = a;
    s.h[i] = heat;
    s.r[i] = 1;
  });
  return { depth: 0.0, cavity: 0 };
};

const paintMissing: Painter = (s) => {
  s.each((u, v, i) => {
    const c = (Math.floor(u * 4) + Math.floor(v * 4)) % 2;
    s.setCol(i, c ? hex(0xd41ad4) : hex(0x101010));
  });
  return { depth: 0 };
};

/** Break-progress cracks: dark branching fissures growing with the stage (alpha = crack). */
function paintCrack(s: Surface, stage: number) {
  for (let i = 0; i < s.alpha.length; i++) {
    s.alpha[i] = 0;
    s.setCol(i, [0.16, 0.13, 0.11]);
    s.h[i] = 0.5;
  }
  const R = rng(4242);
  const budget = (stage + 1) / 10;
  const walk = (u: number, v: number, ang: number, len: number, w: number, depth: number, t0: number) => {
    if (t0 > budget) return;
    const steps = 24;
    let cu = u;
    let cv = v;
    let a = ang;
    for (let k = 0; k < steps; k++) {
      const t = t0 + (k / steps) * 0.35;
      if (t > budget) return;
      a += (R() - 0.5) * 0.7;
      const du = Math.cos(a) * (len / steps);
      const dv = Math.sin(a) * (len / steps);
      s.stroke(cu, cv, a, len / steps, w, w, (i, _tt, sv) => {
        const k2 = 1 - Math.abs(sv);
        if (k2 > s.alpha[i]) {
          s.alpha[i] = Math.min(1, k2 * 1.3);
          s.h[i] = 0.5 - k2 * 0.5;
        }
      });
      cu += du;
      cv += dv;
      if (depth < 3 && R() < 0.12) walk(cu, cv, a + (R() < 0.5 ? 0.9 : -0.9), len * 0.55, w * 0.7, depth + 1, t);
    }
  };
  for (let k = 0; k < 4; k++) walk(0.5, 0.5, (k / 4) * Math.PI * 2 + R(), 0.45, 0.018, 0, 0);
}

// ---- registry --------------------------------------------------------------------------------------------

const PAINTERS: Record<string, Painter> = {
  missing: paintMissing,
  bedrock: paintBedrock,
  stone: paintStone,
  dirt: paintDirt,
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  sand: paintSand,
  gravel: paintGravel,
  clay: paintClay,
  water: paintWater,
  snow: paintSnow,
  snow_side: paintSnowSide,
  ice: paintIce,
  sandstone: paintSandstone,
  shale: paintShale,
  limestone: paintLimestone,
  dolomite: paintDolomite,
  salt: paintSalt,
  granite: paintGranite,
  basalt: paintBasalt,
  chalk: paintChalk,
  coal_seam: paintCoal,
  mudstone: paintMudstone,
  oil_sandstone: paintOilSandstone,
  oil_limestone: paintOilLimestone,
  gas_sandstone: paintGasSandstone,
  gas_shale: paintGasShale,
  tight_oil_shale: paintTightOilShale,
  brine_sandstone: paintBrineSandstone,
  caprock: paintCaprock,
  log_oak: paintLogOak,
  log_oak_top: paintLogTop(0x4a3524, 0.5),
  leaves_oak: paintLeaves(false),
  log_pine: paintLogPine,
  log_pine_top: paintLogTop(0x3a2616, 0.3),
  leaves_pine: paintLeaves(true),
  tall_grass: paintTallGrass,
  flower_red: flower(1),
  flower_yellow: flower(2),
  cactus: paintCactus,
  cactus_top: paintCactusTop,
  dead_bush: paintDeadBush,
  red_sand: paintRedSand,
  terracotta: paintTerracotta,
  podzol_top: paintPodzolTop,
  podzol_side: paintPodzolSide,
  mud: paintMud,
  reeds: paintReeds,
  seagrass: paintSeagrass,
  mossy_stone: paintMossyStone,
  concrete: paintConcrete,
  concrete_pad: paintConcretePad,
  asphalt: paintAsphalt,
  steel_plate: paintSteelPlate,
  steel_grate: paintSteelGrate,
  brick: paintBrick,
  glass: paintGlass,
  planks: paintPlanks,
  hazard_stripe: paintHazard,
  lamp: paintLamp,
  gravel_pad: paintGravelPad,
  container_top: paintContainerTop,
  container_red: paintContainerSide,
  container_blue: paintContainerSide,
  pipe_oil: pipe('black'),
  pipe_gas: pipe('body'),
  pipe_water: pipe('dark'),
  pipe_product: pipe('dark'),
  casing: paintCasing,
  oil_pool: paintOilPool,
  scorched_earth: paintScorched,
  ash: paintAsh,
  fire: paintFire,
  ore_iron: paintOreFn([hex(0x9a6a48), hex(0xd8b08c)], false),
  ore_copper: paintOreFn([hex(0x2f8a74), hex(0xc8743a)], true),
  leaves_autumn: paintLeaves(false),
  birch_log: paintBirchLog,
  birch_log_top: paintLogTop(0xd8d2c4, 0.2),
  birch_leaves: paintLeaves(false),
  seabed_silt: paintSilt,
  coral: paintCoral,
  kelp: paintKelp,
  permafrost: paintPermafrost,
};

/** Paint one HD layer at `size`² and pack it (albedo + material). */
export function paintHDLayer(key: string, palette: number[], size: number, seed: number): PackedLayer {
  const s = new Surface(size);
  if (key.startsWith('crack_')) {
    paintCrack(s, Number(key.slice(6)));
    return s.finish({ depth: 0.01, cavity: 0 });
  }
  const pal: Pal = (palette.length ? palette : [0x808080]).map(hex);
  while (pal.length < 3) pal.push(pal[pal.length - 1]);
  const painter = PAINTERS[key] ?? paintStone;
  const res = painter(s, pal, seed);
  return s.finish({ depth: res.depth, cavity: res.cavity });
}

/** Whether a dedicated painter exists (others fall back to the stone material). */
export const hasHDPainter = (key: string) => key.startsWith('crack_') || key in PAINTERS;
