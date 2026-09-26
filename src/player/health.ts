// Client-side health model: fall damage, drowning, fire proximity, H2S exposure, regeneration, death & respawn.
// Health is persisted through the optional `health` field of 'player/sync' (see sim.ts).
import { findSpawn } from '../world';
import type { Vec3 } from '../core/types';
import { BODY, HEALTH, SWIM, WALK } from './config';
import { senseHazards } from './hazards';
import type { PlayerRuntime } from './runtime';

export class HealthModel {
  health: number = HEALTH.max;
  air: number = SWIM.airSeconds;
  private sinceDamage = 99;
  private tick = 0;
  private drownTick = 0;
  private deathTimer = 0;
  private deathCause = '';
  /** Callbacks wired by the controller. */
  onDeath: (cause: string) => void = () => {};
  onRespawn: (at: Vec3) => void = () => {};
  onDamage: (amount: number) => void = () => {};

  constructor(private readonly rt: PlayerRuntime) {
    const p = rt.player();
    if (p && Number.isFinite(p.health) && p.health > 0) this.health = Math.min(HEALTH.max, p.health);
  }

  get dead(): boolean {
    return this.health <= 0;
  }

  /** Apply damage (ignored in creative / while dead). */
  damage(amount: number, cause: string): void {
    if (amount <= 0 || this.dead || this.rt.creative()) return;
    const a = Math.min(this.health, amount);
    this.health -= a;
    this.sinceDamage = 0;
    this.rt.ctx.bus.emit('player:damage', { amount: a });
    this.onDamage(a);
    if (this.health <= 0.001) {
      this.health = 0;
      this.deathCause = cause;
      this.deathTimer = HEALTH.respawnDelay;
      this.rt.ctx.bus.emit('player:death', { cause });
      this.onDeath(cause);
    }
  }

  /** Fall damage from a landing (no damage when landing in liquid). */
  landed(fallDistance: number, inLiquid: boolean): void {
    if (inLiquid || fallDistance <= WALK.safeFall) return;
    this.damage(Math.round((fallDistance - WALK.safeFall) * WALK.fallDamagePerBlock), 'fall');
  }

  update(dt: number): void {
    const rt = this.rt;
    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.respawn();
      return;
    }
    // Air supply.
    if (rt.body.headInLiquid && rt.mode !== 'fly') {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTick -= dt;
        if (this.drownTick <= 0) {
          this.drownTick = 1;
          this.damage(SWIM.drownDamage, 'drowned');
        }
      }
    } else {
      this.air = Math.min(SWIM.airSeconds, this.air + dt * 4);
      this.drownTick = 0;
    }
    // Environmental hazards (evaluated on a coarse tick).
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = HEALTH.damageTick;
      this.environment(HEALTH.damageTick);
    }
    this.sinceDamage += dt;
    if (this.sinceDamage > HEALTH.regenDelay && this.health < HEALTH.max) this.health = Math.min(HEALTH.max, this.health + HEALTH.regenPerSecond * dt);
  }

  private environment(dt: number): void {
    const rt = this.rt;
    const b = rt.body;
    const center = { x: b.x, y: b.y + BODY.height / 2, z: b.z };
    // Fire: radiant heat within a radius growing with intensity; building fires measured from the building box.
    let fireDmg = 0;
    for (const f of rt.ctx.state.hazards.fires) {
      let p = { x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 };
      const bl = f.buildingId ? rt.ctx.state.buildings[f.buildingId] : undefined;
      if (bl) {
        p = {
          x: Math.max(bl.x, Math.min(center.x, bl.x + bl.size[0])),
          y: Math.max(bl.y, Math.min(center.y, bl.y + bl.size[2])),
          z: Math.max(bl.z, Math.min(center.z, bl.z + bl.size[1])),
        };
      }
      const r = HEALTH.fireRadius + HEALTH.fireRadiusPerIntensity * Math.max(0, Math.min(1, f.intensity));
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      if (d < r) fireDmg += HEALTH.fireDamage * Math.max(0.2, f.intensity) * (1 - d / r);
    }
    if (fireDmg > 0) this.damage(fireDmg * dt, 'fire');
    // Toxic gas (H2S) from sour blowouts / kicks.
    const h = senseHazards(rt.ctx.state, rt.ctx.geology, rt.eye());
    if (h.h2s > 50) this.damage(Math.min(3, (h.h2s - 50) / 100 + 0.5) * HEALTH.h2sDamage * dt, 'h2s');
  }

  private respawn(): void {
    const rt = this.rt;
    const at = respawnPoint(rt);
    this.health = HEALTH.max;
    this.air = SWIM.airSeconds;
    this.sinceDamage = 99;
    this.deathCause = '';
    this.onRespawn(at);
    rt.ctx.bus.emit('player:respawn', {});
  }

  get cause(): string {
    return this.deathCause;
  }
}

/** Field office (preferring the local player's) or the world spawn; returns a feet position on the surface. */
export function respawnPoint(rt: PlayerRuntime): Vec3 {
  const w = rt.ctx.world;
  const offices = Object.values(rt.ctx.state.buildings).filter((b) => b.type === 'field_office' && b.status !== 'destroyed');
  offices.sort((a, b) => (a.owner === rt.ctx.localPlayerId ? -1 : 0) - (b.owner === rt.ctx.localPlayerId ? -1 : 0));
  for (const b of offices) {
    // Try the cells in front of each side of the office.
    const cx = Math.floor(b.x + b.size[0] / 2), cz = Math.floor(b.z + b.size[1] / 2);
    const candidates = [
      [cx, b.z + b.size[1] + 1], [cx, b.z - 2], [b.x + b.size[0] + 1, cz], [b.x - 2, cz],
    ];
    for (const [x, z] of candidates) {
      if (!w.inBounds(x, 1, z)) continue;
      const y = w.getSurfaceY(x, z);
      if (!w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z)) return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  let s: Vec3;
  try {
    s = findSpawn(rt.ctx.geology);
  } catch {
    s = { x: w.sizeX / 2, y: 80, z: w.sizeZ / 2 };
  }
  const x = Math.max(0, Math.min(w.sizeX - 1, Math.floor(s.x))), z = Math.max(0, Math.min(w.sizeZ - 1, Math.floor(s.z)));
  return { x: x + 0.5, y: w.getSurfaceY(x, z), z: z + 0.5 };
}
