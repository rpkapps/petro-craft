// Dropped item stacks (GameState.drops): each stack is drawn as a small spinning, bobbing item —
// block items as mini cubes wearing the block's own procedural textures, tools as coloured tokens,
// supplies as small crates, commodities as mini drums — with a soft contact shadow and a faint glow,
// a pop-in animation when a stack appears and a quick rise-and-shrink when it is picked up.
// Everything is instanced: one InstancedMesh per block type in view plus four shared ones.
import * as THREE from 'three';
import { BLOCK_BY_KEY } from '../../../core/blocks';
import type { DroppedItem, GameContext } from '../../../core/types';
import { ITEMS } from '../../../content/items';
import { paintLayer } from '../../index';
import type { Terrain } from '../vehicles/terrain';

const VIEW_DIST = 96;
const CUBE = 0.28;
const POP_IN = 0.38;
const PICK_OUT = 0.28;

type TokenKind = 'coin' | 'crate' | 'drum';

interface Visual {
  id: string;
  item: string;
  count: number;
  /** Smoothed display position & the last synced state position. */
  pos: THREE.Vector3;
  last: THREE.Vector3;
  since: number;
  age: number;
  /** >0 while playing the pickup animation. */
  leaving: number;
  phase: number;
  floor: number;
  floorT: number;
  seen: boolean;
}

