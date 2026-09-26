// Chunk streaming: generates terrain around the camera under a per-frame time budget, dispatches
// meshing jobs to the worker pool (prioritised by distance & view direction), applies results,
// re-meshes on block edits (batched, border-aware) and unloads far chunks.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../core/constants';
import type { IWorld } from '../../core/types';
import type { EventBus } from '../../core/EventBus';
import { MesherPool } from '../meshing/MesherPool';
import { PW, PAD, HM, HW, EMIT_RANGE, type MeshJob, type MeshResult } from '../meshing/protocol';
import { EMIT, SKY_BLOCKER } from '../meshing/blockTables';
import { ChunkMeshes, type TerrainMode } from './ChunkMeshes';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';

const PL = PW * PW;
const CS = CHUNK_SIZE;
const key = (cx: number, cz: number) => cx * 65536 + cz;

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
  distSq: number;
}

export interface ChunkStats {
  loaded: number;
  meshing: number;
  pendingGen: number;
  lastMeshMs: number;
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
  readonly stats: ChunkStats = { loaded: 0, meshing: 0, pendingGen: 0, lastMeshMs: 0 };
  private readonly height: number;
  private disposed = false;

  constructor(private world: IWorld, bus: EventBus, private mats: TerrainMaterialSet) {
    this.group.name = 'terrain';
    this.height = world.height;
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const size = Math.max(1, Math.min(4, hc - 1));
    this.pool = new MesherPool(size, (r) => this.results.push(r), (id, msg) => this.onJobError(id, msg));
    this.offBus = bus.on('world:blockChanged', (e) => this.onBlockChanged(e.x, e.y, e.z, e.prev, e.id, e.source));
  }

  // ---- public API ------------------------------------------------------------------------------

  setMode(mode: TerrainMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const e of this.entries.values()) e.meshes?.setMode(mode);
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

  forEachMesh(fn: (m: THREE.Mesh) => void) {
    for (const e of this.entries.values()) {
      const m = e.meshes;
      if (!m) continue;
      if (m.opaque) fn(m.opaque);
      if (m.cutout) fn(m.cutout);
      if (m.translucent) fn(m.translucent);
    }
  }

