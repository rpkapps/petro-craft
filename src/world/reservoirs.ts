// Reservoir finalisation: scans every planned trap voxel-by-voxel through the SAME classifier used for
// chunk generation, finds the crest and spill point of each fault compartment, places fluid contacts, and
// derives volumes & fluid properties. Also sizes the aquifers.
import { B } from '../core/blocks';
import type { Reservoir, ReservoirFluid } from '../core/types';
import { clamp, makeRng, smoothstep } from '../core/rng';
import type { Geology } from './geology';
import { BODY, ColumnCtx, RC, SHAPE, type ResModel, type TrapModel } from './model';
import { ellipseQ } from './structure';
import { randRange, randSym, subSeed } from './noise';
import { U } from './strata';
import { TF } from './terrain';

const M3_PER_VOXEL = 40 * 40 * 40;
const BBL_PER_M3 = 6.2898;
const SCF_PER_M3 = 35.3147;
/** Gameplay volume scaling applied on top of the volumetric estimate. */
const VOL_SCALE = 1.3;
/** Offshore reservoirs are richer (thicker, cleaner turbidite/deltaic sands). */
const OFFSHORE_SCALE = 1.5;
const PLAY_SCALE = 0.7;
/** Compartments smaller than this (voxels) are left uncharged (no sliver reservoirs). */
const MIN_VOXELS = 40;
const NM = 16;

interface Stats {
  count: number;
  gas: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  sx: number;
  sz: number;
  top: number;
  bottom: number;
}

const newStats = (): Stats => ({ count: 0, gas: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, sx: 0, sz: 0, top: -1, bottom: 1e9 });

function addVoxel(s: Stats, x: number, y: number, z: number, gas: boolean, w = 1): void {
  s.count += w;
  if (gas) s.gas += w;
  if (x < s.x0) s.x0 = x;
  if (x > s.x1) s.x1 = x;
  if (z < s.z0) s.z0 = z;
  if (z > s.z1) s.z1 = z;
  if (y > s.top) s.top = y;
  if (y < s.bottom) s.bottom = y;
  s.sx += (x + 0.5) * w;
  s.sz += (z + 0.5) * w;
}

const TWO_PI = Math.PI * 2;

