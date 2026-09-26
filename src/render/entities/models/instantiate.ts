// Turns a baked ModelTemplate into an Object3D hierarchy that shares geometry & materials.
import * as THREE from 'three';
import type { ModelTemplate, TemplateNode } from '../geom/Builder';
import type { MaterialLib, MatKind } from '../materials';

export interface ModelObject {
  root: THREE.Group;
  nodes: Map<string, THREE.Object3D>;
  /** Every mesh (merged parts and attachments). userData.kind holds its MatKind. */
  meshes: THREE.Mesh[];
  /** Detail meshes (hidden at distance). */
  details: THREE.Mesh[];
  template: ModelTemplate;
}

let flagGeo: THREE.BufferGeometry | null = null;
let signGeo: THREE.BufferGeometry | null = null;
const getFlagGeo = () => (flagGeo ??= new THREE.PlaneGeometry(1, 1, 8, 3));
const getSignGeo = () => (signGeo ??= new THREE.PlaneGeometry(1, 1));

export function instantiate(t: ModelTemplate, lib: MaterialLib, shadows = true): ModelObject {
  const nodes = new Map<string, THREE.Object3D>();
  const meshes: THREE.Mesh[] = [];
  const details: THREE.Mesh[] = [];
  const make = (n: TemplateNode, isRoot: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.name = n.name;
    if (!isRoot) {
      n.matrix.decompose(g.position, g.quaternion, g.scale);
      nodes.set(n.name, g);
    }
    for (const tm of n.meshes) {
      const m = new THREE.Mesh(tm.geometry, lib.get(tm.kind));
      m.userData.kind = tm.kind;
      m.castShadow = shadows && tm.shadow;
      m.receiveShadow = shadows && tm.kind !== 'lamp' && tm.kind !== 'blink' && tm.kind !== 'hot';
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      g.add(m);
      meshes.push(m);
      if (tm.detail) details.push(m);
    }
    for (const a of n.attachments) {
      const kind: MatKind = a.type;
      const m = new THREE.Mesh(a.type === 'flag' ? getFlagGeo() : getSignGeo(), lib.get(kind));
      m.userData.kind = kind;
      a.matrix.decompose(m.position, m.quaternion, m.scale);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.castShadow = false;
      m.receiveShadow = false;
      g.add(m);
      meshes.push(m);
      if (a.type === 'flag') details.push(m);
    }
    for (const c of n.children) g.add(make(c, false));
    return g;
  };
  const root = make(t.root, true);
  return { root, nodes, meshes, details, template: t };
}