/** Growable InstancedMesh wrapper. */
class Pool {
  mesh: THREE.InstancedMesh;
  n = 0;

  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    private readonly parent: THREE.Object3D,
    private readonly colored: boolean,
    private readonly shadow: boolean,
    capacity = 16,
  ) {
    this.mesh = this.make(capacity);
  }

  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.colored) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.frustumCulled = false;
    m.castShadow = this.shadow;
    m.receiveShadow = false;
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  begin(): void {
    this.n = 0;
  }

  push(m: THREE.Matrix4, c?: THREE.Color): void {
    if (this.n >= this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      this.mesh = this.make(old.instanceMatrix.count * 2);
      (this.mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
      if (old.instanceColor && this.mesh.instanceColor) (this.mesh.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
      old.removeFromParent();
      old.dispose();
    }
    this.mesh.setMatrixAt(this.n, m);
    if (c && this.mesh.instanceColor) this.mesh.setColorAt(this.n, c);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

/** Unit cube whose UVs map top / side / bottom thirds of a 3×1 face strip. */
function stripCube(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  for (let f = 0; f < 6; f++) {
    const slot = f === 2 ? 0 : f === 3 ? 2 : 1;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setX(i, (slot + uv.getX(i)) / 3);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Coloured geometry for the token kinds (white body parts are tinted per instance). */
function tokenGeometry(kind: TokenKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, shade: number) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.toNonIndexed());
  };
  if (kind === 'coin') {
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 6).rotateX(Math.PI / 2), 1);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 6).rotateX(Math.PI / 2), 0.55);
  } else if (kind === 'crate') {
    add(new THREE.BoxGeometry(0.26, 0.2, 0.2), 1);
    add(new THREE.BoxGeometry(0.27, 0.04, 0.21).translate(0, 0.08, 0), 0.5);
    add(new THREE.BoxGeometry(0.27, 0.04, 0.21).translate(0, -0.08, 0), 0.5);
  } else {
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10), 1);
    add(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 10).translate(0, 0.07, 0), 0.45);
    add(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 10).translate(0, -0.07, 0), 0.45);
  }
  const merged = mergeSimple(parts);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class DropLayer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, Visual>();
  private readonly cubeGeo = stripCube();
  private readonly blockPools = new Map<string, { pool: Pool; mat: THREE.MeshStandardMaterial; tex: THREE.DataTexture }>();
  private readonly tokenPools: Record<TokenKind, Pool>;
  private readonly tokenGeos: THREE.BufferGeometry[] = [];
  private readonly tokenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  private readonly decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  private readonly glowTex = radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  private readonly shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly glowMat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private readonly shadows: Pool;
  private readonly glows: Pool;
  private time = 0;

  constructor(private readonly ctx: GameContext, private readonly terrain: Terrain, private readonly camera: THREE.Camera) {
    this.group.name = 'drops';
    const tok = (k: TokenKind) => {
      const g = tokenGeometry(k);
      this.tokenGeos.push(g);
      return new Pool(g, this.tokenMat, this.group, true, true);
    };
    this.tokenPools = { coin: tok('coin'), crate: tok('crate'), drum: tok('drum') };
    this.shadows = new Pool(this.decalGeo, this.shadowMat, this.group, false, false);
    this.glows = new Pool(this.decalGeo, this.glowMat, this.group, true, false);
    this.shadows.mesh.renderOrder = 2;
    this.glows.mesh.renderOrder = 3;
  }

  /** Pool for a block item (textures painted from the block's own procedural layers). */
  private blockPool(key: string): Pool | null {
    const hit = this.blockPools.get(key);
    if (hit) return hit.pool;
    const def = BLOCK_BY_KEY[key];
    if (!def || def.shape === 'none') return null;
    const faces = [def.tex.top, def.tex.side, def.tex.bottom].map((k) => paintLayer(k, def.palette));
    const T = Math.round(Math.sqrt(faces[0].data.length / 4));
    const face = new Uint8Array(T * T * 4);
    const data = new Uint8Array(T * 3 * T * 4);
    faces.forEach((px, f) => {
      px.toBytes(face, 0);
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const si = (y * T + x) * 4;
          // DataTexture rows run bottom-up; paint rows run top-down
          const di = ((T - 1 - y) * T * 3 + f * T + x) * 4;
          data[di] = face[si];
          data[di + 1] = face[si + 1];
          data[di + 2] = face[si + 2];
          data[di + 3] = 255;
        }
    });
    const tex = new THREE.DataTexture(data, T * 3, T, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const emissive = def.light ? new THREE.Color(0xffffff) : new THREE.Color(0x000000);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, emissive, emissiveMap: def.light ? tex : null, emissiveIntensity: def.light ? 0.8 : 0 });
    const pool = new Pool(this.cubeGeo, mat, this.group, false, true);
    this.blockPools.set(key, { pool, mat, tex });
    return pool;
  }

  private tokenKind(item: string): TokenKind {
    const def = ITEMS[item];
    if (!def || def.kind === 'tool') return 'coin';
    if (def.kind === 'supply') return 'crate';
    return 'drum';
  }

  /** Floor under a drop (cached per visual for a moment; never generates chunks). */
  private floorOf(v: Visual): number {
    if (v.floorT > 0) return v.floor;
    v.floorT = 0.5;
    const t = this.terrain;
    v.floor = v.pos.y - 0.25;
    let y = Math.floor(v.pos.y);
    for (let k = 0; k < 6; k++, y--)
      if (t.solidAt(v.pos.x, y - 0.5, v.pos.z)) {
        v.floor = Math.min(y, v.pos.y);
        break;
      }
    return v.floor;
  }

  update(dt: number): void {
    this.time += dt;
    const list = (this.ctx.state.drops ?? []) as (DroppedItem & { vx?: number; vy?: number; vz?: number })[];
    for (const v of this.visuals.values()) v.seen = false;
    for (const d of list) {
      if (!d || typeof d.id !== 'string') continue;
      let v = this.visuals.get(d.id);
      if (!v) {
        v = {
          id: d.id, item: d.item, count: d.count, pos: new THREE.Vector3(d.x, d.y, d.z), last: new THREE.Vector3(d.x, d.y, d.z), since: 0,
          age: 0, leaving: 0, phase: Math.random() * Math.PI * 2, floor: d.y - 0.25, floorT: 0, seen: true,
        };
        this.visuals.set(d.id, v);
      }
      v.seen = true;
      v.leaving = 0;
      v.item = d.item;
      v.count = d.count;
      if (v.last.x !== d.x || v.last.y !== d.y || v.last.z !== d.z) {
        v.last.set(d.x, d.y, d.z);
        v.since = 0;
      } else v.since += dt;
      // extrapolate flying stacks between sim steps, then ease toward it
      const lead = Math.min(v.since, 0.12);
      _p.set(d.x + (d.vx ?? 0) * lead, d.y + (d.vy ?? 0) * lead, d.z + (d.vz ?? 0) * lead);
      if (v.pos.distanceToSquared(_p) > 16) v.pos.copy(_p);
      else v.pos.lerp(_p, 1 - Math.exp(-dt * 22));
      v.age += dt;
      v.floorT -= dt;
    }
    for (const v of this.visuals.values()) {
      if (v.seen) continue;
      v.leaving += dt;
      if (v.leaving > PICK_OUT) this.visuals.delete(v.id);
    }
    this.draw();
  }

  private draw(): void {
    for (const b of this.blockPools.values()) b.pool.begin();
    for (const p of Object.values(this.tokenPools)) p.begin();
    this.shadows.begin();
    this.glows.begin();
    const cam = this.camera.position;
    const t = this.time;
    for (const v of this.visuals.values()) {
      if (v.pos.distanceToSquared(cam) > VIEW_DIST * VIEW_DIST) continue;
      // pop-in (ease-out-back) / pickup (rise & shrink)
      let k: number;
      let rise = 0;
      if (v.leaving > 0) {
        const u = Math.min(1, v.leaving / PICK_OUT);
        k = 1 - u * u;
        rise = u * 0.7;
      } else {
        const u = Math.min(1, v.age / POP_IN);
        const c1 = 1.9;
        k = u >= 1 ? 1 : 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
      }
      if (k <= 0.01) continue;
      const bob = Math.sin(t * 2.4 + v.phase) * 0.06;
      const spin = t * 1.5 + v.phase;
      const cy = v.pos.y + 0.1 + bob + rise;
      const floor = this.floorOf(v);
      const n = v.count >= 16 ? 3 : v.count >= 2 ? 2 : 1;
      const blockKey = v.item.startsWith('block:') ? v.item.slice(6) : null;
      const pool = blockKey ? this.blockPool(blockKey) : null;
      const itemColor = _c.set(ITEMS[v.item]?.color ?? '#d8d2c4');
      for (let i = 0; i < n; i++) {
        const ox = i === 0 ? 0 : Math.cos(v.phase + i * 2.1) * 0.09;
        const oz = i === 0 ? 0 : Math.sin(v.phase + i * 2.1) * 0.09;
        const oy = i * 0.07;
        _q.setFromEuler(_e.set(i * 0.2, spin + i * 0.7, 0));
        _p.set(v.pos.x + ox, cy + oy, v.pos.z + oz);
        if (pool) {
          _s.setScalar(CUBE * k);
          pool.push(_m.compose(_p, _q, _s));
        } else {
          _s.setScalar(k);
          this.tokenPools[this.tokenKind(v.item)].push(_m.compose(_p, _q, _s), itemColor);
        }
      }
      // contact shadow shrinks as the item rises; glow tinted by the item
      const h = Math.max(0, cy - floor);
      const ss = (0.55 - Math.min(0.25, h * 0.12)) * k;
      _q.identity();
      this.shadows.push(_m.compose(_p.set(v.pos.x, floor + 0.015, v.pos.z), _q, _s.set(ss, 1, ss)));
      const gs = (0.9 + 0.08 * Math.sin(t * 3 + v.phase)) * k;
      const glowCol = pool ? _c.setRGB(0.55, 0.5, 0.38) : _c.multiplyScalar(0.6);
      this.glows.push(_m.compose(_p.set(v.pos.x, floor + 0.02, v.pos.z), _q, _s.set(gs, 1, gs)), glowCol);
    }
    for (const b of this.blockPools.values()) b.pool.end();
    for (const p of Object.values(this.tokenPools)) p.end();
    this.shadows.end();
    this.glows.end();
  }

  dispose(): void {
    for (const b of this.blockPools.values()) {
      b.pool.dispose();
      b.mat.dispose();
      b.tex.dispose();
    }
    this.blockPools.clear();
    for (const p of Object.values(this.tokenPools)) p.dispose();
    for (const g of this.tokenGeos) g.dispose();
    this.shadows.dispose();
    this.glows.dispose();
    this.cubeGeo.dispose();
    this.decalGeo.dispose();
    this.tokenMat.dispose();
    this.shadowMat.dispose();
    this.glowMat.dispose();
    this.shadowTex.dispose();
    this.glowTex.dispose();
    this.visuals.clear();
    this.group.removeFromParent();
  }
}
