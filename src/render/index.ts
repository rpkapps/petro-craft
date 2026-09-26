// Render engine entry point.
//   createRenderer(canvas, ctx) → Renderer (implements RenderHost + frame/resize/dispose)
// See Renderer.ts for the subsystem wiring and docs in the individual modules.
import type { RenderHost } from '../core/client';
import type { GameContext } from '../core/types';
import { RenderEngine } from './Renderer';

export interface Renderer extends RenderHost {
  /** Called every animation frame before render (dt seconds). Runs onFrame callbacks, streams chunks, updates sky. */
  update(dt: number): void;
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, ctx: GameContext): Renderer {
  return new RenderEngine(canvas, ctx);
}

export { RenderEngine };
export { createBlockAtlas, paintLayer } from './textures/atlas';
export { LAYERS, layerOf } from './textures/layers';
export { blockIconCanvas, blockIconDataURL, type IconQuality } from './textures/icons';
