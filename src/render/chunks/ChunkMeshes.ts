// GPU side of one chunk column: up to three meshes (opaque, cut-out, translucent) built from worker output.
// Opaque and cut-out indices are grouped by vertical section, so cave-occlusion culling only narrows the
// draw range (one draw call per pass and column, never more) and the frustum bounds follow the drawn range.
// Passes whose content hash did not change are kept (no re-upload after an edit elsewhere in the column).
// Translucent quads are re-sorted back-to-front when the camera moves nearby.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../core/constants';
import type { MeshResult, PassData } from '../meshing/protocol';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';

export type TerrainMode = 'normal' | 'xray';
type Pass = 'opaque' | 'cutout' | 'translucent';
const HALF = CHUNK_SIZE / 2;
const HALF_XZ_SQ = 2 * (HALF + 0.5) * (HALF + 0.5);

function passBytes(p: PassData | null): number {
  if (!p) return 0;
  return p.positions.byteLength + p.normals.byteLength + p.uvs.byteLength + p.info.byteLength + p.indices.byteLength;
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

export class ChunkMeshes {
  static readonly ZERO = new THREE.Vector3();
  opaque: THREE.Mesh | null = null;
  cutout: THREE.Mesh | null = null;
  translucent: THREE.Mesh | null = null;
  readonly origin: THREE.Vector3;
  /** Per-section face visibility (see MeshResult.vis). */
  vis: Uint16Array;
  private hashes = [-1, -1, -1];
  private opaqueRanges: Uint32Array | null = null;
  private cutoutRanges: Uint32Array | null = null;
  private secMinY: Float32Array | null = null;
  private secMaxY: Float32Array | null = null;
  /** Bit s set → section s hidden by cave-occlusion culling. */
  private culledMask = 0;
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

  constructor(readonly cx: number, readonly cz: number, private parent: THREE.Object3D, private mats: TerrainMaterialSet, readonly sectionCount: number, private mode: TerrainMode) {
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.vis = new Uint16Array(sectionCount).fill((1 << 15) - 1);
  }

  /** Bytes of vertex/index data a mesh result would upload (for the streaming upload budget). */
  static resultBytes(r: MeshResult): number {
    return passBytes(r.opaque) + passBytes(r.cutout) + passBytes(r.translucent);
  }

  /** Apply a mesh result; returns the number of bytes actually uploaded (unchanged passes are kept). */
  apply(r: MeshResult): number {
    this.vis = r.vis;
    this.opaqueRanges = r.opaqueRanges;
    this.cutoutRanges = r.cutoutRanges;
    this.secMinY = r.sectionMinY;
    this.secMaxY = r.sectionMaxY;
    let bytes = 0;
    if (r.hashes[0] !== this.hashes[0]) {
      this.hashes[0] = r.hashes[0];
      this.opaque = this.replace(this.opaque, r.opaque, 'opaque');
      bytes += passBytes(r.opaque);
    }
    if (r.hashes[1] !== this.hashes[1]) {
      this.hashes[1] = r.hashes[1];
      this.cutout = this.replace(this.cutout, r.cutout, 'cutout');
      bytes += passBytes(r.cutout);
    }
    if (r.hashes[2] !== this.hashes[2]) {
      this.hashes[2] = r.hashes[2];
      this.applyTranslucent(r);
      bytes += passBytes(r.translucent);
    }
    this.applyRanges();
    return bytes;
  }

  private applyTranslucent(r: MeshResult) {
    if (r.translucent) {
      const pos = r.translucent.positions;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] < lo) lo = pos[i];
        if (pos[i] > hi) hi = pos[i];
      }
      this.pivot.set(HALF, Math.round((lo + hi) / 2), HALF);
    }
    this.translucent = this.replace(this.translucent, r.translucent, 'translucent');
    if (r.translucent && r.quadCenters) {
      const c = r.quadCenters;
      for (let i = 0; i < c.length; i += 3) {
        c[i] -= this.pivot.x;
        c[i + 1] -= this.pivot.y;
        c[i + 2] -= this.pivot.z;
      }
      this.centers = c;
      this.baseIndex = r.translucent.indices.slice();
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
  }

  private replace(mesh: THREE.Mesh | null, data: PassData | null, pass: Pass) {
    if (!data) {
      if (mesh) {
        this.parent.remove(mesh);
        mesh.geometry.dispose();
      }
      return null;
    }
    const pivot = pass === 'translucent' ? this.pivot : ChunkMeshes.ZERO;
    const { lo, hi } = this.extent(0, this.sectionCount - 1);
    const geo = buildGeometry(data, lo, hi, pivot);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.position.copy(this.origin).add(pivot);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
      return mesh;
    }
    const m = new THREE.Mesh(geo, this.mats.opaque);
    m.name = `chunk-${pass}-${this.cx},${this.cz}`;
    m.position.copy(this.origin).add(pivot);
    // static: the terrain group sits at the origin, so the world matrix is the local one (no per-frame updates)
    m.matrixAutoUpdate = false;
    m.matrixWorldAutoUpdate = false;
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
    m.userData.pass = pass;
    m.castShadow = pass !== 'translucent';
    m.receiveShadow = true;
    if (pass === 'cutout') m.customDepthMaterial = this.mats.cutoutDepth;
    this.style(m);
    this.parent.add(m);
    return m;
  }

  /** Vertical extent of the geometry of sections a..b. */
  private extent(a: number, b: number) {
    let lo = Infinity;
    let hi = -Infinity;
    const mn = this.secMinY;
    const mx = this.secMaxY;
    if (mn && mx)
      for (let s = a; s <= b; s++) {
        if (mn[s] > mx[s]) continue;
        if (mn[s] < lo) lo = mn[s];
        if (mx[s] > hi) hi = mx[s];
      }
    return lo > hi ? { lo: 0, hi: 0 } : { lo, hi };
  }

  /** Narrow opaque/cut-out draw ranges (and their bounds) to the sections not culled. */
  private applyRanges() {
    this.rangeFor(this.opaque, this.opaqueRanges);
    this.rangeFor(this.cutout, this.cutoutRanges);
  }

  private rangeFor(m: THREE.Mesh | null, ranges: Uint32Array | null) {
    if (!m || !ranges) return;
    const n = this.sectionCount;
    let a = -1;
    let b = -1;
    for (let s = 0; s < n; s++) {
      if (this.culledMask & (1 << s) || ranges[s + 1] === ranges[s]) continue;
      if (a < 0) a = s;
      b = s;
    }
    const g = m.geometry;
    if (a < 0) {
      g.setDrawRange(0, 0);
      m.userData.empty = true;
    } else {
      g.setDrawRange(ranges[a], ranges[b + 1] - ranges[a]);
      m.userData.empty = false;
      const { lo, hi } = this.extent(a, b);
      const sphere = g.boundingSphere!;
      const hy = (hi - lo) / 2 + 0.5;
      sphere.center.set(HALF, (lo + hi) / 2, HALF);
      sphere.radius = Math.sqrt(HALF_XZ_SQ + hy * hy);
    }
    this.style(m);
  }

  /** Assign the material/visibility for a pass under the current terrain mode and culling. */
  private style(m: THREE.Mesh) {
    const pass = m.userData.pass as Pass;
    const mats = this.mats;
    if (this.mode === 'xray') {
      m.material = pass === 'translucent' ? mats.ghostWater : mats.ghost;
      m.visible = pass !== 'cutout' && !m.userData.empty;
      m.renderOrder = 5;
    } else {
      m.material = pass === 'opaque' ? mats.opaque : pass === 'cutout' ? mats.cutout : mats.translucent;
      m.visible = !m.userData.empty;
      m.renderOrder = 0;
    }
  }

  setMode(mode: TerrainMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const m of [this.opaque, this.cutout, this.translucent]) if (m) this.style(m);
  }

  /** Cave-occlusion culling result: bit s set hides section s. */
  setCulled(mask: number) {
    if (mask === this.culledMask) return;
    this.culledMask = mask;
    this.applyRanges();
  }

  /** Number of non-empty sections currently culled. */
  culledCount(): number {
    let n = 0;
    const r = this.opaqueRanges;
    const c = this.cutoutRanges;
    for (let s = 0; s < this.sectionCount; s++) {
      if (!(this.culledMask & (1 << s))) continue;
      if ((r && r[s + 1] > r[s]) || (c && c[s + 1] > c[s])) n++;
    }
    return n;
  }

  /** Re-sort translucent quads back-to-front for a camera position (world). Returns true if sorted. */
  sortTranslucent(cam: THREE.Vector3): boolean {
    if (!this.translucent || !this.centers || !this.baseIndex || !this.sortKeys || !this.order) return false;
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
    if (this.translucent) fn(this.translucent);
  }

  dispose() {
    for (const m of [this.opaque, this.cutout, this.translucent]) {
      if (!m) continue;
      this.parent.remove(m);
      m.geometry.dispose();
    }
    this.opaque = this.cutout = this.translucent = null;
    this.centers = this.baseIndex = null;
  }
}
