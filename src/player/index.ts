// STUB — owned by the Player agent.
import type { AppShell, RenderHost } from '../core/client';
import type { GameContext } from '../core/types';

export interface PlayerController {
  update(dt: number): void;
  dispose(): void;
}

export function createPlayerController(host: RenderHost, ctx: GameContext, app: AppShell): PlayerController {
  return { update() {}, dispose() {} };
}
