// Procedural model builder. Models are authored with simple primitives in a local frame
// (x ∈ [-w/2, w/2], z ∈ [-d/2, d/2], y = 0 at pad level, 1 unit = 1 block) and baked into one merged
// geometry per (node, material bucket, detail flag). Paint, bare metal, rough and dark-glass parts
// share one "solid" bucket (per-vertex roughness/metalness), so most nodes are a single draw call. Named nodes become separately transformable
// Object3Ds for animation (pumpjack beams, rotors, travelling blocks ...).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MatKind } from '../materials';
import { beamProto, boxProto, cylProto, domeProto, floorProto, planeProto, prismProto, sphereProto, torusProto, wedgeProto } from './prims';

export type V3 = readonly [number, number, number];

export interface Attachment {
  type: 'flag' | 'sign';
  /** Transform relative to the owning node. */
  matrix: THREE.Matrix4;
}

export interface AnchorDef {
  /** Anchor kind understood by the FX manager / layer ('flare', 'smoke', 'steam', 'exhaust', 'light', 'helideck', 'berth', 'floor', 'bay' ...). */
  kind: string;
  /** Owning node name ('' = model root). */
  node: string;
  /** Position relative to the owning node. */
  pos: THREE.Vector3;
  /** Kind-specific parameters (size, colour, direction ...). */
  data: Record<string, number>;
}

export interface TemplateMesh {
  geometry: THREE.BufferGeometry;
  kind: MatKind;
  detail: boolean;
  shadow: boolean;
}

export interface TemplateNode {
  name: string;
  matrix: THREE.Matrix4;
  meshes: TemplateMesh[];
  attachments: Attachment[];
  children: TemplateNode[];
}

export interface ModelTemplate {
  root: TemplateNode;
  anchors: AnchorDef[];
  /** Local-space bounds of all geometry. */
  bounds: THREE.Box3;
  /** Number of draw calls when fully detailed (diagnostics). */
  drawCalls: number;
  triangles: number;
}

interface Bucket {
  kind: MatKind;
  detail: boolean;
  shadow: boolean;
  geos: THREE.BufferGeometry[];
}

class BNode {
  readonly buckets = new Map<string, Bucket>();
  readonly children: BNode[] = [];
  readonly attachments: Attachment[] = [];
  constructor(readonly name: string, readonly matrix: THREE.Matrix4) {}
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

/** Authoring kinds merged into the 'solid' bucket: [roughness, metalness]. */
const SURFACE: Partial<Record<MatKind, readonly [number, number]>> = {
  paint: [0.72, 0.08],
  metal: [0.4, 0.55],
  rough: [0.95, 0],
  glassDark: [0.14, 0.45],
};

export class Builder {
  private node: BNode;
  private readonly rootNode: BNode;
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private detailDepth = 0;
  private readonly anchors: AnchorDef[] = [];
  private readonly nodeWorld = new Map<BNode, THREE.Matrix4>();
  private readonly allNodes = new Map<string, BNode>();
  /** Company accent colour for this build (hex). */
  readonly company: number;

  constructor(company: number | string = 0xff8a1f) {
    this.company = typeof company === 'string' ? new THREE.Color(company).getHex() : company;
    this.rootNode = new BNode('', new THREE.Matrix4());
    this.node = this.rootNode;
    this.nodeWorld.set(this.rootNode, new THREE.Matrix4());
  }

  // ---- transform stack ---------------------------------------------------------------------------
  private get cur(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }
  push(): this {
    this.stack.push(this.cur.clone());
    return this;
  }
  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  translate(x: number, y: number, z: number): this {
    this.cur.multiply(_m.makeTranslation(x, y, z));
    return this;
  }
  rotY(a: number): this {
    this.cur.multiply(_m.makeRotationY(a));
    return this;
  }
  rotX(a: number): this {
    this.cur.multiply(_m.makeRotationX(a));
    return this;
  }
  rotZ(a: number): this {
    this.cur.multiply(_m.makeRotationZ(a));
    return this;
  }
  scale(x: number, y = x, z = x): this {
    this.cur.multiply(_m.makeScale(x, y, z));
    return this;
  }
  /** Run `fn` in a frame translated to (x,y,z) and rotated by `ry` around Y. */
  at(x: number, y: number, z: number, ry: number, fn: () => void): this {
    this.push().translate(x, y, z);
    if (ry) this.rotY(ry);
    fn();
    return this.pop();
  }
  /** Run `fn` in a frame at p0 whose +Y axis points toward p1; fn receives the distance. */
  orient(p0: V3, p1: V3, fn: (len: number) => void): this {
    _v.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _v.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(_up, _v.divideScalar(len));
    this.push();
    this.cur.multiply(_m.compose(_v2.set(p0[0], p0[1], p0[2]), _q, _s.set(1, 1, 1)));
    fn(len);
    return this.pop();
  }
  /** Parts added inside fn go to the "detail" layer (hidden at distance, no shadows). */
  detail(fn: () => void): this {
    this.detailDepth++;
    fn();
    this.detailDepth--;
    return this;
  }

