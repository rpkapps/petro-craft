import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';
export class TrafficManager {
  readonly group = new THREE.Group();
  constructor(host: RenderHost, ctx: GameContext, lib: unknown, fx: unknown, views: unknown) {}
  update(dt: number, t: number): void {}
  dispose(): void {}
}
