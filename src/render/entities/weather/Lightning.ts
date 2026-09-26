// Lightning strikes: jagged branching bolt geometry (bright core + glow), flickering for ~0.5 s,
// with a dedicated point light and a sky-wide ambient flash. The two lights always exist (intensity 0
// when idle) so scene shaders never recompile.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';

interface Bolt {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  t: number;
  life: number;
  pos: THREE.Vector3;
}

const _up = new THREE.Vector3(0, 1, 0);

type Seg = [THREE.Vector3, THREE.Vector3, number];

/** Jagged main channel + branches as a list of segments [a, b, relative width]. */
function boltPath(top: THREE.Vector3, bottom: THREE.Vector3): Seg[] {
  const pts: THREE.Vector3[] = [top.clone(), bottom.clone()];
  // midpoint displacement
  let disp = top.distanceTo(bottom) * 0.18;
  for (let level = 0; level < 6; level++) {
    const next: THREE.Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const m = a.clone().add(b).multiplyScalar(0.5);
      m.x += (Math.random() - 0.5) * disp;
      m.z += (Math.random() - 0.5) * disp;
      m.y += (Math.random() - 0.5) * disp * 0.3;
      next.push(m, b);
    }
    pts.length = 0;
    pts.push(...next);
    disp *= 0.55;
  }
  const out: Seg[] = [];
  const addSeg = (a: THREE.Vector3, b: THREE.Vector3, w: number) => out.push([a, b, w]);
  for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i], pts[i + 1], 1);
  for (let k = 0; k < 3; k++) {
    let p = pts[Math.floor(pts.length * (0.2 + Math.random() * 0.5))].clone();
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, -1, (Math.random() - 0.5) * 2).normalize();
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const q = p.clone().addScaledVector(dir, 2 + Math.random() * 4);
      q.x += (Math.random() - 0.5) * 2;
      q.z += (Math.random() - 0.5) * 2;
      addSeg(p, q, 0.55);
      p = q;
    }
  }
  return out;
}

function boltGeometry(path: Seg[], width: number): THREE.BufferGeometry {
  const segs: THREE.BufferGeometry[] = [];
  for (const [a, b, rel] of path) {
    const w = width * rel;
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-3) continue;
    const g = new THREE.BoxGeometry(w, len, w).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    segs.push(g);
  }
  const g = mergeGeometries(segs, false)!;
  for (const s of segs) s.dispose();
  return g;
}

export class Lightning {
  readonly group = new THREE.Group();
  private readonly bolts: Bolt[] = [];
  private readonly light: THREE.PointLight;
  private readonly flash: THREE.AmbientLight;
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeef3ff).multiplyScalar(4), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fb0ff), toneMapped: false, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  private flashLevel = 0;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext) {
    this.light = new THREE.PointLight(0xdfe8ff, 0, 260, 1.4);
    this.flash = new THREE.AmbientLight(0xcad6ff, 0);
    this.group.add(this.light, this.flash);
  }

  strike(x: number, z: number): void {
    const ground = this.ctx.world.getSurfaceY(Math.floor(x), Math.floor(z));
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 20, ground + 95, z + (Math.random() - 0.5) * 20);
    const bottom = new THREE.Vector3(x + 0.5, ground, z + 0.5);
    const path = boltPath(top, bottom);
    const mesh = new THREE.Mesh(boltGeometry(path, 0.3), this.coreMat);
    const glow = new THREE.Mesh(boltGeometry(path, 1.3), this.glowMat);
    mesh.frustumCulled = false;
    glow.frustumCulled = false;
    mesh.renderOrder = glow.renderOrder = 23;
    this.group.add(mesh, glow);
    this.bolts.push({ mesh, glow, t: 0, life: 0.55, pos: bottom.clone().lerp(top, 0.35) });
    const d = this.host.camera.position.distanceTo(bottom);
    this.flashLevel = Math.max(this.flashLevel, Math.max(0.25, 1 - d / 500));
    if (d < 25) this.host.shake(0.25, 0.3);
  }

  update(dt: number): void {
    let lightI = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.life) {
        b.mesh.removeFromParent();
        b.glow.removeFromParent();
        b.mesh.geometry.dispose();
        b.glow.geometry.dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      // flicker: a few bright re-strokes
      const k = b.t / b.life;
      const on = k < 0.12 || (k > 0.22 && k < 0.34) || (k > 0.5 && k < 0.58);
      b.mesh.visible = b.glow.visible = on;
      if (on) {
        lightI = Math.max(lightI, 1 - k * 0.6);
        this.light.position.copy(b.pos);
      }
    }
    this.light.intensity = lightI * 60000;
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.8);
    this.flash.intensity = (lightI > 0 ? 1 : 0.35) * this.flashLevel * 2.2;
  }

  dispose(): void {
    for (const b of this.bolts) {
      b.mesh.geometry.dispose();
      b.glow.geometry.dispose();
    }
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.light.dispose();
    this.group.removeFromParent();
  }
}
