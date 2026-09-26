// First-person viewmodel (arm + held item with swing / equip / bob / sway animation) and the full-screen
// death fade. Drawn on top of the world (no depth test) so it never clips into walls.
import * as THREE from 'three';
import { BLOCKS } from '../core/blocks';
import { ITEMS } from '../content/items';
import { blockColor, blockFromItem } from './blockUtil';

const ORDER = 900;
const approach = (v: number, t: number, rate: number, dt: number) => v + (t - v) * (1 - Math.exp(-rate * dt));

function mat(color: THREE.ColorRepresentation, emissive = 0.2, map?: THREE.Texture): THREE.MeshLambertMaterial {
  const c = new THREE.Color(color);
  return new THREE.MeshLambertMaterial({
    color: map ? 0xffffff : c, map: map ?? null, emissive: c.clone().multiplyScalar(emissive), depthTest: false, depthWrite: false,
    transparent: true, fog: false,
  });
}

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, order = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.renderOrder = ORDER + order;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- procedural pixel textures for held blocks ---------------------------------------------------------
const texCache = new Map<string, THREE.Texture>();
function hex(n: number) {
  return `#${n.toString(16).padStart(6, '0')}`;
}
function pixelTexture(key: string, palette: number[], mode: 'plain' | 'grassSide' | 'rings'): THREE.Texture {
  const k = `${key}:${mode}`;
  const cached = texCache.get(k);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 8) & 0xffff) / 65536;
  };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let col = palette[0];
      const r = rnd();
      if (mode === 'grassSide') col = y < 3 + (r < 0.4 ? 1 : 0) ? palette[r < 0.5 ? 0 : 1] : palette[2] ?? palette[0];
      else if (mode === 'rings') col = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) % 3 < 1 ? palette[1] ?? palette[0] : palette[2] ?? palette[0];
      else if (r < 0.28 && palette[1] !== undefined) col = palette[1];
      else if (r > 0.86 && palette[2] !== undefined) col = palette[2];
      g.fillStyle = hex(col);
      g.fillRect(x, y, 1, 1);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(k, t);
  return t;
}

function buildBlock(blockId: number): THREE.Object3D {
  const d = BLOCKS[blockId];
  const g = new THREE.Group();
  if (d.shape === 'pipe') {
    const color = blockColor(blockId);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 14), mat(color, 0.25));
    body.rotation.z = Math.PI / 2;
    body.renderOrder = ORDER + 1;
    const flangeM = mat(0x3a3d42, 0.15);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 14), flangeM);
      f.rotation.z = Math.PI / 2;
      f.position.x = s * 0.15;
      f.renderOrder = ORDER + 2;
      g.add(f);
    }
    g.add(body);
    g.rotation.y = 0.5;
    return g;
  }
  if (d.shape === 'cross') {
    const m = new THREE.MeshLambertMaterial({ color: d.palette[0], side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, fog: false });
    for (const r of [0.785, -0.785]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.22), m);
      q.rotation.y = r;
      q.renderOrder = ORDER + 1;
      g.add(q);
    }
    return g;
  }
  const s = d.tex.side, t = d.tex.top;
  const top = pixelTexture(`${d.key}-top`, d.palette, t.includes('_top') && d.tool === 'axe' ? 'rings' : 'plain');
  const side = pixelTexture(`${d.key}-side`, d.palette, s.endsWith('_side') && d.palette.length >= 3 ? 'grassSide' : 'plain');
  const bottom = pixelTexture(`${d.key}-bottom`, [d.palette[2] ?? d.palette[0], d.palette[1] ?? d.palette[0]], 'plain');
  const mats = [mat(0xffffff, 0.12, side), mat(0xffffff, 0.12, side), mat(0xffffff, 0.2, top), mat(0xffffff, 0.12, bottom), mat(0xffffff, 0.12, side), mat(0xffffff, 0.12, side)];
  const cube = box(0.2, 0.2, 0.2, mats, 0, 0, 0, 2);
  cube.rotation.set(0.1, 0.75, 0);
  g.add(cube);
  return g;
}

