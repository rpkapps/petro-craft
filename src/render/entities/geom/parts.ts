// Reusable industrial sub-assemblies built from Builder primitives: lattice masts, stairs, ladders,
// railings, tanks, vessels, columns, pipe racks, sheds with windows, skids, fin-fan coolers, stacks.
import type { Builder, V3 } from './Builder';
import { C } from '../palette';

/** Small deterministic PRNG for procedural variety inside templates. */
export function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MastOpts {
  x: number;
  z: number;
  y0: number;
  y1: number;
  /** Half widths at base and top. */
  hw0: number;
  hw1: number;
  panel?: number;
  leg?: number;
  brace?: number;
  color: number;
  braceColor?: number;
  /** Side left open in the lowest panels (V-door): '+x' | '-x' | '+z' | '-z'. */
  openSide?: string;
  openPanels?: number;
  /** Depth of the mast in z if different from x (rectangular towers). */
  hd0?: number;
  hd1?: number;
}

/** Tapered 4-legged lattice tower with X bracing and girts (derricks, flare towers, antenna masts). */
export function latticeMast(b: Builder, o: MastOpts): void {
  const panel = o.panel ?? 1.4;
  const leg = o.leg ?? 0.14;
  const brace = o.brace ?? 0.055;
  const bc = o.braceColor ?? o.color;
  const h = o.y1 - o.y0;
  const n = Math.max(1, Math.round(h / panel));
  const hd0 = o.hd0 ?? o.hw0;
  const hd1 = o.hd1 ?? o.hw1;
  const wAt = (y: number) => o.hw0 + (o.hw1 - o.hw0) * ((y - o.y0) / h);
  const dAt = (y: number) => hd0 + (hd1 - hd0) * ((y - o.y0) / h);
  const corners = (y: number): V3[] => {
    const w = wAt(y);
    const d = dAt(y);
    return [
      [o.x - w, y, o.z - d],
      [o.x + w, y, o.z - d],
      [o.x + w, y, o.z + d],
      [o.x - w, y, o.z + d],
    ];
  };
  const bot = corners(o.y0);
  const top = corners(o.y1);
  for (let i = 0; i < 4; i++) b.beam(bot[i], top[i], leg, o.color, 'paint');
  // side names for corner pairs (i, i+1)
  const sideName = ['-z', '+x', '+z', '-x'];
  for (let p = 0; p < n; p++) {
    const ya = o.y0 + (h * p) / n;
    const yb = o.y0 + (h * (p + 1)) / n;
    const A = corners(ya);
    const B = corners(yb);
    for (let s = 0; s < 4; s++) {
      const s2 = (s + 1) % 4;
      b.beam(B[s], B[s2], brace * 1.2, bc, 'paint');
      if (o.openSide === sideName[s] && p < (o.openPanels ?? 2)) continue;
      b.beam(A[s], B[s2], brace, bc, 'paint');
      b.beam(A[s2], B[s], brace, bc, 'paint');
    }
  }
}

/** Triangular or square chord lattice leg (jack-up legs, jacket legs, crane booms), vertical. */
export function latticeLeg(b: Builder, x: number, z: number, y0: number, y1: number, r: number, color: number, sides = 3, panel = 1.2, chord = 0.16): void {
  const h = y1 - y0;
  if (h <= 0) return;
  const n = Math.max(1, Math.round(h / panel));
  const pts = (y: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 6;
      out.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    }
    return out;
  };
  const B0 = pts(y0);
  const B1 = pts(y1);
  for (let i = 0; i < sides; i++) b.pipe(B0[i], B1[i], chord, color, 'paint', 6);
  for (let p = 0; p < n; p++) {
    const A = pts(y0 + (h * p) / n);
    const B = pts(y0 + (h * (p + 1)) / n);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      b.beam(p % 2 ? A[i] : A[j], p % 2 ? B[j] : B[i], chord * 0.45, color, 'paint');
      b.beam(B[i], B[j], chord * 0.5, color, 'paint');
    }
  }
}

/** Rectangular lattice boom between two points (crane booms, flare booms, bridges). */
export function latticeBoom(b: Builder, p0: V3, p1: V3, w: number, color: number, panel = 1.0, taper = 1): void {
  b.orient(p0, p1, (len) => {
    const n = Math.max(1, Math.round(len / panel));
    const hw0 = w / 2;
    const hw1 = (w / 2) * taper;
    const at = (t: number): V3[] => {
      const hw = hw0 + (hw1 - hw0) * t;
      const y = t * len;
      return [
        [-hw, y, -hw],
        [hw, y, -hw],
        [hw, y, hw],
        [-hw, y, hw],
      ];
    };
    const A0 = at(0);
    const A1 = at(1);
    for (let i = 0; i < 4; i++) b.beam(A0[i], A1[i], 0.09, color, 'paint');
    for (let p = 0; p < n; p++) {
      const A = at(p / n);
      const B = at((p + 1) / n);
      for (let s = 0; s < 4; s++) {
        const s2 = (s + 1) % 4;
        b.beam(p % 2 ? A[s] : A[s2], p % 2 ? B[s2] : B[s], 0.045, color, 'paint');
        b.beam(B[s], B[s2], 0.05, color, 'paint');
      }
    }
  });
}

