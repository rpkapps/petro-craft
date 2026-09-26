// GPU side of one chunk column: per vertical section up to four meshes (opaque, cut-out, plants,
// translucent) built from worker output, with tight per-section bounds for frustum culling, flags for
// cave-occlusion culling and plant distance LOD, and back-to-front re-sorting of translucent quads.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../core/constants';
import type { MeshResult, PassData, SectionData } from '../meshing/protocol';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';

export type TerrainMode = 'normal' | 'xray';
type Pass = 'opaque' | 'cutout' | 'plants' | 'translucent';
const PASSES: Pass[] = ['opaque', 'cutout', 'plants', 'translucent'];

function passBytes(p: PassData | null): number {
  if (!p) return 0;
  return p.positions.byteLength + p.normals.byteLength + p.uvs.byteLength + p.info.byteLength + p.indices.byteLength;
}

/** Bytes of vertex/index data a mesh result would upload (for the streaming upload budget). */
export function resultBytes(r: MeshResult): number {
  let n = 0;
  for (const s of r.sections) n += passBytes(s.opaque) + passBytes(s.cutout) + passBytes(s.plants) + passBytes(s.translucent);
  return n;
}

function buildGeometry(p: PassData, minY: number, maxY: number, pivot: THREE.Vector3): THREE.BufferGeometry {
  if (pivot.lengthSq() > 0) {
    const pos = p.positions;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= pivot.x;
      pos[i + 1] -= pivot.y;
      pos[i + 2] -= pivot.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(p.normals, 4, true));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(p.info, 4, false));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  g.boundingBox = new THREE.Box3(
    new THREE.Vector3(-0.5 - pivot.x, minY - 0.5 - pivot.y, -0.5 - pivot.z),
    new THREE.Vector3(CHUNK_SIZE + 0.5 - pivot.x, maxY + 0.5 - pivot.y, CHUNK_SIZE + 0.5 - pivot.z),
  );
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

/** One 16×SECTION×16 section of a chunk column. */
export class Section {
  opaque: THREE.Mesh | null = null;
  cutout: THREE.Mesh | null = null;
  plants: THREE.Mesh | null = null;
  translucent: THREE.Mesh | null = null;
  hash = -1;
  vis = 0;
  /** Hidden by cave-occlusion culling. */
  culled = false;
  /** Plants beyond the LOD distance are hidden. */
  plantsOn = true;
  private centers: Float32Array | null = null;
  private baseIndex: Uint16Array | Uint32Array | null = null;
  private sortKeys: Float32Array | null = null;
  private order: Uint32Array | null = null;
  private lastSort = new THREE.Vector3(1e9, 1e9, 1e9);
  /**
   * The translucent mesh is re-centred on its contents so three.js sorts it against other transparent
   * objects (particles, clouds, entity glass) by a meaningful position instead of the chunk corner.
   */
  private pivot = new THREE.Vector3();

  constructor(readonly sy: number, private owner: ChunkMeshes) {}

  get empty() {
    return !this.opaque && !this.cutout && !this.plants && !this.translucent;
  }

