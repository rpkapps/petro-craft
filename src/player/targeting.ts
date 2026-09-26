// Picking: voxel raycast along the frame's pick ray, mapping STRUCTURE hits to buildings (wellheads → wells),
// emitting 'player:target' on change and driving the renderer's block highlight / selection box.
import { B } from '../core/blocks';
import { findBuildingAt } from '../core/buildingUtil';
import type { BuildingState, Vec3 } from '../core/types';
import { isTargetable } from './blockUtil';
import { raycastVoxels, type VoxelHit } from './raycast';
import type { PlayerRuntime, Target } from './runtime';

export function buildingForCell(rt: PlayerRuntime, x: number, y: number, z: number): BuildingState | undefined {
  const s = rt.ctx.state;
  const viaService = rt.ctx.services.construction.buildingAt(x, y, z);
  const b = viaService ? s.buildings[viaService] : undefined;
  // Prefer the smallest containing building (wellheads inside rig footprints).
  const smallest = findBuildingAt(s, x, y, z);
  if (b && smallest && smallest.id !== b.id) {
    const vb = b.size[0] * b.size[1] * b.size[2], vs = smallest.size[0] * smallest.size[1] * smallest.size[2];
    return vs < vb ? smallest : b;
  }
  return b ?? smallest;
}

/** 'ui:select' payload for a building (wellheads select their well). */
export function selectionFor(b: BuildingState): { kind: 'building' | 'well'; id: string } {
  if (b.type === 'wellhead' && b.wellId) return { kind: 'well', id: b.wellId };
  return { kind: 'building', id: b.id };
}

export class Targeting {
  private lastKey = '';
  private hlKey = '';
  private selKey = '';

  constructor(private readonly rt: PlayerRuntime) {}

  /** Raycast and resolve the target for this frame. */
  pick(range: number): Target {
    const rt = this.rt;
    const w = rt.ctx.world;
    const hit: VoxelHit | null = raycastVoxels(rt.rayOrigin, rt.rayDir, range, (x, y, z) => (w.inBounds(x, y, z) ? w.getBlock(x, y, z) : 0), isTargetable, w.height);
    if (!hit) return { kind: 'none', hit: null };
    if (hit.block === B.STRUCTURE) {
      const b = buildingForCell(rt, hit.x, hit.y, hit.z);
      if (b) {
        const sel = selectionFor(b);
        return { kind: sel.kind, hit, building: b, id: sel.id };
      }
    }
    return { kind: 'block', hit };
  }

  /** Emit 'player:target' when the target changes. */
  publish(t: Target): void {
    const pos: Vec3 | undefined = t.hit ? { x: t.hit.x, y: t.hit.y, z: t.hit.z } : undefined;
    const key = t.kind === 'block' ? `b:${pos!.x},${pos!.y},${pos!.z}:${t.hit!.block}` : t.kind === 'none' ? 'none' : `${t.kind}:${t.id}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.rt.ctx.bus.emit('player:target', {
      kind: t.kind,
      id: t.id,
      pos: t.kind === 'none' ? undefined : pos,
      block: t.kind === 'block' ? t.hit!.block : undefined,
    });
  }

  /** Update the renderer's block cursor and building selection box (only calls the host on change). */
  highlight(block: Vec3 | null, progress: number, building: BuildingState | null): void {
    const host = this.rt.host;
    const p = Math.round(progress * 40) / 40;
    const hk = block ? `${block.x},${block.y},${block.z}:${p}` : '';
    if (hk !== this.hlKey) {
      this.hlKey = hk;
      host.setBlockHighlight(block, block ? p : undefined);
    }
    const sk = building ? `${building.id}:${building.x},${building.y},${building.z}:${building.size.join(',')}` : '';
    if (sk !== this.selKey) {
      this.selKey = sk;
      if (building) {
        host.setSelectionBox(
          { x: building.x, y: building.y, z: building.z },
          { x: building.x + building.size[0], y: building.y + building.size[2], z: building.z + building.size[1] },
        );
      } else host.setSelectionBox(null);
    }
  }

  clear(): void {
    this.highlight(null, 0, null);
  }

  reset(): void {
    this.lastKey = '';
    this.hlKey = '';
    this.selKey = '';
  }
}