/** Circular guard rail (posts + top & knee rails) of radius R standing on height y; optional arc [a0, a1]. */
export function ringRail(b: Builder, x: number, y: number, z: number, R: number, color: number = C.HAZARD, a0 = 0, a1 = Math.PI * 2): void {
  b.detail(() => {
    const full = a1 - a0 >= Math.PI * 2 - 1e-3;
    const n = Math.max(4, Math.round(((a1 - a0) * R) / 0.9));
    let prev: V3 | null = null;
    let prevK: V3 | null = null;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const px = x + Math.cos(a) * R;
      const pz = z + Math.sin(a) * R;
      if (!(full && i === n)) b.box(px, y + 0.5, pz, 0.05, 1, 0.05, color, 'paint');
      const top: V3 = [px, y + 1, pz];
      const knee: V3 = [px, y + 0.55, pz];
      if (prev && prevK) {
        b.beam(prev, top, 0.045, color, 'paint');
        b.beam(prevK, knee, 0.035, color, 'paint');
      }
      prev = top;
      prevK = knee;
    }
  });
}

/** Handrail from (x0,z0) to (x1,z1) standing on height y. */
export function railing(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, color: number = C.HAZARD): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const posts = Math.max(1, Math.round(len / 1.1));
  b.detail(() => {
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      b.box(px, y + 0.5, pz, 0.05, 1, 0.05, color, 'paint');
    }
    b.beam([x0, y + 1, z0], [x1, y + 1, z1], 0.05, color, 'paint');
    b.beam([x0, y + 0.55, z0], [x1, y + 0.55, z1], 0.04, color, 'paint');
  });
}

/** Railing around the rectangle edges at height y (skip edges listed in `skip`: 'n','s','e','w'). */
export function railRect(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, color: number = C.HAZARD, skip = ''): void {
  if (!skip.includes('n')) railing(b, x0, z0, x1, z0, y, color);
  if (!skip.includes('s')) railing(b, x0, z1, x1, z1, y, color);
  if (!skip.includes('w')) railing(b, x0, z0, x0, z1, y, color);
  if (!skip.includes('e')) railing(b, x1, z0, x1, z1, y, color);
}

/** Grated platform slab with railing. */
export function platform(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, color: number = C.STEEL_DARK, rail = true, skip = ''): void {
  b.slab(x0, y - 0.12, z0, x1, y, z1, color, 'metal');
  if (rail) railRect(b, x0, z0, x1, z1, y, C.HAZARD, skip);
}

/**
 * Straight stair flight rising from (x,y0,z) along direction `dir` (radians around Y, 0 = +x)
 * for height h, width w. Slope 45°.
 */
export function stairs(b: Builder, x: number, y0: number, z: number, dir: number, h: number, w = 0.8, color: number = C.HAZARD): void {
  b.at(x, y0, z, -dir, () => {
    const run = h;
    const steps = Math.max(2, Math.round(h / 0.3));
    b.beam([0, 0, -w / 2], [run, h, -w / 2], 0.08, C.STEEL_DARK, 'paint', 0.2);
    b.beam([0, 0, w / 2], [run, h, w / 2], 0.08, C.STEEL_DARK, 'paint', 0.2);
    b.detail(() => {
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        b.box(t * run, t * h, 0, 0.26, 0.04, w, C.STEEL, 'metal');
      }
      b.beam([0, 1, -w / 2], [run, h + 1, -w / 2], 0.05, color, 'paint');
      b.beam([0, 1, w / 2], [run, h + 1, w / 2], 0.05, color, 'paint');
    });
  });
}

/** Vertical ladder with safety cage; facing = direction the climber faces (radians around Y). */
export function ladder(b: Builder, x: number, y0: number, z: number, h: number, facing = 0, cage = true): void {
  b.detail(() => {
    b.at(x, y0, z, -facing, () => {
      b.box(0, h / 2, -0.2, 0.05, h, 0.05, C.STEEL_LIGHT, 'metal');
      b.box(0, h / 2, 0.2, 0.05, h, 0.05, C.STEEL_LIGHT, 'metal');
      for (let y = 0.3; y < h; y += 0.35) b.box(0, y, 0, 0.04, 0.04, 0.4, C.STEEL_LIGHT, 'metal');
      if (cage && h > 2.5) {
        for (let y = 2.2; y < h; y += 0.9) b.ring(-0.35, y, 0, 0.36, 0.03, C.STEEL_LIGHT, 'metal', 10);
        b.box(-0.7, (h + 2.2) / 2, 0, 0.04, h - 2.2, 0.04, C.STEEL_LIGHT, 'metal');
      }
    });
  });
}

