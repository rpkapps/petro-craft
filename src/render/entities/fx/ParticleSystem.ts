// Pooled GPU particle system. Particles are camera-facing instanced quads whose motion is evaluated
// analytically in the vertex shader (initial position/velocity, gravity, linear drag, wind), so the CPU
// only writes a particle once when it is spawned (ring buffer, partial buffer uploads).
// One draw call renders additive (fire, sparks, glow) and alpha (smoke, droplets, dust) particles
// together using premultiplied "additive-alpha" blending: additive kinds output alpha 0.
import * as THREE from 'three';

export const PK = {
  FIRE: 0,
  SMOKE: 1,
  SPARK: 2,
  DROP: 3,
  GLOW: 4,
  DUST: 5,
  STEAM: 6,
  FOAM: 7,
} as const;
export type PK = (typeof PK)[keyof typeof PK];

/** Linear RGB triple. */
export type RGB = readonly [number, number, number];

/** Convert an sRGB hex colour to a linear RGB triple (for presets). */
export function rgb(hex: number): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

const STRIDE = 20;

const vertexShader = /* glsl */ `
  attribute vec4 iPosBorn;
  attribute vec4 iVelLife;
  attribute vec4 iSize;
  attribute vec4 iColor;
  attribute vec4 iMisc;
  uniform float uTime;
  uniform vec3 uWind;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vT;
  varying float vKind;
  varying float vSeed;
  varying float vFogDepth;
  void main() {
    float age = uTime - iPosBorn.w;
    float life = iVelLife.w;
    float t = age / life;
    if (age < 0.0 || t >= 1.0 || life <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float k = max(iSize.w, 0.0005);
    vec3 acc = vec3(0.0, iSize.z, 0.0) + uWind * k * iMisc.y;
    float e = exp(-k * age);
    vec3 term = acc / k;
    vec3 p = iPosBorn.xyz + term * age + (iVelLife.xyz - term) * (1.0 - e) / k;
    vec3 v = (iVelLife.xyz - term) * e + term;
    float kind = iMisc.x;
    float grow = (kind == 1.0 || kind == 5.0 || kind == 6.0 || kind == 7.0) ? sqrt(t) : t;
    float size = mix(iSize.x, iSize.y, grow);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 c = position.xy;
    if (kind == 2.0 || kind == 3.0) {
      // stretch along the screen-space velocity (sparks, droplets)
      vec3 vv = mat3(modelViewMatrix) * v;
      float sp = length(vv.xy);
      float ang = atan(vv.y, vv.x + 1e-5) - 1.5707963;
      float len = size + sp * (kind == 2.0 ? 0.045 : 0.03);
      vec2 sc = vec2(c.x * size, c.y * len);
      float cs = cos(ang);
      float sn = sin(ang);
      mv.xy += vec2(sc.x * cs - sc.y * sn, sc.x * sn + sc.y * cs);
    } else {
      float ang = iMisc.z * age + iMisc.w * 6.2831;
      float cs = cos(ang);
      float sn = sin(ang);
      mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    }
    vUv = uv;
    vColor = iColor;
    vT = t;
    vKind = kind;
    vSeed = iMisc.w;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uLight;
  uniform vec3 uFogColor;
  uniform vec3 uFogParams; // mode (0 none, 1 linear, 2 exp2), near|density, far
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vT;
  varying float vKind;
  varying float vSeed;
  varying float vFogDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 1.1) * 0.1; }
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float t = vT;
    // varyings are interpolated: round the kind id before comparing
    float kind = floor(vKind + 0.5);
    vec4 outc;
    bool additive = false;
    if (kind == 0.0) {
      // fire: licking tongues — noisy, crisp-edged cells, hot core → orange → deep red
      float n = fbm(q * 2.4 + vec2(vSeed * 13.0, vSeed * 7.0 - t * 2.5));
      float body = (1.0 - r) * (0.55 + 0.9 * n);
      float shape = smoothstep(0.22, 0.62, body);
      vec3 hot = vec3(1.0, 0.8, 0.45);
      vec3 mid = vec3(1.0, 0.4, 0.07);
      vec3 cool = vec3(0.3, 0.09, 0.03);
      float heat = clamp(t * 1.2 + (1.0 - body) * 0.35, 0.0, 1.0);
      vec3 col = heat < 0.3 ? mix(hot, mid, heat / 0.3) : mix(mid, cool, (heat - 0.3) / 0.7);
      float inten = shape * pow(1.0 - t, 1.6) * vColor.a * 1.7 * smoothstep(0.0, 0.06, t);
      // partly occluding (alpha) so dense flames saturate to orange instead of blowing out to white
      outc = vec4(col * vColor.rgb * inten, min(1.0, inten * 0.5));
      additive = true;
    } else if (kind == 2.0) {
      float core = smoothstep(1.0, 0.0, r);
      vec3 col = mix(vec3(1.0, 0.92, 0.6), vec3(1.0, 0.35, 0.05), t);
      outc = vec4(col * vColor.rgb * core * (1.0 - t) * vColor.a * 3.0, 0.0);
      additive = true;
    } else if (kind == 4.0) {
      float soft = pow(max(0.0, 1.0 - r), 2.0);
      outc = vec4(vColor.rgb * soft * vColor.a * (1.0 - t), 0.0);
      additive = true;
    } else if (kind == 3.0) {
      float shape = smoothstep(1.0, 0.45, r);
      float a = shape * vColor.a * (1.0 - t * t);
      vec3 col = vColor.rgb * mix(1.0, uLight, 0.8) * (0.85 + 0.3 * (1.0 - r));
      outc = vec4(col * a, a);
    } else {
      // smoke / dust / steam / foam puffs
      float sc = kind == 5.0 ? 1.6 : 2.3;
      float n = fbm(q * sc + vec2(vSeed * 17.0, vSeed * 5.0 + t * 0.6));
      float shape = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.55);
      float fadeIn = smoothstep(0.0, kind == 7.0 ? 0.02 : 0.12, t);
      float a = shape * vColor.a * fadeIn * pow(1.0 - t, kind == 6.0 ? 1.1 : 1.6);
      float shade = 0.72 + 0.4 * (n - 0.3) + 0.18 * (-q.y);
      vec3 col = vColor.rgb * shade * uLight;
      outc = vec4(col * a, a);
    }
    if (uFogParams.x > 0.5) {
      float f = uFogParams.x < 1.5
        ? smoothstep(uFogParams.y, uFogParams.z, vFogDepth)
        : 1.0 - exp(-uFogParams.y * uFogParams.y * vFogDepth * vFogDepth);
      if (additive) outc *= (1.0 - f);
      else outc.rgb = mix(outc.rgb, uFogColor * outc.a, f);
    }
    gl_FragColor = outc;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly material: THREE.ShaderMaterial;
  private head = 0;
  private dirtyStart = -1;
  private dirtyEnd = -1;
  private wrapped = false;
  time = 0;
  /** Number of particles spawned this frame (diagnostics). */
  spawnedThisFrame = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // initialise every particle as dead (born in the far future)
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 3] = 1e9;
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.setAttribute('iPosBorn', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('iVelLife', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    g.setAttribute('iSize', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    g.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    g.setAttribute('iMisc', new THREE.InterleavedBufferAttribute(this.buffer, 4, 16));
    g.instanceCount = capacity;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3() },
        uLight: { value: 1 },
        uFogColor: { value: new THREE.Color() },
        uFogParams: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'particles';
  }

  /**
   * Spawn one particle. Units: blocks, seconds. `gravity` is the vertical acceleration (negative falls,
   * positive = buoyant), `drag` a linear drag coefficient, `wind` how strongly it follows the wind.
   */
  emit(
    kind: PK,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    col: RGB, alpha: number,
    gravity = 0, drag = 0.5, wind = 0, spin = 0,
  ): void {
    const i = this.head;
    const o = i * STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = size0; d[o + 9] = size1; d[o + 10] = gravity; d[o + 11] = drag;
    d[o + 12] = col[0]; d[o + 13] = col[1]; d[o + 14] = col[2]; d[o + 15] = alpha;
    d[o + 16] = kind; d[o + 17] = wind; d[o + 18] = spin; d[o + 19] = Math.random();
    if (this.dirtyStart < 0) {
      this.dirtyStart = i;
      this.dirtyEnd = i;
    } else if (i < this.dirtyStart) this.wrapped = true;
    else this.dirtyEnd = Math.max(this.dirtyEnd, i);
    this.head = (i + 1) % this.capacity;
    this.spawnedThisFrame++;
  }

  /** Upload spawned particles and advance time. */
  update(time: number, wind: THREE.Vector3, light: number, fog: THREE.Fog | THREE.FogExp2 | null): void {
    this.time = time;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uWind.value.copy(wind);
    u.uLight.value = light;
    if (fog instanceof THREE.Fog) {
      u.uFogColor.value.copy(fog.color);
      u.uFogParams.value.set(1, fog.near, fog.far);
    } else if (fog instanceof THREE.FogExp2) {
      u.uFogColor.value.copy(fog.color);
      u.uFogParams.value.set(2, fog.density, 0);
    } else u.uFogParams.value.set(0, 0, 0);
    if (this.dirtyStart >= 0) {
      this.buffer.clearUpdateRanges();
      if (this.wrapped) {
        this.buffer.addUpdateRange(0, this.capacity * STRIDE);
      } else {
        this.buffer.addUpdateRange(this.dirtyStart * STRIDE, (this.dirtyEnd - this.dirtyStart + 1) * STRIDE);
      }
      this.buffer.needsUpdate = true;
      this.dirtyStart = -1;
      this.dirtyEnd = -1;
      this.wrapped = false;
    }
    this.spawnedThisFrame = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
