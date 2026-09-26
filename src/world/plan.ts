// Geological planning: decides WHERE the structures and traps are (faults, dikes, salt diapirs, anticlinal
// domes, reefs, sand wedges, shale plays, overpressure cells, aquifers). Everything here is driven by a
// dedicated deterministic RNG stream, so a (seed, size) pair always yields the same basin.
import { SEA_LEVEL } from '../core/constants';
import type { Fault } from '../core/types';
import { clamp, makeRng } from '../core/rng';
import { randRange, randSym, shuffled, subSeed } from './noise';
import { MAX_FAULTS, MAX_SEALING, SHAPE, BODY, type AquiferModel, type TrapModel } from './model';
import { DOME_NAMES, OFFSHORE_NAMES, REEF_NAMES, U, WEDGE_NAMES } from './strata';
import {
  faultPlanePoint, type Diapir, type Dike, type Dome, type FaultModel, type HorizonGrid, type OpZone, type Play, type Reef,
  type SaltBasin, type Wedge,
} from './structure';
import { TF, Terrain } from './terrain';

interface SizeCfg {
  faults: number;
  anticlines: number;
  faultTraps: number;
  diapirs: number;
  flanksPer: number;
  reefs: number;
  wedges: number;
  plays: number;
  opZones: number;
  fresh: number;
  brine: number;
  dikes: number;
}

function sizeCfg(size: number): SizeCfg {
  if (size <= 256) return { faults: 3, anticlines: 4, faultTraps: 1, diapirs: 1, flanksPer: 1, reefs: 1, wedges: 1, plays: 1, opZones: 1, fresh: 2, brine: 2, dikes: 2 };
  if (size <= 512) return { faults: 4, anticlines: 8, faultTraps: 2, diapirs: 2, flanksPer: 2, reefs: 2, wedges: 2, plays: 2, opZones: 2, fresh: 3, brine: 3, dikes: 4 };
  return { faults: 6, anticlines: 13, faultTraps: 3, diapirs: 3, flanksPer: 2, reefs: 3, wedges: 3, plays: 3, opZones: 3, fresh: 4, brine: 4, dikes: 6 };
}

// ------------------------------------------------------------------------------------------------
// Faults & dikes
// ------------------------------------------------------------------------------------------------