export interface TankOpts {
  x: number;
  z: number;
  y0?: number;
  r: number;
  h: number;
  color?: number;
  roof?: 'cone' | 'dome' | 'flat' | 'open';
  band?: number | null;
  bandY?: number;
  ladder?: boolean;
  spiral?: boolean;
  seg?: number;
}

/** Vertical storage tank with roof, company band, and access. */
export function tank(b: Builder, o: TankOpts): void {
  const y0 = o.y0 ?? 0;
  const col = o.color ?? C.WHITE;
  const seg = o.seg ?? 20;
  b.cyl(o.x, y0, o.z, o.r + 0.12, 0.15, C.CONCRETE, 'rough', seg);
  b.cyl(o.x, y0 + 0.15, o.z, o.r, o.h - 0.15, col, 'paint', seg);
  // weld seams / stiffener rings
  b.detail(() => {
    for (let y = y0 + 1; y < y0 + o.h - 0.3; y += 1.1) b.ring(o.x, y, o.z, o.r + 0.015, 0.025, col, 'paint', seg);
  });
  if (o.band !== null) {
    const by = o.bandY ?? y0 + o.h * 0.72;
    b.cyl(o.x, by, o.z, o.r + 0.02, Math.min(0.6, o.h * 0.12), o.band ?? b.company, 'paint', seg);
  }
  const top = y0 + o.h;
  const roof = o.roof ?? 'cone';
  if (roof === 'cone') b.cyl(o.x, top, o.z, o.r + 0.05, Math.max(0.25, o.r * 0.22), col, 'paint', seg, 0.25);
  else if (roof === 'dome') b.dome(o.x, top, o.z, o.r, col, 'paint', seg, o.r * 0.35);
  else if (roof === 'flat') b.cyl(o.x, top, o.z, o.r + 0.05, 0.1, C.STEEL, 'metal', seg);
  else b.ring(o.x, top, o.z, o.r, 0.08, col, 'paint', seg);
  if (roof !== 'open' && o.ladder !== false) ringRail(b, o.x, top + 0.02, o.z, o.r - 0.12, C.HAZARD, -0.7, 0.7);
  if (o.spiral) spiralStair(b, o.x, o.z, y0, top, o.r);
  else if (o.ladder !== false) ladder(b, o.x + o.r + 0.05, y0, o.z, o.h, Math.PI, true);
  // roof railing segment & vent
  if (roof !== 'open') {
    b.detail(() => {
      b.cyl(o.x, top + Math.max(0.25, o.r * 0.22), o.z, 0.12, 0.35, C.STEEL, 'metal', 6);
    });
  }
}

/** Spiral stair wrapped around a vertical cylinder of radius r from y0 to y1. */
export function spiralStair(b: Builder, x: number, z: number, y0: number, y1: number, r: number, turns = 0.55, color: number = C.HAZARD): void {
  const h = y1 - y0;
  const steps = Math.max(8, Math.round(h / 0.35));
  const rr = r + 0.45;
  let prev: V3 | null = null;
  let prevRail: V3 | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const p: V3 = [x + Math.cos(a) * rr, y0 + t * h, z + Math.sin(a) * rr];
    const pr: V3 = [x + Math.cos(a) * (rr + 0.35), y0 + t * h + 1, z + Math.sin(a) * (rr + 0.35)];
    if (prev) {
      b.beam(prev, p, 0.1, C.STEEL_DARK, 'paint', 0.5);
      b.detail(() => b.beam(prevRail!, pr, 0.05, color, 'paint'));
    }
    if (i % 3 === 0) b.detail(() => b.box(pr[0], pr[1] - 0.5, pr[2], 0.05, 1, 0.05, color, 'paint'));
    prev = p;
    prevRail = pr;
  }
}

/** Horizontal pressure vessel on saddles along X (axis 'x') or Z. */
export function hVessel(b: Builder, x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'z', color: number = C.WHITE): void {
  const seg = 14;
  if (axis === 'x') {
    b.cylX(x, y, z, r, len, color, 'paint', seg);
    b.sphere(x - len / 2, y, z, r, color, 'paint', seg, r).sphere(x + len / 2, y, z, r, color, 'paint', seg, r);
    for (const s of [-1, 1]) b.box(x + s * len * 0.3, (y - r) / 2 + 0.1, z, 0.3, Math.max(0.2, y - r + 0.2), r * 1.5, C.STEEL_DARK, 'paint');
  } else {
    b.cylZ(x, y, z, r, len, color, 'paint', seg);
    b.sphere(x, y, z - len / 2, r, color, 'paint', seg, r).sphere(x, y, z + len / 2, r, color, 'paint', seg, r);
    for (const s of [-1, 1]) b.box(x, (y - r) / 2 + 0.1, z + s * len * 0.3, r * 1.5, Math.max(0.2, y - r + 0.2), 0.3, C.STEEL_DARK, 'paint');
  }
}