  /** Create a named, separately transformable node pivoting at (x,y,z) in the current frame. */
  group(name: string, x: number, y: number, z: number, fn: () => void): this {
    const pivot = this.cur.clone().multiply(_m.makeTranslation(x, y, z));
    const n = new BNode(name, pivot);
    this.node.children.push(n);
    this.allNodes.set(name, n);
    this.nodeWorld.set(n, this.nodeWorld.get(this.node)!.clone().multiply(pivot));
    const prevNode = this.node;
    const prevStack = this.stack;
    this.node = n;
    this.stack = [new THREE.Matrix4()];
    fn();
    this.node = prevNode;
    this.stack = prevStack;
    return this;
  }

  // ---- core part insertion -----------------------------------------------------------------------
  private add(proto: THREE.BufferGeometry, local: THREE.Matrix4, color: number, kind: MatKind): void {
    const detail = this.detailDepth > 0;
    const surf = SURFACE[kind];
    const bucketKind: MatKind = surf ? 'solid' : kind;
    const shadow = !detail && (bucketKind === 'solid' || bucketKind === 'glass');
    const key = `${bucketKind}|${detail ? 1 : 0}`;
    let b = this.node.buckets.get(key);
    if (!b) {
      b = { kind: bucketKind, detail, shadow, geos: [] };
      this.node.buckets.set(key, b);
    }
    const g = proto.clone();
    g.applyMatrix4(_m2.multiplyMatrices(this.cur, local));
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    _col.setHex(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _col.r;
      arr[i * 3 + 1] = _col.g;
      arr[i * 3 + 2] = _col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (surf) {
      const sa = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        sa[i * 2] = surf[0];
        sa[i * 2 + 1] = surf[1];
      }
      g.setAttribute('surf', new THREE.BufferAttribute(sa, 2));
    }
    b.geos.push(g);
  }

  // ---- primitives --------------------------------------------------------------------------------
  /** Box centred at (cx,cy,cz) with size (sx,sy,sz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, kind: MatKind = 'paint'): this {
    _m.compose(_v.set(cx, cy, cz), _q.identity(), _s.set(sx, sy, sz));
    this.add(boxProto(), _m.clone(), color, kind);
    return this;
  }
  /** Box from min corner to max corner. */
  slab(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, kind: MatKind = 'paint'): this {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color, kind);
  }
  /** Vertical cylinder standing on (x, y0, z). */
  cyl(x: number, y0: number, z: number, r: number, h: number, color: number, kind: MatKind = 'paint', seg = 12, rTop = r): this {
    _m.compose(_v.set(x, y0, z), _q.identity(), _s.set(r, h, r));
    this.add(cylProto(seg, r > 0 ? rTop / r : 1), _m.clone(), color, kind);
    return this;
  }
  /** Cylinder between two points (pipes, braces, arms). */
  pipe(p0: V3, p1: V3, r: number, color: number, kind: MatKind = 'metal', seg = 8, r1 = r): this {
    _v.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _v.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(_up, _v.divideScalar(len));
    _m.compose(_v2.set(p0[0], p0[1], p0[2]), _q, _s.set(r, len, r));
    this.add(cylProto(seg, r > 0 ? r1 / r : 1), _m.clone(), color, kind);
    return this;
  }
  /** Square-section beam between two points. */
  beam(p0: V3, p1: V3, t: number, color: number, kind: MatKind = 'paint', t2 = t): this {
    _v.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _v.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(_up, _v.divideScalar(len));
    _m.compose(_v2.set(p0[0], p0[1], p0[2]), _q, _s.set(t, len, t2));
    this.add(beamProto(), _m.clone(), color, kind);
    return this;
  }
  /** Horizontal cylinder along X centred at (cx,cy,cz). */
  cylX(cx: number, cy: number, cz: number, r: number, len: number, color: number, kind: MatKind = 'paint', seg = 12): this {
    return this.pipe([cx - len / 2, cy, cz], [cx + len / 2, cy, cz], r, color, kind, seg);
  }
  /** Horizontal cylinder along Z centred at (cx,cy,cz). */
  cylZ(cx: number, cy: number, cz: number, r: number, len: number, color: number, kind: MatKind = 'paint', seg = 12): this {
    return this.pipe([cx, cy, cz - len / 2], [cx, cy, cz + len / 2], r, color, kind, seg);
  }
  sphere(x: number, y: number, z: number, r: number, color: number, kind: MatKind = 'paint', seg = 14, sy = r): this {
    _m.compose(_v.set(x, y, z), _q.identity(), _s.set(r, sy, r));
    this.add(sphereProto(seg), _m.clone(), color, kind);
    return this;
  }
  /** Hemisphere cap sitting on (x,y,z), height `h` (defaults to r). */
  dome(x: number, y: number, z: number, r: number, color: number, kind: MatKind = 'paint', seg = 14, h = r): this {
    _m.compose(_v.set(x, y, z), _q.identity(), _s.set(r, h, r));
    this.add(domeProto(seg), _m.clone(), color, kind);
    return this;
  }
  cone(x: number, y0: number, z: number, r: number, h: number, color: number, kind: MatKind = 'paint', seg = 12): this {
    return this.cyl(x, y0, z, r, h, color, kind, seg, 0.0001);
  }
  /** Ring around the vertical axis at height y (tank bands, handwheels when rotated). */
  ring(x: number, y: number, z: number, R: number, tube: number, color: number, kind: MatKind = 'metal', seg = 16): this {
    _m.compose(_v.set(x, y, z), _q.identity(), _s.set(R, R, R));
    this.add(torusProto(tube / R, seg), _m.clone(), color, kind);
    return this;
  }
  /** Handwheel facing along `axis` ('x' | 'z'). */
  wheel(x: number, y: number, z: number, R: number, axis: 'x' | 'z', color: number): this {
    this.push().translate(x, y, z);
    if (axis === 'x') this.rotZ(Math.PI / 2);
    else this.rotX(Math.PI / 2);
    this.ring(0, 0, 0, R, R * 0.16, color, 'paint', 10);
    this.box(0, 0, 0, R * 1.8, R * 0.12, R * 0.12, color, 'paint');
    this.box(0, 0, 0, R * 0.12, R * 0.12, R * 1.8, color, 'paint');
    return this.pop();
  }
  /** Gable roof: base centred at (cx,y0,cz), width sx (across ridge), height sy, length sz (along ridge, z). */
  gable(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: number, kind: MatKind = 'paint'): this {
    _m.compose(_v.set(cx, y0, cz), _q.identity(), _s.set(sx, sy, sz));
    this.add(prismProto(), _m.clone(), color, kind);
    return this;
  }
  /** Ramp: tall side at -x. */
  wedge(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: number, kind: MatKind = 'paint'): this {
    _m.compose(_v.set(cx, y0, cz), _q.identity(), _s.set(sx, sy, sz));
    this.add(wedgeProto(), _m.clone(), color, kind);
    return this;
  }
  /** Vertical quad facing +Z (in current frame) centred at (cx,cy,cz). */
  quad(cx: number, cy: number, cz: number, w: number, h: number, color: number, kind: MatKind): this {
    _m.compose(_v.set(cx, cy, cz), _q.identity(), _s.set(w, h, 1));
    this.add(planeProto(), _m.clone(), color, kind);
    return this;
  }
  /** Horizontal quad facing +Y centred at (cx,y,cz). */
  floor(cx: number, y: number, cz: number, w: number, d: number, color: number, kind: MatKind): this {
    _m.compose(_v.set(cx, y, cz), _q.identity(), _s.set(w, 1, d));
    this.add(floorProto(), _m.clone(), color, kind);
    return this;
  }

