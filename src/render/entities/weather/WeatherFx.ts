// Weather particles around the camera: GPU rain streaks (slanted by wind) and snow flakes, both
// evaluated entirely in the vertex shader in a world-anchored wrapping box (no CPU per-drop work),
// rain splashes on the ground, and lightning bolts with a flash.
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';
import { RAIN_DROPS, SNOW_FLAKES } from '../config';
import { PK } from '../fx/ParticleSystem';
import type { FxManager } from '../fx/FxManager';
import { COL } from '../fx/emitters';
import { Lightning } from './Lightning';

const rainVert = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEnd;
  attribute float aRnd;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uVel;
  uniform float uLen;
  uniform float uAmount;
  varying float vA;
  void main() {
    if (aRnd > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
    vec3 p = aSeed * uBox + uVel * uTime;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec3 dir = normalize(uVel);
    p -= dir * uLen * aEnd;
    float d = length(p - uCam);
    vA = (1.0 - aEnd * 0.85) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d)) * smoothstep(0.5, 2.0, d);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const rainFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vA);
    #include <colorspace_fragment>
  }
`;
const snowVert = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aRnd;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uVel;
  uniform float uAmount;
  uniform float uScale;
  varying float vA;
  void main() {
    if (aRnd > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
    vec3 p = aSeed * uBox + uVel * uTime * (0.7 + aRnd * 0.6);
    p.x += sin(uTime * 1.3 + aSeed.y * 40.0) * 0.8;
    p.z += cos(uTime * 1.1 + aSeed.x * 40.0) * 0.8;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vA = (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, d)) * smoothstep(0.3, 1.5, d);
    gl_PointSize = clamp((0.13 + aRnd * 0.09) * uScale / max(d, 0.1), 1.0, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const snowFrag = /* glsl */ `
  uniform float uOpacity;
  uniform float uLight;
  varying float vA;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * uLight, uOpacity * vA * (1.0 - r));
    #include <colorspace_fragment>
  }
