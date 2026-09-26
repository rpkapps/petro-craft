// Shared, non-persistent runtime for the facilities systems: building caches & spatial index, worker lookup,
// per-building scratch accumulators and per-step derived factors. Everything here can be rebuilt from GameState.
import { BUILDINGS } from '../../content/buildings';
import { DIFFICULTY_SETTINGS } from '../../core/constants';
import { RIG_TYPES, UPSTREAM_TYPES, containsPoint } from '../../core/buildingUtil';
import type { BuildingState, GameContext, HazardsState, Worker } from '../../core/types';
import { Topology } from './networks/topology';
import { applyConfigDefaults } from './config';

/** Per-building scratch data (not saved). */
export interface BuildingRt {
  /** Units moved/produced/consumed this step (+ in/produce, − out/consume). Turned into b.io rates. */
  ioAcc: Record<string, number>;
  /** Network ids this building is connected to (derived by topology). */
  networks: string[];
  /** Emission rate this step (t/day) before CCS capture. */
  emitRate: number;
}

export class FacilityRuntime {
  ctx!: GameContext;
  readonly topology = new Topology(this);

  /** Cached array of all buildings (refreshed when buildings are added/removed). */
  list: BuildingState[] = [];
  private listCount = -1;
  private buildingsDirty = true;
  /** Column (x + z*sizeX) → building ids whose footprint covers the column. */
  private columns = new Map<number, string[]>();
  /** Rig id → ids of wellheads standing inside the rig footprint (they share the rig's pipe contact). */
  readonly rigWellheads = new Map<string, string[]>();
  private readonly brt = new Map<string, BuildingRt>();

  /** Worker lookup (rebuilt once per step). */
  private readonly workerById = new Map<string, Worker>();
  /** Crew factor per building for this step. */
  private readonly crewCache = new Map<string, number>();

  /** Power satisfaction for consumers this step (0..1). */
  powerFactor = 1;
  /** Current game hour index (floor(totalMinutes/60)); `newHour` true on the first step of a new hour. */
  hourIndex = -1;
  newHour = false;
  /** Minutes in the current step (for helpers). */
  stepMinutes = 0;

  /** Money accumulators flushed hourly into single ledger entries. */
  pending = { gridImport: 0, gridExport: 0, truckedDiesel: 0, parts: 0, partsQty: 0 };

  /** Cleanup callbacks (event subscriptions). */
  readonly disposers: Array<() => void> = [];

  get sizeX() {
    return this.ctx.world.sizeX;
  }
  get sizeZ() {
    return this.ctx.world.sizeZ;
  }
  get hazardRate(): number {
    return DIFFICULTY_SETTINGS[this.ctx.state.meta.difficulty]?.hazardRate ?? 1;
  }
  get failureRate(): number {
    return DIFFICULTY_SETTINGS[this.ctx.state.meta.difficulty]?.failureRate ?? 1;
  }
  get hazardsOn(): boolean {
    return this.ctx.state.meta.rules.hazards !== false;
  }

  attach(ctx: GameContext) {
    this.ctx = ctx;
    this.buildingsDirty = true;
    this.listCount = -1;
    this.hourIndex = Math.floor(ctx.state.time.totalMinutes / 60);
  }

  markBuildingsDirty() {
    this.buildingsDirty = true;
    this.topology.invalidate();
  }