/** Clip the infinite line through (px,pz) with direction (dx,dz) to the map square. */
function clipLine(px: number, pz: number, dx: number, dz: number, size: number): [number, number, number, number] {
  let t0 = -1e9;
  let t1 = 1e9;
  const lim = size - 1;
  const clipAxis = (p: number, d: number) => {
    if (Math.abs(d) < 1e-9) return;
    let a = (0 - p) / d;
    let b = (lim - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  };
  clipAxis(px, dx);
  clipAxis(pz, dz);
  if (t0 > t1) {
    t0 = -size * 0.5;
    t1 = size * 0.5;
  }
  return [px + dx * t0, pz + dz * t0, px + dx * t1, pz + dz * t1];
}

export function planFaults(seed: number, terrain: Terrain): FaultModel[] {
  const rng = makeRng(subSeed(seed, 200));
  const size = terrain.size;
  const cfg = sizeCfg(size);
  const count = Math.min(MAX_FAULTS, cfg.faults);
  const od = terrain.oceanDir;
  const strikeAng = Math.atan2(od.x, -od.z); // perpendicular to the ocean direction
  const out: FaultModel[] = [];
  let sealingCount = 0;
  for (let i = 0; i < count; i++) {
    const cross = i === count - 1 && count >= 3 && rng() < 0.75;
    const ang = strikeAng + (cross ? Math.PI / 2 + randSym(rng) * 0.4 : randSym(rng) * 0.32);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    let px: number;
    let pz: number;
    if (cross) {
      const s = randSym(rng) * 0.22 * size;
      px = size / 2 + dx * 0 + -od.z * s;
      pz = size / 2 + od.x * s;
    } else {
      const f = ((i + 0.5) / (count - (count >= 3 ? 1 : 0)) - 0.5) * 0.72 + randSym(rng) * 0.05;
      px = size / 2 + od.x * f * size;
      pz = size / 2 + od.z * f * size;
    }
    const [x0, z0, x1, z1] = clipLine(px, pz, dx, dz, size);
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    const dip = randRange(52, 70);
    // growth faults dip toward the basin (ocean); cross faults either way
    const toward = nx * od.x + nz * od.z;
    const dipSign: 1 | -1 = cross ? (rng() < 0.5 ? 1 : -1) : toward >= 0 ? 1 : -1;
    // throw grows basinward
    const basinward = clamp(0.5 + (((px - size / 2) * od.x + (pz - size / 2) * od.z) / size) * 1.2, 0, 1);
    const thr = Math.round(randRange(2, 3.5) + basinward * 2.5);
    let sealing = rng() < 0.6;
    if (i === 0 && count >= 2) sealing = true;
    if (sealing && sealingCount >= MAX_SEALING) sealing = false;
    const bit = sealing ? 1 << sealingCount++ : 0;
    const pub: Fault = {
      id: `F${i + 1}`,
      p0: { x: Math.round(x0 * 10) / 10, z: Math.round(z0 * 10) / 10 },
      p1: { x: Math.round(x1 * 10) / 10, z: Math.round(z1 * 10) / 10 },
      dip: Math.round(dip * 10) / 10,
      dipSign,
      throw: thr,
      sealing,
    };
    const tanDip = Math.tan((pub.dip * Math.PI) / 180);
    out.push({ pub, nx, nz, px: pub.p0.x, pz: pub.p0.z, tanDip, dipSign, throw: thr, sealing, bit, gougeW: Math.max(1, 0.75 * tanDip) });
  }
  return out;
}

export function planDikes(seed: number, size: number): Dike[] {
  const rng = makeRng(subSeed(seed, 210));
  const n = sizeCfg(size).dikes;
  const out: Dike[] = [];
  for (let i = 0; i < n; i++) {
    const x = rng() * size;
    const z = rng() * size;
    const a = rng() * Math.PI;
    const L = randRange(60, 200);
    out.push({ x0: x - Math.cos(a) * L / 2, z0: z - Math.sin(a) * L / 2, x1: x + Math.cos(a) * L / 2, z1: z + Math.sin(a) * L / 2, w: randRange(0.7, 1.6) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Traps & features
// ------------------------------------------------------------------------------------------------

export interface FeaturePlan {
  diapirs: Diapir[];
  domes: Dome[];
  reefs: Reef[];
  wedges: Wedge[];
  plays: Play[];
  opZones: OpZone[];
  traps: TrapModel[];
  aquifers: AquiferModel[];
}

const RING: readonly [number, number][] = [
  [0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];

function newTrap(p: Partial<TrapModel> & Pick<TrapModel, 'kind' | 'unit' | 'shape' | 'cx' | 'cz' | 'ra' | 'name'>): TrapModel {
  return {
    body: BODY.UNIT, bodyIdx: -1, rb: p.ra, cos: 1, sin: 0, wl: 1.3, secMid: 0, secHalf: Math.PI, maskAnd: 0, comp: new Int16Array(1 << MAX_SEALING).fill(-1),
    brine: true, x0: 0, x1: 0, z0: 0, z1: 0, charged: true, desiredColumn: 6, offshore: false, fluidHint: null, quality: 0, starter: false,
    ...p,
  } as TrapModel;
}

export function planFeatures(seed: number, terrain: Terrain, grid: HorizonGrid, salt: SaltBasin, faults: FaultModel[], unitNames: string[]): FeaturePlan {
  const rng = makeRng(subSeed(seed, 400));
  const size = terrain.size;
  const cfg = sizeCfg(size);
  const scale = Math.sqrt(size / 512);
  const od = terrain.oceanDir;
  const plan: FeaturePlan = { diapirs: [], domes: [], reefs: [], wedges: [], plays: [], opZones: [], traps: [], aquifers: [] };
  const occ: { x: number; z: number; r: number }[] = [];
  const usedNames = new Set<string>();
  const letters = new Map<number, number>();
  const offNames = shuffled(rng, OFFSHORE_NAMES);
  let offNameIdx = 0;

  const idx = (x: number, z: number) => terrain.index(Math.round(x), Math.round(z));
  const isOcean = (x: number, z: number) => (terrain.flags[idx(x, z)] & TF.OCEAN) !== 0;
  const wetAt = (x: number, z: number) => (terrain.flags[idx(x, z)] & TF.WATER) !== 0;
  const waterDepth = (x: number, z: number) => terrain.waterDepthAt(idx(x, z));
  const gmin = (x: number, z: number, r: number) => {
    let m = 255;
    for (const [a, b] of RING) m = Math.min(m, terrain.ground[idx(x + a * r, z + b * r)]);
    return m;
  };
  const hzAt = (k: number, x: number, z: number) => grid.horizonAt(k, x, z);
  const free = (x: number, z: number, r: number) => occ.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + 4);
  const inside = (x: number, z: number, r: number) => x - r >= 3 && z - r >= 3 && x + r <= size - 4 && z + r <= size - 4;
  const uniqueName = (n: string) => {
    let name = n;
    let k = 2;
    while (usedNames.has(name)) name = `${n} ${['II', 'III', 'IV', 'V', 'VI'][k++ - 2] ?? k}`;
    usedNames.add(name);
    return name;
  };
  const unitLetterName = (u: number) => {
    const n = letters.get(u) ?? 0;
    letters.set(u, n + 1);
    return uniqueName(`${unitNames[u]} ${String.fromCharCode(65 + n)}`);
  };
  const offQualifier = (u: number) =>
    u === U.UPPER_SAND ? 'Shallow' : u === U.MID_SAND ? 'Main' : u === U.DEEP_SAND ? 'Deep' : u === U.BASAL_SAND ? 'Ultra-Deep' : u === U.PLATFORM ? 'Carbonate' : 'Field';
  const addDome = (cx: number, cz: number, ra: number, rb: number, ang: number, amp: number): Dome => {
    const d: Dome = { cx, cz, ra, rb, cos: Math.cos(ang), sin: Math.sin(ang), amp };
    plan.domes.push(d);
    return d;
  };
  const hostOk = (u: number, x: number, z: number, amp: number, g: number, minY = 11) => {
    const crest = hzAt(u, x, z) + amp;
    return crest <= g - 13 && crest >= minY;
  };

  // ---------------- starter field (onshore, near the map centre, modest & forgiving) ----------------
  {
    const landAng = Math.atan2(-od.z, -od.x);
    for (let a = 0; a < 80; a++) {
      const ang = landAng + randSym(rng) * 1.3;
      const dist = randRange(26, 46) * scale;
      const x = size / 2 + Math.cos(ang) * dist;
      const z = size / 2 + Math.sin(ang) * dist;
      const ra = randRange(13, 17);
      const rb = ra * randRange(0.62, 0.82);
      if (!inside(x, z, ra) || wetAt(x, z)) continue;
      const g = gmin(x, z, ra);
      const gc = terrain.ground[idx(x, z)];
      if (gc > 92 || g < 63) continue;
      const amp = randRange(6, 7.5);
      const units = rng() < 0.5 ? [U.MID_SAND, U.UPPER_SAND] : [U.UPPER_SAND, U.MID_SAND];
      const u = units.find((k) => hostOk(k, x, z, amp, g, 16));
      if (u === undefined) continue;
      const ang2 = rng() * Math.PI;
      addDome(x, z, ra, rb, ang2, amp);
      occ.push({ x, z, r: ra * 1.3 });
      plan.traps.push(newTrap({
        kind: 'anticline', unit: u, shape: SHAPE.ELLIPSE, cx: x, cz: z, ra: ra * 1.08, rb: rb * 1.08, cos: Math.cos(ang2), sin: Math.sin(ang2),
        name: unitLetterName(u), charged: true, desiredColumn: randRange(5, 6.5), fluidHint: 'oil', quality: 0.6, starter: true,
      }));
      break;
    }
  }

  // ---------------- fault traps ----------------
  {
    const sealing = shuffled(rng, faults.filter((f) => f.sealing));
    let made = 0;
    for (const f of sealing) {
      if (made >= cfg.faultTraps) break;
      for (let a = 0; a < 30; a++) {
        const t = randRange(0.15, 0.85);
        const P = { x: f.pub.p0.x + (f.pub.p1.x - f.pub.p0.x) * t, z: f.pub.p0.z + (f.pub.p1.z - f.pub.p0.z) * t };
        const off = isOcean(P.x, P.z);
        if (waterDepth(P.x, P.z) > 26) continue;
        const ra = randRange(14, 19) * (off ? 1.25 : 1);
        const rb = randRange(9, 12.5) * (off ? 1.2 : 1);
        const amp = randRange(5.5, 8) * (off ? 1.15 : 1);
        const g = gmin(P.x, P.z, ra);
        const u = shuffled(rng, [U.MID_SAND, U.DEEP_SAND, U.DEEP_SAND, U.UPPER_SAND, U.BASAL_SAND]).find((k) => hostOk(k, P.x, P.z, amp, g));
        if (u === undefined) continue;
        const hU = hzAt(u, P.x, P.z) + amp * 0.7;
        const Q = faultPlanePoint(f, P.x, P.z, hU);
        const shift = randRange(1.5, 4);
        const cx = Q.x - f.nx * f.dipSign * shift;
        const cz = Q.z - f.nz * f.dipSign * shift;
        if (!inside(cx, cz, ra) || !free(cx, cz, ra * 1.3)) continue;
        const ang = Math.atan2(f.pub.p1.z - f.pub.p0.z, f.pub.p1.x - f.pub.p0.x);
        addDome(cx, cz, ra, rb, ang, amp);
        occ.push({ x: cx, z: cz, r: ra * 1.3 });
        const name = off ? uniqueName(`${offNames[offNameIdx++ % offNames.length]} ${offQualifier(u)}`) : unitLetterName(u);
        plan.traps.push(newTrap({
          kind: 'fault', unit: u, shape: SHAPE.ELLIPSE, cx, cz, ra: ra * 1.1, rb: rb * 1.1, cos: Math.cos(ang), sin: Math.sin(ang), name,
          desiredColumn: randRange(4, 8) * (off ? 1.3 : 1), offshore: off, charged: true, quality: off ? 0.3 : 0,
        }));
        made++;
        break;
      }
    }
  }

  // ---------------- salt diapirs & flank traps ----------------
  {
    const domeNames = shuffled(rng, DOME_NAMES);
    for (let a = 0, made = 0; a < 500 && made < cfg.diapirs; a++) {
      const x = randRange(30, size - 30);
      const z = randRange(30, size - 30);
      if (salt.at(x, z) < 0.8 || waterDepth(x, z) > 30) continue;
      const r0 = randRange(4.5, 6.5);
      const dragW = randRange(4.5, 6);
      const reach = r0 + 5.2 * dragW;
      if (!free(x, z, reach)) continue;
      const saltTop = hzAt(U.SALT, x, z);
      const saltBase = hzAt(U.SALT - 1, x, z);
      if (saltTop - saltBase < 1.5) continue;
      const g = gmin(x, z, 18);
      const topY = Math.floor(Math.min(g - randRange(12, 17), 64));
      if (topY < saltTop + 14) continue;
      const d: Diapir = {
        name: domeNames[made % domeNames.length], cx: x, cz: z, r0, rTop: r0 * randRange(1.3, 1.6), topY, bulbH: randRange(4, 6.5), cap: rng() < 0.5 ? 1 : 2,
        dragA: randRange(5, 7.5), dragW, archA: randRange(2.5, 4), phase: rng() * Math.PI * 2, influence: 0,
      };
      d.influence = Math.max(d.rTop * 2.3 * 1.9, r0 + 6.5 * dragW);
      const di = plan.diapirs.push(d) - 1;
      occ.push({ x, z, r: reach });
      made++;
      const ring = r0 + dragW;
      const cands = [U.DEEP_SAND, U.MID_SAND, U.UPPER_SAND].filter((u) => {
        const h = hzAt(u, x + ring, z);
        return h <= topY - 3 && h + d.dragA <= g - 13 && hzAt(u - 1, x + ring, z) >= saltTop + 1.5;
      });
      let mid = rng() * Math.PI * 2;
      for (let k = 0; k < cfg.flanksPer && cands.length; k++) {
        const u = cands[(cands.length - 1 - k + cands.length * 4) % cands.length];
        if (k > 0) mid += Math.PI + randSym(rng) * 0.6;
        const deg = ((mid * 180) / Math.PI + 360) % 360;
        // screen z grows southward: angle 90° = south
        const dirName = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(deg / 45) % 8];
        plan.traps.push(newTrap({
          kind: 'salt_dome', unit: u, shape: SHAPE.SECTOR, cx: x, cz: z, ra: r0 + 4.2 * dragW, wl: 1.2, secMid: Math.atan2(Math.sin(mid), Math.cos(mid)),
          secHalf: randRange(0.95, 1.35), bodyIdx: di, name: uniqueName(`${d.name} ${dirName} Flank`), desiredColumn: randRange(4, 8),
          offshore: isOcean(x, z), quality: 0.2, charged: rng() < 0.92,
        }));
      }
    }
  }

  // ---------------- reefs ----------------
  {
    const names = shuffled(rng, REEF_NAMES);
    for (let a = 0, made = 0; a < 400 && made < cfg.reefs; a++) {
      const x = randRange(24, size - 24);
      const z = randRange(24, size - 24);
      if (waterDepth(x, z) > 20) continue;
      const off = isOcean(x, z);
      const r = randRange(9, 14) * (off ? 1.2 : 1);
      const h = randRange(4.2, 6.5);
      if (!free(x, z, r * 1.4)) continue;
      const g = gmin(x, z, r);
      const crest = hzAt(U.PLATFORM, x, z) + h;
      if (crest > g - 13 || crest < 11) continue;
      const rf: Reef = { name: `${names[made % names.length]} Reef`, cx: x, cz: z, r, h, phase: rng() * Math.PI * 2 };
      const ri = plan.reefs.push(rf) - 1;
      occ.push({ x, z, r: r * 1.4 });
      made++;
      plan.traps.push(newTrap({
        kind: 'reef', unit: U.LOWER_SHALE, body: BODY.REEF, bodyIdx: ri, shape: SHAPE.CIRCLE, cx: x, cz: z, ra: r * 1.22, brine: false, wl: 1,
        name: uniqueName(rf.name), desiredColumn: randRange(3.5, h + 0.5), offshore: off, fluidHint: 'oil', quality: 0.3, charged: rng() < 0.9,
      }));
    }
  }

  // ---------------- stratigraphic pinch-outs (sand wedges) ----------------
  {
    const names = shuffled(rng, WEDGE_NAMES);
    for (let a = 0, made = 0; a < 400 && made < cfg.wedges; a++) {
      const x = randRange(40, size - 40);
      const z = randRange(40, size - 40);
      if (waterDepth(x, z) > 14) continue;
      const L = randRange(26, 40);
      const W = randRange(11, 17);
      const T = randRange(2.3, 3.4);
      if (!free(x, z, L / 2 + 4)) continue;
      const ang = Math.atan2(-od.z, -od.x) + randSym(rng) * 0.6;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const g = gmin(x, z, L / 2 + 2);
      const unit = shuffled(rng, [U.SEAL, U.COAL, U.UPPER_MUD]).find((u) => {
        const upTop = hzAt(u - 1, x + (dx * L) / 2, z + (dz * L) / 2) + 1.3 + 0.9 * T;
        return upTop <= g - 13 && hzAt(u - 1, x, z) >= 11;
      });
      if (unit === undefined) continue;
      const w: Wedge = { name: names[made % names.length], unit, ox: x - (dx * L) / 2, oz: z - (dz * L) / 2, dx, dz, L, W, T };
      const wi = plan.wedges.push(w) - 1;
      occ.push({ x, z, r: L / 2 + 4 });
      made++;
      plan.traps.push(newTrap({
        kind: 'stratigraphic', unit, body: BODY.WEDGE, bodyIdx: wi, shape: SHAPE.WEDGE, cx: x, cz: z, ra: Math.max(L, W) / 2 + 2, wl: 1,
        name: uniqueName(w.name), desiredColumn: randRange(3, 5.5), offshore: isOcean(x, z), quality: 0.1, charged: rng() < 0.9,
      }));
    }
  }

  // ---------------- anticlines (fill the remaining quota; ~40% offshore) ----------------
  {
    const target = cfg.anticlines;
    const offQuota = Math.round(target * 0.42);
    let on = 0;
    let offC = 0;
    for (let a = 0; a < 1500 && on + offC < target; a++) {
      const x = randRange(20, size - 20);
      const z = randRange(20, size - 20);
      const off = isOcean(x, z);
      if (off ? offC >= offQuota : on >= target - offQuota) continue;
      const wd = waterDepth(x, z);
      if (wd > 42) continue;
      const big = off ? 1.35 : 1;
      const ra = randRange(12, 19) * big * (size >= 768 ? 1.08 : 1);
      const rb = ra * randRange(0.5, 0.85);
      if (!inside(x, z, ra * 0.9) || !free(x, z, ra * 1.3)) continue;
      const amp = randRange(5, 8.5) * (off ? 1.2 : 1);
      const g = gmin(x, z, ra);
      const order = shuffled(rng, [U.UPPER_SAND, U.MID_SAND, U.MID_SAND, U.DEEP_SAND, U.DEEP_SAND, U.BASAL_SAND, U.PLATFORM]);
      const u = order.find((k) => hostOk(k, x, z, amp, g, off ? 9 : 11));
      if (u === undefined) continue;
      const ang = rng() * Math.PI;
      addDome(x, z, ra, rb, ang, amp);
      occ.push({ x, z, r: ra * 1.3 });
      if (off) offC++;
      else on++;
      const fieldName = off ? offNames[offNameIdx++ % offNames.length] : '';
      const mk = (unit: number, charged: boolean) =>
        newTrap({
          kind: 'anticline', unit, shape: SHAPE.ELLIPSE, cx: x, cz: z, ra: ra * 1.08, rb: rb * 1.08, cos: Math.cos(ang), sin: Math.sin(ang),
          brine: unit !== U.PLATFORM, name: off ? uniqueName(`${fieldName} ${offQualifier(unit)}`) : unitLetterName(unit),
          desiredColumn: randRange(3, 8) * (off ? 1.45 : 1), offshore: off, charged, quality: off ? 0.35 : randSym(rng) * 0.4,
        });
      plan.traps.push(mk(u, rng() < 0.84));
      // stacked pay: a deeper reservoir in the same structure
      if (rng() < 0.38) {
        const deeper = [U.UPPER_SAND, U.MID_SAND, U.DEEP_SAND, U.BASAL_SAND, U.PLATFORM].filter((k) => k < u || (u === U.UPPER_SAND && k === U.PLATFORM));
        const k2 = shuffled(rng, deeper).find((k) => k !== u && hostOk(k, x, z, amp, g, 9));
        if (k2 !== undefined) plan.traps.push(mk(k2, rng() < 0.8));
      }
    }
  }

  // ---------------- continuous shale plays ----------------
  {
    const fluids: ('oil' | 'gas')[] = cfg.plays === 1 ? [rng() < 0.5 ? 'oil' : 'gas'] : cfg.plays === 2 ? ['oil', 'gas'] : ['oil', 'gas', 'oil'];
    const land = (x: number, z: number) => !isOcean(x, z);
    const cs = { o: 0, frac: 0 };
    for (let k = 0; k < fluids.length; k++) {
      const fluid = fluids[k];
      for (let a = 0; a < 300; a++) {
        const x = randRange(size * 0.15, size * 0.85);
        const z = randRange(size * 0.15, size * 0.85);
        if (!land(x, z)) continue;
        terrain.coast(x, z, cs);
        const inland = -cs.o;
        // gas window: deeper, nearer the basin; oil window: up-dip / inland
        if (fluid === 'gas' ? inland < 20 || inland > size * 0.35 : inland < size * 0.25) continue;
        const ra = size * randRange(0.1, 0.15);
        const rb = ra * randRange(0.55, 0.8);
        if (plan.plays.some((p) => Math.hypot(p.cx - x, p.cz - z) < (p.ra + ra) * 0.85)) continue;
        const ang = rng() * Math.PI;
        const p: Play = { cx: x, cz: z, ra, rb, cos: Math.cos(ang), sin: Math.sin(ang), fluid, op: randRange(0.55, 0.85) };
        plan.plays.push(p);
        plan.traps.push(newTrap({
          kind: 'shale_play', unit: U.SOURCE, shape: SHAPE.ELLIPSE, cx: x, cz: z, ra, rb, cos: p.cos, sin: p.sin, wl: 1, brine: false,
          name: uniqueName(`${unitNames[U.SOURCE]} ${String.fromCharCode(65 + k)}`), fluidHint: fluid, charged: true, desiredColumn: 99,
        }));
        break;
      }
    }
  }

  // ---------------- overpressure cells (onshore) ----------------
  for (let a = 0, made = 0; a < 200 && made < cfg.opZones; a++) {
    const x = randRange(30, size - 30);
    const z = randRange(30, size - 30);
    if (isOcean(x, z)) continue;
    const ra = randRange(40, 75) * scale;
    const ang = rng() * Math.PI;
    plan.opZones.push({ cx: x, cz: z, ra, rb: ra * randRange(0.55, 0.9), cos: Math.cos(ang), sin: Math.sin(ang), strength: randRange(0.6, 0.95) });
    made++;
  }

  // ---------------- aquifers ----------------
  {
    let n = 0;
    const overlaps = (unit: number, x: number, z: number, ra: number) =>
      plan.aquifers.some((q) => q.unit === unit && Math.hypot(q.cx - x, q.cz - z) < (q.ra + ra) * 0.9);
    const mkAq = (unit: number, x: number, z: number, ra: number, fresh: boolean) => {
      const ang = rng() * Math.PI;
      const salinity = fresh ? Math.round(randRange(250, 1800)) : Math.round(randRange(35000, 90000) + (U.UPPER_SAND - unit) * randRange(8000, 20000));
      plan.aquifers.push({
        pub: { id: `AQ${++n}`, center: { x, y: 0, z }, radiusX: ra, radiusZ: ra, topY: 0, bottomY: 0, salinity, fresh },
        unit, cx: x, cz: z, ra, rb: ra * randRange(0.55, 0.9), cos: Math.cos(ang), sin: Math.sin(ang), live: false,
      });
    };
    for (let a = 0, made = 0; a < 300 && made < cfg.fresh; a++) {
      const x = randRange(30, size - 30);
      const z = randRange(30, size - 30);
      if (isOcean(x, z)) continue;
      const g = terrain.ground[idx(x, z)];
      const top = hzAt(U.UPPER_SAND, x, z);
      if (g - top < 5 || g - top > 26 || g <= SEA_LEVEL) continue;
      const ra = randRange(28, 50) * scale;
      if (overlaps(U.UPPER_SAND, x, z, ra)) continue;
      mkAq(U.UPPER_SAND, x, z, ra, true);
      made++;
    }
    const units = [U.MID_SAND, U.DEEP_SAND, U.BASAL_SAND];
    for (let a = 0, made = 0; a < 300 && made < cfg.brine; a++) {
      const x = randRange(30, size - 30);
      const z = randRange(30, size - 30);
      if (waterDepth(x, z) > 40) continue;
      const unit = units[made % units.length];
      const ra = randRange(40, 75) * scale;
      if (overlaps(unit, x, z, ra)) continue;
      mkAq(unit, x, z, ra, false);
      made++;
    }
  }

  return plan;
}