/** Process column (distillation tower) with skirt, platforms, ladder and top davit. */
export function column(b: Builder, x: number, z: number, y0: number, h: number, r: number, color: number = C.INSULATION, platformEvery = 3.2): void {
  b.cyl(x, y0, z, r * 1.05, 0.9, C.CONCRETE_DARK, 'rough', 14);
  b.cyl(x, y0 + 0.9, z, r, h - 0.9, color, 'paint', 16);
  b.dome(x, y0 + h, z, r, color, 'paint', 16, r * 0.5);
  b.detail(() => {
    for (let y = y0 + 1.5; y < y0 + h - 0.5; y += 0.8) b.ring(x, y, z, r + 0.01, 0.018, C.STEEL_LIGHT, 'metal', 16);
  });
  for (let y = y0 + platformEvery; y < y0 + h - 0.8; y += platformEvery) {
    b.ring(x, y, z, r + 0.35, 0.3, C.STEEL_DARK, 'metal', 16);
    b.box(x + r + 0.5, y + 0.4, z + 0.2, 0.12, 0.12, 0.12, C.LAMP_WARM, 'lamp');
    ringRail(b, x, y, z, r + 0.62);
  }
  ladder(b, x - r - 0.1, y0 + 0.9, z, h - 0.9, 0, true);
  // overhead vapour line
  b.pipe([x, y0 + h + r * 0.4, z], [x + r + 0.6, y0 + h + r * 0.4, z], 0.14, C.STEEL, 'metal');
  b.pipe([x + r + 0.6, y0 + h + r * 0.4, z], [x + r + 0.6, y0 + 0.8, z], 0.14, C.STEEL, 'metal');
  b.detail(() => {
    b.box(x, y0 + h + r * 0.5 + 0.6, z, 0.08, 1.2, 0.08, C.HAZARD, 'paint');
    b.box(x + 0.35, y0 + h + r * 0.5 + 1.15, z, 0.7, 0.08, 0.08, C.HAZARD, 'paint');
  });
}

/** Pipe rack along X from x0..x1 centred at z, with bents every `bay` and pipes on `levels` tiers. */
export function pipeRackX(b: Builder, x0: number, x1: number, z: number, y0: number, width: number, levels: number[], pipeColors: number[], bay = 2): void {
  const hw = width / 2;
  const n = Math.max(1, Math.round((x1 - x0) / bay));
  const top = levels[levels.length - 1];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    b.box(x, y0 + top / 2, z - hw, 0.16, top, 0.16, C.STEEL_DARK, 'paint');
    b.box(x, y0 + top / 2, z + hw, 0.16, top, 0.16, C.STEEL_DARK, 'paint');
    for (const l of levels) b.box(x, y0 + l, z, 0.14, 0.14, width + 0.16, C.STEEL_DARK, 'paint');
  }
  levels.forEach((l, li) => {
    const count = Math.max(2, Math.floor(width / 0.32));
    for (let k = 0; k < count; k++) {
      const col = pipeColors[(k + li) % pipeColors.length];
      const r = k % 3 === 0 ? 0.12 : 0.08;
      const pz = z - hw + 0.18 + ((width - 0.36) * k) / Math.max(1, count - 1);
      b.cylX((x0 + x1) / 2, y0 + l + 0.07 + r, pz, r, x1 - x0 + 0.2, col, 'metal', 8);
    }
  });
}

/** Same as pipeRackX but along Z. */
export function pipeRackZ(b: Builder, z0: number, z1: number, x: number, y0: number, width: number, levels: number[], pipeColors: number[], bay = 2): void {
  b.at(x, 0, (z0 + z1) / 2, -Math.PI / 2, () => pipeRackX(b, -(z1 - z0) / 2, (z1 - z0) / 2, 0, y0, width, levels, pipeColors, bay));
}

export interface ShedOpts {
  /** Footprint min/max corners. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0?: number;
  h: number;
  wall: number;
  roof?: number;
  trim?: number;
  /** Window rows on faces: which faces get windows ('n','s','e','w'). */
  windows?: string;
  windowY?: number;
  windowH?: number;
  spacing?: number;
  /** Door on face ('n','s','e','w'), optional. */
  door?: string;
  gable?: boolean;
  seed?: number;
  roofUnits?: boolean;
}

