// Per-step fluid movement through pipe networks.
//
// Each network carries only the items of its category. Sources are buildings' output stock (wellheads, plant
// outputs, tanks, offshore hubs) plus the line pack; sinks are served by priority tier:
//   1 plant feed · 2 power-plant fuel · 3 injectors / frac / disposal / water treatment · 4 terminals
//   5 storage tanks & offshore hubs · (line pack) · 6 flare stacks (raw gas from producers only)
// Tanks discharge only to tiers 1–4. Total movement per step is limited by network capacity × step.days.
// Scratch arrays are pooled so a step allocates nothing proportional to network size.
import type { BuildingState, FluidCat, NetworkState, SimStep } from '../../../core/types';
import {
  BOOSTER_TYPES, CO2_PER_MCF_BURNED, GAS_COMPRESSION_THRESHOLD, GAS_UNCOMPRESSED_FACTOR, ITEMS_BY_CAT, LINEPACK_PER_BLOCK,
  NETWORK_BASE_CAPACITY, OFFSHORE_HUB_TYPES, PRODUCER_TYPES, TANK_TYPES, TERMINAL_TYPES, emaAlpha, itemCat,
} from '../catalog';
import type { FacilityRuntime } from '../runtime';
import {
  SRC_HUB, SRC_LINEPACK, SRC_PRODUCER, SRC_TANK, TIER_FLARE, TIER_TANK, addStorage, capacityOf, sinkSpec, sourceKind,
  takeStorage, usedOf,
} from '../storage';
import type { NetRt } from './topology';

/** Max gas a single flare stack burns per day. */
export const FLARE_CAPACITY = 25000;
/** Offshore produced-water overboard discharge limit per hub per day. */
const OVERBOARD_CAPACITY = 30000;
const EPS = 1e-9;

/** Extra (JSON) fields facilities keeps on NetworkState / leaks. */
export interface NetworkExt extends NetworkState {
  /** True when a long gas line has no compressor (throughput ×0.3). */
  needsCompression?: boolean;
}
export interface LeakExt {
  x: number; y: number; z: number; rate: number; startedDay: number;
  /** totalMinutes when the leak is detected / auto-isolated. */
  detectAt?: number;
  detected?: boolean;
  isolateAt?: number;
  isolated?: boolean;
  /** Spill record fed by this leak. */
  spillId?: string;
  /** totalMinutes when a dispatched crew finishes the repair. */
  repairAt?: number;
}

const ITEM_INDEX: Record<string, number> = {};
for (const cat of Object.keys(ITEMS_BY_CAT) as FluidCat[]) ITEMS_BY_CAT[cat].forEach((id, i) => (ITEM_INDEX[id] = i));

/** Pass definitions: sink tier, sink filter (0 any, 1 tanks+hubs, 2 tanks only), allowed source-kind mask. */
const M_PROD = 1 << SRC_PRODUCER;
const M_TANK = 1 << SRC_TANK;
const M_HUB = 1 << SRC_HUB;
const M_LP = 1 << SRC_LINEPACK;
const M_ALL = M_PROD | M_TANK | M_HUB | M_LP;
const PASSES: Array<[number, number, number]> = [
  [1, 0, M_ALL],
  [2, 0, M_ALL],
  [3, 0, M_ALL],
  [4, 0, M_ALL],
  [TIER_TANK, 1, M_PROD | M_LP],
  [TIER_TANK, 2, M_HUB],
];

export type LeakSink = (net: NetRt, item: string, qty: number) => void;

export class FlowEngine {
  // sources
  private sB: (BuildingState | null)[] = [];
  private sItem: number[] = [];
  private sAvail: number[] = [];
  private sKind: number[] = [];
  private sIo: boolean[] = [];
  private sN = 0;
  // sinks
  private kB: BuildingState[] = [];
  private kItem: number[] = [];
  private kCap: number[] = [];
  private kSlot: number[] = [];
  private kTier: number[] = [];
  private kFilter: number[] = []; // 1 = tank, 2 = hub, 0 = other
  private kIo: boolean[] = [];
  private kN = 0;
  private slotRoom: number[] = [];
  private slotN = 0;

  /** Called with fluid lost through leaks (spills module turns it into spills/venting). */
  leakSink: LeakSink = () => {};

  constructor(private readonly rt: FacilityRuntime) {}

