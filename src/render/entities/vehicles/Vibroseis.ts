// Vibroseis convoys on active seismic surveys: three trucks move along the 2D line (or a lawnmower
// pattern over a 3D area) in proportion to survey progress, lowering their base plates to "thump"
// the ground with dust rings.
import * as THREE from 'three';
import type { SurveyState } from '../../../core/types';
import { dustRing } from '../fx/emitters';
import { vibroTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const TRUCKS = 3;
const SPACING = 5;
const LINE_SPACING = 8;
const CYCLE = 3.2;

interface Convoy {
  trucks: Vehicle[];
  phase: number[];
  y: number[];
}

/** Point & heading along a survey's acquisition path at fraction f (0..1), offset back by `back` blocks. */
function pathAt(s: SurveyState, f: number, back: number, out: THREE.Vector3, dir: THREE.Vector3): void {
  if (s.kind === '2d') {
    dir.set(s.x1 - s.x0, 0, s.z1 - s.z0);
    const len = Math.max(1, dir.length());
    dir.divideScalar(len);
    const d = Math.max(0, f * len - back);
    out.set(s.x0 + dir.x * d, 0, s.z0 + dir.z * d);
    return;
  }
  const x0 = Math.min(s.x0, s.x1);
  const x1 = Math.max(s.x0, s.x1);
  const z0 = Math.min(s.z0, s.z1);
  const z1 = Math.max(s.z0, s.z1);
  const w = Math.max(1, x1 - x0);
  const lines = Math.max(1, Math.floor((z1 - z0) / LINE_SPACING) + 1);
  const total = lines * w;
  const d = Math.max(0, Math.min(total - 0.001, f * total - back));
  const li = Math.floor(d / w);
  const t = d - li * w;
  const fwd = li % 2 === 0;
  out.set(fwd ? x0 + t : x1 - t, 0, Math.min(z1, z0 + li * LINE_SPACING));
  dir.set(fwd ? 1 : -1, 0, 0);
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export class VibroseisTraffic {
  private readonly convoys = new Map<string, Convoy>();

  constructor(private readonly env: VehicleEnv) {}

  update(dt: number): void {
    const surveys = Object.values(this.env.ctx.state.surveys).filter((s) => s.status === 'in_progress');
    const cam = this.env.camera.position;
    // at most three convoys, nearest to the camera
    surveys.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - cam.x, (a.z0 + a.z1) / 2 - cam.z) - Math.hypot((b.x0 + b.x1) / 2 - cam.x, (b.z0 + b.z1) / 2 - cam.z));
    const active = new Set(surveys.slice(0, 3).map((s) => s.id));
    for (const [id, c] of this.convoys)
      if (!active.has(id)) {
        for (const t of c.trucks) t.dispose();
        this.convoys.delete(id);
      }
    for (const s of surveys) {
      if (!active.has(s.id)) continue;
      let c = this.convoys.get(s.id);
      if (!c) {
        c = { trucks: [], phase: [], y: [] };
        for (let i = 0; i < TRUCKS; i++) {
          c.trucks.push(new Vehicle(this.env, vibroTemplate(this.env.lib.company)));
          c.phase.push(i * 0.35);
          c.y.push(NaN);
        }
        this.convoys.set(s.id, c);
      }
      this.step(s, c, dt);
    }
  }

  private step(s: SurveyState, c: Convoy, dt: number): void {
    const terrain = this.env.terrain;
    for (let i = 0; i < c.trucks.length; i++) {
      const tr = c.trucks[i];
      pathAt(s, Math.max(0, Math.min(1, s.progress)), i * SPACING, _p, _d);
      const g = terrain.smooth(_p.x, _p.z);
      c.y[i] = Number.isNaN(c.y[i]) ? g : c.y[i] + (g - c.y[i]) * Math.min(1, dt * 5);
      const prev = c.phase[i];
      c.phase[i] = (c.phase[i] + dt / CYCLE) % 1;
      const ph = c.phase[i];
      // plate: lower 0.0–0.15, vibrate 0.15–0.55, raise 0.55–0.7
      const plate = tr.node('plate');
      const down = ph < 0.15 ? ph / 0.15 : ph < 0.55 ? 1 : ph < 0.7 ? 1 - (ph - 0.55) / 0.15 : 0;
      if (plate) plate.position.y = 0.45 - down * 0.4;
      const shake = ph > 0.15 && ph < 0.55 ? Math.sin(ph * 400) * 0.02 : 0;
      tr.place(_p.x, c.y[i] + (ph > 0.15 && ph < 0.55 ? 0.05 : 0), _p.z, yawOf(_d.x, _d.z), 0, shake);
      const d = tr.distanceTo(this.env.camera.position);
      tr.obj.visible = d < 240;
      if (d < 150) {
        for (const th of [0.16, 0.36])
          if (prev < th && ph >= th) dustRing(this.env.fx.ps, _p.x, c.y[i], _p.z, Math.round(18 * Math.max(0.4, this.env.fx.q)), 3.2);
        tr.emit(dt, down > 0 ? 1 : 0.5);
      }
    }
  }

  dispose(): void {
    for (const c of this.convoys.values()) for (const t of c.trucks) t.dispose();
    this.convoys.clear();
  }
}
