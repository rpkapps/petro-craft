// Camera shake applied only for the duration of a render call (never accumulated into the camera the
// player controller owns). Several shakes superimpose; each decays quadratically.
import * as THREE from 'three';

interface Shake {
  intensity: number;
  duration: number;
  t: number;
}

export class CameraShake {
  private shakes: Shake[] = [];
  private time = 0;
  private savedPos = new THREE.Vector3();
  private savedQuat = new THREE.Quaternion();
  private applied = false;

  add(intensity: number, duration = 0.6) {
    if (!(intensity > 0)) return;
    this.shakes.push({ intensity: Math.min(intensity, 4), duration: Math.max(0.05, duration), t: 0 });
    if (this.shakes.length > 12) this.shakes.shift();
  }

  update(dt: number) {
    this.time += dt;
    for (const s of this.shakes) s.t += dt;
    this.shakes = this.shakes.filter((s) => s.t < s.duration);
  }

  private amplitude() {
    let a = 0;
    for (const s of this.shakes) {
      const k = 1 - s.t / s.duration;
      a += s.intensity * k * k;
    }
    return Math.min(a, 3);
  }

  apply(camera: THREE.Camera) {
    const a = this.amplitude();
    if (a <= 0.0001) return;
    this.savedPos.copy(camera.position);
    this.savedQuat.copy(camera.quaternion);
    this.applied = true;
    const t = this.time * 28;
    const n = (o: number) => Math.sin(t * 1.13 + o) * 0.6 + Math.sin(t * 2.37 + o * 1.7) * 0.4;
    camera.position.x += n(0.3) * a * 0.12;
    camera.position.y += n(2.1) * a * 0.1;
    camera.position.z += n(4.7) * a * 0.12;
    camera.rotateZ(n(6.2) * a * 0.012);
    camera.rotateX(n(8.9) * a * 0.008);
    camera.updateMatrixWorld();
  }

  restore(camera: THREE.Camera) {
    if (!this.applied) return;
    camera.position.copy(this.savedPos);
    camera.quaternion.copy(this.savedQuat);
    camera.updateMatrixWorld();
    this.applied = false;
  }
}
