// Tanker ships: sail in to export-terminal berths while the terminal is selling (and to FPSOs for
// tandem offloading when they hold enough crude), stay moored while loading, then leave.
// Ships approach along the berth heading from the side with the most open water.
import * as THREE from 'three';
import { SEA_LEVEL } from '../../../core/constants';
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { shipTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const RANGE = 170;
const VMAX = 6;
const ACC = 0.35;

interface Berth {
  key: string;
  v: Vehicle | null;
  pos: THREE.Vector3;
  dir: THREE.Vector3; // ship heading while moored
  /** Sign of travel along dir when arriving (+1: arrives moving along dir) and when leaving. */
  arriveSign: number;
  leaveSign: number;
  s: number;
  speed: number;
  state: 'idle' | 'approach' | 'moored' | 'leave';
  timer: number;
  bob: number;
}

export class ShipTraffic {
  private readonly berths = new Map<string, Berth>();

  constructor(private readonly env: VehicleEnv) {}

  private selling(b: BuildingState, v: BuildingView): boolean {
    if (v.status !== 'active' && v.status !== 'idle') return false;
    if (b.type === 'fpso') return (b.storage.crude_oil ?? 0) + (b.storage.condensate ?? 0) > 20000 || b.utilization > 0.6;
    if (v.status === 'active' && b.utilization > 0.02) return true;
    for (const val of Object.values(b.io)) if (val < 0) return true;
    return false;
  }

  /** Open water score along a ray from p in direction d. */
  private water(p: THREE.Vector3, d: THREE.Vector3, sign: number): number {
    let n = 0;
    for (let s = 20; s <= RANGE; s += 15) if (this.env.terrain.isWater(p.x + d.x * s * sign, p.z + d.z * s * sign)) n++;
    return n;
  }

  update(dt: number, views: Map<string, BuildingView>): void {
    const state = this.env.ctx.state;
    const seen = new Set<string>();
    for (const v of views.values()) {
      if (v.type !== 'export_terminal' && v.type !== 'fpso') continue;
      const b = state.buildings[v.id];
      const ba = v.anchors.find((a) => a.def.kind === 'berth');
      const bd = v.anchors.find((a) => a.def.kind === 'berthDir');
      if (!b || !ba || !bd) continue;
      seen.add(v.id);
      const key = `${b.x},${b.y},${b.z},${b.rotation},${v.variant}`;
      let berth = this.berths.get(v.id);
      if (berth && berth.key !== key) {
        berth.v?.dispose();
        berth = undefined;
      }
      if (!berth) {
        const pos = ba.pos.clone();
        pos.y = SEA_LEVEL + 1;
        const dir = new THREE.Vector3(bd.pos.x - ba.pos.x, 0, bd.pos.z - ba.pos.z).normalize();
        const back = this.water(pos, dir, -1);
        const fwd = this.water(pos, dir, 1);
        // arrive from the wetter side; leave forward if there is water ahead, else reverse out
        const arriveSign = back >= fwd ? 1 : -1;
        const leaveSign = (arriveSign > 0 ? fwd : back) >= 5 ? arriveSign : -arriveSign;
        berth = { key, v: null, pos, dir, arriveSign, leaveSign, s: 0, speed: 0, state: 'idle', timer: 5 + Math.random() * 10, bob: Math.random() * 10 };
        this.berths.set(v.id, berth);
      }
      this.step(berth, dt, this.selling(b, v));
    }
    for (const [id, b] of this.berths)
      if (!seen.has(id)) {
        b.v?.dispose();
        this.berths.delete(id);
      }
  }

  private step(bt: Berth, dt: number, selling: boolean): void {
    if (bt.state === 'idle') {
      if (!selling) return;
      bt.timer -= dt;
      if (bt.timer > 0) return;
      bt.v = new Vehicle(this.env, shipTemplate(this.env.lib.company));
      bt.state = 'approach';
      bt.s = -RANGE; // signed distance along the arrival direction, 0 at the berth
      bt.speed = VMAX;
    } else if (bt.state === 'approach') {
      bt.speed = Math.min(VMAX, Math.sqrt(2 * ACC * Math.max(0, -bt.s)) + 0.1);
      bt.s = Math.min(0, bt.s + bt.speed * dt);
      if (bt.s >= -0.01) {
        bt.state = 'moored';
        bt.timer = 45;
        bt.speed = 0;
      }
    } else if (bt.state === 'moored') {
      bt.timer -= dt;
      if (bt.timer <= 0 && !selling) bt.state = 'leave';
      if (bt.timer < -120) bt.state = 'leave';
    } else {
      bt.speed = Math.min(VMAX, bt.speed + ACC * dt);
      bt.s += bt.speed * dt;
      if (bt.s > RANGE) {
        bt.v?.dispose();
        bt.v = null;
        bt.state = 'idle';
        bt.timer = 40 + Math.random() * 60;
        return;
      }
    }
    if (!bt.v) return;
    const leaving = bt.state === 'leave';
    const sign = leaving ? bt.leaveSign : bt.arriveSign;
    // position: arriving moves along arriveSign·dir; leaving along leaveSign·dir from the berth
    const x = bt.pos.x + bt.dir.x * bt.s * sign;
    const z = bt.pos.z + bt.dir.z * bt.s * sign;
    bt.bob += dt;
    const y = bt.pos.y + Math.sin(bt.bob * 0.6) * 0.06;
    // bow points along arriveSign·dir; a reversing ship keeps its heading
    const hx = bt.dir.x * bt.arriveSign;
    const hz = bt.dir.z * bt.arriveSign;
    bt.v.place(x, y, z, yawOf(hx, hz), 0, Math.sin(bt.bob * 0.45) * 0.012);
    bt.v.obj.visible = bt.v.distanceTo(this.env.camera.position) < 320;
    bt.v.emit(dt, bt.state === 'moored' ? 0.3 : 1);
  }

  dispose(): void {
    for (const b of this.berths.values()) b.v?.dispose();
    this.berths.clear();
  }
}
