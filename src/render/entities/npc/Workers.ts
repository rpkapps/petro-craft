// Blocky NPC workers (hard hats, hi-vis vests in the company colour) walking and working around
// staffed, active buildings. Rendered with one InstancedMesh per body part (5 draw calls for all
// workers); count per building ∝ its assigned crew, total capped, nearest buildings first.
// On land they path around building footprints, water, trees and steep steps over a local 1-block
// grid; on offshore structures they patrol the deck walkways declared by the model ('walk' anchors).
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import { SEA_LEVEL } from '../../../core/constants';
import type { BuildingState, GameContext } from '../../../core/types';
import { BUILDINGS } from '../../../content/buildings';
import type { BuildingView } from '../BuildingView';
import { MAX_WORKERS } from '../config';
import { Builder } from '../geom/Builder';
import type { MaterialLib } from '../materials';
import { C, HAT_COLORS } from '../palette';
import type { Terrain } from '../vehicles/terrain';

const VISIBLE_DIST = 110;
const PER_BUILDING = 6;
const RING = 7;

type P2 = [number, number];

interface Worker {
  buildingId: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  phase: number;
  speed: number;
  state: 'walk' | 'idle' | 'work';
  timer: number;
  /** Remaining waypoints. */
  path: P2[];
  /** Deck walkway (offshore): polyline index & arc position; null on land. */
  deck: { line: number; s: number } | null;
  hat: THREE.Color;
  skin: THREE.Color;
}

interface Walkway {
  pts: THREE.Vector3[];
  cum: number[];
  length: number;
  loop: boolean;
}

/** Local walkability grid around one building (1-block cells). */
interface LocalGrid {
  key: string;
  x0: number;
  z0: number;
  w: number;
  d: number;
  blocked: Uint8Array;
  h: Float32Array;
}