/** Box building with windows (lit at night, random dark ones), door, roof trim and optional HVAC. */
export function shed(b: Builder, o: ShedOpts): void {
  const y0 = o.y0 ?? 0;
  const roofC = o.roof ?? C.STEEL_LIGHT;
  const trim = o.trim ?? b.company;
  const r = prng(o.seed ?? 7);
  b.slab(o.x0, y0, o.z0, o.x1, y0 + o.h, o.z1, o.wall, 'paint');
  // trim band just below the roof
  b.slab(o.x0 - 0.03, y0 + o.h - 0.25, o.z0 - 0.03, o.x1 + 0.03, y0 + o.h, o.z1 + 0.03, trim, 'paint');
  // base plinth
  b.slab(o.x0 - 0.04, y0, o.z0 - 0.04, o.x1 + 0.04, y0 + 0.18, o.z1 + 0.04, C.CONCRETE_DARK, 'rough');
  if (o.gable) {
    b.gable((o.x0 + o.x1) / 2, y0 + o.h, (o.z0 + o.z1) / 2, o.x1 - o.x0 + 0.3, Math.min(1.4, (o.x1 - o.x0) * 0.3), o.z1 - o.z0 + 0.3, roofC, 'paint');
  } else {
    b.slab(o.x0 - 0.06, y0 + o.h, o.z0 - 0.06, o.x1 + 0.06, y0 + o.h + 0.12, o.z1 + 0.06, roofC, 'metal');
    if (o.roofUnits !== false && (o.x1 - o.x0) * (o.z1 - o.z0) > 6) {
      b.detail(() => {
        const cx = o.x0 + (o.x1 - o.x0) * (0.3 + r() * 0.4);
        const cz = o.z0 + (o.z1 - o.z0) * (0.3 + r() * 0.4);
        b.box(cx, y0 + o.h + 0.4, cz, 0.9, 0.55, 0.7, C.STEEL, 'metal');
        b.cyl(cx + 0.2, y0 + o.h + 0.67, cz, 0.22, 0.05, C.GUNMETAL, 'metal', 10);
      });
    }
  }
  const wy = y0 + (o.windowY ?? Math.min(1.4, o.h * 0.45));
  const wh = o.windowH ?? Math.min(0.9, o.h * 0.3);
  const sp = o.spacing ?? 1.3;
  const faces = o.windows ?? 'nsew';
  const levels = Math.max(1, Math.floor((o.h - 0.3) / 2.4));
  const win = (face: string, lvl: number) => {
    const yy = wy + lvl * 2.4;
    if (yy + wh > y0 + o.h - 0.3) return;
    const alongX = face === 'n' || face === 's';
    const a0 = alongX ? o.x0 : o.z0;
    const a1 = alongX ? o.x1 : o.z1;
    const len = a1 - a0;
    const n = Math.max(1, Math.floor(len / sp));
    for (let i = 0; i < n; i++) {
      const c = a0 + (len * (i + 0.5)) / n;
      if (o.door === face && lvl === 0 && Math.abs(c - (a0 + a1) / 2) < 0.8) continue;
      const kind = r() < 0.72 ? 'glass' : 'glassDark';
      const ww = Math.min(0.8, sp * 0.62);
      if (face === 'n') b.box(c, yy + wh / 2, o.z0 - 0.02, ww, wh, 0.06, C.GLASS, kind);
      if (face === 's') b.box(c, yy + wh / 2, o.z1 + 0.02, ww, wh, 0.06, C.GLASS, kind);
      if (face === 'w') b.box(o.x0 - 0.02, yy + wh / 2, c, 0.06, wh, ww, C.GLASS, kind);
      if (face === 'e') b.box(o.x1 + 0.02, yy + wh / 2, c, 0.06, wh, ww, C.GLASS, kind);
    }
  };
  for (const f of faces) for (let l = 0; l < levels; l++) win(f, l);
  if (o.door) {
    const cx = (o.x0 + o.x1) / 2;
    const cz = (o.z0 + o.z1) / 2;
    const dh = 1.9;
    if (o.door === 'n') door(b, cx, y0, o.z0 - 0.03, 0, dh);
    if (o.door === 's') door(b, cx, y0, o.z1 + 0.03, Math.PI, dh);
    if (o.door === 'w') door(b, o.x0 - 0.03, y0, cz, Math.PI / 2, dh);
    if (o.door === 'e') door(b, o.x1 + 0.03, y0, cz, -Math.PI / 2, dh);
  }
}

/** Door with lamp above; faces -z of its frame rotated by ry. */
export function door(b: Builder, x: number, y0: number, z: number, ry: number, h = 1.9): void {
  b.at(x, y0, z, ry, () => {
    b.box(0, h / 2 + 0.1, 0, 0.95, h, 0.06, C.GUNMETAL, 'paint');
    b.box(0, h / 2 + 0.1, -0.01, 0.8, h - 0.15, 0.06, C.STEEL, 'metal');
    b.box(0, h + 0.35, -0.05, 0.22, 0.12, 0.14, C.LAMP_WARM, 'lamp');
    b.box(0, h + 0.5, -0.25, 1.3, 0.06, 0.5, C.STEEL_DARK, 'metal');
  });
}

