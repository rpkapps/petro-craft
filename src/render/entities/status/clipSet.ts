import type * as THREE from 'three';
import type { MaterialLib, MatKind, MatMode } from '../materials';

/** Per-instance set of clipped material clones (one per kind), released together. */
export class ClipMaterialSet {
  private readonly mats = new Map<MatKind, THREE.Material>();
  constructor(private readonly lib: MaterialLib, private readonly mode: MatMode, private readonly planes: THREE.Plane[]) {}

  get(kind: MatKind): THREE.Material {
    let m = this.mats.get(kind);
    if (!m) {
      m = this.lib.cloneFor(kind, this.mode, this.planes);
      this.mats.set(kind, m);
    }
    return m;
  }

  /** Assign clipped materials to every mesh (userData.kind). */
  apply(meshes: THREE.Mesh[]): void {
    for (const m of meshes) m.material = this.get(m.userData.kind as MatKind);
  }

  dispose(): void {
    for (const m of this.mats.values()) this.lib.releaseClone(m);
    this.mats.clear();
  }
}