function buildTool(item: string): THREE.Object3D {
  const g = new THREE.Group();
  const def = ITEMS[item];
  const wood = mat(0x8a5a32, 0.15), steel = mat(0xa8b0b8, 0.25), dark = mat(0x2a2e34, 0.1);
  const cls = def?.tool?.toolClass;
  switch (cls) {
    case 'pickaxe': {
      g.add(box(0.03, 0.4, 0.03, wood, 0, 0.02, 0, 1));
      const l = box(0.16, 0.04, 0.035, steel, -0.07, 0.2, 0, 2);
      l.rotation.z = 0.28;
      const r = box(0.16, 0.04, 0.035, steel, 0.07, 0.2, 0, 2);
      r.rotation.z = -0.28;
      g.add(l, r);
      break;
    }
    case 'shovel':
      g.add(box(0.03, 0.4, 0.03, wood, 0, 0.02, 0, 1), box(0.12, 0.15, 0.02, steel, 0, 0.27, 0, 2), box(0.08, 0.03, 0.03, dark, 0, -0.19, 0, 2));
      break;
    case 'axe':
      g.add(box(0.03, 0.38, 0.03, wood, 0, 0.02, 0, 1), box(0.11, 0.1, 0.025, steel, 0.06, 0.16, 0, 2));
      break;
    case 'wrench':
      g.add(box(0.035, 0.3, 0.02, mat(0xd04a2a, 0.2), 0, 0, 0, 1), box(0.1, 0.05, 0.03, steel, 0.02, 0.17, 0, 2), box(0.03, 0.06, 0.03, steel, -0.02, 0.21, 0, 3));
      break;
    case 'extinguisher': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.24, 16), mat(0xd42222, 0.25));
      body.renderOrder = ORDER + 1;
      g.add(body, box(0.04, 0.05, 0.04, dark, 0, 0.14, 0, 2), box(0.025, 0.025, 0.12, dark, 0, 0.16, -0.06, 3));
      break;
    }
    case 'scanner': {
      g.add(box(0.13, 0.19, 0.045, mat(0x303844, 0.1), 0, 0, 0, 1));
      g.add(box(0.1, 0.09, 0.005, mat(0x2ad0e0, 0.9), 0, 0.03, -0.024, 2));
      g.add(box(0.015, 0.1, 0.015, dark, 0.045, 0.14, 0, 2));
      break;
    }
    case 'detector':
      g.add(box(0.08, 0.14, 0.04, mat(0xf0d020, 0.25), 0, 0, 0, 1), box(0.06, 0.04, 0.005, mat(0x9dff7a, 0.9), 0, 0.03, -0.021, 2));
      break;
    case 'tablet': {
      const t = new THREE.Group();
      t.add(box(0.24, 0.16, 0.015, mat(0x252c36, 0.1), 0, 0, 0, 1), box(0.21, 0.13, 0.004, mat(0x3a7bd5, 0.85), 0, 0, -0.009, 2));
      t.rotation.x = -0.9;
      g.add(t);
      break;
    }
    default:
      g.add(box(0.12, 0.12, 0.12, mat(def?.color ?? '#888888', 0.3), 0, 0, 0, 1));
  }
  return g;
}

