// Sky dome: gradient + Mie sun glow, sun disk, phased & cratered moon, twinkling rotating star field
// with a faint galactic band, lightning flashes and the x-ray "scanner" backdrop.
import * as THREE from 'three';
import type { SharedUniforms } from '../materials/uniforms';
import { COMMON_UNIFORMS_GLSL, FOG_GLSL, NOISE_GLSL } from '../materials/shaderLib';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_GLSL}
uniform vec3 uSunGlow;
uniform vec3 uSunDisk;
uniform vec3 uMoonDir;
uniform float uMoonPhase;
uniform float uMoonBright;
uniform float uStarVis;
uniform mat3 uStarRot;
uniform float uXray;
varying vec3 vDir;

vec3 moon(vec3 d, out float cover) {
  cover = 0.0;
  float r = 0.042;
  vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, uMoonDir);
  vec2 l = vec2(dot(d, right), dot(d, up)) / r;
  float along = dot(d, uMoonDir);
  float halo = pow(max(along, 0.0), 900.0) * 0.35 + pow(max(along, 0.0), 60.0) * 0.05;
  vec3 col = vec3(0.6, 0.7, 1.0) * halo * uMoonBright;
  float rr = dot(l, l);
  if (along > 0.0 && rr < 1.0) {
    float edge = smoothstep(1.0, 0.92, rr);
    vec3 n = vec3(l, sqrt(1.0 - rr));
    float ph = uMoonPhase * 6.2831853;
    vec3 L = vec3(sin(ph), 0.0, -cos(ph));
    float lit = smoothstep(-0.06, 0.12, dot(n, L));
    float crater = vnoise(l * 3.1 + 7.0) * 0.55 + vnoise(l * 7.3 + 3.0) * 0.3 + vnoise(l * 15.0) * 0.15;
    float albedo = 0.72 + 0.28 * smoothstep(0.35, 0.75, crater);
    col += vec3(0.95, 0.96, 1.0) * lit * albedo * 1.5 + vec3(0.05, 0.06, 0.09);
    cover = edge;
    col *= edge;
  }
  return col;
}

vec3 stars(vec3 d) {
  vec3 sd = uStarRot * d;
  vec3 p = sd * 130.0;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash13(id);
  vec3 col = vec3(0.0);
  if (h > 0.972) {
    vec3 off = (vec3(hash13(id + 1.3), hash13(id + 2.7), hash13(id + 5.1)) - 0.5) * 0.5;
    float dist = length(f - off);
    float mag = (h - 0.972) / 0.028;
    float size = 0.1 + mag * 0.22;
    float s = smoothstep(size, 0.0, dist);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 9.0) + h * 91.0);
    vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(id + 9.9));
    col = tint * s * tw * (0.6 + mag * 2.4);
  }
  // faint galactic band
  vec3 bandN = normalize(vec3(0.3, 0.2, 0.93));
  float band = exp(-pow(dot(sd, bandN) / 0.2, 2.0));
  float neb = vnoise(sd.xy * 6.0 + sd.z * 3.0) * 0.6 + vnoise(sd.yz * 13.0) * 0.4;
  col += vec3(0.35, 0.4, 0.6) * band * neb * 0.09;
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 horizon = fogTint(d);
  vec3 col = mix(horizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.48));
  if (h < 0.0) col = mix(horizon, horizon * 0.8, smoothstep(-0.25, -0.9, h));
  float s = max(dot(d, uSunDir), 0.0);
  float horizonBand = 1.0 - smoothstep(0.0, 0.5, abs(h));
  col += uSunGlow * (pow(s, 90.0) * 0.9 + pow(s, 7.0) * 0.22 * horizonBand);
  col += uSunDisk * smoothstep(0.99935, 0.9997, s) * 28.0;
  float mc;
  vec3 m = moon(d, mc);
  float nightVis = 1.0 - smoothstep(0.02, 0.25, uSunDir.y);
  col += m * nightVis * (1.0 - uFlash);
  float above = smoothstep(-0.02, 0.18, h);
  col += stars(d) * uStarVis * above * (1.0 - mc);
  col += uFlash * vec3(0.7, 0.75, 0.95) * (0.6 + 0.4 * above);
  if (uXray > 0.0) {
    vec3 scan = mix(vec3(0.004, 0.012, 0.03), vec3(0.01, 0.04, 0.08), smoothstep(-0.4, 0.6, h));
    float grid = smoothstep(0.985, 1.0, abs(sin(atan(d.z, d.x) * 36.0))) * 0.02 + smoothstep(0.99, 1.0, abs(sin(h * 60.0))) * 0.015;
    col = mix(col, scan + vec3(0.1, 0.5, 0.7) * grid, uXray * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms: {
    uSunGlow: { value: THREE.Color };
    uSunDisk: { value: THREE.Color };
    uMoonDir: { value: THREE.Vector3 };
    uMoonPhase: { value: number };
    uMoonBright: { value: number };
    uStarVis: { value: number };
    uStarRot: { value: THREE.Matrix3 };
    /** The true sun (the shared uSunDir follows the active light, which is the moon at night). */
    uSunDir: { value: THREE.Vector3 };
  };
  private material: THREE.ShaderMaterial;

  constructor(shared: SharedUniforms) {
    this.uniforms = {
      uSunGlow: { value: new THREE.Color() },
      uSunDisk: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonPhase: { value: 0.5 },
      uMoonBright: { value: 1 },
      uStarVis: { value: 0 },
      uStarRot: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'sky',
      uniforms: { ...shared, ...this.uniforms } as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  setSunDirection(dir: THREE.Vector3) {
    this.uniforms.uSunDir.value.copy(dir);
  }

  /** Stars rotate once per game day around a tilted polar axis. */
  setStarRotation(dayFraction: number) {
    const m4 = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0.25, 0.9, 0.35).normalize(), dayFraction * Math.PI * 2);
    this.uniforms.uStarRot.value.setFromMatrix4(m4);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