  // ---- attachments & anchors ---------------------------------------------------------------------
  /** Waving company flag on its own pole top at (x,y,z); flies toward +x of the current frame. */
  flag(x: number, y: number, z: number, w = 1.2, h = 0.75): this {
    const m = this.cur.clone().multiply(_m.compose(_v.set(x + w / 2, y - h / 2, z), _q.identity(), _s.set(w, h, 1)));
    this.node.attachments.push({ type: 'flag', matrix: m });
    return this;
  }
  /** Company sign board facing +z of the current frame, centred at (x,y,z). */
  sign(x: number, y: number, z: number, w: number, h: number): this {
    const m = this.cur.clone().multiply(_m.compose(_v.set(x, y, z), _q.identity(), _s.set(w, h, 1)));
    this.node.attachments.push({ type: 'sign', matrix: m });
    return this;
  }
  /** Record an anchor (FX emitter, light, helideck ...) at (x,y,z) in the current frame. */
  anchor(kind: string, x: number, y: number, z: number, data: Record<string, number> = {}): this {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(this.cur);
    this.anchors.push({ kind, node: this.node.name, pos: p, data });
    return this;
  }

  /** Current-frame point → model-root coordinates (for anchors that need root space). */
  toRoot(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.cur).applyMatrix4(this.nodeWorld.get(this.node)!);
  }

  // ---- bake --------------------------------------------------------------------------------------
  build(): ModelTemplate {
    const bounds = new THREE.Box3();
    let drawCalls = 0;
    let triangles = 0;
    const bake = (n: BNode, parentWorld: THREE.Matrix4): TemplateNode => {
      const world = parentWorld.clone().multiply(n.matrix);
      const meshes: TemplateMesh[] = [];
      for (const b of n.buckets.values()) {
        if (b.geos.length === 0) continue;
        const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
        if (b.geos.length > 1) for (const g of b.geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const bb = merged.boundingBox!.clone().applyMatrix4(world);
        bounds.union(bb);
        drawCalls++;
        triangles += (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
        meshes.push({ geometry: merged, kind: b.kind, detail: b.detail, shadow: b.shadow });
      }
      for (const a of n.attachments) {
        const p = new THREE.Vector3().setFromMatrixPosition(a.matrix).applyMatrix4(world);
        bounds.expandByPoint(p);
      }
      return { name: n.name, matrix: n.matrix, meshes, attachments: n.attachments, children: n.children.map((c) => bake(c, world)) };
    };
    const root = bake(this.rootNode, new THREE.Matrix4());
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    return { root, anchors: this.anchors, bounds, drawCalls, triangles };
  }
}
