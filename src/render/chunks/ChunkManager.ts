// Chunk streaming: generates terrain around the camera under a per-frame time budget, dispatches
// meshing jobs to the worker pool (prioritised by distance & view direction), applies results under an
// upload budget (unchanged passes are skipped by content hash), re-meshes on block edits (batched,
// light-radius aware), unloads far chunks, hides cave sections that cannot be seen from the camera
// (section visibility graph → narrowed draw ranges) and drops plant geometry in the distance.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../core/constants';
import type { IWorld } from '../../core/types';
import type { EventBus } from '../../core/EventBus';
import { MesherPool } from '../meshing/MesherPool';
import { LPAD, LW, EMIT_RANGE, SECTION, type MeshJob, type MeshResult } from '../meshing/protocol';
import { EMIT, SKY_BLOCKER, LIGHT_CLASS } from '../meshing/blockTables';
import { ChunkMeshes, type TerrainMode } from './ChunkMeshes';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';

const CS = CHUNK_SIZE;
const key = (cx: number, cz: number) => cx * 65536 + cz;
const VIS_ALL = (1 << 15) - 1;
/** Face-pair bit (same encoding as the mesher): faces 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
const PAIR: number[][] = (() => {
  const t: number[][] = [];
  for (let a = 0; a < 6; a++) t.push([0, 0, 0, 0, 0, 0]);
  let bit = 0;
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      t[a][b] = t[b][a] = 1 << bit;
      bit++;
    }
  return t;
})();
const STEP_X = [1, -1, 0, 0, 0, 0];
const STEP_Y = [0, 0, 1, -1, 0, 0];
const STEP_Z = [0, 0, 0, 0, 1, -1];
/** Sky light floods ≤ 7 blocks sideways, smoothing samples one more. */
const SKY_REACH = LPAD;

interface ColumnCache {
  heights: Uint8Array | null;
  emitters: Int16Array | null;
}

interface Entry {
  cx: number;
  cz: number;
  meshes: ChunkMeshes | null;
  /** Bumped whenever the chunk (or light around it) changes. */
  version: number;
  meshedVersion: number;
  inflight: number; // job id or 0
  urgent: boolean;
  /** Priority (squared chunk distance, weighted by view direction). */
  distSq: number;
  /** Horizontal distance from the camera to the chunk centre, blocks. */
  dist: number;
  /** The current meshes were built without plants (distance LOD). */
  plantsSkipped: boolean;
}

export interface ChunkStats {
  /** Chunk columns tracked (loaded or waiting). */
  loaded: number;
  /** Columns with meshes. */
  meshed: number;
  meshing: number;
  pendingGen: number;
  lastMeshMs: number;
  /** Sections hidden by cave-occlusion culling. */
  culledSections: number;
  /** Bytes of geometry applied this frame. */
  uploadBytes: number;
}

export interface StreamBudget {
  /** Terrain generation time per frame (ms). */
  genMs: number;
  /** Job assembly time per frame (ms). */
  dispatchMs: number;
  /** Geometry bytes applied per frame (at least one result is always applied). */
  uploadBytes: number;
}

export class ChunkManager {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private columns = new Map<number, ColumnCache>();
  private pool: MesherPool;
  private results: MeshResult[] = [];
  private nextJobId = 1;
  private jobs = new Map<number, { entry: Entry; version: number }>();
  private wanted: Entry[] = [];
  private center = { cx: 1e9, cz: 1e9, rd: -1 };
  private reprioritizeTimer = 0;
  private mode: TerrainMode = 'normal';
  private genFailures = 0;
  private offBus: () => void;
  private sortCursor = 0;
  private sortPending = true;
  readonly stats: ChunkStats = { loaded: 0, meshed: 0, meshing: 0, pendingGen: 0, lastMeshMs: 0, culledSections: 0, uploadBytes: 0 };
  private readonly height: number;
  private readonly sectionCount: number;
  private disposed = false;
  private fwd = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private lastSortCam = new THREE.Vector3(1e9, 1e9, 1e9);
  private plantFar = 80;
  // cave culling
  private cullDirty = true;
  private cullCam = { cx: 1e9, sy: -1, cz: 1e9 };
  private cullR = -1;
  private cullVisited = new Uint8Array(0);
  private cullQueue = new Int32Array(0);
  private cullEntry = new Int8Array(0);
  private cullDirs = new Uint8Array(0);
  private cullVis = new Int32Array(0);
  private cullEnabled = true;
  private emitScratch: number[] = [];

