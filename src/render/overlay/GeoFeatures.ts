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
  private ringUnits: 'imperial' | 'metric' | null = null;
  private ringStep = 12.5;
  private ringX = NaN;
  private ringZ = NaN;
  private readonly ringRadius = 44;

  constructor(private ctx: GameContext, shared: Shared) {
    this.group.name = 'xray-geo';
    this.group.add(this.aquifers, this.faults, this.rings);
    this.aquiferMat = createHoloMaterial(shared, { color: 0x3aa8ff, opacity: 0.4, fill: 0.03, rim: 0.35, scan: 0.02, side: THREE.FrontSide });
    this.faultMat = createHoloMaterial(shared, { color: 0xff5a30, opacity: 0.35, fill: 0.03, rim: 0.05, grid: 0.12, gridScale: new THREE.Vector3(8, 8, 8) });
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
        if (perp > Math.max(r.radiusX, r.radiusZ) + 12) continue;
        const cx = f.p0.x + tx * along;
        const cz = f.p0.z + tz * along;
        let top = 70;
        try {
          top = this.ctx.geology.surfaceHeight(Math.round(cx), Math.round(cz));
        } catch {
          /* keep default */
        }
        const bottom = Math.max(4, Math.min(r.bottomY, r.topY) - 24);
        const half = Math.max(r.radiusX, r.radiusZ) + 10;
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

  /** Build the ring stack once per unit system; afterwards it only follows the camera. */
  private buildRings(units: 'imperial' | 'metric') {
    const old = this.rings.children[0]?.children[0];
    if (old instanceof THREE.Mesh) old.geometry.dispose();
    this.rings.clear();
    for (const l of this.ringLabels) disposeLabel(l);
    this.ringLabels = [];
    // every 2,000 ft or 500 m
    this.ringStep = units === 'imperial' ? (2000 / FEET_PER_METER) / METERS_PER_BLOCK : 500 / METERS_PER_BLOCK;
    const geo = new THREE.PlaneGeometry(this.ringRadius * 2 + 4, this.ringRadius * 2 + 4);
    geo.rotateX(-Math.PI / 2);
    for (let k = 1; k <= 8; k++) {
      const ring = new THREE.Group();
      ring.position.y = -this.ringStep * k;
      const m = new THREE.Mesh(geo, this.ringMat);
      m.renderOrder = 16;
      ring.add(m);
      const depthM = this.ringStep * k * METERS_PER_BLOCK;
      const text = units === 'imperial' ? `${(Math.round((depthM * FEET_PER_METER) / 100) * 100).toLocaleString()} ft` : `${Math.round(depthM).toLocaleString()} m`;
      const label = createLabel([`▼ ${text}`], '#4fd8ff', 0.6);
      label.position.set(this.ringRadius, 0, 0);
      ring.add(label);
      this.ringLabels.push(label);
      this.rings.add(ring);
    }
  }

  private updateRings(camera: THREE.Camera, units: 'imperial' | 'metric') {
    if (units !== this.ringUnits) {
      this.ringUnits = units;
      this.buildRings(units);
    }
    const cx = Math.round(camera.position.x / 4) * 4;
    const cz = Math.round(camera.position.z / 4) * 4;
    if (cx !== this.ringX || cz !== this.ringZ) {
      this.ringX = cx;
      this.ringZ = cz;
      let surface = Math.floor(camera.position.y - 1.6);
      try {
        surface = Math.min(surface, this.ctx.geology.surfaceHeight(cx, cz));
      } catch {
        /* geology unavailable: use the camera */
      }
      this.rings.position.set(cx, surface, cz);
      for (const ring of this.rings.children) ring.visible = surface + ring.position.y >= 2;
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
    const ringMesh = this.rings.children[0]?.children[0];
    if (ringMesh instanceof THREE.Mesh) ringMesh.geometry.dispose();
    for (const l of this.ringLabels) disposeLabel(l);
    this.aquiferMat.dispose();
    this.faultMat.dispose();
    this.ringMat.dispose();
  }
}