`;

function seeds(n: number, perVertex: number): { seed: Float32Array; rnd: Float32Array; end: Float32Array } {
  const seed = new Float32Array(n * perVertex * 3);
  const rnd = new Float32Array(n * perVertex);
  const end = new Float32Array(n * perVertex);
  for (let i = 0; i < n; i++) {
    const sx = Math.random();
    const sy = Math.random();
    const sz = Math.random();
    const r = Math.random();
    for (let k = 0; k < perVertex; k++) {
      const v = i * perVertex + k;
      seed[v * 3] = sx;
      seed[v * 3 + 1] = sy;
      seed[v * 3 + 2] = sz;
      rnd[v] = r;
      end[v] = k;
    }
  }
  return { seed, rnd, end };
}

export class WeatherFx {
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly snowMat: THREE.ShaderMaterial;
  private readonly lightning: Lightning;
  private rainAmount = 0;
  private snowAmount = 0;
  private readonly off: () => void;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext, private readonly fx: FxManager) {
    this.group.name = 'weather';
    const q = ctx.settings.particles ?? 'high';
    const box = new THREE.Vector3(64, 44, 64);
    // rain streaks
    {
      const n = RAIN_DROPS[q];
      const s = seeds(n, 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(s.seed, 3));
      g.setAttribute('aRnd', new THREE.BufferAttribute(s.rnd, 1));
      g.setAttribute('aEnd', new THREE.BufferAttribute(s.end, 1));
      this.rainMat = new THREE.ShaderMaterial({
        vertexShader: rainVert,
        fragmentShader: rainFrag,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uBox: { value: box.clone() },
          uVel: { value: new THREE.Vector3(0, -30, 0) },
          uLen: { value: 1.1 },
          uAmount: { value: 0 },
          uColor: { value: new THREE.Color(0xaec4d8) },
          uOpacity: { value: 0.42 },
        },
        transparent: true,
        depthWrite: false,
      });
      this.rain = new THREE.LineSegments(g, this.rainMat);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 22;
      this.rain.visible = false;
    }
    // snow flakes
    {
      const n = SNOW_FLAKES[q];
      const s = seeds(n, 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(s.seed, 3));
      g.setAttribute('aRnd', new THREE.BufferAttribute(s.rnd, 1));
      this.snowMat = new THREE.ShaderMaterial({
        vertexShader: snowVert,
        fragmentShader: snowFrag,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(56, 36, 56) },
          uVel: { value: new THREE.Vector3(0, -2.2, 0) },
          uAmount: { value: 0 },
          uScale: { value: 600 },
          uOpacity: { value: 0.9 },
          uLight: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
      });
      this.snow = new THREE.Points(g, this.snowMat);
      this.snow.frustumCulled = false;
      this.snow.renderOrder = 22;
      this.snow.visible = false;
    }
    this.lightning = new Lightning(host, ctx, fx.lights);
    this.group.add(this.rain, this.snow, this.lightning.group);
    this.off = ctx.bus.on('weather:lightning', (e) => this.lightning.strike(e.x, e.z));
  }

  update(dt: number, time: number): void {
    const w = this.ctx.state.weather;
    const kind = w?.current ?? 'clear';
    const precip = Math.max(0, Math.min(1, w?.precipitation ?? 0));
    const inten = Math.max(0, Math.min(1, w?.intensity ?? 0));
    let rain = 0;
    let snow = 0;
    if (kind === 'rain') rain = 0.3 + 0.45 * Math.max(precip, inten);
    else if (kind === 'storm') rain = 0.75 + 0.25 * Math.max(precip, inten);
    else if (kind === 'hurricane') rain = 1;
    else if (kind === 'snow') snow = 0.35 + 0.35 * Math.max(precip, inten);
    else if (kind === 'blizzard') snow = 1;
    else if (precip > 0.05) {
      if ((w?.temperature ?? 10) < 0) snow = precip * 0.6;
      else rain = precip * 0.6;
    }
    const k = Math.min(1, dt * 0.35);
    this.rainAmount += (rain - this.rainAmount) * k;
    this.snowAmount += (snow - this.snowAmount) * k;
    const cam = this.host.camera.position;
    const ws = Math.min(30, w?.windSpeed ?? 0);
    const wd = w?.windDir ?? 0;
    const light = 0.25 + 0.75 * this.host.daylight;

    this.rain.visible = this.rainAmount > 0.01;
    if (this.rain.visible) {
      const u = this.rainMat.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(cam);
      u.uAmount.value = this.rainAmount;
      const slant = ws * 0.55;
      u.uVel.value.set(Math.cos(wd) * slant, -26 - this.rainAmount * 6, Math.sin(wd) * slant);
      u.uLen.value = 0.9 + this.rainAmount * 0.6;
      u.uOpacity.value = (0.25 + 0.25 * this.rainAmount) * (0.5 + 0.5 * light);
      this.splashes(dt, cam);
    }
    this.snow.visible = this.snowAmount > 0.01;
    if (this.snow.visible) {
      const u = this.snowMat.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(cam);
      u.uAmount.value = this.snowAmount;
      const drift = ws * (0.25 + this.snowAmount * 0.4);
      u.uVel.value.set(Math.cos(wd) * drift, -1.8 - this.snowAmount * 1.2, Math.sin(wd) * drift);
      const h = this.host.renderer.domElement.height || 720;
      u.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.host.camera.fov) / 2));
      u.uLight.value = light;
    }
    this.lightning.update(dt);
  }

  /** Small splashes on the ground around the camera while raining. */
  private splashes(dt: number, cam: THREE.Vector3): void {
    const q = this.fx.q;
    const n = Math.floor(this.rainAmount * 70 * q * dt + Math.random());
    const world = this.ctx.world;
    for (let i = 0; i < n; i++) {
      const x = cam.x + (Math.random() - 0.5) * 36;
      const z = cam.z + (Math.random() - 0.5) * 36;
      if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ || !world.isChunkGenerated(Math.floor(x / 16), Math.floor(z / 16))) continue;
      const y = world.getSurfaceY(Math.floor(x), Math.floor(z));
      if (Math.abs(y - cam.y) > 30) continue;
      for (let k = 0; k < 3; k++)
        this.fx.ps.emit(PK.DROP, x, y + 0.02, z, (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.15, 0.03, 0.02, COL.RAIN_SPLASH, 0.6, -12, 0.1, 0);
    }
  }

  dispose(): void {
    this.off();
    this.rain.geometry.dispose();
    this.snow.geometry.dispose();
    this.rainMat.dispose();
    this.snowMat.dispose();
    this.lightning.dispose();
    this.group.removeFromParent();
  }
}
