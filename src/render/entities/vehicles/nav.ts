// Coarse navigation grids for presentation vehicles: a land grid (2×2-block cells) for tanker trucks
// and a water grid (4×4-block cells) for tankers. Cells are evaluated lazily from the terrain
// (surface height, water, trees, player-built obstacles), building footprints and asphalt roads, and
// re-evaluated when the world changes. Searches are incremental A* jobs (a node budget per frame) from
// a start point to the nearest reachable map edge; results are string-pulled against the grid costs.
import { B } from '../../../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../../../core/constants';
import type { GameContext } from '../../../core/types';
import type { Terrain } from './terrain';

export type Pt = [number, number];

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Binary min-heap of cell indices keyed by f. */
class MinHeap {
  private idx = new Int32Array(1024);
  private key = new Float64Array(1024);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  push(i: number, f: number): void {
    if (this.size === this.idx.length) {
      const ni = new Int32Array(this.size * 2);
      ni.set(this.idx);
      const nk = new Float64Array(this.size * 2);
      nk.set(this.key);
      this.idx = ni;
      this.key = nk;
    }
    let p = this.size++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.key[q] <= f) break;
      this.idx[p] = this.idx[q];
      this.key[p] = this.key[q];
      p = q;
    }
    this.idx[p] = i;
    this.key[p] = f;
  }

  pop(): number {
    const top = this.idx[0];
    const n = --this.size;
    if (n > 0) {
      const li = this.idx[n];
      const lk = this.key[n];
      let p = 0;
      for (;;) {
        let c = p * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && this.key[c + 1] < this.key[c]) c++;
        if (this.key[c] >= lk) break;
        this.idx[p] = this.idx[c];
        this.key[p] = this.key[c];
        p = c;
      }
      this.idx[p] = li;
      this.key[p] = lk;
    }
    return top;
  }
}

export interface SearchResult {
  /** World-space waypoints from the start to the map edge (string-pulled). */
  points: Pt[];
  /** Nav version the path was computed for. */
  version: number;
}

interface Job {
  sx: number;
  sz: number;
  start: number;
  budget: number;
  used: number;
  started: boolean;
  cb: (r: SearchResult | null) => void;
  cancelled: boolean;
}

export interface SearchHandle {
  cancel(): void;
}

/** Shared grid plumbing: lazy cells, footprint mask, incremental A* to the map edge. */
export abstract class GridNav {
  readonly W: number;
  readonly H: number;
  /** 0 = not evaluated, 1 = evaluated. */
  protected readonly known: Uint8Array;
  protected readonly height: Float32Array;
  protected readonly flags: Uint8Array;
  protected readonly bldg: Uint8Array;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap = new MinHeap();
  private stamp = 0;
  private readonly queue: Job[] = [];
  private bldgDirty = true;
  private bldgKey = '';
  private extra: { x0: number; z0: number; x1: number; z1: number; r: number }[] = [];
  private extraKey = '';
  /** Bumped whenever routes should be recomputed (buildings, roads). */
  version = 1;

