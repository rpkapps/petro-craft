// Pipe network topology: an index of all pipe blocks (from world edits + block-change events), incremental
// dirty tracking, flood-fill into per-category networks, building port connections and stable network ids.
import { BUILDINGS } from '../../../content/buildings';
import { RIG_TYPES, containsPoint } from '../../../core/buildingUtil';
import type { BuildingState, FluidCat, NetworkState } from '../../../core/types';
import { B } from '../../../core/blocks';
import { CATS, PIPE_CAT } from '../catalog';
import type { FacilityRuntime } from '../runtime';

/** Runtime view of one network (derived; the persistent part is `state`). */
export interface NetRt {
  id: string;
  cat: FluidCat;
  /** Packed block keys of all pipe blocks (for leak placement). */
  pipes: number[];
  buildings: BuildingState[];
  state: NetworkState;
}

/** Minimum sim steps between two automatic rebuilds (100 ms each). */
const REBUILD_INTERVAL_STEPS = 3;

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class Topology {
  /** Packed block key → pipe category index (0..3). */
  readonly pipes = new Map<number, number>();
  /** Packed block key → network (valid after rebuild). */
  private readonly netOf = new Map<number, NetRt>();
  nets: NetRt[] = [];
  readonly byId = new Map<string, NetRt>();
  dirty = true;
  /** A full flood fill is required (removals, merges, building changes); otherwise only `added` is processed. */
  private needFull = true;
  private readonly added: number[] = [];
  private stepsSinceRebuild = 1e9;
  private readonly queue: number[] = [];
  /** Incremented on every rebuild (consumers can cache per-version data). */
  version = 0;

  constructor(private readonly rt: FacilityRuntime) {}

  key(x: number, y: number, z: number): number {
    const w = this.rt.ctx.world;
    return x + w.sizeX * (z + w.sizeZ * y);
  }
  decode(k: number): { x: number; y: number; z: number } {
    const w = this.rt.ctx.world;
    const x = k % w.sizeX;
    const t = (k - x) / w.sizeX;
    const z = t % w.sizeZ;
    return { x, y: (t - z) / w.sizeZ, z };
  }

  /** Force a full rebuild at the next opportunity (building/structure changes). */
  invalidate(): void {
    this.dirty = true;
    this.needFull = true;
  }

  /** Build the pipe index from the world's edit list (pipes never exist in generated terrain). */
  initFromWorld(): void {
    this.pipes.clear();
    this.needFull = true;
    this.rt.ctx.world.forEachEdit((x, y, z, id) => {
      const c = PIPE_CAT[id];
      if (c >= 0) this.pipes.set(this.key(x, y, z), c);
    });
    this.dirty = true;
  }

  /** world:blockChanged handler. */
  onBlockChanged(x: number, y: number, z: number, prev: number, id: number): void {
    const cPrev = PIPE_CAT[prev];
    const cNew = PIPE_CAT[id];
    if (cPrev >= 0 || cNew >= 0) {
      const k = this.key(x, y, z);
      if (cNew >= 0) this.pipes.set(k, cNew);
      else this.pipes.delete(k);
      if (cPrev < 0 && cNew >= 0 && !this.needFull) this.added.push(k);
      else this.needFull = true;
      this.dirty = true;
    } else if (prev === B.STRUCTURE || id === B.STRUCTURE) {
      this.invalidate();
    }
  }

  networkAt(x: number, y: number, z: number): NetRt | undefined {
    if (this.dirty) this.rebuild();
    return this.netOf.get(this.key(x, y, z));
  }

  /** Called each step: rebuild when dirty, at most every few steps. */
  maybeRebuild(): boolean {
    this.stepsSinceRebuild++;
    if (!this.dirty || this.stepsSinceRebuild < REBUILD_INTERVAL_STEPS) return false;
    this.rebuild();
    return true;
  }

  rebuild(): void {
    this.rt.refreshBuildings();
    this.dirty = false;
    this.stepsSinceRebuild = 0;
    this.version++;
    if (!this.needFull && this.applyAdded()) {
      this.added.length = 0;
      this.rt.ctx.bus.emit('network:rebuilt', {});
      return;
    }
    this.added.length = 0;
    this.needFull = false;
    this.fullRebuild();
  }

  /**
   * Incremental path for newly placed pipe blocks: a block touching exactly one existing network of its
   * category joins it; an isolated block starts a new network. Returns false when a full rebuild is needed
   * (the block bridges several networks).
   */
  private applyAdded(): boolean {
    const rt = this.rt;
    const ctx = rt.ctx;
    const world = ctx.world;
    const sx = world.sizeX;
    const sz = world.sizeZ;
    const bs = ctx.state.buildings;
    const touched = new Set<NetRt>();
    for (const k of this.added) {
      const cat = this.pipes.get(k);
      if (cat === undefined || this.netOf.has(k)) continue;
      const x = k % sx;
      const t = (k - x) / sx;
      const z = t % sz;
      const y = (t - z) / sz;
      let net: NetRt | undefined;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const nz = z + DZ[d];
        if (nx < 0 || nz < 0 || ny < 0 || nx >= sx || nz >= sz || ny >= world.height) continue;
        const nk = nx + sx * (nz + sz * ny);
        if (this.pipes.get(nk) !== cat) continue;
        const n = this.netOf.get(nk);
        if (!n) return false; // neighbour not yet indexed (added in the same batch out of order)
        if (net && n !== net) return false; // bridges two networks → merge
        net = n;
      }
      const catName = CATS[cat];
      if (!net) {
        const st: NetworkState = { id: ctx.newId('net'), category: catName, pipeCount: 0, buildings: [], linepack: {}, capacity: 0, flow: 0, boosters: 0, anchor: { x, y, z } };
        ctx.state.networks[st.id] = st;
        net = { id: st.id, cat: catName, pipes: [], buildings: [], state: st };
        this.nets.push(net);
        this.byId.set(st.id, net);
      }
      net.pipes.push(k);
      net.state.pipeCount = net.pipes.length;
      this.netOf.set(k, net);
      touched.add(net);
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const nz = z + DZ[d];
        if (nx < 0 || nz < 0 || ny < 0 || nx >= sx || nz >= sz || ny >= world.height) continue;
        if (this.pipes.has(nx + sx * (nz + sz * ny))) continue;
        for (const id of rt.idsAtColumn(nx, nz)) {
          const b = bs[id];
          if (!b || !containsPoint(b, nx, ny, nz)) continue;
          if (BUILDINGS[b.type]?.ports.includes(catName)) this.connect(net, b);
          else if (RIG_TYPES.has(b.type)) {
            for (const wid of rt.rigWellheads.get(b.id) ?? []) {
              const wh = bs[wid];
              if (wh && BUILDINGS[wh.type]?.ports.includes(catName)) this.connect(net, wh);
            }
          }
        }
      }
    }
    for (const n of touched) n.state.buildings = n.buildings.map((b) => b.id);
    return true;
  }

  private connect(net: NetRt, b: BuildingState): void {
    if (net.buildings.includes(b)) return;
    net.buildings.push(b);
    const ids = this.rt.rtOf(b).networks;
    if (!ids.includes(net.id)) ids.push(net.id);
    b.data.networks = ids.slice();
  }

  private fullRebuild(): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const world = ctx.world;
    const sx = world.sizeX;
    const sz = world.sizeZ;
    const h = world.height;
    this.netOf.clear();

    // --- flood fill components
    interface Comp { cat: number; pipes: number[]; buildings: Set<BuildingState> }
    const comps: Comp[] = [];
    const compOf = new Map<number, number>();
    const q = this.queue;
    const bs = ctx.state.buildings;
    for (const [start, cat] of this.pipes) {
      if (compOf.has(start)) continue;
      const ci = comps.length;
      const comp: Comp = { cat, pipes: [], buildings: new Set() };
      comps.push(comp);
      q.length = 0;
      q.push(start);
      compOf.set(start, ci);
      const catName = CATS[cat];
      while (q.length) {
        const k = q.pop()!;
        comp.pipes.push(k);
        const x = k % sx;
        const t = (k - x) / sx;
        const z = t % sz;
        const y = (t - z) / sz;
        for (let d = 0; d < 6; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          const nz = z + DZ[d];
          if (nx < 0 || nz < 0 || ny < 0 || nx >= sx || nz >= sz || ny >= h) continue;
          const nk = nx + sx * (nz + sz * ny);
          const nc = this.pipes.get(nk);
          if (nc !== undefined) {
            if (nc === cat && !compOf.has(nk)) {
              compOf.set(nk, ci);
              q.push(nk);
            }
            continue;
          }
          // Building contact: any building whose volume contains the neighbour block and which has this port.
          for (const id of rt.idsAtColumn(nx, nz)) {
            const b = bs[id];
            if (!b || !containsPoint(b, nx, ny, nz)) continue;
            const ports = BUILDINGS[b.type]?.ports;
            if (ports && ports.includes(catName)) comp.buildings.add(b);
            else if (RIG_TYPES.has(b.type)) {
              for (const wid of rt.rigWellheads.get(b.id) ?? []) {
                const wh = bs[wid];
                if (wh && BUILDINGS[wh.type]?.ports.includes(catName)) comp.buildings.add(wh);
              }
            }
          }
        }
      }
      comp.pipes.sort((a, b) => a - b);
    }

    // --- stable ids: an old network keeps its id if its anchor block is still a pipe in the new component.
    const old = ctx.state.networks;
    const oldIds = Object.keys(old).sort();
    const claimed = new Map<number, NetworkState>();
    for (const id of oldIds) {
      const n = old[id];
      const ak = n.anchor ? this.key(n.anchor.x, n.anchor.y, n.anchor.z) : -1;
      const ci = compOf.get(ak);
      if (ci === undefined || CATS[comps[ci].cat] !== n.category) continue;
      const owner = claimed.get(ci);
      if (!owner) {
        claimed.set(ci, n);
      } else {
        // Merge: fold the line pack into the surviving network.
        for (const item in n.linepack) owner.linepack[item] = (owner.linepack[item] ?? 0) + n.linepack[item];
        if (!owner.leak && n.leak) owner.leak = n.leak;
      }
    }
    // Anchor removed: keep the id on the component that still holds any of the network's former pipes.
    const claimedIds = new Set<string>();
    for (const n of claimed.values()) claimedIds.add(n.id);
    for (const prevNet of this.nets) {
      const n = old[prevNet.id];
      if (!n || claimedIds.has(n.id)) continue;
      for (const k of prevNet.pipes) {
        const ci = compOf.get(k);
        if (ci === undefined || claimed.has(ci) || CATS[comps[ci].cat] !== n.category) continue;
        claimed.set(ci, n);
        claimedIds.add(n.id);
        n.anchor = this.decode(k);
        break;
      }
    }

    const next: Record<string, NetworkState> = {};
    this.nets = [];
    this.byId.clear();
    for (let ci = 0; ci < comps.length; ci++) {
      const c = comps[ci];
      const cat = CATS[c.cat];
      let st = claimed.get(ci);
      if (!st) {
        const a = this.decode(c.pipes[0]);
        st = { id: ctx.newId('net'), category: cat, pipeCount: 0, buildings: [], linepack: {}, capacity: 0, flow: 0, boosters: 0, anchor: a };
      }
      // A leak whose pipe block is gone (replaced/removed) disappears with it.
      if (st.leak) {
        const lk = this.key(st.leak.x, st.leak.y, st.leak.z);
        if (compOf.get(lk) !== ci) delete st.leak;
      }
      const buildings = Array.from(c.buildings).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      st.pipeCount = c.pipes.length;
      st.buildings = buildings.map((b) => b.id);
      next[st.id] = st;
      const net: NetRt = { id: st.id, cat, pipes: c.pipes, buildings, state: st };
      this.nets.push(net);
      this.byId.set(st.id, net);
      for (const k of c.pipes) this.netOf.set(k, net);
    }
    for (const id in old) if (!next[id]) delete old[id];
    for (const id in next) old[id] = next[id];

    // --- building → networks
    for (const b of rt.list) rt.rtOf(b).networks.length = 0;
    for (const n of this.nets) for (const b of n.buildings) rt.rtOf(b).networks.push(n.id);
    for (const b of rt.list) {
      const ids = rt.rtOf(b).networks;
      const prev = b.data.networks as string[] | undefined;
      if (ids.length === 0) {
        if (prev) delete b.data.networks;
      } else if (!prev || prev.length !== ids.length || prev.some((v, i) => v !== ids[i])) {
        b.data.networks = ids.slice();
      }
    }
    ctx.bus.emit('network:rebuilt', {});
  }
}
