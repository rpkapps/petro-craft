// Minimal RenderHost for the player dev harness: plain three.js renderer with a naive vertex-coloured chunk mesher,
// water surfaces, box stand-ins for buildings, a block highlight with break progress and a selection box.
import * as THREE from 'three';
import type { RenderHost } from '../../src/core/client';
import type { MapOverlay } from '../../src/core/EventBus';
import type { GameContext, Vec3 } from '../../src/core/types';
import { B, BLOCKS, IS_SOLID } from '../../src/core/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../../src/core/constants';
import { rotatedSize } from '../../src/core/buildingUtil';

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.8 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.8 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.7 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.7 },
];

export class FakeHost implements RenderHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 1200);
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  readonly sunDirection = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  daylight = 1;
  overlay: MapOverlay | null = null;
  buildingPreview: { create(type: string): THREE.Object3D } | null = null;
  fps = 60;
  loadProgress = 1;
  private frameFns = new Set<(dt: number) => void>();
  private chunkMeshes = new Map<string, THREE.Mesh[]>();
  private dirty = new Set<string>();
  private readonly highlight: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly selection: THREE.LineSegments;
  private buildingMeshes = new Map<string, THREE.Mesh>();
  private shakeT = 0;
  private shakeI = 0;
  readonly log: string[] = [];

  constructor(readonly canvas: HTMLCanvasElement, private readonly ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x9cc7ea);
    this.scene.fog = new THREE.Fog(0x9cc7ea, 60, 260);
    this.sun.position.copy(this.sunDirection).multiplyScalar(100);
    this.scene.add(this.sun, new THREE.HemisphereLight(0xcfe6ff, 0x5a4a38, 1.1));
    this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x111111 }));
    this.highlight.visible = false;
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    this.highlight.add(this.crack);
    this.selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xff8a1f }));
    this.selection.visible = false;
    this.scene.add(this.highlight, this.selection);
    ctx.bus.on('world:blockChanged', (e) => {
      const cx = Math.floor(e.x / CHUNK_SIZE), cz = Math.floor(e.z / CHUNK_SIZE);
      this.dirty.add(`${cx},${cz}`);
      const lx = e.x % CHUNK_SIZE, lz = e.z % CHUNK_SIZE;
      if (lx === 0) this.dirty.add(`${cx - 1},${cz}`);
      if (lx === CHUNK_SIZE - 1) this.dirty.add(`${cx + 1},${cz}`);
      if (lz === 0) this.dirty.add(`${cx},${cz - 1}`);
      if (lz === CHUNK_SIZE - 1) this.dirty.add(`${cx},${cz + 1}`);
    });
    for (let cz = 0; cz < ctx.world.chunksZ; cz++) for (let cx = 0; cx < ctx.world.chunksX; cx++) this.dirty.add(`${cx},${cz}`);
  }

  onFrame(fn: (dt: number) => void): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }
  setBlockHighlight(pos: Vec3 | null, breakProgress?: number): void {
    this.highlight.visible = !!pos;
    if (pos) this.highlight.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
    (this.crack.material as THREE.MeshBasicMaterial).opacity = (breakProgress ?? 0) * 0.55;
  }
  setSelectionBox(min: Vec3 | null, max?: Vec3): void {
    this.selection.visible = !!min && !!max;
    if (min && max) {
      this.selection.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      this.selection.scale.set(max.x - min.x + 0.05, max.y - min.y + 0.05, max.z - min.z + 0.05);
    }
  }
  shake(intensity: number, duration = 0.3): void {
    this.shakeI = Math.max(this.shakeI, intensity);
    this.shakeT = Math.max(this.shakeT, duration);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    for (const fn of this.frameFns) fn(dt);
    let n = 0;
    for (const k of this.dirty) {
      this.dirty.delete(k);
      const [cx, cz] = k.split(',').map(Number);
      this.meshChunk(cx, cz);
      if (++n > 80) break;
    }
    this.syncBuildings();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const i = this.shakeI * 0.05;
      this.camera.position.x += (Math.random() - 0.5) * i;
      this.camera.position.y += (Math.random() - 0.5) * i;
      if (this.shakeT <= 0) this.shakeI = 0;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private syncBuildings() {
    const st = this.ctx.state;
    for (const [id, m] of this.buildingMeshes) {
      if (!st.buildings[id]) {
        this.scene.remove(m);
        this.buildingMeshes.delete(id);
      }
    }
    for (const b of Object.values(st.buildings)) {
      if (this.buildingMeshes.has(b.id)) continue;
      const [w, d, h] = b.size;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h, d - 0.1), new THREE.MeshLambertMaterial({ color: b.type === 'wellhead' ? 0xd04a2a : 0xc9ccd1 }));
      m.position.set(b.x + w / 2, b.y + h / 2, b.z + d / 2);
      this.scene.add(m);
      this.buildingMeshes.set(b.id, m);
    }
  }

  private meshChunk(cx: number, cz: number) {
    const w = this.ctx.world;
    if (cx < 0 || cz < 0 || cx >= w.chunksX || cz >= w.chunksZ) return;
    const k = `${cx},${cz}`;
    for (const m of this.chunkMeshes.get(k) ?? []) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    const pos: number[] = [], col: number[] = [], wpos: number[] = [];
    const c = new THREE.Color();
    const get = (x: number, y: number, z: number) => (w.inBounds(x, y, z) ? w.getBlock(x, y, z) : B.AIR);
    for (let y = 1; y < WORLD_HEIGHT; y++)
      for (let lz = 0; lz < CHUNK_SIZE; lz++)
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = cx * CHUNK_SIZE + lx, z = cz * CHUNK_SIZE + lz;
          const id = get(x, y, z);
          if (id === B.AIR || id === B.STRUCTURE) continue;
          const def = BLOCKS[id];
          if (def.shape === 'liquid') {
            if (get(x, y + 1, z) === B.AIR) wpos.push(x, y + 0.88, z, x + 1, y + 0.88, z, x + 1, y + 0.88, z + 1, x, y + 0.88, z, x + 1, y + 0.88, z + 1, x, y + 0.88, z + 1);
            continue;
          }
          const small = def.shape === 'cross' || def.shape === 'pipe';
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nb = get(x + F.n[0], y + F.n[1], z + F.n[2]);
            if (!small && IS_SOLID[nb] && BLOCKS[nb].shape === 'cube' && !BLOCKS[nb].transparent) continue;
            const pal = f === 2 ? def.palette[0] : def.tex.side.endsWith('_side') ? def.palette[2] ?? def.palette[0] : def.palette[0];
            c.setHex(pal);
            const s = F.shade * (0.92 + ((x * 7 + y * 13 + z * 5) % 5) * 0.02);
            const inset = small ? 0.3 : 0;
            const corner = (i: number) => {
              const v = F.c[i];
              pos.push(x + inset + v[0] * (1 - 2 * inset), y + (def.shape === 'cross' ? v[1] * 0.7 : inset + v[1] * (1 - 2 * inset)), z + inset + v[2] * (1 - 2 * inset));
              col.push(c.r * s, c.g * s, c.b * s);
            };
            for (const i of [0, 1, 2, 0, 2, 3]) corner(i);
          }
        }
    const meshes: THREE.Mesh[] = [];
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      meshes.push(m);
    }
    if (wpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      meshes.push(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2a6fb8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })));
    }
    for (const m of meshes) this.scene.add(m);
    this.chunkMeshes.set(k, meshes);
  }
}

/** Stand-in for the entity layer's building preview: a few boxes authored centred on the footprint. */
export function fakePreview(type: string): THREE.Object3D {
  const [w, d, h] = rotatedSize(type, 0);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.6, d * 0.8), new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.3, roughness: 0.6 }));
  body.position.y = h * 0.3;
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, h, 12), new THREE.MeshStandardMaterial({ color: 0xff8a1f }));
  stack.position.set(w * 0.3, h / 2, -d * 0.25);
  g.add(body, stack);
  return g;
}
