// The subsurface model (IGeology). A single classifier — prepareColumn() + classify() — decides the
// geological block of every voxel. Chunk generation, rockAt, reservoirAt, properties and pressure queries
// all run through it, so the blocks a player digs always agree with what the sim/seismic/logs report.
import { B } from '../core/blocks';
import { SEA_LEVEL, WORLD_HEIGHT, WORLD_SIZES, type WorldSizeKey } from '../core/constants';
import type { Aquifer, BiomeId, Fault, IGeology, Reservoir, RockProperties, RockType } from '../core/types';
import { hash4, makeRng, smoothstep } from '../core/rng';
import { BI, BIOME_IDS } from './biomes';
import { subSeed } from './noise';
import { BODY, CELL, ColumnCtx, MIN_COVER, RC, SHAPE, type AquiferModel, type ResModel, type TrapModel } from './model';
import { FT_PER_BLOCK, pressureModel, ROCK_BASE, rockOfBlock } from './petro';
import { planDikes, planFaults, planFeatures } from './plan';
import { finalizeAquifers, finalizeReservoirs } from './reservoirs';
import { buildOverburdenBands, chooseUnitNames, NUM_HORIZONS, TERRACOTTA_BANDS, U, UNITS } from './strata';
import {
  buildHorizonGrid, diapirDrag, diapirRadius, ellipseQ, faultCrossY, reefMound, SaltBasin, wedgeBaseOffset, wedgeLocal, wedgeThickness,
  type Diapir, type Dike, type Dome, type FaultModel, type HorizonGrid, type OpZone, type Play, type Reef, type Wedge,
} from './structure';
import { Terrain, TF } from './terrain';

const NH = NUM_HORIZONS;
/** Soil modes. */
const SM_LAYER = 0;
const SM_TUNDRA = 1;
const SM_BADLANDS = 2;
/** Fraction of effective stress carried by pore fluid in a fully overpressured cell. */
const LAMBDA_MAX = 0.66;
const BEDROCK_P = [1, 0.62, 0.26, 0.07];

const TWO_PI = Math.PI * 2;

export interface GeologyTimings {
  terrain: number;
  plan: number;
  grid: number;
  reservoirs: number;
  total: number;
}

export class Geology implements IGeology {
  readonly seed: number;
  readonly sizeKey: WorldSizeKey;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly reservoirs: Reservoir[] = [];
  readonly faults: Fault[];
  readonly aquifers: Aquifer[] = [];

  readonly terrain: Terrain;
  readonly unitNames: string[];
  readonly bands: Uint8Array;
  readonly salt: SaltBasin;
  readonly grid: HorizonGrid;
  readonly faultModels: FaultModel[];
  readonly dikes: Dike[];
  readonly diapirs: Diapir[];
  readonly domes: Dome[];
  readonly reefs: Reef[];
  readonly wedges: Wedge[];
  readonly plays: Play[];
  readonly opZones: OpZone[];
  readonly traps: TrapModel[];
  readonly resModels: ResModel[] = [];
  readonly aqModels: AquiferModel[];
  /** Sum of all fault throws (max restored offset). */
  readonly sumThrow: number;
  readonly timings: GeologyTimings;

  // spatial index (CELL×CELL cells)
  readonly cellsN: number;
  private readonly cellTraps: number[][];
  private readonly cellAq: number[][];
  private readonly cellDiapir: number[][];
  private readonly cellReef: number[][];
  private readonly cellWedge: number[][];

  private readonly qctx = new ColumnCtx();
  private readonly resById = new Map<string, Reservoir>();
  private readonly hseed: number;
  private readonly propSeed: number;
  private readonly loc = { u: 0, v: 0 };
  private readonly pOut = { pp: 0, sv: 0, frac: 0 };

