// GPU side of one chunk: up to three meshes (opaque, cut-out, translucent) built from worker output,
// plus back-to-front re-sorting of translucent quads when the camera moves nearby.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../core/constants';
import type { MeshResult, PassData } from '../meshing/protocol';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';

export type TerrainMode = 'normal' | 'xray';

function buildGeometry(p: PassData, minY: number, maxY: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(p.normals, 4, true));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(p.info, 4, false));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, minY - 0.5, -0.5), new THREE.Vector3(CHUNK_SIZE + 0.5, maxY + 1.5, CHUNK_SIZE + 0.5));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

export class ChunkMeshes {
  opaque: THREE.Mesh | null = null;
  cutout: THREE.Mesh | null = null;
  translucent: THREE.Mesh | null = null;
  private centers: Float32Array | null = null;
  private baseIndex: Uint16Array | Uint32Array | null = null;
  private sortKeys: Float32Array | null = null;
  private order: Uint32Array | null = null;
  private lastSort = new THREE.Vector3(1e9, 1e9, 1e9);
  readonly origin: THREE.Vector3;

  constructor(readonly cx: number, readonly cz: number, private parent: THREE.Object3D, private mats: TerrainMaterialSet) {
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
  }

  apply(r: MeshResult, mode: TerrainMode) {
    this.opaque = this.replace(this.opaque, r.opaque, r, 'opaque', mode);
    this.cutout = this.replace(this.cutout, r.cutout, r, 'cutout', mode);
    this.translucent = this.replace(this.translucent, r.translucent, r, 'translucent', mode);
    if (r.translucent && r.quadCenters) {
      this.centers = r.quadCenters;
      this.baseIndex = r.translucent.indices.slice();
      const q = r.quadCenters.length / 3;
      this.sortKeys = new Float32Array(q);
      this.order = new Uint32Array(q);
      this.lastSort.set(1e9, 1e9, 1e9);
    } else {
      this.centers = null;
      this.baseIndex = null;
      this.sortKeys = null;
      this.order = null;
    }
  }

  private replace(mesh: THREE.Mesh | null, data: PassData | null, r: MeshResult, pass: 'opaque' | 'cutout' | 'translucent', mode: TerrainMode) {
    if (!data) {
      if (mesh) {
        this.parent.remove(mesh);
        mesh.geometry.dispose();
      }
      return null;
    }
    const geo = buildGeometry(data, r.minY, r.maxY);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      return mesh;
    }
    const m = new THREE.Mesh(geo, this.mats.opaque);
    m.name = `chunk-${pass}-${this.cx},${this.cz}`;
    m.position.copy(this.origin);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.pass = pass;
    if (pass === 'opaque') {
      m.castShadow = true;
      m.receiveShadow = true;
    } else if (pass === 'cutout') {
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = this.mats.cutoutDepth;
    } else {
      m.castShadow = false;
      m.receiveShadow = true;
    }
    ChunkMeshes.styleMesh(m, mode, this.mats);
    this.parent.add(m);
    return m;
  }

  /** Assign the material/visibility for a pass under the current terrain mode. */
  static styleMesh(m: THREE.Mesh, mode: TerrainMode, mats: TerrainMaterialSet) {
    const pass = m.userData.pass as string;
    if (mode === 'xray') {
      m.material = pass === 'translucent' ? mats.ghostWater : mats.ghost;
      m.visible = pass !== 'cutout';
      m.renderOrder = 5;
    } else {
      m.material = pass === 'opaque' ? mats.opaque : pass === 'cutout' ? mats.cutout : mats.translucent;
      m.visible = true;
      m.renderOrder = 0;
    }
  }

  setMode(mode: TerrainMode) {
    for (const m of [this.opaque, this.cutout, this.translucent]) if (m) ChunkMeshes.styleMesh(m, mode, this.mats);
  }

  /** Re-sort translucent quads back-to-front for a camera position (world). Returns true if sorted. */
  sortTranslucent(cam: THREE.Vector3): boolean {
    if (!this.translucent || !this.centers || !this.baseIndex || !this.sortKeys || !this.order) return false;
    const lx = cam.x - this.origin.x;
    const ly = cam.y;
    const lz = cam.z - this.origin.z;
    if (Math.abs(lx - this.lastSort.x) < 0.75 && Math.abs(ly - this.lastSort.y) < 0.75 && Math.abs(lz - this.lastSort.z) < 0.75) return false;
    this.lastSort.set(lx, ly, lz);
    const c = this.centers;
    const q = this.sortKeys.length;
    const keys = this.sortKeys;
    const order = this.order;
    for (let i = 0; i < q; i++) {
      const dx = c[i * 3] - lx;
      const dy = c[i * 3 + 1] - ly;
      const dz = c[i * 3 + 2] - lz;
      keys[i] = dx * dx + dy * dy + dz * dz;
      order[i] = i;
    }
    order.sort((a, b) => keys[b] - keys[a]);
    const attr = this.translucent.geometry.index!;
    const dst = attr.array as Uint16Array | Uint32Array;
    const src = this.baseIndex;
    for (let i = 0; i < q; i++) {
      const s = order[i] * 6;
      const d = i * 6;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
      dst[d + 3] = src[s + 3];
      dst[d + 4] = src[s + 4];
      dst[d + 5] = src[s + 5];
    }
    attr.needsUpdate = true;
    return true;
  }

  dispose() {
    for (const m of [this.opaque, this.cutout, this.translucent]) {
      if (!m) continue;
      this.parent.remove(m);
      m.geometry.dispose();
    }
    this.opaque = this.cutout = this.translucent = null;
  }
}
