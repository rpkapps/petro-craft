// Fires (single list state.hazards.fires): growth, damage, spread, fire-station suppression, explosions,
// burn-out. Building fires set b.fire / status 'fire'; well fires (wellId) keep burning while the blowout does.
import { BUILDINGS } from '../../content/buildings';
import { B, IS_SOLID } from '../../core/blocks';
import { SEA_LEVEL } from '../../core/constants';
import type { BuildingState, Fire, SimStep } from '../../core/types';
import type { CommandResult } from '../../core/commands';
import { EXPLOSIVE_TYPES, ITEMS_BY_CAT, PIPE_CAT, PROCESSING_TYPES, TANK_TYPES } from './catalog';
import { centerOf, distToFootprint, type FacilityRuntime } from './runtime';
import { fillFraction } from './storage';

export const FIRE_STATION_RANGE = 80;
const SPREAD_INTERVAL = 30; // game minutes between spread rolls
const EXPLOSION_ROLL_MINUTES = 20;
const SOIL = new Set<number>([B.GRASS, B.DIRT, B.SAND, B.PODZOL, B.SNOW, B.RED_SAND, B.GRAVEL, B.MUD, B.CLAY, B.TERRACOTTA, B.PERMAFROST, B.SEABED_SILT]);
const BURNABLE = new Set<number>([B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.REEDS, B.LEAVES_OAK, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LEAVES, B.LOG_OAK, B.LOG_PINE, B.BIRCH_LOG, B.CACTUS, B.SNOW, B.OIL_POOL]);
const CRATER_KEEP = new Set<number>([B.STRUCTURE, B.BEDROCK, B.CASING, B.CONCRETE_PAD, B.GRAVEL_PAD, B.WATER]);

export class FireSystem {
  /** Per-fire hour accumulator for explosion rolls (fire id → minutes). */
  private readonly explodeTimer = new Map<string, number>();
  constructor(private readonly rt: FacilityRuntime) {}

  /** Start a fire on a building (no-op if it is already burning). */
  igniteBuilding(b: BuildingState, intensity: number, cause: string): Fire | undefined {
    const ctx = this.rt.ctx;
    if (b.status === 'destroyed' || b.constructionProgress <= 0) return undefined;
    const existing = ctx.state.hazards.fires.find((f) => f.buildingId === b.id);
    if (existing) {
      existing.intensity = Math.max(existing.intensity, intensity);
      return existing;
    }
    const c = centerOf(b);
    const f: Fire = { id: ctx.newId('fire'), x: Math.floor(c.x), y: b.y + Math.min(3, b.size[2] >> 1), z: Math.floor(c.z), intensity, buildingId: b.id, startedMinute: ctx.state.time.totalMinutes, spreadTimer: 0 };
    ctx.state.hazards.fires.push(f);
    b.fire = intensity;
    this.setStatus(b, 'fire');
    ctx.state.stats.fires++;
    const name = BUILDINGS[b.type]?.name ?? b.type;
    this.rt.incident('fire', `Fire at ${name} (${cause})`, f.x, f.z);
    ctx.bus.emit('hazard:fireStarted', { id: f.id, x: f.x, y: f.y, z: f.z });
    ctx.notify('danger', `FIRE: ${name}`, `A fire broke out (${cause}). Fire stations within ${FIRE_STATION_RANGE} blocks respond automatically — or use your extinguisher.`, { x: f.x, y: f.y, z: f.z });
    return f;
  }

