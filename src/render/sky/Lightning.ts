// Lightning: global flash envelope (sky, ambient, grade) plus a short-lived branching bolt mesh.
import * as THREE from 'three';

interface Bolt {
  mesh: THREE.Mesh;
  t: number;
}

export class Lightning {
  readonly group = new THREE.Group();
  private bolts: Bolt[] = [];
  private flashT = 99;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.group.name = 'lightning';
  }

  /** Current flash intensity 0..1 (double flicker). */
  get flash(): number {
    const t = this.flashT;
    if (t > 1.2) return 0;
    let f = Math.exp(-t * 9);
    if (t > 0.13) f += 0.7 * Math.exp(-(t - 0.13) * 11);
    if (t > 0.32) f += 0.35 * Math.exp(-(t - 0.32) * 14);
    return Math.min(1, f);
  }

  strike(x: number, z: number, groundY: number, top = 138) {
    this.flashT = 0;
    const pts: THREE.Vector3[] = [];
    let px = x + (Math.random() - 0.5) * 20;
    let pz = z + (Math.random() - 0.5) * 20;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = top + (groundY - top) * t;
      const pull = t * t;
      px += (Math.random() - 0.5) * 6 + (x - px) * pull * 0.5;
      pz += (Math.random() - 0.5) * 6 + (z - pz) * pull * 0.5;
      pts.push(new THREE.Vector3(i === steps ? x + 0.5 : px, y, i === steps ? z + 0.5 : pz));
    }
    const geos: THREE.BufferGeometry[] = [this.polyTube(pts, 0.35)];
    // two short branches
    for (let b = 0; b < 2; b++) {
      const start = pts[3 + Math.floor(Math.random() * 8)].clone();
      const bp = [start];
      for (let i = 1; i < 6; i++) bp.push(bp[i - 1].clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -4 - Math.random() * 4, (Math.random() - 0.5) * 8)));
      geos.push(this.polyTube(bp, 0.18));
    }
    for (const g of geos) {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 40;
      this.group.add(mesh);
      this.bolts.push({ mesh, t: 0 });
    }
  }

  private polyTube(pts: THREE.Vector3[], r: number) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    return new THREE.TubeGeometry(path, pts.length * 2, r, 5, false);
  }

  update(dt: number) {
    this.flashT += dt;
    const vis = this.flash;
    this.material.opacity = Math.min(1, vis * 1.6);
    for (const b of this.bolts) b.t += dt;
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      if (b.t > 0.55) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
      } else keep.push(b);
    }
    this.bolts = keep;
  }

  dispose() {
    for (const b of this.bolts) b.mesh.geometry.dispose();
    this.bolts = [];
    this.material.dispose();
  }
}