  /** Refresh building caches if buildings were added/removed (event-driven, with a cheap count check as backup). */
  refreshBuildings(): void {
    const bs = this.ctx.state.buildings;
    let n = 0;
    for (const _ in bs) n++;
    if (!this.buildingsDirty && n === this.listCount) return;
    this.buildingsDirty = false;
    this.listCount = n;
    this.list.length = 0;
    this.columns.clear();
    this.rigWellheads.clear();
    const sx = this.ctx.world.sizeX;
    for (const id in bs) {
      const b = bs[id];
      this.list.push(b);
      if (!this.brt.has(id)) {
        this.brt.set(id, { ioAcc: {}, networks: [], emitRate: 0 });
        applyConfigDefaults(b);
      }
      for (let z = b.z; z < b.z + b.size[1]; z++)
        for (let x = b.x; x < b.x + b.size[0]; x++) {
          const k = x + z * sx;
          const arr = this.columns.get(k);
          if (arr) arr.push(id);
          else this.columns.set(k, [id]);
        }
    }
    // Wellheads standing inside a rig footprint connect through the rig's outline.
    for (const b of this.list) {
      if (b.type !== 'wellhead') continue;
      const cx = b.x + (b.size[0] >> 1);
      const cz = b.z + (b.size[1] >> 1);
      for (const id of this.columns.get(cx + cz * sx) ?? []) {
        const o = bs[id];
        if (o && RIG_TYPES.has(o.type)) {
          const arr = this.rigWellheads.get(o.id);
          if (arr) arr.push(b.id);
          else this.rigWellheads.set(o.id, [b.id]);
        }
      }
    }
    for (const id of Array.from(this.brt.keys())) if (!bs[id]) this.brt.delete(id);
    this.topology.invalidate();
  }

  rtOf(b: BuildingState): BuildingRt {
    let r = this.brt.get(b.id);
    if (!r) {
      r = { ioAcc: {}, networks: [], emitRate: 0 };
      this.brt.set(b.id, r);
      applyConfigDefaults(b);
    }
    return r;
  }

  /** Building ids whose footprint column covers (x, z). */
  idsAtColumn(x: number, z: number): readonly string[] {
    if (x < 0 || z < 0 || x >= this.ctx.world.sizeX || z >= this.ctx.world.sizeZ) return EMPTY;
    return this.columns.get(x + z * this.ctx.world.sizeX) ?? EMPTY;
  }

  /** Smallest building containing the block (like core findBuildingAt, but indexed). */
  buildingAt(x: number, y: number, z: number): BuildingState | undefined {
    let best: BuildingState | undefined;
    let bestVol = Infinity;
    for (const id of this.idsAtColumn(x, z)) {
      const b = this.ctx.state.buildings[id];
      if (!b || !containsPoint(b, x, y, z)) continue;
      const v = b.size[0] * b.size[1] * b.size[2];
      if (v < bestVol) {
        best = b;
        bestVol = v;
      }
    }
    return best;
  }

  /** Rebuild the worker lookup and clear per-step caches. Call once at the start of each step. */
  beginStep(minutes: number): void {
    this.stepMinutes = minutes;
    this.workerById.clear();
    for (const w of this.ctx.state.workforce.workers) this.workerById.set(w.id, w);
    this.crewCache.clear();
    const h = Math.floor(this.ctx.state.time.totalMinutes / 60);
    this.newHour = h !== this.hourIndex;
    this.hourIndex = h;
  }

  /** Crew efficiency 0..1.25 (same formula as core crewFactor, using the cached worker map). */
  crew(b: BuildingState): number {
    const cached = this.crewCache.get(b.id);
    if (cached !== undefined) return cached;
    const d = BUILDINGS[b.type];
    let f = Infinity;
    const day = this.ctx.state.time.day;
    if (d) {
      for (const role in d.crew) {
        const n = d.crew[role as keyof typeof d.crew];
        if (!n) continue;
        let have = 0;
        let skill = 0;
        for (const wid of b.workers) {
          const w = this.workerById.get(wid);
          if (w && w.role === role && !(w.injured && w.injured > day)) {
            have++;
            skill += w.skill;
          }
        }
        const ratio = Math.min(1, have / n);
        const bonus = have > 0 ? ((skill / have - 1) / 4) * 0.25 : 0;
        f = Math.min(f, ratio * (1 + bonus));
      }
    }
    const v = f === Infinity ? 1 : f;
    this.crewCache.set(b.id, v);
    return v;
  }

  needsCrew(b: BuildingState): boolean {
    const d = BUILDINGS[b.type];
    if (!d) return false;
    for (const role in d.crew) if (d.crew[role as keyof typeof d.crew]) return true;
    return false;
  }

  /** Complete, enabled, not broken/burning/destroyed. */
  operational(b: BuildingState): boolean {
    return b.constructionProgress >= 1 && b.enabled && b.status !== 'broken' && b.status !== 'fire' && b.status !== 'destroyed' && !(b.fire > 0);
  }

