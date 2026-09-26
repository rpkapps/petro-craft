// Directional shadow map that follows the camera with texel snapping (no shimmering while moving) and
// a quantised light direction (the sun creeps across the sky continuously).
import * as THREE from 'three';
import type { Settings } from '../core/types';
import type { SharedUniforms } from './materials/uniforms';

const QUALITY: Record<Settings['shadowQuality'], { size: number; radius: number; blur: number }> = {
  low: { size: 1024, radius: 44, blur: 1.2 },
  medium: { size: 2048, radius: 56, blur: 1.6 },
  high: { size: 4096, radius: 72, blur: 2.2 },
};

export class ShadowRig {
  private quality: Settings['shadowQuality'] | null = null;
  private enabled: boolean | null = null;
  private dir = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private center = new THREE.Vector3();
  private radius = 56;

  constructor(private renderer: THREE.WebGLRenderer, private light: THREE.DirectionalLight, private uniforms: SharedUniforms) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.035;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 480;
  }

  update(camera: THREE.PerspectiveCamera, lightDir: THREE.Vector3, settings: Settings) {
    if (settings.shadows !== this.enabled) {
      this.enabled = settings.shadows;
      this.light.castShadow = settings.shadows;
    }
    if (settings.shadowQuality !== this.quality) {
      this.quality = settings.shadowQuality;
      const q = QUALITY[this.quality] ?? QUALITY.medium;
      const cap = this.renderer.capabilities.maxTextureSize;
      const size = Math.min(q.size, cap);
      this.light.shadow.mapSize.set(size, size);
      this.light.shadow.radius = q.blur;
      if (this.light.shadow.map) {
        this.light.shadow.map.dispose();
        (this.light.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
      this.radius = q.radius;
      const cam = this.light.shadow.camera;
      cam.left = -q.radius;
      cam.right = q.radius;
      cam.top = q.radius;
      cam.bottom = -q.radius;
      cam.updateProjectionMatrix();
      this.dir.set(0, 0, 0); // force re-orientation
    }
    // quantise the light direction (~0.12°) to limit re-rasterisation crawl
    if (this.dir.lengthSq() === 0 || this.dir.angleTo(lightDir) > 0.002) this.dir.copy(lightDir);

    const d = this.dir;
    const worldUp = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.right.crossVectors(worldUp, d).normalize();
    this.up.crossVectors(d, this.right).normalize();

    // centre the map slightly ahead of the camera
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const c = this.center.copy(camera.position).addScaledVector(fwd, this.radius * 0.35);
    const texel = (this.radius * 2) / this.light.shadow.mapSize.x;
    const x = Math.round(c.dot(this.right) / texel) * texel;
    const y = Math.round(c.dot(this.up) / texel) * texel;
    const z = c.dot(d);
    c.copy(this.right).multiplyScalar(x).addScaledVector(this.up, y).addScaledVector(d, z);

    this.light.target.position.copy(c);
    this.light.position.copy(c).addScaledVector(d, 240);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    this.uniforms.uShadowCenter.value.copy(c);
    this.uniforms.uShadowRadius.value = this.radius;
  }
}
