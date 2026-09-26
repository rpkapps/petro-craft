// Build-mode ghost previews (host.buildingPreview.create(type)).
//
// Convention: the returned object is the rotation-0 model CENTRED on its footprint at ground level
// (origin = footprint centre, y = pad level), exactly like placed buildings before their yaw is applied.
// Place it at (b.x + w/2, b.y, b.z + d/2) with rotation.y = rotationYaw(r) = -r·π/2
// (`ghost.userData.setPlacement(x, y, z, r)` does that from a building origin).
// Every mesh has its own translucent MeshStandardMaterial (no vertex colours) so it can be tinted via
// `material.color`. `ghost.userData.dispose()` releases the materials.
import * as THREE from 'three';
import { rotatedSize } from '../../core/buildingUtil';
import type { Rotation } from '../../core/types';
import { rotationYaw } from './BuildingView';
import { makeGhostMaterial, type MaterialLib } from './materials';
import { instantiate } from './models/instantiate';
import { getModelDef, getTemplate } from './models/registry';

export class BuildingGhost extends THREE.Group {
  readonly buildingType: string;

  constructor(type: string, lib: MaterialLib) {
    super();
    this.buildingType = type;
    this.name = `ghost:${type}`;
    const def = getModelDef(type);
    const model = instantiate(getTemplate(type, def.ghostVariant ?? '', lib.company), lib, false);
    for (const m of model.meshes) {
      m.material = makeGhostMaterial();
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 5;
    }
    this.add(model.root);
    this.userData.setPlacement = (x: number, y: number, z: number, r: number) => {
      const [w, d] = rotatedSize(type, (((r % 4) + 4) % 4) as Rotation);
      this.position.set(x + w / 2, y, z + d / 2);
      this.rotation.set(0, rotationYaw(r), 0);
    };
    this.userData.dispose = () => this.dispose();
  }

  dispose(): void {
    this.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    });
    this.removeFromParent();
  }
}

export function createGhost(type: string, lib: MaterialLib): THREE.Object3D {
  return new BuildingGhost(type, lib);
}