function partGeometry(company: number, build: (b: Builder) => void): THREE.BufferGeometry {
  const b = new Builder(company);
  build(b);
  const t = b.build();
  return t.root.meshes[0].geometry;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

type PartName = 'torso' | 'head' | 'hat' | 'legs' | 'arms';

export class WorkerCrowd {
  readonly group = new THREE.Group();
  private parts!: Record<PartName, THREE.InstancedMesh>;
  private geos: THREE.BufferGeometry[] = [];
  private readonly workers: Worker[] = [];
  private readonly grids = new Map<string, LocalGrid>();
  private readonly walkways = new Map<string, { key: string; ways: Walkway[] }>();
  private allocTimer = 0;
  private builtColor = '';
  private structVersion = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly host: RenderHost,
    private readonly ctx: GameContext,
    private readonly lib: MaterialLib,
    private readonly terrain: Terrain,
    private readonly views: Map<string, BuildingView>,
  ) {
    this.group.name = 'workers';
    this.buildParts();
    const bump = () => {
      this.structVersion++;
      this.grids.clear();
    };
    this.offs.push(ctx.bus.on('building:placed', bump), ctx.bus.on('building:removed', bump));
  }

  /** (Re)build the body-part meshes with the vest in the current company colour. */
  private buildParts(): void {
    const old = this.parts;
    if (old) for (const m of Object.values(old)) m.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.builtColor = this.lib.company;
    const company = new THREE.Color(this.lib.company).getHex();
    const torso = partGeometry(company, (b) => {
      b.box(0, 0.3, 0, 0.46, 0.6, 0.26, company, 'paint');
      b.box(0, 0.22, 0, 0.47, 0.06, 0.27, 0xf4f1d0, 'paint');
      b.box(0, 0.42, 0, 0.47, 0.06, 0.27, 0xf4f1d0, 'paint');
      b.box(0, -0.02, 0, 0.44, 0.08, 0.25, 0x2a2e36, 'paint');
    });
    const head = partGeometry(company, (b) => b.box(0, 0.14, 0, 0.26, 0.28, 0.26, 0xffffff, 'paint'));
    const hat = partGeometry(company, (b) => {
      b.box(0, 0.06, 0, 0.3, 0.14, 0.3, 0xffffff, 'paint');
      b.box(0.04, 0.0, 0, 0.4, 0.03, 0.34, 0xffffff, 'paint');
    });
    const leg = partGeometry(company, (b) => {
      b.box(0, -0.34, 0, 0.17, 0.68, 0.19, 0x2b3a55, 'paint');
      b.box(0.03, -0.72, 0, 0.23, 0.08, 0.2, 0x3a2a1c, 'paint');
    });
    const arm = partGeometry(company, (b) => {
      b.box(0, -0.25, 0, 0.13, 0.52, 0.14, company, 'paint');
      b.box(0, -0.56, 0, 0.11, 0.1, 0.12, C.SKIN, 'paint');
    });
    this.geos = [torso, head, hat, leg, arm];
    const mat = this.lib.get('solid');
    const mk = (g: THREE.BufferGeometry, n: number, colored: boolean) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = false;
      m.count = 0;
      if (colored) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.group.add(m);
      return m;
    };
    this.parts = {
      torso: mk(torso, MAX_WORKERS, false),
      head: mk(head, MAX_WORKERS, true),
      hat: mk(hat, MAX_WORKERS, true),
      legs: mk(leg, MAX_WORKERS * 2, false),
      arms: mk(arm, MAX_WORKERS * 2, false),
    };
    if (old) for (const m of Object.values(old)) m.dispose();
  }

  // ---- allocation ---------------------------------------------------------------------------------------

  /** Decide how many workers each nearby staffed building shows. */
  private allocate(): void {
    const s = this.ctx.state;
    const cam = this.host.camera.position;
    const cands: { b: BuildingState; d: number; n: number }[] = [];
    for (const v of this.views.values()) {
      if (v.status !== 'active' || v.hidden) continue;
      const b = s.buildings[v.id];
      if (!b || b.workers.length === 0) continue;
      if (this.isOffshore(v) && this.ways(v).length === 0) continue;
      const d = cam.distanceTo(v.center);
      if (d > VISIBLE_DIST + v.radius) continue;
      cands.push({ b, d, n: Math.min(PER_BUILDING, Math.ceil(b.workers.length * 0.75)) });
    }
    cands.sort((a, b) => a.d - b.d);
    const want = new Map<string, number>();
    let total = 0;
    for (const c of cands) {
      const n = Math.min(c.n, MAX_WORKERS - total);
      if (n <= 0) break;
      want.set(c.b.id, n);
      total += n;
    }
    const have = new Map<string, number>();
    for (let i = this.workers.length - 1; i >= 0; i--) {
      const w = this.workers[i];
      const h = (have.get(w.buildingId) ?? 0) + 1;
      if (h > (want.get(w.buildingId) ?? 0)) this.workers.splice(i, 1);
      else have.set(w.buildingId, h);
    }
    for (const [id, n] of want) {
      const b = s.buildings[id];
      const v = this.views.get(id);
      if (!v) continue;
      for (let k = have.get(id) ?? 0; k < n; k++) {
        const w = this.spawn(b, v);
        if (w) this.workers.push(w);
      }
    }
    // forget grids of buildings nobody works at any more
    for (const id of this.grids.keys()) if (!want.has(id)) this.grids.delete(id);
    for (const id of this.walkways.keys()) if (!this.views.has(id)) this.walkways.delete(id);
  }

  private isOffshore(v: BuildingView): boolean {
    return BUILDINGS[v.type]?.placement === 'water';
  }

  /** Deck walkways of an offshore model (world space, cached per placement). */
  private ways(v: BuildingView): Walkway[] {
    const b = this.ctx.state.buildings[v.id];
    const key = b ? `${b.x},${b.y},${b.z},${b.rotation},${v.variant}` : '';
    const c = this.walkways.get(v.id);
    if (c && c.key === key) return c.ways;
    const byLine = new Map<number, { i: number; p: THREE.Vector3; loop: boolean }[]>();
    for (const a of v.anchors) {
      if (a.def.kind !== 'walk') continue;
      const line = a.def.data.line ?? 0;
      let arr = byLine.get(line);
      if (!arr) byLine.set(line, (arr = []));
      arr.push({ i: a.def.data.i ?? 0, p: a.pos.clone(), loop: a.def.data.loop === 1 });
    }
    const ways: Walkway[] = [];
    for (const arr of byLine.values()) {
      arr.sort((x, y) => x.i - y.i);
      const pts = arr.map((x) => x.p);
      const loop = arr.some((x) => x.loop);
      if (loop) pts.push(pts[0].clone());
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      if (pts.length >= 2) ways.push({ pts, cum, length: cum[cum.length - 1], loop });
    }
    this.walkways.set(v.id, { key, ways });
    return ways;
  }

  private wayPoint(w: Walkway, s: number): THREE.Vector3 {
    const t = Math.max(0, Math.min(w.length, s));
    let i = 1;
    while (i < w.cum.length - 1 && w.cum[i] < t) i++;
    const a = w.pts[i - 1];
    const b = w.pts[i];
    const L = Math.max(1e-6, w.cum[i] - w.cum[i - 1]);
    return _p.copy(a).lerp(b, (t - w.cum[i - 1]) / L);
  }

  private spawn(b: BuildingState, v: BuildingView): Worker | null {
    const skinTones = [C.SKIN, C.SKIN_DARK, 0xc68c64, 0xe8b894];
    const base = {
      buildingId: b.id,
      yaw: Math.random() * Math.PI * 2,
      phase: Math.random() * 10,
      speed: 1.1 + Math.random() * 0.5,
      state: 'idle' as const,
      timer: Math.random() * 3,
      path: [] as P2[],
      hat: new THREE.Color(HAT_COLORS[Math.floor(Math.random() * HAT_COLORS.length)]),
      skin: new THREE.Color(skinTones[Math.floor(Math.random() * skinTones.length)]),
    };
    if (this.isOffshore(v)) {
      const ways = this.ways(v);
      if (!ways.length) return null;
      const line = Math.floor(Math.random() * ways.length);
      const s = Math.random() * ways[line].length;
      const p = this.wayPoint(ways[line], s);
      return { ...base, x: p.x, z: p.z, y: p.y, deck: { line, s } };
    }
    const g = this.grid(b);
    const pt = this.ringPoint(b, g);
    if (!pt) return null;
    return { ...base, x: pt[0], z: pt[1], y: this.terrain.ground(pt[0], pt[1]), deck: null };
  }

  // ---- local land grid ----------------------------------------------------------------------------------

  private grid(b: BuildingState): LocalGrid {
    const key = `${b.x},${b.z},${b.size[0]},${b.size[1]},${this.structVersion}`;
    const c = this.grids.get(b.id);
    if (c && c.key === key) return c;
    const world = this.ctx.world;
    const x0 = Math.max(0, Math.floor(b.x) - RING);
    const z0 = Math.max(0, Math.floor(b.z) - RING);
    const x1 = Math.min(world.sizeX, Math.ceil(b.x + b.size[0]) + RING);
    const z1 = Math.min(world.sizeZ, Math.ceil(b.z + b.size[1]) + RING);
    const w = Math.max(1, x1 - x0);
    const d = Math.max(1, z1 - z0);
    const blocked = new Uint8Array(w * d);
    const h = new Float32Array(w * d);
    const probe = { trunk: false };
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const i = x + z * w;
        h[i] = this.terrain.probe(x0 + x, z0 + z, probe);
        if (probe.trunk || (this.ctx.geology.waterDepth(x0 + x, z0 + z) > 0.3 && h[i] <= SEA_LEVEL)) blocked[i] = 1;
      }
    // building footprints overlapping the window (with a little clearance)
    const bs = this.ctx.state.buildings;
    for (const id in bs) {
      const o = bs[id];
      if (o.x > x1 || o.z > z1 || o.x + o.size[0] < x0 || o.z + o.size[1] < z0) continue;
      const pad = 0.25;
      const cx0 = Math.max(0, Math.floor(o.x - pad) - x0);
      const cx1 = Math.min(w - 1, Math.ceil(o.x + o.size[0] + pad) - 1 - x0);
      const cz0 = Math.max(0, Math.floor(o.z - pad) - z0);
      const cz1 = Math.min(d - 1, Math.ceil(o.z + o.size[1] + pad) - 1 - z0);
      for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) blocked[x + z * w] = 1;
    }
    const g: LocalGrid = { key, x0, z0, w, d, blocked, h };
    this.grids.set(b.id, g);
    return g;
  }

  private cellAt(g: LocalGrid, x: number, z: number): number {
    const cx = Math.floor(x) - g.x0;
    const cz = Math.floor(z) - g.z0;
    if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.d) return -1;
    return cx + cz * g.w;
  }

  private free(g: LocalGrid, i: number): boolean {
    return i >= 0 && !g.blocked[i];
  }

  /** Random walkable point in a ring just outside the footprint. */
  private ringPoint(b: BuildingState, g: LocalGrid): P2 | null {
    const [w, d] = b.size;
    for (let tries = 0; tries < 24; tries++) {
      const m = 0.8 + Math.random() * 1.8;
      const side = Math.floor(Math.random() * 4);
      const t = Math.random();
      let x: number;
      let z: number;
      if (side === 0) [x, z] = [b.x - m + t * (w + 2 * m), b.z - m];
      else if (side === 1) [x, z] = [b.x - m + t * (w + 2 * m), b.z + d + m];
      else if (side === 2) [x, z] = [b.x - m, b.z - m + t * (d + 2 * m)];
      else [x, z] = [b.x + w + m, b.z - m + t * (d + 2 * m)];
      if (this.free(g, this.cellAt(g, x, z))) return [x, z];
    }
    return null;
  }

  /** A* over the local grid; returns string-pulled waypoints (excluding the start). */
  private findPath(g: LocalGrid, sx: number, sz: number, tx: number, tz: number): P2[] | null {
    const start = this.cellAt(g, sx, sz);
    const goal = this.cellAt(g, tx, tz);
    if (start < 0 || goal < 0 || g.blocked[goal]) return null;
    if (this.lineFree(g, sx, sz, tx, tz)) return [[tx, tz]];
    const n = g.w * g.d;
    const cost = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const open: number[] = [start];
    const gx = goal % g.w;
    const gz = (goal - gx) / g.w;
    const h = (i: number) => {
      const x = i % g.w;
      return Math.hypot(x - gx, (i - x) / g.w - gz);
    };
    cost[start] = 0;
    let found = false;
    let iter = 0;
    while (open.length && iter++ < 4000) {
      // small grids: linear min scan is fine
      let bi = 0;
      let bf = Infinity;
      for (let k = 0; k < open.length; k++) {
        const f = cost[open[k]] + h(open[k]);
        if (f < bf) {
          bf = f;
          bi = k;
        }
      }
      const a = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (a === goal) {
        found = true;
        break;
      }
      const ax = a % g.w;
      const az = (a - ax) / g.w;
      for (let k = 0; k < 8; k++) {
        const bx = ax + DX[k];
        const bz = az + DZ[k];
        if (bx < 0 || bz < 0 || bx >= g.w || bz >= g.d) continue;
        const b = bx + bz * g.w;
        if (g.blocked[b] && b !== goal) continue;
        const diag = k >= 4;
        if (diag && (g.blocked[bx + az * g.w] || g.blocked[ax + bz * g.w])) continue;
        const dh = Math.abs(g.h[b] - g.h[a]);
        if (dh > 1.1) continue;
        const c = cost[a] + (diag ? Math.SQRT2 : 1) * (1 + dh * 0.5);
        if (c < cost[b]) {
          if (cost[b] === Infinity) open.push(b);
          cost[b] = c;
          parent[b] = a;
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1 && c !== start; c = parent[c]) cells.push(c);
    cells.reverse();
    const pts: P2[] = cells.map((c) => [g.x0 + (c % g.w) + 0.5, g.z0 + Math.floor(c / g.w) + 0.5]);
    pts[pts.length - 1] = [tx, tz];
    // string-pull
    const out: P2[] = [];
    let cx = sx;
    let cz = sz;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineFree(g, cx, cz, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      [cx, cz] = pts[j];
      i = j + 1;
    }
    return out;
  }

  private lineFree(g: LocalGrid, x0: number, z0: number, x1: number, z1: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len * 3));
    let prev = this.cellAt(g, x0, z0);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const c = this.cellAt(g, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (c === prev) continue;
      if (!this.free(g, c)) return false;
      if (prev >= 0 && Math.abs(g.h[c] - g.h[prev]) > 1.1) return false;
      prev = c;
    }
    return true;
  }

  // ---- per frame ----------------------------------------------------------------------------------------

  update(dt: number, _t: number): void {
    if (this.lib.company !== this.builtColor) this.buildParts();
    this.allocTimer -= dt;
    if (this.allocTimer <= 0) {
      this.allocTimer = 1;
      this.allocate();
    }
    const s = this.ctx.state;
    const P = this.parts;
    let n = 0;
    for (const w of this.workers) {
      const b = s.buildings[w.buildingId];
      if (!b) continue;
      if (dt > 0) this.think(w, b, dt);
      const walking = w.state === 'walk';
      const swing = walking ? Math.sin(w.phase) * 0.55 : 0;
      const bob = walking ? Math.abs(Math.cos(w.phase)) * 0.04 : 0;
      _q.setFromEuler(_e.set(0, w.yaw, 0));
      const root = _m.compose(_p.set(w.x, w.y + bob, w.z), _q, _s);
      const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rz: number) => {
        _q.setFromEuler(_e.set(0, 0, rz));
        _m2.compose(_p.set(x, y, z), _q, _s);
        mesh.setMatrixAt(i, _m2.premultiply(root));
      };
      place(P.torso, n, 0, 0.78, 0, 0);
      place(P.head, n, 0, 1.4, 0, 0);
      place(P.hat, n, 0, 1.66, 0, 0);
      place(P.legs, n * 2, 0, 0.76, -0.1, swing);
      place(P.legs, n * 2 + 1, 0, 0.76, 0.1, -swing);
      const work = w.state === 'work' ? Math.sin(w.phase * 1.6) * 0.6 - 0.9 : 0;
      place(P.arms, n * 2, 0, 1.32, -0.3, walking ? -swing * 0.8 : work);
      place(P.arms, n * 2 + 1, 0, 1.32, 0.3, walking ? swing * 0.8 : work * 0.3);
      P.hat.setColorAt(n, w.hat);
      P.head.setColorAt(n, w.skin);
      n++;
      if (n >= MAX_WORKERS) break;
    }
    P.torso.count = P.head.count = P.hat.count = n;
    P.legs.count = P.arms.count = n * 2;
    for (const m of Object.values(P)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private think(w: Worker, b: BuildingState, dt: number): void {
    if (w.state === 'walk') {
      const target = w.path[0];
      if (!target) {
        this.arrive(w, b);
        return;
      }
      const dx = target[0] - w.x;
      const dz = target[1] - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) {
        w.path.shift();
        if (!w.path.length) this.arrive(w, b);
        return;
      }
      const step = Math.min(d, w.speed * dt);
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
      const want = Math.atan2(-dz, dx);
      w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * Math.min(1, dt * 8);
      w.phase += dt * w.speed * 5.5;
      if (w.deck) {
        const v = this.views.get(w.buildingId);
        const way = v ? this.ways(v)[w.deck.line] : undefined;
        if (way) w.y += (way.pts[0].y - w.y) * Math.min(1, dt * 10);
      } else {
        const g = this.terrain.ground(w.x, w.z);
        w.y += (g - w.y) * Math.min(1, dt * 10);
      }
      return;
    }
    w.phase += dt * 4;
    w.timer -= dt;
    if (w.timer > 0) return;
    if (w.deck) this.planDeck(w);
    else this.planLand(w, b);
    if (w.path.length) w.state = 'walk';
    else w.timer = 1 + Math.random() * 2;
  }

  private arrive(w: Worker, b: BuildingState): void {
    w.state = Math.random() < 0.45 ? 'work' : 'idle';
    w.timer = 2 + Math.random() * 6;
    if (w.state === 'work') {
      // face the building while working
      const cx = b.x + b.size[0] / 2;
      const cz = b.z + b.size[1] / 2;
      w.yaw = Math.atan2(-(cz - w.z), cx - w.x);
    }
  }

  private planLand(w: Worker, b: BuildingState): void {
    const g = this.grid(b);
    for (let tries = 0; tries < 3; tries++) {
      const pt = this.ringPoint(b, g);
      if (!pt) break;
      const path = this.findPath(g, w.x, w.z, pt[0], pt[1]);
      if (path && path.length) {
        w.path = path;
        return;
      }
    }
    w.path = [];
  }

  private planDeck(w: Worker): void {
    const v = this.views.get(w.buildingId);
    const ways = v ? this.ways(v) : [];
    const way = ways[w.deck!.line];
    if (!way) {
      w.path = [];
      return;
    }
    const from = w.deck!.s;
    let to = Math.random() * way.length;
    // on loops, walk the shorter way round
    const pts: P2[] = [];
    const push = (s: number) => {
      const p = this.wayPoint(way, s);
      pts.push([p.x, p.z]);
    };
    if (way.loop && Math.abs(to - from) > way.length / 2) {
      const dirSign = to > from ? -1 : 1;
      const end = dirSign < 0 ? to - way.length : to + way.length;
      for (let s = from; dirSign < 0 ? s > end : s < end; s += dirSign * 0.5) push(((s % way.length) + way.length) % way.length);
      push(to);
    } else {
      const sg = to > from ? 1 : -1;
      for (let s = from; sg > 0 ? s < to : s > to; s += sg * 0.5) push(s);
      push(to);
    }
    to = ((to % way.length) + way.length) % way.length;
    w.deck!.s = to;
    w.path = pts.slice(1);
  }

  dispose(): void {
    for (const o of this.offs) o();
    for (const g of this.geos) g.dispose();
    for (const m of Object.values(this.parts)) m.dispose();
    this.group.removeFromParent();
  }
}