/** Electric motor + pump on a skid (along x), length ~2. */
export function pumpSkid(b: Builder, x: number, y0: number, z: number, ry: number, color: number = C.BLUE, s = 1): void {
  b.at(x, y0, z, ry, () => {
    b.box(0, 0.08 * s, 0, 2.1 * s, 0.16 * s, 0.9 * s, C.STEEL_DARK, 'paint');
    b.cylX(-0.45 * s, 0.55 * s, 0, 0.32 * s, 0.9 * s, color, 'paint', 12);
    b.detail(() => {
      for (let i = -3; i <= 3; i++) b.box(-0.45 * s + i * 0.12 * s, 0.55 * s, 0, 0.03 * s, 0.72 * s, 0.72 * s, color, 'paint');
    });
    b.box(-0.45 * s, 0.2 * s, 0, 0.6 * s, 0.1 * s, 0.6 * s, C.STEEL_DARK, 'paint');
    b.cylX(0.25 * s, 0.55 * s, 0, 0.1 * s, 0.5 * s, C.STEEL, 'metal', 8);
    b.sphere(0.65 * s, 0.55 * s, 0, 0.3 * s, C.HAZARD, 'paint', 10);
    b.cyl(0.65 * s, 0.16 * s, 0, 0.18 * s, 0.1 * s, C.HAZARD, 'paint', 8);
    b.pipe([0.65 * s, 0.85 * s, 0], [0.65 * s, 1.25 * s, 0], 0.1 * s, C.STEEL, 'metal');
    b.cylX(0.95 * s, 0.55 * s, 0, 0.1 * s, 0.4 * s, C.STEEL, 'metal', 8);
  });
}

/** Stack / chimney with red-white bands and aviation light. */
export function stack(b: Builder, x: number, z: number, y0: number, h: number, r: number, color: number = C.STEEL_LIGHT, bands = true): void {
  b.cyl(x, y0, z, r * 1.25, 0.6, C.CONCRETE_DARK, 'rough', 12);
  b.cyl(x, y0 + 0.6, z, r, h - 0.6, color, 'paint', 14, r * 0.85);
  if (bands) {
    b.cyl(x, y0 + h - 1.1, z, r * 0.88, 0.5, C.RED, 'paint', 14);
    b.cyl(x, y0 + h - 0.5, z, r * 0.86, 0.5, C.WHITE, 'paint', 14);
  }
  b.ring(x, y0 + h, z, r * 0.86, 0.05, C.GUNMETAL, 'metal', 14);
  b.box(x + r * 0.9, y0 + h - 0.3, z, 0.14, 0.14, 0.14, C.LAMP_RED, 'blink');
  b.ring(x, y0 + h * 0.6, z, r * 0.95 + 0.3, 0.2, C.STEEL_DARK, 'metal', 14);
}

/** Fin-fan (air cooler) bank: raised box with `n` fan shrouds on top. Fans are named nodes `${prefix}${i}`. */
export function finFan(b: Builder, x: number, z: number, y0: number, len: number, wid: number, n: number, prefix: string, axis: 'x' | 'z' = 'x'): void {
  const lx = axis === 'x' ? len : wid;
  const lz = axis === 'x' ? wid : len;
  // legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + (sx * lx) / 2 * 0.95, y0 / 2, z + (sz * lz) / 2 * 0.95, 0.14, y0, 0.14, C.STEEL_DARK, 'paint');
  b.slab(x - lx / 2, y0, z - lz / 2, x + lx / 2, y0 + 0.55, z + lz / 2, C.STEEL, 'metal');
  b.slab(x - lx / 2 + 0.05, y0 + 0.55, z - lz / 2 + 0.05, x + lx / 2 - 0.05, y0 + 0.62, z + lz / 2 - 0.05, C.GUNMETAL, 'metal');
  const fr = Math.min(len / n, wid) * 0.42;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const fx = axis === 'x' ? x + t * len : x;
    const fz = axis === 'x' ? z : z + t * len;
    b.cyl(fx, y0 + 0.62, fz, fr, 0.22, C.STEEL_LIGHT, 'metal', 14);
    b.group(`${prefix}${i}`, fx, y0 + 0.76, fz, () => fanBlades(b, fr * 0.92, C.GUNMETAL));
    b.detail(() => {
      b.box(fx, y0 + 0.86, fz, fr * 2, 0.02, 0.03, C.STEEL_LIGHT, 'metal');
      b.box(fx, y0 + 0.86, fz, 0.03, 0.02, fr * 2, C.STEEL_LIGHT, 'metal');
    });
  }
}

/** Fan blades in the XZ plane at the current origin (spins around Y). */
export function fanBlades(b: Builder, r: number, color: number, blades = 4): void {
  b.cyl(0, -0.05, 0, r * 0.18, 0.12, C.STEEL_DARK, 'metal', 8);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    b.push().rotY(a).rotX(0.25);
    b.box(r * 0.55, 0, 0, r * 0.85, 0.03, r * 0.28, color, 'paint');
    b.pop();
  }
}