  constructor(seed: number, sizeKey: WorldSizeKey) {
    const t0 = performance.now();
    this.seed = seed | 0;
    this.sizeKey = sizeKey;
    const size = WORLD_SIZES[sizeKey] ?? WORLD_SIZES.medium;
    this.sizeX = size;
    this.sizeZ = size;
    this.hseed = subSeed(this.seed, 900);
    this.propSeed = subSeed(this.seed, 901);

    this.terrain = new Terrain(this.seed, size);
    const t1 = performance.now();

    const nameRng = makeRng(subSeed(this.seed, 150));
    this.unitNames = chooseUnitNames(nameRng);
    this.bands = buildOverburdenBands(makeRng(subSeed(this.seed, 151)));
    this.salt = new SaltBasin(this.seed, this.terrain);
    this.faultModels = planFaults(this.seed, this.terrain);
    this.faults = this.faultModels.map((f) => f.pub);
    this.sumThrow = this.faultModels.reduce((s, f) => s + f.throw, 0);
    this.dikes = planDikes(this.seed, size);

    const baseGrid = buildHorizonGrid(this.seed, this.terrain, this.salt, { domes: [], reefs: [], wedges: [], plays: [], opZones: [] });
    const plan = planFeatures(this.seed, this.terrain, baseGrid, this.salt, this.faultModels, this.unitNames);
    this.diapirs = plan.diapirs;
    this.domes = plan.domes;
    this.reefs = plan.reefs;
    this.wedges = plan.wedges;
    this.plays = plan.plays;
    this.opZones = plan.opZones;
    this.traps = plan.traps;
    this.aqModels = plan.aquifers;
    const t2 = performance.now();

    this.grid = buildHorizonGrid(this.seed, this.terrain, this.salt, plan);
    const t3 = performance.now();

    // spatial index
    this.cellsN = Math.ceil(size / CELL);
    const nc = this.cellsN * this.cellsN;
    const mk = () => Array.from({ length: nc }, () => [] as number[]);
    this.cellTraps = mk();
    this.cellAq = mk();
    this.cellDiapir = mk();
    this.cellReef = mk();
    this.cellWedge = mk();
    const sealMask = this.faultModels.reduce((m, f) => m | f.bit, 0);
    this.traps.forEach((t, i) => {
      t.maskAnd = sealMask;
      this.computeTrapBox(t);
      this.indexBox(this.cellTraps, i, t.x0, t.z0, t.x1, t.z1);
    });
    this.aqModels.forEach((a, i) => {
      const ex = Math.max(a.ra, a.rb) + 1;
      this.indexBox(this.cellAq, i, a.cx - ex, a.cz - ex, a.cx + ex, a.cz + ex);
    });
    this.diapirs.forEach((d, i) => this.indexBox(this.cellDiapir, i, d.cx - d.influence, d.cz - d.influence, d.cx + d.influence, d.cz + d.influence));
    this.reefs.forEach((r, i) => this.indexBox(this.cellReef, i, r.cx - r.r * 1.25, r.cz - r.r * 1.25, r.cx + r.r * 1.25, r.cz + r.r * 1.25));
    this.wedges.forEach((w, i) => {
      const ex = w.L + w.W;
      this.indexBox(this.cellWedge, i, w.ox - ex, w.oz - ex, w.ox + ex, w.oz + ex);
    });

    finalizeReservoirs(this);
    for (const r of this.reservoirs) this.resById.set(r.id, r);
    finalizeAquifers(this);
    const t4 = performance.now();
    this.timings = { terrain: t1 - t0, plan: t2 - t1, grid: t3 - t2, reservoirs: t4 - t3, total: t4 - t0 };
  }

  // ------------------------------------------------------------------------------------------------
  // Setup helpers
  // ------------------------------------------------------------------------------------------------

  private computeTrapBox(t: TrapModel): void {
    let ex: number;
    let ez: number;
    if (t.shape === SHAPE.ELLIPSE) {
      const ra = t.ra * t.wl;
      const rb = t.rb * t.wl;
      ex = Math.sqrt((ra * t.cos) ** 2 + (rb * t.sin) ** 2);
      ez = Math.sqrt((ra * t.sin) ** 2 + (rb * t.cos) ** 2);
    } else if (t.shape === SHAPE.WEDGE) {
      const w = this.wedges[t.bodyIdx];
      const cx = w.ox + (w.dx * w.L) / 2;
      const cz = w.oz + (w.dz * w.L) / 2;
      ex = ez = Math.hypot(w.L / 2, w.W) + 1;
      t.cx = cx;
      t.cz = cz;
    } else {
      ex = ez = t.ra * t.wl;
    }
    const s1 = this.sizeX - 1;
    t.x0 = Math.max(0, Math.floor(t.cx - ex - 1));
    t.x1 = Math.min(s1, Math.ceil(t.cx + ex + 1));
    t.z0 = Math.max(0, Math.floor(t.cz - ez - 1));
    t.z1 = Math.min(s1, Math.ceil(t.cz + ez + 1));
  }

