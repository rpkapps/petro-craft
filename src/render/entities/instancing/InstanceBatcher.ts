// Shared instanced renderer for buildings beyond near range. Every non-detail mesh of a model template
// becomes one THREE.InstancedMesh per (template, material mode, 64×64-block cell); buildings of the same
// type/variant/look in a cell share those draw calls. Cells give per-batch frustum culling (a bounding
// sphere from the member buildings) for both the camera and the shadow map.
// Static parts are written once when a building joins a batch; animated nodes (pumpjack beams, turbine
// rotors, tracker rows ...) are re-written only for instanced buildings that actually animate this
// frame (visible & in animation range). Member views are detached from the scene graph so the renderer
// does not traverse their (invisible) hierarchies.
import * as THREE from 'three';
import type { ModelTemplate } from '../geom/Builder';
import type { MaterialLib, MatKind, MatMode } from '../materials';
import type { ModelObject } from '../models/instantiate';

const CELL = 64;
const MIN_CAPACITY = 8;

interface PartDef {
  geometry: THREE.BufferGeometry;
  kind: MatKind;
  meshIndex: number;
  /** Index into TemplateInfo.nodes of the owning node. */
  node: number;
  /** Mesh-local transform (null = identity). */
  local: THREE.Matrix4 | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

interface TemplateInfo {
  id: number;
  parts: PartDef[];
  /** Node groups in parent-first order as child-index paths from the model root (index 0 = root). */
  nodePaths: number[][];
  /** parent[i] < i (−1 for the root). */
  parent: number[];
}

/** What the batcher needs from a building view. */
export interface InstanceMember {
  readonly model: ModelObject;
  readonly group: THREE.Object3D;
  readonly center: THREE.Vector3;
  readonly radius: number;
  /** Batcher bookkeeping (owned by InstanceBatcher). */
  inst: { batch: Batch; slot: number; nodes: THREE.Object3D[]; worlds: THREE.Matrix4[] } | null;
}

const infos = new WeakMap<ModelTemplate, TemplateInfo>();
let nextTemplateId = 1;

function templateInfo(model: ModelObject): TemplateInfo {
  let info = infos.get(model.template);
  if (info) return info;
  const nodePaths: number[][] = [[]];
  const parent: number[] = [-1];
  const index = new Map<THREE.Object3D, number>([[model.root, 0]]);
  // parent-first traversal of the node groups (meshes are leaves)
  const visit = (o: THREE.Object3D, pi: number, path: number[]) => {
    o.children.forEach((c, ci) => {
      if (c instanceof THREE.Mesh) return;
      const i = nodePaths.length;
      const p = [...path, ci];
      nodePaths.push(p);
      parent.push(pi);
      index.set(c, i);
      visit(c, i, p);
    });
  };
  visit(model.root, 0, []);
  const details = new Set(model.details);
  const parts: PartDef[] = [];
  model.meshes.forEach((m, meshIndex) => {
    if (details.has(m)) return;
    const node = index.get(m.parent!) ?? 0;
    const local = isIdentity(m.matrix) ? null : m.matrix.clone();
    parts.push({ geometry: m.geometry, kind: m.userData.kind as MatKind, meshIndex, node, local, castShadow: m.castShadow, receiveShadow: m.receiveShadow });
  });
  info = { id: nextTemplateId++, parts, nodePaths, parent };
  infos.set(model.template, info);
  return info;
}

function resolve(root: THREE.Object3D, path: number[]): THREE.Object3D {
  let o = root;
  for (const i of path) o = o.children[i] ?? o;
  return o;
}

function isIdentity(m: THREE.Matrix4): boolean {
  const e = m.elements;
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - I[i]) > 1e-9) return false;
  return true;
}

export class Batch {
  meshes: THREE.InstancedMesh[] = [];
  readonly owners: InstanceMember[] = [];
  count = 0;
  capacity = 0;
  readonly sphere = new THREE.Sphere();
  dirty = false;
  boundsDirty = false;

  constructor(
    readonly key: string,
    readonly info: TemplateInfo,
    private readonly mode: MatMode,
    private readonly lib: MaterialLib,
    private readonly parent: THREE.Object3D,
  ) {
    this.grow(MIN_CAPACITY);
  }

  grow(capacity: number): void {
    const old = this.meshes;
    this.meshes = this.info.parts.map((p, i) => {
      const m = new THREE.InstancedMesh(p.geometry, this.lib.get(p.kind, this.mode), capacity);
      m.name = `inst:${this.key}:${i}`;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = p.castShadow;
      m.receiveShadow = p.receiveShadow;
      m.matrixAutoUpdate = false;
      m.boundingSphere = this.sphere;
      m.count = this.count;
      const prev = old[i];
      if (prev) (m.instanceMatrix.array as Float32Array).set((prev.instanceMatrix.array as Float32Array).subarray(0, this.count * 16));
      this.parent.add(m);
      return m;
    });
    for (const m of old) {
      m.removeFromParent();
      m.dispose();
    }
    this.capacity = capacity;
  }

