// Default (non build/pipe mode) interaction: hold LMB to break blocks, LMB on buildings to select, RMB to place
// blocks against faces (MC-style repeat while held), tools on RMB, and the building fallback selection.
import { BLOCKS } from '../core/blocks';
import { BODY, INTERACT } from './config';
import { breakTime, isReplaceable, isPlant, placeableBlockFromItem } from './blockUtil';
import { Tools } from './tools';
import type { Actions, PlayerRuntime, Target } from './runtime';
import type { Vec3 } from '../core/types';

export class Interaction {
  private breaking: { x: number; y: number; z: number; block: number; t: number; total: number } | null = null;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private hitSoundT = 0;
  private primaryHold = 0;
  /** Highlight progress for the renderer (0..1). */
  progress = 0;

  constructor(private readonly rt: PlayerRuntime, private readonly tools: Tools) {}

  cancel(): void {
    this.breaking = null;
    this.progress = 0;
    this.tools.reset();
  }

  update(dt: number, act: Actions, target: Target): void {
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.progress = 0;

    // ---- primary: select buildings / break blocks
    if (act.primaryPressed && target.building) {
      this.rt.ctx.bus.emit('ui:select', { kind: target.kind === 'well' ? 'well' : 'building', id: target.id });
      this.rt.swing();
    }
    // Drone view: a click on terrain deselects (RTS-style); digging needs a deliberate hold.
    const drone = this.rt.mode === 'drone';
    this.primaryHold = act.primaryHeld ? this.primaryHold + dt : 0;
    if (drone && act.primaryPressed && !target.building) this.rt.ctx.bus.emit('ui:select', { kind: 'none' });
    const digging = act.primaryHeld && (!drone || this.primaryHold >= INTERACT.droneDigDelay);
    if (digging && target.kind === 'block' && target.hit) this.updateBreaking(dt, target);
    else this.breaking = null;
    if (!act.primaryHeld) this.breakCooldown = Math.min(this.breakCooldown, 0.05);

    // ---- secondary: tools, placement, selection
    const tool = this.tools.secondary(dt, act, target);
    if (tool.progress > 0) this.progress = tool.progress;
    if (tool.handled) return;
    const item = this.rt.selectedItem();
    const blockId = placeableBlockFromItem(item);
    if (blockId !== null) {
      if (act.secondaryHeld && this.placeCooldown <= 0 && target.hit && (act.secondaryPressed || this.rt.mode !== 'drone')) {
        if (this.tryPlace(blockId, target)) this.placeCooldown = act.secondaryPressed ? INTERACT.placeCooldown + 0.05 : INTERACT.placeCooldown;
      }
      if (!act.secondaryHeld) this.placeCooldown = 0;
      return;
    }
    if (act.secondaryPressed && target.building) {
      this.rt.ctx.bus.emit('ui:select', { kind: target.kind === 'well' ? 'well' : 'building', id: target.id });
      this.rt.swing();
    }
  }

  private updateBreaking(dt: number, target: Target): void {
    const rt = this.rt;
    const h = target.hit!;
    if (this.breakCooldown > 0) return;
    const b = this.breaking;
    if (!b || b.x !== h.x || b.y !== h.y || b.z !== h.z || b.block !== h.block) {
      const total = breakTime(h.block, rt.selectedItem(), rt.creative());
      this.breaking = { x: h.x, y: h.y, z: h.z, block: h.block, t: 0, total };
      this.hitSoundT = 0;
    }
    const cur = this.breaking!;
    if (cur.total === Infinity) {
      // Unbreakable: swing uselessly.
      this.hitSoundT -= dt;
      if (this.hitSoundT <= 0) {
        this.hitSoundT = 0.35;
        rt.swing();
      }
      return;
    }
    cur.t += dt;
    this.hitSoundT -= dt;
    if (this.hitSoundT <= 0) {
      this.hitSoundT = INTERACT.hitSoundInterval;
      rt.swing();
      rt.ctx.bus.emit('audio:play', { sound: 'block_hit', at: { x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 }, volume: 0.6 });
    }
    this.progress = cur.total > 0 ? Math.min(1, cur.t / cur.total) : 1;
    if (cur.t >= cur.total) {
      rt.syncNow();
      const res = rt.dispatch({ type: 'world/breakBlock', x: cur.x, y: cur.y, z: cur.z });
      if (res.ok) rt.ctx.bus.emit('player:blockBroken', { x: cur.x, y: cur.y, z: cur.z, id: cur.block });
      this.breaking = null;
      this.progress = 0;
      this.breakCooldown = rt.creative() ? INTERACT.creativeBreakCooldown : INTERACT.breakCooldown;
    }
  }

  /** Placement cell for a hit: the hit cell itself for replaceable plants, else the neighbour across the face. */
  static placementCell(target: Target): Vec3 | null {
    const h = target.hit;
    if (!h) return null;
    if (isPlant(h.block)) return { x: h.x, y: h.y, z: h.z };
    if (h.nx === 0 && h.ny === 0 && h.nz === 0) return null;
    return { x: h.x + h.nx, y: h.y + h.ny, z: h.z + h.nz };
  }

  private tryPlace(blockId: number, target: Target): boolean {
    const rt = this.rt;
    const c = Interaction.placementCell(target);
    if (!c) return false;
    const w = rt.ctx.world;
    if (!w.inBounds(c.x, c.y, c.z) || !isReplaceable(w.getBlock(c.x, c.y, c.z))) return false;
    if (BLOCKS[blockId].solid && this.intersectsBody(c)) return false;
    rt.syncNow();
    const res = rt.dispatch({ type: 'world/placeBlock', x: c.x, y: c.y, z: c.z, slot: rt.selectedSlot() });
    if (res.ok) {
      rt.swing();
      rt.ctx.bus.emit('player:blockPlaced', { x: c.x, y: c.y, z: c.z, id: blockId });
      return true;
    }
    return false;
  }

  private intersectsBody(c: Vec3): boolean {
    const b = this.rt.body;
    const hw = BODY.halfWidth;
    return c.x < b.x + hw && c.x + 1 > b.x - hw && c.z < b.z + hw && c.z + 1 > b.z - hw && c.y < b.y + BODY.height && c.y + 1 > b.y;
  }
}
