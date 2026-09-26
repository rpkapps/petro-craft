// Well trajectories as glowing tubes coloured by status with animated flow pulses (up for producers,
// down for injectors); planned / remaining sections dashed; a pulsing bit marker on drilling wells.
import * as THREE from 'three';
import type { GameContext, Vec3, WellState, WellStatus } from '../../core/types';
import { createLabel, disposeLabel } from './holo';

const STATUS_COLOR: Partial<Record<WellStatus, number>> = {
  planned: 0xbfe8ff,
  drilling: 0xff8a1f,
  tripping: 0xff8a1f,
  casing: 0xffa84a,
  kick: 0xff5a1f,
  blowout: 0xff2020,
  drilled: 0xffd08a,
  completing: 0x9affc8,
  fracking: 0xd08aff,
  producing: 0x33ff88,
  injecting: 0x3aa0ff,
  shut_in: 0x6fc9a8,
  dry_hole: 0x8a8f99,
  plugged: 0x8a8f99,
};

const STATUS_LABEL: Partial<Record<WellStatus, string>> = {
  planned: 'Planned', drilling: 'Drilling', tripping: 'Tripping', casing: 'Running casing', kick: 'KICK', blowout: 'BLOWOUT',
  drilled: 'At TD', completing: 'Completing', fracking: 'Fracking', producing: 'Producing', injecting: 'Injecting', shut_in: 'Shut in',
  dry_hole: 'Dry hole', plugged: 'Plugged',
};

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLength;
uniform float uDash;
uniform float uFlow;
uniform float uTime;
uniform float uFade;
uniform float uAlarm;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  float s = vUv.x * uLength;
  if (uDash > 0.5 && fract(s / 2.5) > 0.5) discard;
  vec3 V = normalize(cameraPosition - vWP);
  float ndv = abs(dot(normalize(vN), V));
  float core = 0.35 + 0.65 * pow(ndv, 0.6);
  float pulse = 0.0;
  if (abs(uFlow) > 0.0) pulse = smoothstep(0.82, 1.0, fract(s / 7.0 + uTime * 0.9 * uFlow));
  float alarm = uAlarm * (0.5 + 0.5 * sin(uTime * 10.0));
  vec3 col = uColor * (core * 1.1 + pulse * 2.2 + alarm * 1.5);
  float a = uFade * (uDash > 0.5 ? 0.7 : 1.0);
  gl_FragColor = vec4(col * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface WellVis {
  key: string;
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  bit: THREE.Mesh | null;
  label: THREE.Sprite | null;
}

export class WellPaths {
  readonly group = new THREE.Group();
  private wells = new Map<string, WellVis>();
  private bitGeo = new THREE.SphereGeometry(0.7, 16, 12);
  private planCache = new Map<string, { key: string; pts: Vec3[] }>();

  constructor(private ctx: GameContext, private shared: { uTime: { value: number }; uXray: { value: number } }) {
    this.group.name = 'xray-wells';
  }

  private material(color: number, length: number, dash: boolean, flow: number, alarm: boolean) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uLength: { value: length },
        uDash: { value: dash ? 1 : 0 },
        uFlow: { value: flow },
        uTime: this.shared.uTime,
        uFade: this.shared.uXray,
        uAlarm: { value: alarm ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private tube(points: Vec3[], mat: (len: number) => THREE.ShaderMaterial, radius: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } | null {
    const pts: THREE.Vector3[] = [];
    let last: THREE.Vector3 | null = null;
    for (let i = 0; i < points.length; i++) {
      const p = new THREE.Vector3(points[i].x + 0.5, points[i].y + 0.5, points[i].z + 0.5);
      if (last && last.distanceToSquared(p) < 0.25) continue;
      if (i % 2 === 1 && i !== points.length - 1) continue; // thin voxel staircase for a smoother curve
      pts.push(p);
      last = p;
    }
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.min(600, Math.max(8, Math.round(len * 1.2))), radius, 8, false);
    const material = mat(len);
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 22;
    return { mesh, material };
  }

  private plannedPath(w: WellState): Vec3[] {
    const key = JSON.stringify(w.plan) + `|${w.x},${w.z},${w.surfaceY}`;
    const c = this.planCache.get(w.id);
    if (c && c.key === key) return c.pts;
    let pts: Vec3[] = [];
    try {
      pts = this.ctx.services.wells.planTrajectory(w.x, w.surfaceY, w.z, w.plan) ?? [];
    } catch {
      pts = [];
    }
    this.planCache.set(w.id, { key, pts });
    return pts;
  }

  private build(w: WellState, key: string): WellVis {
    const group = new THREE.Group();
    const materials: THREE.ShaderMaterial[] = [];
    const color = STATUS_COLOR[w.status] ?? 0xffffff;
    const flow = w.status === 'producing' ? -1 : w.status === 'injecting' ? 1 : w.status === 'drilling' ? 0.4 : 0;
    const alarm = w.status === 'blowout' || w.status === 'kick';
    const drilled = w.trajectory ?? [];
    if (drilled.length >= 2) {
      const t = this.tube(drilled, (len) => this.material(color, len, false, flow, alarm), 0.32);
      if (t) {
        group.add(t.mesh);
        materials.push(t.material);
      }
    }
    // planned path (whole plan for planned wells, remaining section while drilling)
    if (w.status === 'planned' || w.status === 'drilling' || w.status === 'tripping' || w.status === 'casing') {
      const plan = this.plannedPath(w);
      if (plan.length >= 2) {
        let rest = plan;
        if (drilled.length) {
          const end = drilled[drilled.length - 1];
          let best = 0;
          let bd = Infinity;
          plan.forEach((p, i) => {
            const d = (p.x - end.x) ** 2 + (p.y - end.y) ** 2 + (p.z - end.z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          rest = plan.slice(best);
        }
        const t = this.tube(rest, (len) => this.material(0xbfe8ff, len, true, 0, false), 0.22);
        if (t) {
          group.add(t.mesh);
          materials.push(t.material);
        }
      }
    }
    let bit: THREE.Mesh | null = null;
    const tip = drilled[drilled.length - 1];
    if (tip && (w.status === 'drilling' || w.status === 'tripping' || w.status === 'kick' || w.status === 'blowout')) {
      const m = this.material(alarm ? 0xff3020 : 0xffc060, 1, false, 0, alarm);
      bit = new THREE.Mesh(this.bitGeo, m);
      bit.position.set(tip.x + 0.5, tip.y + 0.5, tip.z + 0.5);
      bit.renderOrder = 23;
      materials.push(m);
      group.add(bit);
    }
    const labelAt = tip ?? { x: w.x, y: w.surfaceY - 2, z: w.z };
    const label = createLabel([w.name, STATUS_LABEL[w.status] ?? w.status], `#${color.toString(16).padStart(6, '0')}`, 0.8);
    label.position.set(labelAt.x + 1.5, labelAt.y + 0.5, labelAt.z + 0.5);
    group.add(label);
    return { key, group, materials, bit, label };
  }

  private disposeVis(v: WellVis) {
    this.group.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== this.bitGeo) o.geometry.dispose();
    });
    for (const m of v.materials) m.dispose();
    if (v.label) disposeLabel(v.label);
  }

  update(time: number) {
    const seen = new Set<string>();
    for (const w of Object.values(this.ctx.state.wells)) {
      seen.add(w.id);
      const traj = w.trajectory ?? [];
      const last = traj[traj.length - 1];
      const key = `${w.status}|${traj.length}|${last ? `${last.x},${last.y},${last.z}` : ''}|${w.name}`;
      const cur = this.wells.get(w.id);
      if (cur && cur.key === key) {
        if (cur.bit) cur.bit.scale.setScalar(0.85 + 0.3 * Math.abs(Math.sin(time * 4)));
        continue;
      }
      if (cur) this.disposeVis(cur);
      const v = this.build(w, key);
      this.wells.set(w.id, v);
      this.group.add(v.group);
    }
    for (const [id, v] of this.wells) {
      if (seen.has(id)) continue;
      this.disposeVis(v);
      this.wells.delete(id);
      this.planCache.delete(id);
    }
  }

  dispose() {
    for (const v of this.wells.values()) this.disposeVis(v);
    this.wells.clear();
    this.bitGeo.dispose();
  }
}
