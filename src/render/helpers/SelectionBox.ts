// Animated glowing selection volume: pulsing orange edge beams, corner nodes and a soft scanning fill.
import * as THREE from 'three';
import type { Vec3 } from '../../core/types';

const FILL_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vN;
void main() { vLocal = position + 0.5; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FILL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uSize;
varying vec3 vLocal;
varying vec3 vN;
void main() {
  float h = vLocal.y * uSize.y;
  float scan = smoothstep(0.0, 0.6, 1.0 - abs(fract(h / max(uSize.y, 1.0) - uTime * 0.35) - 0.5) * 2.0);
  float a = 0.05 + 0.1 * pow(scan, 6.0);
  if (abs(vN.y) > 0.5) a *= 0.6;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SelectionBox {
  readonly group = new THREE.Group();
  private beams: THREE.InstancedMesh;
  private fill: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private fillMat: THREE.ShaderMaterial;
  private color = new THREE.Color(0xff8a1f);
  private t = 0;

  constructor() {
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.beamMat, 20);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 31;
    this.fillMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff8a1f) }, uSize: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.fillMat);
    this.fill.renderOrder = 30;
    this.group.add(this.fill, this.beams);
    this.group.visible = false;
    this.group.name = 'selection-box';
  }

  set(min: Vec3 | null, max?: Vec3) {
    if (!min) {
      this.group.visible = false;
      return;
    }
    const mx = max ?? min;
    const x0 = Math.min(min.x, mx.x);
    const y0 = Math.min(min.y, mx.y);
    const z0 = Math.min(min.z, mx.z);
    const x1 = Math.max(min.x, mx.x) + 1;
    const y1 = Math.max(min.y, mx.y) + 1;
    const z1 = Math.max(min.z, mx.z) + 1;
    const sx = x1 - x0;
    const sy = y1 - y0;
    const sz = z1 - z0;
    this.group.visible = true;
    this.group.position.set(x0, y0, z0);
    this.fill.position.set(sx / 2, sy / 2, sz / 2);
    this.fill.scale.set(sx + 0.02, sy + 0.02, sz + 0.02);
    this.fillMat.uniforms.uSize.value.set(sx, sy, sz);
    const w = 0.07;
    const m = new THREE.Matrix4();
    let i = 0;
    const beam = (cx: number, cy: number, cz: number, lx: number, ly: number, lz: number) => {
      m.makeScale(lx, ly, lz);
      m.setPosition(cx, cy, cz);
      this.beams.setMatrixAt(i++, m);
    };
    for (const y of [0, sy]) for (const z of [0, sz]) beam(sx / 2, y, z, sx + w, w, w);
    for (const x of [0, sx]) for (const z of [0, sz]) beam(x, sy / 2, z, w, sy + w, w);
    for (const x of [0, sx]) for (const y of [0, sy]) beam(x, y, sz / 2, w, w, sz + w);
    const n = w * 2.6;
    for (const x of [0, sx]) for (const y of [0, sy]) for (const z of [0, sz]) beam(x, y, z, n, n, n);
    this.beams.count = i;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    this.fillMat.uniforms.uTime.value = this.t;
    const pulse = 1.6 + 0.9 * Math.sin(this.t * 4.2);
    this.beamMat.color.copy(this.color).multiplyScalar(pulse);
  }

  dispose() {
    this.beams.geometry.dispose();
    this.beamMat.dispose();
    this.fill.geometry.dispose();
    this.fillMat.dispose();
    this.beams.dispose();
  }
}