  /** Swap materials after a material-library reset. */
  refreshMaterials(): void {
    this.info.parts.forEach((p, i) => (this.meshes[i].material = this.lib.get(p.kind, this.mode)));
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    this.meshes = [];
  }
}

const _m = new THREE.Matrix4();
const _s = new THREE.Sphere();

export class InstanceBatcher {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  /** Diagnostics. */
  get batchCount(): number {
    return this.batches.size;
  }
  get memberCount(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.count;
    return n;
  }

  constructor(private readonly lib: MaterialLib) {
    this.group.name = 'instanced-buildings';
  }

  private keyFor(info: TemplateInfo, mode: MatMode, v: InstanceMember): string {
    const cx = Math.floor(v.center.x / CELL);
    const cz = Math.floor(v.center.z / CELL);
    return `${info.id}|${mode}|${cx},${cz}`;
  }

  /** Start drawing a view through the shared batches (view must have an up-to-date placement). */
  add(v: InstanceMember, mode: MatMode): void {
    if (v.inst) this.remove(v);
    const info = templateInfo(v.model);
    if (info.parts.length === 0) return;
    const key = this.keyFor(info, mode, v);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new Batch(key, info, mode, this.lib, this.group);
      this.batches.set(key, batch);
    }
    if (batch.count === batch.capacity) batch.grow(batch.capacity * 2);
    const slot = batch.count++;
    batch.owners[slot] = v;
    const nodes = info.nodePaths.map((p) => resolve(v.model.root, p));
    v.inst = { batch, slot, nodes, worlds: nodes.map(() => new THREE.Matrix4()) };
    v.group.updateMatrixWorld(true);
    for (let i = 0; i < nodes.length; i++) v.inst.worlds[i].copy(nodes[i].matrixWorld);
    this.writeParts(v);
    batch.boundsDirty = true;
  }

  /** Stop drawing a view through the batches (swap-remove). */
  remove(v: InstanceMember): void {
    const inst = v.inst;
    if (!inst) return;
    v.inst = null;
    const batch = inst.batch;
    const last = batch.count - 1;
    if (inst.slot !== last) {
      const moved = batch.owners[last];
      batch.owners[inst.slot] = moved;
      for (const m of batch.meshes) {
        const a = m.instanceMatrix.array as Float32Array;
        a.copyWithin(inst.slot * 16, last * 16, last * 16 + 16);
      }
      if (moved.inst) moved.inst.slot = inst.slot;
    }
    batch.owners.length = last;
    batch.count = last;
    batch.dirty = true;
    batch.boundsDirty = true;
  }

  /** Re-evaluate animated node transforms of an instanced view and upload its part matrices. */
  animated(v: InstanceMember): void {
    const inst = v.inst;
    if (!inst) return;
    const { nodes, worlds } = inst;
    const parent = inst.batch.info.parent;
    worlds[0].multiplyMatrices(v.group.matrixWorld, updateLocal(nodes[0]));
    for (let i = 1; i < nodes.length; i++) worlds[i].multiplyMatrices(worlds[parent[i]], updateLocal(nodes[i]));
    // keep the (detached) scene nodes' world matrices current for FX anchors
    for (let i = 0; i < nodes.length; i++) nodes[i].matrixWorld.copy(worlds[i]);
    this.writeParts(v);
  }

  private writeParts(v: InstanceMember): void {
    const inst = v.inst!;
    const b = inst.batch;
    const parts = b.info.parts;
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const w = inst.worlds[part.node];
      const m = part.local ? _m.multiplyMatrices(w, part.local) : w;
      m.toArray(b.meshes[p].instanceMatrix.array as Float32Array, inst.slot * 16);
    }
    b.dirty = true;
  }

  /** Upload changed batches and refresh culling spheres (once per frame, after all updates). */
  flush(): void {
    for (const [key, b] of this.batches) {
      if (b.count === 0) {
        b.dispose();
        this.batches.delete(key);
        continue;
      }
      if (b.boundsDirty) {
        b.boundsDirty = false;
        b.sphere.makeEmpty();
        for (let i = 0; i < b.count; i++) {
          const o = b.owners[i];
          // animated parts swing within the building's bounds; pad a little for cranes and rotors
          _s.set(o.center, o.radius + 2);
          b.sphere.union(_s);
        }
      }
      if (b.dirty) {
        b.dirty = false;
        for (const m of b.meshes) {
          m.count = b.count;
          m.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  /** Re-assign materials (e.g. after the library rebuilt its variants). */
  refreshMaterials(): void {
    for (const b of this.batches.values()) b.refreshMaterials();
  }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.group.removeFromParent();
  }
}

function updateLocal(o: THREE.Object3D): THREE.Matrix4 {
  if (o.matrixAutoUpdate) o.updateMatrix();
  return o.matrix;
}