/** Floodlight pole with lamp head; also records a 'light' anchor. */
export function lampPost(b: Builder, x: number, z: number, y0: number, h: number, dir = 0, intensity = 1): void {
  b.box(x, y0 + h / 2, z, 0.1, h, 0.1, C.STEEL_DARK, 'paint');
  b.at(x, y0 + h, z, -dir, () => {
    b.box(0.25, 0, 0, 0.5, 0.06, 0.06, C.STEEL_DARK, 'paint');
    b.box(0.5, -0.05, 0, 0.3, 0.12, 0.26, C.GUNMETAL, 'paint');
    b.box(0.5, -0.12, 0, 0.26, 0.03, 0.22, C.LAMP_WHITE, 'lamp');
  });
  b.anchor('light', x, y0 + h - 0.3, z, { intensity, color: 0xffe2b0, range: 14 });
}

/** Intermodal container (6 × 2.4 × 2.6 scaled to `s`) along x. */
export function container(b: Builder, x: number, y0: number, z: number, ry: number, color: number, s = 0.85): void {
  const L = 6 * s;
  const W = 2.4 * s;
  const H = 2.55 * s;
  b.at(x, y0, z, ry, () => {
    b.box(0, H / 2, 0, L, H, W, color, 'paint');
    b.detail(() => {
      for (let i = 1; i < 12; i++) {
        const xx = -L / 2 + (L * i) / 12;
        b.box(xx, H / 2, W / 2 + 0.01, 0.06, H * 0.9, 0.03, color, 'paint');
        b.box(xx, H / 2, -W / 2 - 0.01, 0.06, H * 0.9, 0.03, color, 'paint');
      }
      b.box(L / 2 + 0.01, H / 2, 0, 0.03, H * 0.92, W * 0.95, C.GUNMETAL, 'paint');
    });
    b.box(0, H + 0.02, 0, L - 0.05, 0.04, W - 0.05, color, 'paint');
  });
}

/** Palletised pipe bundle (stack of tubulars) along x. */
export function pipeStack(b: Builder, x: number, y0: number, z: number, len: number, rows: number, cols: number, r = 0.1, color: number = C.RUST): void {
  for (const sx of [-0.35, 0.35]) b.box(x + sx * len, y0 + 0.08, z, 0.2, 0.16, cols * r * 2.1 + 0.2, C.WOOD, 'rough');
  for (let row = 0; row < rows; row++)
    for (let c = 0; c < cols - (row % 2); c++) {
      const pz = z - ((cols - 1) * r * 2.05) / 2 + c * r * 2.05 + (row % 2) * r;
      b.cylX(x, y0 + 0.16 + r + row * r * 1.75, pz, r, len, color, 'metal', 7);
    }
}

/** Walkway frame from p0 to p1 at deck level (for jetties, bridges). */
export function walkway(b: Builder, p0: V3, p1: V3, w: number): void {
  b.orient(p0, p1, (len) => {
    b.box(0, len / 2, 0, w, len, 0.12, C.STEEL_DARK, 'metal');
  });
}

/** Vertical pressure vessel on a skirt with elliptical heads. */
export function vVessel(b: Builder, x: number, z: number, y0: number, r: number, h: number, color: number = C.WHITE, skirt = 0.5): void {
  b.cyl(x, y0, z, r * 0.92, skirt, C.STEEL_DARK, 'paint', 12);
  b.cyl(x, y0 + skirt, z, r, h - skirt - r * 0.4, color, 'paint', 14);
  b.dome(x, y0 + h - r * 0.4, z, r, color, 'paint', 14, r * 0.4);
  b.cyl(x, y0 + h - 0.05, z, 0.07, 0.3, C.STEEL, 'metal', 6);
}

/**
 * Fired heater / furnace box from (x0,z0) to (x1,z1), firebox height h, with glowing peep windows
 * ('hot' material), a convection section and `stacks` stacks (smoke anchors) of height stackH.
 */