  constructor(
    protected readonly ctx: GameContext,
    protected readonly terrain: Terrain,
    readonly cell: number,
    /** Blocks of clearance around building footprints. */
    private readonly clearance: number,
  ) {
    this.W = Math.ceil(ctx.world.sizeX / cell);
    this.H = Math.ceil(ctx.world.sizeZ / cell);
    const n = this.W * this.H;
    this.known = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.flags = new Uint8Array(n);
    this.bldg = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** Fill height/flags of cell i (cx, cz). */
  protected abstract evaluate(i: number, cx: number, cz: number): void;
  /** Whether a cell can be entered (ignoring building footprints). */
  protected abstract open(i: number): boolean;
  /** Cost of stepping from a to b (b open); Infinity to forbid. */
  protected abstract step(a: number, b: number, diag: boolean): number;
  /** Lower bound of the per-cell cost (heuristic scale). */
  protected abstract readonly minCost: number;
  /** Goal test for a border cell. */
  protected abstract goal(i: number): boolean;

  cellOf(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.W - 1, Math.floor(x / this.cell)));
    const cz = Math.max(0, Math.min(this.H - 1, Math.floor(z / this.cell)));
    return cx + cz * this.W;
  }

  centerOf(i: number): Pt {
    const cx = i % this.W;
    const cz = (i - cx) / this.W;
    return [(cx + 0.5) * this.cell, (cz + 0.5) * this.cell];
  }

  protected ensure(i: number): void {
    if (this.known[i]) return;
    const cx = i % this.W;
    const cz = (i - cx) / this.W;
    this.evaluate(i, cx, cz);
    this.known[i] = 1;
  }

  passable(i: number): boolean {
    this.ensure(i);
    return !this.bldg[i] && this.open(i);
  }

  /** Forget evaluated cells inside a block rectangle (terrain edits, chunk generation). */
  invalidateBlocks(x0: number, z0: number, x1: number, z1: number): void {
    const c0 = Math.max(0, Math.floor(x0 / this.cell));
    const c1 = Math.min(this.W - 1, Math.floor(x1 / this.cell));
    const r0 = Math.max(0, Math.floor(z0 / this.cell));
    const r1 = Math.min(this.H - 1, Math.floor(z1 / this.cell));
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) this.known[cx + cz * this.W] = 0;
  }

  invalidateChunk(cx: number, cz: number): void {
    this.invalidateBlocks(cx * CHUNK_SIZE, cz * CHUNK_SIZE, cx * CHUNK_SIZE + CHUNK_SIZE - 1, cz * CHUNK_SIZE + CHUNK_SIZE - 1);
  }

  /** Buildings changed: rebuild the footprint mask lazily and invalidate cached routes. */
  markBuildingsDirty(): void {
    this.bldgDirty = true;
  }

  /** Extra blocked capsules (e.g. jetties reaching beyond a footprint). Cheap when unchanged. */
  setExtraObstacles(list: { x0: number; z0: number; x1: number; z1: number; r: number }[]): void {
    const key = list.map((o) => `${o.x0.toFixed(1)},${o.z0.toFixed(1)},${o.x1.toFixed(1)},${o.z1.toFixed(1)},${o.r}`).join(';');
    if (key === this.extraKey) return;
    this.extraKey = key;
    this.extra = list;
    this.bldgDirty = true;
    this.bldgKey = '';
  }

  /** Rebuild the footprint mask if the building set changed. */
  refreshBuildings(): void {
    if (!this.bldgDirty) return;
    this.bldgDirty = false;
    const bs = this.ctx.state.buildings;
    let key = this.extraKey;
    for (const id in bs) {
      const b = bs[id];
      key += `${id}:${b.x},${b.z},${b.size[0]},${b.size[1]};`;
    }
    if (key === this.bldgKey) return;
    this.bldgKey = key;
    this.bldg.fill(0);
    const c = this.clearance;
    for (const id in bs) {
      const b = bs[id];
      const c0 = Math.max(0, Math.floor((b.x - c) / this.cell));
      const c1 = Math.min(this.W - 1, Math.floor((b.x + b.size[0] + c - 0.001) / this.cell));
      const r0 = Math.max(0, Math.floor((b.z - c) / this.cell));
      const r1 = Math.min(this.H - 1, Math.floor((b.z + b.size[1] + c - 0.001) / this.cell));
      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) this.bldg[cx + cz * this.W] = 1;
    }
    for (const o of this.extra) {
      const c0 = Math.max(0, Math.floor((Math.min(o.x0, o.x1) - o.r) / this.cell));
      const c1 = Math.min(this.W - 1, Math.floor((Math.max(o.x0, o.x1) + o.r) / this.cell));
      const r0 = Math.max(0, Math.floor((Math.min(o.z0, o.z1) - o.r) / this.cell));
      const r1 = Math.min(this.H - 1, Math.floor((Math.max(o.z0, o.z1) + o.r) / this.cell));
      const dx = o.x1 - o.x0;
      const dz = o.z1 - o.z0;
      const L2 = Math.max(1e-6, dx * dx + dz * dz);
      const rr = (o.r + this.cell * 0.71) ** 2;
      for (let cz = r0; cz <= r1; cz++)
        for (let cx = c0; cx <= c1; cx++) {
          const px = (cx + 0.5) * this.cell;
          const pz = (cz + 0.5) * this.cell;
          const t = Math.max(0, Math.min(1, ((px - o.x0) * dx + (pz - o.z0) * dz) / L2));
          const qx = o.x0 + dx * t - px;
          const qz = o.z0 + dz * t - pz;
          if (qx * qx + qz * qz <= rr) this.bldg[cx + cz * this.W] = 1;
        }
    }
    this.version++;
  }

  /** Queue a search from (x, z) to the nearest reachable goal on the map border. */
  search(x: number, z: number, cb: (r: SearchResult | null) => void, budget = 90000): SearchHandle {
    const job: Job = { sx: x, sz: z, start: this.cellOf(x, z), budget, used: 0, started: false, cb, cancelled: false };
    this.queue.push(job);
    return { cancel: () => (job.cancelled = true) };
  }

  /** Advance queued searches by up to `budget` node expansions. */
  pump(budget: number): void {
    this.refreshBuildings();
    while (budget > 0 && this.queue.length) {
      const job = this.queue[0];
      if (job.cancelled) {
        this.queue.shift();
        continue;
      }
      if (!job.started) this.begin(job);
      const r = this.expand(job, budget);
      budget -= r.used;
      if (r.done) {
        this.queue.shift();
        job.cb(r.result);
      }
    }
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  private edgeDist(i: number): number {
    const cx = i % this.W;
    const cz = (i - cx) / this.W;
    return Math.min(cx, cz, this.W - 1 - cx, this.H - 1 - cz);
  }

  private begin(job: Job): void {
    job.started = true;
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    this.heap.clear();
    const s = job.start;
    this.ensure(s);
    this.g[s] = 0;
    this.parent[s] = -1;
    this.seen[s] = this.stamp;
    this.heap.push(s, this.edgeDist(s) * this.minCost);
  }

  private expand(job: Job, budget: number): { used: number; done: boolean; result: SearchResult | null } {
    const W = this.W;
    const H = this.H;
    const st = this.stamp;
    let used = 0;
    while (this.heap.size > 0) {
      if (used >= budget) return { used, done: false, result: null };
      if (job.used >= job.budget) return { used, done: true, result: null };
      used++;
      job.used++;
      const a = this.heap.pop();
      if (this.closed[a] === st) continue;
      this.closed[a] = st;
      const ax = a % W;
      const az = (a - ax) / W;
      if (a !== job.start && (ax === 0 || az === 0 || ax === W - 1 || az === H - 1) && this.goal(a)) {
        return { used, done: true, result: { points: this.finish(job, a), version: this.version } };
      }
      const ga = this.g[a];
      for (let k = 0; k < 8; k++) {
        const bx = ax + DX[k];
        const bz = az + DZ[k];
        if (bx < 0 || bz < 0 || bx >= W || bz >= H) continue;
        const b = bx + bz * W;
        if (this.closed[b] === st) continue;
        if (!this.passable(b)) continue;
        const diag = k >= 4;
        // no corner cutting past blocked cells
        if (diag && (!this.passable(ax + DX[k] + az * W) || !this.passable(ax + (az + DZ[k]) * W))) continue;
        const c = this.step(a, b, diag);
        if (!Number.isFinite(c)) continue;
        const gb = ga + c;
        if (this.seen[b] === st && gb >= this.g[b]) continue;
        this.seen[b] = st;
        this.g[b] = gb;
        this.parent[b] = a;
        this.heap.push(b, gb + this.edgeDist(b) * this.minCost);
      }
    }
    return { used, done: true, result: null };
  }

  /** Walk parents back, string-pull and convert to world points (start point exact, end on the map edge). */
  private finish(job: Job, goal: number): Pt[] {
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    const g = cells.map((c) => this.g[c]);
    const keep: number[] = [0];
    let i = 0;
    while (i < cells.length - 1) {
      let best = i + 1;
      for (let j = Math.min(cells.length - 1, i + 48); j > i + 1; j--) {
        const lc = this.lineCost(cells[i], cells[j]);
        if (lc <= (g[j] - g[i]) * 1.04 + 0.05) {
          best = j;
          break;
        }
      }
      keep.push(best);
      i = best;
    }
    const pts: Pt[] = keep.map((k) => this.centerOf(cells[k]));
    pts[0] = [job.sx, job.sz];
    // extend the last waypoint onto the map boundary
    const last = pts[pts.length - 1];
    const gx = goal % this.W;
    const gz = (goal - gx) / this.W;
    const sx = this.ctx.world.sizeX;
    const sz = this.ctx.world.sizeZ;
    const e: Pt = [last[0], last[1]];
    if (gx === 0) e[0] = 0.2;
    else if (gx === this.W - 1) e[0] = sx - 0.2;
    else if (gz === 0) e[1] = 0.2;
    else e[1] = sz - 0.2;
    pts.push(e);
    return pts;
  }

  /** Cost of a straight run between two cell centres (Infinity if it crosses a blocked cell). */
  private lineCost(a: number, b: number): number {
    const W = this.W;
    const ax = a % W;
    const az = (a - ax) / W;
    const bx = b % W;
    const bz = (b - bx) / W;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len * 2.5));
    let cost = 0;
    let prev = a;
    let acc = 0;
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const cx = Math.floor(ax + 0.5 + dx * t);
      const cz = Math.floor(az + 0.5 + dz * t);
      const c = cx + cz * W;
      acc += len / n;
      if (c === prev) continue;
      if (!this.passable(c)) return Infinity;
      // treat the accumulated run as a sequence of unit steps into cell c
      const px = prev % W;
      const pz = (prev - px) / W;
      const diag = px !== cx && pz !== cz;
      if (diag && (!this.passable(px + cz * W) || !this.passable(cx + pz * W))) return Infinity;
      const st = this.step(prev, c, diag);
      if (!Number.isFinite(st)) return Infinity;
      cost += (st / (diag ? SQRT2 : 1)) * acc;
      acc = 0;
      prev = c;
    }
    return cost;
  }

  /** Whether every cell along a world-space polyline is still passable (cheap route validation). */
  validate(points: Pt[], skipFirst = 0): boolean {
    for (let k = 0; k + 1 < points.length; k++) {
      const [x0, z0] = points[k];
      const [x1, z1] = points[k + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        if (Math.hypot(x - points[0][0], z - points[0][1]) < skipFirst) continue;
        if (x < 0 || z < 0 || x >= this.ctx.world.sizeX || z >= this.ctx.world.sizeZ) continue;
        if (!this.passable(this.cellOf(x, z))) return false;
      }
    }
    return true;
  }
}

