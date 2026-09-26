// Expanding ground ring + air shell for explosions (small fixed pool, additive).
import * as THREE from 'three';

interface Wave {
  ring: THREE.Mesh;
  shell: THREE.Mesh;
  t: number;
  dur: number;
  size: number;
  active: boolean;
}

export class Shockwaves {
  readonly group = new THREE.Group();
  private readonly waves: Wave[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.82, 1, 56).rotateX(-Math.PI / 2);
  private readonly shellGeo = new THREE.SphereGeometry(1, 24, 12);

  constructor(count = 4) {
    for (let i = 0; i < count; i++) {
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const shellMat = new THREE.MeshBasicMaterial({ color: 0xffe8c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false });
      const ring = new THREE.Mesh(this.ringGeo, ringMat);
      const shell = new THREE.Mesh(this.shellGeo, shellMat);
      ring.visible = shell.visible = false;
      ring.renderOrder = shell.renderOrder = 21;
      this.group.add(ring, shell);
      this.waves.push({ ring, shell, t: 0, dur: 1, size: 1, active: false });
    }
  }

  spawn(x: number, y: number, z: number, power: number): void {
    const w = this.waves.find((v) => !v.active) ?? this.waves[0];
    w.active = true;
    w.t = 0;
    w.dur = 0.6 + 0.25 * Math.sqrt(power);
    w.size = 10 + 14 * Math.sqrt(power);
    w.ring.position.set(x, y + 0.15, z);
    w.shell.position.set(x, y, z);
    w.ring.visible = w.shell.visible = true;
  }

  update(dt: number): void {
    for (const w of this.waves) {
      if (!w.active) continue;
      w.t += dt;
      const k = w.t / w.dur;
      if (k >= 1) {
        w.active = false;
        w.ring.visible = w.shell.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const s = 0.5 + e * w.size;
      w.ring.scale.setScalar(s);
      (w.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      w.shell.scale.setScalar(s * 0.55);
      (w.shell.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (1 - k) * 0.35;
    }
  }

  dispose(): void {
    this.ringGeo.dispose();
    this.shellGeo.dispose();
    for (const w of this.waves) {
      (w.ring.material as THREE.Material).dispose();
      (w.shell.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
