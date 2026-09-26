// Client side of dropped items: Q drops one item from the selected slot (hold to keep dropping), Ctrl+Q the whole
// stack, and walking within reach of a stack picks it up ('player/pickup'). A player's own fresh drops are ignored
// for DROP.selfPickupDelay seconds so a tossed stack does not jump straight back into the inventory.
import type { PlayerState } from '../core/types';
import { DROP } from './config';
import { distanceToBody, type MovingDrop } from './drops';
import { canAccept } from './inventory';
import type { PlayerRuntime } from './runtime';

export class DropController {
  /** Local clock (seconds) — advances with update() so automation can step it deterministically. */
  private time = 0;
  private cooldown = 0;
  private holdT = 0;
  private lastOwnDrop = -Infinity;
  /** dropId → local time it was last dropped by this player. */
  private readonly ownDrops = new Map<string, number>();
  /** dropId → local time before which it is not retried. */
  private readonly retryAt = new Map<string, number>();

  private readonly rt: PlayerRuntime;

  constructor(rt: PlayerRuntime) {
    this.rt = rt;
  }

  /**
   * @param keysOn gameplay keys are live (no UI capture, alive)
   * @param onFoot walking or flying (not the drone camera)
   */
  update(dt: number, keysOn: boolean, onFoot: boolean): void {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (keysOn && onFoot) this.handleKeys(dt);
    else this.holdT = 0;
    if (onFoot && !this.rt.dead) this.autoPickup();
    this.prune();
  }

  private handleKeys(dt: number): void {
    const inp = this.rt.input;
    const all = inp.codeDown('ControlLeft') || inp.codeDown('ControlRight');
    if (inp.pressed('drop')) {
      this.holdT = 0;
      this.drop(all);
      return;
    }
    if (!inp.down('drop') || all) {
      this.holdT = 0;
      return;
    }
    // Hold Q: keep dropping single items after a short delay.
    this.holdT += dt;
    if (this.holdT >= DROP.repeatDelay) this.drop(false, DROP.repeatInterval);
  }

  /** Drop one item (or the whole stack) from the selected slot. Returns true when something was dropped. */
  drop(wholeStack: boolean, cooldown: number = DROP.dropCooldown): boolean {
    if (this.cooldown > 0) return false;
    const rt = this.rt;
    const p = rt.player();
    const slot = rt.selectedSlot();
    if (!p || !p.inventory[slot]) return false;
    rt.syncNow();
    const res = rt.dispatch(wholeStack ? { type: 'player/dropItem', slot } : { type: 'player/dropItem', slot, count: 1 });
    if (!res.ok) return false;
    this.cooldown = cooldown;
    this.lastOwnDrop = this.time;
    const id = (res.data as { dropId?: string } | undefined)?.dropId;
    if (id) this.ownDrops.set(id, this.time);
    rt.swing();
    return true;
  }

  private isFreshOwnDrop(d: MovingDrop, me: string): boolean {
    if (d.droppedBy !== me) return false;
    const t = this.ownDrops.get(d.id);
    // Unknown id (e.g. a non-authority client got no result data): fall back to the last local drop time.
    const at = t ?? this.lastOwnDrop;
    return this.time - at < DROP.selfPickupDelay;
  }

  private autoPickup(): void {
    const rt = this.rt;
    const drops = rt.ctx.state.drops as MovingDrop[] | undefined;
    if (!drops || drops.length === 0) return;
    const p: PlayerState | undefined = rt.player();
    if (!p) return;
    const me = rt.ctx.localPlayerId;
    const body = rt.body;
    const feet = { x: body.x, y: body.y, z: body.z };
    // Collect first: successful pickups remove entries from the live list.
    const near: MovingDrop[] = [];
    for (const d of drops) {
      if (d.count > 0 && distanceToBody(feet, d) <= DROP.autoPickupRadius && !this.isFreshOwnDrop(d, me)) near.push(d);
    }
    let sent = 0;
    for (const d of near) {
      if (sent >= DROP.pickupsPerFrame) break;
      if ((this.retryAt.get(d.id) ?? 0) > this.time) continue;
      if (canAccept(p.inventory, d.item, 1) <= 0) continue;
      this.retryAt.set(d.id, this.time + DROP.pickupRetry);
      sent++;
      const at = { x: d.x, y: d.y, z: d.z };
      rt.syncNow();
      const res = rt.dispatch({ type: 'player/pickup', dropId: d.id });
      if (res.ok) rt.ctx.bus.emit('audio:play', { sound: 'pickup', at, volume: 0.7 });
    }
  }

  private prune(): void {
    if (this.ownDrops.size > 64) for (const [id, t] of this.ownDrops) if (this.time - t > DROP.selfPickupDelay) this.ownDrops.delete(id);
    if (this.retryAt.size > 64) for (const [id, t] of this.retryAt) if (t <= this.time) this.retryAt.delete(id);
  }
}