// ---- land ---------------------------------------------------------------------------------------------
const F_WATER = 1;
const F_OBST = 2;
const F_ROUGH = 4;

/** Ground-vehicle grid: 2×2-block cells, roads strongly preferred, water/trees/walls/steep steps avoided. */
export class LandNav extends GridNav {
  private readonly roads: Uint16Array;
  protected readonly minCost = 0.3;
  private readonly probeOut = { trunk: false };

  constructor(ctx: GameContext, terrain: Terrain) {
    super(ctx, terrain, 2, 0.6);
    this.roads = new Uint16Array(this.W * this.H);
    ctx.world.forEachEdit((x, _y, z, id) => {
      if (id === B.ASPHALT_ROAD) this.roads[this.cellOf(x, z)]++;
    });
  }

  /** Track asphalt road blocks (from 'world:blockChanged'). Returns true if the road network changed. */
  onBlockChanged(x: number, z: number, prev: number, id: number): boolean {
    const i = this.cellOf(x, z);
    this.known[i] = 0;
    let changed = false;
    if (id === B.ASPHALT_ROAD) {
      this.roads[i]++;
      changed = this.roads[i] === 1;
    }
    if (prev === B.ASPHALT_ROAD && this.roads[i] > 0) {
      this.roads[i]--;
      changed = changed || this.roads[i] === 0;
    }
    if (changed) this.version++;
    return changed;
  }

