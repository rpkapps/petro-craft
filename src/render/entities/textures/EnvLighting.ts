// Procedural environment map for 'ultra' entity materials: a sky dome (zenith / horizon / ground
// gradient, sun glow) matched to the time of day and cloud cover, prefiltered with PMREM so metals,
// paint and glass get physically plausible reflections. Re-rendered only when the lighting changed
// noticeably (at most every few seconds); the previous map is disposed after the swap.
import * as THREE from 'three';

const REFRESH = 3;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  vec3 ground = mix(uHorizon * 0.55, uGround, clamp(-up * 3.0, 0.0, 1.0));
  vec3 c = up >= 0.0 ? sky : ground;
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.35);
  gl_FragColor = vec4(c, 1.0);
}`;

export class EnvLighting {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly mat: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget | null = null;
  private timer = 0;
  private lastKey = '';

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.mat));
  }

  get texture(): THREE.Texture | null {
    return this.rt?.texture ?? null;
  }

  /**
   * @param daylight 0 night .. 1 noon; `sun` direction towards the sun; `cloud` 0..1 cover.
   * @returns true when a new map was generated.
   */
  update(dt: number, daylight: number, sun: THREE.Vector3, cloud: number): boolean {
    this.timer -= dt;
    const key = `${daylight.toFixed(2)}|${sun.x.toFixed(1)},${sun.y.toFixed(1)},${sun.z.toFixed(1)}|${cloud.toFixed(1)}`;
    if (this.rt && (this.timer > 0 || key === this.lastKey)) return false;
    this.timer = REFRESH;
    this.lastKey = key;
    const u = this.mat.uniforms;
    const day = THREE.MathUtils.clamp(daylight, 0, 1);
    const low = 1 - THREE.MathUtils.smoothstep(sun.y, 0.05, 0.4); // golden hour
    const grey = THREE.MathUtils.clamp(cloud, 0, 1) * 0.7;
    const zen = new THREE.Color(0.2, 0.36, 0.72).lerp(new THREE.Color(0.55, 0.58, 0.62), grey);
    const hor = new THREE.Color(0.72, 0.78, 0.86).lerp(new THREE.Color(1.0, 0.62, 0.38), low * 0.8).lerp(new THREE.Color(0.66, 0.67, 0.69), grey);
    const gnd = new THREE.Color(0.24, 0.22, 0.19);
    const night = new THREE.Color(0.012, 0.016, 0.03);
    (u.uZenith.value as THREE.Color).copy(night).lerp(zen, day);
    (u.uHorizon.value as THREE.Color).copy(night).multiplyScalar(1.4).lerp(hor, day);
    (u.uGround.value as THREE.Color).copy(night).multiplyScalar(0.6).lerp(gnd, day);
    (u.uSunDir.value as THREE.Vector3).copy(sun).normalize();
    (u.uSunColor.value as THREE.Color).setRGB(1, 0.9 - low * 0.3, 0.78 - low * 0.4).multiplyScalar(day * (1 - grey * 0.9) * (sun.y > -0.05 ? 1 : 0));
    const next = this.pmrem.fromScene(this.scene, 0, 0.1, 50);
    const prev = this.rt;
    this.rt = next;
    // the caller swaps materials to the new map this frame; free the old one afterwards
    if (prev) queueMicrotask(() => prev.dispose());
    return true;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.pmrem.dispose();
    this.mat.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