  private indexBox(cells: number[][], item: number, x0: number, z0: number, x1: number, z1: number): void {
    const n = this.cellsN;
    const c0 = Math.max(0, Math.floor(x0 / CELL));
    const c1 = Math.min(n - 1, Math.floor(x1 / CELL));
    const r0 = Math.max(0, Math.floor(z0 / CELL));
    const r1 = Math.min(n - 1, Math.floor(z1 / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[c + r * n].push(item);
  }

  /** Register a finalized reservoir model (called by the reservoir scanner). */
  addReservoir(m: ResModel): number {
    this.resModels.push(m);
    this.reservoirs.push(m.pub);
    return this.resModels.length - 1;
  }

  // ------------------------------------------------------------------------------------------------
  // Column preparation
  // ------------------------------------------------------------------------------------------------

  /** Prepare `c` for classification of column (x, z) (integer, in bounds). Cached per context. */
  prepareColumn(c: ColumnCtx, x: number, z: number): void {
    const key = x * 8192 + z;
    if (c.key === key) {
      c.hint = 1;
      return;
    }
    c.key = key;
    const t = this.terrain;
    const i = x + z * t.size;
    c.x = x;
    c.z = z;
    c.i = i;
    const g = t.ground[i];
    c.ground = g;
    c.waterTop = g <= SEA_LEVEL ? SEA_LEVEL : -1;
    c.biome = t.biome[i];
    c.flags = t.flags[i];
    c.slope = t.slope[i];
    c.temp = t.temp[i];
    c.patch = t.patch[i];
    c.hash = hash4(this.hseed, x, z);
    this.setupSoil(c);

    const fx = x + 0.5;
    const fz = z + 0.5;
    const grid = this.grid;
    const n00 = grid.sampleAll(fx, fz, c.hz, c.w);
    c.op = grid.field(grid.op, n00, c.w);
    c.saltPres = grid.field(grid.salt, n00, c.w);
    c.dolo = grid.field(grid.dolo, n00, c.w) > 0.3;

    const fm = this.faultModels;
    c.nF = fm.length;
    for (let f = 0; f < fm.length; f++) c.fy[f] = faultCrossY(fm[f], fx, fz);

    c.dike = false;
    for (let k = 0; k < this.dikes.length; k++) {
      const d = this.dikes[k];
      const vx = d.x1 - d.x0;
      const vz = d.z1 - d.z0;
      const l2 = vx * vx + vz * vz;
      let s = ((fx - d.x0) * vx + (fz - d.z0) * vz) / l2;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const ex = d.x0 + vx * s - fx;
      const ez = d.z0 + vz * s - fz;
      if (ex * ex + ez * ez < d.w * d.w) {
        c.dike = true;
        break;
      }
    }

    const cell = (x >> 4) + (z >> 4) * this.cellsN;
    const hz = c.hz;

    // salt diapir (stock + flank drag of the overlying horizons)
    c.dIdx = -1;
    const dl = this.cellDiapir[cell];
    for (let k = 0; k < dl.length; k++) {
      const d = this.diapirs[dl[k]];
      const dx = fx - d.cx;
      const dz = fz - d.cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r >= d.influence) continue;
      c.dIdx = dl[k];
      c.dR = r;
      const th = Math.atan2(dz, dx);
      c.dMod = 1 + 0.11 * Math.sin(3 * th + d.phase) + 0.05 * Math.sin(7 * th - 2 * d.phase);
      const rEff = r / c.dMod;
      for (let h = U.SALT; h < NH; h++) hz[h] += diapirDrag(d, rEff, hz[h]);
      for (let h = 1; h < NH; h++) if (hz[h] < hz[h - 1]) hz[h] = hz[h - 1];
      break;
    }

    // reef mound
    c.reef = -1;
    const rl = this.cellReef[cell];
    for (let k = 0; k < rl.length; k++) {
      const m = reefMound(this.reefs[rl[k]], fx, fz);
      if (m > 0) {
        c.reef = rl[k];
        c.reefTop = hz[U.PLATFORM] + m;
        break;
      }
    }

    // sand wedge
    c.wedge = -1;
    const wl = this.cellWedge[cell];
    for (let k = 0; k < wl.length; k++) {
      const w = this.wedges[wl[k]];
      wedgeLocal(w, fx, fz, this.loc);
      const th = wedgeThickness(w, this.loc.u, this.loc.v);
      if (th > 0.05) {
        c.wedge = wl[k];
        c.wU = this.loc.u;
        c.wBase = hz[w.unit - 1] + wedgeBaseOffset(w, this.loc.u);
        c.wTop = c.wBase + th;
        break;
      }
    }

    // trap regions
    c.nT = 0;
    const tl = this.cellTraps[cell];
    for (let k = 0; k < tl.length && c.nT < c.tIdx.length; k++) {
      const code = this.trapCode(tl[k], fx, fz, c);
      if (code) {
        c.tIdx[c.nT] = tl[k];
        c.tCode[c.nT++] = code;
      }
    }

    // aquifers
    c.nA = 0;
    const al = this.cellAq[cell];
    for (let k = 0; k < al.length && c.nA < c.aIdx.length; k++) {
      const a = this.aqModels[al[k]];
      if (ellipseQ(a.cx, a.cz, a.ra, a.rb, a.cos, a.sin, fx, fz) <= 1) c.aIdx[c.nA++] = al[k];
    }
    c.hint = 1;
  }

  private trapCode(ti: number, fx: number, fz: number, c: ColumnCtx): number {
    const t = this.traps[ti];
    switch (t.shape) {
      case SHAPE.ELLIPSE: {
        const q = ellipseQ(t.cx, t.cz, t.ra, t.rb, t.cos, t.sin, fx, fz);
        if (q <= 1) return RC.HC | RC.WATER_LEG | (q >= 0.74 ? RC.RING : 0);
        return q <= t.wl * t.wl ? RC.WATER_LEG : 0;
      }
      case SHAPE.SECTOR: {
        const dx = fx - t.cx;
        const dz = fz - t.cz;
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r > t.ra * t.wl) return 0;
        let d = Math.atan2(dz, dx) - t.secMid;
        d -= TWO_PI * Math.round(d / TWO_PI);
        if (Math.abs(d) > t.secHalf) return 0;
        if (r <= t.ra) return RC.HC | RC.WATER_LEG | (r >= 0.8 * t.ra ? RC.RING : 0);
        return RC.WATER_LEG;
      }
      case SHAPE.WEDGE: {
        if (c.wedge !== t.bodyIdx) return 0;
        return RC.HC | RC.WATER_LEG | (c.wU < 0.15 * this.wedges[t.bodyIdx].L ? RC.RING : 0);
      }
      default: {
        const dx = fx - t.cx;
        const dz = fz - t.cz;
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r > t.ra) return 0;
        return RC.HC | (r >= 0.8 * t.ra ? RC.RING : 0);
      }
    }
  }

  private setupSoil(c: ColumnCtx): void {
    const b = c.biome;
    const s = c.slope;
    const f = c.flags;
    const g = c.ground;
    const h = c.hash;
    const p = c.patch;
    c.soilMode = SM_LAYER;
    c.redDepth = 0;
    c.deep = 0;
    if (f & TF.WATER) {
      if (f & TF.OCEAN) {
        const wd = SEA_LEVEL + 1 - g;
        if (wd < 6) {
          c.top = p > 200 ? B.GRAVEL : B.SAND;
          c.sub = B.SAND;
        } else if (wd < 16) {
          c.top = p > 180 ? B.GRAVEL : p < 64 ? B.CLAY : B.SAND;
          c.sub = p < 100 ? B.SEABED_SILT : B.SAND;
        } else {
          c.top = B.SEABED_SILT;
          c.sub = B.SEABED_SILT;
        }
        c.soilDepth = 2 + (h & 3);
      } else if (b === BI.SWAMP) {
        c.top = B.MUD;
        c.sub = B.CLAY;
        c.soilDepth = 2;
      } else if (f & TF.RIVER) {
        c.top = p > 150 ? B.GRAVEL : B.SAND;
        c.sub = p < 80 ? B.CLAY : B.SAND;
        c.soilDepth = 2 + (h & 1);
      } else {
        c.top = p > 170 ? B.GRAVEL : p < 90 ? B.CLAY : B.SAND;
        c.sub = B.CLAY;
        c.soilDepth = 2;
      }
      return;
    }
    switch (b) {
      case BI.FOREST:
      case BI.BIRCH:
      case BI.PLAINS:
        c.top = b === BI.FOREST && p > 178 ? B.PODZOL : B.GRASS;
        c.sub = B.DIRT;
        c.soilDepth = 3 + (h & 1);
        break;
      case BI.TAIGA:
        c.top = c.temp < 72 && p < 110 ? B.SNOW : p > 120 ? B.PODZOL : B.GRASS;
        c.sub = B.DIRT;
        c.soilDepth = 3;
        break;
      case BI.TUNDRA:
        c.soilMode = SM_TUNDRA;
        c.soilDepth = 4 + (h & 1);
        break;
      case BI.DESERT:
        c.top = B.SAND;
        c.sub = B.SAND;
        c.soilDepth = 4 + (h & 1);
        break;
      case BI.BADLANDS:
        c.soilMode = SM_BADLANDS;
        c.soilDepth = 11 + (h & 7);
        c.redDepth = s <= 1 ? 1 + ((h >> 3) & 1) : 0;
        break;
      case BI.SWAMP:
        c.top = p > 150 ? B.MUD : B.GRASS;
        c.sub = B.DIRT;
        c.deep = B.CLAY;
        c.soilDepth = 3;
        break;
      case BI.MOUNTAINS: {
        const snowLine = 110 + ((p - 128) >> 4);
        if (g > snowLine) {
          c.top = B.SNOW;
          c.sub = B.STONE;
          c.soilDepth = 2;
        } else if (s <= 2 && g < 106) {
          c.top = B.GRASS;
          c.sub = B.DIRT;
          c.soilDepth = 2;
        } else {
          c.top = s >= 3 && p > 190 ? B.GRAVEL : B.STONE;
          c.sub = B.STONE;
          c.soilDepth = 1 + (h & 1);
        }
        return;
      }
      case BI.BEACH:
        c.top = c.temp < 76 ? B.GRAVEL : B.SAND;
        c.sub = B.SAND;
        c.soilDepth = 4;
        break;
      default:
        c.top = B.GRASS;
        c.sub = B.DIRT;
        c.soilDepth = 3;
    }
    if (f & TF.BEACH && b !== BI.BEACH && b !== BI.DESERT && b !== BI.BADLANDS) {
      c.soilMode = SM_LAYER;
      c.top = B.SAND;
      c.sub = B.SAND;
      c.soilDepth = 3;
    }
    if (b !== BI.BADLANDS && s >= 4) {
      if (b === BI.TUNDRA) c.soilDepth = 1;
      else c.soilDepth = 0;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Classification (hot path)
  // ------------------------------------------------------------------------------------------------

  /** Geological block at height y of the prepared column (no decorations). Sets c.res / c.aq / c.wl. */
  classify(c: ColumnCtx, y: number): number {
    c.res = -1;
    c.aq = -1;
    c.wl = false;
    c.unit = -1;
    c.body = 0;
    if (y <= 3) {
      if (y < 0) return B.BEDROCK;
      if (y === 0 || hash4(this.hseed, c.x, y, c.z) / 4294967296 < BEDROCK_P[y]) return B.BEDROCK;
    }
    const g = c.ground;
    if (y >= g) return y <= c.waterTop ? B.WATER : B.AIR;
    const d = g - 1 - y;
    if (d < c.soilDepth) return this.soil(c, d, y);
    const pre = this.structural(c, y);
    if (pre >= 0) return pre;
    return this.fluids(c, y);
  }

  private soil(c: ColumnCtx, d: number, y: number): number {
    if (c.soilMode === SM_TUNDRA) return d === 0 ? B.SNOW : d === 1 ? B.DIRT : B.PERMAFROST;
    if (c.soilMode === SM_BADLANDS) return d < c.redDepth ? B.RED_SAND : TERRACOTTA_BANDS[y % TERRACOTTA_BANDS.length];
    if (d === 0) return c.top;
    if (c.deep && d >= 2) return c.deep;
    return c.sub;
  }

  /** Restored (pre-faulting) elevation of the centre of voxel y in the prepared column. */
  restoredY(c: ColumnCtx, y: number): number {
    const yc = y + 0.5;
    let off = 0;
    for (let f = 0; f < c.nF; f++) if (yc > c.fy[f]) off += this.faultModels[f].throw;
    return yc + off;
  }

  /** Faults, salt, unit & body lookup. Returns a block id when decided here, else −1. */
  private structural(c: ColumnCtx, y: number): number {
    const yc = y + 0.5;
    let off = 0;
    let mask = 0;
    let gouge = false;
    const fy = c.fy;
    const fm = this.faultModels;
    for (let f = 0; f < c.nF; f++) {
      const t = yc - fy[f];
      if (t > 0) {
        const m = fm[f];
        off += m.throw;
        mask |= m.bit;
        if (m.sealing && t < m.gougeW) gouge = true;
      }
    }
    const yr = yc + off;
    c.yr = yr;
    c.mask = mask;
    const hz = c.hz;

    if (c.dIdx >= 0) {
      const dp = this.diapirs[c.dIdx];
      if (y <= dp.topY + dp.cap && yr >= hz[U.SALT - 1]) {
        if (c.dR < diapirRadius(dp, y) * c.dMod) {
          c.unit = U.SALT;
          return B.SALT;
        }
        if (c.dR < diapirRadius(dp, y - dp.cap) * c.dMod) {
          c.unit = U.ANHYDRITE;
          return B.CAPROCK;
        }
      }
    }
    if (gouge) return B.CLAY;

    let k = c.hint;
    while (k > 0 && yr < hz[k - 1]) k--;
    while (k < NH && yr >= hz[k]) k++;
    c.hint = k;
    c.unit = k;
    if (c.reef >= 0 && k === U.LOWER_SHALE && yr < c.reefTop) c.body = BODY.REEF;
    else if (c.wedge >= 0 && k === this.wedges[c.wedge].unit && yr >= c.wBase && yr < c.wTop) c.body = BODY.WEDGE;
    return -1;
  }

  private matchHost(t: TrapModel, c: ColumnCtx): boolean {
    if (t.body === BODY.UNIT) return c.body === BODY.UNIT && c.unit === t.unit;
    if (t.body === BODY.REEF) return c.body === BODY.REEF && c.reef === t.bodyIdx;
    return c.body === BODY.WEDGE && c.wedge === t.bodyIdx;
  }

  private fluids(c: ColumnCtx, y: number): number {
    const nT = c.nT;
    if (nT > 0) {
      const covered = c.ground - y >= MIN_COVER && y >= 4;
      for (let j = 0; j < nT; j++) {
        if (!(c.tCode[j] & RC.HC) || !covered) continue;
        const t = this.traps[c.tIdx[j]];
        if (!this.matchHost(t, c)) continue;
        const ri = t.comp[c.mask & t.maskAnd];
        if (ri < 0) continue;
        const r = this.resModels[ri];
        if (y < r.owcY) continue;
        c.res = ri;
        return r.allGas || y >= r.gocY ? r.blockGas : r.blockOil;
      }
      for (let j = 0; j < nT; j++) {
        if (!(c.tCode[j] & RC.WATER_LEG)) continue;
        const t = this.traps[c.tIdx[j]];
        if (t.brine && this.matchHost(t, c)) {
          c.wl = true;
          return B.BRINE_SANDSTONE;
        }
      }
    }
    const u = c.unit;
    if (c.body === BODY.UNIT) {
      for (let j = 0; j < c.nA; j++) {
        const ai = c.aIdx[j];
        if (this.aqModels[ai].unit === u) {
          c.aq = ai;
          return B.BRINE_SANDSTONE;
        }
      }
    } else if (c.body === BODY.REEF) return B.LIMESTONE;
    else return B.SANDSTONE;

    switch (u) {
      case U.BASEMENT:
        return c.dike ? B.BASALT : B.GRANITE;
      case U.PLATFORM:
        return c.dolo ? B.DOLOMITE : B.LIMESTONE;
      case U.COAL: {
        const rel = c.yr - c.hz[U.COAL - 1];
        const th = c.hz[U.COAL] - c.hz[U.COAL - 1];
        if ((rel >= 0.9 && rel < 1.9) || (th > 3.2 && rel >= th - 1.7 && rel < th - 0.7)) return B.COAL_SEAM;
        return B.MUDSTONE;
      }
      case U.OVERBURDEN: {
        let a = Math.floor(c.yr - c.hz[NH - 1]);
        if (a > 255) a = 255;
        else if (a < 0) a = 0;
        return this.bands[a];
      }
      default:
        return UNITS[u].block;
    }
  }

  /** Host test used by the trap scanner: compartment mask if voxel y is an HC-eligible host voxel of trap t, else −1. */
  hostMask(c: ColumnCtx, y: number, t: TrapModel): number {
    if (y <= 3 || y >= c.ground || c.ground - y < MIN_COVER) return -1;
    if (c.ground - 1 - y < c.soilDepth) return -1;
    c.unit = -1;
    c.body = 0;
    if (this.structural(c, y) >= 0) return -1;
    if (!this.matchHost(t, c)) return -1;
    return c.mask & t.maskAnd;
  }

  /** Candidate y range [lo, hi] for host voxels of trap t in the prepared column. */
  hostRange(c: ColumnCtx, t: TrapModel, out: { lo: number; hi: number }): void {
    let lo: number;
    let hi: number;
    if (t.body === BODY.REEF) {
      lo = c.hz[U.PLATFORM] - this.sumThrow - 1;
      hi = (c.reef === t.bodyIdx ? c.reefTop : c.hz[U.PLATFORM]) + 1;
    } else if (t.body === BODY.WEDGE) {
      lo = (c.wedge === t.bodyIdx ? c.wBase : c.hz[t.unit - 1]) - this.sumThrow - 1;
      hi = (c.wedge === t.bodyIdx ? c.wTop : c.hz[t.unit]) + 1;
    } else {
      lo = c.hz[t.unit - 1] - this.sumThrow - 1;
      hi = c.hz[t.unit] + 1;
    }
    out.lo = Math.max(4, Math.floor(lo));
    out.hi = Math.min(c.ground - MIN_COVER, Math.ceil(hi));
  }

  /** Which candidate slot of the prepared column refers to trap ti (−1 if none). */
  trapSlot(c: ColumnCtx, ti: number): number {
    for (let j = 0; j < c.nT; j++) if (c.tIdx[j] === ti) return j;
    return -1;
  }

  // ------------------------------------------------------------------------------------------------
  // IGeology
  // ------------------------------------------------------------------------------------------------

  private col(x: number, z: number): ColumnCtx {
    const s1 = this.sizeX - 1;
    let ix = Math.floor(x);
    let iz = Math.floor(z);
    ix = ix < 0 ? 0 : ix > s1 ? s1 : ix;
    iz = iz < 0 ? 0 : iz > s1 ? s1 : iz;
    this.prepareColumn(this.qctx, ix, iz);
    return this.qctx;
  }

  surfaceHeight(x: number, z: number): number {
    return this.terrain.ground[this.terrain.index(Math.floor(x), Math.floor(z))];
  }

  waterDepth(x: number, z: number): number {
    return this.terrain.waterDepthAt(this.terrain.index(Math.floor(x), Math.floor(z)));
  }

  isOffshore(x: number, z: number): boolean {
    return (this.terrain.flags[this.terrain.index(Math.floor(x), Math.floor(z))] & TF.OCEAN) !== 0;
  }

  biomeAt(x: number, z: number): BiomeId {
    return BIOME_IDS[this.terrain.biome[this.terrain.index(Math.floor(x), Math.floor(z))]];
  }

  /** Geological block at a voxel (no vegetation/ores/caves, no player edits). */
  blockAt(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return B.AIR;
    const c = this.col(x, z);
    return this.classify(c, Math.floor(y));
  }

  rockAt(x: number, y: number, z: number): RockType {
    return rockOfBlock(this.blockAt(x, y, z));
  }

  reservoirAt(x: number, y: number, z: number): Reservoir | null {
    if (y < 0 || y >= WORLD_HEIGHT) return null;
    const c = this.col(x, z);
    this.classify(c, Math.floor(y));
    return c.res >= 0 ? this.resModels[c.res].pub : null;
  }

  aquiferAt(x: number, y: number, z: number): Aquifer | null {
    if (y < 0 || y >= WORLD_HEIGHT) return null;
    const c = this.col(x, z);
    this.classify(c, Math.floor(y));
    return c.aq >= 0 ? this.aqModels[c.aq].pub : null;
  }

  getReservoir(id: string): Reservoir | undefined {
    return this.resById.get(id);
  }

  /** Overpressure ratio λ at restored elevation yr in the prepared column. */
  private lambdaAt(c: ColumnCtx, yr: number): number {
    const hz = c.hz;
    let lam = 0;
    if (c.op > 0) lam = c.op * LAMBDA_MAX * smoothstep(hz[U.SEAL], hz[U.SEAL - 1] - 1, yr);
    if (c.saltPres > 0.3) {
      const ws = smoothstep(hz[U.ANHYDRITE], hz[U.SALT - 1] - 1, yr) * smoothstep(0.3, 0.7, c.saltPres);
      lam = Math.max(lam, 0.55 * LAMBDA_MAX * ws);
    }
    return lam;
  }

  /** Background pressure model at voxel y of a prepared column (ignores reservoirs). */
  private background(c: ColumnCtx, y: number): { pp: number; sv: number; frac: number } {
    const out = this.pOut;
    const g = c.ground;
    const wd = g <= SEA_LEVEL ? SEA_LEVEL + 1 - g : 0;
    if (y >= g) {
      const p = y <= c.waterTop ? (SEA_LEVEL + 1 - y - 0.5) * FT_PER_BLOCK * 0.445 : 0;
      out.pp = p;
      out.sv = p;
      out.frac = p;
      return out;
    }
    const sed = g - y - 0.5;
    const lam = g - 1 - y < c.soilDepth ? 0 : this.lambdaAt(c, this.restoredY(c, y));
    pressureModel(wd, sed, lam, out);
    return out;
  }

  private reservoirPressure(r: ResModel, y: number): number {
    return r.pub.initialPressure + (r.midY - y) * FT_PER_BLOCK * r.grad;
  }

  porePressure(x: number, y: number, z: number): number {
    const c = this.col(x, z);
    const yi = Math.floor(y);
    if (yi >= WORLD_HEIGHT) return 0;
    this.classify(c, yi);
    if (c.res >= 0) return this.reservoirPressure(this.resModels[c.res], yi);
    return this.background(c, yi).pp;
  }

  fracturePressure(x: number, y: number, z: number): number {
    const c = this.col(x, z);
    const yi = Math.floor(y);
    if (yi >= WORLD_HEIGHT) return 0;
    this.classify(c, yi);
    const ri = c.res;
    const bg = this.background(c, yi);
    if (ri < 0) return bg.frac;
    const pr = this.reservoirPressure(this.resModels[ri], yi);
    if (pr <= bg.pp) return bg.frac;
    const g = c.ground;
    const K = 0.58 + 0.27 * smoothstep(0, 60, g - yi);
    return Math.max(bg.frac, pr + K * Math.max(0, bg.sv - pr), pr * 1.04);
  }

  /** Background pore pressure ignoring reservoirs (used to initialise reservoir pressures). */
  backgroundPressure(x: number, y: number, z: number): number {
    const c = this.col(x, z);
    return this.background(c, Math.floor(y)).pp;
  }

  properties(x: number, y: number, z: number): RockProperties {
    const yi = Math.floor(y);
    if (yi >= WORLD_HEIGHT) return airProps();
    const c = this.col(x, z);
    const blk = this.classify(c, yi);
    if (blk === B.AIR) return airProps();
    if (blk === B.WATER) {
      return { rock: 'water', porosity: 1, permeability: 0, hardness: 0.3, impedance: 1.5, gammaRay: 10, resistivity: 0.5, density: 1.03, fluid: 'brine' };
    }
    const base = ROCK_BASE[blk] ?? ROCK_BASE[B.STONE]!;
    const ix = c.x;
    const iz = c.z;
    const h = hash4(this.propSeed, ix, yi, iz);
    const j1 = (h & 1023) / 1023 - 0.5;
    const j2 = ((h >>> 10) & 1023) / 1023 - 0.5;
    const j3 = ((h >>> 20) & 1023) / 1023 - 0.5;
    const depth = Math.max(0, c.ground - yi);
    const comp = Math.min(depth, 90);
    let porosity = base.phi * Math.exp(-comp / 160) * (1 + 0.12 * j1);
    let perm = base.perm * Math.exp(-comp / 90) * (1 + 0.5 * j2);
    let impedance = base.imp * (1 + 0.0032 * comp) * (1 + 0.025 * j3);
    let gammaRay = base.gr * (1 + 0.1 * j2);
    let resistivity = base.rt * (1 + 0.25 * j1);
    let density = base.rho + 0.004 * comp * (base.rho > 1.5 ? 1 : 0) * 0.1;
    let fluid: RockProperties['fluid'] = base.fluid;
    let reservoirId: string | undefined;
    let aquiferId: string | undefined;

    if (c.res >= 0) {
      const r = this.resModels[c.res];
      const p = r.pub;
      porosity = p.porosity * (1 + 0.18 * j1);
      perm = p.permeability * Math.exp(0.8 * j2);
      const gas = r.allGas || yi >= r.gocY;
      fluid = gas ? 'gas' : 'oil';
      reservoirId = p.id;
      const sh = 1 - p.waterSaturation;
      resistivity = (gas ? 70 : 30) + (gas ? 130 : 80) * sh * (1 + 0.2 * j3);
      if (p.lithology === 'shale') resistivity *= 0.45;
    } else if (blk === B.BRINE_SANDSTONE) {
      if (c.aq >= 0) {
        const a = this.aqModels[c.aq].pub;
        aquiferId = a.id;
        if (a.fresh) {
          fluid = 'fresh';
          resistivity = 25 + 35 * (0.5 + j1);
        } else {
          fluid = 'brine';
          resistivity = Math.max(0.5, 0.6 + 60000 / a.salinity * (0.4 + 0.2 * j1));
        }
      } else {
        fluid = 'brine';
      }
    }
    if (resistivity > 200) resistivity = 200;
    if (resistivity < 0.5) resistivity = 0.5;
    if (gammaRay > 150) gammaRay = 150;
    if (gammaRay < 5) gammaRay = 5;
    if (fluid === 'none' && porosity < 0.02) porosity = Math.max(0, porosity);
    return {
      rock: base.rock,
      porosity: Math.max(0, porosity),
      permeability: Math.max(0.001, perm),
      hardness: base.hard,
      impedance,
      gammaRay,
      resistivity,
      density,
      fluid,
      reservoirId,
      aquiferId,
    };
  }

  // ------------------------------------------------------------------------------------------------
  // Extras (not in the IGeology contract; available via the concrete class)
  // ------------------------------------------------------------------------------------------------

  /** Formation name at a voxel (for well-log tops & scanner readouts). */
  formationAt(x: number, y: number, z: number): string {
    const c = this.col(x, z);
    const yi = Math.floor(y);
    const blk = this.classify(c, yi);
    if (blk === B.AIR) return 'Air';
    if (blk === B.WATER) return 'Sea Water';
    if (yi >= c.ground - c.soilDepth) return c.soilMode === SM_BADLANDS ? 'Red Beds' : 'Soil';
    if (blk === B.BEDROCK) return 'Bedrock';
    if (c.res >= 0) return this.resModels[c.res].pub.name;
    if (c.unit === U.SALT && c.dIdx >= 0 && blk === B.SALT && c.dR < this.diapirs[c.dIdx].influence) return `${this.diapirs[c.dIdx].name} Salt Dome`;
    if (blk === B.CAPROCK && c.dIdx >= 0) return `${this.diapirs[c.dIdx].name} Caprock`;
    if (blk === B.CLAY && c.unit < 0) return 'Fault Gouge';
    if (c.body === BODY.REEF) return this.reefs[c.reef].name;
    if (c.body === BODY.WEDGE) return this.wedges[c.wedge].name;
    if (c.unit >= 0) return this.unitNames[c.unit];
    return 'Unknown';
  }

  /** Stratigraphic unit index at a voxel (−1 for soil/air/water/bedrock). */
  unitAt(x: number, y: number, z: number): number {
    const c = this.col(x, z);
    this.classify(c, Math.floor(y));
    return c.unit;
  }
}

function airProps(): RockProperties {
  return { rock: 'soil', porosity: 0, permeability: 0, hardness: 0.3, impedance: 0.4, gammaRay: 5, resistivity: 200, density: 0.0012, fluid: 'none' };
}