/** Arm + held item, rendered on top of the scene and positioned from the camera each frame. */
export class ViewModel {
  private readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly arm: THREE.Group;
  private held: THREE.Object3D | null = null;
  private heldKey: string | null | undefined = undefined;
  private swingT = 1;
  private equip = 1;
  private swayX = 0;
  private swayY = 0;
  private visible = true;
  private readonly fade: THREE.Mesh;
  private readonly fadeMat: THREE.ShaderMaterial;
  private fadeAlpha = 0;
  private fadeTarget = 0;
  private fadeColor = new THREE.Color(0, 0, 0);

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'player-viewmodel';
    this.arm = new THREE.Group();
    const sleeve = box(0.08, 0.08, 0.32, mat(0xff8a1f, 0.18), 0, 0, 0.14, 0);
    const cuff = box(0.085, 0.085, 0.035, mat(0x2b2f36, 0.1), 0, 0, -0.03, 0);
    const glove = box(0.07, 0.07, 0.075, mat(0x3b3f45, 0.12), 0, 0, -0.08, 0);
    const stripe = box(0.083, 0.083, 0.018, mat(0xd8dde2, 0.55), 0, 0, 0.03, 0);
    this.arm.add(sleeve, stripe, cuff, glove);
    this.pivot.add(this.arm);
    this.root.add(this.pivot);
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);

    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.fadeColor }, uAlpha: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, uAlpha); }',
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat);
    this.fade.frustumCulled = false;
    this.fade.renderOrder = 10000;
    this.fade.visible = false;
    scene.add(this.fade);
  }

  swing(): void {
    if (this.swingT > 0.45) this.swingT = 0;
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  /** Fade to a colour (alpha 0..1). */
  setFade(alpha: number, color: THREE.ColorRepresentation = 0x000000): void {
    this.fadeTarget = alpha;
    this.fadeColor.set(color);
  }

  private setItem(item: string | null): void {
    if (item === this.heldKey) return;
    this.heldKey = item;
    if (this.held) {
      this.pivot.remove(this.held);
      disposeTree(this.held);
      this.held = null;
    }
    this.equip = 0;
    if (!item) {
      this.arm.visible = true;
      return;
    }
    const b = blockFromItem(item);
    const obj = b !== null ? buildBlock(b) : buildTool(item);
    obj.traverse((o) => (o.frustumCulled = false));
    if (b !== null) obj.position.set(-0.02, 0.06, -0.2);
    else obj.position.set(0, 0.07, -0.15);
    if (b === null) obj.rotation.set(-0.35, 0.15, 0.1);
    this.held = obj;
    this.pivot.add(obj);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, s: { item: string | null; bobPhase: number; bobAmount: number; lookDX: number; lookDY: number; drone: boolean }): void {
    this.setItem(s.item);
    const show = this.visible && !s.drone;
    this.root.visible = show;
    this.fadeAlpha = approach(this.fadeAlpha, this.fadeTarget, 4, dt);
    this.fadeMat.uniforms.uAlpha.value = this.fadeAlpha;
    this.fade.visible = this.fadeAlpha > 0.003;
    if (!show) return;

    this.swingT = Math.min(1, this.swingT + dt / 0.28);
    this.equip = Math.min(1, this.equip + dt / 0.22);
    this.swayX = approach(this.swayX, THREE.MathUtils.clamp(-s.lookDX * 0.0009, -0.06, 0.06), 12, dt);
    this.swayY = approach(this.swayY, THREE.MathUtils.clamp(s.lookDY * 0.0009, -0.05, 0.05), 12, dt);

    const sw = Math.sin(this.swingT * Math.PI);
    const sw2 = Math.sin(Math.sqrt(this.swingT) * Math.PI);
    const eq = 1 - (1 - this.equip) ** 3;
    const bx = Math.sin(s.bobPhase) * 0.018 * s.bobAmount;
    const by = -Math.abs(Math.sin(s.bobPhase)) * 0.024 * s.bobAmount;

    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    this.pivot.position.set(0.3 + bx + this.swayX - sw2 * 0.1, -0.29 + by + this.swayY - (1 - eq) * 0.35 + sw2 * 0.05, -0.7 - sw * 0.1);
    this.pivot.rotation.set(-sw * 0.9 + 0.14, 0.22 + sw2 * 0.25, sw * 0.2);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.fade);
    disposeTree(this.root);
    this.fade.geometry.dispose();
    this.fadeMat.dispose();
  }
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) x.dispose(); // textures are cached and shared — not disposed
    }
  });
}