/** Cheap analytic pre-test of a trap's HC region (wedges are resolved per column by the classifier). */
function inRegion(t: TrapModel, fx: number, fz: number): boolean {
  if (t.shape === SHAPE.ELLIPSE) return ellipseQ(t.cx, t.cz, t.ra, t.rb, t.cos, t.sin, fx, fz) <= 1.0001;
  if (t.shape === SHAPE.WEDGE) return true;
  const dx = fx - t.cx;
  const dz = fz - t.cz;
  if (dx * dx + dz * dz > t.ra * t.ra * 1.0002) return false;
  if (t.shape === SHAPE.CIRCLE) return true;
  let d = Math.atan2(dz, dx) - t.secMid;
  d -= TWO_PI * Math.round(d / TWO_PI);
  return Math.abs(d) <= t.secHalf + 1e-6;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const sig = (v: number, n: number) => {
  if (v === 0) return 0;
  const p = 10 ** (n - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
};

function hostLith(t: TrapModel): Reservoir['lithology'] {
  if (t.body === BODY.REEF) return 'limestone';
  if (t.body === BODY.WEDGE) return 'sandstone';
  if (t.unit === U.PLATFORM) return 'limestone';
  if (t.unit === U.SOURCE) return 'shale';
  return 'sandstone';
}

function growVox(a: Int32Array): Int32Array {
  const b = new Int32Array(a.length * 2);
  b.set(a);
  return b;
}

export function finalizeReservoirs(geo: Geology): void {
  const rng = makeRng(subSeed(geo.seed, 500));
  const ctx = new ColumnCtx();
  const crest = new Int32Array(NM);
  const spill = new Int32Array(NM);
  const minY = new Int32Array(NM);
  const owc = new Int32Array(NM);
  const goc = new Float64Array(NM);
  const range = { lo: 0, hi: 0 };
  const terrain = geo.terrain;
  let vox: Int32Array = new Int32Array(4 * 4096);
  let vn = 0;

  for (let ti = 0; ti < geo.traps.length; ti++) {
    const t = geo.traps[ti];
    const isPlay = t.kind === 'shale_play';
    crest.fill(-1);
    spill.fill(-1);
    minY.fill(9999);
    const all: Stats[] = Array.from({ length: NM }, newStats);

    // ---------- pass 1: host voxels, crest & spill per compartment (cached for pass 2) ----------
    // Huge continuous plays are sampled every other column (volumes weighted ×4).
    const step = isPlay ? 2 : 1;
    const w = step * step;
    vn = 0;
    for (let z = t.z0; z <= t.z1; z += step) {
      for (let x = t.x0; x <= t.x1; x += step) {
        if (!inRegion(t, x + 0.5, z + 0.5)) continue;
        geo.prepareColumn(ctx, x, z);
        const j = geo.trapSlot(ctx, ti);
        if (j < 0) continue;
        const code = ctx.tCode[j];
        if (!(code & RC.HC)) continue;
        geo.hostRange(ctx, t, range);
        const ring = (code & RC.RING) !== 0;
        for (let y = range.lo; y <= range.hi; y++) {
          const m = geo.hostMask(ctx, y, t);
          if (m < 0) continue;
          if (y > crest[m]) crest[m] = y;
          if (y < minY[m]) minY[m] = y;
          if (ring && y > spill[m]) spill[m] = y;
          addVoxel(all[m], x, y, z, false, w);
          if (!isPlay) {
            if (vn * 4 >= vox.length) vox = growVox(vox);
            vox[vn * 4] = x;
            vox[vn * 4 + 1] = y;
            vox[vn * 4 + 2] = z;
            vox[vn * 4 + 3] = m;
            vn++;
          }
        }
      }
    }

    // ---------- contacts ----------
    const masks: number[] = [];
    for (let m = 0; m < NM; m++) if (crest[m] >= 0) masks.push(m);
    masks.sort((a, b) => all[b].count - all[a].count);
    owc.fill(9999);
    goc.fill(Infinity);
    const lith = hostLith(t);
    const gC = terrain.ground[terrain.index(Math.round(t.cx), Math.round(t.cz))];
    let fluid: ReservoirFluid = 'oil';
    let fluidSet = false;
    const charged: number[] = [];
    for (let k = 0; k < masks.length; k++) {
      const m = masks[k];
      if (!t.charged) continue;
      if (k > 0 && !isPlay && rng() < 0.15) continue; // unfilled fault block
      let o: number;
      if (isPlay) o = minY[m];
      else {
        if (crest[m] < 8) continue;
        o = crest[m] - Math.max(2, Math.round(t.desiredColumn)) + 1;
        if (spill[m] >= 0) o = Math.max(o, spill[m] + 1);
        o = Math.max(o, minY[m]);
        if (crest[m] - o + 1 < 2) continue;
      }
      owc[m] = o;
      if (!fluidSet) {
        fluidSet = true;
        const depthM = (gC - (crest[m] + o) / 2) * 40;
        if (t.fluidHint) fluid = t.fluidHint;
        else if (lith === 'limestone') fluid = 'oil';
        else {
          const pGas = 0.12 + 0.42 * smoothstep(1100, 3000, depthM) + (t.offshore ? 0.08 : 0);
          fluid = rng() < pGas ? (depthM > 2000 && rng() < 0.45 ? 'condensate' : 'gas') : 'oil';
        }
      }
      const levels = crest[m] - o + 1;
      if (fluid === 'oil' && lith === 'sandstone' && levels >= 4 && !t.starter && rng() < 0.38) {
        goc[m] = crest[m] - Math.max(1, Math.round(levels * randRange(rng, 0.25, 0.45))) + 1;
      }
      charged.push(m);
    }
    if (!charged.length) continue;

    // ---------- pass 2: HC voxels ----------
    const hc: Stats[] = Array.from({ length: NM }, newStats);
    const allGas = fluid !== 'oil';
    if (isPlay) {
      for (const m of charged) {
        hc[m] = all[m];
        if (allGas) hc[m].gas = hc[m].count;
      }
    } else {
      for (let k = 0; k < vn; k++) {
        const y = vox[k * 4 + 1];
        const m = vox[k * 4 + 3];
        if (y < owc[m]) continue;
        addVoxel(hc[m], vox[k * 4], y, vox[k * 4 + 2], allGas || y >= goc[m]);
      }
    }

    // ---------- reservoirs per compartment ----------
    const made: { m: number; s: Stats }[] = [];
    for (const m of charged) if (hc[m].count >= MIN_VOXELS) made.push({ m, s: hc[m] });
    if (!made.length) continue;
    let mx = 0;
    let mz = 0;
    for (const e of made) {
      mx += e.s.sx / e.s.count;
      mz += e.s.sz / e.s.count;
    }
    mx /= made.length;
    mz /= made.length;
    made.forEach((e, compIdx) => {
      const s = e.s;
      const cx = s.sx / s.count;
      const cz = s.sz / s.count;
      let name = t.name;
      if (made.length > 1) {
        const dx = cx - mx;
        const dz = cz - mz;
        const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'East' : 'West') : dz > 0 ? 'South' : 'North';
        name = `${t.name} (${dir} Block)`;
      }
      const ri = buildReservoir(geo, rng, t, {
        id: `R${String(geo.reservoirs.length + 1).padStart(2, '0')}`, name, compartment: compIdx, stats: s, owcY: owc[e.m], gocY: goc[e.m], fluid, lith,
        isPlay, trapIdx: ti,
      });
      t.comp[e.m] = ri;
    });
  }
}

interface BuildArgs {
  id: string;
  name: string;
  compartment: number;
  stats: Stats;
  owcY: number;
  gocY: number;
  fluid: ReservoirFluid;
  lith: Reservoir['lithology'];
  isPlay: boolean;
  trapIdx: number;
}

function buildReservoir(geo: Geology, rng: () => number, t: TrapModel, a: BuildArgs): number {
  const s = a.stats;
  const cx = s.sx / s.count;
  const cz = s.sz / s.count;
  const terrain = geo.terrain;
  const ci = terrain.index(Math.floor(cx), Math.floor(cz));
  const offshore = (terrain.flags[ci] & TF.OCEAN) !== 0;
  const g = terrain.ground[ci];
  const midY = (s.top + s.bottom) / 2;
  const depthM = Math.max(200, (g - midY) * 40);
  const km = depthM / 1000;
  const q = t.quality;
  const reef = t.body === BODY.REEF;

  // ---- petrophysics ----
  let porosity: number;
  let permeability: number;
  let netToGross: number;
  let waterSaturation: number;
  if (a.lith === 'sandstone') {
    porosity = clamp(0.3 - 0.028 * km + 0.03 * randSym(rng) + 0.02 * q + (offshore ? 0.015 : 0), 0.12, 0.32);
    permeability = clamp(10 ** (-1.2 + 12.5 * porosity + 0.35 * randSym(rng) + 0.3 * q + (offshore ? 0.25 : 0)), 2, 2000);
    netToGross = randRange(rng, 0.55, 0.9);
    waterSaturation = clamp(0.14 + (0.3 - porosity) * 0.9 + 0.05 * randSym(rng), 0.15, 0.45);
  } else if (a.lith === 'limestone') {
    porosity = reef ? randRange(rng, 0.14, 0.26) : randRange(rng, 0.08, 0.19);
    permeability = clamp(10 ** (-1.4 + 13 * porosity + (reef ? 0.6 : 0) + 0.35 * randSym(rng)), 0.5, 1500);
    netToGross = randRange(rng, 0.45, 0.85);
    waterSaturation = randRange(rng, 0.18, 0.38);
  } else {
    porosity = randRange(rng, 0.04, 0.09);
    permeability = 10 ** randRange(rng, -3, -2);
    netToGross = randRange(rng, 0.72, 0.95);
    waterSaturation = randRange(rng, 0.25, 0.42);
  }

  // ---- pressure & temperature ----
  const pBg = geo.backgroundPressure(cx, midY, cz);
  const initialPressure = Math.round(pBg * (1 + randRange(rng, -0.02, 0.07)));
  const temperature = (offshore ? 5 : 18) + 29 * km + randSym(rng) * 3;

  // ---- fluid properties ----
  let gor: number;
  let api: number;
  let bubble: number;
  const hasCap = Number.isFinite(a.gocY);
  if (a.fluid === 'oil') {
    gor = clamp(150 + 1100 * smoothstep(600, 3000, depthM) + 160 * randSym(rng), 80, 1600) * (hasCap ? 1.1 : 1);
    api = a.lith === 'shale' ? randRange(rng, 38, 46) : clamp(20 + 18 * smoothstep(500, 3000, depthM) + 4 * randSym(rng), 16, 46);
    bubble = hasCap ? initialPressure : initialPressure * randRange(rng, 0.45, 0.88);
  } else if (a.fluid === 'condensate') {
    gor = randRange(rng, 6000, 16000);
    api = randRange(rng, 47, 60);
    bubble = initialPressure * randRange(rng, 0.86, 0.98);
  } else {
    gor = randRange(rng, 40000, 120000);
    api = randRange(rng, 52, 65);
    bubble = initialPressure * randRange(rng, 0.3, 0.6);
  }
  const sourProb = a.lith === 'limestone' ? 0.45 : t.kind === 'salt_dome' ? 0.35 : a.fluid !== 'oil' && km > 2.2 ? 0.3 : 0.06;
  const sour = rng() < sourProb;
  const h2s = sour ? randRange(rng, 0.012, a.fluid === 'gas' ? 0.2 : 0.12) : randRange(rng, 0, 0.004);
  const co2 = randRange(rng, 0.004, 0.03) + (a.fluid !== 'oil' ? randRange(rng, 0, 0.04) : 0);
  const waterDrive =
    t.kind === 'shale_play' ? 0
      : t.kind === 'anticline' ? clamp(randRange(rng, 0.35, 0.85) + (offshore ? 0.1 : 0), 0, 1)
        : t.kind === 'fault' ? randRange(rng, 0.2, 0.6)
          : t.kind === 'salt_dome' ? randRange(rng, 0.4, 0.85)
            : t.kind === 'reef' ? randRange(rng, 0.3, 0.7)
              : randRange(rng, 0.05, 0.35);

  // ---- volumetrics ----
  const pore = porosity * netToGross * (1 - waterSaturation);
  const tF = temperature * 1.8 + 32;
  const bg = (0.02827 * 0.9 * (tF + 460)) / Math.max(500, initialPressure + 14.7); // rcf/scf
  const bo = 1.03 + 0.00048 * gor;
  const scale = VOL_SCALE * (a.isPlay ? PLAY_SCALE : 1) * (offshore ? OFFSHORE_SCALE : 1);
  const vGas = s.gas * M3_PER_VOXEL;
  const vOil = (s.count - s.gas) * M3_PER_VOXEL;
  let oilInPlace: number;
  let gasInPlace: number;
  if (a.fluid === 'oil') {
    oilInPlace = ((vOil * pore * BBL_PER_M3) / bo) * scale;
    const freeGas = ((vGas * pore * SCF_PER_M3) / bg) * scale;
    gasInPlace = (freeGas + oilInPlace * gor) / 1000;
  } else {
    const gScf = (((vOil + vGas) * pore * SCF_PER_M3) / bg) * scale;
    gasInPlace = gScf / 1000;
    oilInPlace = gScf / gor;
  }

  const pub: Reservoir = {
    id: a.id,
    name: a.name,
    fluid: a.fluid,
    trap: t.kind,
    lithology: a.lith === 'limestone' && t.unit === U.PLATFORM && !reef && geoDolomitic(geo, cx, cz) ? 'dolomite' : a.lith,
    center: { x: round(cx, 1), y: Math.round(midY), z: round(cz, 1) },
    radiusX: Math.max(1, (s.x1 - s.x0 + 1) / 2),
    radiusZ: Math.max(1, (s.z1 - s.z0 + 1) / 2),
    topY: s.top,
    bottomY: Math.min(s.bottom, s.top - 1),
    compartment: a.compartment,
    offshore,
    porosity: round(porosity, 3),
    permeability: sig(permeability, 3),
    netToGross: round(netToGross, 2),
    waterSaturation: round(waterSaturation, 2),
    initialPressure,
    temperature: round(temperature, 1),
    bubblePoint: Math.round(bubble),
    apiGravity: round(api, 1),
    gasOilRatio: Math.round(gor),
    h2s: round(h2s, 4),
    co2: round(co2, 4),
    oilInPlace: Math.round(oilInPlace / 1000) * 1000,
    gasInPlace: Math.round(gasInPlace / 100) * 100,
    waterDrive: round(waterDrive, 2),
    gasCap: a.fluid === 'oil' && hasCap && s.gas > 0,
    owcY: a.owcY,
    gocY: a.fluid === 'oil' && hasCap ? a.gocY : undefined,
  };
  const model: ResModel = {
    pub,
    owcY: a.owcY,
    gocY: a.fluid === 'oil' && hasCap ? a.gocY : Infinity,
    blockOil: a.lith === 'shale' ? B.TIGHT_OIL_SHALE : a.lith === 'limestone' ? B.OIL_LIMESTONE : B.OIL_SANDSTONE,
    blockGas: a.lith === 'shale' ? B.GAS_SHALE : a.lith === 'limestone' ? B.OIL_LIMESTONE : B.GAS_SANDSTONE,
    allGas: a.fluid !== 'oil',
    midY,
    grad: a.fluid === 'oil' ? 0.33 : a.fluid === 'condensate' ? 0.15 : 0.09,
    trap: a.trapIdx,
  };
  return geo.addReservoir(model);
}

const dctx = new ColumnCtx();
function geoDolomitic(geo: Geology, x: number, z: number): boolean {
  geo.prepareColumn(dctx, Math.floor(x), Math.floor(z));
  return dctx.dolo;
}

/** Size every aquifer from the voxels the classifier actually assigns to it. */
export function finalizeAquifers(geo: Geology): void {
  const ctx = new ColumnCtx();
  for (let ai = 0; ai < geo.aqModels.length; ai++) {
    const a = geo.aqModels[ai];
    const ex = Math.max(a.ra, a.rb) + 1;
    const x0 = Math.max(0, Math.floor(a.cx - ex));
    const x1 = Math.min(geo.sizeX - 1, Math.ceil(a.cx + ex));
    const z0 = Math.max(0, Math.floor(a.cz - ex));
    const z1 = Math.min(geo.sizeZ - 1, Math.ceil(a.cz + ex));
    let top = -1;
    let bottom = 1e9;
    let n = 0;
    let sx = 0;
    let sz = 0;
    let bx0 = 1e9;
    let bx1 = -1e9;
    let bz0 = 1e9;
    let bz1 = -1e9;
    for (let z = z0; z <= z1; z += 2) {
      for (let x = x0; x <= x1; x += 2) {
        geo.prepareColumn(ctx, x, z);
        let inList = false;
        for (let j = 0; j < ctx.nA; j++) if (ctx.aIdx[j] === ai) inList = true;
        if (!inList) continue;
        const lo = Math.max(1, Math.floor(ctx.hz[a.unit - 1] - geo.sumThrow - 1));
        const hi = Math.min(ctx.ground - 1, Math.ceil(ctx.hz[a.unit] + 1));
        let hit = false;
        for (let y = lo; y <= hi; y++) {
          geo.classify(ctx, y);
          if (ctx.aq !== ai) continue;
          hit = true;
          if (y > top) top = y;
          if (y < bottom) bottom = y;
        }
        if (hit) {
          n++;
          sx += x;
          sz += z;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (z < bz0) bz0 = z;
          if (z > bz1) bz1 = z;
        }
      }
    }
    if (!n) continue;
    a.live = true;
    const p = a.pub;
    p.center = { x: Math.round(sx / n), y: Math.round((top + bottom) / 2), z: Math.round(sz / n) };
    p.radiusX = Math.max(1, (bx1 - bx0 + 2) / 2);
    p.radiusZ = Math.max(1, (bz1 - bz0 + 2) / 2);
    p.topY = top;
    p.bottomY = Math.min(bottom, top - 1);
    geo.aquifers.push(p);
  }
}
