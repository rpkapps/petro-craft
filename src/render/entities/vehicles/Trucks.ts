// Tanker trucks: drive straight down the loading lane axis from the map edge into a free bay of an
// active truck terminal, load, and continue to the opposite edge. Spawn rate ∝ terminal activity.
import * as THREE from 'three';
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { truckTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const VMAX = 9;
const ACCEL = 3.2;
const SPAWN_DIST = 130;
const LOAD_TIME = 14;

interface Truck {
  v: Vehicle;
  bay: number;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  s: number;
  stopAt: number;
  end: number;
  speed: number;
  state: 'in' | 'load' | 'out';
  timer: number;
  y: number;
}

interface Terminal {
  timer: number;
  trucks: Truck[];
}

const _p = new THREE.Vector3();

export class TruckTraffic {
  private readonly terminals = new Map<string, Terminal>();

  constructor(private readonly env: VehicleEnv) {}

  private activity(b: BuildingState, v: BuildingView): number {
    if (v.status === 'active') return Math.max(0.25, Math.min(1, b.utilization || 0.6));
    if (v.status === 'idle') return 0.06;
    return 0;
  }

  update(dt: number, views: Map<string, BuildingView>): void {
    const state = this.env.ctx.state;
    for (const [id, t] of this.terminals) {
      if (!views.has(id) || !state.buildings[id]) {
        for (const tr of t.trucks) tr.v.dispose();
        this.terminals.delete(id);
      }
    }
    for (const v of views.values()) {
      if (v.type !== 'truck_terminal') continue;
      const b = state.buildings[v.id];
      if (!b) continue;
      let t = this.terminals.get(v.id);
      if (!t) {
        t = { timer: 2 + Math.random() * 6, trucks: [] };
        this.terminals.set(v.id, t);
      }
      const act = this.activity(b, v);
      if (act > 0) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.timer = 60 / (0.4 + 3.2 * act) * (0.7 + Math.random() * 0.6);
          this.spawn(v, t);
        }
      }
      for (let i = t.trucks.length - 1; i >= 0; i--) {
        if (!this.step(t.trucks[i], dt, act)) {
          t.trucks[i].v.dispose();
          t.trucks.splice(i, 1);
        }
      }
    }
  }

  private spawn(view: BuildingView, t: Terminal): void {
    const bays = view.anchors.filter((a) => a.def.kind === 'bay');
    const dirs = view.anchors.filter((a) => a.def.kind === 'bayDir');
    const free = bays.map((a) => a.def.data.i).filter((i) => !t.trucks.some((tr) => tr.bay === i));
    if (free.length === 0) return;
    const i = free[Math.floor(Math.random() * free.length)];
    const bay = bays.find((a) => a.def.data.i === i)!.pos;
    const ahead = dirs.find((a) => a.def.data.i === i)?.pos;
    if (!ahead) return;
    const dir = new THREE.Vector3(ahead.x - bay.x, 0, ahead.z - bay.z).normalize();
    const w = this.env.ctx.world;
    // distance to the map edge behind the bay along the lane
    const back = dir.x > 0.5 ? bay.x : dir.x < -0.5 ? w.sizeX - bay.x : dir.z > 0.5 ? bay.z : w.sizeZ - bay.z;
    const fwd = dir.x > 0.5 ? w.sizeX - bay.x : dir.x < -0.5 ? bay.x : dir.z > 0.5 ? w.sizeZ - bay.z : bay.z;
    const inDist = Math.max(8, Math.min(SPAWN_DIST, back - 2));
    const outDist = Math.max(8, Math.min(SPAWN_DIST, fwd - 2));
    const start = bay.clone().addScaledVector(dir, -inDist);
    const v = new Vehicle(this.env, truckTemplate(this.env.lib.company));
    const y = this.env.terrain.smooth(start.x, start.z);
    t.trucks.push({ v, bay: i, start, dir, s: 0, stopAt: inDist, end: inDist + outDist, speed: VMAX, state: 'in', timer: 0, y });
  }

  /** Advance one truck; false when it has left. */
  private step(tr: Truck, dt: number, act: number): boolean {
    if (tr.state === 'in') {
      const remain = tr.stopAt - tr.s;
      tr.speed = Math.min(VMAX, Math.sqrt(2 * ACCEL * Math.max(0, remain)) + 0.2);
      tr.s = Math.min(tr.stopAt, tr.s + tr.speed * dt);
      if (tr.s >= tr.stopAt - 0.01) {
        tr.state = 'load';
        tr.timer = LOAD_TIME * (1.2 - act * 0.4);
        tr.speed = 0;
      }
    } else if (tr.state === 'load') {
      tr.timer -= dt;
      if (tr.timer <= 0) tr.state = 'out';
    } else {
      tr.speed = Math.min(VMAX, tr.speed + ACCEL * dt);
      tr.s += tr.speed * dt;
      if (tr.s >= tr.end) return false;
    }
    _p.copy(tr.start).addScaledVector(tr.dir, tr.s);
    const terrain = this.env.terrain;
    const gy = terrain.smooth(_p.x, _p.z);
    tr.y += (gy - tr.y) * Math.min(1, dt * 6);
    const f = terrain.smooth(_p.x + tr.dir.x * 2, _p.z + tr.dir.z * 2);
    const r = terrain.smooth(_p.x - tr.dir.x * 2, _p.z - tr.dir.z * 2);
    const pitch = Math.atan2(f - r, 4) * 0.8;
    tr.v.place(_p.x, tr.y, _p.z, yawOf(tr.dir.x, tr.dir.z), pitch);
    const d = tr.v.distanceTo(this.env.camera.position);
    tr.v.obj.visible = d < 220;
    tr.v.emit(dt, tr.state === 'load' ? 0.4 : 0.6 + (tr.speed < VMAX ? 0.8 : 0));
    return true;
  }

  dispose(): void {
    for (const t of this.terminals.values()) for (const tr of t.trucks) tr.v.dispose();
    this.terminals.clear();
  }
}