  update(camera: THREE.PerspectiveCamera, renderDistance: number, genBudgetMs: number) {
    if (this.disposed) return;
    const rd = Math.max(2, Math.min(16, Math.round(renderDistance)));
    const ccx = Math.floor(camera.position.x / CS);
    const ccz = Math.floor(camera.position.z / CS);
    this.reprioritizeTimer -= 1;
    if (ccx !== this.center.cx || ccz !== this.center.cz || rd !== this.center.rd || this.reprioritizeTimer <= 0) {
      this.center = { cx: ccx, cz: ccz, rd };
      this.reprioritizeTimer = 20;
      this.rebuildWanted(camera, rd);
      this.unloadFar(rd);
    }
    this.applyResults();
    this.generate(genBudgetMs);
    this.dispatch();
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
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const fx = fwd.x;
    const fz = fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const px = camera.position.x / CS;
    const pz = camera.position.z / CS;
    const list: Entry[] = [];
    const r2 = (rd + 0.5) * (rd + 0.5);
    for (let dz = -rd; dz <= rd; dz++)
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const cx = this.center.cx + dx;
        const cz = this.center.cz + dz;
        if (!this.inWorld(cx, cz)) continue;
        const k = key(cx, cz);
        let e = this.entries.get(k);
        if (!e) {
          e = { cx, cz, meshes: null, version: 0, meshedVersion: -1, inflight: 0, urgent: false, distSq: 0 };
          this.entries.set(k, e);
        }
        const ox = cx + 0.5 - px;
        const oz = cz + 0.5 - pz;
        const d2 = ox * ox + oz * oz;
        const dot = (ox * fx + oz * fz) / fl / (Math.sqrt(d2) || 1);
        const behind = d2 > 4 && dot < -0.1 ? 2.5 : d2 > 4 && dot < 0.4 ? 1.4 : 1;
        e.distSq = d2 * behind;
        list.push(e);
      }
    list.sort((a, b) => a.distSq - b.distSq);
    this.wanted = list;
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
    }
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

  private dispatch() {
    if (this.pool.capacity <= 0) return;
    // Job assembly copies ~50 KB per chunk on the main thread: cap it per frame.
    const deadline = performance.now() + 3;
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

  private applyResults() {
    if (!this.results.length) return;
    const t0 = performance.now();
    // nearest first
    this.results.sort((a, b) => this.resultDist(a) - this.resultDist(b));
    let applied = 0;
    while (this.results.length) {
      if (applied >= 2 && performance.now() - t0 > 4) break;
      const r = this.results.shift()!;
      const job = this.jobs.get(r.id);
      this.jobs.delete(r.id);
      if (!job) continue; // unloaded meanwhile
      const e = job.entry;
      if (e.inflight !== r.id || this.entries.get(key(e.cx, e.cz)) !== e) continue;
      e.inflight = 0;
      if (!e.meshes) e.meshes = new ChunkMeshes(e.cx, e.cz, this.group, this.mats);
      e.meshes.apply(r, this.mode);
      e.meshedVersion = job.version;
      this.stats.lastMeshMs = r.ms;
      applied++;
    }
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
    // sort a few nearby chunks per frame (round-robin)
    const near: Entry[] = [];
    for (const e of this.wanted) {
      if (e.distSq > 9) break;
      if (e.meshes?.translucent) near.push(e);
    }
    if (!near.length) return;
    let sorted = 0;
    for (let i = 0; i < near.length && sorted < 3; i++) {
      const e = near[(this.sortCursor + i) % near.length];
      if (e.meshes!.sortTranslucent(cam)) sorted++;
    }
    this.sortCursor = (this.sortCursor + 1) % near.length;
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
    const out: number[] = [];
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
    const blocks = new Uint8Array(PL * H);
    for (let pz = 0; pz < PW; pz++) {
      const lz = pz - PAD;
      const sz = lz < 0 ? 0 : lz >= CS ? 2 : 1;
      const tz = lz - (sz - 1) * CS;
      for (let px = 0; px < PW; px++) {
        const lx = px - PAD;
        const sx = lx < 0 ? 0 : lx >= CS ? 2 : 1;
        const src = chunks[sz * 3 + sx];
        if (!src) continue;
        const tx = lx - (sx - 1) * CS;
        let si = tx + tz * CS;
        let di = px + pz * PW;
        for (let y = 0; y < H; y++) {
          blocks[di] = src[si];
          si += CS * CS;
          di += PL;
        }
      }
    }
    // column heights with a wider margin (soft sky light)
    const heights = new Uint8Array(HW * HW);
    for (let hz = 0; hz < HW; hz++)
      for (let hx = 0; hx < HW; hx++) {
        const wx = e.cx * CS + hx - HM;
        const wz = e.cz * CS + hz - HM;
        const cx = Math.floor(wx / CS);
        const cz = Math.floor(wz / CS);
        if (!this.inWorld(cx, cz)) continue;
        const h = this.heightsOf(cx, cz);
        if (h) heights[hx + hz * HW] = h[(wx - cx * CS) + (wz - cz * CS) * CS];
      }
    // emitters within range of this chunk
    const em: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = e.cx + dx;
        const cz = e.cz + dz;
        if (!this.inWorld(cx, cz) || !chunks[(dz + 1) * 3 + dx + 1]) continue;
        const list = this.emittersOf(cx, cz);
        for (let i = 0; i < list.length; i += 4) {
          const x = list[i] + dx * CS;
          const z = list[i + 2] + dz * CS;
          if (x < -EMIT_RANGE || z < -EMIT_RANGE || x >= CS + EMIT_RANGE || z >= CS + EMIT_RANGE) continue;
          em.push(x, list[i + 1], z, list[i + 3]);
        }
      }
    return { type: 'mesh', id: this.nextJobId++, cx: e.cx, cz: e.cz, height: H, blocks, heights, emitters: new Int16Array(em) };
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
    let skyChanged = false;
    if (c?.heights) {
      const data = this.world.getChunkData(cx, cz);
      if (data) {
        const nh = this.scanColumn(data, lx, lz);
        skyChanged = nh !== c.heights[lx + lz * CS];
        c.heights[lx + lz * CS] = nh;
      }
    } else skyChanged = SKY_BLOCKER[prev] !== SKY_BLOCKER[id];
    const lightChanged = EMIT[prev] > 0 || EMIT[id] > 0;
    if (c && lightChanged) c.emitters = null;
    const urgent = source !== 'load';
    this.markDirty(cx, cz, urgent);
    const reach = lightChanged ? EMIT_RANGE : skyChanged ? HM - 1 : 1;
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
