// STUB — owned by the Entities & FX agent.
import type { RenderHost } from '../../core/client';
import type { GameContext } from '../../core/types';

export interface EntityLayer {
  update(dt: number): void;
  dispose(): void;
}

export function createEntityLayer(host: RenderHost, ctx: GameContext): EntityLayer {
  return { update() {}, dispose() {} };
}