  isRoad(i: number): boolean {
    return this.roads[i] > 0;
  }

  protected evaluate(i: number, cx: number, cz: number): void {
    const t = this.terrain;
    const geo = this.ctx.geology;
    const x0 = cx * 2;
    const z0 = cz * 2;
    let hMax = -Infinity;
    let hMin = Infinity;
    let water = 0;
    let trunk = false;
    let raise = 0;
    const sx = this.ctx.world.sizeX;
    const sz = this.ctx.world.sizeZ;
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const x = Math.min(sx - 1, x0 + dx);
        const z = Math.min(sz - 1, z0 + dz);
        const h = t.probe(x, z, this.probeOut);
        if (this.probeOut.trunk) trunk = true;
        hMax = Math.max(hMax, h);
        hMin = Math.min(hMin, h);
        if (geo.waterDepth(x, z) > 0.3 && h <= SEA_LEVEL) water++;
        raise = Math.max(raise, h - geo.surfaceHeight(x, z));
      }
    let f = 0;
    if (water >= 2) f |= F_WATER;
    if (trunk || hMax - hMin > 1.5 || raise >= 1.9) f |= F_OBST;
    else if (raise >= 0.9) f |= F_ROUGH;
    this.flags[i] = f;
    this.height[i] = water >= 2 ? SEA_LEVEL + 1 : hMax;
  }

  protected open(i: number): boolean {
    return this.roads[i] > 0 || (this.flags[i] & (F_WATER | F_OBST)) === 0;
  }

  protected step(a: number, b: number, diag: boolean): number {
    const dh = Math.abs(this.height[b] - this.height[a]);
    const road = this.roads[b] > 0;
    if (dh > (road ? 2.6 : 2.1)) return Infinity;
    const base = road ? 0.3 : this.flags[b] & F_ROUGH ? 3 : 1;
    const k = dh / 2;
    return (diag ? SQRT2 : 1) * base * (1 + (road ? 1.5 : 4) * k * k);
  }

  protected goal(i: number): boolean {
    return (this.flags[i] & F_WATER) === 0 || this.roads[i] > 0;
  }

  /** Nav height (top of cell) at a world point. */
  heightAt(x: number, z: number): number {
    const i = this.cellOf(x, z);
    this.ensure(i);
    return this.height[i];
  }
}

