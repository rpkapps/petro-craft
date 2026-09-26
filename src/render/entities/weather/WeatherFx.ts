import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';
export class WeatherFx {
  readonly group = new THREE.Group();
  constructor(host: RenderHost, ctx: GameContext, fx: unknown) {}
  update(dt: number, t: number): void {}
  dispose(): void {}
}