  /** Mechanical condition → throughput factor (1 above 50%, 0.6 at 0). */
  conditionFactor(b: BuildingState): number {
    return Math.min(1, 0.6 + (0.8 * b.condition) / 100);
  }

  /** Power factor for a building (1 for non-consumers). */
  powerOf(b: BuildingState): number {
    const d = BUILDINGS[b.type];
    return d && d.power > 0 ? this.powerFactor : 1;
  }

  /** Whether the building can run at all this step (operational, crewed, powered ≥ 30%). */
  canRun(b: BuildingState): boolean {
    if (!this.operational(b)) return false;
    if (this.needsCrew(b) && this.crew(b) <= 0) return false;
    if (this.powerOf(b) < 0.3) return false;
    return true;
  }

  /** Efficiency for processing = crew × power × condition × throttle (0 when it cannot run). */
  efficiency(b: BuildingState): number {
    if (!this.canRun(b)) return 0;
    return Math.min(1.25, this.crew(b)) * this.powerOf(b) * this.conditionFactor(b) * Math.max(0, Math.min(1, b.throttle));
  }

  isUpstream(b: BuildingState): boolean {
    return UPSTREAM_TYPES.has(b.type);
  }

  /** Record units into a building's per-step IO accumulator. */
  io(b: BuildingState, item: string, units: number): void {
    const acc = this.rtOf(b).ioAcc;
    acc[item] = (acc[item] ?? 0) + units;
  }

  /** Accrue money into an hourly bucket. */
  flushMoney(): void {
    const p = this.pending;
    const ctx = this.ctx;
    if (p.gridImport > 0.5) ctx.transact(-p.gridImport, 'fuel', 'Grid electricity import');
    if (p.truckedDiesel > 0.5) ctx.transact(-p.truckedDiesel, 'fuel', 'Trucked diesel for generators');
    if (p.gridExport > 0.5) ctx.transact(p.gridExport, 'sales', 'Surplus power sold to the grid');
    if (p.parts > 0.5) ctx.transact(-p.parts, 'repairs', `Spare parts (${Math.round(p.partsQty)} ea, auto-purchased)`);
    p.gridImport = p.gridExport = p.truckedDiesel = p.parts = p.partsQty = 0;
  }

  /** Append to the hazards incident log (capped). Safety incidents reset the "days since incident" counter. */
  incident(kind: HazardsState['incidents'][number]['kind'], text: string, x?: number, z?: number): void {
    const h = this.ctx.state.hazards;
    h.incidents.push({ day: this.ctx.state.time.day, kind, text, x: x === undefined ? undefined : Math.round(x), z: z === undefined ? undefined : Math.round(z) });
    if (h.incidents.length > MAX_INCIDENTS) h.incidents.splice(0, h.incidents.length - MAX_INCIDENTS);
    if (kind !== 'failure' && kind !== 'leak') h.daysSinceIncident = 0;
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

const EMPTY: readonly string[] = [];
const MAX_INCIDENTS = 100;

/** Center of a building in block coordinates (floating). */
export function centerOf(b: BuildingState): { x: number; y: number; z: number } {
  return { x: b.x + b.size[0] / 2, y: b.y + b.size[2] / 2, z: b.z + b.size[1] / 2 };
}

/** Horizontal distance from a point to a building footprint (0 if inside). */
export function distToFootprint(b: BuildingState, x: number, z: number): number {
  const dx = x < b.x ? b.x - x : x > b.x + b.size[0] ? x - (b.x + b.size[0]) : 0;
  const dz = z < b.z ? b.z - z : z > b.z + b.size[1] ? z - (b.z + b.size[1]) : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Horizontal distance between the centres of two buildings. */
export function centerDist(a: BuildingState, b: BuildingState): number {
  const dx = a.x + a.size[0] / 2 - (b.x + b.size[0] / 2);
  const dz = a.z + a.size[1] / 2 - (b.z + b.size[1] / 2);
  return Math.sqrt(dx * dx + dz * dz);
}