// ---- water --------------------------------------------------------------------------------------------
const F_SHORE = 8;

/** Ship grid: 4×4-block cells of water deeper than ~3 blocks, keeping clear of coasts and structures. */
export class WaterNav extends GridNav {
  protected readonly minCost = 1;

  constructor(ctx: GameContext, terrain: Terrain) {
    super(ctx, terrain, 4, 3);
  }

  private depth(x: number, z: number): number {
    const w = this.ctx.world;
    if (x < 0 || z < 0 || x >= w.sizeX || z >= w.sizeZ) return 20;
    return this.ctx.geology.waterDepth(Math.floor(x), Math.floor(z));
  }

  protected evaluate(i: number, cx: number, cz: number): void {
    const x = cx * 4 + 2;
    const z = cz * 4 + 2;
    let f = 0;
    if (this.depth(x, z) < 3) f |= F_OBST;
    else {
      for (const [ox, oz] of [
        [-1.8, -1.8],
        [1.8, -1.8],
        [-1.8, 1.8],
        [1.8, 1.8],
      ])
        if (this.depth(x + ox, z + oz) < 1.5) f |= F_OBST;
      if (!(f & F_OBST))
        for (let k = 0; k < 8; k++) if (this.depth(x + DX[k] * 7, z + DZ[k] * 7) < 1) f |= F_SHORE;
    }
    this.flags[i] = f;
    this.height[i] = SEA_LEVEL + 1;
  }

  protected open(i: number): boolean {
    return (this.flags[i] & F_OBST) === 0;
  }

  protected step(_a: number, b: number, diag: boolean): number {
    return (diag ? SQRT2 : 1) * (this.flags[b] & F_SHORE ? 2.5 : 1);
  }

  protected goal(_i: number): boolean {
    return true;
  }
}
