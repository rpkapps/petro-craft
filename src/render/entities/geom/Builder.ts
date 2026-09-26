// Procedural model builder. Models are authored with simple primitives in a local frame
// (x ∈ [-w/2, w/2], z ∈ [-d/2, d/2], y = 0 at pad level, 1 unit = 1 block) and baked into one merged
// geometry per (node, material bucket, detail flag). Paint, bare metal, rough and dark-glass parts
// share one "solid" bucket (per-vertex roughness/metalness), so most nodes are a single draw call. Named nodes become separately transformable
// Object3Ds for animation (pumpjack beams, rotors, travelling blocks ...).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MatKind } from '../materials';
import { C } from '../palette';
import { SURF } from '../textures/texgen';
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

const ROUGH_CLASS = new Map<number, number>([
  [C.RUBBER, SURF.RUBBER],
  [C.BLACK, SURF.RUBBER],
  [C.WOOD, SURF.WOOD],
  [0x5b3a33, SURF.WOOD],
  [0x6b4e2e, SURF.WOOD],
  [C.GRAVEL, SURF.GRAVEL],
  [C.ASPHALT, SURF.CONCRETE],
  [0x7a6f5c, SURF.GRAVEL],
]);
const METAL_CLASS = new Map<number, number>([
  [C.INSULATION, SURF.INSULATION],
  [C.GALV, SURF.GALV],
  [C.PANEL, SURF.GLASS],
]);

/** Textured-quality surface class of a part (stored in the 'surf' attribute's third component). */
function surfaceClass(kind: MatKind, color: number, override: number, paintClass: number): number {
  if (kind === 'glassDark') return SURF.GLASS;
  if (kind === 'rough') {
    const c = ROUGH_CLASS.get(color);
    if (c !== undefined) return c;
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    return r + g + b < 90 ? SURF.RUBBER : SURF.CONCRETE;
  }
  if (kind === 'metal') return METAL_CLASS.get(color) ?? (override >= 0 ? override : SURF.STEEL);
  if (color === C.HAZARD) return SURF.HAZARD;
  if (color === C.INSULATION) return SURF.INSULATION;
  return override >= 0 ? override : paintClass;
}

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
  /** Surface class for 'paint' parts outside surface() scopes (vehicles use glossy AUTO paint). */
  paintClass: number = SURF.PAINT;
  private surfOverride = -1;

  /**
   * @param fine Extra geometric detail for the 'ultra' texture quality (chamfered box edges ...).
   */
  constructor(company: number | string = 0xff8a1f, readonly fine = false) {
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

  /** Parts added inside fn use surface class `cls` (paint/metal parts; hazard, galvanized & insulation keep theirs). */
  surface(cls: number, fn: () => void): this {
    const prev = this.surfOverride;
    this.surfOverride = cls;
    fn();
    this.surfOverride = prev;
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
  private add(proto: THREE.BufferGeometry, local: THREE.Matrix4, color: number, kind: MatKind, owned = false): void {
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
    const g = owned ? proto : proto.clone();
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
      // roughness, metalness, textured surface class, height above the model origin (ground grime)
      const cls = surfaceClass(kind, color, this.surfOverride, this.paintClass);
      const nw = this.nodeWorld.get(this.node)!.elements;
      const pa = g.attributes.position.array as ArrayLike<number>;
      const sa = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        sa[i * 4] = surf[0];
        sa[i * 4 + 1] = surf[1];
        sa[i * 4 + 2] = cls;
        sa[i * 4 + 3] = nw[1] * pa[i * 3] + nw[5] * pa[i * 3 + 1] + nw[9] * pa[i * 3 + 2] + nw[13];
      }
      g.setAttribute('surf', new THREE.BufferAttribute(sa, 4));
    }
    b.geos.push(g);
  }

  // ---- primitives --------------------------------------------------------------------------------
  /** Box centred at (cx,cy,cz) with size (sx,sy,sz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, kind: MatKind = 'paint'): this {
    const m = Math.min(Math.abs(sx), Math.abs(sy), Math.abs(sz));
    if (this.fine && this.detailDepth === 0 && m >= 0.1 && SURFACE[kind]) {
      // ultra: chamfered edges catch the light like real fabricated steel & cast concrete
      const r = Math.min(0.045, m * 0.16);
      this.add(chamferBox(Math.abs(sx) / 2, Math.abs(sy) / 2, Math.abs(sz) / 2, r), _m.makeTranslation(cx, cy, cz).clone(), color, kind, true);
      return this;
    }
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
    if (this.fine && this.detailDepth === 0 && Math.min(t, t2, len) >= 0.1 && SURFACE[kind]) {
      const r = Math.min(0.045, Math.min(t, t2, len) * 0.16);
      _m.compose(_v2.set(p0[0], p0[1], p0[2]), _q, _s.set(1, 1, 1)).multiply(_m2.makeTranslation(0, len / 2, 0));
      this.add(chamferBox(t / 2, len / 2, t2 / 2, r), _m.clone(), color, kind, true);
      return this;
    }
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

/**
 * Box with 45° chamfers of width r on all 12 edges (half sizes a, b, c): 6 faces, 12 edge strips and
 * 8 corner triangles, flat-shaded, indexed, with the same attribute set as the primitive prototypes.
 */
function chamferBox(a: number, b: number, c: number, r: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const h = [a, b, c];
  const poly = (pts: number[][]) => {
    // flat normal, oriented outward (the solid is convex and centred on the origin)
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = pts.reduce((s, p) => s + p[0], 0), cy = pts.reduce((s, p) => s + p[1], 0), cz = pts.reduce((s, p) => s + p[2], 0);
    const flip = nx * cx + ny * cy + nz * cz < 0;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      if (flip) idx.push(base, base + i + 1, base + i);
      else idx.push(base, base + i, base + i + 1);
    }
  };
  const P = (i: number, si: number, vi: number, j: number, sj: number, vj: number, k: number, sk: number, vk: number) => {
    const p = [0, 0, 0];
    p[i] = si * vi;
    p[j] = sj * vj;
    p[k] = sk * vk;
    return p;
  };
  // faces
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    for (const s of [-1, 1])
      poly([P(i, s, h[i], j, -1, h[j] - r, k, -1, h[k] - r), P(i, s, h[i], j, 1, h[j] - r, k, -1, h[k] - r), P(i, s, h[i], j, 1, h[j] - r, k, 1, h[k] - r), P(i, s, h[i], j, -1, h[j] - r, k, 1, h[k] - r)]);
  }
  // edge strips between faces i and j, running along k
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    for (const si of [-1, 1])
      for (const sj of [-1, 1])
        poly([
          P(i, si, h[i], j, sj, h[j] - r, k, -1, h[k] - r),
          P(i, si, h[i] - r, j, sj, h[j], k, -1, h[k] - r),
          P(i, si, h[i] - r, j, sj, h[j], k, 1, h[k] - r),
          P(i, si, h[i], j, sj, h[j] - r, k, 1, h[k] - r),
        ]);
  }
  // corners
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        poly([
          [sx * a, sy * (b - r), sz * (c - r)],
          [sx * (a - r), sy * b, sz * (c - r)],
          [sx * (a - r), sy * (b - r), sz * c],
        ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}
