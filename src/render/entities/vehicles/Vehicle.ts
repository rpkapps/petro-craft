// Shared vehicle plumbing: an instantiated template in a placement group, plus its FX anchors.
import * as THREE from 'three';
import type { GameContext } from '../../../core/types';
import type { FxManager } from '../fx/FxManager';
import { exhaust, smoke } from '../fx/emitters';
import type { ModelTemplate } from '../geom/Builder';
import type { MaterialLib } from '../materials';
import { instantiate, type ModelObject } from '../models/instantiate';
import type { LandNav, WaterNav } from './nav';
import type { Terrain } from './terrain';

export interface VehicleEnv {
  ctx: GameContext;
  lib: MaterialLib;
  fx: FxManager;
  terrain: Terrain;
  group: THREE.Group;
  camera: THREE.Camera;
  /** Lazily created navigation grids (shared by all traffic). */
  nav: { land(): LandNav; water(): WaterNav };
  /** Bumped whenever buildings are placed or removed. */
  structVersion(): number;
}

const _v = new THREE.Vector3();

export class Vehicle {
  readonly obj = new THREE.Group();
  readonly model: ModelObject;

  constructor(private readonly env: VehicleEnv, template: ModelTemplate, shadows = true) {
    this.model = instantiate(template, env.lib, shadows);
    this.obj.add(this.model.root);
    env.group.add(this.obj);
  }

  node(name: string): THREE.Object3D | undefined {
    return this.model.nodes.get(name);
  }

  /** Place with yaw (radians, +x forward) and optional pitch/roll. */
  place(x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): void {
    this.obj.position.set(x, y, z);
    this.obj.rotation.set(roll, yaw, pitch, 'YXZ');
  }

  distanceTo(p: THREE.Vector3): number {
    return this.obj.position.distanceTo(p);
  }

  /** Emit exhaust/smoke from the template anchors (rate scaled by `load`). */
  emit(dt: number, load: number): void {
    const cam = this.env.camera.position;
    if (this.obj.position.distanceToSquared(cam) > 140 * 140 || !this.obj.visible) return;
    for (const a of this.model.template.anchors) {
      if (a.kind !== 'exhaust' && a.kind !== 'smoke') continue;
      const node = a.node ? this.model.nodes.get(a.node) : null;
      _v.copy(a.pos);
      (node ?? this.obj).localToWorld(_v);
      if (a.kind === 'exhaust') exhaust(this.env.fx.ps, _v.x, _v.y, _v.z, (a.data.rate ?? 4) * load, dt, this.env.fx.q);
      else smoke(this.env.fx.ps, _v.x, _v.y, _v.z, a.data.r ?? 0.3, (a.data.rate ?? 0.5) * load, a.data.dark ?? 0.3, dt, this.env.fx.q);
    }
  }

  dispose(): void {
    this.obj.removeFromParent();
  }
}

/** Yaw that points a +x-forward model along the horizontal direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);
