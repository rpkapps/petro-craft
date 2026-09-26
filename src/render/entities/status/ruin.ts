// Burnt-out ruin look: charred materials, the structure cut by a tilted world clip plane (partial
// collapse), a slight lean and a rubble pile of scorched debris at its base.
import * as THREE from 'three';
import { Builder, type ModelTemplate } from '../geom/Builder';
import { prng } from '../geom/parts';
import type { MaterialLib } from '../materials';
import { instantiate, type ModelObject } from '../models/instantiate';
import { ClipMaterialSet } from './clipSet';

const rubbleCache = new Map<string, ModelTemplate>();

/** Free cached rubble templates (layer dispose). */
export function clearRuinTemplates(): void {
  for (const t of rubbleCache.values()) {
    const walk = (n: ModelTemplate['root']) => {
      for (const m of n.meshes) m.geometry.dispose();
      n.children.forEach(walk);
    };
    walk(t.root);
  }
  rubbleCache.clear();
}

function rubbleTemplate(w: number, d: number, h: number): ModelTemplate {
  const key = `${w}x${d}x${Math.round(h)}`;
  let t = rubbleCache.get(key);
  if (t) return t;
  const r = prng(w * 131 + d * 17 + h);
  const b = new Builder();
  const n = Math.round(w * d * 0.9) + 6;
  const cols = [0x1d1a18, 0x2b2622, 0x3a332d, 0x151312, 0x4a3b30];
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * w * 1.05;
    const z = (r() - 0.5) * d * 1.05;
    const s = 0.25 + r() * 0.8;
    b.push().translate(x, s * 0.3, z).rotY(r() * 3).rotX((r() - 0.5) * 0.8);
    b.box(0, 0, 0, s * (0.8 + r()), s * 0.6, s * (0.6 + r() * 0.6), cols[i % cols.length], 'rough');
    b.pop();
  }
  // twisted beams
  for (let i = 0; i < Math.round((w + d) / 2); i++) {
    const x = (r() - 0.5) * w;
    const z = (r() - 0.5) * d;
    const len = 1 + r() * Math.min(4, h * 0.4);
    const a = r() * Math.PI * 2;
    b.beam([x, 0.1, z], [x + Math.cos(a) * len, 0.2 + r() * 1.5, z + Math.sin(a) * len], 0.12, 0x2a2420, 'metal');
  }
  // scorched ground
  b.slab(-w / 2 - 0.6, 0, -d / 2 - 0.6, w / 2 + 0.6, 0.03, d / 2 + 0.6, 0x1a1715, 'rough');
  t = b.build();
  rubbleCache.set(key, t);
  return t;
}

export class Ruin {
  readonly group = new THREE.Group();
  readonly mats: ClipMaterialSet;
  private readonly plane: THREE.Plane;
  private readonly rubble: ModelObject;

  constructor(lib: MaterialLib, private readonly model: ModelObject, w: number, d: number, h: number, center: THREE.Vector3, seed: number) {
    const r = prng(seed);
    const a = r() * Math.PI * 2;
    const tilt = 0.35 + r() * 0.35;
    const normal = new THREE.Vector3(Math.cos(a) * tilt, -1, Math.sin(a) * tilt).normalize();
    const cutY = center.y + Math.max(1.0, h * (0.28 + r() * 0.17));
    const p = new THREE.Vector3(center.x, cutY, center.z);
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
    this.mats = new ClipMaterialSet(lib, 'charred', [this.plane]);
    this.mats.apply(model.meshes);
    model.root.rotation.set((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
    this.rubble = instantiate(rubbleTemplate(w, d, h), lib, true);
    this.group.add(this.rubble.root);
  }

  dispose(): void {
    this.model.root.rotation.set(0, 0, 0);
    this.mats.dispose();
    this.group.removeFromParent();
  }
}
