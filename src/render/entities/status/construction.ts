// Construction-site visuals: the model is revealed bottom-up (world clip plane at the build height),
// the unbuilt remainder is shown as a faint blueprint, scaffolding wraps the footprint and a small
// tower crane slews around.
import * as THREE from 'three';
import { Builder, type ModelTemplate } from '../geom/Builder';
import { latticeMast } from '../geom/parts';
import { makeBlueprintMaterial, type MaterialLib } from '../materials';
import { instantiate, type ModelObject } from '../models/instantiate';
import { C } from '../palette';
import { ClipMaterialSet } from './clipSet';

const scaffoldCache = new Map<string, ModelTemplate>();
const craneCache = new Map<number, ModelTemplate>();

function scaffoldTemplate(w: number, d: number, h: number): ModelTemplate {
  const key = `${w}x${d}x${h}`;
  let t = scaffoldCache.get(key);
  if (t) return t;
  const b = new Builder();
  const o = 0.35;
  const x0 = -w / 2 - o;
  const x1 = w / 2 + o;
  const z0 = -d / 2 - o;
  const z1 = d / 2 + o;
  const top = h + 0.6;
  const poleAt = (x: number, z: number) => b.box(x, top / 2, z, 0.07, top, 0.07, C.GALV, 'metal');
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i < n; i++) poleAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
    for (let y = 1.5, lvl = 0; y <= top; y += 1.5, lvl++) {
      b.beam([ax, y, az], [bx, y, bz], 0.05, C.GALV, 'metal');
      if (lvl % 2 === 0) {
        // plank walkway just inside the outer ring
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const s = 0.28;
        b.beam([ax + nx * s, y, az + nz * s], [bx + nx * s, y, bz + nz * s], 0.06, C.WOOD, 'rough', 0.45);
      }
    }
    for (let i = 0; i < n; i += 2) {
      const ta = i / n;
      const tb = (i + 1) / n;
      b.beam([ax + (bx - ax) * ta, 0.1, az + (bz - az) * ta], [ax + (bx - ax) * tb, Math.min(top, 3), az + (bz - az) * tb], 0.04, C.GALV, 'metal');
    }
  };
  edge(x0, z0, x1, z0);
  edge(x1, z0, x1, z1);
  edge(x1, z1, x0, z1);
  edge(x0, z1, x0, z0);
  // site fence & ground marks
  b.slab(x0 - 0.2, 0, z0 - 0.2, x1 + 0.2, 0.03, z1 + 0.2, C.GRAVEL, 'rough');
  t = b.build();
  scaffoldCache.set(key, t);
  return t;
}

function craneTemplate(h: number): ModelTemplate {
  const hh = Math.max(6, Math.round(h));
  let t = craneCache.get(hh);
  if (t) return t;
  const b = new Builder();
  b.slab(-0.7, 0, -0.7, 0.7, 0.4, 0.7, C.CONCRETE, 'rough');
  latticeMast(b, { x: 0, z: 0, y0: 0.4, y1: hh, hw0: 0.35, hw1: 0.35, panel: 0.9, leg: 0.08, brace: 0.035, color: C.HAZARD });
  b.group('jib', 0, hh, 0, () => {
    b.box(0, 0.3, 0, 0.9, 0.6, 0.9, C.HAZARD, 'paint');
    b.box(0.2, 0.55, 0.45, 0.6, 0.5, 0.35, C.WHITE, 'paint');
    b.box(0.2, 0.6, 0.63, 0.5, 0.3, 0.02, C.GLASS, 'glassDark');
    // jib (+x) and counter jib (-x)
    for (let x = 0.5; x < 8.5; x += 0.8) {
      b.beam([x, 0.6, -0.25], [x + 0.8, 0.6, -0.25], 0.05, C.HAZARD, 'paint');
      b.beam([x, 0.6, 0.25], [x + 0.8, 0.6, 0.25], 0.05, C.HAZARD, 'paint');
      b.beam([x, 0.6, 0], [x + 0.4, 1.1, 0], 0.035, C.HAZARD, 'paint');
      b.beam([x + 0.4, 1.1, 0], [x + 0.8, 0.6, 0], 0.035, C.HAZARD, 'paint');
      b.beam([x, 1.1, 0], [x + 0.8, 1.1, 0], 0.04, C.HAZARD, 'paint');
    }
    b.slab(-3.2, 0.5, -0.35, -0.4, 0.7, 0.35, C.HAZARD, 'paint');
    b.slab(-3.1, 0.7, -0.4, -2.2, 1.5, 0.4, C.CONCRETE, 'rough');
    b.pipe([0, 1.9, 0], [8.4, 1.0, 0], 0.025, C.STEEL_DARK, 'metal', 4);
    b.pipe([0, 1.9, 0], [-3, 1.1, 0], 0.025, C.STEEL_DARK, 'metal', 4);
    b.beam([0, 0.6, 0], [0, 2, 0], 0.12, C.HAZARD, 'paint');
    b.box(8.5, 0.6, 0, 0.12, 0.12, 0.12, C.LAMP_RED, 'blink');
    b.group('trolley', 5, 0.5, 0, () => {
      b.box(0, 0, 0, 0.4, 0.15, 0.5, C.STEEL_DARK, 'paint');
      b.group('cable', 0, 0, 0, () => b.box(0, -0.5, 0, 0.02, 1, 0.02, C.STEEL_DARK, 'metal'));
      b.group('hook', 0, -1, 0, () => b.box(0, -0.1, 0, 0.2, 0.2, 0.16, C.HAZARD, 'paint'));
    });
  });
  t = b.build();
  craneCache.set(hh, t);
  return t;
}