  tick(step: SimStep): void {
    const rt = this.rt;
    const topo = rt.topology;
    const alpha = emaAlpha(step.minutes);
    for (const net of topo.nets) {
      this.updateCapacity(net);
      const moved = step.days > 0 ? this.flowNetwork(net, step) : 0;
      const st = net.state;
      st.flow += ((step.days > 0 ? moved / step.days : 0) - st.flow) * alpha;
      if (st.flow < 0.01) st.flow = 0;
    }
    this.handleProducerExcess(step);
  }

  /** Capacity (units/day) and booster count. */
  updateCapacity(net: NetRt): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = net.state as NetworkExt;
    let boosters = 0;
    for (const b of net.buildings) {
      const cats = BOOSTER_TYPES[b.type];
      if (cats && cats.includes(net.cat) && rt.canRun(b)) boosters++;
    }
    const boost = net.cat === 'gas' ? 0.8 * ctx.modifier('compressor_efficiency') : 0.8;
    let cap = (NETWORK_BASE_CAPACITY[net.cat] * ctx.modifier('pipeline_capacity') * (1 + boost * boosters)) / (1 + st.pipeCount / 400);
    const needsComp = net.cat === 'gas' && st.pipeCount > GAS_COMPRESSION_THRESHOLD && boosters === 0;
    if (needsComp) cap *= GAS_UNCOMPRESSED_FACTOR;
    if (needsComp) st.needsCompression = true;
    else if (st.needsCompression) delete st.needsCompression;
    st.boosters = boosters;
    st.capacity = Math.round(cap);
  }

  private flowNetwork(net: NetRt, step: SimStep): number {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = net.state;
    const cat = net.cat;
    const items = ITEMS_BY_CAT[cat];
    const leak = st.leak as LeakExt | undefined;
    const throttle = leak ? (leak.isolated ? 0.25 : 0.7) : 1;
    let budget = st.capacity * step.days * throttle;
    this.sN = this.kN = this.slotN = 0;

    // --- line pack as a source
    let lpUsed = 0;
    for (let i = 0; i < items.length; i++) {
      const v = st.linepack[items[i]];
      if (v && v > EPS) {
        lpUsed += v;
        this.pushSource(null, i, v, SRC_LINEPACK, false);
      }
    }
    // --- buildings
    const bs = ctx.state.buildings;
    for (const b of net.buildings) {
      if (bs[b.id] !== b || !rt.operational(b)) continue;
      const recordIo = TANK_TYPES.has(b.type) || TERMINAL_TYPES.has(b.type) || OFFSHORE_HUB_TYPES.has(b.type);
      for (const item in b.storage) {
        if (itemCat(item) !== cat) continue;
        const q = b.storage[item];
        if (!(q > EPS)) continue;
        const kind = sourceKind(ctx, b, item, cat);
        if (kind >= 0) this.pushSource(b, ITEM_INDEX[item], q, kind, recordIo);
      }
      const capCat = capacityOf(ctx, b, cat);
      let slot = -1;
      const filter = TANK_TYPES.has(b.type) ? 1 : OFFSHORE_HUB_TYPES.has(b.type) ? 2 : 0;
      for (let i = 0; i < items.length; i++) {
        const spec = sinkSpec(ctx, b, items[i], cat);
        if (!(spec.cap > EPS)) continue;
        if (spec.tier === TIER_FLARE) {
          const fs = this.newSlot(FLARE_CAPACITY * step.days);
          this.pushSink(b, i, Infinity, fs, spec.tier, 0, false);
          continue;
        }
        if (capCat <= 0) continue;
        if (slot < 0) slot = this.newSlot(Math.max(0, capCat - usedOf(b, cat)));
        this.pushSink(b, i, spec.cap, slot, spec.tier, filter, recordIo);
      }
    }
    if (this.sN === 0) return 0;

    // --- leak (tier 0): fluid lost from the line
    if (leak && !leak.isolated && leak.rate > 0) {
      let supply = 0;
      for (let s = 0; s < this.sN; s++) supply += this.sAvail[s];
      const loss = Math.min(supply, leak.rate * step.days);
      if (loss > EPS) {
        const f = loss / supply;
        for (let s = 0; s < this.sN; s++) {
          const take = this.sAvail[s] * f;
          if (take <= EPS) continue;
          this.takeFrom(s, take, st);
          this.leakSink(net, items[this.sItem[s]], take);
        }
      }
    }

    let moved = 0;
    // --- priority passes
    for (let p = 0; p < PASSES.length && budget > EPS; p++) {
      const [tier, filter, mask] = PASSES[p];
      for (let ii = 0; ii < items.length && budget > EPS; ii++) {
        const m = this.movePass(ii, tier, filter, mask, st, budget);
        budget -= m;
        moved += m;
      }
    }
    // --- line pack fill from producers/hubs
    const lpCap = st.pipeCount * LINEPACK_PER_BLOCK[cat];
    lpUsed = 0;
    for (const k in st.linepack) lpUsed += st.linepack[k];
    let lpRoom = lpCap - lpUsed;
    for (let ii = 0; ii < items.length && lpRoom > EPS && budget > EPS; ii++) {
      let supply = 0;
      for (let s = 0; s < this.sN; s++) if (this.sItem[s] === ii && (this.sKind[s] === SRC_PRODUCER || this.sKind[s] === SRC_HUB)) supply += this.sAvail[s];
      const move = Math.min(supply, lpRoom, budget);
      if (move <= EPS) continue;
      const f = move / supply;
      for (let s = 0; s < this.sN; s++) {
        if (this.sItem[s] !== ii || (this.sKind[s] !== SRC_PRODUCER && this.sKind[s] !== SRC_HUB)) continue;
        this.takeFrom(s, this.sAvail[s] * f, st);
      }
      st.linepack[items[ii]] = (st.linepack[items[ii]] ?? 0) + move;
      lpRoom -= move;
      budget -= move;
      moved += move;
    }
    // --- flares burn raw gas that has nowhere else to go (producers & hubs only)
    if (cat === 'gas' && budget > EPS) {
      moved += this.movePass(ITEM_INDEX['natural_gas'], TIER_FLARE, 0, M_PROD | M_HUB, st, budget);
    }
    // tidy line pack
    for (const k in st.linepack) if (st.linepack[k] < 1e-6) delete st.linepack[k];
    return moved;
  }

  /** Move one item from eligible sources to sinks of one tier. Returns the amount moved. */
  private movePass(ii: number, tier: number, filter: number, mask: number, st: NetworkState, budget: number): number {
    let supply = 0;
    for (let s = 0; s < this.sN; s++) if (this.sItem[s] === ii && (mask & (1 << this.sKind[s]))) supply += this.sAvail[s];
    if (supply <= EPS) return 0;
    let demand = 0;
    for (let k = 0; k < this.kN; k++) {
      if (this.kItem[k] !== ii || this.kTier[k] !== tier) continue;
      if (filter === 1 && this.kFilter[k] === 0) continue;
      if (filter === 2 && this.kFilter[k] !== 1) continue;
      const r = Math.min(this.kCap[k], this.slotRoom[this.kSlot[k]]);
      if (r > EPS) demand += r;
    }
    if (demand <= EPS) return 0;
    const move = Math.min(supply, demand, budget);
    if (move <= EPS) return 0;
    const fs = move / supply;
    for (let s = 0; s < this.sN; s++) {
      if (this.sItem[s] !== ii || !(mask & (1 << this.sKind[s]))) continue;
      this.takeFrom(s, this.sAvail[s] * fs, st);
    }
    const fd = move / demand;
    const items = ITEMS_BY_CAT[st.category];
    const item = items[ii];
    for (let k = 0; k < this.kN; k++) {
      if (this.kItem[k] !== ii || this.kTier[k] !== tier) continue;
      if (filter === 1 && this.kFilter[k] === 0) continue;
      if (filter === 2 && this.kFilter[k] !== 1) continue;
      const r = Math.min(this.kCap[k], this.slotRoom[this.kSlot[k]]);
      if (r <= EPS) continue;
      const put = r * fd;
      this.kCap[k] -= put;
      this.slotRoom[this.kSlot[k]] -= put;
      this.deliver(k, item, put, tier);
    }
    return move;
  }

  private deliver(k: number, item: string, qty: number, tier: number): void {
    const b = this.kB[k];
    if (tier === TIER_FLARE) {
      burnFlare(this.rt, b, qty);
      return;
    }
    addStorage(b, item, qty);
    if (this.kIo[k]) this.rt.io(b, item, qty);
  }

  private takeFrom(s: number, qty: number, st: NetworkState): void {
    if (qty <= 0) return;
    this.sAvail[s] -= qty;
    const b = this.sB[s];
    const item = ITEMS_BY_CAT[st.category][this.sItem[s]];
    if (!b) {
      st.linepack[item] = Math.max(0, (st.linepack[item] ?? 0) - qty);
      return;
    }
    takeStorage(b, item, qty);
    if (this.sIo[s]) this.rt.io(b, item, -qty);
  }

  private pushSource(b: BuildingState | null, item: number, avail: number, kind: number, io: boolean) {
    const n = this.sN++;
    this.sB[n] = b;
    this.sItem[n] = item;
    this.sAvail[n] = avail;
    this.sKind[n] = kind;
    this.sIo[n] = io;
  }
  private pushSink(b: BuildingState, item: number, cap: number, slot: number, tier: number, filter: number, io: boolean) {
    const n = this.kN++;
    this.kB[n] = b;
    this.kItem[n] = item;
    this.kCap[n] = cap;
    this.kSlot[n] = slot;
    this.kTier[n] = tier;
    this.kFilter[n] = filter;
    this.kIo[n] = io;
  }
  private newSlot(room: number): number {
    const n = this.slotN++;
    this.slotRoom[n] = room;
    return n;
  }

  /**
   * Wellheads & offshore hubs: raw gas that cannot leave is flared (or vented when flaring is disabled);
   * offshore produced water beyond half the tank is treated and discharged overboard.
   */
  private handleProducerExcess(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const alpha = emaAlpha(step.minutes);
    for (const b of rt.list) {
      if (!PRODUCER_TYPES.has(b.type) || b.constructionProgress < 1) continue;
      let hasGasNet = false;
      for (const id of rt.rtOf(b).networks) if (rt.topology.byId.get(id)?.cat === 'gas') hasGasNet = true;
      const cap = capacityOf(ctx, b, 'gas');
      const gas = b.storage.natural_gas ?? 0;
      const threshold = (hasGasNet ? 0.85 : 0.1) * cap;
      let flared = 0;
      let vented = 0;
      if (gas > threshold && gas > EPS) {
        const excess = gas - threshold;
        takeStorage(b, 'natural_gas', excess);
        if (b.config.flareExcessGas !== false) {
          flared = excess;
          const env = ctx.state.environment;
          env.flaredToday += excess;
          const e = excess * CO2_PER_MCF_BURNED * ctx.modifier('flare_emissions');
          env.emissionsToday += e;
          env.emissionsTotal += e;
        } else {
          vented = excess;
          ctx.state.environment.ventedToday += excess;
        }
      }
      if (step.days > 0) {
        const fr = (b.data.flareRate as number | undefined) ?? 0;
        const vr = (b.data.ventRate as number | undefined) ?? 0;
        const nf = fr + (flared / step.days - fr) * alpha;
        const nv = vr + (vented / step.days - vr) * alpha;
        if (nf > 0.5) b.data.flareRate = Math.round(nf * 10) / 10;
        else if (b.data.flareRate !== undefined) delete b.data.flareRate;
        if (nv > 0.5) b.data.ventRate = Math.round(nv * 10) / 10;
        else if (b.data.ventRate !== undefined) delete b.data.ventRate;
      }
      if (OFFSHORE_HUB_TYPES.has(b.type)) {
        const wcap = capacityOf(ctx, b, 'water');
        const w = b.storage.produced_water ?? 0;
        const keep = wcap * 0.5;
        if (w > keep) {
          const out = Math.min(w - keep, OVERBOARD_CAPACITY * step.days);
          takeStorage(b, 'produced_water', out);
          rt.io(b, 'produced_water', -out);
        }
      }
    }
  }
}

/** Burn gas in a flare stack: counts as flared gas & emissions; tracked in io and utilization. */
export function burnFlare(rt: FacilityRuntime, b: BuildingState, qty: number): void {
  const ctx = rt.ctx;
  const env = ctx.state.environment;
  env.flaredToday += qty;
  const e = qty * CO2_PER_MCF_BURNED * ctx.modifier('flare_emissions');
  env.emissionsToday += e;
  env.emissionsTotal += e;
  rt.io(b, 'natural_gas', -qty);
}

/** Booster/flare utilisation helper used by the finalize pass. */
export function boosterUtilization(rt: FacilityRuntime, b: BuildingState): number {
  const cats = BOOSTER_TYPES[b.type];
  if (!cats) return 0;
  let u = 0;
  for (const id of rt.rtOf(b).networks) {
    const n = rt.topology.byId.get(id);
    if (!n || !cats.includes(n.cat) || n.state.capacity <= 0) continue;
    u = Math.max(u, n.state.flow / n.state.capacity);
  }
  return Math.min(1, u);
}

