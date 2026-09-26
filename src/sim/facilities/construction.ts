// Construction lifecycle: placing (charge, level, add), contractor build progress, completion, demolition /
// cancellation with refunds, and the free starting Field Office for new games.
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { RIG_TYPES, addBuilding, createBuildingState, removeBuilding, rotatedSize } from '../../core/buildingUtil';
import type { BuildingState, Rotation, SimStep, WellStatus } from '../../core/types';
import type { CommandResult } from '../../core/commands';
import { applyConfigDefaults } from './config';
import { buildCost, levelSite, validatePlacement } from './placement';
import { centerOf, type FacilityRuntime } from './runtime';
import { recipeOf } from './storage';

const BUSY_WELL: ReadonlySet<WellStatus> = new Set<WellStatus>(['drilling', 'tripping', 'casing', 'kick', 'blowout', 'completing']);
const WEATHER_SLOWDOWN: Record<string, number> = { rain: 0.85, snow: 0.8, fog: 0.95, storm: 0.5, blizzard: 0.4, hurricane: 0.2 };
export const REFUND_COMPLETE = 0.3;
export const REFUND_CONSTRUCTING = 0.9;

export class ConstructionSystem {
  constructor(private readonly rt: FacilityRuntime) {}

  /** 'build/place'. */
  place(type: string, x: number, z: number, rotation: Rotation, owner: string): CommandResult {
    const rt = this.rt;
    const ctx = rt.ctx;
    rt.refreshBuildings();
    const rot = ((((rotation | 0) % 4) + 4) % 4) as Rotation;
    const v = validatePlacement(rt, type, x, z, rot);
    if (!v.ok) return { ok: false, error: v.reason };
    const d = BUILDINGS[type];
    if (v.cost > 0 && !ctx.transact(-v.cost, 'construction', `Construction: ${d.name}`, true)) return { ok: false, error: 'Not enough money' };
    const b = this.spawn(type, Math.floor(x), v.y, Math.floor(z), rot, owner, false);
    b.data.cost = v.cost;
    return { ok: true, data: { buildingId: b.id, cost: v.cost } };
  }

  /** Level the site and insert the building (constructing unless prebuilt). */
  spawn(type: string, x: number, y: number, z: number, rotation: Rotation, owner: string, prebuilt: boolean): BuildingState {
    const rt = this.rt;
    const ctx = rt.ctx;
    levelSite(rt, type, x, y, z, rotation);
    const b = createBuildingState(ctx, type, x, y, z, rotation, { prebuilt, owner });
    applyConfigDefaults(b);
    if (prebuilt) recipeOf(b);
    if (BUILDINGS[type].buildHours <= 0 && !prebuilt) {
      b.constructionProgress = 1;
      b.status = 'idle';
    }
    addBuilding(ctx, b);
    rt.markBuildingsDirty();
    rt.refreshBuildings();
    return b;
  }