  constructor(private world: IWorld, bus: EventBus, private mats: TerrainMaterialSet) {
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    this.height = world.height;
    this.sectionCount = Math.ceil(world.height / SECTION);
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const size = Math.max(1, Math.min(4, hc - 1));
    this.pool = new MesherPool(size, (r) => this.results.push(r), (id, msg) => this.onJobError(id, msg));
    this.offBus = bus.on('world:blockChanged', (e) => this.onBlockChanged(e.x, e.y, e.z, e.prev, e.id, e.source));
  }

  // ---- public API ------------------------------------------------------------------------------

  setMode(mode: TerrainMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.cullDirty = true;
    for (const e of this.entries.values()) e.meshes?.setMode(mode);
  }

  /** Enable/disable cave-occlusion culling (e.g. off while the camera is outside the world volume). */
  setOcclusionCulling(on: boolean) {
    if (on === this.cullEnabled) return;
    this.cullEnabled = on;
    this.cullDirty = true;
  }

  /** Plants fade out towards `far` (blocks, shader) and are not meshed well beyond it. */
  setPlantLod(far: number) {
    if (Math.abs(far - this.plantFar) < 0.5) return;
    this.plantFar = far;
    this.reprioritizeTimer = 0;
  }

  /** Fraction of chunks within `radius` chunks of the camera that are meshed. */
  progress(camera: THREE.Vector3, radius: number): number {
    const ccx = Math.floor(camera.x / CS);
    const ccz = Math.floor(camera.z / CS);
    let total = 0;
    let done = 0;
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (!this.inWorld(cx, cz)) continue;
        total++;
        const e = this.entries.get(key(cx, cz));
        if (e && e.meshedVersion >= 0) done++;
      }
    return total === 0 ? 1 : done / total;
  }

  /** Highest sky-blocking block + 1 at a world column (0 if unknown), e.g. for rain occlusion. */
  columnTop(x: number, z: number): number {
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    if (!this.inWorld(cx, cz) || !this.world.isChunkGenerated(cx, cz)) return 0;
    const h = this.heightsOf(cx, cz);
    return h ? h[(x - cx * CS) + (z - cz * CS) * CS] : 0;
  }

  isMeshed(cx: number, cz: number) {
    const e = this.entries.get(key(cx, cz));
    return !!e && e.meshedVersion >= 0;
  }

  /** True when nothing is waiting to be generated, meshed or applied. */
  get idle(): boolean {
    if (this.results.length || this.pool.busy || this.stats.pendingGen) return false;
    for (const e of this.wanted) if (this.needsMesh(e)) return false;
    return true;
  }

  forEachMesh(fn: (m: THREE.Mesh) => void) {
    for (const e of this.entries.values()) e.meshes?.forEachMesh(fn);
  }

  update(camera: THREE.PerspectiveCamera, renderDistance: number, budget: StreamBudget) {
    if (this.disposed) return;
    const rd = Math.max(2, Math.min(16, Math.round(renderDistance)));
    const ccx = Math.floor(camera.position.x / CS);
    const ccz = Math.floor(camera.position.z / CS);
    this.reprioritizeTimer -= 1;
    if (ccx !== this.center.cx || ccz !== this.center.cz || rd !== this.center.rd || this.reprioritizeTimer <= 0) {
      this.center.cx = ccx;
      this.center.cz = ccz;
      this.center.rd = rd;
      this.reprioritizeTimer = 20;
      this.rebuildWanted(camera, rd);
      this.unloadFar(rd);
    }
    this.stats.uploadBytes = 0;
    this.applyResults(budget.uploadBytes);
    this.generate(budget.genMs);
    this.dispatch(budget.dispatchMs);
    this.updateCulling(camera.position);
    this.sortTranslucent(camera.position);
    this.stats.loaded = this.entries.size;
    this.stats.meshing = this.pool.busy;
  }

  dispose() {
    this.disposed = true;
    this.offBus();
    this.pool.dispose();
    for (const e of this.entries.values()) e.meshes?.dispose();
    this.entries.clear();
    this.columns.clear();
    this.results = [];
  }

  // ---- streaming ---------------------------------------------------------------------------------

  private inWorld(cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < this.world.chunksX && cz < this.world.chunksZ;
  }

  private rebuildWanted(camera: THREE.PerspectiveCamera, rd: number) {
    const fwd = this.fwd;
    camera.getWorldDirection(fwd);
    const fx = fwd.x;
    const fz = fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const px = camera.position.x / CS;
    const pz = camera.position.z / CS;
    const list = this.wanted;
    list.length = 0;
    const r2 = (rd + 0.5) * (rd + 0.5);
    const plantIn = this.plantFar + 16;
    for (let dz = -rd; dz <= rd; dz++)
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const cx = this.center.cx + dx;
        const cz = this.center.cz + dz;
        if (!this.inWorld(cx, cz)) continue;
        const k = key(cx, cz);
        let e = this.entries.get(k);
        if (!e) {
          e = { cx, cz, meshes: null, version: 0, meshedVersion: -1, inflight: 0, urgent: false, distSq: 0, dist: 0, plantsSkipped: false };
          this.entries.set(k, e);
          this.cullDirty = true;
        }
        const ox = cx + 0.5 - px;
        const oz = cz + 0.5 - pz;
        const d2 = ox * ox + oz * oz;
        const dot = (ox * fx + oz * fz) / fl / (Math.sqrt(d2) || 1);
        const behind = d2 > 4 && dot < -0.1 ? 2.5 : d2 > 4 && dot < 0.4 ? 1.4 : 1;
        e.distSq = d2 * behind;
        e.dist = Math.sqrt(d2) * CS;
        // plant LOD: re-mesh with plants when a chunk that was meshed without them comes closer
        if (e.plantsSkipped && e.meshedVersion >= 0 && e.dist < plantIn && e.meshedVersion >= e.version) e.version++;
        list.push(e);
      }
    list.sort((a, b) => a.distSq - b.distSq);
  }

  private unloadFar(rd: number) {
    const lim = (rd + 2) * (rd + 2);
    for (const [k, e] of this.entries) {
      const dx = e.cx - this.center.cx;
      const dz = e.cz - this.center.cz;
      if (dx * dx + dz * dz <= lim) continue;
      e.meshes?.dispose();
      if (e.inflight) this.jobs.delete(e.inflight);
      this.entries.delete(k);
      this.cullDirty = true;
    }
    this.countMeshed();
    // column caches (heights/emitters) are cheap to keep around, but not forever
    const far = (rd + 6) * (rd + 6);
    for (const k of this.columns.keys()) {
      const cx = Math.floor(k / 65536);
      const cz = k - cx * 65536;
      const dx = cx - this.center.cx;
      const dz = cz - this.center.cz;
      if (dx * dx + dz * dz > far) this.columns.delete(k);
    }
  }

  private needsMesh(e: Entry) {
    return e.meshedVersion < e.version || e.meshedVersion < 0;
  }

  private generate(budgetMs: number) {
    const t0 = performance.now();
    let pending = 0;
    for (const e of this.wanted) {
      if (!this.needsMesh(e) || e.inflight) continue;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = e.cx + dx;
          const cz = e.cz + dz;
          if (!this.inWorld(cx, cz) || this.world.isChunkGenerated(cx, cz)) continue;
          if (performance.now() - t0 > budgetMs) {
            pending++;
            continue;
          }
          try {
            this.world.ensureChunk(cx, cz);
          } catch (err) {
            if (this.genFailures++ < 3) console.error('[render] world.ensureChunk failed', cx, cz, err);
            pending++;
          }
        }
    }
    this.stats.pendingGen = pending;
  }

  private neighbourhoodReady(e: Entry) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = e.cx + dx;
        const cz = e.cz + dz;
        if (this.inWorld(cx, cz) && !this.world.isChunkGenerated(cx, cz)) return false;
      }
    return true;
  }

  private dispatch(budgetMs: number) {
    if (this.pool.capacity <= 0) return;
    // Job assembly copies ~160 KB per chunk on the main thread: cap it per frame.
    const deadline = performance.now() + budgetMs;
    // urgent edits first, then by priority order
    for (const e of this.wanted) {
      if (this.pool.capacity <= 0) return;
      if (e.urgent && !e.inflight && this.needsMesh(e) && this.neighbourhoodReady(e)) this.submit(e);
    }
    for (const e of this.wanted) {
      if (this.pool.capacity <= 0 || performance.now() > deadline) return;
      if (!e.inflight && this.needsMesh(e) && this.neighbourhoodReady(e)) this.submit(e);
    }
  }

  private submit(e: Entry) {
    const job = this.buildJob(e);
    if (!job) return;
    if (!this.pool.submit(job)) return;
    e.inflight = job.id;
    e.urgent = false;
    this.jobs.set(job.id, { entry: e, version: e.version });
  }

  private applyResults(budgetBytes: number) {
    const res = this.results;
    if (!res.length) return;
    const t0 = performance.now();
    // nearest first
    if (res.length > 1) res.sort((a, b) => this.resultDist(a) - this.resultDist(b));
    let applied = 0;
    let bytes = 0;
    let i = 0;
    for (; i < res.length; i++) {
      const r = res[i];
      const size = ChunkMeshes.resultBytes(r);
      if (applied > 0 && (bytes + size > budgetBytes || performance.now() - t0 > 4)) break;
      const job = this.jobs.get(r.id);
      this.jobs.delete(r.id);
      if (!job) continue; // unloaded meanwhile
      const e = job.entry;
      if (e.inflight !== r.id || this.entries.get(key(e.cx, e.cz)) !== e) continue;
      e.inflight = 0;
      if (!e.meshes) e.meshes = new ChunkMeshes(e.cx, e.cz, this.group, this.mats, this.sectionCount, this.mode);
      bytes += e.meshes.apply(r);
      e.meshedVersion = job.version;
      e.plantsSkipped = r.skipPlants;
      this.stats.lastMeshMs = r.ms;
      this.cullDirty = true;
      applied++;
    }
    res.splice(0, i);
    this.stats.uploadBytes = bytes;
    this.countMeshed();
  }

  private countMeshed() {
    let meshed = 0;
    for (const e of this.entries.values()) if (e.meshes) meshed++;
    this.stats.meshed = meshed;
  }

  private resultDist(r: MeshResult) {
    const dx = r.cx - this.center.cx;
    const dz = r.cz - this.center.cz;
    return dx * dx + dz * dz;
  }

  private onJobError(id: number, msg: string) {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    console.error('[render] mesher job failed', msg);
    if (job) {
      job.entry.inflight = 0;
      job.entry.meshedVersion = job.version; // don't spin on a chunk that cannot be meshed
    }
  }

  private sortTranslucent(cam: THREE.Vector3) {
    // Only after the camera moved meaningfully: re-sort a few nearby chunks per frame (round-robin) until a
    // full pass finds nothing left to sort (each chunk also skips itself below its own movement threshold).
    if (this.lastSortCam.distanceToSquared(cam) > 0.25 * 0.25) {
      this.lastSortCam.copy(cam);
      this.sortPending = true;
    }
    if (!this.sortPending) return;
    let near = 0;
    for (const e of this.wanted) {
      if (e.distSq > 9) break;
      near++;
    }
    if (!near) {
      this.sortPending = false;
      return;
    }
    let sorted = 0;
    let visited = 0;
    for (let i = 0; i < near && sorted < 3; i++) {
      const e = this.wanted[(this.sortCursor + i) % near];
      visited++;
      if (e.meshes?.sortTranslucent(cam)) sorted++;
    }
    this.sortCursor = (this.sortCursor + visited) % near;
    if (sorted === 0 && visited === near) this.sortPending = false;
  }

  // ---- cave-occlusion culling -------------------------------------------------------------------------

  /**
   * Breadth-first walk over sections from the camera's section through faces that are connected by open
   * space (per-section visibility from the mesher), never stepping back against a direction already
   * taken. Sections not reached cannot be seen and are hidden (mostly cave systems under the surface).
   */
  private updateCulling(cam: THREE.Vector3) {
    const ccx = Math.floor(cam.x / CS);
    const ccz = Math.floor(cam.z / CS);
    const csy = Math.floor(cam.y / SECTION);
    const inside = cam.y >= 0 && cam.y < this.height && this.inWorld(ccx, ccz);
    const active = this.cullEnabled && this.mode === 'normal' && inside;
    if (!this.cullDirty && ccx === this.cullCam.cx && ccz === this.cullCam.cz && csy === this.cullCam.sy) return;
    this.cullDirty = false;
    this.cullCam.cx = ccx;
    this.cullCam.cz = ccz;
    this.cullCam.sy = csy;
    let culled = 0;
    if (!active) {
      for (const e of this.entries.values()) e.meshes?.setCulled(0);
      this.stats.culledSections = 0;
      return;
    }
    const R = this.center.rd + 2;
    const G = R * 2 + 1;
    const NS = this.sectionCount;
    const total = G * G * NS;
    if (this.cullR !== R) {
      this.cullR = R;
      this.cullVisited = new Uint8Array(total);
      this.cullQueue = new Int32Array(total);
      this.cullEntry = new Int8Array(total);
      this.cullDirs = new Uint8Array(total);
      this.cullVis = new Int32Array(total);
    }
    const visited = this.cullVisited;
    const queue = this.cullQueue;
    const entryFace = this.cullEntry;
    const dirs = this.cullDirs;
    const visArr = this.cullVis;
    visited.fill(0);
    visArr.fill(VIS_ALL);
    for (const e of this.entries.values()) {
      const lx = e.cx - ccx + R;
      const lz = e.cz - ccz + R;
      if (lx < 0 || lz < 0 || lx >= G || lz >= G || !e.meshes) continue;
      for (let s = 0; s < NS; s++) visArr[lx + lz * G + s * G * G] = e.meshes.vis[s];
    }
    let qh = 0;
    let qt = 0;
    const start = R + R * G + Math.min(NS - 1, Math.max(0, csy)) * G * G;
    visited[start] = 1;
    entryFace[start] = -1;
    dirs[start] = 0;
    queue[qt++] = start;
    while (qh < qt) {
      const idx = queue[qh++];
      const sy = (idx / (G * G)) | 0;
      const rem = idx - sy * G * G;
      const lz = (rem / G) | 0;
      const lx = rem - lz * G;
      const ef = entryFace[idx];
      const dm = dirs[idx];
      const vis = visArr[idx];
      for (let d = 0; d < 6; d++) {
        if (dm & (1 << (d ^ 1))) continue; // never step back towards the camera
        if (ef >= 0 && !(vis & PAIR[ef][d])) continue;
        const nx = lx + STEP_X[d];
        const ny = sy + STEP_Y[d];
        const nz = lz + STEP_Z[d];
        if (nx < 0 || nz < 0 || nx >= G || nz >= G || ny < 0 || ny >= NS) continue;
        if (!this.inWorld(nx - R + ccx, nz - R + ccz)) continue;
        const ni = nx + nz * G + ny * G * G;
        if (visited[ni]) continue;
        visited[ni] = 1;
        entryFace[ni] = d ^ 1;
        dirs[ni] = dm | (1 << d);
        queue[qt++] = ni;
      }
    }
    for (const e of this.entries.values()) {
      if (!e.meshes) continue;
      const lx = e.cx - ccx + R;
      const lz = e.cz - ccz + R;
      const inGrid = lx >= 0 && lz >= 0 && lx < G && lz < G;
      let mask = 0;
      if (inGrid) for (let s = 0; s < NS; s++) if (!visited[lx + lz * G + s * G * G]) mask |= 1 << s;
      e.meshes.setCulled(mask);
      if (mask) culled += e.meshes.culledCount();
    }
    this.stats.culledSections = culled;
  }

  // ---- job construction ---------------------------------------------------------------------------

  private column(cx: number, cz: number): ColumnCache {
    const k = key(cx, cz);
    let c = this.columns.get(k);
    if (!c) {
      c = { heights: null, emitters: null };
      this.columns.set(k, c);
    }
    return c;
  }

  private heightsOf(cx: number, cz: number): Uint8Array | null {
    const c = this.column(cx, cz);
    if (c.heights) return c.heights;
    const data = this.world.getChunkData(cx, cz);
    if (!data) return null;
    const h = new Uint8Array(CS * CS);
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) h[x + z * CS] = this.scanColumn(data, x, z);
    c.heights = h;
    return h;
  }

  private scanColumn(data: Uint8Array, x: number, z: number) {
    for (let y = this.height - 1; y >= 0; y--) if (SKY_BLOCKER[data[x + z * CS + y * CS * CS]]) return y + 1;
    return 0;
  }

  private emittersOf(cx: number, cz: number): Int16Array {
    const c = this.column(cx, cz);
    if (c.emitters) return c.emitters;
    const data = this.world.getChunkData(cx, cz);
    const out = this.emitScratch;
    out.length = 0;
    if (data) {
      for (let i = 0; i < data.length; i++) {
        const l = EMIT[data[i]];
        if (!l) continue;
        const y = Math.floor(i / (CS * CS));
        const rem = i - y * CS * CS;
        out.push(rem % CS, y, Math.floor(rem / CS), l);
      }
    }
    c.emitters = new Int16Array(out);
    return c.emitters;
  }

  private buildJob(e: Entry): MeshJob | null {
    const H = this.height;
    const chunks: (Uint8Array | undefined)[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = e.cx + dx;
        const cz = e.cz + dz;
        chunks.push(this.inWorld(cx, cz) ? this.world.getChunkData(cx, cz) : undefined);
      }
    if (!chunks[4]) return null;
    const LL = LW * LW;
    const blocks = new Uint8Array(LL * H);
    // copy x-runs: within one source chunk a run of cells along x is contiguous in both layouts
    for (let lz = 0; lz < LW; lz++) {
      const wz = lz - LPAD;
      const sz = wz < 0 ? 0 : wz >= CS ? 2 : 1;
      const tz = wz - (sz - 1) * CS;
      let lx = 0;
      while (lx < LW) {
        const wx = lx - LPAD;
        const sx = wx < 0 ? 0 : wx >= CS ? 2 : 1;
        const tx = wx - (sx - 1) * CS;
        const run = Math.min(CS - tx, LW - lx);
        const src = chunks[sz * 3 + sx];
        if (src) {
          let si = tx + tz * CS;
          let di = lx + lz * LW;
          for (let y = 0; y < H; y++) {
            for (let k = 0; k < run; k++) blocks[di + k] = src[si + k];
            si += CS * CS;
            di += LL;
          }
        }
        lx += run;
      }
    }
    // emitters within range of this chunk
    const list: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = e.cx + dx;
        const cz = e.cz + dz;
        if (!this.inWorld(cx, cz) || !chunks[(dz + 1) * 3 + dx + 1]) continue;
        const src = this.emittersOf(cx, cz);
        for (let i = 0; i < src.length; i += 4) {
          const x = src[i] + dx * CS;
          const z = src[i + 2] + dz * CS;
          if (x < -EMIT_RANGE || z < -EMIT_RANGE || x >= CS + EMIT_RANGE || z >= CS + EMIT_RANGE) continue;
          list.push(x, src[i + 1], z, src[i + 3]);
        }
      }
    const skipPlants = e.dist > this.plantFar + 24;
    return { type: 'mesh', id: this.nextJobId++, cx: e.cx, cz: e.cz, height: H, blocks, emitters: new Int16Array(list), skipPlants };
  }

  // ---- edits ---------------------------------------------------------------------------------------

  private markDirty(cx: number, cz: number, urgent: boolean) {
    const e = this.entries.get(key(cx, cz));
    if (!e) return;
    e.version++;
    if (urgent) e.urgent = true;
  }

  private onBlockChanged(x: number, _y: number, z: number, prev: number, id: number, source: string) {
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const lx = x - cx * CS;
    const lz = z - cz * CS;
    const c = this.columns.get(key(cx, cz));
    if (c?.heights) {
      const data = this.world.getChunkData(cx, cz);
      if (data) c.heights[lx + lz * CS] = this.scanColumn(data, lx, lz);
    }
    const lightChanged = EMIT[prev] > 0 || EMIT[id] > 0;
    if (c && lightChanged) c.emitters = null;
    const urgent = source !== 'load';
    this.markDirty(cx, cz, urgent);
    // Opacity/filter changes shift sky light up to SKY_REACH blocks away (flood fill); lamps reach further;
    // anything else only affects faces and AO of direct neighbours.
    const reach = lightChanged ? EMIT_RANGE : LIGHT_CLASS[prev] !== LIGHT_CLASS[id] ? SKY_REACH : 1;
    const west = lx < reach;
    const east = lx >= CS - reach;
    const north = lz < reach;
    const south = lz >= CS - reach;
    if (west) this.markDirty(cx - 1, cz, urgent);
    if (east) this.markDirty(cx + 1, cz, urgent);
    if (north) this.markDirty(cx, cz - 1, urgent);
    if (south) this.markDirty(cx, cz + 1, urgent);
    if (west && north) this.markDirty(cx - 1, cz - 1, urgent);
    if (west && south) this.markDirty(cx - 1, cz + 1, urgent);
    if (east && north) this.markDirty(cx + 1, cz - 1, urgent);
    if (east && south) this.markDirty(cx + 1, cz + 1, urgent);
  }
}