  apply(d: SectionData) {
    this.vis = d.vis;
    if (d.hash === this.hash) return false;
    this.hash = d.hash;
    this.opaque = this.replace(this.opaque, d.opaque, d, 'opaque');
    this.cutout = this.replace(this.cutout, d.cutout, d, 'cutout');
    this.plants = this.replace(this.plants, d.plants, d, 'plants');
    if (d.translucent) {
      const pos = d.translucent.positions;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] < lo) lo = pos[i];
        if (pos[i] > hi) hi = pos[i];
      }
      this.pivot.set(CHUNK_SIZE / 2, Math.round((lo + hi) / 2), CHUNK_SIZE / 2);
    }
    this.translucent = this.replace(this.translucent, d.translucent, d, 'translucent');
    if (d.translucent && d.quadCenters) {
      const c = d.quadCenters;
      for (let i = 0; i < c.length; i += 3) {
        c[i] -= this.pivot.x;
        c[i + 1] -= this.pivot.y;
        c[i + 2] -= this.pivot.z;
      }
      this.centers = c;
      this.baseIndex = d.translucent.indices.slice();
      const q = c.length / 3;
      this.sortKeys = new Float32Array(q);
      this.order = new Uint32Array(q);
      this.lastSort.set(1e9, 1e9, 1e9);
    } else {
      this.centers = null;
      this.baseIndex = null;
      this.sortKeys = null;
      this.order = null;
    }
    return true;
  }

  private replace(mesh: THREE.Mesh | null, data: PassData | null, d: SectionData, pass: Pass) {
    const o = this.owner;
    if (!data) {
      if (mesh) {
        o.parent.remove(mesh);
        mesh.geometry.dispose();
      }
      return null;
    }
    const pivot = pass === 'translucent' ? this.pivot : ChunkMeshes.ZERO;
    const geo = buildGeometry(data, d.minY, d.maxY, pivot);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.position.copy(o.origin).add(pivot);
      mesh.updateMatrix();
      mesh.updateMatrixWorld();
      return mesh;
    }
    const m = new THREE.Mesh(geo, o.mats.opaque);
    m.name = `chunk-${pass}-${o.cx},${this.sy},${o.cz}`;
    m.position.copy(o.origin).add(pivot);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.matrixWorldAutoUpdate = false;
    m.updateMatrixWorld();
    m.userData.pass = pass;
    m.castShadow = pass !== 'translucent';
    m.receiveShadow = true;
    if (pass === 'cutout' || pass === 'plants') m.customDepthMaterial = o.mats.cutoutDepth;
    this.style(m, o.mode);
    o.parent.add(m);
    return m;
  }

  /** Assign material & visibility for a pass under the terrain mode and culling/LOD flags. */
  style(m: THREE.Mesh, mode: TerrainMode) {
    const pass = m.userData.pass as Pass;
    const mats = this.owner.mats;
    let on = !this.culled;
    if (mode === 'xray') {
      m.material = pass === 'translucent' ? mats.ghostWater : mats.ghost;
      on = on && (pass === 'opaque' || pass === 'translucent');
      m.renderOrder = 5;
    } else {
      m.material = pass === 'opaque' ? mats.opaque : pass === 'cutout' ? mats.cutout : pass === 'plants' ? mats.plants : mats.translucent;
      if (pass === 'plants') on = on && this.plantsOn;
      m.renderOrder = 0;
    }
    m.visible = on;
  }

  restyle() {
    const mode = this.owner.mode;
    if (this.opaque) this.style(this.opaque, mode);
    if (this.cutout) this.style(this.cutout, mode);
    if (this.plants) this.style(this.plants, mode);
    if (this.translucent) this.style(this.translucent, mode);
  }

  /** Re-sort translucent quads back-to-front for a camera position (world). Returns true if sorted. */
  sortTranslucent(cam: THREE.Vector3): boolean {
    if (!this.translucent || !this.centers || !this.baseIndex || !this.sortKeys || !this.order || !this.translucent.visible) return false;
    const p = this.translucent.position;
    const lx = cam.x - p.x;
    const ly = cam.y - p.y;
    const lz = cam.z - p.z;
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

  forEachMesh(fn: (m: THREE.Mesh) => void) {
    if (this.opaque) fn(this.opaque);
    if (this.cutout) fn(this.cutout);
    if (this.plants) fn(this.plants);
    if (this.translucent) fn(this.translucent);
  }

  dispose() {
    for (const p of PASSES) {
      const m = this[p];
      if (!m) continue;
      this.owner.parent.remove(m);
      m.geometry.dispose();
      this[p] = null;
    }
    this.centers = this.baseIndex = null;
    this.sortKeys = null;
    this.order = null;
  }
}

export class ChunkMeshes {
  static readonly ZERO = new THREE.Vector3();
  readonly origin: THREE.Vector3;
  readonly sections: Section[] = [];
  mode: TerrainMode;

  constructor(readonly cx: number, readonly cz: number, readonly parent: THREE.Object3D, readonly mats: TerrainMaterialSet, sectionCount: number, mode: TerrainMode) {
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.mode = mode;
    for (let s = 0; s < sectionCount; s++) this.sections.push(new Section(s, this));
  }

  /** Apply a mesh result; returns the number of sections whose geometry actually changed. */
  apply(r: MeshResult): number {
    let changed = 0;
    for (const d of r.sections) {
      const s = this.sections[d.sy];
      if (s && s.apply(d)) changed++;
    }
    return changed;
  }

  setMode(mode: TerrainMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const s of this.sections) s.restyle();
  }

  setPlantsVisible(on: boolean) {
    for (const s of this.sections) {
      if (s.plantsOn === on) continue;
      s.plantsOn = on;
      if (s.plants) s.style(s.plants, this.mode);
    }
  }

  /** Occlusion culling result for one section. */
  setCulled(sy: number, culled: boolean) {
    const s = this.sections[sy];
    if (!s || s.culled === culled) return;
    s.culled = culled;
    s.restyle();
  }

  forEachMesh(fn: (m: THREE.Mesh) => void) {
    for (const s of this.sections) s.forEachMesh(fn);
  }

  dispose() {
    for (const s of this.sections) s.dispose();
  }
}