export function furnace(b: Builder, x0: number, z0: number, x1: number, z1: number, h: number, stacks: number, stackH: number, color: number = C.STEEL_LIGHT): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  // legs + firebox
  for (const x of [x0 + 0.2, x1 - 0.2]) for (const z of [z0 + 0.2, z1 - 0.2]) b.box(x, 0.4, z, 0.25, 0.8, 0.25, C.STEEL_DARK, 'paint');
  b.slab(x0, 0.8, z0, x1, 0.8 + h, z1, color, 'paint');
  b.slab(x0 - 0.03, 0.8, z0 - 0.03, x1 + 0.03, 1.0, z1 + 0.03, C.STEEL_DARK, 'paint');
  // peep windows glowing on the long sides
  const alongX = w >= d;
  const n = Math.max(2, Math.floor((alongX ? w : d) / 0.9));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    for (const yy of [1.6, 2.6]) {
      if (yy > 0.8 + h - 0.4) continue;
      if (alongX) {
        b.box(x0 + w * t, yy, z0 - 0.02, 0.22, 0.16, 0.04, C.HOT, 'hot');
        b.box(x0 + w * t, yy, z1 + 0.02, 0.22, 0.16, 0.04, C.HOT, 'hot');
      } else {
        b.box(x0 - 0.02, yy, z0 + d * t, 0.04, 0.16, 0.22, C.HOT, 'hot');
        b.box(x1 + 0.02, yy, z0 + d * t, 0.04, 0.16, 0.22, C.HOT, 'hot');
      }
    }
  }
  // burners glow underneath
  b.slab(x0 + 0.3, 0.72, z0 + 0.3, x1 - 0.3, 0.8, z1 - 0.3, C.HOT, 'hot');
  // convection section (narrower box on top)
  const ch = Math.min(1.6, h * 0.35);
  b.slab(cx - w * 0.35, 0.8 + h, cz - d * 0.3, cx + w * 0.35, 0.8 + h + ch, cz + d * 0.3, C.STEEL, 'paint');
  // stacks
  for (let i = 0; i < stacks; i++) {
    const t = stacks === 1 ? 0.5 : i / (stacks - 1);
    const sx = alongX ? cx - w * 0.25 + w * 0.5 * t : cx;
    const sz = alongX ? cz : cz - d * 0.25 + d * 0.5 * t;
    const r = Math.min(0.4, Math.min(w, d) * 0.16);
    b.cyl(sx, 0.8 + h + ch, sz, r, stackH, C.STEEL_LIGHT, 'paint', 12, r * 0.9);
    b.cyl(sx, 0.8 + h + ch + stackH - 0.5, sz, r * 0.92, 0.4, C.RED, 'paint', 12);
    b.box(sx + r, 0.8 + h + ch + stackH - 0.2, sz, 0.1, 0.1, 0.1, C.LAMP_RED, 'blink');
    b.anchor('smoke', sx, 0.8 + h + ch + stackH + 0.1, sz, { r: r * 1.2, rate: 0.8, dark: 0.15 });
  }
  b.anchor('light', cx, 1.4, z0 - 0.5, { intensity: 0.6, color: 0xff9a50, range: 7 });
}

/** Shell-and-tube exchanger along x with coloured channel head. */
export function exchanger(b: Builder, x: number, y: number, z: number, r: number, len: number, head: number = C.BLUE): void {
  b.cylX(x, y, z, r, len, C.STEEL_LIGHT, 'paint', 12);
  b.cylX(x + len / 2 + r * 0.4, y, z, r * 1.08, r * 0.8, head, 'paint', 12);
  b.sphere(x - len / 2, y, z, r, C.STEEL_LIGHT, 'paint', 10, r * 0.6);
  for (const s of [-0.3, 0.3]) b.box(x + s * len, (y - r) / 2 + 0.05, z, 0.2, Math.max(0.1, y - r), r * 1.4, C.STEEL_DARK, 'paint');
}

/** Structural frame (steel "table") x0..x1, z0..z1 with decks at the given heights. */
export function frame(b: Builder, x0: number, z0: number, x1: number, z1: number, decks: number[], color: number = C.STEEL_DARK, grate: number = C.STEEL_DARK): void {
  const top = decks[decks.length - 1];
  const nx = Math.max(1, Math.round((x1 - x0) / 2.2));
  const nz = Math.max(1, Math.round((z1 - z0) / 2.2));
  for (let i = 0; i <= nx; i++)
    for (let k = 0; k <= nz; k++) {
      if (i > 0 && i < nx && k > 0 && k < nz) continue;
      b.box(x0 + ((x1 - x0) * i) / nx, top / 2, z0 + ((z1 - z0) * k) / nz, 0.16, top, 0.16, color, 'paint');
    }
  for (const y of decks) {
    b.slab(x0, y - 0.1, z0, x1, y, z1, grate, 'metal');
    railRect(b, x0, z0, x1, z1, y, C.HAZARD);
  }
  // diagonal bracing on the end faces
  b.beam([x0, 0, z0], [x0, top, z1], 0.07, color, 'paint');
  b.beam([x1, 0, z1], [x1, top, z0], 0.07, color, 'paint');
}

/** Control room / substation block. */
export function controlRoom(b: Builder, x0: number, z0: number, x1: number, z1: number, h: number, seed: number, signFace: 'n' | 's' | 'e' | 'w' = 's'): void {
  shed(b, { x0, z0, x1, z1, h, wall: C.CREAM, roof: C.STEEL, windows: signFace === 's' || signFace === 'n' ? 'ns' : 'ew', windowY: 1.0, windowH: 0.5, door: signFace, seed });
}