export class ConstructionSite {
  readonly group = new THREE.Group();
  private readonly modelPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly scaffoldPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly blueprintPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly modelMats: ClipMaterialSet;
  private readonly scaffoldMats: ClipMaterialSet;
  private readonly blueprintMat: THREE.MeshBasicMaterial;
  private readonly blueprints: THREE.Mesh[] = [];
  private readonly scaffold: ModelObject;
  private readonly crane: ModelObject;
  private progress = -1;
  private slew = Math.random() * Math.PI * 2;
  private slewTarget = 0;
  private trolleyT = 0.5;

  constructor(
    private readonly lib: MaterialLib,
    private readonly model: ModelObject,
    private readonly w: number,
    private readonly d: number,
    private readonly h: number,
    private readonly baseY: number,
  ) {
    this.modelMats = new ClipMaterialSet(lib, 'off', [this.modelPlane]);
    this.scaffoldMats = new ClipMaterialSet(lib, 'normal', [this.scaffoldPlane]);
    this.blueprintMat = makeBlueprintMaterial([this.blueprintPlane]);
    this.scaffold = instantiate(scaffoldTemplate(w, d, h), lib, false);
    this.scaffoldMats.apply(this.scaffold.meshes);
    this.group.add(this.scaffold.root);
    this.crane = instantiate(craneTemplate(h + 4), lib, true);
    this.crane.root.position.set(-w / 2 - 1.2, 0, -d / 2 - 1.2);
    this.group.add(this.crane.root);
    for (const m of model.meshes) {
      if (m.userData.kind === 'flag' || m.userData.kind === 'sign' || model.details.includes(m)) continue;
      const bp = new THREE.Mesh(m.geometry, this.blueprintMat);
      bp.matrixAutoUpdate = false;
      bp.matrix.copy(m.matrix);
      bp.renderOrder = 2;
      m.parent?.add(bp);
      this.blueprints.push(bp);
    }
    this.modelMats.apply(model.meshes);
  }

  setProgress(p: number): void {
    p = Math.max(0, Math.min(1, p));
    if (Math.abs(p - this.progress) < 1e-4) return;
    this.progress = p;
    const reveal = this.baseY + 0.02 + p * (this.h + 3);
    this.modelPlane.constant = reveal;
    this.blueprintPlane.constant = -reveal;
    this.scaffoldPlane.constant = Math.min(this.baseY + this.h + 0.7, reveal + 2.5);
  }

  update(dt: number, running: boolean): void {
    if (!running) return;
    const jib = this.crane.nodes.get('jib');
    const trolley = this.crane.nodes.get('trolley');
    const hook = this.crane.nodes.get('hook');
    const cable = this.crane.nodes.get('cable');
    const diff = Math.atan2(Math.sin(this.slewTarget - this.slew), Math.cos(this.slewTarget - this.slew));
    if (Math.abs(diff) < 0.02) this.slewTarget = this.slew + (Math.random() - 0.3) * 2.2;
    this.slew += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.25);
    if (jib) jib.rotation.y = this.slew;
    this.trolleyT += dt * 0.07;
    const tt = 0.5 + 0.5 * Math.sin(this.trolleyT * Math.PI * 2);
    if (trolley) trolley.position.x = 2 + tt * 5.5;
    const len = 1 + 3 * (0.5 + 0.5 * Math.sin(this.trolleyT * 3.3));
    if (cable) cable.scale.y = len;
    if (hook) hook.position.y = -len;
  }

  dispose(): void {
    for (const bp of this.blueprints) bp.removeFromParent();
    this.blueprints.length = 0;
    this.blueprintMat.dispose();
    this.modelMats.dispose();
    this.scaffoldMats.dispose();
    this.group.removeFromParent();
  }
}
