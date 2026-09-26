// Pipeline leaks and spills: random leaks on pressurised networks, detection / auto-isolation (leak_detection),
// crew repairs, spill records in environment.spills with OIL_POOL blocks on the ground, cleanup by spill-response
// bases (96 blocks) and natural weathering.
import { B, IS_SOLID } from '../../core/blocks';
import type { FluidCat, GameContext, SimStep, Spill } from '../../core/types';
import { PIPE_CAT } from './catalog';
import type { LeakExt } from './networks/flow';
import type { NetRt } from './networks/topology';
import { centerOf, type FacilityRuntime } from './runtime';

const CHEMICALS = new Set(['ethylene', 'propylene', 'polyethylene', 'polypropylene', 'ammonia', 'methanol', 'sulfur']);
const MAX_POOLS = 48;
const SPILL_RESPONSE_RANGE = 96;
const SPILL_RESPONSE_RATE = 900; // bbl/day per fully-crewed base
const LEAK_RATE: Record<FluidCat, number> = { oil: 30, gas: 400, water: 30, product: 30 };
const PLANTS = new Set<number>([B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.SNOW, B.REEDS]);

/** Spiral of column offsets around a spill (nearest first, deterministic). */
const OFFSETS: Array<[number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dz * dz <= 36) out.push([dx, dz, dx * dx + dz * dz + Math.atan2(dz, dx) * 1e-3]);
  out.sort((a, b) => a[2] - b[2]);
  return out.slice(0, MAX_POOLS).map(([dx, dz]) => [dx, dz]);
})();

function poolsFor(remaining: number): number {
  if (remaining < 2) return 0;
  return Math.min(MAX_POOLS, Math.ceil(Math.sqrt(remaining / 25)));
}

export class SpillSystem {
  /** spill id → number of pool positions currently synced. */
  private readonly pools = new Map<string, number>();
  constructor(private readonly rt: FacilityRuntime) {}

  private get ctx(): GameContext {
    return this.rt.ctx;
  }

  /** Fluid lost from a leaking network this step (called by the flow engine). */
  onLeakLoss(net: NetRt, item: string, qty: number): void {
    const ctx = this.ctx;
    const leak = net.state.leak as LeakExt | undefined;
    if (!leak || qty <= 0) return;
    const env = ctx.state.environment;
    if (net.cat === 'gas') {
      if (item === 'co2') {
        env.emissionsToday += qty;
        env.emissionsTotal += qty;
      } else env.ventedToday += qty;
      return;
    }
    if (item === 'fresh_water') return;
    const kind: Spill['kind'] = net.cat === 'water' ? 'water' : CHEMICALS.has(item) ? 'chemical' : 'oil';
    let spill = leak.spillId ? env.spills.find((s) => s.id === leak.spillId) : undefined;
    if (!spill || spill.cleaned >= spill.volume) {
      spill = this.addSpill(kind, leak.x, leak.y, leak.z, qty);
      leak.spillId = spill.id;
    } else spill.volume += qty;
  }

