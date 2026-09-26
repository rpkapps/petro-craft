// Secondary subsurface cues for the x-ray view: fresh-water aquifers (faint blue lenses), faults next
// to known reservoirs (faint dipping planes) and depth reference rings with labels.
import * as THREE from 'three';
import type { GameContext, Fault } from '../../core/types';
import { METERS_PER_BLOCK, FEET_PER_METER } from '../../core/constants';
import { createHoloMaterial, createLabel, disposeLabel } from './holo';

type Shared = { uTime: { value: number }; uXray: { value: number } };

const RING_VERT = /* glsl */ `
varying vec2 vP;
varying vec3 vWP;
void main() {
  vP = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const RING_FRAG = /* glsl */ `
uniform float uRadius;
uniform float uFade;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vP;
varying vec3 vWP;
void main() {
  float r = length(vP);
  float edge = 1.0 - smoothstep(0.0, fwidth(r) * 1.5 + 0.05, abs(r - uRadius));
  vec2 g = abs(fract(vWP.xz / 8.0) - 0.5) * 8.0;
  float gl = 1.0 - smoothstep(0.0, fwidth(g.x) * 1.2 + 0.03, min(g.x, g.y));
  float radial = 1.0 - smoothstep(uRadius * 0.4, uRadius, r);
  float sweep = smoothstep(0.9, 1.0, fract(atan(vP.y, vP.x) / 6.2831853 - uTime * 0.08)) * radial;
  float a = edge * 0.55 + gl * 0.07 * radial + sweep * 0.08;
  if (r > uRadius + 1.0) discard;
  a *= uFade;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GeoFeatures {
  readonly group = new THREE.Group();
  private aquifers = new THREE.Group();
  private faults = new THREE.Group();
  private rings = new THREE.Group();
  private ringLabels: THREE.Sprite[] = [];
  private ringMat: THREE.ShaderMaterial;
  private aquiferMat: THREE.ShaderMaterial;
  private faultMat: THREE.ShaderMaterial;
  private builtAquifers = false;
  private faultKey = '';
  private ringKey = '';
  private readonly ringRadius = 44;

  constructor(private ctx: GameContext, shared: Shared) {
    this.group.name = 'xray-geo';
    this.group.add(this.aquifers, this.faults, this.rings);
    this.aquiferMat = createHoloMaterial(shared, { color: 0x3aa8ff, opacity: 0.55, fill: 0.05, rim: 0.4, scan: 0.03 });
    this.faultMat = createHoloMaterial(shared, { color: 0xff6040, opacity: 0.6, fill: 0.05, rim: 0.12, grid: 0.3, gridScale: new THREE.Vector3(4, 4, 4) });
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { uRadius: { value: this.ringRadius }, uFade: shared.uXray, uTime: shared.uTime, uColor: { value: new THREE.Color(0x4fd8ff) } },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }

  private buildAquifers() {
    this.builtAquifers = true;
    let list: GameContext['geology']['aquifers'] = [];
    try {
      list = this.ctx.geology.aquifers;
    } catch {
      return;
    }
    const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, false);
    for (const a of list) {
      if (!a.fresh) continue;
      const m = new THREE.Mesh(geo, this.aquiferMat);
      const h = Math.max(1, Math.abs(a.topY - a.bottomY));
      m.scale.set(a.radiusX, h, a.radiusZ);
      m.position.set(a.center.x, (a.topY + a.bottomY) / 2, a.center.z);
      m.renderOrder = 18;
      this.aquifers.add(m);
    }
  }

  private buildFaults() {
    const ctx = this.ctx;
    let faults: Fault[] = [];
    try {
      faults = ctx.geology.faults;
    } catch {
      return;
    }
    const known = ctx.geology.reservoirs.filter((r) => {
      const s = ctx.state.reservoirs[r.id];
      return s && (s.discovered || s.knowledge > 0);
    });
    const key = known.map((r) => r.id).join(',');
    if (key === this.faultKey) return;
    this.faultKey = key;
    for (const c of [...this.faults.children]) {
      this.faults.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const f of faults) {
      const dx = f.p1.x - f.p0.x;
      const dz = f.p1.z - f.p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz * f.dipSign;
      const nz = tx * f.dipSign;
      for (const r of known) {
        // distance from reservoir centre to the trace line
        const rx = r.center.x - f.p0.x;
        const rz = r.center.z - f.p0.z;
        const along = rx * tx + rz * tz;
        const perp = Math.abs(rx * -tz + rz * tx);
        if (perp > Math.max(r.radiusX, r.radiusZ) + 30) continue;
        const cx = f.p0.x + tx * along;
        const cz = f.p0.z + tz * along;
        let top = 70;
        try {
          top = this.ctx.geology.surfaceHeight(Math.round(cx), Math.round(cz));
        } catch {
          /* keep default */
        }
        const bottom = Math.max(4, Math.min(r.bottomY, r.topY) - 24);
        const half = Math.max(r.radiusX, r.radiusZ) + 24;
        const run = (top - bottom) / Math.tan((Math.max(20, Math.min(89, f.dip)) * Math.PI) / 180);
        const p = [
          [cx - tx * half, top, cz - tz * half],
          [cx + tx * half, top, cz + tz * half],
          [cx + tx * half + nx * run, bottom, cz + tz * half + nz * run],
          [cx - tx * half + nx * run, bottom, cz - tz * half + nz * run],
        ];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, this.faultMat);
        m.renderOrder = 17;
        this.faults.add(m);
      }
    }
  }

  private updateRings(camera: THREE.Camera, units: 'imperial' | 'metric') {
    const cx = Math.round(camera.position.x / 4) * 4;
    const cz = Math.round(camera.position.z / 4) * 4;
    let surface = Math.floor(camera.position.y - 1.6);
    try {
      surface = Math.min(surface, this.ctx.geology.surfaceHeight(cx, cz));
    } catch {
      /* geology unavailable: use the camera */
    }
    const key = `${cx},${cz},${surface},${units}`;
    if (key === this.ringKey) return;
    this.ringKey = key;
    for (const c of [...this.rings.children]) {
      this.rings.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    for (const l of this.ringLabels) disposeLabel(l);
    this.ringLabels = [];
    const stepBlocks = units === 'imperial' ? 1000 / FEET_PER_METER / METERS_PER_BLOCK * 2 : 500 / METERS_PER_BLOCK; // 2,000 ft or 500 m
    for (let k = 1; k <= 8; k++) {
      const y = surface - stepBlocks * k;
      if (y < 2) break;
      const geo = new THREE.PlaneGeometry(this.ringRadius * 2 + 4, this.ringRadius * 2 + 4);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.ringMat);
      m.position.set(cx, y, cz);
      m.renderOrder = 16;
      this.rings.add(m);
      const depthM = stepBlocks * k * METERS_PER_BLOCK;
      const text = units === 'imperial' ? `${Math.round((depthM * FEET_PER_METER) / 100) * 100} ft` : `${Math.round(depthM)} m`;
      const label = createLabel([`▼ ${text}`], '#4fd8ff', 0.6);
      label.position.set(cx + this.ringRadius, y, cz);
      this.rings.add(label);
      this.ringLabels.push(label);
    }
  }

  update(camera: THREE.Camera, units: 'imperial' | 'metric') {
    if (!this.builtAquifers) this.buildAquifers();
    this.buildFaults();
    this.updateRings(camera, units);
  }

  dispose() {
    if (this.aquifers.children[0]) (this.aquifers.children[0] as THREE.Mesh).geometry.dispose();
    for (const c of this.faults.children) (c as THREE.Mesh).geometry.dispose();
    for (const c of this.rings.children) if (c instanceof THREE.Mesh) c.geometry.dispose();
    for (const l of this.ringLabels) disposeLabel(l);
    this.aquiferMat.dispose();
    this.faultMat.dispose();
    this.ringMat.dispose();
  }
}
