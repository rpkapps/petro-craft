// Holographic additive materials and screen-space text labels for the subsurface overlays.
import * as THREE from 'three';

const HOLO_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uFade;
uniform float uUseVertexColor;
uniform float uFill;
uniform float uRim;
uniform float uGrid;
uniform vec3 uGridScale;
uniform float uScan;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWP);
  float ndv = abs(dot(N, V));
  float rim = pow(1.0 - ndv, 2.2);
  vec3 base = mix(uColor, vColor, uUseVertexColor);
  float a = uFill + rim * uRim;
  if (uGrid > 0.0) {
    vec3 g = vWP / uGridScale;
    vec3 f = fract(g);
    vec3 e = min(f, 1.0 - f) * uGridScale;
    vec3 an = abs(N);
    float ed = an.x > 0.5 ? min(e.y, e.z) : (an.y > 0.5 ? min(e.x, e.z) : min(e.x, e.y));
    float line = 1.0 - smoothstep(0.0, fwidth(ed) * 1.5 + 0.04, ed);
    a += line * uGrid;
  }
  if (uScan > 0.0) {
    float s = 0.5 + 0.5 * sin(vWP.y * 3.0 - uTime * 2.5);
    a += s * s * s * uScan;
  }
  a *= uOpacity * uFade;
  gl_FragColor = vec4(base * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface HoloOptions {
  color?: THREE.ColorRepresentation;
  opacity?: number;
  vertexColors?: boolean;
  fill?: number;
  rim?: number;
  grid?: number;
  gridScale?: THREE.Vector3;
  scan?: number;
  side?: THREE.Side;
}

export function createHoloMaterial(shared: { uTime: { value: number }; uXray: { value: number } }, o: HoloOptions = {}) {
  return new THREE.ShaderMaterial({
    name: 'holo',
    uniforms: {
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uOpacity: { value: o.opacity ?? 1 },
      uTime: shared.uTime,
      uFade: shared.uXray,
      uUseVertexColor: { value: o.vertexColors ? 1 : 0 },
      uFill: { value: o.fill ?? 0.1 },
      uRim: { value: o.rim ?? 0.6 },
      uGrid: { value: o.grid ?? 0 },
      uGridScale: { value: o.gridScale ?? new THREE.Vector3(1, 1, 1) },
      uScan: { value: o.scan ?? 0 },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: o.side ?? THREE.DoubleSide,
  });
}

/** Screen-constant text label (canvas texture sprite). */
export function createLabel(lines: string[], accent: string, scale = 1): THREE.Sprite {
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(6, 12, 20, 0.72)';
  const pad = 10;
  const rr = 14;
  g.beginPath();
  g.moveTo(pad + rr, pad);
  g.lineTo(W - pad - rr, pad);
  g.quadraticCurveTo(W - pad, pad, W - pad, pad + rr);
  g.lineTo(W - pad, H - pad - rr);
  g.quadraticCurveTo(W - pad, H - pad, W - pad - rr, H - pad);
  g.lineTo(pad + rr, H - pad);
  g.quadraticCurveTo(pad, H - pad, pad, H - pad - rr);
  g.lineTo(pad, pad + rr);
  g.quadraticCurveTo(pad, pad, pad + rr, pad);
  g.fill();
  g.fillStyle = accent;
  g.fillRect(pad, pad + 8, 6, H - pad * 2 - 16);
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '700 40px Rajdhani, "Segoe UI", Inter, sans-serif';
  g.fillText(lines[0] ?? '', 34, lines.length > 1 ? 44 : 64, W - 50);
  if (lines[1]) {
    g.fillStyle = 'rgba(200, 225, 240, 0.9)';
    g.font = '500 28px Inter, "Segoe UI", sans-serif';
    g.fillText(lines[1], 34, 88, W - 50);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.26 * scale, 0.065 * scale, 1);
  s.center.set(0, 0.5);
  s.renderOrder = 50;
  return s;
}

export function disposeLabel(s: THREE.Sprite) {
  s.material.map?.dispose();
  s.material.dispose();
}
