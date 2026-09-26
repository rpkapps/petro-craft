// Blocky NPC workers (hard hats, hi-vis vests in the company colour) walking and working around
// staffed, active buildings. Rendered with one InstancedMesh per body part (6 draw calls for all
// workers); count per building ∝ its assigned crew, total capped, nearest buildings first.
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { BuildingState, GameContext } from '../../../core/types';
import { BUILDINGS } from '../../../content/buildings';
import type { BuildingView } from '../BuildingView';
import { MAX_WORKERS } from '../config';
import { Builder } from '../geom/Builder';
import type { MaterialLib } from '../materials';
import { C, HAT_COLORS } from '../palette';
import { Terrain } from '../vehicles/terrain';

const VISIBLE_DIST = 110;
const PER_BUILDING = 6;

interface Worker {
  buildingId: string;
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
  yaw: number;
  phase: number;
  speed: number;
  state: 'walk' | 'idle' | 'work';
  timer: number;
  side: number;
  /** Pending waypoint after the current target (walking around a corner). */
  next: [number, number] | null;
  hat: THREE.Color;
  skin: THREE.Color;
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
/** Adjacent perimeter sides (0: -z, 1: +z, 2: -x, 3: +x). */
const ADJ = [
  [2, 3],
  [2, 3],
  [0, 1],
  [0, 1],
];

export class WorkerCrowd {
  readonly group = new THREE.Group();
  private readonly parts: Record<'torso' | 'head' | 'hat' | 'legs' | 'arms', THREE.InstancedMesh>;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly workers: Worker[] = [];
  private readonly terrain: Terrain;
  private allocTimer = 0;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext, lib: MaterialLib, private readonly views: Map<string, BuildingView>) {
    this.group.name = 'workers';
    this.terrain = new Terrain(ctx);
    const company = new THREE.Color(lib.company).getHex();
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
    this.geos.push(torso, head, hat, leg, arm);
    const mat = lib.get('solid');
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
  }

  /** Decide how many workers each nearby staffed building shows. */
  private allocate(): void {
    const s = this.ctx.state;
    const cam = this.host.camera.position;
    const cands: { b: BuildingState; d: number; n: number }[] = [];
    for (const v of this.views.values()) {
      if (v.status !== 'active' || v.hidden) continue;
      const b = s.buildings[v.id];
      if (!b || b.workers.length === 0 || BUILDINGS[b.type]?.placement === 'water') continue;
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
    // drop surplus
    const have = new Map<string, number>();
    for (let i = this.workers.length - 1; i >= 0; i--) {
      const w = this.workers[i];
      const h = (have.get(w.buildingId) ?? 0) + 1;
      if (h > (want.get(w.buildingId) ?? 0)) this.workers.splice(i, 1);
      else have.set(w.buildingId, h);
    }
    // add missing
    for (const [id, n] of want) {
      const b = s.buildings[id];
      for (let k = have.get(id) ?? 0; k < n; k++) this.workers.push(this.spawn(b));
    }
  }

  private spawn(b: BuildingState): Worker {
    const side = Math.floor(Math.random() * 4);
    const [px, pz] = this.perimeterPoint(b, side);
    const skinTones = [C.SKIN, C.SKIN_DARK, 0xc68c64, 0xe8b894];
    return {
      buildingId: b.id,
      x: px,
      z: pz,
      y: this.terrain.ground(px, pz),
      tx: px,
      tz: pz,
      yaw: Math.random() * Math.PI * 2,
      phase: Math.random() * 10,
      speed: 1.1 + Math.random() * 0.5,
      state: 'idle',
      timer: Math.random() * 3,
      side,
      next: null,
      hat: new THREE.Color(HAT_COLORS[Math.floor(Math.random() * HAT_COLORS.length)]),
      skin: new THREE.Color(skinTones[Math.floor(Math.random() * skinTones.length)]),
    };
  }

  /** Random walkable point in a ring just outside the building footprint, on the given side. */
  private perimeterPoint(b: BuildingState, side: number, m = 0.6 + Math.random() * 1.6): [number, number] {
    const [w, d] = b.size;
    const t = Math.random();
    if (side === 0) return [b.x - m + t * (w + 2 * m), b.z - m];
    if (side === 1) return [b.x - m + t * (w + 2 * m), b.z + d + m];
    if (side === 2) return [b.x - m, b.z - m + t * (d + 2 * m)];
    return [b.x + w + m, b.z - m + t * (d + 2 * m)];
  }

  update(dt: number, _t: number): void {
    this.terrain.tick(dt);
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
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1 && w.next) {
        [w.tx, w.tz] = w.next;
        w.next = null;
        return;
      }
      if (d < 0.1) {
        w.state = Math.random() < 0.45 ? 'work' : 'idle';
        w.timer = 2 + Math.random() * 6;
        if (w.state === 'work') {
          // face the building while working
          const cx = b.x + b.size[0] / 2;
          const cz = b.z + b.size[1] / 2;
          w.yaw = Math.atan2(-(cz - w.z), cx - w.x);
        }
        return;
      }
      const step = Math.min(d, w.speed * dt);
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
      const want = Math.atan2(-dz, dx);
      w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * Math.min(1, dt * 8);
      w.phase += dt * w.speed * 5.5;
      const g = this.terrain.ground(w.x, w.z);
      w.y += (g - w.y) * Math.min(1, dt * 10);
    } else {
      w.phase += dt * 4;
      w.timer -= dt;
      if (w.timer <= 0) {
        // stay on this side, or walk around a corner to an adjacent side
        const adj = Math.random() < 0.35;
        const side = adj ? ADJ[w.side][Math.floor(Math.random() * 2)] : w.side;
        const [tx, tz] = this.perimeterPoint(b, side);
        if (adj) {
          const c = this.corner(b, w.side, side);
          w.tx = c[0];
          w.tz = c[1];
          w.next = [tx, tz];
        } else {
          w.tx = tx;
          w.tz = tz;
        }
        w.side = side;
        w.state = 'walk';
      }
    }
  }

  /** Outside corner shared by two adjacent sides (0: -z, 1: +z, 2: -x, 3: +x). */
  private corner(b: BuildingState, s1: number, s2: number): [number, number] {
    const m = 1.2;
    const zs = s1 < 2 ? s1 : s2;
    const xs = s1 >= 2 ? s1 : s2;
    const z = zs === 0 ? b.z - m : b.z + b.size[1] + m;
    const x = xs === 2 ? b.x - m : b.x + b.size[0] + m;
    return [x, z];
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of Object.values(this.parts)) m.dispose();
    this.group.removeFromParent();
  }
}