  private setStatus(b: BuildingState, s: BuildingState['status']) {
    if (b.status === s) return;
    const prev = b.status;
    b.status = s;
    this.rt.ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: s });
  }

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = ctx.state;
    const fires = st.hazards.fires;
    if (fires.length === 0) return;
    const hours = step.minutes / 60;
    const w = st.weather;
    const rain = w.current === 'rain' || w.current === 'storm' || w.current === 'hurricane' || w.current === 'snow' || w.current === 'blizzard' ? w.precipitation : 0;
    const spreadMod = ctx.modifier('fire_spread');
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      const b = f.buildingId ? st.buildings[f.buildingId] : undefined;
      if (f.buildingId && !b) {
        this.remove(i);
        continue;
      }
      const well = f.wellId ? st.wells[f.wellId] : undefined;
      const wellBurning = !!well?.blowout?.onFire;
      // --- fuel & growth
      let maxI = 0.5;
      let fueled = true;
      if (b) {
        const d = BUILDINGS[b.type];
        maxI = 0.35 + 0.65 * (d?.flammability ?? 0.3) + (TANK_TYPES.has(b.type) ? 0.25 * fillFraction(ctx, b) : 0);
        fueled = b.status !== 'destroyed';
      }
      if (wellBurning) {
        maxI = 1;
        fueled = true;
      } else if (f.wellId && !b) fueled = false;
      if (!b && !f.wellId) fueled = false; // grass / lightning fire burns itself out
      maxI = Math.min(1, maxI);
      if (fueled) f.intensity += (maxI - f.intensity) * (1 - Math.exp(-hours / 1.5));
      else f.intensity -= (b ? 0.3 : 0.25) * hours;
      f.intensity -= rain * 0.25 * hours;
      // --- fire stations
      let suppress = 0;
      for (const s of rt.list) {
        if (s.type !== 'fire_station' || !rt.canRun(s)) continue;
        const c = centerOf(s);
        const d = Math.hypot(c.x - f.x, c.z - f.z);
        if (d > FIRE_STATION_RANGE) continue;
        suppress += 0.55 * Math.min(1.25, rt.crew(s)) * (1 - (0.5 * d) / FIRE_STATION_RANGE);
      }
      f.intensity -= suppress * hours;
      if (wellBurning) f.intensity = Math.max(0.3, f.intensity);
      f.intensity = Math.min(1, f.intensity);
      // --- damage
      if (b && b.status !== 'destroyed') {
        b.condition = Math.max(0, b.condition - Math.max(0, f.intensity) * 30 * hours);
        if (b.condition <= 0) {
          // Pressurised/loaded explosive units blow up when the fire finally breaches them (BLEVE).
          if (EXPLOSIVE_TYPES[b.type] && !b.data.exploded && (fillFraction(ctx, b) > 0.2 || PROCESSING_TYPES.has(b.type))) this.explode(b);
          else this.destroy(b, 'burned down');
        }
      }
      if (f.intensity <= 0.02) {
        this.remove(i);
        continue;
      }
      if (b) {
        b.fire = f.intensity;
        if (b.status !== 'destroyed') this.setStatus(b, 'fire');
      }
      // --- explosions (roll every 20 min while burning hard)
      if (b && b.status !== 'destroyed' && EXPLOSIVE_TYPES[b.type] && !b.data.exploded && f.intensity > 0.7) {
        const t = (this.explodeTimer.get(f.id) ?? 0) + step.minutes;
        if (t >= EXPLOSION_ROLL_MINUTES) {
          this.explodeTimer.set(f.id, t - EXPLOSION_ROLL_MINUTES);
          const fill = fillFraction(ctx, b);
          const p = 0.12 * (BUILDINGS[b.type]?.flammability ?? 0.5) * (0.5 + fill) * f.intensity;
          if (ctx.rng() < p) this.explode(b);
        } else this.explodeTimer.set(f.id, t);
      }
      // --- spread
      f.spreadTimer += step.minutes;
      if (f.spreadTimer >= SPREAD_INTERVAL) {
        f.spreadTimer -= SPREAD_INTERVAL;
        if (rt.hazardsOn) this.spread(f, spreadMod);
      }
    }
  }

  private spread(f: Fire, spreadMod: number): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const R = (3 + 10 * f.intensity) * spreadMod;
    for (const o of rt.list) {
      if (o.id === f.buildingId || o.fire > 0 || o.status === 'destroyed') continue;
      const d = distToFootprint(o, f.x, f.z);
      if (d > R) continue;
      const fl = BUILDINGS[o.type]?.flammability ?? 0.2;
      const p = f.intensity * fl * 0.35 * spreadMod * rt.hazardRate * (1 - d / (R + 1));
      if (ctx.rng() < p) this.igniteBuilding(o, 0.15, 'spread from nearby fire');
    }
  }

  private remove(i: number): void {
    const ctx = this.rt.ctx;
    const f = ctx.state.hazards.fires[i];
    ctx.state.hazards.fires.splice(i, 1);
    this.explodeTimer.delete(f.id);
    const b = f.buildingId ? ctx.state.buildings[f.buildingId] : undefined;
    if (b) {
      b.fire = 0;
      if (b.status === 'fire') {
        // Fire damage leaves the unit needing repair.
        b.status = 'broken';
        b.data.manualRepairs = 0;
        ctx.bus.emit('building:statusChanged', { id: b.id, prev: 'fire', status: 'broken' });
      }
      const c = centerOf(b);
      ctx.notify('success', 'Fire out', `The fire at ${BUILDINGS[b.type]?.name ?? b.type} is out.${b.status === 'destroyed' ? ' Only a ruin remains.' : ' It needs repairs.'}`, { x: c.x, y: b.y, z: c.z });
    }
    ctx.bus.emit('hazard:fireOut', { id: f.id });
  }

  /** Burned out: status destroyed, contents lost (combusted). */
  destroy(b: BuildingState, why: string): void {
    const ctx = this.rt.ctx;
    if (b.status === 'destroyed') return;
    let burned = 0;
    for (const cat of ['oil', 'product'] as const) for (const it of ITEMS_BY_CAT[cat]) burned += (b.storage[it] ?? 0) * 0.43;
    for (const it of ITEMS_BY_CAT.gas) burned += (b.storage[it] ?? 0) * 0.055;
    const env = ctx.state.environment;
    env.emissionsToday += burned;
    env.emissionsTotal += burned;
    b.storage = {};
    b.condition = 0;
    b.utilization = 0;
    b.io = {};
    this.setStatus(b, 'destroyed');
    const c = centerOf(b);
    const name = BUILDINGS[b.type]?.name ?? b.type;
    this.rt.incident('fire', `${name} ${why}`, c.x, c.z);
    ctx.notify('danger', `${name} destroyed`, `The ${name.toLowerCase()} ${why}. Demolish the ruin to clear the site.`, { x: c.x, y: b.y, z: c.z });
  }

  /** Explosion: blast damage & ignition around, scorched ground and a small crater. */
  explode(b: BuildingState): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const base = EXPLOSIVE_TYPES[b.type] ?? 4;
    const fill = fillFraction(ctx, b);
    const power = Math.round(base * (0.6 + 0.8 * fill) * 10) / 10;
    b.data.exploded = true;
    const c = centerOf(b);
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    ctx.bus.emit('hazard:explosion', { x: c.x, y: b.y + 1, z: c.z, power });
    const name = BUILDINGS[b.type]?.name ?? b.type;
    rt.incident('explosion', `${name} exploded`, c.x, c.z);
    ctx.notify('danger', `EXPLOSION at ${name}!`, 'A massive blast tore through the site. Nearby equipment is damaged and burning.', { x: c.x, y: b.y, z: c.z });
    this.destroy(b, 'was destroyed in an explosion');
    // Blast damage
    const R = power * 2.5;
    for (const o of rt.list) {
      if (o === b || o.status === 'destroyed') continue;
      const d = distToFootprint(o, c.x, c.z);
      if (d > R) continue;
      const k = 1 - d / R;
      o.condition = Math.max(0, o.condition - 70 * k);
      if (o.condition <= 0) this.destroy(o, 'was flattened by the blast');
      else if (ctx.rng() < 0.6 * k * Math.max(0.3, BUILDINGS[o.type]?.flammability ?? 0.3)) this.igniteBuilding(o, 0.3 + 0.4 * k, 'explosion');
    }
    this.scorch(b, cx, cz, power);
  }

  /** Carve a shallow crater next to the ruin and scorch the ground within the blast radius. */
  private scorch(src: BuildingState, cx: number, cz: number, power: number): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const w = ctx.world;
    const own = (x: number, z: number) => {
      for (const id of rt.idsAtColumn(x, z)) if (id !== src.id) return true;
      return false;
    };
    // Crater: sphere centred at pad level, skipping other buildings' columns and structural blocks.
    const rc = Math.min(4, Math.max(2, power * 0.4));
    const cy = src.y - 1;
    const r2 = rc * rc;
    const irc = Math.ceil(rc);
    for (let dz = -irc; dz <= irc; dz++)
      for (let dx = -irc; dx <= irc; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (!w.inBounds(x, 1, z) || own(x, z)) continue;
        for (let dy = -irc; dy <= irc; dy++) {
          if (dx * dx + dy * dy * 1.6 + dz * dz > r2) continue;
          const y = cy + dy;
          if (y <= 1 || y >= w.height) continue;
          const id = w.getBlock(x, y, z);
          if (id === B.AIR || CRATER_KEEP.has(id) || PIPE_CAT[id] >= 0) continue;
          w.setBlock(x, y, z, y <= SEA_LEVEL && this.nearWater(x, y, z) ? B.WATER : B.AIR, 'system');
        }
      }
    // Scorched ground & ash
    const rs = power * 1.4;
    const irs = Math.ceil(rs);
    for (let dz = -irs; dz <= irs; dz++)
      for (let dx = -irs; dx <= irs; dx++) {
        if (dx * dx + dz * dz > rs * rs) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!w.inBounds(x, 1, z) || own(x, z)) continue;
        let y = w.getSurfaceY(x, z);
        // strip burnable vegetation first (trees within the blast burn away)
        for (let k = 0; k < 8; k++) {
          const top = w.getBlock(x, y - 1, z);
          if (!BURNABLE.has(top)) break;
          w.setBlock(x, y - 1, z, B.AIR, 'system');
          y--;
        }
        const plant = w.getBlock(x, y, z);
        if (BURNABLE.has(plant)) w.setBlock(x, y, z, B.AIR, 'system');
        const ground = w.getBlock(x, y - 1, z);
        if (SOIL.has(ground)) w.setBlock(x, y - 1, z, B.SCORCHED_EARTH, 'system');
        if ((SOIL.has(ground) || ground === B.SCORCHED_EARTH) && w.getBlock(x, y, z) === B.AIR && ctx.rng() < 0.35 && IS_SOLID[w.getBlock(x, y - 1, z)])
          w.setBlock(x, y, z, B.ASH, 'system');
      }
  }

  private nearWater(x: number, y: number, z: number): boolean {
    const w = this.rt.ctx.world;
    return w.getBlock(x + 1, y, z) === B.WATER || w.getBlock(x - 1, y, z) === B.WATER || w.getBlock(x, y, z + 1) === B.WATER || w.getBlock(x, y, z - 1) === B.WATER || w.getBlock(x, y + 1, z) === B.WATER;
  }

  /** 'building/extinguish' — reduce intensity of a fire by id, on a building, or on the well at a wellhead. */
  extinguish(opts: { fireId?: string; buildingId?: string; amount: number }): CommandResult {
    const ctx = this.rt.ctx;
    const fires = ctx.state.hazards.fires;
    let f: Fire | undefined;
    if (opts.fireId) f = fires.find((x) => x.id === opts.fireId);
    else if (opts.buildingId) {
      f = fires.find((x) => x.buildingId === opts.buildingId);
      if (!f) {
        const b = ctx.state.buildings[opts.buildingId];
        if (b?.wellId) f = fires.find((x) => x.wellId === b.wellId);
      }
    }
    if (!f) return { ok: false, error: 'Nothing is burning there' };
    const amount = Math.max(0, Math.min(1, Number(opts.amount) || 0));
    const well = f.wellId ? ctx.state.wells[f.wellId] : undefined;
    const floor = well?.blowout?.onFire ? 0.3 : 0;
    f.intensity = Math.max(floor, f.intensity - amount);
    if (f.intensity <= 0.02) {
      const i = fires.indexOf(f);
      if (i >= 0) this.remove(i);
      return { ok: true, data: { intensity: 0, out: true } };
    }
    const b = f.buildingId ? ctx.state.buildings[f.buildingId] : undefined;
    if (b) b.fire = f.intensity;
    return { ok: true, data: { intensity: f.intensity, out: false, blowout: floor > 0 } };
  }
}
