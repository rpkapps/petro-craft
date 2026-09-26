// Build-mode ghost previews (host.buildingPreview.create(type)).
//
// Placement convention: set `ghost.position` to the building ORIGIN (min corner, BuildingState x/y/z)
// and `ghost.rotation.y` to any multiple of π/2 (use rotationYaw(r) = -r·π/2 to match placed
// buildings). The ghost keeps its rotated footprint anchored at the min corner whichever way it is
// rotated. `ghost.userData.setPlacement(x, y, z, rotation)` does both. Every mesh has its own
// translucent MeshStandardMaterial (no vertex colours) so the player module can tint it via
// `material.color`. Call `ghost.userData.dispose()` when discarding it.
import * as THREE from 'three';
import { rotationYaw } from './BuildingView';
import { makeGhostMaterial, type MaterialLib } from './materials';
import { instantiate } from './models/instantiate';
import { defSize, getModelDef, getTemplate } from './models/registry';

const _q = new THREE.Quaternion();
const _off = new THREE.Vector3();

export class BuildingGhost extends THREE.Group {
  private readonly inner = new THREE.Group();
  readonly buildingType: string;
  private readonly w: number;
  private readonly d: number;

  constructor(type: string, lib: MaterialLib) {
    super();
    this.buildingType = type;
    this.name = `ghost:${type}`;
    const [w, d] = defSize(type);
    this.w = w;
    this.d = d;
    const def = getModelDef(type);
    const model = instantiate(getTemplate(type, def.ghostVariant ?? '', lib.company), lib, false);
    for (const m of model.meshes) {
      m.material = makeGhostMaterial();
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 5;
      m.visible = true;
    }
    // footprint outline on the ground
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.04, d)).translate(0, 0.03, 0),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    outline.renderOrder = 6;
    this.inner.add(model.root, outline);
    this.add(this.inner);
    this.userData.setPlacement = (x: number, y: number, z: number, r: number) => {
      this.position.set(x, y, z);
      this.rotation.set(0, rotationYaw(r), 0);
    };
    this.userData.dispose = () => this.dispose();
    this.userData.anchor = 'min-corner';
  }

  override updateMatrixWorld(force?: boolean): void {
    // rotated footprint size and the offset from the min corner to the footprint centre in world axes
    _q.setFromEuler(this.rotation);
    const quarter = Math.round(Math.abs(this.rotation.y) / (Math.PI / 2)) % 2;
    const w = quarter ? this.d : this.w;
    const d = quarter ? this.w : this.d;
    _off.set(w / 2, 0, d / 2).applyQuaternion(_q.invert());
    this.inner.position.copy(_off);
    super.updateMatrixWorld(force);
  }

  dispose(): void {
    this.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
      if (o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.removeFromParent();
  }
}

export function createGhost(type: string, lib: MaterialLib): THREE.Object3D {
  return new BuildingGhost(type, lib);
}