  /** Contractor progress (no crew needed); paused while disabled; slowed by bad weather. */
  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const speed = ctx.modifier('construction_speed') * (WEATHER_SLOWDOWN[ctx.state.weather.current] ?? 1);
    for (const b of rt.list) {
      if (b.constructionProgress >= 1 || !b.enabled || b.status === 'destroyed' || b.fire > 0) continue;
      const hours = BUILDINGS[b.type]?.buildHours ?? 0;
      b.constructionProgress = hours <= 0 ? 1 : Math.min(1, b.constructionProgress + (step.minutes / 60 / hours) * speed);
      if (b.constructionProgress >= 1) this.complete(b);
    }
  }

  complete(b: BuildingState): void {
    const ctx = this.rt.ctx;
    b.constructionProgress = 1;
    b.builtDay = ctx.state.time.day;
    b.lastMaintenanceDay = ctx.state.time.day;
    b.condition = 100;
    applyConfigDefaults(b);
    recipeOf(b);
    const prev = b.status;
    b.status = 'idle';
    if (prev !== 'idle') ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: 'idle' });
    ctx.bus.emit('building:completed', { id: b.id });
    const c = centerOf(b);
    ctx.notify('success', `${BUILDINGS[b.type]?.name ?? b.type} completed`, undefined, { x: c.x, y: b.y, z: c.z });
  }

  /** 'build/demolish' (cancel=false) and 'build/cancel' (cancel=true). */
  demolish(buildingId: string, cancel: boolean): CommandResult {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = ctx.state;
    const b = st.buildings[buildingId];
    if (!b) return { ok: false, error: 'Building not found' };
    const d = BUILDINGS[b.type];
    const name = d?.name ?? b.type;
    const constructing = b.constructionProgress < 1;
    if (cancel && !constructing) return { ok: false, error: 'Already built — demolish it instead' };
    if (RIG_TYPES.has(b.type)) {
      for (const id in st.wells) {
        const w = st.wells[id];
        if (w.rigId === b.id && BUSY_WELL.has(w.status)) return { ok: false, error: `The rig is busy (${w.name}: ${w.status.replace('_', ' ')})` };
      }
    }
    if (b.type === 'wellhead' && b.wellId) {
      const w = st.wells[b.wellId];
      if (w && w.status !== 'plugged' && w.status !== 'dry_hole') return { ok: false, error: 'Plug & abandon the well before removing its wellhead' };
    }
    if (b.type === 'frac_spread' && b.wellId && st.wells[b.wellId]?.status === 'fracking') return { ok: false, error: 'A frac job is in progress' };

    const paid = typeof b.data.cost === 'number' ? (b.data.cost as number) : buildCost(ctx, b.type);
    const refund = b.status === 'destroyed' ? 0 : Math.round(paid * (constructing ? REFUND_CONSTRUCTING : REFUND_COMPLETE));
    // Salvage tradable stock into the company warehouse.
    const wh = st.company.warehouse;
    for (const item in b.storage) {
      const q = b.storage[item];
      if (q > 0.5 && ITEMS[item]?.tradable) wh[item] = (wh[item] ?? 0) + Math.floor(q);
    }
    // Extinguish fires on it.
    const fires = st.hazards.fires;
    for (let i = fires.length - 1; i >= 0; i--) {
      if (fires[i].buildingId === b.id) {
        const f = fires.splice(i, 1)[0];
        ctx.bus.emit('hazard:fireOut', { id: f.id });
      }
    }
    const c = centerOf(b);
    removeBuilding(ctx, b.id);
    // Drop network references right away (topology rebuild follows).
    for (const net of rt.topology.nets) {
      const i = net.buildings.indexOf(b);
      if (i >= 0) {
        net.buildings.splice(i, 1);
        net.state.buildings = net.buildings.map((x) => x.id);
      }
    }
    rt.markBuildingsDirty();
    rt.refreshBuildings();
    if (refund > 0) ctx.transact(refund, 'construction', `${cancel || constructing ? 'Cancelled' : 'Salvaged'}: ${name}`);
    ctx.notify('info', `${name} ${cancel || constructing ? 'cancelled' : 'demolished'}`, refund > 0 ? `Refunded $${refund.toLocaleString('en-US')}.` : undefined, { x: c.x, y: b.y, z: c.z });
    return { ok: true, data: { refund } };
  }

  /** New game: a free, pre-built Field Office on flat land 6–14 blocks from the local player's spawn. */
  placeStartingOffice(): BuildingState | undefined {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = ctx.state;
    const p = st.players[ctx.localPlayerId];
    if (!p) return undefined;
    const px = Math.floor(p.position.x);
    const pz = Math.floor(p.position.z);
    const type = 'field_office';
    for (const [rMin, rMax] of [[6, 14], [15, 32]] as const) {
      for (let r = rMin; r <= rMax; r++) {
        // Walk the square ring at Chebyshev radius r around the spawn (building centre on the ring).
        for (let i = 0; i < 8 * r; i++) {
          const side = Math.floor(i / (2 * r));
          const t = (i % (2 * r)) - r;
          const cx = side === 0 ? px + r : side === 1 ? px - t : side === 2 ? px - r : px + t;
          const cz = side === 0 ? pz + t : side === 1 ? pz + r : side === 2 ? pz - t : pz - r;
          for (const rot of [0, 1] as Rotation[]) {
            const [w, d] = rotatedSize(type, rot);
            const x = cx - (w >> 1);
            const z = cz - (d >> 1);
            const v = validatePlacement(rt, type, x, z, rot, { free: true });
            if (!v.ok) continue;
            const b = this.spawn(type, x, v.y, z, rot, ctx.localPlayerId, true);
            b.data.cost = 0;
            b.data.starter = true;
            return b;
          }
        }
      }
    }
    return undefined;
  }
}
