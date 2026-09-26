// STUB — owned by the Render Engine agent.
import type { RenderHost } from '../core/client';
import type { GameContext } from '../core/types';

export interface Renderer extends RenderHost {
  /** Called every animation frame before render (dt seconds). Runs onFrame callbacks, streams chunks, updates sky. */
  update(dt: number): void;
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, ctx: GameContext): Renderer {
  throw new Error('createRenderer not implemented');
}