  /** Create (or grow an active one at the same spot) a spill record. */
  addSpill(kind: Spill['kind'], x: number, y: number, z: number, volume: number): Spill {
    const ctx = this.ctx;
    const env = ctx.state.environment;
    for (const s of env.spills) {
      if (s.kind === kind && s.x === x && s.z === z && s.cleaned < s.volume) {
        s.volume += volume;
        return s;
      }
    }
    const s: Spill = { id: ctx.newId('spill'), x, y, z, volume, cleaned: 0, day: ctx.state.time.day, kind };
    env.spills.push(s);
    ctx.bus.emit('hazard:spill', { x, y, z, volume });
    this.rt.incident('spill', `${kind === 'water' ? 'Brine' : kind === 'chemical' ? 'Chemical' : 'Oil'} spill`, x, z);
    return s;
  }

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = this.ctx;
    const now = ctx.state.time.totalMinutes;
    // --- leak lifecycle
    for (const net of rt.topology.nets) {
      const leak = net.state.leak as LeakExt | undefined;
      if (!leak) continue;
      if (!leak.detected && now >= (leak.detectAt ?? 0)) {
        leak.detected = true;
        const cat = net.cat;
        ctx.notify('warning', `${cat === 'gas' ? 'Gas' : cat === 'water' ? 'Water line' : cat === 'oil' ? 'Crude' : 'Product'} pipeline leak detected`,
          `Line ${net.id} is losing ${Math.round(leak.rate)} ${cat === 'gas' ? 'mcf' : 'bbl'}/day. Send a crew or fix it with the wrench.`, { x: leak.x, y: leak.y, z: leak.z });
        rt.incident('leak', `Leak on ${cat} line ${net.id}`, leak.x, leak.z);
        if (ctx.hasTech('leak_detection')) leak.isolateAt = now + 120;
      }
      if (leak.detected && !leak.isolated && leak.isolateAt !== undefined && now >= leak.isolateAt) {
        leak.isolated = true;
        ctx.notify('info', 'Leak isolated', `Automatic valves isolated the leaking section of ${net.id}. Throughput is reduced until it is repaired.`, { x: leak.x, y: leak.y, z: leak.z });
      }
      if (leak.repairAt !== undefined && now >= leak.repairAt) {
        delete net.state.leak;
        ctx.notify('success', 'Pipeline repaired', `Crew repaired the leak on ${net.id}.`, { x: leak.x, y: leak.y, z: leak.z });
      }
    }
    if (rt.newHour && rt.hazardsOn) this.rollLeaks();
    this.cleanup(step);
    this.syncPools();
  }

  /** Hourly leak chance per pressurised network ∝ length × spill_risk × difficulty × equipment condition. */
  private rollLeaks(): void {
    const rt = this.rt;
    const ctx = this.ctx;
    const risk = ctx.modifier('spill_risk') * rt.hazardRate;
    for (const net of rt.topology.nets) {
      const st = net.state;
      if (st.leak || st.flow < 1 || st.pipeCount === 0) continue;
      let cond = 0;
      let n = 0;
      for (const b of net.buildings) {
        cond += b.condition;
        n++;
      }
      const avg = n ? cond / n : 100;
      const condFactor = 1 + Math.max(0, (60 - avg) / 60);
      const pDay = Math.min(0.5, (st.pipeCount / 8000) * risk * condFactor);
      if (ctx.rng() >= pDay / 24) continue;
      this.startLeak(net);
    }
  }

  /** Start a leak at a random pipe block of the network. */
  startLeak(net: NetRt, rateOverride?: number): void {
    const ctx = this.ctx;
    const k = net.pipes[Math.floor(ctx.rng() * net.pipes.length)];
    const p = this.rt.topology.decode(k);
    const rate = rateOverride ?? Math.max(LEAK_RATE[net.cat], 0.04 * net.state.capacity);
    const now = ctx.state.time.totalMinutes;
    const detectDelay = ctx.hasTech('leak_detection') ? 30 : 360 + ctx.rng() * 480;
    const leak: LeakExt = { x: p.x, y: p.y, z: p.z, rate: Math.round(rate), startedDay: ctx.state.time.day, detectAt: now + detectDelay, detected: false };
    net.state.leak = leak;
    ctx.bus.emit('network:leak', { networkId: net.id, x: p.x, y: p.y, z: p.z });
  }

  /** Repair a network leak. Manual (wrench) is immediate; a dispatched crew costs money and takes ~3 hours. */
  repairLeak(netId: string, manual: boolean): { ok: boolean; error?: string } {
    const ctx = this.ctx;
    const net = this.rt.topology.byId.get(netId);
    const leak = net?.state.leak as LeakExt | undefined;
    if (!net || !leak) return { ok: false, error: 'No leak on this line' };
    if (manual) {
      delete net.state.leak;
      ctx.notify('success', 'Leak fixed', `You clamped the leak on ${net.id}.`, { x: leak.x, y: leak.y, z: leak.z });
      return { ok: true };
    }
    if (leak.repairAt !== undefined) return { ok: false, error: 'A repair crew is already on the way' };
    const cost = 18000;
    if (!ctx.transact(-cost, 'repairs', `Pipeline leak repair crew (${net.id})`, true)) return { ok: false, error: 'Not enough money for a repair crew ($18k)' };
    leak.repairAt = ctx.state.time.totalMinutes + 180 / ctx.modifier('repair_speed');
    ctx.notify('info', 'Repair crew dispatched', `Crew en route to the leak on ${net.id}.`, { x: leak.x, y: leak.y, z: leak.z });
    return { ok: true };
  }

  /** Spill response bases & natural weathering. */
  private cleanup(step: SimStep): void {
    const rt = this.rt;
    const env = this.ctx.state.environment;
    if (env.spills.length === 0) return;
    for (const s of env.spills) {
      const rem = s.volume - s.cleaned;
      if (rem <= 0) continue;
      const weather = s.kind === 'water' ? 0.1 : s.kind === 'chemical' ? 0.03 : 0.01;
      s.cleaned = Math.min(s.volume, s.cleaned + rem * weather * step.days);
    }
    for (const b of rt.list) {
      if (b.type !== 'spill_response' || !rt.canRun(b)) continue;
      let cap = SPILL_RESPONSE_RATE * Math.min(1.25, rt.crew(b)) * step.days;
      const c = centerOf(b);
      let active = false;
      while (cap > 1e-6) {
        let best: Spill | undefined;
        let bd = Infinity;
        for (const s of env.spills) {
          if (s.cleaned >= s.volume) continue;
          const d = Math.hypot(s.x - c.x, s.z - c.z);
          if (d <= SPILL_RESPONSE_RANGE && d < bd) {
            bd = d;
            best = s;
          }
        }
        if (!best) break;
        const take = Math.min(cap, best.volume - best.cleaned);
        best.cleaned += take;
        if (best.volume - best.cleaned < 0.5) best.cleaned = best.volume;
        cap -= take;
        active = true;
      }
      b.data.responding = active;
    }
  }

  /** Keep OIL_POOL blocks in sync with each oil spill's remaining volume. */
  private syncPools(): void {
    const env = this.ctx.state.environment;
    for (const s of env.spills) {
      if (s.kind !== 'oil') continue;
      const want = poolsFor(s.volume - s.cleaned);
      const have = this.pools.get(s.id);
      if (have === want) continue;
      if (have === undefined) {
        // After load: assume placed up to `want`, clear anything beyond.
        this.clearPools(s, want, MAX_POOLS);
        this.placePools(s, 0, want);
      } else if (want > have) this.placePools(s, have, want);
      else this.clearPools(s, want, have);
      this.pools.set(s.id, want);
    }
  }

  private placePools(s: Spill, from: number, to: number): void {
    const w = this.ctx.world;
    for (let i = from; i < to && i < OFFSETS.length; i++) {
      const x = s.x + OFFSETS[i][0];
      const z = s.z + OFFSETS[i][1];
      if (!w.inBounds(x, 1, z)) continue;
      const y = w.getSurfaceY(x, z);
      if (y <= 0 || y >= w.height - 1 || Math.abs(y - s.y) > 4) continue;
      const cur = w.getBlock(x, y, z);
      if (cur !== B.AIR && !PLANTS.has(cur)) continue;
      const below = w.getBlock(x, y - 1, z);
      if (!IS_SOLID[below] || below === B.STRUCTURE || below === B.CASING || PIPE_CAT[below] >= 0) continue;
      w.setBlock(x, y, z, B.OIL_POOL, 'system');
    }
  }

  private clearPools(s: Spill, from: number, to: number): void {
    const w = this.ctx.world;
    for (let i = from; i < to && i < OFFSETS.length; i++) {
      const x = s.x + OFFSETS[i][0];
      const z = s.z + OFFSETS[i][1];
      if (!w.inBounds(x, 1, z)) continue;
      const y = w.getSurfaceY(x, z);
      if (w.getBlock(x, y, z) === B.OIL_POOL) w.setBlock(x, y, z, B.AIR, 'system');
    }
  }

  /** Daily housekeeping: drop spills that have been fully cleaned for over a day. */
  onNewDay(day: number): void {
    const env = this.ctx.state.environment;
    const keep: Spill[] = [];
    for (const s of env.spills) {
      if (s.cleaned >= s.volume && s.day < day - 1) {
        this.clearPools(s, 0, MAX_POOLS);
        this.pools.delete(s.id);
        continue;
      }
      keep.push(s);
    }
    if (keep.length > 200) keep.splice(0, keep.length - 200);
    env.spills = keep;
  }
}

